# Plan: `mailman` — standalone email microservice

## Context

Chardle currently sends email only through an inline Next.js route (`src/app/api/send-email/route.ts`) that calls **Resend** for the contact form and character-edit submissions. The near-term goal is a **comment-notification feature** ("email me when someone comments/replies on my game"), but the user wants to avoid a flat email subscription and prefers **usage-based AWS SES**, and wants the sender to live in a **separate, public repository** that is **easy to connect** to both the future comments feature and the existing app.

**This plan covers only that standalone email microservice.** The comments feature itself (Supabase `custom_show_comments` table, web UI, the Supabase webhook that triggers a send) is explicitly **out of scope for now** — but the service's API is designed so that work later becomes a thin "call this endpoint" integration. Building the email foundation first, in isolation, lets it be fully tested (real SES sandbox sends, bounce handling, unsubscribe) before any product feature depends on it.

Outcome: a deployed, SES-backed, usage-priced transactional email service with a clean shared-secret send contract and bounce/complaint suppression — ready for the comments feature (and a later contact-form migration off Resend) to plug into.

**Standalone principle:** although the first (and currently only) consumer is Chardle, `mailman` is built as a **generic, reusable transactional email service** — give it an `email`, a template, and data, and it sends. Everything Chardle-specific (resolving a `userId` to an address via Supabase, the app-level suppression table, the product templates) lives behind **optional adapters/config**, so the service runs end-to-end with **zero Supabase dependency** when callers pass an address directly. Chardle is the first *consumer*, not a baked-in assumption. This keeps the service portable to other apps and simpler to test in isolation.

## Recommended architecture (safest / cheapest / cleanest)

**AWS SAM (esbuild build) → AWS Lambda + API Gateway HTTP API, lean Hono handler, SES via Nodemailer transport, bounce/complaint handling via SNS → Lambda (direct subscription, not HTTPS), secrets in SSM, deployed via GitHub Actions OIDC (no stored AWS keys).** Mirrors the _operational_ conventions of `D:\Projects\chardle-backend` (SSM `ConfigManager`, GitHub Actions CI, ESLint flat + Prettier + Husky + Jest) but **replaces Express with Hono** and **the backend's Serverless v3 with SAM** for a lean, public single-purpose service. See `deployment-options.md` for the full pros/cons comparison and per-option skeletons.

> **IaC note:** the backend uses Serverless Framework **v3** (EOL/maintenance) and **v4 has paid-license/phone-home terms that are awkward in a public repo**. **AWS SAM** is recommended here: AWS-native, no licensing, and `sam build` esbuild-bundles TS — which auto-resolves the ESM/CJS-`nodemailer` interop and the build-packaging question below. **CDK (TypeScript)** is the scale-up option if the service grows beyond one endpoint; a **Lambda Function URL** is the leaner alternative if you accept owning rate limiting in code. IaC choice doesn't affect the application code in `src/**`.

> **Build-time corrections (discovered during implementation — these override the prose below where they conflict):**
>
> - **SESv2, not SESv1.** Nodemailer was bumped to **8.0.11** (the `^6` line carries high-severity SMTP-injection/DoS advisories). Nodemailer 8's SES transport targets **SESv2**, so the runtime dep is **`@aws-sdk/client-sesv2`** (`SendEmailCommand`), not `@aws-sdk/client-ses`. Downstream: the IAM action is **`ses:SendEmail`** (not `ses:SendRawEmail`); the config set is passed as the **native `ConfigurationSetName` param** (the `X-SES-CONFIGURATION-SET` MIME-header hack is no longer needed); and SESv2's `GetSuppressedDestination` is available on the same client if a pre-send suppression check is ever wanted.
> - **zod v4** (not v3): uses `z.email()` / `z.uuid()` and native `z.toJSONSchema()`, which removes the would-be `zod-to-json-schema` dep for `contracts/send.schema.json`.
> - **`tsx`** added as a dev-only runner (contract generation + the D2 dev-server).
> - **ESLint `no-explicit-any` is an error** (this plan mandates no `any`). A **moderate js-yaml advisory** remains but is a dev-only transitive of the jest/istanbul toolchain — never shipped, no clean fix, and CI does not gate on `npm audit`.

