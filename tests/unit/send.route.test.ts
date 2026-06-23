import { describe, it, expect, jest } from '@jest/globals';
import { createApp } from '../../src/app.js';
import type { SendDeps } from '../../src/routes/send.js';
import type { SesMailer } from '../../src/lib/ses.js';
import type { Suppression } from '../../src/lib/suppression.js';
import type { RecipientResolver } from '../../src/lib/resolver.js';
import { verifyUnsubscribeToken } from '../../src/lib/unsubscribe-token.js';

const API_KEY = 'test-key';
const SECRET = 'unsub-secret';
const BASE_URL = 'https://app.test';
const VALID_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const contactByEmail = {
  template: 'contact',
  to: { email: 'user@example.com' },
  data: { email: 'sender@example.com', subject: 'Hi', message: 'Hello there' },
};

function build(overrides: Partial<SendDeps> = {}) {
  const send = jest.fn<SesMailer['send']>().mockResolvedValue({ messageId: 'mid-1' });
  const isSuppressed = jest.fn<Suppression['isSuppressed']>().mockResolvedValue(false);
  const suppress = jest.fn<Suppression['suppress']>().mockResolvedValue(undefined);
  const deps: SendDeps = {
    apiKey: API_KEY,
    mailer: { send },
    suppression: { isSuppressed, suppress },
    appBaseUrl: BASE_URL,
    unsubscribeSecret: SECRET,
    ...overrides,
  };
  return { app: createApp(deps), send, isSuppressed, suppress };
}

function post(
  app: ReturnType<typeof build>['app'],
  payload: unknown,
  key: string | null = API_KEY
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== null) {
    headers['X-Api-Key'] = key;
  }
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return app.request('/v1/send', { method: 'POST', headers, body });
}

describe('POST /v1/send — happy path', () => {
  it('sends one email and returns 200 sent', async () => {
    const { app, send } = build();
    const res = await post(app, contactByEmail);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent', messageId: 'mid-1' });
    expect(send).toHaveBeenCalledTimes(1);
    const args = send.mock.calls[0]![0];
    expect(args.to).toBe('user@example.com');
    expect(args.subject).toContain('contact');
    expect(args.html).toContain('Hello there');
  });

  it('attaches a verifiable List-Unsubscribe URL when unsubscribeGroup is set', async () => {
    const { app, send } = build();
    await post(app, {
      template: 'comment-notification',
      to: { email: 'user@example.com' },
      data: { commenter: 'Ada', game: 'My Show', gamePath: '/play/x', comment: 'hi' },
      unsubscribeGroup: 'comments',
    });
    const url = send.mock.calls[0]![0].listUnsubscribeUrl!;
    expect(url.startsWith(`${BASE_URL}/unsubscribe?token=`)).toBe(true);
    const token = decodeURIComponent(new URL(url).searchParams.get('token')!);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({
      email: 'user@example.com',
      group: 'comments',
    });
  });
});

describe('POST /v1/send — suppression', () => {
  it('returns 200 suppressed and does not send when address is suppressed', async () => {
    const { app, send, isSuppressed } = build();
    isSuppressed.mockResolvedValueOnce(true);
    const res = await post(app, contactByEmail);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'suppressed' });
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a SES MessageRejected as a 200 no-op', async () => {
    const { app, send } = build();
    send.mockRejectedValueOnce(Object.assign(new Error('rejected'), { name: 'MessageRejected' }));
    const res = await post(app, contactByEmail);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'suppressed' });
  });
});

describe('POST /v1/send — recipient resolution (standalone vs resolver)', () => {
  it('rejects to.userId with 400 when no resolver is configured (standalone)', async () => {
    const { app, send } = build();
    const res = await post(app, { ...contactByEmail, to: { userId: VALID_UUID } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('RESOLVER_NOT_CONFIGURED');
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves to.userId to an email when a resolver is configured', async () => {
    const resolve = jest
      .fn<RecipientResolver['resolve']>()
      .mockResolvedValue('resolved@example.com');
    const { app, send } = build({ resolver: { resolve } });
    const res = await post(app, { ...contactByEmail, to: { userId: VALID_UUID } });
    expect(res.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith(VALID_UUID);
    expect(send.mock.calls[0]![0].to).toBe('resolved@example.com');
  });

  it('returns 404 when the resolver finds no address', async () => {
    const resolve = jest.fn<RecipientResolver['resolve']>().mockResolvedValue(null);
    const { app } = build({ resolver: { resolve } });
    const res = await post(app, { ...contactByEmail, to: { userId: VALID_UUID } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('RECIPIENT_NOT_FOUND');
  });
});

describe('POST /v1/send — auth & validation', () => {
  it('401 without an API key', async () => {
    const { app } = build();
    expect((await post(app, contactByEmail, null)).status).toBe(401);
  });

  it('400 on an unknown template', async () => {
    const { app } = build();
    const res = await post(app, { ...contactByEmail, template: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('400 on invalid template data (missing required field)', async () => {
    const { app } = build();
    const res = await post(app, {
      template: 'contact',
      to: { email: 'a@b.com' },
      data: { subject: 'x' },
    });
    expect(res.status).toBe(400);
  });

  it('400 on a malformed JSON body', async () => {
    const { app } = build();
    const res = await post(app, 'this is not json');
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/send — SES error classification', () => {
  it('503 on a transient SES error (retryable)', async () => {
    const { app, send } = build();
    send.mockRejectedValueOnce(
      Object.assign(new Error('slow down'), { name: 'ThrottlingException' })
    );
    const res = await post(app, contactByEmail);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('SES_UNAVAILABLE');
  });

  it('200 failed on a permanent SES error (avoid retry storms)', async () => {
    const { app, send } = build();
    send.mockRejectedValueOnce(Object.assign(new Error('bad'), { name: 'InvalidParameterValue' }));
    const res = await post(app, contactByEmail);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'failed' });
  });
});
