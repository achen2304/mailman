import type { Context, Next } from 'hono';
import { safeCompare } from '../lib/crypto.js';
import { UnauthorizedError } from './error.js';

/**
 * API-key authentication for `/v1/send`.
 *
 * A factory that captures the expected key (wired from config in the handler), so
 * the middleware itself is pure and testable. The comparison goes through
 * {@link safeCompare} — constant-time and, crucially, non-throwing on a
 * length mismatch, so a wrong key is a clean 401 rather than a 500.
 */

const API_KEY_HEADER = 'x-api-key';

/** Builds an API-key auth middleware that checks `X-Api-Key` against `expectedApiKey`. */
export function apiKeyAuth(expectedApiKey: string) {
  return async (c: Context, next: Next): Promise<void> => {
    const provided = c.req.header(API_KEY_HEADER);
    if (!provided) {
      throw UnauthorizedError('API key required');
    }
    if (!safeCompare(provided, expectedApiKey)) {
      throw UnauthorizedError('Invalid API key');
    }
    await next();
  };
}
