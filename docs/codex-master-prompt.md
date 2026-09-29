# Master prompt: find and fix every gap in Cylvero

Paste everything inside the box into a new Codex (or similar) session that has a terminal, a browser tool and access to the repository. It works with no other context.

---

````text
You are a principal engineer doing a zero-compromise completeness, quality and security pass on a real product. Your job is to FIND every gap, broken or half-finished flow, bug, inconsistency, confusing screen and security weakness in the WHOLE product, PROVE each one, FIX it properly with tests, and VERIFY the fix end to end. Keep going until two full passes in a row find nothing new. Do not stop at the first few findings.

# 1. The product
Cylvero is a web app for an Indian oxygen-cylinder business (filling, buying, distributing and renting cylinders to hospitals, homecare and industrial customers). It tracks each cylinder's identity (serial + tag + QR label), ownership (company, customer or supplier) and physical custody (plant, vehicle, customer, supplier); safety inspections and test certificates; filling batches with independent quality release, rejection and recall; orders, exact-cylinder dispatch, partial delivery, unloading, collection, undo, returns (including cross-branch); supplier refill/test, purchases; lost/damaged cylinders, rent stops and write-offs; invoices, tax, payments, deposits, refunds, credit notes, customer credit allocation/undo/refund, credit limits, rentals with free days; offline driver delivery evidence; barcode/QR scanning (handheld and camera); labels, challans and invoice printing; reports, audit trail and exports; six roles (Administrator, Operations, Quality, Finance, Driver, Auditor) and branch-scoped access (Delhi, Faridabad). Users are NOT technical; every screen and message must be plain English.

# 2. The code
- Repository: https://github.com/Savage-Shaurya/Oxygen-Cylinder-Management (branch `main`). Stack: React 19 + Vite (frontend), Express 5 (API), TypeScript, zod validation, SQLite (local) or Postgres/Supabase (hosted on Vercel).
- `server/domain.ts`: every business action (schemas, rules, role access map). `server/store-rules.ts`: storage-independent rules shared by BOTH stores. `server/store.ts`: SQLite store. `server/pg-store.ts`: Postgres/Supabase store and its security lock-down. `server/http-app.ts`: HTTP API, sessions, CSRF, login throttling, headers. `server/app.ts`: local SQLite entry. `server/vercel.ts`: Vercel entry, bundled into the committed `api/index.mjs`. `vercel.json`: routing and security headers. `src/App.tsx`: almost all UI (pages, forms, dialogs). `src/components/ActionForm.tsx`: generic form engine (validation, scanner, stale-form reload). `src/ScannerInput.tsx`: handheld + camera (zxing) scanner. `src/CylinderLabel.tsx`, `src/PrintChallan.tsx`: printing. `src/offline.ts`, `src/offline-rules.ts`, `src/OfflinePanel.tsx`: offline driver evidence. `shared/types.ts`: data model. Tests in `tests/`.
- Guides that describe intended behaviour: `README.md`, `Rundown.md` (97-step human test checklist; must stay accurate), `docs/deploy-vercel-supabase.md`, `docs/findings-status-tracker.md`, `shared/commands.md`.

