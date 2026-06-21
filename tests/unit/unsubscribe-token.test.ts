import { describe, it, expect } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../../src/lib/unsubscribe-token.js';

/** Helper: forge a token with a VALID signature over arbitrary raw payload bytes. */
function forgeSigned(rawPayload: string, secret: string): string {
  const b64 = Buffer.from(rawPayload, 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(rawPayload, 'utf8').digest('base64url');
  return `${b64}.${sig}`;
}

const SECRET = 'shared-unsubscribe-secret';
const PAYLOAD = { email: 'user@example.com', group: 'comments' };

describe('unsubscribe token', () => {
  it('round-trips: a signed token verifies back to the original payload', () => {
    const token = signUnsubscribeToken(PAYLOAD, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(PAYLOAD);
  });

  it('produces URL-safe tokens (no characters needing escaping)', () => {
    const token = signUnsubscribeToken(PAYLOAD, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signUnsubscribeToken(PAYLOAD, SECRET);
    expect(verifyUnsubscribeToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signUnsubscribeToken(PAYLOAD, SECRET);
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ email: 'attacker@example.com', group: 'comments' }),
      'utf8'
    ).toString('base64url');
    const forged = `${forgedPayload}.${signature}`;
    expect(verifyUnsubscribeToken(forged, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signUnsubscribeToken(PAYLOAD, SECRET);
    const [payload] = token.split('.');
    expect(verifyUnsubscribeToken(`${payload}.deadbeef`, SECRET)).toBeNull();
  });

  it('rejects garbage / malformed input', () => {
    expect(verifyUnsubscribeToken('', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('no-dot-here', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('too.many.dots', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('!!!.@@@', SECRET)).toBeNull();
  });

  it('rejects a validly-signed payload that is not the expected shape', () => {
    // Correctly HMAC'd, but payload lacks the required fields.
    expect(
      verifyUnsubscribeToken(forgeSigned(JSON.stringify({ foo: 'bar' }), SECRET), SECRET)
    ).toBeNull();
  });

  it('rejects a validly-signed payload that is not valid JSON', () => {
    // Signature passes, but the decoded payload cannot be parsed.
    expect(verifyUnsubscribeToken(forgeSigned('not-json-at-all', SECRET), SECRET)).toBeNull();
  });

  it('has NO expiry — a token verifies regardless of age', () => {
    // Tokens carry no timestamp; an identical payload always produces an
    // identical, still-valid token. This encodes the "links live forever" policy.
    const old = signUnsubscribeToken(PAYLOAD, SECRET);
    const fresh = signUnsubscribeToken(PAYLOAD, SECRET);
    expect(old).toBe(fresh);
    expect(verifyUnsubscribeToken(old, SECRET)).toEqual(PAYLOAD);
  });
});
