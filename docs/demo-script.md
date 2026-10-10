# Cylvero demo script

For the presenter. Plain steps. Read it once the night before, then rehearse it once.
Every click below was rehearsed in a real browser on the live site.

**Be honest about one thing at the start.** This is a demo with made-up data. Every
customer, hospital, person, phone number, GST number and amount is fictional. Every name
starts with "Demo" or "DEMO". We do not claim any customers, certifications or medical-gas
approvals. Cylvero is operations software. It does not certify that a cylinder is safe.

Live site: https://cylvero.vercel.app

---

## 1. Pre-demo checklist (30 minutes before)

1. **Reset the demo data.** Sign in as **Admin** → **Settings** → **Reset demo data** →
   **Yes, reset demo data**. Do this on the day of the demo: "due today" and "test expired"
   count from the day of the reset.
2. **Check the server.** Open https://cylvero.vercel.app/api/ready. It should show
   `"database":"ok"`.
3. **Check the starting numbers** on Admin → Overview: 95 cylinders, 84 at plant, 3 on
   vehicle, 6 with customers, 2 with suppliers.
4. **Laptop:** Chrome, one window, zoom 100%. Sign in by tapping a picture card.
5. **Optional phone:** the same office screens work on a phone browser for the driver part.
   Allow the camera once if you want to scan a printed label.
6. **Optional printed labels:** Cylinders → open a cylinder → **Download QR** or
   **Print label**. Otherwise type the tag into the scan box (it works like a scanner).
7. Change the company name ("Batra Oxygen — Demo") in Settings → Edit profile if you prefer.
8. Keep the cheat sheet (last page) next to you.

---

## 2. Sixty-second opening pitch

> "Every oxygen supplier asks three questions every day. Where are my cylinders? Which
> ones are safe to send? Who owes me money for them?
>
> Today those answers sit in registers, WhatsApp messages and memory. Cylinders go missing.
> Rent is not billed. A cylinder with an expired test can go out by mistake.
>
> Cylvero tracks every cylinder by its QR code, from filling, to quality release, to the
> truck, to the hospital, and back, and sends the accounts to Tally.
>
> The system refuses unsafe actions. A cylinder on hold or with an expired test cannot be
> loaded. Nobody can release their own batch.
>
> What you will see is a demo with made-up data. Let me show you one cylinder's journey,
> through six people, on the same records."

---

## 3. Five-minute executive walkthrough

1. **Admin overview (1 min).** Sign in as **Admin**. Overview shows the whole fleet. Click
   **Ready to dispatch**: the exact cylinders open. Every number opens its records.
2. **Safety refusal (1 min).** Sign in as **Godown**. **Orders & delivery** → row
   **DEMO-ORD-008** → **Dispatch**. In the scan box type `DEMO-HOLD-1` and press Enter.
   It is refused: it is on hold. *Notice:* the mistake is stopped before the truck leaves.
3. **Driver delivery (1.5 min).** Sign in as **Driver**. **Orders & delivery** → row
   **DEMO-ORD-007** → **Deliver**. Scan `DEMO-GIVE-1`, `DEMO-GIVE-2`. Recipient:
   "Sister Mary". **Record acceptance**. Rent starts automatically.
4. **Life story (1 min).** Sign in as **Admin** → **Cylinders** → row `DEMO-GIVE-1` →
   **Details** → **Life story**. Every step, with names and times.
5. **Tally (30 s).** Sign in as **Finance** → **Billing & rentals** → **More** →
   **Export to Tally** → **Download Tally XML**. "Your accountant imports this into
   TallyPrime. No re-typing."

---

## 4. Twelve-minute full walkthrough

One story on the same records: **Quality → Godown → Driver → Godown → Finance → Auditor**.

### 0:00 – 1:30 · Admin: the morning picture
1. Sign in as **Admin**. Overview: total cylinders, where they are, what needs attention.
2. Click **Ready to dispatch** to show the exact cylinders behind the number.

### 1:30 – 3:00 · Quality: release today's batch
1. Sign in as **Quality** → **Production** → row **DEMO-BATCH-006** → **Release**.
2. Certificate: `QC-LIVE-001`. Notes: "Purity and pressure checked". **Release batch**.
   *Notice:* the person who filled a batch can never release it.

### 3:00 – 5:00 · Godown: load the truck
1. Sign in as **Godown** → **Orders & delivery** → row **DEMO-ORD-008** → **Dispatch**.
2. Type `DEMO-HOLD-1` in the scan box, press Enter: **refused**. Try `DEMO-EXPIRED-1`:
   **refused**. Read the reasons aloud.
3. Scan `DEMO-LOAD-1` and `DEMO-LOAD-2`. Vehicle: `DL 02 DEMO`. Driver: **Driver**.
   **Confirm dispatch**. *Notice:* the order asked for 2, so exactly 2 are accepted.

### 5:00 – 7:00 · Driver: deliver and collect empties
1. Sign in as **Driver**. The driver sees only their own trips.
2. **Orders & delivery** → row **DEMO-ORD-008** → **Deliver**. Scan `DEMO-LOAD-1`,
   `DEMO-LOAD-2`. Recipient: "Sister Mary". **Record acceptance**.
3. **More** → **Collect empties** → Customer: **Demo Sanjeevani District Hospital**. Scan
   `DEMO-TAKE-1`, `DEMO-TAKE-2`. Vehicle `DL 02 DEMO`. **Save**.

### 7:00 – 8:00 · Godown: empties come back
1. Sign in as **Godown** → **Orders & delivery** → **More** → **Receive returns**.
2. Customer: **Demo Sanjeevani District Hospital**. Scan `DEMO-TAKE-1`, `DEMO-TAKE-2`.
   Notes: "Received empty". **Save**. *Notice:* returned cylinders go to inspection first.

