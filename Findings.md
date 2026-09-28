# Cylvero audit report: findings, coverage and readiness

**Audited version.** Branch `build/oxygen-lifecycle`, HEAD `7253e8e`, plus the working-tree changes present at about 14:30 IST on 28 Sep 2026: 13 modified files and 8 untracked (`docs/qa-coverage.md`, `scripts/qa-preview.ts`, `src/party-options.ts`, five `tests/*` files). The UI was built from this working tree into the scratchpad.

**Isolation.**
- All state-changing tests ran on fresh synthetic databases, on audit-only ports 4311–4315 and 4320–4325. Those servers are now stopped.
- Your servers on :3001 and :5173 (`client-demo.sqlite`) and on :3002 were never contacted and are still running.
- The `data/*.sqlite*` file sizes and modified times match the baseline taken at the start.
- `git status` is identical to the start.

**Two incidents to disclose.**
1. The Playwright MCP browser automatically wrote a `.playwright-mcp/` folder into the project. It held two files, both captures of the audit instance on :4311. The agent moved it to the scratchpad within minutes, and it is gone from the project.
2. My wakeup timer created `.claude/scheduled_tasks.lock`, which git ignores. I cancelled the timer and left the file alone; you can delete it.

Evidence folder: `$S` = `/private/tmp/claude-501/-Applications-CTMS-Batra/bdd3749c-7b6d-4af3-acd7-94708c2d797e/scratchpad`, with one subfolder per area (`a1`–`a5`).

**How each item was tested:**
- **B (browser):** real Chrome through Playwright on :4311.
- **A (API):** HTTP requests against an isolated instance.
- **S (script):** scripts calling the real `Store` / `applyAction` code.
- **J (simulated):** jsdom or fake-indexeddb simulation.
- **U (existing tests):** covered by the existing automated suite.
- **C (code only):** read, not executed.

---

## 1. Findings, most consequential first

### CRITICAL

