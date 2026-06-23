import type { Hono } from 'hono';
import { sendRequestSchema, type SendRequest } from './send.schema.js';
import { apiKeyAuth } from '../middleware/auth.js';
import { CustomError, ValidationError, BadRequestError } from '../middleware/error.js';
import { render } from '../templates/index.js';
import { signUnsubscribeToken } from '../lib/unsubscribe-token.js';
import { isSuppressedRecipientError, isTransientSesError, type SesMailer } from '../lib/ses.js';
import type { Suppression } from '../lib/suppression.js';
import type { RecipientResolver } from '../lib/resolver.js';
import { logger, maskEmail } from '../lib/logger.js';

/** Collaborators the send flow needs. Ports are injected so the logic is testable. */
export interface SendDeps {
  apiKey: string;
  mailer: SesMailer;
  suppression: Suppression;
  /** Optional — when absent, `to.userId` requests are rejected (standalone mode). */
  resolver?: RecipientResolver;
  appBaseUrl: string;
  unsubscribeSecret: string;
}

/** What happened to the request — all of these are returned as HTTP 200. */
export type SendOutcome =
  | { status: 'sent'; messageId: string }
  | { status: 'suppressed' }
  | { status: 'failed' };

/** Resolves the recipient email from the request, applying resolver rules. */
async function resolveRecipient(req: SendRequest, deps: SendDeps): Promise<string> {
  if ('email' in req.to) {
    return req.to.email;
  }
  if (!deps.resolver) {
    throw BadRequestError('userId resolution is not configured', 'RESOLVER_NOT_CONFIGURED');
  }
  const resolved = await deps.resolver.resolve(req.to.userId);
  if (!resolved) {
    throw new CustomError('Recipient not found', 404, 'RECIPIENT_NOT_FOUND');
  }
  return resolved;
}

/**
 * Core send decision logic. Pure of HTTP — takes a validated request + injected
 * ports and returns an outcome (or throws a CustomError the route maps to a status).
 *
 * Flow: resolve recipient → suppression check (no-op if suppressed) → render →
 * optional List-Unsubscribe → send. SES errors are classified: suppressed
 * recipient → no-op 200; transient → 5xx (retryable); permanent → logged + 200
 * (avoid caller retry storms).
 */
export async function processSend(req: SendRequest, deps: SendDeps): Promise<SendOutcome> {
  const email = await resolveRecipient(req, deps);

  if (await deps.suppression.isSuppressed(email)) {
    return { status: 'suppressed' };
  }

  const rendered = render(req.template, req.data, { appBaseUrl: deps.appBaseUrl });

  let listUnsubscribeUrl: string | undefined;
  if (req.unsubscribeGroup) {
    const token = signUnsubscribeToken(
      { email, group: req.unsubscribeGroup },
      deps.unsubscribeSecret
    );
    listUnsubscribeUrl = `${deps.appBaseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  try {
    const { messageId } = await deps.mailer.send({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(listUnsubscribeUrl ? { listUnsubscribeUrl } : {}),
    });
    return { status: 'sent', messageId };
  } catch (err) {
    if (isSuppressedRecipientError(err)) {
      return { status: 'suppressed' };
    }
    if (isTransientSesError(err)) {
      throw new CustomError('Email service temporarily unavailable', 503, 'SES_UNAVAILABLE');
    }
    logger.error('Permanent SES send failure', {
      email: maskEmail(email),
      template: req.template,
    });
    return { status: 'failed' };
  }
}

/** Registers `POST /v1/send` (api-key protected) on the given Hono app. */
export function registerSendRoute(app: Hono, deps: SendDeps): void {
  app.post('/v1/send', apiKeyAuth(deps.apiKey), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw ValidationError('Request body must be valid JSON');
    }
    const req = sendRequestSchema.parse(body);
    const outcome = await processSend(req, deps);
    return c.json(outcome, 200);
  });
}
