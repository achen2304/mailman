/**
 * SSM parameter layout for mailman config.
 *
 * Parameters live under `/mailman/<stage>/<name>` (a generic namespace — not
 * `/chardle/*` — so a second consumer deploys its own stage without a
 * Chardle-shaped path). Each leaf name maps to an internal config key here.
 */

/** Maps the SSM leaf name (kebab-case) to the internal config key. */
export const SSM_KEYS = {
  'service-api-key': 'SERVICE_API_KEY',
  'ses-from-address': 'SES_FROM_ADDRESS',
  'unsubscribe-hmac-secret': 'UNSUBSCRIBE_HMAC_SECRET',
  'app-base-url': 'APP_BASE_URL',
  // Optional Supabase adapter keys.
  'supabase-url': 'SUPABASE_URL',
  'supabase-service-role-key': 'SUPABASE_SERVICE_ROLE_KEY',
  // Optional SES configuration-set name (only if feedback is wired via a config set).
  'ses-configuration-set': 'SES_CONFIGURATION_SET',
} as const;

export type SsmLeafName = keyof typeof SSM_KEYS;
export type ConfigKey = (typeof SSM_KEYS)[SsmLeafName];

/** Builds the SSM path prefix (with trailing slash) for a stage. */
export function ssmPathPrefix(stage: string): string {
  return `/mailman/${stage}/`;
}

/** Resolves the internal config key for a full SSM parameter name, or null. */
export function configKeyForParameter(parameterName: string): ConfigKey | null {
  const leaf = parameterName.split('/').pop();
  if (leaf && leaf in SSM_KEYS) {
    return SSM_KEYS[leaf as SsmLeafName];
  }
  return null;
}
