import { describe, it, expect } from '@jest/globals';
import { Hono } from 'hono';
import { apiKeyAuth } from '../../src/middleware/auth.js';
import { honoErrorHandler } from '../../src/middleware/error.js';

const API_KEY = 'super-secret-key';

function buildApp() {
  const app = new Hono();
  app.use('/protected', apiKeyAuth(API_KEY));
  app.get('/protected', (c) => c.json({ ok: true }));
  app.onError(honoErrorHandler);
  return app;
}

describe('apiKeyAuth', () => {
  it('allows a request with the correct key', async () => {
    const res = await buildApp().request('/protected', { headers: { 'X-Api-Key': API_KEY } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects a missing key with 401', async () => {
    const res = await buildApp().request('/protected');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong key of equal length with 401', async () => {
    const res = await buildApp().request('/protected', {
      headers: { 'X-Api-Key': 'super-secret-KEY' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong key of different length with 401 (no 500 from a length mismatch)', async () => {
    const res = await buildApp().request('/protected', { headers: { 'X-Api-Key': 'x' } });
    expect(res.status).toBe(401);
  });

  it('matches the header case-insensitively', async () => {
    const res = await buildApp().request('/protected', { headers: { 'x-api-key': API_KEY } });
    expect(res.status).toBe(200);
  });
});
