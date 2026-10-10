# Cylvero demo script

For the presenter. Plain steps. Read it once the night before, then rehearse it once.

**Be honest about one thing at the start.** This is a demo with made-up data. Every
customer, hospital, person, phone number, GST number and amount is fictional. Every name
starts with "Demo" or "DEMO". We do not claim any customers, certifications or medical-gas
approvals. Cylvero is operations software. It does not certify that a cylinder is safe.

Live site: https://cylvero.vercel.app

---

## 1. Pre-demo checklist (do this 30 minutes before)

1. **Reset the demo data.** Sign in as **Admin**. Go to **Office → Settings**. Press
   **Reset demo data**. (This button is being built now. If it is not there yet, ask the
   developer to reset the demo database before the meeting.) Do this on the day of the demo:
   dates such as "due today" and "test expired" count from the day of the reset.
2. **Check the server.** Open https://cylvero.vercel.app/api/health. It should load and
   show `demo` mode. If it fails, use the backup plan in section 7.
3. **Check the starting numbers** on Admin → Overview (they should match the cheat sheet):
   95 cylinders, 84 at plant, 3 on vehicle, 6 with customers, 2 with suppliers.
4. **Phone:** Android with Chrome. Open the site, then Chrome menu → **Add to Home screen**.
   Open it from the home screen icon.
5. **Volume on.** The phone speaks short prompts. Do a test tap on one tile.
6. **Allow the camera** once on the phone, so the browser does not ask during the demo.
7. **Print the QR labels** for the anchor cylinders if you want to scan real paper
   (Office → Cylinders → open a cylinder → download label). Otherwise use **Type code**.
8. Laptop: a second browser window for Office screens. Phone: Simple screens.
9. Keep the cheat sheet (last page) next to you.
10. Company name on invoices shows "Batra Oxygen — Demo". Change it in Settings first if
    you prefer a different demo name.

---

## 2. Sixty-second opening pitch

> "Every oxygen supplier asks three questions every day. Where are my cylinders? Which
> ones are safe to send? Who owes me money for them?
>
> Today those answers sit in registers, WhatsApp messages and memory. Cylinders go missing.
> Rent is not billed. A cylinder with an expired test can go out by mistake.
>
> Cylvero tracks every cylinder by its QR code, from filling, to quality release, to the
> truck, to the hospital, and back. Drivers and godown staff use big picture buttons, in
> Hindi or English. The office sees the whole fleet, the money and the full history.
>
> The system refuses unsafe actions. A cylinder on hold or with an expired test cannot be
> loaded. Nobody can release their own batch.
>
> What you will see is a demo with made-up data. Let me show you one cylinder's journey,
> through six people, on the same records."

---

## 3. Five-minute executive walkthrough

Use this when time is short. Laptop for Office, phone for Driver.

1. **Admin → Overview (1 min).** "95 cylinders. 84 at our plant, 3 on a truck, 6 at
   customers, 2 at the test vendor." Click **Ready to dispatch (29)** to show it is a real
   list, not a made-up number.
2. **Safety refusal (1 min).** Sign in as **Godown** on the phone. Tap **Load truck**. Tap
   **Demo Sanjeevani District Hospital** (order DEMO-ORD-008, 2 cylinders). Tap **Type
   code** and enter `DEMO-HOLD-1`. The phone says **"On hold. Do not load."** Then try
   `DEMO-EXPIRED-1`. Also refused. "The system protects the patient side, not just the paperwork."
3. **Driver delivery (1.5 min).** Sign in as **Driver**. Tap **Give**. Tap **Demo Shanti
   Community Clinic, 2 left**. Type `DEMO-GIVE-1`, then `DEMO-GIVE-2`. Tap **Done 2**. Add
   the receiver's name. Point out the 5-second **Undo** before it is sent.
4. **Finance (1 min).** Sign in as **Finance**. Open **Billing & rentals**. Show
   **DEMO-INV-004**: ₹3,315.20 billed, ₹1,000 paid, ₹2,315.20 still due. Show rental days on
   the cylinders still at customers.
