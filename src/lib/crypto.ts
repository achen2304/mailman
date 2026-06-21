import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string equality for secrets (API keys, HMAC digests).
 *
 * `crypto.timingSafeEqual` **throws** when the two buffers differ in length —
 * which both leaks length information and crashes the wrong-input path. To avoid
 * that, both inputs are first hashed to a fixed 32-byte SHA-256 digest, so the
 * comparison always runs over equal-length buffers and never throws.
 *
 * @param a first value (e.g. the secret on file)
 * @param b second value (e.g. caller-supplied input — never passed raw to timingSafeEqual)
 * @returns true iff the two inputs are byte-for-byte identical
 */
export function safeCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  // Both digests are 32 bytes, so timingSafeEqual is safe and constant-time.
  return timingSafeEqual(digestA, digestB);
}