Why this balances the three goals:

- **Cheapest** — SES is pure usage (~$0.10 / 1,000 emails, no floor); Lambda + SNS + HTTP API are effectively free at this volume (HTTP API ~$1/M requests); no idle cost. `arm64` Lambdas trim both cost and cold start.
- **Safest** — proven secret management (SSM, never committed) and least-privilege IAM; **GitHub OIDC** so no long-lived AWS keys live near a public repo; **HTTP API stage throttling (rate + burst)** caps runaway sends so a leaked key or looping webhook can't torch SES spend/reputation; **mandatory bounce/complaint suppression**; signed/shared-secret endpoints; far fewer moving parts than a full Express app.
- **Cleanest** — one responsibility, minimal deps, a single typed `POST /v1/send` contract. Hono gives routing + middleware + validation without Express 5 + `@vendia/serverless-express` boilerplate; its small bundle helps cold starts (though AWS SDK v3 + `nodemailer` dominate the cold-start cost, not the router).

Notes / alternatives (not chosen): **Serverless Framework** (familiar from the backend, but v4 licensing / v3 EOL make it the weakest long-term choice for a public repo); **SST** (best DX but a whole framework + Pulumi state for a 2-resource stack); **REST API** (adds usage plans/API keys but at 3.5× HTTP API cost — overkill).

## The connection contract (how things plug in later)

A single authenticated endpoint, templated, so every future caller is a one-liner:

```
POST /v1/send
Headers: X-Api-Key: <SERVICE_API_KEY>          # constant-time compared
Body: {
  "template": "comment-notification" | "contact" | ...,
  "to":   { "email"?: string, "userId"?: uuid },  # email is the primary path;
                                                  # userId only works if a resolver adapter is configured
  "data": { ... template-specific fields ... },
  "unsubscribeGroup"?: "comments"                 # adds List-Unsubscribe pointing at the consumer app
}
```

