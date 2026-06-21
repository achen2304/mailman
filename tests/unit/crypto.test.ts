import { describe, it, expect } from '@jest/globals';
import { safeCompare } from '../../src/lib/crypto.js';

describe('safeCompare', () => {
  it('returns true for identical strings', () => {
    expect(safeCompare('s3cret-key', 's3cret-key')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeCompare('aaaaaa', 'bbbbbb')).toBe(false);
  });

  it('returns false for different-length strings WITHOUT throwing', () => {
    // The whole point of hashing first: timingSafeEqual throws on length
    // mismatch. This must return false, never throw or leak length.
    expect(() => safeCompare('short', 'a-much-longer-value')).not.toThrow();
    expect(safeCompare('short', 'a-much-longer-value')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(safeCompare('', '')).toBe(true);
    expect(safeCompare('', 'x')).toBe(false);
  });

  it('is sensitive to a single-character difference', () => {
    expect(safeCompare('correct-horse', 'correct-horsE')).toBe(false);
  });
});
