import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { buildDepsFromConfig } from './bootstrap.js';

/**
 * AWS Lambda entry point. Config is loaded once during cold-start init via
 * top-level await; subsequent invocations reuse the built app.
 */
const app = createApp(await buildDepsFromConfig());

export const handler = handle(app);
