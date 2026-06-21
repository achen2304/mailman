/**
 * Regenerates contracts/send.schema.json from the zod request schema.
 * Run via `npm run contract:generate`. The committed file is drift-checked in
 * tests, so callers always have an up-to-date, authoritative contract.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSendRequestJsonSchema } from '../src/routes/send.schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'contracts', 'send.schema.json');

const json = JSON.stringify(buildSendRequestJsonSchema(), null, 2);
writeFileSync(outPath, `${json}\n`, 'utf8');

console.log(`Wrote ${outPath}`);
