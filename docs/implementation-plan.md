# Implementation Roadmap: `mailman`

Breaks `plan.md` into dependency-ordered, independently-testable parts. Each part has a
**Done when** gate that is green/CI-checkable before the next part starts. Parts within a
track marked _(parallel)_ have no dependency on each other.

> **Note vs. plan.md:** `escapeHtml` / `sanitizeEmailHeader` are described in the plan as
> "ported from `send-email/route.ts`". The real existing sender (`chardle/frontend/api/send-email.js`)
> has **neither** helper (it interpolates user input directly into HTML) and uses **Zoho SMTP, not
> Resend**. Treat these as **new** code with fresh tests, not a port.

---

## When can I test locally?

Three tiers, unlocking at different points:

1. **Automated tests (`npm test`)** — from **A0** onward, growing every part. Pure functions +
   decision logic, all I/O mocked, no AWS/network/credentials. The primary local feedback loop and
   ~80% of verification.
2. **Curl the live `/v1/send` (request→response)** — at **D2**, via the dev-only `@hono/node-server`
   entry (`npm run dev`). SES mocked, or real if `.env` has creds. This is *before* SAM exists;
   `sam local start-api` is the production-faithful equivalent and arrives at **F1**.
3. **A real email lands in an inbox** — needs `lib/ses.ts` (**C2**) **and** SES sandbox set up
   (verified domain, DKIM in DNS, creds in `.env`, a verified recipient). Provable at C2 with a
   throwaway script; full endpoint→inbox e2e at **D2 + SES setup**.

> **Start SES verification early (during Track B/C), not at F3.** DKIM / MAIL-FROM / DMARC DNS
> records propagate slowly and the sandbox→production access request needs AWS approval (can take a
> day+). Nothing in tiers 1–2 depends on it, but tier 3 is gated on it — kick off the DNS +
> verification paperwork while the pure-core code is being written so it's ready when the send path is.

---

## Track A — Foundation (must come first)

