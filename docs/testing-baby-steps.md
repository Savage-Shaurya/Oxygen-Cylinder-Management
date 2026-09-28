# Test the demo, one small step at a time

This is a hands-on checklist for the **synthetic demonstration workspace**. Work in order. After every numbered action, compare what you see with **Expect**. If an expectation fails, **STOP**: do not repeat the Save button, change other records, or guess a workaround. Write down the chapter and step, the exact on-screen error, the account used, the time, and a screenshot. A saved business action remains saved after a browser refresh.

## 0. Get ready

1. Open **http://localhost:3004** in a browser. **Expect:** the Cylvero sign-in screen says **Local demonstration · Synthetic data only**. **STOP** if it opens the everyday workspace at port 5173, shows live mode, or does not load; check that the separate test preview is running.
2. This preview uses the new, persistent **`data/testing-demo.sqlite`** test dataset. Do not reset or seed any existing database. **Expect:** the test records persist after refresh and remain separate from the normal 5173 workspace.
3. Use made-up names only. Do not type actual patient, customer, cylinder, tax, bank, or employee information. Use today’s calendar date for date fields unless a step says otherwise; choose a test due date several years in the future and a last test date in the past.
4. The demo accounts below all start with password **`OxygenDemo!2026`**. Use **Sign out** before changing roles, then select the next **Demo account** and press **Sign in**.

| Role | Demo account | What this guide uses it for |
| --- | --- | --- |
| Administrator | `admin@batra.demo` | New records, dispatch, plant receipt, settings, exceptions |
| Operations | `operations@batra.demo` | Stock, customers, suppliers, orders |
| Quality | `quality@batra.demo` | Inspection, independent batch release, recall |
| Finance | `finance@batra.demo` | Invoices, receipts, deposits, credits |
| Driver | `driver@batra.demo` | Assigned delivery and route collection |
| Auditor | `auditor@batra.demo` | Read-only review and permitted exports |

5. Sign in as Administrator. **Expect:** **Overview** opens. The left menu has **Cylinders**, **Production**, **Orders & delivery**, **Customers**, **Suppliers & purchases**, **Billing & rentals**, **Safety**, **Reports & audit**, and **Settings**. On a phone, first open the navigation menu.
6. Write down the current workspace revision shown near the top. Click **Demo walkthrough** if you want the short presenter outline, then close it. Its chapter checks are notes, not evidence that an action occurred.

Use these names in the main journey and write down any automatically generated order, batch, invoice, and receipt numbers in the right column:

| Item | Type or record |
| --- | --- |
| Test cylinder A | serial `TEST-SER-A-0928`, tag `TEST-A-0928` |
| Test cylinder B | serial `TEST-SER-B-0928`, tag `TEST-B-0928` |
| Manufacturer | `Synthetic Test Works` |
| Customer | existing **Demo North Care Hospital** in Delhi |
| Gas and size | **Medical oxygen**, **B** |
| Branch | **Delhi** |
| Vehicle | `DL01TEST2026` |
| Driver | demo **Driver** account |
| Fill source / operator | `TEST-LOT-0928` / `Demo filling operator` |
| Batch number | ____________________ |
| Order number | ____________________ |
| Invoice number | ____________________ |
| Payment reference | `TEST-PAY-0928-A` |

If a tag or serial already exists, **STOP**; this test database was used before. Do not silently switch to a different tag.

## 1. Register and inspect two empty cylinders

1. As Administrator, click **Cylinders** → **Register cylinder**.
2. Enter cylinder A’s serial, tag, and manufacturer from the table. Choose **Medical oxygen**, size **B**, **Company owned**, branch **Delhi**, and **Empty** for **Current contents**. Set **Last test date** to a past date, **Next test due** to a future date, and **Certificate reference** to `TEST-CERT-A-0928`. Click **Register cylinder**. **Expect:** the form closes and searching `TEST-A-0928` finds exactly one cylinder in inspection hold. **STOP** if it is immediately dispatch-ready or duplicate.
3. Repeat step 2 for cylinder B, using `TEST-CERT-B-0928`. **Expect:** searching `TEST-B-0928` finds exactly one separate cylinder.
4. Open A’s **Details**. Check **Owner**, **Current custodian**, **Current contents**, **Record version**, **Identity label**, and **Movement timeline**. **Expect:** company ownership, plant custody, empty contents, and a registration event. Close the detail.
5. Click A’s **Inspect** or open its detail and click **Record inspection**. Choose **Serviceable**, keep the valid dates and certificate, enter `Synthetic pre-fill check A` in **Inspection notes**, and click **Record inspection**. Repeat for B with note `Synthetic pre-fill check B`. **Expect:** both show **Serviceable**, **Empty**, and plant custody. **STOP** if either remains held or appears full without a fill batch.

