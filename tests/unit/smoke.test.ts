import { describe, it, expect } from '@jest/globals';
// `.js` suffix on a `.ts` source import — verifies NodeNext ESM resolution
// works through ts-jest's ESM preset + moduleNameMapper.
import { SERVICE_NAME, SERVICE_VERSION } from '../../src/version.js';

describe('scaffold smoke', () => {
  it('loads an ESM source module', () => {
    expect(SERVICE_NAME).toBe('mailman');
    expect(SERVICE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
