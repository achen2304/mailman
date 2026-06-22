/**
 * Suppression port.
 *
 * The send flow asks `isSuppressed(email)` before sending and calls
 * `suppress(email, reason)` from the bounce/complaint handler. The default
 * implementation does **no** DB work: `isSuppressed` always returns false (no
 * pre-send lookup — `@aws-sdk/client-ses` has no suppression-list API), and the
 * send path instead catches SES `MessageRejected` for suppressed recipients.
 * Account-level SES suppression is the real enforcement. Chardle's Supabase
 * adapter overrides this with an app-visible `email_suppressions` table.
 */

export type SuppressionReason = 'bounce' | 'complaint' | 'manual';

export interface Suppression {
  /** Whether sends to this address should be skipped (200 no-op). */
  isSuppressed(email: string): Promise<boolean>;
  /** Records an address as suppressed (called on permanent bounce / complaint). */
  suppress(email: string, reason: SuppressionReason): Promise<void>;
}

/**
 * Default port: no DB. Relies on SES account-level suppression + the send path's
 * `MessageRejected` catch. `suppress` is a no-op because SES already auto-suppresses.
 */
export const noopSuppression: Suppression = {
  async isSuppressed(): Promise<boolean> {
    return false;
  },
  async suppress(): Promise<void> {
    // Intentionally empty — SES handles account-level suppression itself.
  },
};