### 8:00 – 10:00 · Finance: bill, collect, send to Tally
1. Sign in as **Finance** → **Billing & rentals**.
2. Under **Ready to bill**, row **DEMO-ORD-008** → **Issue invoice** → save.
3. **Record payment** against it if you want to show a receipt.
4. **More** → **Export to Tally**. Show the ledger names (all editable to match their Tally),
   then **Download Tally XML**. "Gateway of Tally → Import → Masters, then Transactions."

### 10:00 – 12:00 · Auditor, Life story, and recall
1. Sign in as **Auditor** → **Cylinders** → row `DEMO-LOAD-1` → **Details** →
   **Life story**: joined the fleet → safety check → filled → passed quality check →
   loaded on DL 02 DEMO → delivered to Demo Sanjeevani District Hospital.
2. **Reports & audit**: who did what, and when. The auditor can see but not change.
3. **Recall** (do this last, it changes data). Sign in as **Quality** → **Production** →
   **DEMO-BATCH-006** → **Recall batch**. Reason: "Demo recall drill". The batch shows the
   hospital that received it today (DEMO-LOAD-1/2, order DEMO-ORD-008). Cylinders still
   out go on hold, and **Safety** shows recovery tasks.
4. Close: "One cylinder, six people, one record. Nothing was typed twice."

---

## 5. Quick paths (if a step fails or time is short)

- **Deliver without loading first:** Driver → **DEMO-ORD-007** → Deliver →
  `DEMO-GIVE-1`, `DEMO-GIVE-2` (already on the truck).
- **Collect without loading first:** Driver → More → Collect empties → **Demo Shanti
  Community Clinic** → `DEMO-CLINIC-1`.
- **Load without the Quality step:** released stock `DEMO-TAG-00012`, `DEMO-TAG-00013`.
- **No scanner or camera:** type the tag into the scan box and press Enter, tick the
  cylinder in the list, or use the picture button to read a QR photo.

---

## 6. What to say when…

**There is no network.**
"A driver's delivery can be saved on the device and sent when the signal returns. The app
says 'not sure' rather than pretend it saved." Other work needs a connection today.

**A wrong cylinder is refused.**
This is the point. Read the message aloud. "The system stops the mistake before the
cylinder moves, and tells the person why."

**Someone asks about Tally.**
"Built. Billing → Export to Tally gives a file your accountant imports into TallyPrime:
customer ledgers, sales invoices with CGST/SGST or IGST, receipts, deposits, refunds and
credit notes. Next step is automatic sync with a small connector on your Tally computer."
Be honest: it has not yet been imported into their own Tally company. Offer to test it
with their accountant on a copy of their company.

**Someone asks about WhatsApp, SMS, RFID, GPS or GST e-invoice.**
"Not built yet. They are next on the roadmap, after a pilot." No messages are sent from
this demo.

**Someone asks "Who else uses this?" or "Is it certified?"**
"This is a demo with synthetic data. We are looking for our first pilot customer. We make
no certification claim. Cylvero keeps the records; your quality team signs the release."

**A lost cylinder turns up again.**
"Admin opens it → **Receive back (found again)**. It returns on hold and must pass a
safety check. The loss and the recovery both stay in its history."

**Something breaks on screen.**
"This is a live demo." Use a quick path from section 5, or open the Life story of
`DEMO-TAKE-1`, which already has a full history.

---

## 7. Backup plan

- If /api/ready fails: show `docs/system-map.pdf` and book a follow-up for the live demo.
- If numbers do not match the cheat sheet: Admin → Settings → **Reset demo data**.

---

## 8. One-page cheat sheet (print this)

**Accounts:** tap a picture card on the sign-in page (demo accounts `role@batra.demo`):
Driver · Godown · Quality · Admin · Finance · Auditor.

**Starting numbers (on the reset day):** 95 cylinders · plant 84 · vehicle 3 · customers 6 ·
suppliers 2 · ready to dispatch 29 · unpaid invoices ₹6,799.20.

| Tag | What it is | Use it for |
|---|---|---|
| `DEMO-LOAD-1`, `DEMO-LOAD-2` | Full, in DEMO-BATCH-006, awaiting Quality | Release → Dispatch → Deliver |
| `DEMO-HOLD-1` | On hold, valve leak suspected | Dispatch refuses it |
| `DEMO-EXPIRED-1` | Full, but test date passed | Dispatch refuses it |
| `DEMO-GIVE-1`, `DEMO-GIVE-2` | On truck DL 02 DEMO for the clinic (DEMO-ORD-007) | Quick deliver |
| `DEMO-TAKE-1`, `DEMO-TAKE-2` | At Demo Sanjeevani District Hospital | Collect → Receive returns |
| `DEMO-CLINIC-1` | At Demo Shanti Community Clinic | Quick collect |
| `DEMO-SUP-1`, `DEMO-SUP-2` | At the hydrotest vendor | "With suppliers" count |
| `DEMO-TAG-00012`, `00013` | Released, ready stock | Backup dispatch |

| Record | What it is |
|---|---|
| DEMO-ORD-008 | Open order, District Hospital, 2 × size B: dispatch this live |
| DEMO-ORD-007 | Clinic order already on the truck (2) |
| DEMO-BATCH-006 | Awaiting Quality release (LOAD-1/2); recall it at the end |
| DEMO-INV-004 | Part-paid invoice: ₹3,315.20, paid ₹1,000 |

**Order of the story:** Admin overview → Quality release → Godown dispatch (refusal) →
Driver deliver and collect → Godown receive → Finance invoice and Tally export → Auditor
Life story → Quality recall → Reset.
