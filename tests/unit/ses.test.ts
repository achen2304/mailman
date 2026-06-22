import { describe, it, expect, beforeEach } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createSesMailer, isSuppressedRecipientError } from '../../src/lib/ses.js';

// Importing + constructing the mailer is also the ESM/CJS-nodemailer interop smoke:
// if the default `import nodemailer from 'nodemailer'` broke under ESM, this file
// would fail to load.
const sesMock = mockClient(SESv2Client);

function commandInput(callIndex = 0) {
  return sesMock.commandCalls(SendEmailCommand)[callIndex]!.args[0].input;
}

function rawMimeOf(callIndex = 0): string {
  return Buffer.from(commandInput(callIndex).Content!.Raw!.Data!).toString('utf8');
}

describe('createSesMailer', () => {
  beforeEach(() => {
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'abc-123' });
  });

  const baseArgs = { to: 'user@example.com', subject: 'Hi there', html: '<p>hi</p>', text: 'hi' };

  it('sends raw MIME with from/to/subject and returns a message id', async () => {
    const mailer = createSesMailer({ region: 'us-east-1', from: 'Mailman <notify@mail.test>' });
    const res = await mailer.send(baseArgs);

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    expect(res.messageId).toBeTruthy();
    expect(commandInput().Destination!.ToAddresses).toContain('user@example.com');

    const raw = rawMimeOf();
    expect(raw).toMatch(/^To: user@example.com$/m);
    expect(raw).toMatch(/^Subject: Hi there$/m);
    expect(raw).toContain('notify@mail.test');
  });

  it('injects List-Unsubscribe + one-click headers when a URL is given', async () => {
    const mailer = createSesMailer({ region: 'us-east-1', from: 'a@b.test' });
    await mailer.send({
      ...baseArgs,
      listUnsubscribeUrl: 'https://app.test/unsubscribe?token=abc',
    });

    const raw = rawMimeOf();
    expect(raw).toMatch(/^List-Unsubscribe: <https:\/\/app\.test\/unsubscribe\?token=abc>$/m);
    expect(raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  });

  it('passes ConfigurationSetName natively (no MIME header) when configured', async () => {
    const mailer = createSesMailer({
      region: 'us-east-1',
      from: 'a@b.test',
      configurationSet: 'cs-1',
    });
    await mailer.send(baseArgs);

    expect(commandInput().ConfigurationSetName).toBe('cs-1');
    expect(rawMimeOf()).not.toMatch(/X-SES-CONFIGURATION-SET/i);
  });

  it('omits optional fields when not provided', async () => {
    const mailer = createSesMailer({ region: 'us-east-1', from: 'a@b.test' });
    await mailer.send(baseArgs);

    expect(commandInput().ConfigurationSetName).toBeUndefined();
    expect(rawMimeOf()).not.toMatch(/List-Unsubscribe/i);
  });

  it('rejects when SES rejects', async () => {
    sesMock.reset();
    const rejection = Object.assign(new Error('Email address is not verified'), {
      name: 'MessageRejected',
    });
    sesMock.on(SendEmailCommand).rejects(rejection);
    const mailer = createSesMailer({ region: 'us-east-1', from: 'a@b.test' });
    await expect(mailer.send(baseArgs)).rejects.toThrow(/not verified/);
  });
});

describe('isSuppressedRecipientError', () => {
  it('is true for a MessageRejected SES error', () => {
    expect(
      isSuppressedRecipientError(Object.assign(new Error('x'), { name: 'MessageRejected' }))
    ).toBe(true);
  });

  it('is false for other errors and non-objects', () => {
    expect(isSuppressedRecipientError(new Error('boom'))).toBe(false);
    expect(isSuppressedRecipientError('nope')).toBe(false);
    expect(isSuppressedRecipientError(null)).toBe(false);
  });
});
