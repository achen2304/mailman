import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import { configKeyForParameter, ssmPathPrefix } from './environments.js';

/**
 * Config loading & validation.
 *
 * Source of truth is SSM under `/mailman/<stage>/*` in deployed environments;
 * locally it falls back to `process.env` (loaded from `.env`). The assembled
 * object is validated with zod and **fails fast** if a required core key is
 * missing. Supabase adapter keys are optional — the service boots fine without
 * them (standalone mode), and only the `userId` resolution path fails later if
 * it's used without a resolver.
 */

const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  STAGE: z.string().default('development'),
  AWS_REGION: z.string().default('us-east-1'),

  // Core — always required.
  SERVICE_API_KEY: z.string().min(1),
  SES_FROM_ADDRESS: z.string().min(1),
  UNSUBSCRIBE_HMAC_SECRET: z.string().min(1),
  APP_BASE_URL: z.url(),

  // Optional Supabase adapter.
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Optional SES configuration set.
  SES_CONFIGURATION_SET: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

/** Removes keys whose value is undefined so zod treats them as absent. */
function stripUndefined(input: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export class ConfigManager {
  private config: Config | null = null;
  private readonly ssmClient: SSMClient;

  constructor(ssmClient?: SSMClient) {
    // In Lambda the region is auto-detected; set it explicitly only for local dev.
    const region = process.env.AWS_REGION ?? 'us-east-1';
    this.ssmClient =
      ssmClient ?? new SSMClient(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { region });
  }

  /** Whether to read config from SSM (deployed) vs process.env (local/test). */
  private useParameterStore(): boolean {
    return (
      process.env.USE_AWS_PARAMETER_STORE === 'true' ||
      process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined
    );
  }

  private get stage(): string {
    return process.env.STAGE ?? process.env.NODE_ENV ?? 'development';
  }

  private fromEnv(): Record<string, string | undefined> {
    return {
      NODE_ENV: process.env.NODE_ENV,
      STAGE: this.stage,
      AWS_REGION: process.env.AWS_REGION,
      SERVICE_API_KEY: process.env.SERVICE_API_KEY,
      SES_FROM_ADDRESS: process.env.SES_FROM_ADDRESS,
      UNSUBSCRIBE_HMAC_SECRET: process.env.UNSUBSCRIBE_HMAC_SECRET,
      APP_BASE_URL: process.env.APP_BASE_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      SES_CONFIGURATION_SET: process.env.SES_CONFIGURATION_SET,
    };
  }

  private async loadFromParameterStore(): Promise<Record<string, string>> {
    const prefix = ssmPathPrefix(this.stage);
    const result: Record<string, string> = {};
    let nextToken: string | undefined;

    do {
      const response = await this.ssmClient.send(
        new GetParametersByPathCommand({
          Path: prefix,
          WithDecryption: true,
          Recursive: false,
          NextToken: nextToken,
        })
      );
      for (const param of response.Parameters ?? []) {
        const key = param.Name ? configKeyForParameter(param.Name) : null;
        if (key && param.Value !== undefined) {
          result[key] = param.Value;
        }
      }
      nextToken = response.NextToken;
    } while (nextToken);

    return result;
  }

  /** Loads, validates, and caches config. Throws on missing/invalid required keys. */
  async loadConfig(): Promise<Config> {
    const raw = this.fromEnv();
    if (this.useParameterStore()) {
      Object.assign(raw, await this.loadFromParameterStore());
    }

    const parsed = configSchema.safeParse(stripUndefined(raw));
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
      throw new Error(`Invalid or missing configuration: ${fields}`);
    }

    this.config = parsed.data;
    return this.config;
  }

  /** Returns the loaded config. Throws if accessed before loadConfig(). */
  getConfig(): Config {
    if (this.config === null) {
      throw new Error('Config accessed before loadConfig() completed');
    }
    return this.config;
  }
}

// App-wide singleton. Tests construct fresh instances for isolation.
const configManager = new ConfigManager();
export default configManager;