5. **Auditor (0.5 min).** Sign in as **Auditor**. Search `DEMO-GIVE-1` in **Cylinders** and
   open its **Life story**: joined the fleet, checked, filled, released, loaded, delivered
   two minutes ago. "Read-only. The auditor cannot change anything."

---

## 4. Twelve-minute full walkthrough

One story, the same cylinders, six people. Hand-off order:
**Quality → Godown → Driver → Godown → Finance → Auditor**, then a recall trace.

The story: Demo Sanjeevani District Hospital ordered 2 oxygen cylinders (DEMO-ORD-008).
They are filled but not yet checked (DEMO-LOAD-1 and DEMO-LOAD-2 in DEMO-BATCH-006). The
hospital also has 2 empties from last week (DEMO-TAKE-1 and DEMO-TAKE-2).

### 0:00 – 1:30 · Admin: the morning picture (laptop)

1. Sign-in page: tap the **Admin** card.
2. **Overview.** Read out: 95 tracked, 84 at plant, 3 on vehicle, 6 with customers,
   2 with suppliers. Ready to dispatch 29. Open orders 5 (1 urgent).
3. Click **Ready to dispatch**. A list of real cylinders opens.
   *Audience should notice:* every number opens the actual cylinders behind it.
4. Click **Safety** in the left menu. Show the open problems: DEMO-HOLD-1 (valve leak
   suspected) and DEMO-EXPIRED-1 (test date passed).
   *Notice:* problems have a reason and a cylinder, not just a red light.

### 1:30 – 3:00 · Quality: release today's batch (laptop)

1. Sign out. Tap the **Quality** card.
2. Go to **Production**. Find **DEMO-BATCH-006** — "Awaiting release". It has 2 cylinders:
   DEMO-LOAD-1 and DEMO-LOAD-2. Mention: Quality already pulled out DEMO-HOLD-1 from this
   batch this morning.
3. Optional proof first: before releasing, show on the phone as **Godown** → **Load truck**
   → the hospital → type `DEMO-LOAD-1`. It says **"Not checked yet. Do not load."**
4. Back on the laptop, click **Release**. Certificate: `DEMO-QC-LIVE`. Notes: "Purity and
   leak check recorded". Save.
   *Notice:* the person who filled the batch (Godown) cannot release it. Only a different
   person can. Try it as Godown if asked: it is refused.

### 3:00 – 5:00 · Godown: load the truck (phone)

1. Sign in as **Godown** on the phone. Tap **Load truck**.
2. The urgent order (Demo City General Hospital) is first. Tap **Demo Sanjeevani District
   Hospital** (DEMO-ORD-008, 2 cylinders).
3. Show refusals: **Type code** `DEMO-HOLD-1` → "On hold. Do not load."
   `DEMO-EXPIRED-1` → "On hold. Do not load." (test date over).
4. Now scan or type `DEMO-LOAD-1` and `DEMO-LOAD-2`. The dots fill. Tap **Done**.
5. Pick the driver and truck **DL 02 DEMO**. Wait for the tick: "2 cylinders loaded for
   Demo Sanjeevani District Hospital."
   *Notice:* the order asked for 2, so the phone wants exactly 2. Wrong size, wrong gas,
   another customer's cylinder — all refused before anything moves.

### 5:00 – 7:30 · Driver: give and take back (phone)

1. Sign in as **Driver**. Only four big pictures: Give, Take back, My truck, Scan.
   *Notice:* the driver never sees prices or office screens.
2. Tap **My truck**: full cylinders on the truck, stops today.
3. Tap **Give** → **Demo Sanjeevani District Hospital, 2 left**.
4. Scan or type `DEMO-LOAD-1`, then `DEMO-LOAD-2`. Tap **Done 2**.
5. "Who took them?" → **New name** → type "Demo Ward Sister".
6. Show **Undo** during the 5-second wait, if you like, then let it send. Tick:
   "2 cylinders given to Demo Sanjeevani District Hospital."
7. Wrong cylinder demo: in Give, type `DEMO-TAG-00012`. The phone says **"Not on this
   order."** and does not count it.
