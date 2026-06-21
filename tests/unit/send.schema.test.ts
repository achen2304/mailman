import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sendRequestSchema, buildSendRequestJsonSchema } from '../../src/routes/send.schema.js';
import { validByEmail, validByUserId, invalidPayloads } from '../fixtures/send-payloads.js';

describe('sendRequestSchema — valid shapes', () => {
  it('accepts a by-email request', () => {
    expect(sendRequestSchema.safeParse(validByEmail).success).toBe(true);
  });

  it('accepts a by-userId request with an unsubscribe group', () => {
    expect(sendRequestSchema.safeParse(validByUserId).success).toBe(true);
  });
});

describe('sendRequestSchema — rejected shapes', () => {
  it.each(Object.keys(invalidPayloads))('rejects %s', (key) => {
    const result = sendRequestSchema.safeParse(invalidPayloads[key]);
    expect(result.success).toBe(false);
  });
});

describe('send.schema.json contract', () => {
  it('matches the committed contract file (run `npm run contract:generate` on drift)', () => {
    const committed = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'send.schema.json'), 'utf8')
    );
    expect(buildSendRequestJsonSchema()).toEqual(committed);
  });
});
