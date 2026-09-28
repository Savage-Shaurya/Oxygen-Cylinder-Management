# Client demonstration — a cylinder’s complete journey

Use the **Demo walkthrough** button in the application header as the chapter guide. It opens real screens; chapter checkmarks are presentation notes, not claims that a business event happened.

## Before the meeting

Allow 15–20 minutes. Use only the synthetic accounts and sample details. Do not enter real patient names or prescriptions. Rehearse once using a separate fresh demonstration file:

```sh
npm run demo:new -- data/rehearsal.sqlite
CTMS_DB_PATH=data/rehearsal.sqlite npm run dev
```

Stop any existing local preview first so ports 5173 and 3001 are available. For the meeting use another filename, such as `data/client-demo.sqlite`. The command refuses to overwrite an existing database. Existing work is preserved. Relative sample dates are generated when the file is created.

All demo roles use password `OxygenDemo!2026`. Start as `admin@batra.demo`. Explain that Administrator is used to navigate the whole story; operations, quality, finance and driver accounts have narrower screens and server-enforced permissions. Quality release still requires someone other than the filling actor.

## The story

1. **Morning overview — 2 minutes.** Show total fleet, ready stock, customer holdings, open orders and safety attention. Open a cylinder: manufacturer serial is its identity, the replaceable scan tag finds it, owner differs from current custodian. Show dated movement history. Avoid implying all 84 cylinders are ready for supply.
2. **Plant production — 3 minutes.** Sign in as `operations@batra.demo`. Select a serviceable empty medical oxygen cylinder at Delhi for a fill batch (for example eligible tags around 00029–00046). Enter a clearly marked demonstration source/operator reference. Show that the batch waits for quality. Sign in as `quality@batra.demo`, release with `DEMO-QC-PRESENTATION` and a demonstration review note. Alternatively use the existing awaiting-release sample batch for a faster walkthrough. The same filling actor cannot release their own batch.
3. **Supplier path — 1 minute.** Explain that the company can buy filled cylinders or send empties for refill. Show supplier receipt fields and the resulting awaiting-release state. This uses the same quality gate; supplier delivery is not automatic permission to dispatch.
4. **Hospital order — 3 minutes.** As Operations create a two-cylinder Medical oxygen / B order for Demo North Care Hospital, Delhi. Use a sample unit price such as ₹350. Dispatch two eligible tags, a sample vehicle such as `DL01DE1234`, and Driver. Open the manifest and print preview. Only safe released stock is offered.
5. **Partial delivery — 2 minutes.** Record acceptance for one tag with recipient `Demo receiving officer`. Unload the remaining tag at the plant with a reason. Open the record again: requested quantity and original manifest remain visible, the accepted and unloaded units differ, and the order closes short. Unloaded stock requires inspection before reuse. For driver permissions, sign in as `driver@batra.demo` and show only assigned work. Offline evidence is queued in the loaded browser; it is not a full offline boot experience.
6. **Return loop — 2 minutes.** Collect a customer-held cylinder on the driver's current route, then sign in as Operations to receive it at the warehouse. Alternatively demonstrate direct physical warehouse receipt. The custody/rental interval closes at warehouse receipt under this demo's policy. Show inspection hold and discrepancy intake for an unexpected serial. Do not silently add an unknown cylinder to stock.
7. **Money — 2 minutes.** Sign in as `finance@batra.demo`. Invoice only the accepted quantity; record a sample payment reference. Show separate rental, deposit and refund records. Rental rates/free days are snapshots for each custody interval. Customer-owned cylinders do not accrue rental charges. A full credit note is a separate preserved document, not deletion of an invoice. These are demonstration documents; official tax formats and integrations remain client acceptance items.
8. **Recall and evidence — 2 minutes.** Do this last because it deliberately changes stock availability. Quality recalls a released sample batch with reason `Demonstration recall`. Show affected cylinders held even at customer locations and the recovery exceptions. Sign in as Auditor to show read-only reports, activity and export. End on the overview.

## Useful failure demonstrations

- Attempting quality release as the filling actor: rejected; no stock released.
- Wrong count at dispatch: rejected; manifest and stock unchanged.
- Returning a cylinder against the wrong customer: rejected; no false balance reduction.
- Trying to invoice or collect payment above the supported outstanding amount: rejected.
- Retrying a saved command after an ambiguous network response: same identity prevents duplicate posting.

The server enforces these rules even if a caller bypasses the interface. Use automated regression results for concurrency/recovery claims; do not interrupt the presentation server to simulate failure during a live client meeting.

## Say clearly

This is a working demonstration of operational workflows and controls. Tally/accounting, WhatsApp, payments, official IRN/e-way bill, GPS and reader-specific RFID integrations are not connected. Camera scanning and print layouts still need the client's devices. Physical safety, licensing, tax treatment, opening balances, backup operations and real deployment need client validation. The proposed wider roadmap in discovery documents is not a claim that every proposed feature is already implemented.