## 2. Fill, then independently release the batch

1. As Administrator, click **Production** → **Create batch**. Choose **Medical oxygen**, branch **Delhi**, and select only `TEST-A-0928` and `TEST-B-0928` under **Cylinders to fill**. Enter `TEST-LOT-0928` for **Gas source / lot reference** and `Demo filling operator` for **Fill operator**. Save the batch. **Expect:** a new batch says **Awaiting release**; note its number. The two cylinders must not be dispatchable yet.
2. Click **Sign out**. Sign in as `quality@batra.demo`. Go to **Production**, search the batch number, open **Details**, and click **Release batch**. Enter certificate `TEST-QC-0928` and **Release notes** `Synthetic independent check`; click **Release batch**. **Expect:** the batch becomes **Released**, with the quality actor and certificate visible. **STOP** if the creator can release their own batch or either cylinder stays in an unsafe hold.
3. Sign out and return as Administrator. Search A and B in **Cylinders**. **Expect:** both are full, serviceable, at the plant, and associated with the released batch.

## 3. Order, dispatch, and print the manifest

1. Click **Orders & delivery** → **New order**. Choose **Demo North Care Hospital**; verify branch **Delhi**. Choose **Medical oxygen**, size **B**, quantity **2**, priority **Normal**, and today for **Requested date**. If shown, put **₹350.00** in **Gas price per cylinder**. Enter **Order notes** `Synthetic two-cylinder test`; save. **Expect:** a new **Open** order appears. Write down its number.
2. Open that order by its number; on a narrow phone screen the number is the dependable way to open actions. Click **Dispatch order**. Select A and B under **Scan or select exact cylinders**. Enter `DL01TEST2026` for **Vehicle registration**, choose the demo driver, and click **Confirm dispatch**. **Expect:** the order says **Dispatched**, and its **Dispatch manifest** lists A and B as **On vehicle**. Both cylinders now have vehicle custody.
3. In the order detail, click **Print challan**. **Expect:** a print preview or browser print window with the order number, original issuer/customer identity, A and B, and demonstration wording. Cancel physical printing if no test printer is available. **STOP** if a historical document silently uses changed present-day identity or omits a manifest tag.

## 4. Accept one cylinder and unload the other

1. Sign out and sign in as `driver@batra.demo`. Open **Orders & delivery**, find the order number, then click its number → **Record delivery**. Select only `TEST-A-0928` under **Accepted cylinder tags**. Enter **Recipient name** `Demo receiving officer` and **Delivery evidence / notes** `Synthetic handover, A only`. Click **Record acceptance**. **Expect:** one accepted cylinder, one still on the vehicle, and a recorded recipient. **STOP** if B is also accepted or the order is already ready to bill.
2. Sign out and sign in as Administrator. Open the same order and click **Unload remainder**. Select only B. Choose **Not verified — hold for inspection** for **Seal checked on every selected cylinder**. Enter **Reason / handover notes** `Synthetic short delivery; B returned to plant`; save. **Expect:** the order says **Closed · short delivery**. Its original request is still 2, the manifest shows A **Accepted** and B **Unloaded**, and B is held at the plant for inspection.
3. Reopen **Print challan**. **Expect:** the copy shows one accepted and one unloaded cylinder. It still says that it is a movement document, not a tax invoice.

## 5. Invoice only the accepted unit and record payment

1. Sign out and sign in as `finance@batra.demo`. Click **Billing & rentals**. Under **Accepted deliveries**, locate the order number and click **Issue invoice**. Check that the form describes **1 accepted cylinder**, set **Gas unit price** to **₹350.00** if asked, keep the displayed tax rate, set **Payment due** to today or a later date, and add `Synthetic invoice` to **Invoice notes**. Click the save button. **Expect:** one gas invoice for A, not both A and B. Note its number and displayed **Total**. **STOP** if the bill includes B or a zero price.
2. Click the invoice number or **Details / print**. Check **BILL TO**, issuer, one line item, tax, total, paid, and balance. Click **Print invoice**, inspect the browser print preview, then cancel printing. **Expect:** the saved identities and amounts match the invoice. The demonstration warning remains visible.
3. Click **Record payment** for this invoice. Set **Amount received** to the exact remaining **Balance**, choose **Bank**, enter reference `TEST-PAY-0928-A`, and save. **Expect:** the invoice says **Paid**, its balance is ₹0.00, and the new receipt appears at the top of **Receipts & deposits · newest first**. **STOP** if it stays unpaid or another receipt is created by one click.

