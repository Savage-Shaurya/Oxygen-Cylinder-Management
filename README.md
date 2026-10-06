# Cylvero

**Every cylinder. Accounted for.**

A working cylinder operations application for an Indian oxygen manufacturer and distributor, including hospital and home-care supply. The local workspace uses **synthetic demonstration records**. Real deployments require the [production acceptance register](docs/planning/production-acceptance.md).

## Run locally

Requires Node.js 22.13 or newer (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The API runs on port 3001. Data persists in `data/ctms.sqlite`; restarting does not reset it. Environment variables are supplied by the shell or hosting platform; `.env.example` is a reference, not an automatically loaded configuration.

Demo password: `OxygenDemo!2026`.

| Email | Access |
|---|---|
| admin@batra.demo | Administration and all workflows |
| operations@batra.demo | Stock, customers, filling intake and dispatch |
| quality@batra.demo | Inspections, quality release and recall |
| finance@batra.demo | Invoices, rent, receipts, deposits and credits |
| driver@batra.demo | Assigned deliveries and return collection |
| auditor@batra.demo | Read-only review and export |

## Simple mode (for drivers and godown staff)

Drivers, and operations staff by default, open a **picture-based Simple mode** instead of the office screens. It shows 4 big picture tiles, has no menus or tables, and works in Hindi or English with spoken help. Operations, quality and admin users can switch between modes with **Office mode** / **Simple mode**.

| Role | Tiles |
|---|---|
| Driver | Give · Take back · My truck · Scan · Problem |
| Operations | Came back · Load truck · Scan · Filled · Problem |
| Quality | Scan · Check |

- **Scanning:** the camera stays open while you scan, and each cylinder fills a dot. No camera, or testing on a laptop? Use **Type code** or **Pick from list**.
- **Undo:** every save waits **5 seconds with a big UNDO** before anything is sent. Undo means nothing was recorded.
- **Results:** a green tick or red cross, with a sound, a vibration and a spoken sentence. Errors are shown as four plain-language screens, and the technical text is under **Details**.
- **Offline:** deliveries made with no network are saved on the phone. A ☁ button sends them later.
- **Server rules are unchanged:** every save goes through the same command path as Office mode, so permissions, CSRF, retry keys and the audit log behave exactly as before.

The design and the reasons for each choice are in [docs/simplification-plan.md](docs/simplification-plan.md).

## Guided demonstration

Use **Demo walkthrough** in the app header for eight chapters covering the full operating loop. Follow the [15–20 minute presenter script](docs/demo-walkthrough.md). Create a fresh, isolated rehearsal dataset without overwriting earlier work:

```sh
npm run demo:new -- data/rehearsal.sqlite
CTMS_DB_PATH=data/rehearsal.sqlite npm run dev
```

Stop an existing preview before starting another on the same ports.

## Implemented workflows

- Permanent cylinder identity and former tag history; ownership separate from physical custody; branch and serial-level traceability.
- Registration/import, inspection and complete test-evidence updates; quarantine, testing and retirement; unsafe stock blocked from filling and dispatch.
- Manufacturing/filling batches, independent quality release, supplier refill movements, purchased filled-cylinder receipt and batch recall.
- Customer orders, exact-cylinder dispatch, partial acceptance with recipient evidence, undelivered vehicle unload, customer return collection and separate warehouse receipt. Unexpected returns enter an exception queue.
- Hospital, home-care, industrial and supplier accounts; integer-paise invoicing, rental intervals/free days, receipts, deposits, refunds and credit notes.
- Role/branch authorization, hashed passwords and sessions, CSRF protection, session revocation, login throttling, atomic writes, revision conflicts, retry-safe command identity and append-only audit records.
- Search, QR labels, handheld/camera scan input, print challans and exports. Driver delivery evidence can be queued in the current loaded browser and reconciled explicitly after connectivity returns.

The web interface is responsive and uses Indian currency/date formatting. Office mode is in English. Simple mode is in Hindi and English, and its Hindi text should be reviewed by a native speaker before go-live. Offline evidence capture does not provide a cold-start offline application or bypass changed safety rules. Camera, physical scanners and printers require validation on the client's actual devices.

## Verify

```sh
npm test
npm run build
npm audit
```

Tests cover lifecycle safety/custody, financial arithmetic, authorization, sessions, idempotency, persistence, backup/restore and offline retry rules. Browser verification is recorded in [validation](docs/validation.md).

## Online demo (Vercel + Supabase)

Follow [docs/deploy-vercel-supabase.md](docs/deploy-vercel-supabase.md) to publish the demo for testers. The server function is `api/index.mjs`, bundled from `server/vercel.ts`; run `npm run bundle:api` after changing server code (a test fails if the bundle is stale). Postgres storage lives in `server/pg-store.ts` and shares its rules with SQLite through `server/store-rules.ts`. Run the Postgres suites against a disposable database with `CTMS_TEST_PG_URL=... CTMS_TEST_PG_PROBE_URL=... npm run test:pg`. Testers follow [Rundown.md](Rundown.md).

## Initialize a separate live workspace

Never promote the demonstration database. Prepare a configuration JSON containing:

```json
{
  "companyName": "Your legal company name",
  "address": "Registered address",
  "gstin": "",
  "defaultTaxBps": 0,
  "branches": [{ "id": "main", "name": "Main plant", "city": "Delhi" }],
  "admin": { "name": "Administrator", "email": "admin@example.com" }
}
```

Set `CTMS_ADMIN_PASSWORD` securely in the environment, then run:

```sh
npx tsx scripts/provision.ts company-config.json data/live.sqlite
npm run build
NODE_ENV=production DEMO_MODE=false CTMS_DB_PATH=data/live.sqlite npm start
```

The server defaults to loopback. Production requires a TLS reverse proxy, protected persistent volume and backups. Set `CTMS_TRUST_PROXY_CIDRS` to the comma-separated IP addresses or CIDR ranges of your actual reverse proxy (for a same-host proxy, `loopback`). This lets sign-in use the client's IP and HTTPS origin while ignoring forwarded headers from other sources. Production cookies are secure; sign-in is intended through HTTPS. Demo users/data are refused in production. Choose the actual tax and commercial rules with the client's accountant before importing opening balances. The Dockerfile provides a single-server packaging option; infrastructure deployment is not performed by this project.

## Backup and recovery

```sh
CTMS_DB_PATH=data/live.sqlite DEMO_MODE=false npx tsx scripts/backup.ts /secure/path/snapshot.sqlite
npx tsx scripts/restore.ts /secure/path/snapshot.sqlite /secure/path/restored.sqlite
```

Restore writes a new destination; it does not overwrite the running database. Stop the server, verify the restored records, and point `CTMS_DB_PATH` to the recovered file before restarting. Encrypt and restrict backup storage; the application does not encrypt SQLite files. Rehearse recovery before going live.

## Scope and integration boundaries

This is a single-server transactional SQLite application, not a horizontally distributed SaaS deployment. Accounting/Tally, WhatsApp, payments, official IRN/e-way-bill submissions, GPS and RFID hardware are **not connected**. Certificates are recorded as references; binary document storage, MFA/SSO, prescription management and clinical oxygen dosing are not implemented. Recovered recalled cylinders remain held; return-to-service remediation criteria require an approved client procedure. Customer credit limits are recorded for reference, not enforced as automatic dispatch stops. Printed challans are movement records, not statutory submissions or safety certificates. Do not enter unnecessary clinical information.

Client-specific opening stock, licenses, rental contracts, approved document formats, tax treatment, device testing and deployment security remain acceptance requirements. The application supports operational recordkeeping; it does not certify physical safety or regulatory compliance.

## Research and design

- [Product discovery](docs/planning/discovery-and-product-plan.md)
- [Client discovery checklist](docs/planning/client-discovery-checklist.md)
- [CTMS public evidence](docs/research/ctms-public-evidence.md)
- [Indian requirements and source links](docs/research/india-requirements.md)
- [Workflow/security analysis](docs/research/workflows-security.md)
- [Public route coverage](docs/research/ctms-public-routes.csv)
- [Implementation specification](docs/superpowers/specs/2026-09-28-lifecycle-build.md)
- [Command contract](shared/commands.md)

Research examined public CTMS material only, not private software or source code. The evidence inventory distinguishes discovered routes from reviewed pages.