8. Tap **Take back** → **Demo Sanjeevani District Hospital** (Has 2). Type `DEMO-TAKE-1`
   and `DEMO-TAKE-2`. Done. Tick: "2 empty cylinders taken from …"
   *Notice:* the hospital's rent stops only when the godown receives them, not before.

### 7:30 – 8:30 · Godown: they came back (phone)

1. Sign in as **Godown**. Tap **Came back**.
2. Type `DEMO-TAKE-1` and `DEMO-TAKE-2`. They appear under **Empty from customers**.
3. Done → **All empty**. Tick: "2 cylinders back in the godown."
   *Notice:* returned cylinders go to "inspection due". They must be checked before refilling.

### 8:30 – 10:00 · Finance: bill and collect (laptop)

1. Sign in as **Finance**. Open **Billing & rentals**.
2. Find delivered order **DEMO-ORD-008** and create the invoice (12% tax). Total
   ₹3,315.20 (2 × ₹1,480 + tax).
3. Record a payment: ₹1,000 by UPI, reference `DEMO-UPI-LIVE`. Status becomes part paid.
4. Show **DEMO-INV-004** (the same hospital's earlier order): ₹1,000 paid, ₹2,315.20 due.
5. Show rental days for cylinders still at customers.
   *Notice:* every rupee comes from a delivery or a payment record. Duplicate payment
   references and over-payments are refused.

### 10:00 – 12:00 · Auditor, Life story, and recall trace (laptop)

1. Sign in as **Auditor**. Go to **Cylinders**, search `DEMO-LOAD-1`, open **Life story**:
   joined the fleet → safety check → filled → passed quality check → loaded on DL 02 DEMO
   → delivered to Demo Sanjeevani District Hospital, with names and times.
2. Open **Reports & audit**. Show who did what, and when, today.
   *Notice:* the auditor sees everything and can change nothing.
3. **Recall trace** (do this last, it changes data). Sign in as **Quality**. Go to
   **Production** → **DEMO-BATCH-005** → **Recall batch**. Reason: "Demo recall drill".
4. The batch page shows **Recipients of recalled gas**: Demo Sanjeevani District Hospital
   (DEMO-TAKE-1, DEMO-TAKE-2, order DEMO-ORD-005) and Demo Shanti Community Clinic
   (DEMO-CLINIC-1, order DEMO-ORD-006). Cylinders still out (on the truck or at the clinic)
   go on hold, and **Safety** shows "Recover …" tasks.
   *Notice:* in one click you know which hospitals and clinics received a batch.
   *Stronger option:* recall **DEMO-BATCH-006** instead, the batch Quality released live
   at the start. Its recipient list then shows the delivery the audience just watched:
   DEMO-LOAD-1 and DEMO-LOAD-2 at Demo Sanjeevani District Hospital (order DEMO-ORD-008).
   Live deliveries are traced. `tests/demo-recall-live.test.ts` checks this.
5. Close: "One cylinder, six people, one record. Nothing was typed twice."
6. After the meeting: **Reset demo data** again.

---

## 5. Quick paths (if a step fails or time is short)

- **Give without loading first:** Driver → Give → **Demo Shanti Community Clinic, 2 left**
  → `DEMO-GIVE-1`, `DEMO-GIVE-2`. (Already on the truck, order DEMO-ORD-007.)
- **Take back without loading first:** Driver → Take back → **Demo Shanti Community
  Clinic** → `DEMO-CLINIC-1`.
- **Load without Quality step:** use already released stock, e.g. `DEMO-TAG-00012` and
  `DEMO-TAG-00013`.
- **Quality release on another branch:** DEMO-BATCH-003 (Faridabad) is also awaiting release.

---

## 6. What to say when…

**There is no network.**
"The driver's Give still saves on the phone. It shows 'Saved on phone. It will send later.'
It sends when the signal is back." Show it only if it is already working on your phone.
Other jobs need a connection today. Wider offline work is on the roadmap.

**The camera is blocked or will not focus.**
"No problem." Tap **Photo** to read a QR from a picture, or **Type code** and type the
code printed under the QR (for example `DEMO-LOAD-1`). **Pick from list** also works.

**A wrong cylinder is refused.**
This is the point. Read the message out loud: "Not on this order", "On hold. Do not load",
"Not checked yet", "Wrong size or gas". "The system stops the mistake before the cylinder
moves, and tells the worker what to do."

**Someone asks about Tally.**
"Not built yet. It is on the roadmap for Phase 2, after the pilot. Today you can export
records from Reports & audit."

**Someone asks about WhatsApp or SMS messages.**
"Not built yet. Phase 2. We will not send any message to a customer from this demo."

**Someone asks about RFID or gate readers.**
"Today we use QR codes and a phone camera. RFID and gate readers are Phase 2 work."

**Someone asks about GST e-invoice or e-way bill.**
"Not built yet. Invoices here are demo invoices. Connecting to a GST provider is Phase 2.
We make no tax-compliance claim today."

**Someone asks "Who else uses this?" or "Is it certified?"**
"This is a demo with synthetic data. We are looking for our first pilot customer. We make
no certification claim. Cylvero keeps the records; your quality team signs the release."

**Something breaks on screen.**
"This is a live demo." Switch to the quick paths in section 5, or show the Life story of
`DEMO-TAKE-1`, which already has a full history.

---

## 7. Backup plan

- If /api/health fails: show the screenshots in `docs/screenshots/`, and the system map
  `docs/system-map.pdf`. Book a follow-up for the live demo.
- If data looks wrong (numbers do not match the cheat sheet): Admin → Settings →
  **Reset demo data**, then start again.

---

## 8. One-page cheat sheet (print this)

**Accounts:** tap the picture card on the sign-in page. All cards use demo accounts
(`role@batra.demo`). Driver · Godown · Quality · Admin · Finance · Auditor.

**Starting numbers (on the reset day):** 95 cylinders · plant 84 · vehicle 3 · customers 6 ·
suppliers 2 · 3 retired (still counted at plant) · ready to dispatch 29 · open orders 5
(1 urgent) · unpaid invoices ₹6,799.20 in total.

| Tag | What it is | Use it for |
|---|---|---|
| `DEMO-LOAD-1`, `DEMO-LOAD-2` | Full, in DEMO-BATCH-006, awaiting Quality | Quality release → Load truck → Give |
| `DEMO-HOLD-1` | On hold, valve leak suspected | Load truck refuses it |
| `DEMO-EXPIRED-1` | Full, but test date passed | Load truck refuses it |
| `DEMO-GIVE-1`, `DEMO-GIVE-2` | On truck DL 02 DEMO for the clinic | Quick Give |
| `DEMO-TAKE-1`, `DEMO-TAKE-2` | At Demo Sanjeevani District Hospital | Take back → Came back |
| `DEMO-CLINIC-1` | At Demo Shanti Community Clinic | Quick Take back; recall trace |
| `DEMO-SUP-1`, `DEMO-SUP-2` | At the hydrotest vendor | "With suppliers" count |
| `DEMO-TAG-00012`, `00013` | Released, ready stock | Backup load; "not on this order" |

| Record | What it is |
|---|---|
| DEMO-ORD-008 | Open order, District Hospital, 2 × size B — load this live |
| DEMO-ORD-007 | Clinic order already on the truck (2) |
| DEMO-ORD-005 | Hospital's earlier delivery (TAKE-1/2) |
| DEMO-BATCH-006 | Awaiting Quality release (LOAD-1/2) |
| DEMO-BATCH-005 | Released batch to recall at the end |
| DEMO-INV-004 | Part-paid invoice: ₹3,315.20, paid ₹1,000 |
| DEMO-INV-002 | Part-paid invoice, home oxygen customer |

**Order of the story:** Admin overview → Quality release → Godown load → Driver give and
take back → Godown came back → Finance invoice and payment → Auditor Life story → Quality
recall trace → Reset.

**If stuck:** Type code · Photo · Pick from list · quick paths in section 5.