## 6. Return A to the plant and refill it

1. Sign out and return as Administrator. In **Orders & delivery**, click **Receive returns**. Choose **Demo North Care Hospital**, select only A under **Returned cylinder tags**, choose the intended **Receiving branch** (**Delhi** for this main journey), **Empty** for **Contents on return**, and note `Synthetic empty return of A`. Save. **Expect:** A moves from customer custody to the Delhi plant; the customer holding decreases by one. Its rental interval closes at plant receipt.
2. Open A in **Cylinders**. Check **Movement timeline**, then click **Record inspection**. Record a serviceable post-return inspection with a valid certificate and dates. **Expect:** A is empty, serviceable, and eligible for a new fill batch. **STOP** if its former delivered batch appears to authorize this refill automatically.
3. In **Production**, click **Create batch**. Select only A, enter a new synthetic source `TEST-LOT-REFILL-A`, and save. Sign out, sign in as Quality, open the new batch, and **Release batch** with a new certificate `TEST-QC-REFILL-A`. **Expect:** A again becomes full released stock after an independent review; its timeline retains the first dispatch and return.

## 7. Additional stock and supplier checks

Use other synthetic records for these checks. Leave A and B’s finished journey intact.

Before the stock checks, test the customer directory. As Administrator, open **Customers** → **Add customer**. Enter `Demo Test Clinic 0928`, choose a customer **Party type**, synthetic contact/phone/address/city, branch **Delhi Plant & Distribution**, a small **Credit limit**, **Daily rental per cylinder**, **Rental free days**, and **Standard deposit**. Save. **Expect:** the customer appears in search and its **Details** show zero current holdings. Click **Edit** and change only its synthetic contact, then save. **Expect:** the change is visible without creating a second customer. Supplier types belong under **Add supplier**, not this form.
1. **Retag:** As Administrator, choose a plant-held cylinder in **Cylinders** → **Details** → **Replace tag**. Enter a unique tag such as `TEST-RETAG-0928` and reason `Damaged demo label`; save. Search both the old and new tags. **Expect:** the new tag is current, the old tag still finds the same cylinder in **Previous tags**, and movement history remains attached to that cylinder.
2. **General cylinder import:** In **Cylinders**, click **Download import template**. Open the downloaded `cylinder-import-template.csv`. **Expect:** the exact header below. Add the sample row, save it as CSV, click **Import CSV**, select the file, and save. **Expect:** one new held cylinder. The **Cylinder CSV** report export has different columns and is not an import template. **STOP** if the template header differs or a malformed/duplicate row partly imports.

   ```csv
   serial,tag,manufacturer,gas,size,ownerId,branchId,testDue,lastTest,certificate
   TEST-IMPORT-SER-0928,TEST-IMPORT-TAG-0928,Synthetic Test Works,Medical oxygen,B,company,b-delhi,2031-01-01,2026-01-01,TEST-IMPORT-CERT
   ```

3. **Purchase receipt:** In **Suppliers & purchases**, click **Receive purchase**. Choose a Delhi supplier and matching branch, **Medical oxygen**, and unique reference `TEST-PO-0928`; paste the separate CSV below into **Or paste cylinder CSV**. Save. **Expect:** the new asset is held for quality review; it is not immediately dispatchable. Do not use the general import template here: purchase CSV has eight columns because supplier, gas, and branch are form fields.

   ```csv
   serial,tag,manufacturer,size,ownerId,lastTest,testDue,certificate
   TEST-PURCHASE-SER-0928,TEST-PURCHASE-TAG-0928,Synthetic Test Works,B,company,2026-01-01,2031-01-01,TEST-PURCHASE-CERT
   ```
