import { createHmac } from 'node:crypto';
import { safeCompare } from './crypto.js';

/**
 * Unsubscribe-token signing and verification.
 *
 * The service only ever **signs** tokens for the `List-Unsubscribe` URL; the
 * consumer app/Supabase verifies them with the same shared secret and records the
 * opt-out (this service hosts no unsubscribe endpoint). `verify` exists here to
 * prove correctness in tests and to document the exact format the consumer must
 * implement.
 *
 * Format: `<payloadB64Url>.<sigB64Url>` where the payload is the canonical JSON
 * `{"email":...,"group":...}` and the signature is HMAC-SHA256 over that payload.
 *
 * **No expiry by design** — these links live in emails forever and one-click
 * POSTs can arrive months later. Tokens never time out; revocation is the
 * consumer recording the opt-out, not the token expiring.
 */

/** The data bound into an unsubscribe token. */
export interface UnsubscribePayload {
  /** Recipient address being opted out. */
  email: string;
  /** Unsubscribe group (e.g. "comments"); maps to a consumer preference. */
  group: string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * Canonical JSON for a payload — fixed key order so the same payload always
 * produces the same bytes (and thus the same signature) on both sides.
 */
function canonicalize(payload: UnsubscribePayload): string {
  return JSON.stringify({ email: payload.email, group: payload.group });
}

function sign(payloadJson: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadJson, 'utf8').digest('base64url');
}

/**
 * Signs an unsubscribe token for the given payload.
 *
 * @param payload recipient + group to bind into the token
 * @param secret shared HMAC secret (also held by the consumer app)
 * @returns a `<payload>.<signature>` token safe for use in a URL
 */
export function signUnsubscribeToken(payload: UnsubscribePayload, secret: string): string {
  const payloadJson = canonicalize(payload);
  const signature = sign(payloadJson, secret);
  return `${base64UrlEncode(payloadJson)}.${signature}`;
}

/**
 * Verifies a token and returns its payload, or null if the token is malformed,
 * tampered with, or signed with a different secret. Uses a constant-time compare
 * on the signature. There is intentionally no expiry check.
 *
 * @param token the `<payload>.<signature>` string
 * @param secret shared HMAC secret
 * @returns the verified payload, or null if invalid
 */
export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, signature] = parts as [string, string];

  // Buffer.from(..., 'base64url') is lenient and never throws — invalid input
  // just yields garbage bytes, which the signature check below rejects.
  const payloadJson = base64UrlDecode(payloadB64);

  const expectedSignature = sign(payloadJson, secret);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).email !== 'string' ||
    typeof (parsed as Record<string, unknown>).group !== 'string'
  ) {
    return null;
  }

  const { email, group } = parsed as { email: string; group: string };
  return { email, group };
}