- **`to.email`** is the canonical, always-available path — a standalone consumer just passes an address.
- **`to.userId`** is an **optional convenience** that requires a configured recipient-resolver adapter (Chardle's is Supabase service-role). If `userId` is sent but no resolver is configured → `400` with a clear code. This keeps email resolution *available* without making it *mandatory*.
- **Future comments feature** → Supabase DB webhook calls `/v1/send` with `template:"comment-notification"` and recipient `userId` (Chardle's resolver turns it into an address) — or resolves the address itself and passes `email`.
- **Existing contact form** (later migration) → `src/app/api/send-email/route.ts` swaps its Resend `fetch` for a call to `/v1/send` with `template:"contact"` and a plain `email`, keeping its rate-limit/profanity/sanitize/attachment logic.

When a resolver *is* configured, the `userId` path lets the service own address resolution so callers never handle addresses — a privacy benefit Chardle can opt into, not a requirement of the service.

## Repo structure (`mailman`, mirrors `chardle-backend` _ops_ only)

> **Note on divergence:** this service mirrors `chardle-backend`'s **operational** layer (SSM `ConfigManager`, ESLint flat + Prettier + Husky + Jest, GitHub Actions deploy story) but **intentionally differs on the code stack and IaC**: Hono (not Express), zod (not Joi), ESM (not CommonJS), `nodejs22.x` (the backend is on the now-EOL `nodejs18.x`), **SAM (not Serverless v3)**, **GitHub OIDC (not stored AWS keys)**. These are deliberate choices for a lean, public single-purpose service — don't "match the backend" by reflex on these.

```
mailman/
  template.yaml               # SAM: HttpApi (throttled) + SendFunction + SesEventsFunction + SNS topic, nodejs22.x/arm64, us-east-1
  contracts/send.schema.json  # generated JSON example of the /v1/send body — the caller-facing contract (asserted in tests)
  package.json  tsconfig.json  eslint.config.mjs  jest.config.js  .prettierrc
  .github/workflows/deploy.yml   # GitHub Actions + OIDC assume-role; typecheck→lint→test gate, sam build && sam deploy
  config/{development,production}.env.example
  src/
    handler.ts               # Hono app + aws-lambda adapter (replaces Express index.ts + lambda.ts)
    config/index.ts          # ConfigManager singleton, SSM under /mailman/*  (generic namespace, copy backend pattern)
    routes/send.ts           # POST /v1/send  (the ONLY HTTP endpoint)
    handlers/ses-events.ts   # SNS→Lambda bounce/complaint handler (NOT an HTTP route)
    middleware/auth.ts       # apiKeyAuth (timingSafeEqual) for /v1/send
    middleware/error.ts      # CustomError + handler (port backend's errorHandler shape)
    lib/ses.ts               # nodemailer SES transport + send(rawMime)  — the only required send path
    lib/suppression.ts       # Suppression port: { isSuppressed, suppress }. Default impl = send-and-catch SES MessageRejected (no DB, no pre-send lookup)
    lib/resolver.ts          # optional RecipientResolver port: resolve(userId) -> email | null
    adapters/supabase.ts     # OPTIONAL Chardle adapter: implements resolver (getUserById) + DB suppression store
    templates/index.ts       # template registry: render(name, data) -> {subject, html, text}
    templates/chardle/*.ts   # app-specific templates (comment-notification, contact) — consumer-owned, swappable
    lib/unsubscribe-token.ts # HMAC SIGN only (verification lives in the consumer app, shared secret)
    lib/headers.ts           # escapeHtml + sanitizeEmailHeader (port from send-email/route.ts)
  tests/                     # ts-jest unit tests
  README.md                  # SES setup checklist + connect instructions
```

**Dependencies (core, required):** `hono` (the `hono/aws-lambda` adapter ships inside the `hono` package — **not** a separate dep; it accepts both API Gateway HTTP API and Function URL events, so the handler is routing-agnostic; `@hono/node-server` is only needed for a standalone Node server, which we don't use under Lambda + `sam local`), `nodemailer` (**8.x**), `@aws-sdk/client-sesv2` (Nodemailer 8's SES transport targets **SESv2** / `SendEmailCommand`), `@aws-sdk/client-ssm`, `zod` (**v4**, validation + native JSON-schema export). **Optional (Chardle adapter only):** `@supabase/supabase-js` — pulled in by `adapters/supabase.ts`; a deployment that only uses `to.email` and SES-native suppression doesn't need it. Dev: `@types/nodemailer`, `@types/aws-lambda`, `jest`, `ts-jest`, `dotenv` (local `.env` loading only — **not** a runtime dep; Lambda config comes from SSM), `aws-sam-cli` (or via the GitHub Action), ESLint/Prettier.

> **Build/packaging decision (resolved):** use **`sam build` with esbuild** (`Metadata.BuildMethod: esbuild`, `Format: esm`, `Target: es2022`) — it bundles each function, which **normalizes the ESM ↔ CommonJS-`nodemailer` interop** (default-import interop, `__dirname` absence) that plain `tsc` → `dist/**` leaves sharp on `nodejs22.x`. This drops the backend's bundler-less `tsc` approach on purpose. Still add a smoke `import` test of `lib/ses.ts` in CI so any interop break fails fast instead of at first invocation.

> Use **Nodemailer's SES transport** (not raw `SendEmailCommand`) because we need raw MIME to set `List-Unsubscribe` / `List-Unsubscribe-Post` headers and clean multipart text+html — this also solves attachment MIME for the later contact-form migration.

## Endpoints & event handlers

1. **`POST /v1/send`** (`apiKeyAuth`)
   - Validate body with zod (`template` enum, `to.email` xor `to.userId`, `data`).
   - Resolve email: if `to.email` present, use it directly. If only `to.userId`, call the **configured `RecipientResolver`**; if none is configured → `400` (`userId` resolution unavailable). Chardle's resolver = `adapters/supabase.ts` (`getUserById`, service role).
   - **Suppression check** → ask the **`Suppression` port** `isSuppressed(email)`; if suppressed, `200` no-op (do not send). **The default port does NOT pre-query SES** — although `@aws-sdk/client-sesv2` (now used by Nodemailer 8) *does* expose `GetSuppressedDestination`, calling it would cost a round-trip per send. Instead the default `isSuppressed` returns `false` and the send path **catches SES `MessageRejected` (suppressed destination) → `200` no-op**; account-level SES suppression is the actual enforcement. Chardle's adapter *does* pre-check its `email_suppressions` table (cheap, app-visible) before sending.
   - (Optional, wired when comments ship) recipient preference check by `unsubscribeGroup`.
   - **Rate/abuse guard:** the endpoint is a single shared API key in a public repo, fronting usage-priced SES — a leaked key or a looping webhook is a direct cost + reputation hit. The **HTTP API stage throttle (rate + burst, in `template.yaml`)** is the zero-code first line; consider a coarse per-template/per-caller cap in the handler if a finer limit is needed. Also handle SES `Throttling`/max-send-rate errors (Lambda concurrency can outrun the SES send quota) with retry/backoff or a 5xx.
   - Render template (`templates/index.ts` `render(name, data)`); `escapeHtml` body, `sanitizeEmailHeader` subject (port from `send-email/route.ts`).
   - If `unsubscribeGroup` set: add `List-Unsubscribe: <https://<app-base-url>/unsubscribe?token=...>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the service **signs** the token (`unsubscribe-token.ts`) but the URL points at the **frontend/Supabase**, which verifies the token and records the opt-out (the service hosts no unsubscribe endpoint). The signed token (not a session) is what makes RFC 8058 one-click work, since mail providers POST it with no logged-in user. **Only include a `mailto:` variant if a real inbox actually processes unsubscribe emails**; default to HTTPS-one-click only.
   - **Configuration set:** if SES feedback is wired via a configuration-set event destination (see SES setup), `lib/ses.ts` passes the config set as the **native SESv2 `ConfigurationSetName` param** (via the Nodemailer `ses` mail option) so the message goes through the config set and Bounce/Complaint SNS events fire. *(SESv1 required injecting an `X-SES-CONFIGURATION-SET` MIME header; SESv2 makes that unnecessary.)* (Not required at all if feedback is wired via identity-level notifications instead — see the SES setup note.)
   - Send via `lib/ses.ts`. On permanent SES failure → log + 200 (avoid caller retry storms); 5xx only for transient infra.
   - **Idempotency (be honest about scope):** suppression makes repeats to *suppressed* addresses no-ops, but a retry to a *valid* address sends twice — the happy path is **not** idempotent today. The honest v1 stance: **document that retries can double-send** and treat `/v1/send` as at-least-once. If/when you add an `Idempotency-Key` header, the short-TTL dedupe needs a store — **a DynamoDB table with a TTL attribute** is the Lambda-native fit (≈free at this volume, no Supabase dependency in the core); name it explicitly in `template.yaml` at that point. Don't claim retry-safety until that table exists.

2. **SNS → Lambda bounce/complaint handler** (direct subscription, **not** an HTTPS endpoint)
   - Subscribe the bounce/complaint Lambda **directly to the SNS topic** (SNS → Lambda). AWS authenticates the invocation, so there is **no message-signature verification, no `SigningCertURL` validation, and no `SubscriptionConfirmation` handshake** to implement — all of which would otherwise be security-sensitive code on a public internet-facing endpoint. This is strictly safer and less code than an HTTPS subscription.
   - The handler stays pure/unit-testable: parse the SNS event → on `Bounce` (Permanent) / `Complaint` → call `Suppression.suppress(address, reason)` on the configured port; ignore transient/`Delivery` events. With the default port `suppress` is a no-op write (SES already auto-suppressed the address account-level, which is what the send-and-catch path relies on); Chardle's adapter upserts the app-level table for visibility.
   - **SES native suppression (see Supabase touchpoint):** with account/configuration-set suppression enabled, SES already auto-suppresses permanent bounces and complaints. This Lambda + custom table exist for app-level visibility and the 200-no-op behavior — not as the only safety net. For a minimal v1 you may enable SES suppression and defer this Lambda entirely.

> **Unsubscribe is NOT hosted by this service** — handling (token verification, opt-out recording, confirmation page) lives in the **frontend/Supabase**. The service only *signs* the tokenized `List-Unsubscribe` URL (above) using a secret it shares with the frontend. Implication: the frontend must implement an endpoint that accepts **both** `GET` (human click → confirmation page) and `POST` (RFC 8058 one-click, no session) at the `app-base-url/unsubscribe` path, verify the HMAC with the shared secret, and record the opt-out. This contract (token format + shared secret) is the seam to keep in sync — document it in the README so the frontend work is a thin follow-on.

## Supabase touchpoint (OPTIONAL Chardle adapter — not core)

> **This entire section is the Chardle adapter, not part of the standalone core.** The service runs without any of it when callers pass `to.email` and rely on SES-native suppression. Everything below is wired only because *Chardle* opts into `userId` resolution and an app-level suppression table.

When the Supabase adapter is enabled, it needs the Supabase **service-role key** (for `getUserById` email resolution), reusing the `chardle-backend` SSM pattern.

> **Confirm before coding:** the recipient-resolution path assumes emails live in `auth.users` and are reachable via `supabase.auth.admin.getUserById()`. Verify Chardle doesn't store a different/preferred contact email on a `profiles` row — if it can, the resolver must check `profiles` too. One-line check before implementing the resolver.

> **SES native suppression vs. the custom table:** SES has an account-level / configuration-set suppression list that auto-adds permanent bounces + complaints and auto-refuses sends to them, for free, with zero pipeline. The `email_suppressions` table below duplicates part of that on purpose — for queryable app-level visibility and the 200-no-op behavior — but SES native suppression should be **enabled as the reputation safety net** regardless. A minimal v1 could rely on SES native suppression alone and add this table later.

Add via Supabase MCP `apply_migration`:

```sql
create table public.email_suppressions (
  email text primary key,
  reason text not null,                 -- 'bounce' | 'complaint' | 'manual'
  created_at timestamptz not null default now()
);
alter table public.email_suppressions enable row level security;  -- service role only; no anon policies
```

`profiles.email_on_comments` (default `true`) and the comment-notification recipient-resolution RPC are **deferred to the comments feature** — the service supports an optional preference check but the column/RPC are created when that feature is built. Update `docs/database-reference.md` for the new table.

## Config & secrets (SSM `/mailman/<stage>/*` — generic namespace, not app-bound)

**Core (always required):** `service-api-key`, `ses-from-address` (e.g. `Chardle <notify@mail.chardle.com>` — the value is consumer-specific but the key is generic), `unsubscribe-hmac-secret` (**shared with the consumer app**, which verifies unsubscribe tokens), `app-base-url` (the consumer origin the `List-Unsubscribe` link points at).

**Adapter (only if the Supabase resolver/suppression adapter is enabled):** `supabase-url`, `supabase-service-role-key`. A deployment using `to.email` + SES-native suppression sets none of these, and the service must boot fine without them (fail fast only if `userId` resolution is *requested* without a resolver, per the send flow).

> Use `/mailman/*` (not `/chardle/notify/*`) so the namespace reflects the service, not its first consumer — a second consumer deploys its own stage without a Chardle-shaped path. Local dev via `.env` (gitignored) mirroring `config/development.env.example`. **No secrets committed** — note the repo is public.

> **No `cors-origins`** (dropped from the backend's copied config): `/v1/send` is server-to-server with `X-Api-Key` (no browser → no CORS), and `GET /unsubscribe` is a top-level navigation (also no CORS). Don't carry CORS config over from the backend by reflex; add it back only if a concrete browser caller appears.

## SES one-time setup (document in README)

1. Verify sending domain **`mail.chardle.com`** in SES (us-east-1); add the 3 **DKIM** CNAMEs to DNS.
2. **Custom MAIL FROM** — use a **dedicated subdomain distinct from the identity** (AWS-recommended), e.g. MAIL FROM = `bounce.mail.chardle.com`. It needs **both** DNS records or verification never completes (SES silently falls back to `amazonses.com`, breaking DMARC alignment):
   - **MX**: `bounce.mail.chardle.com MX 10 feedback-smtp.us-east-1.amazonses.com`
   - **SPF**: `bounce.mail.chardle.com TXT "v=spf1 include:amazonses.com -all"`
3. **DMARC**: `_dmarc.chardle.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@chardle.com"` (start at `p=none`). The `dmarc@chardle.com` mailbox must actually exist to receive aggregate reports.
4. **Request production access** (sandbox exit) — transactional notifications with unsubscribe + suppression. Until granted, only verified test recipients receive mail.
5. **Pick ONE feedback mechanism — don't mix them** (the two are independent and the choice changes the send code):
   - **(a) Identity-level notifications** — set the SES *identity's* Bounce/Complaint notification topic directly to SNS. Fires on every send regardless of config set; **no `X-SES-CONFIGURATION-SET` header needed**. Simplest; recommended.
   - **(b) Configuration-set event destination** — events fire **only if each message is sent through the config set**, which with Nodemailer 8 / SESv2 means `lib/ses.ts` sets the **`ConfigurationSetName` param** on every send. More moving parts; choose only if you want per-config-set metrics.
   Either way, **enable account-level suppression for bounces + complaints** (this is independent of config sets and is the reputation safety net — SES auto-suppresses bad addresses for free).
6. **SNS topic** `mailman-ses-events`; route Bounce + Complaint to it via the mechanism chosen in step 5; subscribe the **bounce/complaint Lambda directly** to the topic (SNS → Lambda — **no HTTPS endpoint, no subscription-confirmation handshake**). Optional for a minimal v1 if relying on account-level suppression alone.
7. **IAM in `template.yaml`**: allow **`ses:SendEmail`** (SESv2 `SendEmailCommand`; *not* the SESv1 `ses:SendRawEmail`) + `ssm:GetParameters`/`ssm:GetParametersByPath` on **`/mailman/*`** (matching the config namespace below — **not** a `/chardle/*` path). The SNS → Lambda subscription needs **no `sns:ConfirmSubscription`** (AWS handles invocation auth). Least privilege.

## Testing strategy

Philosophy (matches Chardle's `CLAUDE.md`: _tests cover logic, not UI rendering_): test pure functions and decision logic exhaustively, mock all I/O (SES, SNS, Supabase, SSM), and keep one thin end-to-end path that proves real delivery. No live network in unit tests — deterministic and fast.

**Test pyramid**

1. **Unit (the bulk — `tests/unit/`, ts-jest)** — pure logic, no network:
   - `unsubscribe-token.ts` (service **signs**; tests verify to prove correctness even though prod verification lives in the frontend): sign→verify round-trip; tampered token rejected; wrong-secret rejected; garbage input rejected; constant-time compare used. **No expiry (or a very long one) on unsubscribe tokens** — links live in emails forever and one-click POSTs can arrive months later; an expired-token-rejected test would encode the *wrong* policy here, so assert old tokens still verify.
   - `templates.ts`: each template renders non-empty `subject`/`html`/`text`; subject has no CR/LF; `List-Unsubscribe` headers present iff `unsubscribeGroup` set; user data is HTML-escaped (XSS fixture: `"><script>` stays inert); deep links well-formed.
   - `headers.ts`: `escapeHtml` / `sanitizeEmailHeader` parity with the originals in `send-email/route.ts` (port the existing tests as a baseline).
   - Validation: zod schema rejects `to.userId` **and** `to.email` together, missing `template`, oversized/empty `data`; accepts the happy shapes.
   - **Decision logic for `/v1/send`** (the highest-value tests): suppression-hit → no-op; preference-off → no-op; happy path → exactly one SES call with expected args. Inject the SES/suppression/resolver **ports** as mocked collaborators so these assert behavior, not transport. (**Self-recipient suppression** — "don't notify the commenter about their own comment" — is a Chardle *product* rule, not a core concern; it belongs in the caller or the comments-feature wiring, not in the generic send path. Don't bake it into core decision logic.)
   - **Standalone mode (proves the decoupling holds):** with **no resolver and no Supabase adapter configured**, `to.email` sends normally and `to.userId` returns `400`; default suppression port consults SES-native only and never touches a DB. A regression here means a Chardle dependency leaked into the core.
   - `ses-events.ts` (SNS→Lambda handler): `Bounce`(Permanent)/`Complaint` upserts suppression; transient/`Delivery` events ignored; malformed event payload handled gracefully. (No signature-verification or subscription-confirmation tests needed — direct SNS→Lambda removes that surface.)
   - `auth.ts`: missing/wrong API key → 401; correct key → pass; verify `timingSafeEqual` (equal-length compare, no early return).

2. **Integration (`tests/integration/`)** — wiring with mocked AWS/Supabase via the SDK client mocks (`aws-sdk-client-mock`) and a Supabase stub:
   - Full `/v1/send` request→response through the real Hono router (not the handler in isolation): asserts status codes, JSON shape, and that a suppressed/no-op send still returns 200.
   - SNS→suppression→subsequent-send-skipped flow end to end against the mocks.

3. **Contract** — the `/v1/send` request schema is the integration seam with the future comments feature and contact form. Export the zod schema + a generated JSON example from the repo (`contracts/send.schema.json`) and assert it in a test, so changes that would break callers fail CI. The web app references the same example when it wires up later.

4. **Manual / live (documented in README, run before prod cutover, not in CI):**
   - **Local e2e:** `sam local start-api` → `POST /v1/send` (API key, `template:"comment-notification"`) to a **verified SES sandbox address** → confirm a delivered email, correct rendering, and a well-formed `List-Unsubscribe` URL whose signed token verifies with the shared secret. (Actual opt-out recording is exercised against the frontend/Supabase when that ships — out of scope here.)
   - **Bounce/complaint:** send to `bounce@simulator.amazonses.com` and `complaint@simulator.amazonses.com` → confirm the SNS→Lambda handler fires and `email_suppressions` rows appear (and SES native suppression also records them) → a re-send to those addresses is a 200 no-op.
   - **Deliverability:** send to a real inbox; check it lands in Primary (not spam) and that SPF/DKIM/DMARC pass (Gmail "show original" / mail-tester.com).

**Coverage & gates**

- Target **≥ 90% on `src/lib/**`** (the pure logic); routes/handlers covered via integration. Configure `collectCoverageFrom`to exclude`handler.ts`/config bootstrap (mirrors backend `jest.config.js`).
- **CI (`.github/workflows/deploy.yml`):** authenticate to AWS via **GitHub OIDC `sts:AssumeRole`** (trust policy scoped to `repo:<org>/mailman:ref:refs/heads/main`) — **no stored `AWS_ACCESS_KEY_ID`** in a public repo. PR runs `typecheck → lint → test` and **blocks deploy on failure**; `deploy:dev` on PR, `deploy:prod` (`sam build && sam deploy`) on merge to `main` only after green. Husky `pre-commit` runs `lint-staged` (eslint --fix + prettier) so style never reaches CI.
- Fixtures live in `tests/fixtures/` (sample SNS bounce/complaint envelopes, a Supabase webhook body, valid/invalid `/v1/send` payloads) — reused across unit + integration.

## Clean code & conventions

- **TypeScript strict everywhere** — reuse `chardle-backend`'s strict `tsconfig` flags (`strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`). No `any`; model inputs/outputs as explicit types. **Zod schemas are the single source of truth** for request shapes (`z.infer` the TS types — don't hand-maintain both).
- **Pure core, thin edges** — all logic (token, templates, decision rules, header sanitizing) lives in `src/lib/**` as **small, pure, individually testable functions** with no framework or AWS imports. Routes (`src/routes/**`) only parse → validate → call lib → format response. AWS/Supabase SDK calls are isolated behind narrow **ports** (`lib/suppression.ts`, `lib/resolver.ts`) with the AWS send in `lib/ses.ts` and Chardle's Supabase implementation in `adapters/supabase.ts`, so they mock cleanly, the core has no `@supabase/*` import, and a consumer swap touches one adapter file.
- **Consistent results & errors** — port the backend's `CustomError` + central error handler so every failure returns the same JSON shape with a code; never leak internal/SES errors or stack traces to clients. Success/skip both return 200 with a clear body. Use a real logger (no stray `console.log`; CloudWatch in prod), and **never log secrets, tokens, or full email addresses** (mask).
- **Idempotency & safety by design** — repeats to *suppressed* addresses are no-ops, but a retry to a valid address sends twice until an `Idempotency-Key`/debounce exists, so `/v1/send` is **not** fully idempotent yet — treat as at-least-once and document it (see `/v1/send` notes). Permanent SES failures return 200 to avoid caller retry storms. **Constant-time compares for API key and HMAC — but note `crypto.timingSafeEqual` *throws* on unequal-length buffers**, which both leaks length and crashes the wrong-key path; the implementation must hash/HMAC both sides to a fixed length **first**, then `timingSafeEqual` the digests (never pass raw user input straight in). All user-supplied text escaped before HTML; all header fields CR/LF-stripped.
- **Minimal dependencies** — every dep justified (Hono, Nodemailer, AWS SDK v3 clients, zod, supabase-js). No kitchen-sink utility libs; prefer the stdlib `crypto` for HMAC/timing-safe compare.
- **Naming & size** — named exports, descriptive intent-revealing names, one responsibility per file, keep files small. Match the backend's ESLint flat config + Prettier (`.prettierrc`) exactly so the two repos read identically.
- **Self-documenting + README** — JSDoc on each public `lib` function; the README documents the `/v1/send` contract, env/SSM keys, the SES setup checklist, and a one-paragraph "how to connect a new caller." No dead code or speculative "future" abstractions — build exactly **one** HTTP endpoint (`/v1/send`) plus the one SNS→Lambda bounce/complaint handler (unsubscribe handling lives in the frontend/Supabase; the service only signs the link).
- **Config discipline** — all config through the `ConfigManager` singleton (SSM in prod, `.env` in dev); no `process.env` reads scattered through code; fail fast on missing required config at startup.

## Risks & edge cases

- **Public repo** → zero secrets in code; all via SSM/.env; document key rotation. Flag: rotate the historically-exposed `RESEND_API_KEY` separately (tracked in memory) — unrelated to this service but worth doing at cutover.
- **Sandbox** → sends silently fail to unverified addresses until production access is granted; don't schedule launch before approval.
- **No live traffic yet** → until the comments feature ships there's no production sender; that's expected (foundation-first). Keep an admin-keyed manual `/v1/send` for smoke tests.
- **Email header injection / XSS** → reuse `escapeHtml` + `sanitizeEmailHeader` from `send-email/route.ts`.
- **HMAC secret rotation** invalidates in-flight unsubscribe links and must be coordinated with the frontend/Supabase (which verifies with the same shared `unsubscribe-hmac-secret`) — rotate both sides together; acceptable but document the coupling.
- **Send-cost abuse / runaway sends** → a leaked API key or looping caller spends real SES money and damages reputation. Mitigated by HTTP API throttling + suppression, but the API key is the crown jewel: store it in SSM only, rotate on suspicion, and watch SES send-rate/bounce CloudWatch alarms.
- **IaC choice for a public repo** → **SAM** chosen to avoid Serverless v4's paid-license/phone-home terms and v3's EOL. CDK is the documented scale-up path; see `deployment-options.md`.

## Out of scope (future, connects to this service)

- `custom_show_comments` table, RLS, `comment_count` trigger, one-level-reply enforcement.
- Web app comments UI + moderated `/api/comments` route.
- Supabase DB webhook on comment insert → `/v1/send`.
- `profiles.email_on_comments` toggle + preference UI + recipient-resolution RPC.
- Contact-form migration off Resend → `/v1/send` (`template:"contact"`), then remove `RESEND_API_KEY`.