4. **Supplier test service:** In **Suppliers & purchases**, click **Send cylinders**. Choose **Hydrotest / inspection**, a supplier, an eligible plant-held cylinder, and unique **Transfer reference**. Save. Then **Receive from supplier**, choose the same supplier and cylinder, **Test / inspection only**, and the actual contents observed. Enter a new **Supplier delivery reference** and save. **Expect:** supplier custody ends; the record is held pending inspection. Test-only receipt must not create filled dispatch stock.
5. **Supplier refill:** Repeat on another eligible empty cylinder with **Refill** and later receive it with **Service performed: Refill** and **Actual contents received: Full**. **Expect:** an awaiting-quality batch, followed by independent **Release batch** before dispatch.
6. **Owner permission:** If using a cylinder owned by a supplier or another customer, look for **Owner permission reference** on relevant send, dispatch, inspection-retirement, or writeoff forms. Enter a synthetic permission reference only when the owner has actually authorized that test scenario. **Expect:** a missing required permission is rejected. Do not interpret the UI as proof that legal consent was obtained.
7. **Emptying and retirement:** On a separate plant-held full synthetic cylinder outside any awaiting-release batch, a trained test operator can use **Details** → **Record emptying**, choose **Venting** or **Evacuation**, and enter an evidence note. **Expect:** contents become empty and the old gas batch no longer authorizes dispatch. On a separate company-owned, plant-held test cylinder, choose **Record inspection** → **Retired**, with a reason. **Expect:** the asset remains in history but cannot be retagged, filled, or dispatched again. Never retire A or B during the main journey.

## 8. Custody, exceptions, and safety checks

1. **Collection and undo:** As Administrator or assigned Driver, use a seeded customer-held cylinder in **Orders & delivery** → **Collect empties**. Choose its customer, exact tag, a sample vehicle, and driver; save. **Expect:** the cylinder is on the collection vehicle, not yet at the plant. Before any plant receipt, as Administrator click **Undo collection**, choose that collection and tag, enter a correction reason, then save. **Expect:** it returns to customer custody, with an audit trail. Repeat collection if you want to continue, then use **Receive returns** for the physical plant receipt. **STOP** if undo is offered after a plant receipt.
2. **Cross-branch return:** As Administrator, find a seeded **company-owned**, customer-held cylinder with a known original branch. In **Receive returns**, select that customer and tag; choose the actual **Receiving branch**. Use a different authorized branch only for this synthetic transfer test. **Expect:** the receiving branch is recorded on the movement and current stock. Third-party-owned cylinders must return to their owner/source branch; trying another branch is rejected. Check authorization with a narrower Operations account separately; it must not gain access to branches outside its assignment.
3. **Unknown return:** Click **Report unknown** in **Orders & delivery**. Enter a made-up observed serial and evidence note. **Expect:** an open exception appears in **Safety**; no cylinder is silently created and no custody total changes. Open the exception and use **Resolve exception** only after recording an actual synthetic reconciliation explanation.
4. **Reject one batch member:** Create a separate two-cylinder awaiting-release batch. As Quality open its detail and click **Reject cylinder** for one tag; enter a reason. **Expect:** that tag is quarantined, while the remaining batch member can still be reviewed for release. If there is only one member, use the batch’s recall path rather than expecting **Reject cylinder**.
5. **Recall:** As Quality, choose a released synthetic batch in **Production** → **Details** → **Recall batch**. Enter `Synthetic recall drill`. **Expect:** associated current gas is held even when a cylinder is offsite; **Safety** shows recall attention and the batch detail shows attributable recipients where snapshots exist. A legacy record may say its old recipient snapshot is unavailable. Do this last for that batch because it changes stock availability.
6. **Offsite incident and rental stop:** Choose a different synthetic customer-held cylinder. As Administrator, open its **Details** → **Report loss / damage**, choose **Lost** or **Damaged**, and record the evidence. **Expect:** an exception and an offsite hold, with no invented plant return. If authorized for the policy test, use **Approve rental stop** with a date and reason. **Expect:** the chosen stop date is recorded and already billed days are not silently erased.
7. **Lost-cylinder writeoff:** Only for a separate synthetic lost cylinder, use **Write off lost cylinder** with **Rental stop date**, approval reason, and **Owner permission reference** if third-party owned. **Expect:** the asset is retired, the loss investigation is closed, rent stops on the approved date, and no plant return is invented. This is irreversible in the workflow; keep it away from A and B.
8. **Open-order cancellation:** Create a separate synthetic one-cylinder order and leave it **Open**. In its **Orders & delivery** row click **Cancel**, enter a **Cancellation reason**, then confirm. **Expect:** it says **Cancelled** with no dispatch movement. Cancellation of an already dispatched order should not be offered.

## 9. Finance corrections and guards

Sign in as `finance@batra.demo` for ordinary financial actions. Switch to Administrator only for the explicit override checks. Keep a separate synthetic invoice or customer for each correction so one test does not consume the balance needed by another.

