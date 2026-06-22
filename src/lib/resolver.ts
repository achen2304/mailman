/**
 * Recipient-resolver port (optional).
 *
 * Turns a `userId` into an email address. This is an opt-in convenience: when no
 * resolver is configured, the `to.userId` request path returns 400 and only
 * `to.email` works (standalone mode). Chardle's Supabase adapter implements this
 * via the service-role `getUserById`.
 */
export interface RecipientResolver {
  /** Resolves a user id to an email address, or null if not found. */
  resolve(userId: string): Promise<string | null>;
}
