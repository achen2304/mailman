import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  CustomError,
  toErrorResponse,
  honoErrorHandler,
  ValidationError,
  UnauthorizedError,
  BadRequestError,
  TooManyRequestsError,
} from '../../src/middleware/error.js';

describe('toErrorResponse', () => {
  it('maps a CustomError to its status, code, and message', () => {
    const { status, body } = toErrorResponse(new CustomError('nope', 403, 'FORBIDDEN'), false);
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('nope');
    expect(body.error.statusCode).toBe(403);
  });

  it('maps the ValidationError helper to 400', () => {
    const { status, body } = toErrorResponse(ValidationError('bad input'), false);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps a ZodError to 400 with field paths', () => {
    const result = z.object({ name: z.string() }).safeParse({});
    expect(result.success).toBe(false);
    const { status, body } = toErrorResponse(result.error, false);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('name');
  });

  it('scrubs a generic error message in production', () => {
    const { status, body } = toErrorResponse(new Error('SES secret leaked here'), true);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  it('preserves a generic error message in development', () => {
    const { body } = toErrorResponse(new Error('detailed dev message'), false);
    expect(body.error.message).toBe('detailed dev message');
  });

  it('handles a non-Error thrown value', () => {
    const { status, body } = toErrorResponse('a string was thrown', false);
    expect(status).toBe(500);
    expect(body.error.message).toBe('a string was thrown');
  });

  it('always includes an ISO timestamp', () => {
    const { body } = toErrorResponse(new CustomError('x'), false);
    expect(() => new Date(body.error.timestamp).toISOString()).not.toThrow();
    expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('error creators', () => {
  it.each([
    [UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [BadRequestError('bad'), 400, 'BAD_REQUEST'],
    [TooManyRequestsError(), 429, 'TOO_MANY_REQUESTS'],
  ] as const)('produces the expected status/code', (err, status, code) => {
    expect(err.statusCode).toBe(status);
    expect(err.code).toBe(code);
  });
});

describe('honoErrorHandler', () => {
  it('renders a thrown CustomError through a Hono app', async () => {
    const app = new Hono();
    app.onError(honoErrorHandler);
    app.get('/boom', () => {
      throw new CustomError('teapot', 418, 'TEAPOT');
    });

    const res = await app.request('/boom');
    expect(res.status).toBe(418);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('TEAPOT');
  });
});