1. **Rental timing:** Open **Billing & rentals** → **Rental invoice**. For a customer with a seeded older custody interval, use a period ending **no later than yesterday**. **Expect:** only supported, previously unbilled custody days are charged. Do not try to bill A’s same-day delivery/return today; same-day or current-day rent is not ready to bill. If no eligible historical interval is shown, mark this check **not run** and ask the test host for a separate historical fixture; do not change system time.
2. **Partial credit:** Pick a synthetic unpaid invoice other than A’s paid invoice. Click **Credit**, enter a credit amount below its remaining total and a reason, then **Issue credit note**. **Expect:** the original remains visible, a linked credit note appears, and only the corrected amount remains due.
3. **Paid credit:** Choose a separate paid synthetic invoice. Click **Credit**, enter an allowed amount and reason, then **Issue credit note**. **Expect:** the overpaid part becomes customer credit, with an intact original invoice and payment record. Use **Apply credit** against an eligible unpaid invoice for the same customer, or **Refund credit** with a new bank reference. **Expect:** only available credit can be applied or refunded; double spending and cross-customer use are rejected. Do not reuse A’s paid invoice if you still need it as the main journey proof.
3a. **Undo credit allocation:** If step 9.3 applied a credit, in **Billing & rentals** click **Undo credit allocation**. Choose its **Credit allocation** receipt, enter a written **Reversal reason**, and click **Undo allocation** before using the credit elsewhere. **Expect:** the target invoice balance and available customer credit are restored once; the original credit note and audit history remain. Do not attempt this for a bank payment or a credit already refunded.
4. **Deposit guard:** Click **Record deposit**, choose a synthetic customer, an amount such as ₹100, method **Bank**, and unique reference `TEST-DEP-0928`; save. **Expect:** a deposit receipt at the top of the ledger. Click **Refund deposit** for a smaller amount. If that customer still holds cylinders or owes money, ordinary refund must be blocked. Only Administrator has **Liability exception approval** for a deliberate override; enter an actual approval reason when testing it. **Expect:** a refund never exceeds the remaining deposit, and the original deposit receipt remains.
5. **Credit limit:** On a separate synthetic customer with a low limit, try an invoice that exceeds the limit. **Expect:** Finance is blocked; Administrator can enter **Credit-limit exception reason** for a deliberate test approval. No override should appear for Finance.
6. **Duplicate references:** Try to reuse the same non-cash **Payment reference** for the same customer/method on another payment. **Expect:** a clear rejection and no extra receipt. Use a unique reference for any legitimate second payment.

## 10. Stale forms, offline evidence, and account access

1. **Stale form:** Open an eligible plant cylinder in two Administrator tabs. In tab A open **Record inspection** and leave it open. In tab B use **Replace tag** on that same cylinder with a new synthetic tag and reason. Return to tab A and click **Record inspection**. **Expect:** a conflict message, no second change, and **Reload latest form**. Click it; review the refreshed record version and choices. Text notes should remain where safe; unavailable choices should be cleared. For customer/settings edits, latest saved fields replace the old draft so another person’s change is not silently overwritten. **STOP** if repeated Save posts stale data.
2. **Save device evidence:** Use a separate dispatched synthetic order assigned to Driver. In its **Record delivery** form, choose the exact accepted tag and recipient, then click **Save evidence on device** even while the browser is online. **Expect:** a **Field evidence sync** panel with **Review evidence** and **Sync deliveries**. The shared order stays in its pre-acceptance state until sync succeeds; local evidence is a claim, not server acceptance.
3. **Review and sync:** Click **Review evidence**. Check order, tag, recipient, handover time, evidence ID, and any error. Click **Sync deliveries**. **Expect:** accepted evidence leaves the local queue and appears once in server custody. If sign-in expires, sign in as the **same user** and retry; the original evidence identity and handover time remain. Do not clear browser data while evidence is pending.
4. **Offline conflict:** For a separate synthetic order, save device evidence, then make a conflicting accepted delivery or custody change in another tab before syncing. Click **Sync deliveries**. **Expect:** the entry says **Needs office review**, displays the server error, and does not automatically replay. Click **Download evidence for office review** and confirm the JSON contains the original event ID, time, order, cylinder IDs, recipient, and notes. That download is unencrypted private data. Reconcile with the server record before using **Discard reconciled evidence**; discarding is not a server reversal. **STOP** if a conflict silently replaces server custody or creates a second delivery.
5. **Manual account controls:** As Administrator open **Settings** → **Add member**. Use a made-up email, temporary password, role, and branch access. **Expect:** the member appears only within the authorized scope. Use **Edit access** to disable that test account or change its role. **Expect:** prior sessions lose access. Use **Reset password** only on the test member and verify its old password fails. The user’s **Change my password** ends their sessions; do not change shared demo account passwords unless the test host plans to restore this isolated dataset.
6. **Role boundary:** Sign in as Driver and verify only assigned work/actions are offered. Sign in as Auditor and verify **Reports & audit** can be read while action buttons for dispatch, release, payment, and settings edits are absent. **STOP** if a read-only user can save a business change.
7. **Company profile:** As Administrator, open **Settings** → **Edit profile**. Check **Company name**, **Business address**, **GSTIN**, **Default tax rate (%)**, and **Rent for supplier-owned cylinders**. In this separate test dataset, change the company name to `Synthetic Company Profile Test`, leave the other choices as they are, and save. **Expect:** the profile shows the new name while previously issued document identities stay as recorded. The supplier-owned rental choice affects later rental calculations; record the displayed option and use a separate test if changing that policy.

