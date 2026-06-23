import { Hono } from 'hono';
import { honoErrorHandler } from './middleware/error.js';
import { registerSendRoute, type SendDeps } from './routes/send.js';

/**
 * Builds the Hono app from injected dependencies. Pure and synchronous, so tests
 * can mount it with mock ports; the Lambda handler and dev-server supply real ones.
 */
export function createApp(deps: SendDeps): Hono {
  const app = new Hono();
  registerSendRoute(app, deps);
  app.onError(honoErrorHandler);
  return app;
}
