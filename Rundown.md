# Cylvero — Step-by-Step Test Rundown

> **What is this?** Cylvero is a demo app for an oxygen cylinder business. It tracks cylinders, filling, deliveries, billing and safety.
> **All data is fake.** Nothing you do here affects a real business. You can't break anything important.

Please go through the steps **in order**. Each step says what to do and what you **should see** (✅).
Tick the box when a step works. If something looks wrong, see [What to do if something goes wrong](#what-to-do-if-something-goes-wrong).

**Time needed:** about 3 hours. You can stop after any part and continue later. Everything you save stays saved.

---

## Contents

- [Before you start](#before-you-start)
- [Part 1 — Look around](#part-1--look-around)
- [Part 2 — Customers and suppliers](#part-2--customers-and-suppliers)
- [Part 3 — New cylinders](#part-3--new-cylinders)
- [Part 4 — Safety check](#part-4--safety-check)
- [Part 5 — Fill with gas](#part-5--fill-with-gas)
- [Part 6 — Order and delivery](#part-6--order-and-delivery)
- [Part 7 — Billing](#part-7--billing)
- [Part 8 — Returns and pickups](#part-8--returns-and-pickups)
- [Part 9 — Emptying, suppliers and purchases](#part-9--emptying-suppliers-and-purchases)
- [Part 10 — Recall](#part-10--recall)
- [Part 11 — Lost cylinder](#part-11--lost-cylinder)
- [Part 12 — Two tabs at once](#part-12--two-tabs-at-once)
- [Part 13 — Driver without internet](#part-13--driver-without-internet)
- [Part 14 — People and settings](#part-14--people-and-settings)
- [Part 15 — Reports, exports and labels](#part-15--reports-exports-and-labels)
- [Part 16 — Each role only sees its own things](#part-16--each-role-only-sees-its-own-things)
- [Part 17 — Final check](#part-17--final-check)
- [Things that need real equipment](#things-that-need-real-equipment)
- [What to do if something goes wrong](#what-to-do-if-something-goes-wrong)

---

## Before you start

1. Open this link in **Google Chrome** on a laptop or desktop: **`https://YOUR-APP-LINK`**
   _(The person who shared this file will replace this with the real link.)_
2. Pick your **own short code** — your initials plus a number, for example **`AB1`**.
   - Everywhere this guide says **`T2`**, type **your code** instead. Example: `T2-A` becomes `AB1-A`.
   - This keeps your test records separate from your friends' records.
   - If the app ever says **"already exists"**, change the number (`AB2`) and continue.
3. **Everyone uses the same password:** `OxygenDemo!2026`
4. **How to switch person:**
   1. Click **Sign out** (bottom left).
   2. Pick the next account from the list.
   3. Click **Sign in**.
5. **The six accounts:**

   | Account                 | What this person does                              |
   | ----------------------- | -------------------------------------------------- |
   | `admin@batra.demo`      | The boss. Can do everything.                       |
   | `operations@batra.demo` | Warehouse and dispatch staff.                      |
   | `quality@batra.demo`    | Safety checker. Approves filled gas.               |
   | `finance@batra.demo`    | Accounts. Bills and payments.                      |
   | `driver@batra.demo`     | Delivery driver.                                   |
   | `auditor@batra.demo`    | Can look at everything, but can't change anything. |

6. Keep a notepad open. For every step write ✅ (worked) or ❌ (didn't work).

> **Testing with friends at the same time?** It works, because everyone uses their own code.
> But **Part 10 (Recall)** puts some shared demo cylinders on hold. Agree that only **one** person does Part 10, near the end.

---

## Part 1 — Look around

**Sign in as:** `admin@batra.demo`

- [ ] **1.** Click **Overview** in the left menu.
      ✅ You see summary numbers and a **"Needs attention"** list written in plain English (no codes like `inspection_due`).
- [ ] **2.** Click **Demo walkthrough** (top right). Click through **all 8 chapters**, then close it.
      ✅ Each chapter opens without errors.
- [ ] **3.** Click **every item** in the left menu once:
      Cylinders · Production · Orders & delivery · Customers · Suppliers & purchases · Billing & rentals · Safety · Reports & audit · Settings.
      ✅ No page is blank or broken.
- [ ] **4.** Open **Settings** and scroll down.
      ✅ Accounting sync, GST submission, WhatsApp and Payment gateway all say **Unconfigured**. That is expected for a demo.

---

## Part 2 — Customers and suppliers

**Sign in as:** `admin@batra.demo`

- [ ] **5.** Go to **Customers → Add customer**. Fill in:
  - Name: `T2 Clinic`
  - Type: **Hospital**
  - Branch: **Delhi**
  - Phone, address and city: anything made up
  - Click **Save**.

  ✅ `T2 Clinic` appears in the list straight away.

- [ ] **6.** Click **Add customer** again. Leave everything **blank** and click **Save**.
      ✅ You see a clear message in plain English.
      ✅ Nothing is saved.
- [ ] **7.** Add a customer called `T2 Clinic` **a second time**.
      ✅ You're told it **already exists**.
- [ ] **8.** Open `T2 Clinic` → **Edit**. Change the phone number and save.
      ✅ The new number shows.
      ✅ There is still only **one** `T2 Clinic`, not two.
- [ ] **9.** Go to **Suppliers & purchases → Add supplier**. Name `T2 Gas Supplier`, branch **Delhi**. Save.
      ✅ It shows under **Suppliers**, not under Customers.

---

## Part 3 — New cylinders

**Sign in as:** `admin@batra.demo`

- [ ] **10.** Go to **Cylinders → Register cylinder**. Fill in:
  - Serial: `T2-SER-A`
  - Tag: `T2-A`
  - Manufacturer: `Test Works`
  - Gas: **Medical oxygen** · Size: **B** · Owner: **Company owned** · Branch: **Delhi** · Contents: **Empty**
  - Last test date: any date **last year**
  - Next test due: any date **3 years from now**
  - Certificate: `T2-CERT`
  - Click **Save**.

  ✅ The cylinder shows as **needing inspection**.

- [ ] **11.** Do the same again for a second cylinder: serial `T2-SER-B`, tag `T2-B`.
- [ ] **12.** Try registering tag `T2-A` **again**.
      ✅ You're told it **already exists**.
- [ ] **13.** Try registering a cylinder whose **next test due** date is **earlier** than its last test date.
      ✅ It's **refused**.
- [ ] **14.** Type `zzz` in the Cylinders **search box**. Then register a third cylinder, tag `T2-C`.
      ✅ The search box clears and `T2-C` shows in the list.
- [ ] **15.** Click **Download import template** and open the file in Excel or Google Sheets.
  1. Add **one row** for a cylinder with tag `T2-D` (fill every column like the example).
  2. Save it as a **CSV** file.
  3. Click **Import CSV** and choose that file.

  ✅ `T2-D` appears in the list.

- [ ] **16.** Import the **same file again**.
      ✅ The **whole file is refused**. Nothing is added twice.
- [ ] **17.** Open `T2-C` → **Replace tag**. New tag: `T2-C2`, reason: `label damaged`. Save.
      ✅ Searching `T2-C` **and** searching `T2-C2` both find the **same** cylinder.
- [ ] **18.** On the Cylinders page, click each **filter button** along the top, one by one.
      ✅ The list changes each time.
- [ ] **19.** Search for a cylinder by its **serial number**, e.g. `T2-SER-A`.
      ✅ It's found.

---

## Part 4 — Safety check

**Sign in as:** `quality@batra.demo`

- [ ] **20.** Open `T2-A` → **Record inspection** → choose **Serviceable**, note `ok`. Save.
      ✅ `T2-A` now shows **Serviceable**.
- [ ] **21.** Do the same for `T2-B`.
- [ ] **22.** Open `T2-D` → **Record inspection** → choose **Retired**, and type a reason. Save.
      ✅ `T2-D` shows **Retired** and can't be used any more.

---

## Part 5 — Fill with gas

- [ ] **23.** **Sign in as `admin@batra.demo`.** Go to **Production → Create batch**. Fill in:
  - Gas: **Medical oxygen** · Branch: **Delhi**
  - Tick `T2-A` and `T2-B`
  - Source: `T2-LOT` · Operator: `Ravi`
  - Save.

  ✅ The batch shows **Awaiting release**, with operator **Ravi**.

- [ ] **24.** Still as admin, click **Release** on that batch.
      ✅ You get a message saying someone else must release it, and to **sign in as a Quality user**.
      👉 **This is correct.** The person who fills a batch is not allowed to approve it.
- [ ] **25.** **Sign in as `quality@batra.demo`.** Click **Release** on the batch. Certificate `T2-QC`, notes `ok`. Save.
      ✅ The batch shows **Released**.
- [ ] **26.** Test rejecting one cylinder from a batch:
  1. As **admin**, create **another batch** with 2 other cylinders that are **Serviceable** and **Empty**.
  2. As **quality**, open that batch → **Reject cylinder** on **one** of them, with a reason.

  ✅ The rejected cylinder goes **on hold**.
  ✅ The other cylinder can still be **released**.

---

## Part 6 — Order and delivery

- [ ] **27.** **Sign in as `admin@batra.demo`.** Go to **Orders & delivery → New order**. Fill in:
  - Customer: `T2 Clinic` · Gas: **Medical oxygen** · Size: **B** · Quantity: **2** · Date: **today**
  - Save.

  ✅ The order shows **Open**. Write down its **order number**.

- [ ] **28.** Open the order → **Dispatch order**.
  1. Click in the **scan box**, type `T2-A` and press **Enter**.
     ✅ **Only** `T2-A` gets ticked, and the scan box empties.
  2. Do the same for `T2-B`.
  3. Vehicle: `DL01T2` · Driver: **Driver**.
  4. Click **Confirm dispatch**.

  ✅ The order shows **Dispatched**.
  ✅ Both cylinders show **On vehicle**.

- [ ] **29.** Search for your **order number** on the Orders page.
      ✅ Your order is found.
- [ ] **30.** Open the order → **Print challan**.
      ✅ A printable delivery note appears. Close it **without printing**.
- [ ] **31.** Make **another order** for **3** cylinders and try to dispatch only **2**.
      ✅ It's **refused**.
      Then open that order → **Cancel**, and give a reason.
      ✅ It shows **Cancelled**.
- [ ] **32.** **Sign in as `driver@batra.demo`.** Open your order → **Record delivery**.
  1. Tick **only** `T2-A`.
  2. Recipient: `Nurse T2`.
  3. Click **Record acceptance**.

  ✅ The order shows **Partial**.
  ✅ The Driver field says **"Driver"** (a name, not a code).

- [ ] **33.** **Sign in as `admin@batra.demo`.** Open the order → **Unload remainder**.
  1. Tick `T2-B`.
  2. Choose **Not verified**, and type a reason.
  3. Save.

  ✅ The order shows **Closed · short delivery**.

---

## Part 7 — Billing

**Sign in as:** `finance@batra.demo`

- [ ] **34.** Go to **Billing & rentals**. Find your order → **Issue invoice**. Price: `350`. Save.
      ✅ The invoice is for **1 cylinder**, not 2 (only one was delivered).
- [ ] **35.** Try issuing an invoice with a price of `0`.
      ✅ It's **refused**.
- [ ] **36.** Click **Record payment**. Amount `100`, method **UPI**, reference `T2-PAY1`. Save.
      ✅ The invoice shows **Partial**.
- [ ] **37.** Record the **rest of the amount**. Method **Bank**, reference `T2-PAY2`. Save.
      ✅ The invoice shows **Paid**, and Balance is **₹0**.
- [ ] **38.** Try paying **₹1 more**.
      ✅ It's **refused**.
      Try reusing reference `T2-PAY1`.
      ✅ It's **refused**.
- [ ] **39.** Open the invoice → **Print invoice**.
      ✅ The customer name, amounts and tax look right. Close it without printing.
- [ ] **40.** Click **Record deposit**. Customer `T2 Clinic`, amount `500`, reference `T2-DEP1`. Save.
      ✅ It appears at the **top** of **"Receipts & deposits · newest first"**.
- [ ] **41.** Click **Refund deposit** for `100`.
      ✅ It's **blocked**, because the clinic still holds a cylinder. **This is correct.**
- [ ] **42.** Test a partial credit note:
  1. Make and deliver **another small order** (as admin/driver, like Part 6).
  2. As finance, invoice it but **don't pay**.
  3. Click **Credit** → enter **half** the amount → **Issue credit note**.

  ✅ Only the **other half** is still owed.

- [ ] **43.** On your **paid** invoice (step 37), click **Credit** for `100`.
      Then click **Apply credit** and apply it to the **unpaid** invoice from step 42.
      ✅ The unpaid invoice's balance goes **down by ₹100**.
- [ ] **44.** Click **Undo credit allocation**, and type a reason.
      ✅ The balance goes **back up**.
- [ ] **45.** Click **Refund credit** for **part** of the credit.
      ✅ You **can't** refund more than the credit.
- [ ] **46.** Click **Rental invoice** for `T2 Clinic`, with a period that **ends today**.
      ✅ It's **refused**. Rental periods must end **yesterday or earlier**.

---

## Part 8 — Returns and pickups

**Sign in as:** `admin@batra.demo`

- [ ] **47.** Go to **Orders & delivery → Collect empties**. Customer `T2 Clinic`, tick `T2-A`, vehicle `DL01T2`, driver **Driver**. Save.
      ✅ `T2-A` is now **on the collection vehicle**.
- [ ] **48.** Click **Undo collection** for it, and type a reason.
      ✅ `T2-A` goes **back to the customer**.
- [ ] **49.** Collect `T2-A` again (repeat step 47). Then click **Receive returns** → tick `T2-A`, contents **Empty**. Save.
      ✅ `T2-A` is back at the **Delhi plant**.
- [ ] **50.** Open `T2-A` and scroll down to **Movement timeline**.
      ✅ Every step you did is listed, **in order**, with nothing missing and nothing listed twice.
- [ ] **51.** Click **Report unknown**. Type a made-up serial number and a note. Save.
      ✅ An alert appears on the **Safety** page.
- [ ] **52.** Go to **Safety**, open that alert → **Resolve exception**, with a note.
      ✅ It shows **Resolved**.

---

## Part 9 — Emptying, suppliers and purchases

- [ ] **53.** Find a cylinder at the plant that is **not empty** and **not** in a waiting batch.
      **Sign in as `quality@batra.demo`**, open it → **Record emptying** → **Venting**, with a note.
      ✅ It now says **Empty**.
- [ ] **54.** **Sign in as `admin@batra.demo`.** Go to **Suppliers & purchases → Send cylinders**.
      Choose **Hydrotest**, supplier `T2 Gas Supplier`, one safe **empty** cylinder, and any reference. Save.
- [ ] **55.** Click **Receive from supplier** → the same cylinder → service **Test only**, contents **Empty**. Save.
      ✅ The cylinder says **Empty**, not Full.
- [ ] **56.** Send **another** empty cylinder for **Refill**. Then receive it back with service **Refill** and contents **Full**.
      ✅ It creates a batch that is **Awaiting release**.
      Then **sign in as `quality@batra.demo`** and **Release** it.
- [ ] **57.** In **Receive from supplier**, tick a cylinder, **then** change the **Gas**.
      ✅ Your tick **stays** (if that cylinder still matches the gas).
- [ ] **58.** Click **Receive purchase**. Supplier, branch **Delhi**, gas, reference `T2-PO1`. Paste **one row** in the CSV box. Save.
      ✅ The new cylinder is **Awaiting release**.
      Try reference `T2-PO1` **again**.
      ✅ It's **refused**.

---

## Part 10 — Recall

> ⚠️ **Only one person should do this part.** It puts shared demo cylinders on hold.

- [ ] **59.** **Sign in as `quality@batra.demo`.** Go to **Production**. Pick a **Released** batch that has a cylinder **at a customer** → **Recall batch**, reason `drill`.
      ✅ Those cylinders go **on hold**.
      ✅ The **Safety** page shows recall alerts.
      ✅ The batch **Details** list who received the gas.
- [ ] **60.** **Sign in as `admin@batra.demo`.** Try **Resolve exception** on a recall alert while the cylinder is **still at the customer**.
      ✅ It's **refused**.
- [ ] **61.** Click **Receive returns** for that cylinder, contents **Empty**. Then **sign in as `quality@batra.demo`**:
  1. Try **Record inspection → Serviceable**.
     ✅ You get a message telling you to use **Record emptying** first.
  2. Click **Record emptying**.
  3. Now **Record inspection → Serviceable** again.
     ✅ It works: the cylinder is **back in service**.

---

## Part 11 — Lost cylinder

**Sign in as:** `admin@batra.demo`

- [ ] **62.** Open a cylinder that is **at a customer** → **Report loss / damage** → **Lost**, with a note.
      ✅ An alert appears on the **Safety** page.
- [ ] **63.** Click **Approve rental stop**, with **yesterday's** date and a reason.
      ✅ Rent stops from that date.
- [ ] **64.** Click **Write off**, with a date and a reason.
      ✅ The cylinder is **Retired**, and the alert **closes**.

---

## Part 12 — Two tabs at once

**Sign in as:** `admin@batra.demo`

- [ ] **65.** Open the **same cylinder** in **two browser tabs**.
  1. **Tab 1:** open **Record inspection**, fill it in, but **don't save**.
  2. **Tab 2:** click **Replace tag**, enter a new tag and save.
  3. Go back to **Tab 1** and click **Save**.

  ✅ You see a message and a **Reload latest form** button.

- [ ] **66.** Click **Reload latest form**, then **Save**.
      ✅ It works.

---

## Part 13 — Driver without internet

- [ ] **67.** **Sign in as `admin@batra.demo`.** Make a new order and dispatch it to **Driver** (like Part 6).
- [ ] **68.** **Sign in as `driver@batra.demo`.** Open that order → **Record delivery**.
  1. Tick a cylinder and type a recipient name.
  2. Click **Save evidence on device**.

  ✅ A **"Field evidence sync"** panel appears.

- [ ] **69.** Click **Review evidence**.
      ✅ It shows the **order number and tag** (not long codes).
- [ ] **70.** Click **Sync deliveries**.
      ✅ It's delivered **once**. The order shows **1** delivery, not 2.
- [ ] **71.** Pretend the internet is off:
  1. Press **F12** to open Chrome's developer tools → click the **Network** tab → change **No throttling** to **Offline**.
  2. Save evidence for **another** order.
  3. Change **Offline** back to **No throttling**.
  4. Click **Sync deliveries**.

  ✅ It goes through.

- [ ] **72.** Save evidence again for a delivery.
      Then, in **another tab**, sign in as **admin** and **Unload** that same cylinder.
      Go back to the driver tab and click **Sync deliveries**.
      ✅ It says **Needs office review**, and does **not** deliver twice.
- [ ] **73.** Pretend to be on a phone:
  1. Press **F12** → click the **phone icon** (top left of the developer tools) → choose **iPhone SE**.
  2. Open an order → **Record delivery**.

  ✅ All buttons are visible, or you can reach them by **scrolling inside the pop-up**.
  Press **F12** again to go back to normal view.

---

## Part 14 — People and settings

**Sign in as:** `admin@batra.demo`

- [ ] **74.** Go to **Settings → Add member**. Email `t2@test.local`, role **Finance**, branch **Delhi**, password `short`. Save.
      ✅ You get a clear message about the **password**.
- [ ] **75.** Try again with password `LongTestPass123`.
      ✅ The new member appears in the list.
- [ ] **76.** Click **Edit access** on that member → change the **role** → save.
      ✅ The new role shows.
- [ ] **77.** Click **Reset password** for that member, and set a new one.
      ✅ Their **old** password no longer works.
- [ ] **78.** Test the lock-out:
  1. Sign out. Sign in as `t2@test.local` with a **wrong password 5 times**.
  2. Now sign in as **admin** with the correct password.

  ✅ The test account is **locked** ("Too many login attempts").
  ✅ **Admin still gets in** (other people are not locked out).

- [ ] **79.** As admin, click **Edit access** on **yourself** and remove **Faridabad**. Save.
      ✅ It's **refused** (you can't lock yourself out).
- [ ] **80.** Click **Edit profile** → change the **company name** → save.
      Then open an **old invoice**.
      ✅ The old invoice still shows the **old** company name.
      👉 Change the company name **back** afterwards.
- [ ] **81.** Sign in as your **test member** (`t2@test.local`) → **Change my password**.
      ✅ That member gets **signed out** and must use the new password.
      ⚠️ **Never** change the password of the shared demo accounts.

---

## Part 15 — Reports, exports and labels

**Sign in as:** `admin@batra.demo`

- [ ] **82.** Go to **Reports & audit**. Click **every tab**, including **Stock position**, **Movement ledger** and **Audit trail**.
      ✅ Your `T2` actions are listed, **including payments and deposits**.
- [ ] **83.** Click **Full JSON export**, then **Cylinder CSV**.
      ✅ Both files download.
- [ ] **84.** Open any cylinder → **Print label**.
      ✅ The label shows the **tag** and a **QR code**. Close it without printing.

---

## Part 16 — Each role only sees its own things

Sign in as each person below and check:

- [ ] **85.** `auditor@batra.demo` — click around everywhere.
      ✅ You can **read** everything, but there are **no** Save, Pay or Dispatch buttons.
- [ ] **86.** `driver@batra.demo`
      ✅ You only see **your own** deliveries. **No** prices, **no** export buttons.
- [ ] **87.** `operations@batra.demo` — open **Billing & rentals**.
      ✅ **No money amounts** are shown.
- [ ] **88.** `finance@batra.demo` — open **Customers**.
      ✅ There is **no Return** button.
- [ ] **89.** `quality@batra.demo` — open any order.
      ✅ The driver's **name** shows (for example "Driver"), not a code.

---

## Part 17 — Final check

- [ ] **90.** Press **F5** to refresh the page. Sign in as `admin@batra.demo`.
      ✅ **Everything** you made today is still there.

🎉 **Done!** Thank you for testing.

---

## Things that need real equipment

These can't be tested on a laptop screen. Skip them unless you have the equipment, and write **"not tested"**:

| What                       | How to test it                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Barcode scanner gun        | Scan two cylinder tags one after the other. Only those two should be ticked.                  |
| Phone camera scanner       | Open the app link on a phone and scan a printed label. The link must start with `https://`.   |
| Label printer / A4 printer | Print a label and a challan. Is it readable? Does the QR code scan?                           |
| Real signal loss           | Record a delivery in a moving vehicle with weak signal, then sync later.                      |
| Accountant review          | GST, HSN codes, invoice numbering and credit notes need an accountant's check.                |
| Legal / client review      | Rules for cylinders owned by customers or suppliers need the client's or a lawyer's approval. |

---

## What to do if something goes wrong

If a step does **not** show what the ✅ says:

1. **Don't** click Save again and **don't** try to fix it.
2. Take a **screenshot** of the whole screen.
3. Write down:
   - The **step number** (for example "Step 43").
   - **What you expected** to see.
   - **What actually happened** (copy any error message exactly).
   - **Which account** you were signed in as.
4. Send it to the person who shared this file, then **continue with the next step**.
