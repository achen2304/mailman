/**
 * Shared `/v1/send` request fixtures — valid and invalid shapes. Reused by the
 * schema unit tests and (later) the integration tests so both exercise the same
 * canonical examples.
 */

const VALID_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

export const validByEmail = {
  template: 'contact',
  to: { email: 'sender@example.com' },
  data: { subject: 'Hi', message: 'Hello there' },
};

export const validByUserId = {
  template: 'comment-notification',
  to: { userId: VALID_UUID },
  data: { commenter: 'Ada', game: 'My Show' },
  unsubscribeGroup: 'comments',
};

export const invalidPayloads: Record<string, unknown> = {
  bothEmailAndUserId: {
    template: 'contact',
    to: { email: 'a@b.com', userId: VALID_UUID },
    data: { subject: 'x' },
  },
  neitherEmailNorUserId: {
    template: 'contact',
    to: {},
    data: { subject: 'x' },
  },
  missingTemplate: {
    to: { email: 'a@b.com' },
    data: { subject: 'x' },
  },
  unknownTemplate: {
    template: 'does-not-exist',
    to: { email: 'a@b.com' },
    data: { subject: 'x' },
  },
  emptyData: {
    template: 'contact',
    to: { email: 'a@b.com' },
    data: {},
  },
  malformedEmail: {
    template: 'contact',
    to: { email: 'not-an-email' },
    data: { subject: 'x' },
  },
  malformedUserId: {
    template: 'comment-notification',
    to: { userId: 'not-a-uuid' },
    data: { commenter: 'x' },
  },
  extraTopLevelKey: {
    template: 'contact',
    to: { email: 'a@b.com' },
    data: { subject: 'x' },
    surprise: true,
  },
};