**C1. Any cylinder that is not empty can never be filled, dispatched or sent to a supplier again.** Reproduced (S, A).
- **Why:** only four actions write `contents`, and none sets a plant cylinder to `empty`. Filling (`batch.create`) and `supplier.send` require `empty` ([domain.ts:894](server/domain.ts#L894), [:977](server/domain.ts#L977)). Dispatch requires a released batch, and unloading or returning clears the batch ([:689](server/domain.ts#L689), [:780-781](server/domain.ts#L780), [:873-876](server/domain.ts#L873)).
- **Repro:**
  1. Dispatch AUD-01 and AUD-02.
  2. Deliver AUD-01 only.
  3. Unload AUD-02 → it becomes `contents=unknown batch=-`.
  4. Inspect it as serviceable.
  5. Now dispatch fails ("Cylinder is not dispatchable"), filling fails ("Cylinder cannot be filled") and supplier send fails ("Only safe empty cylinders…"). Evidence: `$S/a2/s1.out:78-86`.
- **Same outcome for:**
  - A customer return recorded as full, partial or unknown.
  - Registering or importing a cylinder with contents other than empty.
- **Seed data:** 24 held cylinders are `unknown`, and 5 are `full` with no batch.
- **Impact:** every refused delivery and every partly used return permanently leaves the usable fleet. No UI workaround exists.
- **Suggested correction:** add a recorded "vent/evacuate to empty" step. Let sealed, never-delivered stock that comes back on the vehicle keep or regain its release.

### HIGH

**H1. About 20 wrong passwords lock the whole company out for 15 minutes.** Reproduced (A, :4320, `$S/a4/throttle.mjs`).
- **Why:** the IP counter is checked before the password. `trust proxy` is not set, and a successful login does not reset the IP counter ([app.ts:251-268](server/app.ts#L251)). Behind the reverse proxy the README requires, everyone shares one IP.
- **Evidence:** after 20 failures, correct logins for admin, finance, driver and operations all get `429 "Invalid email or password"`. Separately, 5 wrong guesses lock any named account, including admin.
- **Suggested correction:** trust the proxy hop; throttle per account with a much higher IP ceiling; reset the IP counter on success; return a distinct lockout message.

**H2. The handheld scanner selects extra cylinders when one tag is the start of another.** Reproduced (J, `$S/a5/scan.mts`).
- **Why:** the lookup runs on every keystroke, not on Enter ([ScannerInput.tsx:74-77](src/ScannerInput.tsx#L74)). A scan of `T-10` selects both `T-1` and `T-10`. The seeded fixed-width tags hide this.
- **Impact:** a cylinder never handed over is recorded as delivered, moves into customer custody and starts rent.
- **Related (Medium):** the field is never cleared after a scan, so the second consecutive scan fails.
- **Suggested correction:** match only on Enter or a camera result, and clear the field afterwards.

**H3. A sign-in failure during offline sync locks queued deliveries for good.** Reproduced (A with simulated queue, `$S/a5/sim.mts`).
- **Why:** only network errors and 5xx responses count as retryable ([offline-rules.ts:30-32](src/offline-rules.ts#L30)).
- **Evidence:** a 401 or 403 marks the item as a conflict. After signing in again it is still a conflict, and the order stays `dispatched` on the server.
- **Why it happens in practice:** a session lasts 12 h from sign-in and a queued item lasts 12 h from queuing, so the session usually expires first.
- **Impact:** the delivery can only be discarded and re-entered by hand.
- **Suggested correction:** treat 401 and CSRF 403 as "sign in again and retry".

**H4. One bad cylinder blocks its whole batch, and the only way out condemns the good ones.** Reproduced (S, `$S/a2/s3.out`, `s6.out`).
- **Why:** release requires every member to be serviceable ([domain.ts:926-934](server/domain.ts#L926)). There is no remove or reject action. The UI shows Recall only for released batches.
- **Evidence:** once recalled, healthy members stay on hold for good (`Recalled cylinder remains on hold`).
- **Realistic trigger:** a supplier returns three cylinders after hydrotest and one has failed.
- **Suggested correction:** let quality reject or remove single cylinders from an awaiting batch, or allow partial release.

**H5. A recall targets every cylinder that was ever in the batch, not the cylinders that currently hold its gas.** Reproduced (S, `$S/a2/s2.out`).
- **Why:** [domain.ts:949-963](server/domain.ts#L949) walks the batch's historical member list.
- **Evidence:**
  - RX was refilled in a later batch B2 and delivered to customer C2. Recalling B1 still raises "Recover RX" against C2.
  - Customer C1, who actually received B1 gas, gets no record.
  - A B1 cylinder that was already returned is quarantined, then immediately re-inspected to serviceable.
- **Tracing:** the UI cannot list past recipients, because the batch appears only in the raw before/after history.
- **Suggested correction:** act on current holders of the batch, and produce a recipient trace list that includes customers who already returned the cylinder.

**H6. Payments, deposits and refunds never appear in the audit trail or export.** Reproduced by two agents independently (A, `$S/a3/audit.out`, `$S/a4/ev/auditfull.txt`).
- **Why:** `scopedAudit` builds its allowed IDs without receipt IDs ([app.ts:29-50](server/app.ts#L29)).
- **Evidence:** with 15 receipts posted, 0 appear for the auditor or the org-wide admin. The rows do exist in the stored `audit_log`; they are just never shown.
- **Suggested correction:** scope these events through the receipt's customer branch.

**H7. After a supplier returns cylinders, they are always recorded as full.** Reproduced (S, `$S/a2/s6.out`).
- **Why:** `supplier.receive` forces `contents='full'` ([domain.ts:1024](server/domain.ts#L1024)). There is no way to say the supplier only tested the cylinder.
- **Evidence:** a cylinder that came back physically empty after hydrotest was released and dispatched to a hospital as full.
- **Mitigation:** only a person noticing at quality release.
- **Suggested correction:** capture the service type and the actual contents on receipt.

### MEDIUM

| # | Finding | Evidence | Status |
|---|---|---|---|
| M1 | **Production build fails.** `tsc` reports 2 errors in the untracked `tests/offline-integration.test.ts:175,178`. The test fixture also uses an invalid gas value, `'Oxygen'`. `npm run build` and the Dockerfile build therefore fail. | `$S/typecheck.log`, exit 2 | Executed |
| M2 | **An issued invoice can show a GSTIN that was added later.** A blank saved GSTIN falls back to the current one via `\|\|` ([App.tsx:3998-4020](src/App.tsx#L3998)). The seeded invoices have no saved customer/company details at all. The challan always uses current details ([PrintChallan.tsx:39-41](src/PrintChallan.tsx#L39)). | `$S/a3/finance.out` §5, `$S/a5/invoice-print-media-375.png` | B + S |
| M3 | **Any action anywhere makes everyone's open form fail with 409**, because there is one revision number for the whole company ([App.tsx:288](src/App.tsx#L288)). Every response also carries the whole database: 5.6 MB per action at 5,000 cylinders. | `$S/a4/ev/idem.txt`, `scale.txt` | A |
| M4 | **Forms left open cannot recover after a conflict.** Inspect keeps the version from when it opened, so every retry fails with "Cylinder version changed". Dispatch keeps offering cylinders another user already dispatched. | `$S/a1/inspect-stale-version.png` | B |
| M5 | **New records are hidden by an active search or filter** on Cylinders, Orders, Production and Billing. Only customer creation resets the view ([App.tsx:537](src/App.tsx#L537)). | `$S/a1/order-hidden-by-filter.png` and others | B |
| M6 | **"Recent receipts & deposits" shows the 12 oldest receipts**, via `slice(0,12)` on an oldest-first list ([App.tsx:3066](src/App.tsx#L3066)). New deposits and refunds become invisible anywhere in the UI. | two agents; `$S/a1/receipts-ledger.png` | B + A |
| M7 | **The only org-wide admin can remove their own access to one branch.** After that, settings changes, restoring the branch and creating a new org-wide admin all return 403. Recovery needs direct database editing. | `$S/a4/ev/selfnarrow.txt` | A |
| M8 | **A live admin can create a user like `x@Batra.Demo`**, after which the production server refuses to restart ([store.ts:83-86](server/store.ts#L83)). | `$S/a4/ev/prod.txt` | S |
| M9 | **Operations or quality can close a recall-recovery exception while the cylinder is still at the customer.** | two agents; `$S/a2/s6.out` | S + A |
| M10 | **No way to record a lost or damaged cylinder away from the plant.** Inspection requires plant custody, so rent runs indefinitely. | `$S/a2/s4.out` | S |
| M11 | **Same-day rental billing errors.** A period ending "today" bills the day even if the cylinder is returned later that day (9 days billed, 8 due). A cylinder delivered later that day can't be billed for that day (409 overlap). | `$S/a3/rental.out` F/F2 | S |
| M12 | **A credited delivery cannot be re-invoiced from the UI**, although the server allows it ([App.tsx:2924](src/App.tsx#L2924), [:3794](src/App.tsx#L3794)). | `$S/a3/finance.out` 1j | S + C |
| M13 | **The gas price is entered by operations, who can't see it; finance can't edit it.** A ₹0 order produces an invoice that can never be paid or closed except by credit note. | `$S/a3/api.out` | A |
| M14 | **Offline deliveries are stamped with sync time.** The proof time, the challan and the rental start all use sync time; the server rejects any handover time the device sends. | `$S/a5` | A + C |
| M15 | **Offline: no save-on-device option when the network is flaky but the browser reports online.** | headless browser run, `$S/a5` | B |
| M16 | **Offline: an already-accepted delivery replays as 403 after any user edit**, and is shown as a conflict ([store.ts:257-266](server/store.ts#L257)). | `$S/a5/sim.mts` | A |
| M17 | **Receive filled: choosing Gas wipes the cylinders already ticked** ([form-values.ts:15](src/components/form-values.ts#L15)). | `$S/a1/supplier-receive-gas-clears.png` | B |
| M18 | **After a failed save, keyboard focus drops out of the dialog.** Escape stops working and Tab moves to the page behind. | `$S/a1/focus-lost-after-error.png` | B |
| M19 | **Ownership rules (needs business confirmation):** a supplier-owned cylinder can go to any customer and is charged the normal rent; a customer-owned cylinder can be sent to a supplier, filled into a company batch or retired, with no record. Owner never changed across 143 movement snapshots. | `$S/a2/s1.out` | S |
| M20 | **Driver delivery form on a phone (375 px):** the Cancel button is mostly off-screen in offline mode, and the Deliver button is reachable only by scrolling the orders table sideways. | `$S/a5/driver-*-375.png` | B |

### LOW (all executed unless marked C)

**Lifecycle**
- The batch "Fill operator" typed into the form is discarded; the logged-in user is stored instead. This weakens the independence check.
- Purchase receipt notes are lost, and a duplicate purchase-order reference is accepted.
- An unexpected-return discrepancy is free text only; drivers can raise one for any branch.
- A return cannot be received at a different branch.
- A collection cannot be undone (C).

**Seed data**
- 12 Faridabad cylinders are owned by Delhi customers, breaking a rule the app enforces.
- No Industrial oxygen seed stock can ever be dispatched.

**Security**
- Action types `constructor` / `__proto__` / `toString` return 500 with a logged stack trace.
- With `DEMO_MODE=false` and `NODE_ENV` unset, live data is served without the Secure cookie flag or CSP.
- `scripts/backup.ts` seeds demo accounts into an empty source file.
- Database and backup files are created world-readable (0644).
- The only password rule is length (12 spaces is accepted).
- There is no password change or reset, and emails have no length limit.
- Events with an empty entity ID (settings changes, imports) leak to branch-limited admins and auditors.
- 404 versus 403 responses reveal which IDs exist in other branches.
- The Origin check ignores the scheme.
- Expired sessions are never deleted, and there is no idle timeout.
- `freeDays` is visible to non-finance roles.
- CSV export does not escape a full-width `＝` (formula-injection edge case).

**Finance**
- Due dates earlier than the issue date are accepted.
- Duplicate payment references are checked only per customer and method; cash is exempt, and a duplicate cash posting with a new request key is accepted.
- Invoices and credit notes share one counter, and refunds are numbered as receipts (numbering policy: needs specialist verification).
- The default rental period is wrong: month overflow on the 31st, the UTC date is used before 05:30 IST, and monthly defaults overlap and get rejected.
- Rupee-to-paise conversion uses floating point (`1.005` becomes 100 paise); the browser's 2-decimal check probably prevents it.
- A deposit can be recorded for a supplier.
- "Invoices issued" counts credit notes.
- A credit note is shown as a receivable ("Issued", Due date, positive balance).

**UI**
- Finance sees a Return button the server refuses (403).
- The supplier "Received awaiting QC" stat is always 0.
- Switching customer in a Return opened from a customer row shows an empty list.
- Send-to-supplier offers cylinders the server will reject.
- The driver sees export buttons, and the "Forbidden" message is styled as a success.
- Raw server validation text reaches users, with zero-based CSV row numbers.
- The Inspect form rejects fields it labels optional.
- Past order dates are accepted.
- The Owner list offers parties from other branches.
- Size is free text, so `b` and `B` are different sizes.
- A short password in Add member says only "Invalid user".
- Several empty states are missing or misleading.
- Accessibility attributes are missing: `aria-current`, `aria-pressed`, tab panels.
- The driver's challan has no company address or GSTIN.
- The offline panel shows internal IDs.
- Signing out while offline fails silently.
- The offline queue's encryption key is stored next to the data.
- Old tags cannot be searched.
- Hash navigation leaves the detail dialog open.
- Collect-empties compares a UTC date with today in IST (C).

---

## 2. Past-bug retest (original conditions reproduced)

| Past bug | Verdict | Evidence |
|---|---|---|
| Add customer sent `cylinderIds` | **Fixed.** Every captured request body contained only declared fields. CSV import still passes through extra columns, which the server rejects with a raw message. | B |
| Supplier offered as a customer classification; saved record vanished | **Fixed.** Add customer offers only hospital, homecare and industrial; suppliers appear under Suppliers. Reclassifying through Edit is guarded by activity history. | B + S |
| Search filters hid new records | **Partly fixed:** Customers and Suppliers only. Still happens on Cylinders, Orders, Production and Billing (M5). | B |
| Stale dependent choices | **Mostly fixed.** Branch, customer and supplier changes clear the dependent selection, and it is not submitted. Remaining: M17 (over-clearing) and the Return customer-switch issue. | B |
| Open forms kept an outdated revision | **Partly fixed.** The revision refreshes after a 409 and entered values are kept, but versions and options captured when the form opened stay old (M4). Company-wide revisions make 409s frequent (M3). | B + A |
| Offline duplicate or unnecessary conflict | **Duplicates fixed:** a lost-response retry made one movement and one rental; queues are per user. **Unnecessary conflicts remain:** H3 and M16. | A + J |
| Customer-owned cylinder sent to another customer | **Fixed** (rejected). Related gaps in M19. | S |
| Billing a partial delivery before vehicle stock was resolved | **Fixed.** Invoicing is blocked until the order is delivered or short-closed, and delivery is blocked after invoicing. Related: M12. | S |

---

## 3. Lifecycle trace (named synthetic cylinders AUD-*, RX–RW, H1–H3, S1–S3, E1)

| Step | Result | Method |
|---|---|---|
| 1 Customers and suppliers | Pass; duplicate names rejected (case-insensitive) | B, A |
| 2 Register or import, with owner and certificate | Pass; import is all-or-nothing; C1 applies to non-empty rows | B, S |
| 3 Inspect | Pass; M4 applies to stale forms | B, S |
| 4 Fill a batch | Pass; operator typed in the form is discarded (Low) | B, S |
| 5 Non-independent release | Correctly rejected: same user 403, operations 403. Note: a second admin can release another admin's batch. | S |
| 6 Independent quality release | Pass | B, S |
| 7 Receive purchased full cylinders | Inspection and release required; H7 applies to supplier returns | S |
| 8–9 Order and exact dispatch | Every ineligible class rejected: expired, held, empty, unreleased, recalled, wrong branch/gas/size/owner, already on a vehicle | S |
| 10 Full and partial acceptance | Pass; delivery proofs accumulate; manifest kept | S, A |
| 11 Resolve undelivered vehicle stock | Unload works, **but the stock is then stranded (C1)** | S |
| 12 Invoice | Pass; closed-short bills delivered quantity only | S |
| 13 Partial and full payment | Pass; overpayment rejected | S, B |
| 14 Deposits and refunds | Refund capped at deposit balance; no link to cylinders still held | S |
| 15 Rental and free days | Boundaries pass, including the IST midnight edge; M11 applies | S |
| 16 Collect and receive at plant | Pass; rental closes at plant receipt | S |
| 17 Missing, damaged, held, expired, retired | Held, expired and retired pass; missing/damaged at a customer not possible (M10) | S |
| 18 Refill or supplier send | Only empty cylinders qualify (C1); H7 | S |
| 19 Recall and trace | **Wrong scope (H5)**; recovery exception can be closed early (M9) | S |
| 20 History, stock, custody, balances, audit | Movement snapshots correct; no cylinder in two places (concurrent dispatch from 2 processes: one succeeded, one rejected); replay creates no duplicates; **audit missing receipts (H6)** | S, A |

---

## 4. Coverage matrix

**Server actions (all 28 tried by all 6 roles at the API; results match the access map)**

| Feature / action | Expected | Method | Positive | Negative / boundary | Result | Evidence |
|---|---|---|---|---|---|---|
| Role × action matrix | Matches access map | A | 28 × 6 | auditor always 403 | Matches the code; README role descriptions differ | a4/ev/matrix.txt |
| Cross-branch writes | Denied | A | — | 44 cases with a Faridabad-only user | All 403 or 400 | a4/ev/branch1.txt |
| Cross-branch reads (bootstrap, export, CSV, audit) | Branch-scoped | A | ✓ | Empty-entity-ID leak; seed owners | Pass apart from Low items | a4/ev/auditleak.txt |
| cylinder.register / cylinders.import | Unique serial and tag; inspection hold; all-or-nothing | S, B | ✓ | duplicates, old tags, bad dates, owner branch | Pass except C1 | a2/s1, a1 |
| cylinder.inspect / retag | Version check; previous tags kept | S, B | ✓ | stale, expired, retired, off-site | Pass; M4, M10 | a2/s1 |
| party.create / update | Duplicates blocked; type locked after activity | B, S | ✓ | whitespace, long text, huge numbers, reclassify | Pass; raw errors (Low) | a1 |
| order.create / cancel | Customer and branch checks | B, S | ✓ | quantity 0 / 1.5 / 501, past date | Past date accepted (Low) | a1 |
| order.dispatch | Only eligible stock | S, A | ✓ | 9 ineligible classes; concurrent | Pass; M19 | a2/s1, s5 |
| order.deliver / unload | Manifest kept | S, A, B | ✓ | unlisted cylinder, recalled mid-trip | Pass; C1 after unload | a2 |
| cylinder.collect / return | Custody chain; rental closure | S, B | ✓ | wrong customer, double receipt, other branch | Pass; Low items | a2/s4 |
| return.discrepancy / exception.resolve | Reviewable | S, A | ✓ | free-text serial, early recall close | M9; Low items | a2/s6 |
| batch.create / release / recall | Independent release; safety | S, B | ✓ | same user, ops, retired member, historic members | H4, H5 | a2/s2, s3 |
| supplier.send / receive / purchase.receive | Release required | S, B | ✓ | gas mismatch, empty returned as full | H7; Low items | a2/s6 |
| finance.invoice / rental | Gated; exact tax | S, B | ✓ | duplicate, overlap, future period, free-day edges | M11, M12 | a3/rental, finance |
| finance.receipt / deposit / refund / credit | No overpayment or duplicates | S, A, B | ✓ | 5 parallel posts, duplicate reference, cash, credited invoice | Pass; duplicate-reference Low | a3/api.out |
| settings.update | Org-wide admin only; invoice snapshots kept | S, A | ✓ | branch-limited admin | Pass; M2 display | a3 §5 |
| Idempotency and replay | No duplicates | A | 10 parallel same-key requests → 1 record | different payload 409; after restart; key order matters | Pass; M16 | a4/ev/idem.txt |
| Revision and conflicts | Safe failure | A, B | ✓ | revision omitted → last write wins | M3, M4; Low | a4/ev/idem.txt |
| Validation | Strict schemas | A | ✓ | `__proto__`, Infinity, 1 MB limit, extra keys | Pass; prototype-name 500 (Low) | a4/ev/payload.txt |

**Access, persistence and exports**

| Feature / action | Expected | Method | Positive | Negative / boundary | Result | Evidence |
|---|---|---|---|---|---|---|
| Login and throttling | Per-account limit | A | ✓ | 20 failures from one IP | **H1** | a4/throttle.mjs |
| Logout, expiry, revocation, disabled user, role change | Sessions end | A | ✓ | replay after role change | Pass | a4/ev/auth.txt |
| CSRF, Origin, cookies | Enforced | A, S | ✓ | missing, wrong, cross-session, null Origin | Pass; Low items | a4/ev/auth.txt, prod.txt |
| User administration | Final admin protected | A | ✓ | self-narrowing branches; demo-domain email | M7, M8 | a4/ev |
| Restart (including kill -9) and persistence | Data, sessions and replay keys survive | A | ✓ | — | Pass | a4/ev/persist.txt |
| Backup and restore | New file only; sessions cleared | S | ✓ | non-CTMS file, same path, missing file | Pass; backup seeding (Low) | a4 shell output |
| Demo/live separation and provisioning | Refused in wrong mode | S | ✓ | provision twice; demo DB in production | Pass; M8 | a4/ev/prod.txt |
| CSV and JSON export | Scoped; formula-safe | A, B | ✓ | `= + - @`, tab, CR, full-width `＝` | Pass apart from `＝` | a5/cylinders-export.csv |

**UI**

| Feature / action | Expected | Method | Positive | Negative / boundary | Result | Evidence |
|---|---|---|---|---|---|---|
| Every form (about 30), dialog and button, all 6 roles | See §2 and M/Low items | B | ✓ | blanks, decimals, negatives, long text, double click, Enter, cancel/reopen | M4–M6, M17, M18; Low items | a1/t2–t14.out |
| Demo walkthrough, 8 chapters | Navigates | B | ✓ | — | Pass | a1 |
| Money in UI vs API | ₹ ↔ paise | B | ₹12,500.50 → 1250050 | 0.001, 1.005 | Pass (float Low) | a1, a3 |
| Screens at 375 / 768 px | No clipping | B | general layout OK | driver form, orders table | M20 | a5, a1 |

**Offline, scanning and print**

| Feature / action | Expected | Method | Positive | Negative / boundary | Result | Evidence |
|---|---|---|---|---|---|---|
| Offline queue ownership and encryption | Per user | B, J | ✓ | user switch; page script can decrypt | Pass (weak key) | a5 |
| Offline retry and conflicts | No duplicates; recoverable | A, J | ✓ | 401/403, unload, recall while offline | H3, M14–M16 | a5/sim.mts |
| Scanner | Exact match | J | ✓ | prefix tags, consecutive scans | H2 | a5/scan.mts |
| Camera (zxing) | — | C only | — | — | Not verified on hardware | — |
| Label, challan and invoice print | Correct, escaped | B (print stubbed) | ✓ | `<script>` in customer name | Escaped; M2, Low items | a5/*.png |

---

## 5. Test and build results

| Check | Result |
|---|---|
| `npm test` (80 tests) | **80/80 pass**, 10.8 s (`$S/test.log`). The tests use OS temp databases and random ports. |
| `tsc --noEmit` | **FAIL, exit 2**: two errors in `tests/offline-integration.test.ts` (M1). |
| `npm run build` | Not run, because it writes `dist/` into the project and would fail at `tsc` anyway. `vite build` alone, output to the scratchpad, succeeded. |
| `npm audit` | 0 vulnerabilities across 363 dependencies. |
| Offline test subset | 10/10 pass. |

The passing suite does not exercise C1, H1–H7 or most of the M items.

---

## 6. Missing or ambiguous business rules

- **Cylinder states:** how to empty (vent) a cylinder; what happens to sealed stock that comes back undelivered; how a recalled cylinder is returned to service; whether a recall targets current holders or everyone who ever held the gas.
- **Batches:** partial release or rejecting one cylinder; a separate record of the physical filler; whether the inspector and the releaser must be different people.
- **Ownership:** customer or supplier consent before their cylinder is sent to a supplier, retired or rented out; rent on supplier-owned cylinders.
- **Losses and returns:** recording loss or damage at a customer and when rent stops; returns received at another branch.
- **Suppliers:** service type (refill versus test only).
- **Deposits and credit:** refund rules versus cylinders still held and unpaid invoices; how the "standard deposit" field relates to deposits received; credit limits (not enforced).
- **Corrections:** partial credit notes, and corrections or refunds for paid invoices; customer credit balance.
- **Pricing:** who owns order price; zero-price orders.
- **Rental:** whether billing may end "today"; whether rate or free-day changes apply to cylinders already out; whether rent runs during pickup transit.
- **Offline:** handover time versus sync time; session lifetime relative to queued evidence; office-side conflict resolution; recall notice while offline; offline collections.
- **Security and administration:** throttle and proxy policy; password rules, reset and MFA; idle timeout; separation of duties (admin can do everything); guaranteed org-wide admin; branch creation after provisioning; backup encryption and permissions.
- **Tax and documents:** tag character set; label content; numbering series by financial year; CGST/SGST/IGST, HSN, e-invoice, tax rate on medical oxygen and rental. All tax and GST items are demo simplifications that **require specialist verification**; no compliance conclusion is drawn here.

---

## 7. Not tested, and why

- **Hardware and networks:** real camera decoding (headless browser has no camera, and camera access needs HTTPS); real keyboard-wedge scanner timing and suffix settings; real label and A4 printers and whether printed QR codes scan; real mobile network loss; captive portals; a mobile browser discarding the tab while items are queued; storage eviction; iOS and Android behaviour; Firefox and Safari downloads.
- **Deployment:** TLS and reverse-proxy deployment (H1 is inferred to apply behind one); Docker image build; multi-organisation isolation (only one exists); load beyond 5,000 cylinders.
- **Access:** logging in through the UI as a branch-limited user (demo mode offers one account per role; branch limits were tested at the API).
- **Accessibility:** a screen reader.
- **Excel/Sheets:** how they treat `＝`-prefixed CSV cells.
- **Real time:** a real 12-hour session expiry and real certificate expiry (both simulated with clock shifts).
- **Your running app** on :3001/:5173 and `client-demo.sqlite`: not touched, by design.

---

## 8. Readiness

**Guided demo: ready with care.** The main flow works end to end on fresh data: register, inspect, fill, independent release, dispatch, partial delivery, invoice, payment and return. For the presenter:
- Avoid unloading or returning non-empty cylinders; they strand (C1).
- Avoid recalling a batch after its cylinders were refilled (H5).
- Clear filters before creating records (M5).
- Avoid posting more than 12 receipts (M6).
- Don't use seeded Industrial oxygen stock; it can't be dispatched.
- Don't demonstrate invoice-detail preservation on the seeded invoices (M2).
- The demo runs on the dev server even though the production build is broken (M1).

**Daily production operations: not ready.** Blocking issues:
- Stranded stock (C1) and company-wide sign-in lockout (H1).
- Wrong-cylinder scans (H2) and offline evidence lock-in (H3).
- Batch deadlock (H4) and wrong recall scope (H5).
- Missing financial audit trail (H6) and the empty-shown-as-full risk (H7).
- Broken production build (M1).
- Company-wide revision conflicts and whole-database responses (M3), which will not hold up with several users.
- No lost-cylinder handling (M10) and no password reset.
- Open tax and document decisions that need specialist sign-off.

Nothing in the project was changed. I can also publish this report as a shareable private web page if that would be useful.
==========

Cylvero frontend audit: browser results

I found 20 defects, none high or critical. The most important: new records disappear behind an active search or filter on four screens, and forms left open while data changes elsewhere can fail repeatedly until they are closed and reopened.

Setup and one rule breach. I ran the audit instance on 127.0.0.1:4311 with a fresh demo database. Every form was driven in a real Chrome browser. The first Playwright MCP navigate automatically wrote a .playwright-mcp/ folder (one snapshot and one console log) into /Applications/CTMS-Batra, which broke the "no files in the project" rule. I moved it out straight away to $S/a1/mcp-moved/. I did the rest of the testing with a standalone headless Playwright + Chrome script from the npx cache, with all output under $S/a1/pw/. git status is now back to its starting state. No other ports were touched, and I stopped my server at the end.

$S = /private/tmp/claude-501/-Applications-CTMS-Batra/bdd3749c-7b6d-4af3-acd7-94708c2d797e/scratchpad. All screenshots and raw outputs (t2.out to t14.out) are in $S/a1/.

A) Confirmed defects
All were reproduced in the browser unless marked otherwise.

Medium – New records hidden by an active search or filter (past bug 3 is still present outside Customers and Suppliers).

Cylinders: type "DEMO-TAG-0000" in search, pick the Quarantine filter, then Register cylinder. The toast says "Cylinder registered for inspection", but the list still shows "0 records" and the search is kept.
Orders: pick the Delivered filter, then New order. The order is created but the count stays "1 orders".
Production: search "DEMO-BATCH", then Create batch. The toast confirms it, but the count stays "4 batches".
Billing: pick the Paid filter, then Issue invoice. The invoice is created but the count stays "1 invoices".
Why: only createParty calls navigate() to reset search and filter (App.tsx:537). register, createOrder, createBatch, issueInvoice, rentalInvoice and import do not.
Evidence: order-hidden-by-filter.png, batch-hidden-by-search.png, invoice-hidden-by-filter.png.
Fix: after each create, clear the search and filter (or show "new record hidden by filter — clear").
Medium – "Recent receipts & deposits" shows only the 12 oldest receipts.

Repro: as Finance, record 11 deposits (AUD-DEP-1 to 11).
Result: the ledger ends at RCPT-00012 (AUD-DEP-8). AUD-DEP-9 to 11 never appear, although the stat says "Receipts 15". There is no search on this ledger.
Why: receipts are appended to the end, and the table uses s.receipts.slice(0, 12) (App.tsx:3066).
Evidence: receipts-ledger.png.
Fix: sort newest first, or take the last 12.
Medium – Receive filled: choosing Gas wipes the cylinders already selected.

Repro: pick a supplier, tick a cylinder (1 ticked), then choose the Gas below it (0 ticked). Save shows "Select cylinders" and no request is sent.
Why: gas is one of the fields that clears cylinderIds (form-values.ts:15), but Gas does not filter this form's options, and it sits below the cylinder list (App.tsx:999).
Evidence: supplier-receive-gas-clears.png.
Fix: only clear when the changed field actually feeds the options, or move Gas above the list.
Medium – Batch "Fill operator" is thrown away.

Repro: create a batch with operator "Ravi Kumar (typed)".
Result: the payload does send "operator":"Ravi Kumar (typed)", but the server stores ctx.user.id (domain.ts:907). The table and detail show "u-ops", and searching "Ravi" finds 0 batches.
Fix: remove the field (and show the user's name), or store it as a separate field.
Medium – Forms left open while data changes elsewhere cannot recover (past bug 5 is only partly fixed).

Inspect: open Inspect on AUD-TAG-003, retag that cylinder in a second tab, then submit. The first attempt gives "State changed; refresh and retry". Every retry after that gives "Cylinder version changed", because version: c.version is captured when the form opens (App.tsx:454). The title also still shows the old tag. Evidence: inspect-stale-version.png.
Dispatch: have a second tab dispatch cylinders that are already ticked in the first tab. The first tab gets a 409, then "Cylinder is not dispatchable" (no tag named), and its option list still offers the dispatched units. Only close and reopen recovers.
Fix: after the 409 refresh, rebuild the open form's options and version from the fresh data, or tell the user to close and reopen.
Medium (accessibility) – After a failed Save, keyboard control of the dialog is lost.

Repro: submit any form that returns an error.
Result: focus falls to BODY (the submit button was disabled while busy). Escape no longer closes the dialog, and Tab moves to the page behind it.
Why: ActionForm.tsx:89 with the dialog-level key handler in UI.tsx.
Evidence: focus-lost-after-error.png.
Fix: after an error, move focus to the error alert or the first invalid field.
Low–Medium – Finance sees a "Return" button on Customers rows, but the server refuses it. Submitting gives 403 "Action not permitted". The button is gated by canAdd, which includes finance (App.tsx:1499 and 2743), while the server only allows admin and operations for cylinder.return.

Low–Medium – Supplier stat "Received awaiting QC" is always 0. SUP-00005 and PUR-00006 are awaiting release, but the stat reads 0. It checks source.includes('supplier') (App.tsx:2834), and source holds the delivery reference. It should use supplierId.

Low–Medium – "Return" from a customer row: switching customer shows an empty list. The list is limited to the first customer when the form opens (App.tsx:814). Switching to Demo Home Oxygen Service A shows no cylinders, with the misleading hint "Choose the customer… first", although the generic form lists two. Evidence: return-prefilled-switch.png.

Low – Send to supplier offers cylinders the server will reject. Inspection-due empties (for example DEMO-TAG-00001) are listed, and sending them fails with "Only safe empty cylinders…". The UI filter (App.tsx:943) does not check serviceable or test-date status. Evidence: send-ineligible.png.

Low – Driver sees "Export CSV" and "Cylinder CSV", which the server forbids. Clicking shows a toast "Forbidden" with a green success check icon (toast styling at App.tsx:1712).

Low – Raw server validation messages reach users. Examples:

Whitespace-only fields: "Invalid party.create payload: name: String must contain at least 1 character(s)…".
Money in internal units: "creditLimitPaise: Number must be less than or equal to 9007199254740991".
Other limits: "quantity ≤ 500", "freeDays ≤ 365", name over 120 characters.
Payment of ₹0: the input allows min=0, then the server says "amountPaise: Number must be greater than 0".
Import errors use zero-based row numbers: "rows.0.tag", "cylinders.0.lastTest: Invalid date", "Unrecognized key(s)… 'notes'".
Fix: validate on the client, add maxLength/max/min=0.01 to inputs, and map server errors to field labels and CSV row numbers.
Low – Inspect form rejects fields it labels optional. Clearing "Certificate reference" or "Next test due" (no asterisk) fails with a raw schema error (App.tsx:440).

Low – Past dates are accepted.

An order with requested date 2020-01-01 was saved.
An invoice issued 28 Sept 2026 was saved with "Due 01 Jan 2020".
Low – Register cylinder data-quality gaps.

The Owner list includes parties from every branch (App.tsx:346). Choosing Demo City General Hospital (Faridabad) for a Delhi cylinder fails with "Owner branch mismatch".
Size is free text: "b" saved alongside "B". Inferred from code: a size-"b" cylinder can never be dispatched against a "B" order.
Low – Add member with a short password says only "Invalid user". There is no hint that 12 characters are required.

Low – Misleading or empty states.

Operations, Quality and Finance get an empty Audit trail and "Recent activity" (the server sends no audit data to these roles, app.ts:75) with no explanation.
Driver's Settings shows "GSTIN Not configured" and a blank address (the server blanks these for drivers).
The team table has no empty state.
Billing filters have no "Credited" option.
After a sync, the offline panel reads "0 saved deliveries… Saved evidence is pending", and the evidence list shows internal IDs (o-partial-1, c-004) instead of order numbers and tags.
Low (accessibility).

The active nav item has no aria-current.
Filter pills have no aria-pressed.
Report tabs have no tabpanel and arrow keys do nothing.
Dialogs put first focus on "Close dialog" rather than the first field.
Low – Assorted usability issues.

The supplier form uses the label "Business / customer name" and requires rental, credit and deposit fields.
The Cancel/Credit order dialogs have buttons "Cancel" and "Save", which is ambiguous.
Exported cylinder CSV cannot be re-imported (different columns).
A duplicate serial within one purchase CSV reports "Manufacturer and serial already exist".
B) Coverage
Screen / form (action)	Method	Result
Login: role select, wrong password, tab order	Browser	Pass
Navigation and page buttons for all 6 roles	Browser	Defects 7, 11
Add customer (party.create): blanks, whitespace, 3-decimal, negative, huge, free days 1.5 and 400, 130-character name, long GSTIN, duplicate (case-insensitive), double-click, reload	Browser	Pass (1 request on double-click); defect 12
Add supplier; supplier type options	Browser	Pass; defect 19
Edit party (party.update): branch change, reclassify, reclassify with history, stale revision	Browser	Pass
Register cylinder: blanks, future test, due before last test, owner branch, duplicate serial/tag, historical tag	Browser	Defects 1, 15 (2026-02-30 cannot be typed into a date input)
Retag: duplicate and historical tag	Browser	Pass
Inspect: optional fields, stale version	Browser	Defects 5, 13
Import CSV: missing/extra columns, blank cell, bad gas, reordered, quoted "", CRLF and blank rows, file upload, atomic rejection, in-file duplicate	Browser	Atomic rejection holds; defect 12
Export CSV and JSON	Browser	Downloads; defect 11
New order: dependent branch, quantity 0 / 1.5 / 501, past date	Browser	Stale branch clears; defects 1, 12, 14
Dispatch: wrong count, scanner (unknown and lowercase), stale, double-click	Browser	Defect 5
Deliver / Unload / Cancel order	Browser	Pass (closed short delivery)
Collect empties / Receive returns / Report unknown	Browser	Clearing works; defect 9
Create batch / Release / Recall (separate Quality user)	Browser	Defects 1, 4
Send / Receive filled / Receive purchase CSV (header, quotes, malformed, 2026-02-30, duplicates, unclosed quote, atomic)	Browser	Defects 3, 8, 10
Invoice / Rental / Payment / Deposit / Refund / Credit: tax −1 / 100.5 / 12.345, amounts 0 / 0.001 / over balance, duplicate UPI reference, overlapping period, future period	Browser	Defects 1, 2, 12, 14
Resolve exception	Browser	Pass
Settings profile; Add/Edit member (short password, duplicate email, disabling self)	Browser	Defect 16
Details modals, Print label, Print challan, Print invoice (print media)	Browser	Pass
Offline "Save evidence on device", repeat guard, Sync	Browser	Pass; defect 17
Demo walkthrough, all 8 chapters (Operations)	Browser	All navigate; billing chapter correctly disabled
375×667 and 768×1024 layouts, modal scroll, nav drawer	Browser	No horizontal overflow; submit reachable
Focus trap, Escape, focus return	Browser	Pass except after an error (defect 6)
Money units: ₹12,500.50 was sent as 1250050 paise and ₹100.10 as 10010, and both displayed correctly.

C) Past-bug retest
Undeclared fields in payloads (e.g. cylinderIds on Add customer): fixed. Every action request body I captured contained only declared fields. The one path that can still send extra keys is Import CSV, which passes through any extra CSV columns; the server rejects them.
Customer saved as Supplier and vanishing: fixed. Add customer offers only Hospital, Homecare and Industrial. Suppliers never appear under Customers. Reclassifying through Edit is intentional and the record moves to Suppliers.
Search/filter hiding new records: partially fixed. Fixed for Customers and Suppliers only (defect 1).
Dependent choices going stale: mostly fixed. Changing branch, customer or supplier clears dependent selections, and they are not sent. Remaining problems are defect 3 (over-clearing) and defect 9 (stale list).
Open forms using an old revision: partially fixed. The revision refreshes after a 409 and entered values are kept, but options and versions captured when the form opened stay old (defect 5).

===========
Finance audit of Cylvero (port 4313, fresh seeded data) is finished. I found 1 high, 6 medium and 11 low defects. The server-side money rules held up well: amounts must be whole paise, overpayment and double posting are blocked, and tax rounding is exact. The problems are in audit visibility, how issued invoices display the GSTIN, same-day rental billing, and the finance screens.

The project folder was not changed: git status matches the starting snapshot. I only used my own instance, stopped it at the end (pids 56137 and 56188), and did not touch data/. Evidence is in /private/tmp/claude-501/-Applications-CTMS-Batra/bdd3749c-7b6d-4af3-acd7-94708c2d797e/scratchpad/a3/ ($S/a3 below). Each script has a .out file next to it: rental.ts, finance.ts, extra.ts, api.mts, audit.mts, defaults.mjs; lib.ts is a shared helper.

A) Confirmed defects
D1 — High — Payments, deposits and refunds never appear in the audit trail. (Reproduced, over the API)

Where: server/app.ts:29-50. The audit filter only lets through events linked to cylinders, parties, orders, batches, invoices, pickups or exceptions. Payment, deposit and refund events are linked to the receipt record (server/domain.ts:1157,1170,1195), and receipt records are not on that list.
Repro: post payments and deposits as finance (15 were posted), then GET /api/audit as the auditor and as the all-branch admin.
Expected: every money movement is visible to audit.
Actual: auditor audit rows 14 {"order.create":3,"party.create":1,…,"finance.invoice":3,…}. There are no finance.receipt, finance.deposit or finance.refund rows, for admin either. /api/export uses the same filter.
Impact: cash movements can't be traced through the app's audit or export. The rows are still written to the stored log; they just can't be seen.
Fix: include receipt IDs, filtered by party branch, in the audit filter.
D2 — Medium–High — An issued invoice can show a GSTIN that was added later. (Reproduced state and ran the exact display code; not seen in a browser)

Where: src/App.tsx:4000-4001, 4018-4020 fall back from the saved invoice details to the current party or company details with ||. A blank GSTIN saved on the invoice counts as missing, so the current value is shown instead.
Repro (finance.ts step 5):
Set the company GSTIN to blank.
Invoice p-home-1, whose GSTIN is blank.
Update the party to GSTIN NEW-GSTIN-9 and the company to NEWCO-GSTIN.
Evidence: the invoice stored "gstin":"" for both sides, yet it displays ["Old Co","NEWCO-GSTIN"] and ["Demo Home Oxygen Service A","NEW-GSTIN-9"].
Impact: a printed historical invoice shows a GSTIN that was never on it. Any legal/GST significance requires specialist verification.
Fix: always use the saved invoice details when they exist; fall back to current details only when no saved details exist at all.
D3 — Medium — The seeded demo invoices have no saved customer or company details. (Reproduced)

Where: server/seed.ts:324-399.
Evidence: after renaming the party and company, inv-seed-2 shows {"billTo":null,"issuer":null,"shownName":"Renamed Home","shownIssuer":"New Co"}.
Impact: in the demo, the "history is preserved" safeguard visibly fails on the pre-loaded invoices.
Fix: add the saved details to the seed invoices.
D4 — Medium — Rental billed "through today" overcharges if a cylinder comes back later that day, and a cylinder delivered after that invoice loses its first day. (Reproduced, script)

Where: server/domain.ts:1096,1114 count an unreturned cylinder as out through the end of today. A return is then stamped today and today is excluded (:878), but it was already billed.
Repro (rental.ts F and F2, free days 0):
Deliver on 09-20.
At 04:00Z on 09-28, bill 09-20 to 09-28: 9 days.
Return at 10:00Z the same day. Under the rule printed on the invoice ("rental return date excluded") the correct figure is 8 days.
A cylinder delivered on 09-28 after that invoice: billing 09-28 alone gives 409 Rental period overlaps issued invoice.
Impact: one day overcharged or lost per affected cylinder. The only fix is to credit the whole invoice.
Fix: don't allow a billing period to end today (end it yesterday at latest), or credit/reissue automatically when a same-day return happens.
D5 — Medium — After a credit note, the screens give no way to re-invoice the order, though the server allows it. (Reproduced state; the screen conditions are read from code)

Where: src/App.tsx:2924 and :3794 hide the order once any gas invoice exists, even one that has been credited.
Evidence: 1j after credit: UI shows Issue invoice? / server allows?: [false,true]. Server-side re-invoicing works: INV-00004 credited by CN-00005, then INV-00006 issued. The Outstanding total is then correct (162400, counted once).
Impact: a credited delivery can't be re-billed from the app and drops out of the "Unbilled deliveries" count.
Fix: ignore credited invoices in both checks.
D6 — Medium — The gas price is entered by a role that can't see it, and finance can't check or change it. (Reproduced, over the API)

Where: the operations order form defaults the price to ₹0 (src/App.tsx:594). Operations see prices as 0 (server/app.ts:94). Only admin and operations may create orders (server/domain.ts:258), and there is no way to edit an order. The invoice form shows no price or total before issuing (src/App.tsx:1085-1110).
Evidence:
Operations created an order at 1 paise: operations see 0, finance sees 1.
Finance order.create → 403.
A zero-price order gives {"tot":0,"st":"issued"}, and a 1-paise receipt on it fails with Amount exceeds outstanding balance. It stays "Issued" with a Payment button forever; the only way out is a credit note.
Fix: let finance own or approve the price, show the amount before issuing, and refuse ₹0 invoices (or treat them as settled).
D7 — Medium — "Recent receipts & deposits" shows the oldest 12, not the newest. (Reproduced over the API; list logic from code)

Where: src/App.tsx:3066 takes the first 12 of a list that is stored oldest-first (server/domain.ts:483).
Evidence: with 18 receipts, the list shows DEMO-RCPT-001 to RCPT-00012; newest receipt … ["RCPT-00018",false].
Impact: deposits and refunds are shown nowhere else in the app, so once there are 12 receipts, new ones become invisible on screen.
Fix: sort newest-first and add paging.
D8 — Low — Credit notes look like receivables. (State reproduced; display from code)

Where: src/App.tsx:3993, 3028-3033, 4052. A credit note is headed "Credit invoice", shows positive amounts, a "Due" date, the status "Issued" in warning colour, and Balance equal to its full amount.
More: the credited original also shows Balance at its full total in the table. Neither document shows the other's number.
Evidence: 3l CN record: {"n":"CN-00004","st":"issued","tot":324800,…}.
Fix: label it "Credit note", show negative amounts or no balance, and link it to the original invoice number.
D9 — Low — Due dates earlier than the issue date are accepted. (Reproduced)

Evidence: a gas invoice with due date 2020-01-01 and a rental invoice with 1999-01-01 were both accepted (extra.ts X1, X2).
Fix: require the due date to be on or after the issue date (IST).
D10 — Low — Duplicate payment references are only checked per customer and method, and cash is exempt. (Reproduced)

Where: server/domain.ts:451-462.
Evidence:
The same bank UTR was accepted for two different customers (X3).
A duplicate cash posting with a new request key was accepted: paid went 150000 → 200000 (3d). A duplicate cash deposit gives 2 rows (4h).
A refund can't reuse the reference of the deposit it returns (409, 4c).
Impact: a mis-keyed customer lets one bank transfer be posted twice. Parallel posts and exact replays are safe (see B).
D11 — Low — Document numbering. (Reproduced)

Where: server/domain.ts:428, 478.
Evidence: invoices and credit notes share one counter (INV-00004, CN-00005, INV-00006), so both series have gaps. Numbering starts at INV-00004 because the seeds are numbered DEMO-INV-001 to 003. Refunds are numbered as receipts (RCPT-00005/refund). One counter covers all branches and never resets by financial year.
Whether this meets GST numbering rules requires specialist verification.
D12 — Low — Default rental billing period is wrong. (Script-executed)

Where: src/App.tsx:1114-1132, 167.
Evidence:
On 31 Mar the default start is 2026-03-03 (month overflow).
Before 05:30 IST the start is one day early (02:00 IST 28 Oct → 2026-09-27), because the date is taken in UTC.
Monthly defaults start on the previous invoice's end date, so they hit the overlap rejection (409) every month.
D13 — Low — Rupee-to-paise conversion uses floating point. (Script-executed)

Where: src/App.tsx:140.
Evidence: 1.005 → 100 paise; tax 18.005% → 1801 bps; 0.015 → 2. Other inputs convert as expected: 0.1 → 10, 0.29 → 29, 1e3 → 100000.
Mitigation: the browser's 2-decimal validation on these fields (the form doesn't disable it) should block these inputs; I inferred this and did not check it in a browser. The server rejects fractions, negatives, null and 1e20 rupees (reproduced).
Fix: convert from the decimal string instead of multiplying floats.
D14 — Low — Offline deliveries start rental at sync time, not handover time. (Inferred from code)

Where: src/offline.ts:144-154 records createdAt but doesn't send it; the server stamps the rental start with the sync time (server/domain.ts:742).
Impact: sync can lag up to 12 hours, which can move the rental start one IST day later and under-bill.
D15 — Low — Other display and consistency issues.

A deposit can be recorded for a supplier (4e).
"Invoices issued" counts credit notes (src/App.tsx:2962).
The printed challan uses the current party and company details, not those at delivery (src/PrintChallan.tsx:28-41).
B) Coverage
Feature / action	Expected	Method	Positive	Negative / boundary	Result	Evidence
Server rejects bad amounts	Whole paise only, ≥0, safe size	API + script	✓	100.5, -1, 0, null, 1e22, huge × tax	Pass	finance.out 2o/3m/3n; api.out
Tax rounding (half-up, bps)	Exact integer half-up	Script	145000@12%	25@18%→5; 5000@1bp→1; 4999@1bp→0; 83333@5%→4167; 15001@2.5%→375	Pass	finance.out §2
Credit note equals original	Same subtotal, tax, total	Script	8 cases	—	Pass	finance.out §2, 1e
Invoice gating	Blocked while stock on vehicle; short delivery bills delivered only; no duplicates	Script	closed_short qty=1	partial→400; duplicate→409; deliver after invoice→400	Pass	finance.out 1a-1i
Re-invoice after credit	Allowed, no double count	Script + code	Server OK, outstanding 162400 once	Screens hide it	D5	1f-1j
Receipts	Partial, full, no overpay	Script + API	Partial→partial, full→paid	Overpay, paid, credited invoice, credit note → 400	Pass	finance.out §3
Receipt concurrency / replay	Posted once	API	5 parallel → 1×200, 4×400	Same revision → 1×200, 2×409; replay → 1 row	Pass	api.out
Duplicate reference	Blocked	Script	UPI case-insensitive → 409	Other customer, cash → accepted	D10	3b-3d, X3
Deposits / refunds	Refund ≤ deposit balance	Script	Refund 350000 OK	>balance 400; party with standard-deposit amount but no receipts 400	Pass (rules missing, see C)	4a-4f
Rental free days / boundaries	Start inclusive, return excluded, free days from start	Script	0/1/3 free days; same day→0; +1→1	Free days not re-granted across periods; 18:29Z vs 18:31Z → 09-10 / 09-11; future end rejected at IST boundary	Pass	rental.out A-E
Rental same-day billing/return	No overbilling	Script	—	9 billed vs 8 due	D4	rental.out F
Rental overlap / credit then rebill	409; rebill allowed	Script	Rebill OK	Shared boundary day → 409	Pass	E, G, X8
Customer-owned cylinders / rate change / moving customers	0 rate; rate fixed at delivery; split per customer	Script	c-010 rate=0; 18000 kept after update to 99900; A 2 days / B 16 days	—	Pass (rule ambiguous)	H, I
Invoice detail snapshots	Saved details shown	Script + code	Name/address kept	Blank GSTIN falls back; seeds have none	D2, D3	finance.out §5
Role visibility	Ops, quality, driver see no finance data	API	Invoices/receipts/rentals 0, prices 0, rates 0	Posting finance actions → 403 / read-only	Pass	api.out
Audit of money movements	Visible to auditor	API	—	0 receipt/deposit/refund rows	D1	audit.out
Receipts list, outstanding total	Newest shown; credited excluded	API + code	Outstanding excludes credited and credit notes	Oldest-first list	D7	api.out
Existing automated suite	—	Existing log $S/test.log	80/80 pass	Does not cover D1, D2 (display), D4, D5, D7	—	—
C) Missing or unclear finance rules, and demo simplifications
Missing rules

Credit limit is stored but never checked.
There is no partial credit and no credit or refund path for a partly or fully paid invoice. A wrong paid invoice can't be corrected, and there is no customer credit balance.
A deposit refund ignores cylinders the customer still holds and unpaid invoices. The party's "Standard deposit" amount has no link to deposits actually received.
There are no customer statements, ageing, overdue flags or deposit-balance display. "Outstanding" is one total for all visible branches.
A change to a customer's rental rate or free days never applies to cylinders already out (the rate is fixed at delivery). Is that intended?
Rental stays on until the cylinder is received back at the plant, including time on the pickup vehicle.
There is no rounding of totals to the rupee.
Demo simplifications (not defects), all requiring specialist verification

One tax rate per invoice, no CGST/SGST/IGST split, no HSN or place of supply.
12% on medical oxygen, and the same rate for rental and gas.
Numbering not by financial year; no e-invoice, TDS or refund voucher.