## 11. Search, reports, documents, and device checks

1. Search `TEST-A-0928` in **Cylinders**, then search its serial. Use the status filter pills. **Expect:** the same asset appears; its current tag and past tags resolve to one identity. Search the order number in **Orders & delivery**, and use **Closed · short delivery**. **Expect:** the main order is easy to find.
2. Open **Reports & audit**. Check **Stock position**, **Movement ledger**, and **Audit trail** tabs. Search a test tag and the order number. **Expect:** movements and actor/time entries match the steps you actually saved. Some roles see scoped data; Administrator and Auditor may download **Full JSON export**. **Cylinder CSV** is an operational report, not an import file.
3. Open the main order’s **Print challan** and invoice’s **Details / print** → **Print invoice**. **Expect:** both are clearly demonstration documents, with their recorded identities and correct movement/amount facts. For legacy documents lacking a saved identity snapshot, the printout must say the historical identity is unavailable; it must not substitute today’s contact details.
4. On a phone-sized window (about 375 × 667), open an order by its number, open **Record delivery**, and inspect **Cancel**, **Save evidence on device**, and **Record acceptance** without horizontal clipping. Test keyboard focus in a form: an error should be announced/focused, and Tab should remain in the dialog. Capture screenshots of any failed layout.
5. If a real test scanner, camera, label printer, or paper printer is available, have a trained operator check one exact tag and a test print. **Expect:** one scan commits one exact tag, no partial tag match, and the printed label/challan is legible. Mark hardware **not run** if the actual devices are unavailable. Browser preview alone does not prove physical output.

## 12. Backup and finish

1. Ask the test host to take an application/database backup of the isolated `data/testing-demo.sqlite` dataset while following its backup procedure. **Expect:** a dated backup file that can be read and restored in a **separate** test location. Never restore over the normal workspace or this active test dataset just to prove the step.
2. Refresh the test browser. **Expect:** saved test records still exist. Sign in as Administrator and recheck A, B, the order, invoice, receipt, and audit trail. Record the final revision, pass/fail/not-run for each chapter, and the screenshot filenames. The test host can keep this persistent dataset as evidence.
3. List separately anything **not run**: actual offline network interruption on a field phone, browser storage recovery after device loss, physical scanner/camera/printing, production proxy/TLS, statutory tax documents, offsite backup restore, and external accounting, GST, messaging, payment, GPS, or RFID services. Those integrations are shown as **Unconfigured** in **Settings** and this guide does not claim they were exercised.

## Coverage map

| Area | Steps |
| --- | --- |
| Roles, sign-in, scope, passwords, profile | 0, 10.5–10.7 |
| Customer directory, cylinder identity, inspection, fill, release, retag, CSV, retirement | 1–2, 7 introduction, 7.1–7.2, 7.7 |
| Order, exact dispatch, partial delivery, unloading, returns, cancellation | 3–4, 6, 8.1–8.2, 8.8 |
| Supplier service, purchase, ownership authorization | 7.3–7.6 |
| Invoice, receipt, rental, credit, deposit, credit limit | 5, 9 |
| Recall, batch rejection, incidents, exceptions, writeoff | 8 |
| Concurrency and field evidence | 10.1–10.4 |
| Search, audit, export, print, phone, hardware, backup | 11–12 |

An empty checkbox is not a pass. Write **Pass**, **Fail**, or **Not run** next to each chapter after observing the expected result.
