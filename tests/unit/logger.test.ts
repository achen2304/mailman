import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { logger, maskEmail } from '../../src/lib/logger.js';

describe('maskEmail', () => {
  it('keeps the first local char and the domain', () => {
    expect(maskEmail('user@example.com')).toBe('u***@example.com');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });

  it('returns *** when there is no usable local part', () => {
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('logger', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits a JSON line via console.log for info/warn', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('hello', { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toEqual({
      level: 'info',
      message: 'hello',
      a: 1,
    });
  });

  it('emits warnings via console.log at warn level', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.warn('careful');
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toEqual({
      level: 'warn',
      message: 'careful',
    });
  });

  it('emits errors via console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('boom');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]![0] as string).level).toBe('error');
  });
});
