import { describe, it, expect } from '@jest/globals';
import { noopSuppression } from '../../src/lib/suppression.js';

describe('noopSuppression', () => {
  it('never reports an address as suppressed (no pre-send lookup)', async () => {
    await expect(noopSuppression.isSuppressed('anyone@example.com')).resolves.toBe(false);
  });

  it('suppress() resolves without doing anything', async () => {
    await expect(
      noopSuppression.suppress('bounced@example.com', 'bounce')
    ).resolves.toBeUndefined();
  });
});
