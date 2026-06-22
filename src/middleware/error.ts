import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/**
 * Error handling. `CustomError` carries an HTTP status + machine code; the pure
 * `toErrorResponse` maps any thrown value to a stable JSON body (and is the unit
 * under test). `honoErrorHandler` is the thin adapter wired into the Hono app.
 *
 * Internal/SES errors and stack traces are never leaked to clients in production.
 */

export interface ErrorBody {
  error: {
    message: string;
    code: string;
    statusCode: number;
    timestamp: string;
  };
}

export class CustomError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'CustomError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const ValidationError = (message: string): CustomError =>
  new CustomError(message, 400, 'VALIDATION_ERROR');
export const UnauthorizedError = (message = 'Unauthorized'): CustomError =>
  new CustomError(message, 401, 'UNAUTHORIZED');
export const BadRequestError = (message: string, code = 'BAD_REQUEST'): CustomError =>
  new CustomError(message, 400, code);
export const TooManyRequestsError = (message = 'Too many requests'): CustomError =>
  new CustomError(message, 429, 'TOO_MANY_REQUESTS');

/**
 * Maps any thrown value to a stable error response. Pure (aside from the
 * timestamp) so it can be unit-tested without a Hono context.
 *
 * @param err the thrown value
 * @param isProduction when true, generic 500s are scrubbed of their message
 */
export function toErrorResponse(
  err: unknown,
  isProduction: boolean
): { status: number; body: ErrorBody } {
  let statusCode: number;
  let code: string;
  let message: string;

  if (err instanceof CustomError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    // Field paths are about the caller's own request — safe to surface.
    message = err.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  } else {
    statusCode = 500;
    code = 'INTERNAL_ERROR';
    // Never leak an arbitrary error message (could contain SES/internal detail) in prod.
    message = isProduction
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : String(err);
  }

  return {
    status: statusCode,
    body: {
      error: { message, code, statusCode, timestamp: new Date().toISOString() },
    },
  };
}

/** Hono `onError` adapter — wraps `toErrorResponse`. */
export function honoErrorHandler(err: Error, c: Context): Response {
  const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';
  const { status, body } = toErrorResponse(err, isProduction);
  return c.json(body, status as ContentfulStatusCode);
}
