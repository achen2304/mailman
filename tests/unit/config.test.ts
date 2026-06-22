import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { ConfigManager } from '../../src/config/index.js';

const ssmMock = mockClient(SSMClient);

// Snapshot/restore env so each test is isolated.
let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
  ssmMock.reset();
});
afterEach(() => {
  process.env = savedEnv;
});

describe('ConfigManager — local (process.env) mode', () => {
  it('loads and validates core config from env', async () => {
    const config = await new ConfigManager().loadConfig();
    expect(config.SERVICE_API_KEY).toBe('test-service-api-key');
    expect(config.APP_BASE_URL).toBe('https://app.example.test');
  });

  it('boots in standalone mode with no Supabase adapter keys', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const config = await new ConfigManager().loadConfig();
    expect(config.SUPABASE_URL).toBeUndefined();
    expect(config.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('includes Supabase adapter keys when present', async () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const config = await new ConfigManager().loadConfig();
    expect(config.SUPABASE_URL).toBe('https://proj.supabase.co');
  });

  it('fails fast when a required core key is missing', async () => {
    delete process.env.SERVICE_API_KEY;
    await expect(new ConfigManager().loadConfig()).rejects.toThrow(/SERVICE_API_KEY/);
  });

  it('fails fast when APP_BASE_URL is not a valid URL', async () => {
    process.env.APP_BASE_URL = 'not-a-url';
    await expect(new ConfigManager().loadConfig()).rejects.toThrow(/APP_BASE_URL/);
  });

  it('throws if getConfig() is called before loadConfig()', () => {
    expect(() => new ConfigManager().getConfig()).toThrow(/before loadConfig/);
  });

  it('getConfig() returns the loaded config after loadConfig()', async () => {
    const manager = new ConfigManager();
    const loaded = await manager.loadConfig();
    expect(manager.getConfig()).toBe(loaded);
  });
});

describe('ConfigManager — SSM mode', () => {
  it('loads and maps parameters from /mailman/<stage>/*', async () => {
    // Provide config only via SSM, not env.
    delete process.env.SERVICE_API_KEY;
    delete process.env.SES_FROM_ADDRESS;
    delete process.env.UNSUBSCRIBE_HMAC_SECRET;
    delete process.env.APP_BASE_URL;
    process.env.USE_AWS_PARAMETER_STORE = 'true';
    process.env.STAGE = 'production';

    ssmMock.on(GetParametersByPathCommand).resolves({
      Parameters: [
        { Name: '/mailman/production/service-api-key', Value: 'ssm-api-key' },
        { Name: '/mailman/production/ses-from-address', Value: 'Mailman <notify@mail.test>' },
        { Name: '/mailman/production/unsubscribe-hmac-secret', Value: 'ssm-hmac' },
        { Name: '/mailman/production/app-base-url', Value: 'https://prod.example.test' },
        { Name: '/mailman/production/unknown-key', Value: 'ignored' },
      ],
    });

    const config = await new ConfigManager().loadConfig();
    expect(config.SERVICE_API_KEY).toBe('ssm-api-key');
    expect(config.APP_BASE_URL).toBe('https://prod.example.test');
    expect(config.STAGE).toBe('production');
  });
});
