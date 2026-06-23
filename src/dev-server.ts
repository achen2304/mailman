import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { buildDepsFromConfig } from './bootstrap.js';

/**
 * Local dev server (NOT bundled into the Lambda). Lets you curl `/v1/send`
 * before SAM exists: `npm run dev`, then POST with an `X-Api-Key` header.
 * Config comes from `.env` (loaded above).
 */
const app = createApp(await buildDepsFromConfig());
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port });
console.log(`mailman dev server listening on http://localhost:${port}`);