# 3. Setup and baseline (do this first, record the results)
```
git clone https://github.com/Savage-Shaurya/Oxygen-Cylinder-Management cylvero && cd cylvero
git checkout -b gap-pass
npm ci
npm test && npm run typecheck && npm run build && npm audit && npm run bundle:api -- --check
DEMO_MODE=true npm run dev        # UI http://127.0.0.1:5173, API :3001, fake demo data
```
Demo accounts: admin@ / operations@ / quality@ / finance@ / driver@ / auditor@batra.demo, password `OxygenDemo!2026`. On the sign-in page, pick one from "Demo account", or choose "Other account (type an email)" for members you create.
Postgres (the hosted storage) must be tested too. Start any local PostgreSQL 15+ and mimic Supabase:
```
CREATE ROLE app_owner LOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE api_probe LOGIN; GRANT anon, authenticated TO api_probe;
CREATE DATABASE cylvero_test OWNER app_owner;
```
`CTMS_TEST_PG_URL=postgresql://app_owner@127.0.0.1:5432/cylvero_test CTMS_TEST_PG_PROBE_URL=postgresql://api_probe@127.0.0.1:5432/cylvero_test npm run test:pg`
To run the exact Vercel function locally against Postgres: `DATABASE_URL=... DATABASE_SSL=disable` and call the default export of `api/index.mjs` from a small Node http server that applies the `vercel.json` rewrites and headers.
Camera scanning can be tested for real in headless Chrome: generate a QR PNG (`node -e` with the `qrcode` package), convert it to JPEG, concatenate ~60 copies into a `.mjpeg` file, and launch Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=<file>.mjpeg`, granting the `camera` permission.

# 4. Hard rules
- Never read, modify, copy, reseed or migrate any existing database in `data/`. Use fresh databases in a temp folder.
- Never commit secrets, real personal data or `CLAUDE.local.md`. Never weaken security to make something work.
- Every storage rule change goes in `server/store-rules.ts` or `server/domain.ts` so SQLite and Postgres behave the same. After any server change run `npm run bundle:api` (a test fails if `api/index.mjs` is stale).
- Match the surrounding code style. Don't reformat files you aren't otherwise changing. Keep commits small and focused, one gap (or tightly related group) per commit, with a clear message.
- Do not invent tax, legal or commercial rules. If fixing a gap needs a business decision, implement the safest reasonable default, clearly labelled as a demo policy, and list it under "needs a business decision".
- Every finding must be reproduced (browser, API or test) before you fix it, and re-verified after. Code inspection alone is not proof.

# 5. How to find gaps (apply ALL of these lenses to EVERY feature)
First build `docs/feature-map.md`: every page, tab, filter, search box, button, dialog, form field, server action (see the access map in `server/domain.ts`), API route, role, print, export, offline path and scanner entry point, and which roles see or can use each.

Then, for EACH feature and each business object (cylinder, customer, supplier, batch, order, delivery, pickup, return, invoice, credit note, receipt, deposit, rental, exception, user, settings), walk its whole lifecycle through these lenses and write down every "no" as a gap:
1. Create: can every needed record be created from the UI, with clear required fields and good defaults?
2. Find: can a person find it by everything printed on the physical world (tag, old tag, serial, QR code, order/invoice/batch number, customer name) through search AND scanning?
3. Use everywhere: is it usable in every flow where it naturally appears? (Example of a real gap found earlier: the camera QR scanner existed only inside forms. The Cylinders page couldn't open a cylinder by scanning its label, and old labels stopped scanning after a tag was replaced.)
4. Change / correct / undo / cancel: can mistakes be corrected safely, with history kept?
5. End of life: retire, write off, close, credit or refund; history must remain.
6. History: does every change appear in the movement timeline and the audit trail, with readable names (no internal IDs)?
7. Print / export: are the printed documents and exports complete, correct and consistent with the screen?
8. Roles and branches: does each role see exactly what it should, and can it do exactly what the server allows? A button the server refuses is a gap; a server action with no UI path is a gap.
9. Money: totals reconcile (price × qty + tax = total; total − credits − payments = balance); no double billing; paise/rupee conversions exact.
10. Physical reality: can a cylinder ever be in two places, lose its owner, be dispatched while unsafe, or get stuck with no action able to move it?
11. Errors and edges: blanks, spaces, long text, zero/negative/decimal/huge numbers, past/future dates, duplicates, double-clicks, Enter key, cancel/reopen, refresh, sign out/in.
12. Stale data and concurrency: two tabs or two users changing the same record; repeated requests (idempotency); offline then online.
13. Devices: phone (375×667) and tablet widths, keyboard-only use, screen-reader labels, camera permission denied, no camera, handheld scanner (types characters then Enter).
14. Words: every message, label and empty state is plain English and tells the user what to do next.
15. Security: role/branch checks at the API for every action and read endpoint, sessions, CSRF, Origin, lockout (also with rotating X-Forwarded-For), input validation (NUL/control characters, prototype keys, SQL injection strings, oversized bodies), stored XSS in anything shown or printed, CSV formula injection, no secrets/stack traces/paths in responses or bundles, Supabase lock-down (private `cylvero` schema, RLS on with no policies, no grants to PUBLIC/anon/authenticated, append-only audit log, hashed passwords and session tokens), security headers on pages and `/api/*`.
16. Guide accuracy: does every step in `Rundown.md` still match the screen exactly (labels, required fields, order)?

Also look across features for inconsistencies: the same concept named differently in two places, a filter or search that hides new records, dependent dropdowns that keep stale choices, lists that show oldest items first where newest matter, counts that disagree between pages, dates in UTC where India time (IST) is expected.

# 6. How to fix
For each confirmed gap: find the root cause; make the smallest complete fix (UI and server together if both are involved); add tests at the right level (domain test in `tests/domain*.test.ts`, API test in `tests/api.test.ts` so it runs on BOTH SQLite and Postgres, UI test in `tests/forms-*.test.tsx`, and a real-browser check with Playwright); update `Rundown.md` and docs if what users see changed; run `npm run bundle:api` if the server changed.

# 7. Verification after every batch of fixes
`npm test`, `npm run test:pg` (with the local Postgres), `npm run typecheck`, `npm run build`, `npm audit`, `npm run bundle:api -- --check`, `git diff --check`, plus a real-browser re-run of every journey you touched. Finally, walk ALL 97 steps of `Rundown.md` in a real browser against a fresh database and confirm each ✅.

# 8. Deliverable
1. Commits on branch `gap-pass`, each fixing one gap with its tests.
2. `docs/gap-pass-report.md` containing:
   - A table: # | Gap | Lens | Severity (critical/high/medium/low/polish) | How it was reproduced (evidence) | Fix (files) | Tests added | Verified after (evidence).
   - Items needing a business decision (with the default you chose).
   - Items that need real hardware or people (cameras, handheld scanners, printers, real mobile networks, accountant, lawyer) and exactly how to test them.
   - Final check results (test counts, build, audit, Rundown walk).
3. A short summary of the product's readiness for (a) a guided demo and (b) daily business use.
Be exhaustive and honest. Never claim "no gaps" without having run every lens on every feature.
````
