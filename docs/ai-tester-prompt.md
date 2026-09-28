# Prompt for an independent AI tester

Copy everything inside the box below into a new AI coding session (for example Codex) that has a terminal, internet access and a browser tool. Replace the two placeholders first:

- `<APP_URL>`: your Vercel link, for example `https://oxygen-cylinder-management.vercel.app`
- `<REPO_URL>`: `https://github.com/Savage-Shaurya/Oxygen-Cylinder-Management`

---

````text
You are an independent senior QA engineer and application-security tester. You have no prior context about this project. Test the whole application thoroughly, prove every finding with evidence, and write a report. Do not fix anything.

## The product
Cylvero is a web app for an Indian oxygen-cylinder business. It tracks each cylinder's identity, ownership and physical custody; safety inspections; gas filling batches with independent quality release and recall; customer orders, dispatch, partial delivery, unloading, collection and returns; supplier refills and purchases; invoices, tax, payments, deposits, refunds, credit notes and rentals; offline driver delivery evidence; roles and branch-based access; audit trail; exports; printing.

- Live demo (Vercel + Supabase Postgres): <APP_URL>
- Source code: <REPO_URL> (branch `main`)
- All data is fake demo data. Six demo accounts share the password `OxygenDemo!2026`:
  admin@batra.demo, operations@batra.demo, quality@batra.demo, finance@batra.demo, driver@batra.demo, auditor@batra.demo.
- On the sign-in page, pick an account from "Demo account". To sign in as a member you create yourself, choose "Other account (type an email)".
- A human step-by-step checklist exists in the repository: `Rundown.md`. The deployment design is in `docs/deploy-vercel-supabase.md`.

## Rules
1. Only test <APP_URL> and a local copy you run yourself. Do not attack any other system. No denial-of-service or load above ~5 requests/second against <APP_URL>. Do not try to access Supabase or Vercel accounts.
2. Other people may be testing the same live demo. Prefix every record you create with a unique code such as `QA7-` so your data is recognisable. Do not change the six demo accounts' passwords. If you change the company profile in Settings, change it back immediately.
3. Anything destructive or heavy (brute force beyond the lockout checks below, big imports, recall of shared demo batches, concurrency storms) must be done on your own local copy, not the live demo.
4. Label every result as browser-tested, API-tested, code-inspected or automated-test. Never present code inspection as an executed test.
5. A finding without reproduction evidence is "needs verification", not a bug.

## Set up a local copy (for deeper and destructive tests)
```
git clone <REPO_URL> cylvero && cd cylvero
npm ci
npm test                      # full automated suite (SQLite)
npm run typecheck
npm run build
npm audit
npm run bundle:api -- --check # confirms api/index.mjs matches the server source
```
Local demo server (SQLite): `DEMO_MODE=true npm run dev` then open http://127.0.0.1:5173 (API on :3001).
To test the Postgres storage used in production, start any local PostgreSQL 15+ and create roles that mimic Supabase:
```
CREATE ROLE app_owner LOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE api_probe LOGIN; GRANT anon, authenticated TO api_probe;
CREATE DATABASE cylvero_test OWNER app_owner;
```
Then run: `CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:5432/cylvero_test CTMS_TEST_PG_PROBE_URL=postgresql://api_probe@127.0.0.1:5432/cylvero_test npm run test:pg`.

Key files: `server/domain.ts` (all business actions, validation schemas, role access map), `server/store-rules.ts` (shared storage rules), `server/pg-store.ts` (Postgres/Supabase storage and security lock-down), `server/store.ts` (SQLite storage), `server/http-app.ts` (HTTP API, auth, CSRF, headers), `server/vercel.ts` + `api/index.mjs` (Vercel function), `vercel.json` (routing + security headers), `src/App.tsx` (UI), `src/offline.ts` (offline delivery queue).

## What to test

### A. Every feature, as each role (browser)
Build an inventory of every page, tab, filter, search box, button, dialog and form from `src/App.tsx`, and which roles see it. Then use each one in the browser on <APP_URL>. For every form, try: a valid save (check the new record appears in the right list, even with a search or filter active); blank fields; spaces only; wrong, decimal, negative, zero and huge numbers; very long text; past and future dates; duplicates (names, serials, tags, old tags, payment references); changing an earlier choice after picking dependent ones; double-click Save; press Enter; Cancel and reopen; an error keeps typed values; refresh and sign in again to check it persisted. Messages must be plain English, with no internal codes or raw technical errors.

