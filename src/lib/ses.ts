import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * SES send path via Nodemailer's SES transport.
 *
 * Nodemailer (not a hand-built command) is used because we need raw MIME to set
 * `List-Unsubscribe` / `List-Unsubscribe-Post` headers and clean multipart
 * text+html — and, later, attachment MIME for the contact-form migration.
 *
 * Nodemailer 8's SES transport targets **SESv2** (`@aws-sdk/client-sesv2`,
 * `SendEmailCommand`): it sends raw MIME via `Content.Raw.Data` and accepts a
 * native `ConfigurationSetName` (no `X-SES-CONFIGURATION-SET` header needed).
 *
 * This module is also the ESM ↔ CommonJS-`nodemailer` interop smoke point: the
 * default import below must work under `nodejs22.x` ESM. The ses test exercises it.
 */

/** A single email to send. Optional fields are applied only when provided. */
export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** When set, adds `List-Unsubscribe` + RFC 8058 one-click `-Post` headers. */
  listUnsubscribeUrl?: string;
  /** Overrides the mailer's default SES configuration set for this send. */
  configurationSet?: string;
}

export interface SesMailer {
  /** Sends one email; resolves with the SES message id, rejects on SES error. */
  send(args: SendArgs): Promise<{ messageId: string }>;
}

export interface SesMailerOptions {
  region: string;
  /** RFC5322 From value, e.g. `Mailman <notify@mail.example.com>`. */
  from: string;
  /** Default SES configuration set applied to every send (if feedback uses one). */
  configurationSet?: string;
}

/**
 * Creates an {@link SesMailer} backed by a real SESv2 transport. The underlying
 * `SESv2Client` is created here; tests intercept it with `aws-sdk-client-mock`.
 */
export function createSesMailer(options: SesMailerOptions): SesMailer {
  const transporter = nodemailer.createTransport({
    SES: { sesClient: new SESv2Client({ region: options.region }), SendEmailCommand },
  });

  return {
    async send(args: SendArgs): Promise<{ messageId: string }> {
      const headers: Record<string, string> = {};
      if (args.listUnsubscribeUrl) {
        headers['List-Unsubscribe'] = `<${args.listUnsubscribeUrl}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }

      const configurationSet = args.configurationSet ?? options.configurationSet;

      // Assigned to a variable (not an inline literal) so the SESv2-specific `ses`
      // field passes through to the transport without an excess-property error.
      const mailOptions = {
        from: options.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        headers,
        ...(configurationSet ? { ses: { ConfigurationSetName: configurationSet } } : {}),
      };

      const info = await transporter.sendMail(mailOptions);
      return { messageId: info.messageId };
    },
  };
}

/**
 * True if an error is SES refusing a recipient on its suppression list
 * (`MessageRejected`). The send flow treats this as a no-op rather than a failure,
 * since account-level SES suppression is the actual enforcement.
 */
export function isSuppressedRecipientError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  return (err as { name?: unknown }).name === 'MessageRejected';
}

const TRANSIENT_SES_ERROR_NAMES = new Set([
  'ThrottlingException',
  'Throttling',
  'TooManyRequestsException',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'RequestTimeout',
  'TimeoutError',
]);

/**
 * True if a SES error is transient (throttling / 5xx / SDK-retryable), meaning the
 * caller may safely retry → the route returns 5xx. Permanent failures instead
 * return 200 to avoid caller retry storms.
 */
export function isTransientSesError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const e = err as {
    name?: unknown;
    $retryable?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  if (typeof e.name === 'string' && TRANSIENT_SES_ERROR_NAMES.has(e.name)) {
    return true;
  }
  if (e.$retryable) {
    return true;
  }
  const status = e.$metadata?.httpStatusCode;
  return typeof status === 'number' && status >= 500;
}
