// Jest setup — runs before each test file.
import { jest } from '@jest/globals';

// Deterministic test environment. Real config comes from SSM/.env in prod;
// here we set placeholders so config bootstrap and pure logic run offline.
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.USE_AWS_PARAMETER_STORE = 'false';

// Core (always-required) mailman config — placeholders for tests.
process.env.SERVICE_API_KEY = 'test-service-api-key';
process.env.SES_FROM_ADDRESS = 'Mailman Test <notify@example.test>';
process.env.UNSUBSCRIBE_HMAC_SECRET = 'test-unsubscribe-hmac-secret';
process.env.APP_BASE_URL = 'https://app.example.test';

jest.setTimeout(10000);