### A0 — Scaffolding & tooling
- **Scope:** `package.json` (`"type": "module"`, ESM), `tsconfig.json` (mirror backend strict
  flags: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`;
  but `module`/`moduleResolution` → `NodeNext`, `target` `es2022`), `eslint.config.mjs` +
  `.prettierrc` (copy backend), `jest.config.js` (ts-jest **ESM** preset), Husky + lint-staged,
  folder skeleton from plan, `.gitignore` (`.env`, `dist`, `.aws-sam`).
- **Deps installed:** `hono`, `nodemailer`, `@aws-sdk/client-ses`, `@aws-sdk/client-ssm`, `zod`;
  dev: `@types/nodemailer`, `@types/aws-lambda`, `jest`, `ts-jest`, `aws-sdk-client-mock`, `dotenv`.
- **Tests:** one trivial passing spec.
- **Done when:** `npm run typecheck && npm run lint && npm test` all green on an otherwise empty repo.

---

## Track B — Pure core (no AWS, no framework) — _all parallel after A0_

### B1 — Crypto & header primitives _(parallel)_
- **Files:** `lib/crypto.ts` (hash-then-`timingSafeEqual` constant-time compare — **must** fixed-length
  both sides first, never pass raw input to `timingSafeEqual`), `lib/headers.ts` (`escapeHtml`,
  `sanitizeEmailHeader` — written fresh).
- **Tests:** equal/unequal compare without throwing or leaking length; `escapeHtml` neutralizes
  `"><script>`; `sanitizeEmailHeader` strips CR/LF.
- **Done when:** ≥90% coverage on both files.

### B2 — Unsubscribe token _(parallel)_
- **File:** `lib/unsubscribe-token.ts` — HMAC **sign** (+ a `verify` used by tests; prod verify lives
  in frontend). Uses B1 constant-time compare.
- **Tests:** sign→verify round-trip; tampered/wrong-secret/garbage rejected; **no expiry** — assert a
  months-old token still verifies (encodes the right policy).
- **Done when:** ≥90% coverage; explicit "old token still valid" test present.

### B3 — Request schema & contract _(parallel)_
- **Files:** `routes/send.schema.ts` (zod: `template` enum, `to.email` **xor** `to.userId`, `data`,
  optional `unsubscribeGroup`; `z.infer` the TS type — single source of truth),
  `contracts/send.schema.json` (generated example).
- **Tests:** rejects email+userId together, missing template, empty/oversized data; accepts happy
  shapes; **contract test** asserts `send.schema.json` validates against the zod schema (fails CI on drift).
- **Done when:** schema + contract test green.

### B4 — Templates _(depends on B1, B2, B3)_
- **Files:** `templates/index.ts` (`render(name, data) → {subject, html, text}`),
  `templates/chardle/comment-notification.ts`, `templates/chardle/contact.ts`. Per-template zod data schemas.
- **Tests:** each template non-empty subject/html/text; subject has no CR/LF; user data HTML-escaped
  (XSS fixture inert); `List-Unsubscribe` headers present **iff** `unsubscribeGroup` set; deep links well-formed.
- **Done when:** ≥90% coverage on templates.

---

## Track C — Edges & ports

### C1 — Config & error plumbing _(depends on A0)_
- **Files:** `config/index.ts` (ConfigManager singleton, SSM `/mailman/<stage>/*`, zod-validated,
  fail-fast on missing **core** keys; **adapter** keys optional → boots without Supabase),
  `config/environments.ts`, `middleware/error.ts` (`CustomError` + Hono error handler, never leaks
  SES/stack to client).
- **Tests:** missing required core key → throws; adapter keys absent → boots fine; error handler maps
  `CustomError` → standard JSON shape, hides internals when `NODE_ENV=production`.
- **Done when:** config + error tests green; standalone-boot (no Supabase env) proven.

### C2 — SES transport & ports _(depends on A0; uses B-types)_
- **Files:** `lib/ses.ts` (nodemailer SES transport over `@aws-sdk/client-ses`, `send(rawMime)`,
  injects `List-Unsubscribe`/`-Post` + optional `X-SES-CONFIGURATION-SET`), `lib/suppression.ts`
  (port + **default impl**: `isSuppressed`→`false`, send path catches SES `MessageRejected`;
  `suppress`→no-op), `lib/resolver.ts` (`RecipientResolver` port; default = none).
- **Tests:** `ses.ts` builds correct multipart MIME + headers with mocked transport
  (`aws-sdk-client-mock`); default suppression never touches a DB; **CI smoke `import` of `lib/ses.ts`**
  (ESM/CJS interop guard).
- **Done when:** transport tests + interop smoke green.

---

## Track D — HTTP & events (the service)

### D1 — Auth middleware _(depends on B1, C1)_
- **File:** `middleware/auth.ts` — `apiKeyAuth` via B1 hashed `timingSafeEqual`.
- **Tests:** missing/wrong key → 401; correct → pass; equal-length digest compare verified.
- **Done when:** auth tests green.

### D2 — `/v1/send` route + handler _(depends on B3, B4, C1, C2, D1)_
- **Files:** `routes/send.ts` (validate → resolve [email direct | resolver | else **400**] →
  suppression check [200 no-op] → render → headers → send → SES error mapping: permanent→log+200,
  transient→5xx, throttling→backoff/5xx), `handler.ts` (Hono app + `hono/aws-lambda` adapter; excluded
  from coverage), `src/dev-server.ts` (**dev-only** `@hono/node-server` entry + `npm run dev`; not
  bundled into the Lambda — exists purely so the endpoint can be curled before SAM).
- **Tests (highest value, ports injected as mocks):** suppression-hit → no-op 200; happy path → exactly
  one SES call with expected args; **standalone mode** → no resolver: `userId`→400, `email`→sends.
- **Local check:** `npm run dev` → `curl -X POST localhost:3000/v1/send -H 'X-Api-Key: …'` returns
  JSON (SES mocked, or real if `.env` has AWS creds + a verified SES sandbox recipient).
- **Done when:** decision-logic suite green; standalone-mode regression test present; `npm run dev`
  serves `/v1/send`.

### D3 — SNS→Lambda bounce/complaint handler _(depends on C2)_
- **File:** `handlers/ses-events.ts` — parse SNS event → `Bounce`(Permanent)/`Complaint` →
  `Suppression.suppress`; ignore transient/`Delivery`; malformed handled. No signature/subscription
  code (direct SNS→Lambda).
- **Tests:** fixture SNS envelopes for bounce/complaint/delivery/malformed.
- **Done when:** handler suite green.

### D4 — Integration tests _(depends on D2, D3)_
- **Scope:** full Hono router request→response via `aws-sdk-client-mock` + Supabase stub; assert status
  codes, JSON shape, suppressed→200. SNS→suppress→subsequent-send-skipped end to end.
- **Done when:** `tests/integration` green; coverage gate (≥90% `src/lib/**`) met.

---

## Track E — Optional Chardle adapter (decoupled; can slip after ship)

### E1 — Supabase adapter
- **Confirm-before-coding gate:** verify whether Chardle stores a preferred email on a `profiles` row
  vs. only `auth.users` — one-line check before writing the resolver.
- **Files:** `adapters/supabase.ts` (resolver `getUserById` + DB suppression pre-check/upsert),
  `email_suppressions` migration (via Supabase MCP `apply_migration`).
- **Tests:** resolver returns email/null; adapter `isSuppressed` pre-checks table; `suppress` upserts.
- **Done when:** adapter suite green **and** Track D still passes with adapter unconfigured.

---

## Track F — Ship

### F1 — SAM template _(depends on D2, D3)_
- **File:** `template.yaml` — HttpApi (rate+burst throttle) + SendFunction + SesEventsFunction + SNS
  topic; `nodejs22.x`/`arm64`; esbuild (`Format: esm`, `Target: es2022`); IAM least-priv:
  `ses:SendRawEmail`, `ssm:GetParameters*` on `/mailman/*`.
- **Done when:** `sam validate` + `sam build` succeed; `sam local start-api` serves `/v1/send`.

### F2 — CI/CD (GitHub OIDC) _(depends on F1, all test tracks)_
- **File:** `.github/workflows/deploy.yml` — OIDC `sts:AssumeRole` (no stored keys), gate
  `typecheck → lint → test`, `deploy:dev` on PR, `deploy:prod` on merge to `main`.
- **Done when:** PR pipeline blocks on red; merge deploys.

### F3 — Docs & manual live e2e _(depends on F1)_
- **Files:** `README.md` (`/v1/send` contract, SSM keys, **SES one-time setup checklist**,
  connect-a-caller, unsubscribe shared-secret contract).
- **Manual runbook (not CI):** sandbox send to verified address → check render + `List-Unsubscribe`;
  `bounce@`/`complaint@simulator.amazonses.com` → suppression rows + 200 no-op re-send; deliverability
  (SPF/DKIM/DMARC pass).
- **Done when:** README complete; live sandbox send + bounce-simulator pass recorded.

---

## Suggested execution order

```
A0
 ├─ B1, B2, B3  (parallel) → B4
 ├─ C1
 └─ C2
        ↓
D1 → D2 ┐
D3 ─────┴→ D4
        ↓
F1 → F2 / F3        E1 (any time after C2; keep D green without it)
```

**Minimal shippable v1** (defer E1 + D3 if relying on SES account-level suppression):
A0 → B1/B2/B3/B4 → C1/C2 → D1/D2 → F1/F2/F3.
