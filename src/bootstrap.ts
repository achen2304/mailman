import configManager from './config/index.js';
import { createSesMailer } from './lib/ses.js';
import { noopSuppression } from './lib/suppression.js';
import type { SendDeps } from './routes/send.js';

/**
 * Loads config and assembles the real {@link SendDeps} (SES mailer + default
 * suppression port). Standalone by default — no recipient resolver is wired, so
 * `to.userId` requests 400 until the Supabase adapter (E1) provides one.
 */
export async function buildDepsFromConfig(): Promise<SendDeps> {
  const config = await configManager.loadConfig();

  const mailer = createSesMailer({
    region: config.AWS_REGION,
    from: config.SES_FROM_ADDRESS,
    ...(config.SES_CONFIGURATION_SET ? { configurationSet: config.SES_CONFIGURATION_SET } : {}),
  });

  return {
    apiKey: config.SERVICE_API_KEY,
    mailer,
    suppression: noopSuppression,
    appBaseUrl: config.APP_BASE_URL,
    unsubscribeSecret: config.UNSUBSCRIBE_HMAC_SECRET,
  };
}