### B. Complete business lifecycle
Follow `Rundown.md` Parts 1–17 end to end, then go further: company-owned vs customer-owned vs supplier-owned cylinders (ownership must never change when custody changes; a customer's own cylinder must never go to another customer); dispatch refusals for expired, held, empty, recalled, unreleased, wrong-branch, wrong-gas and wrong-size stock; partial delivery + unload keeps the original order quantity; collect → undo → collect → receive; supplier refill vs test-only; purchase receipt; recall affects only current holders of that batch and lists past recipients; lost cylinder → rent stop → write-off; stock counts and movement history stay consistent throughout; no cylinder is ever in two places.

### C. Money
Rupee↔paise conversion and rounding; tax rounding; invoice only after delivery is finished; invoices bill delivered quantity only; partial and full payment; overpayment refused; duplicate payment references; deposits are not revenue; refund limits and admin override; credit notes (partial, on paid invoices → customer credit); apply credit, undo credit allocation, refund credit; no double billing; rental days, free days, same-day return, periods must end before today; document numbering; issued invoices keep the customer and company details from the day they were issued, even after later edits. Verify totals by hand. Mark tax/legal questions "needs an accountant".

### D. Security (in-scope checks on the live demo; heavy checks locally)
- Every action type × every role directly against the API (`POST /api/actions`, see the access map in `server/domain.ts`); every read endpoint (`/api/bootstrap`, `/api/export`, `/api/cylinders.csv`, `/api/audit`, `/api/users…`).
- Branch isolation: create a Faridabad-only user (Settings → Add member) and try to read or change Delhi records by ID.
- Authentication: logout, session expiry, disabled users, role changes, password reset/change ending sessions, cookie flags (HttpOnly, Secure, SameSite=Strict), CSRF token required, Origin checks, login lock-out (5 wrong tries per account; also try rotating `X-Forwarded-For` values: the lock-out must still hold).
- Input handling: unexpected JSON properties, prototype-pollution keys (`__proto__`, `constructor`) as keys and as action types, NUL and control characters, very large bodies, SQL-injection strings in every text field and URL parameter, stored XSS in names shown on screen and in printed challans, invoices and labels, CSV formula injection in exports.
- Data leakage: errors must not reveal stack traces, SQL, file paths or connection strings; `api/index.mjs` and the website bundle must not contain secrets; responses to non-finance roles must not contain money data; drivers see only their own work.
- Supabase/Postgres (local copy with the roles above): the app's tables must live in the private schema `cylvero` (not `public`), have row-level security enabled with no policies, grant nothing to PUBLIC/`anon`/`authenticated` (try reading/writing as `anon` via `SET ROLE`), keep the audit log append-only (UPDATE/DELETE/TRUNCATE must fail), and store only hashed passwords and hashed session tokens.
- Response headers on <APP_URL> for pages and `/api/*`: Content-Security-Policy (frame-ancestors 'none'), Strict-Transport-Security, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Cache-Control no-store on the API.
- Concurrency and repeats (local copy): the same request repeated with the same `idempotencyKey` has one effect; the same key with a different payload is refused; two sessions dispatching the same cylinder → one wins; parallel payments never overpay; stale forms fail safely with a "Reload latest form" recovery.
- `npm audit` for dependency vulnerabilities.

### E. Offline driver, scanner, printing, phone layout
Driver "Save evidence on device", review, sync; offline then online; lost response then retry (no duplicate delivery); session expiry during sync then re-sign-in; conflict → "Needs office review" → download evidence → discard; two drivers on one browser never see each other's saved evidence. Keyboard-wedge scanner simulation (type a tag then Enter; tags `QA7-1` and `QA7-10` must not both be selected). Print label, challan and invoice (stub `window.print`). Phone size 375×667 and tablet 768×1024: no clipped buttons; row actions reachable.

## Report format
1. Summary: overall verdict for (a) a guided demo and (b) daily business use, with reasons.
2. Findings, most severe first. Each one has: severity (critical/high/medium/low), title, where, exact steps to reproduce, expected vs actual, evidence (request/response excerpt, screenshot or command output), file:line if known, suggested fix in plain words.
3. Coverage table: feature/action | expected behaviour | how tested | positive case | negative/edge case | result | evidence.
4. What you could not test and why (for example real scanners, cameras, printers, real mobile networks, tax/legal correctness).
Be exhaustive, but never claim "everything works" or "no bugs" without evidence.
````
