# Oxygen Lifecycle Implementation Plan

> For agentic workers: use subagent-driven-development and test-driven-development. Shared contracts are in shared/types.ts; each worker owns separate files. User explicitly authorized parallel Sol agents.

**Goal:** Deliver a working local application covering the complete cylinder operating loop, financial records and enforceable permissions.

**Architecture:** React client calls authenticated Express API. SQLite commits the domain state, idempotency record and audit atomically. The domain engine uses explicit commands and validated transitions.

**Tech Stack:** React 19, Vite 6, TypeScript, Tailwind 4, Express 5, Node 22 SQLite, node:test via tsx.

## Work ownership and steps

- [x] Foundation (root): shared/types.ts, package.json, vite config, specification and command contract. Install pinned lockfile. `npm run typecheck` and `npm test` are final gates.
- [x] Domain (Sol): server/domain.ts, server/seed.ts, tests/domain.test.ts. Write failing scenario tests, implement immutable transitions, then run `npx tsx --test tests/domain.test.ts`. Use UTC date-only calendar arithmetic and integer paise. Reject unsafe or conflicting events before state changes. Create fixtures with relative dates and no real patient data.
- [x] API/storage (Sol): server/app.ts, server/index.ts, server/store.ts, server/auth.ts, tests/api.test.ts. Write failing HTTP/persistence/security tests. Use DatabaseSync prepare/get/all/run/exec (supported Node 22 APIs); SQL parameters only. Read official Node 22 SQLite and Express 5 docs. Integrate applyAction and seed contract. `npx tsx --test tests/api.test.ts` must pass.
- [x] UI (Sol): src/App.tsx, src/main.tsx, src/styles.css, src/components/*, src/pages/*. Use shared types and command contract; no mock client-side mutations. Build role-aware responsive shell and all task pages. Loading, empty, inline errors and confirmations are required. Backend rejected commands must remain visible as errors.
- [x] Integration (root): src/api.ts offline queue, reports/import and any remaining functional gaps; coordinate exact contracts; no edits to active worker files without agreement.
- [x] Independent review: specification review followed by security/correctness review. Fix every consequential finding and add regression tests.
- [x] Verification: run full test/build, launch persistent server, browser-test live mutations and reload persistence; inspect mobile layout; write runbook and explicit production prerequisites. Record actual results and commit verified work.

## Official references and guards

Node SQLite https://nodejs.org/docs/latest-v22.x/api/sqlite.html ; Express https://expressjs.com/en/guide/migrating-5.html ; Vite https://vite.dev/guide/ ; React https://react.dev/reference/react . Do not use newly added SQLite APIs unavailable in Node 22.14. Never accept org/user identity from mutation payload. Never present test data as real inventory, external API success without actual provider confirmation, or legal compliance as established.

Completed local-demo verification evidence is in docs/validation.md. Production requirements remain open in docs/planning/production-acceptance.md; checked items do not imply production acceptance.
