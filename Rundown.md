# Cylvero — Step-by-Step Test Rundown

> **What is this?** Cylvero is a demo app for an oxygen cylinder business. It tracks cylinders, filling, deliveries, billing and safety.
>
> **All data is fake.** Nothing you do here affects a real business.

Go through the steps **in order**. Every step says what to **do**, then what you **should see** (✅).
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
- [Part 9 — Two tabs at once](#part-9--two-tabs-at-once)
- [Part 10 — Emptying, suppliers and purchases](#part-10--emptying-suppliers-and-purchases)
- [Part 11 — Recall](#part-11--recall)
- [Part 12 — Driver without internet](#part-12--driver-without-internet)
- [Part 13 — Lost cylinder](#part-13--lost-cylinder)
- [Part 14 — People and settings](#part-14--people-and-settings)
- [Part 15 — Reports, exports and labels](#part-15--reports-exports-and-labels)
- [Part 16 — Each role only sees its own things](#part-16--each-role-only-sees-its-own-things)
- [Part 17 — Final check](#part-17--final-check)
- [Things that need real equipment](#things-that-need-real-equipment)
- [What to do if something goes wrong](#what-to-do-if-something-goes-wrong)

---

## Before you start

1. Open this link in **Google Chrome** on a laptop or desktop: **`https://YOUR-APP-LINK`**
   - The person who shared this file replaces this with the real link.
2. Pick your **own short code**: your initials plus a number, for example **`AB1`**.
   - Everywhere this guide says **`T2`**, type **your code** instead. Example: `T2-A` becomes `AB1-A`.
   - This keeps your records separate from your friends' records, so several people can test at the same time.
   - If the app ever says **"already exists"**, change the number (`AB2`) and continue.
3. **Password for every demo account:** `OxygenDemo!2026`
4. **How to sign in as someone:**
   1. On the sign-in page, open the **Demo account** list and pick the account.
   2. The password fills in by itself. Click **Sign in**.
5. **How to switch person:** click **Sign out** (bottom left), then sign in as the next person.
6. **The six demo accounts:**

   | Account | What this person does |
   |---|---|
   | Administrator · `admin@batra.demo` | The boss. Can do everything. |
   | Operations · `operations@batra.demo` | Warehouse and dispatch staff. |
   | Quality · `quality@batra.demo` | Safety checker. Approves filled gas. |
   | Finance · `finance@batra.demo` | Accounts. Bills and payments. |
   | Driver · `driver@batra.demo` | Delivery driver. |
   | Auditor · `auditor@batra.demo` | Can look at everything, but can't change anything. |

7. Keep a notepad open. For every step write ✅ (worked) or ❌ (didn't work).

---

## Part 1 — Look around

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **1.** Click **Overview** in the left menu.
  - ✅ You see summary numbers and a **"Needs attention"** list in plain English (no codes like `inspection_due`).
- [ ] **2.** Click **Demo walkthrough** (top right). Click through **all 8 chapters** in the list on the left, then close it with the **✕**.
  - ✅ Each chapter opens without errors.
- [ ] **3.** Click **every item** in the left menu once: Cylinders · Production · Orders & delivery · Customers · Suppliers & purchases · Billing & rentals · Safety · Reports & audit · Settings.
  - ✅ No page is blank or broken.
- [ ] **4.** Open **Settings** and scroll down to the integrations list.
  - ✅ Accounting sync, GST submission, WhatsApp messages and Payment gateway all say **Unconfigured**. That is expected for a demo.

---

## Part 2 — Customers and suppliers

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **5.** Go to **Customers → Add customer** and fill in:
  - Name: `T2 Clinic`
  - Type: **Hospital**
  - Branch: **Delhi**
  - Contact person, phone, address and city: anything made up
  - Leave the money fields as they are. Click **Save**.
  - ✅ `T2 Clinic` appears in the list straight away.
- [ ] **6.** Click **Add customer** again. Leave everything **blank** and click **Save**.
  - ✅ You see a clear message in plain English, and nothing is saved.
  - Click **Cancel** to close the form.
- [ ] **7.** Add a customer called `T2 Clinic` **a second time** (same branch, Delhi).
  - ✅ You're told it **already exists**.
- [ ] **8.** Find `T2 Clinic` in the list → click **Edit**. Change the phone number and save.
  - ✅ The new number shows, and there is still only **one** `T2 Clinic`.
- [ ] **9.** Go to **Suppliers & purchases → Add supplier** and fill in:
  - Name: `T2 Gas Supplier`
  - Branch: **Delhi**
  - Contact person, phone, address and city: anything made up
  - Leave the other fields as they are. Click **Save**.
  - ✅ It shows under **Suppliers**, not under Customers.

---

## Part 3 — New cylinders

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **10.** Go to **Cylinders → Register cylinder** and fill in:
  - Serial: `T2-SER-A`
  - Tag: `T2-A`
  - Manufacturer: `Test Works`
  - Gas: **Medical oxygen** · Size: **B** · Owner: **Company owned** · Branch: **Delhi** · Contents: **Empty**
  - Last test date: **15 January 2026** (click the box and pick it in the calendar)
  - Next test due: **15 January 2029**
  - Certificate: `T2-CERT`
  - Click **Register cylinder** (the green button at the bottom of the form).
  - ✅ `T2-A` shows in the list as **Inspection due**.
- [ ] **11.** Register a second cylinder the same way: serial `T2-SER-B`, tag `T2-B`.
  - ✅ `T2-B` shows as **Inspection due**.
- [ ] **12.** Try registering tag `T2-A` **again** (any new serial).
  - ✅ You're told it **already exists**.
- [ ] **13.** Try registering a cylinder whose **Next test due** is **earlier** than its **Last test date** (for example last test 15 January 2026, next due 15 January 2025).
  - ✅ It's **refused**.
- [ ] **14.** Type `zzz` in the Cylinders **search box**. Then register a third cylinder: serial `T2-SER-C`, tag `T2-C`.
  - ✅ The search box clears by itself and `T2-C` shows in the list.
- [ ] **15.** Click **Download import template**.
  - ✅ A file called `cylinder-import-template.csv` downloads. (You don't need to open it.)
- [ ] **16.** Click **Import CSV**. In the box **Or paste CSV data**, paste exactly this text (change `T2` to your code in every row):

  ```text
  serial,tag,manufacturer,gas,size,ownerId,branchId,testDue,lastTest,certificate
  T2-SER-D,T2-D,Test Works,Medical oxygen,B,Company owned,Delhi,2029-01-15,2026-01-15,T2-CERT
  T2-SER-E,T2-E,Test Works,Medical oxygen,B,Company owned,Delhi,2029-01-15,2026-01-15,T2-CERT
  T2-SER-F,T2-F,Test Works,Medical oxygen,B,Company owned,Delhi,2029-01-15,2026-01-15,T2-CERT
  T2-SER-G,T2-G,Test Works,Medical oxygen,B,Company owned,Delhi,2029-01-15,2026-01-15,T2-CERT
  T2-SER-H,T2-H,Test Works,Medical oxygen,B,Company owned,Delhi,2029-01-15,2026-01-15,T2-CERT
  ```

  Click **Save**.
  - ✅ Five new cylinders appear: `T2-D` to `T2-H`.
- [ ] **17.** Click **Import CSV** again and paste the **same text** again. Click **Save**.
  - ✅ The **whole import is refused**, and nothing is added twice.
- [ ] **18.** Search for `T2-C` and click it to open its details → **Replace tag**. New tag: `T2-C2`, reason: `label damaged`. Save.
  - ✅ Searching `T2-C2` finds it. Searching `T2-C` **also** finds the **same** cylinder (under its previous tags).
- [ ] **19.** On the Cylinders page, click each **filter button** along the top, one by one.
  - ✅ The list changes each time.
  - Finish by clicking **All** so no filter is left on.
- [ ] **20.** Search for the serial number `T2-SER-A`.
  - ✅ `T2-A` is found.

---

## Part 4 — Safety check

**Sign in as:** Quality

- [ ] **21.** Open `T2-A` → **Record inspection** → choose **Serviceable**, note `ok`. Leave the dates and certificate as they are. Save.
  - ✅ `T2-A` now shows **Serviceable**.
- [ ] **22.** Do the same for `T2-B`, `T2-E`, `T2-F`, `T2-G` and `T2-H`.
  - ✅ All five show **Serviceable**.
- [ ] **23.** Open `T2-D` → **Record inspection** → choose **Retired**, and type a reason. Save.
  - ✅ `T2-D` shows **Retired**, and its details no longer offer actions like Replace tag.

---

## Part 5 — Fill with gas

- [ ] **24.** **Sign in as Administrator.** Go to **Production → Create batch** and fill in:
  - Gas: **Medical oxygen** · Branch: **Delhi**
  - Tick `T2-A` and `T2-B`
  - Gas source / lot: `T2-LOT` · Fill operator: `Ravi`
  - Click **Save**. Write down the **batch number** (for example `BATCH-00007`).
  - ✅ The batch shows **Awaiting release**, with operator **Ravi**.
- [ ] **25.** Still as Administrator, click **Release** on that batch.
  - ✅ You get a message saying someone else must release it, and to **sign in as a Quality user**.
  - 👉 **This is correct.** The person who fills a batch may not approve it. Click **Cancel**.
- [ ] **26.** **Sign in as Quality.** Click **Release** on the batch. Certificate `T2-QC`, notes `ok`. Save.
  - ✅ The batch shows **Released**.
- [ ] **27.** Test rejecting one cylinder from a batch:
  1. **Sign in as Administrator.** Create **another batch** (Medical oxygen, Delhi) with `T2-E` and `T2-F`, lot `T2-LOT2`, operator `Ravi`. Write down this second batch number.
  2. **Sign in as Quality.** Open that batch (click **Details**) → **Reject cylinder** → choose `T2-F`, type a reason, save.
  3. Still as Quality, click **Release** on the same batch. Certificate `T2-QC2`, notes `ok`. Save.
  - ✅ `T2-F` is **on hold** (Quarantine).
  - ✅ The batch is **Released** with only `T2-E` in it.

---

## Part 6 — Order and delivery

- [ ] **28.** **Sign in as Administrator.** Go to **Orders & delivery → New order** and fill in:
  - Customer: `T2 Clinic` · Branch: **Delhi** · Gas: **Medical oxygen** · Size: **B** · Quantity: **2**
  - Priority: leave **Normal** · Requested date: **today**
  - Gas price per cylinder: leave **0** (Finance sets the real price when invoicing)
  - Click **Save**. Write down the **order number**.
  - ✅ The order shows **Open**.
- [ ] **29.** Click the order number to open it → **Dispatch order**.
  1. Click in the **scan box**, type `T2-A` and press **Enter**.
     - ✅ **Only** `T2-A` gets ticked, and the scan box empties.
  2. Do the same for `T2-B`.
  3. Vehicle: `DL01T2` · Driver: **Driver**.
  4. Click **Confirm dispatch**.
  - ✅ The order shows **Dispatched**, and both cylinders show **On vehicle**.
- [ ] **30.** Search for your **order number** on the Orders page.
  - ✅ Your order is found.
- [ ] **31.** Open the order → **Print challan**.
  - ✅ A printable delivery note appears. Close it **without printing**.
- [ ] **32.** Make **another order** the same way (as in step 28) but with quantity **3**. Open it → **Dispatch order**, tick only **2** cylinders, fill vehicle and driver, and confirm.
  - ✅ It's **refused** (the number of cylinders must match the order).
  - Close the form. Then click **Cancel** on that order in the list, give a reason, and confirm.
  - ✅ It shows **Cancelled**.
- [ ] **33.** **Sign in as Driver.** Open your first order → **Record delivery**.
  1. Tick **only** `T2-A`.
  2. Recipient: `Nurse T2`.
  3. Click **Record acceptance**.
  - ✅ The order shows **Partial**.
  - ✅ The **Driver** field says **"Driver"** (a name, not a code).
- [ ] **34.** **Sign in as Administrator.** Open the order → **Unload remainder**.
  1. Tick `T2-B`.
  2. For the seal question choose **Not verified**, and type a reason.
  3. Save.
  - ✅ The order shows **Closed · short delivery**.
- [ ] **35.** Make a **third order** the same way (as in step 28) but with quantity **1**. Dispatch `T2-E` to it (vehicle `DL01T2`, driver **Driver**). Then open it → **Record delivery** → tick `T2-E`, recipient `Nurse T2` → **Record acceptance**.
  - ✅ This order shows **Delivered**.

---

## Part 7 — Billing

**Sign in as:** Finance

- [ ] **36.** Go to **Billing & rentals**. Find your **first** order (the short delivery) → **Issue invoice**. Type **0** as the price and save.
  - ✅ It's **refused** (a price is needed).
- [ ] **37.** Try again with price `350`. Save.
  - ✅ The invoice is for **1 cylinder**, not 2 (only one was delivered). Call this **invoice A**.
- [ ] **38.** On invoice A click **Record payment**: amount `100`, method **UPI**, reference `T2-PAY1`. Save.
  - ✅ Invoice A shows **Partial**.
- [ ] **39.** Record the **rest of the amount** on invoice A: method **Bank**, reference `T2-PAY2`. Save.
  - ✅ Invoice A shows **Paid**, and its balance is **₹0**.
- [ ] **40.** Try another payment of `1` on invoice A.
  - ✅ It's **refused** (nothing is owed).
  - Now pick **any other invoice that still shows a balance** → **Record payment** → amount `1`, method **UPI**, reference `T2-PAY1` (already used in step 38).
  - ✅ It's **refused** (reference already used).
- [ ] **41.** Open invoice A → **Print invoice**.
  - ✅ The customer name, amounts and tax look right. Close it without printing.
- [ ] **42.** Click **Record deposit**: customer `T2 Clinic`, amount `500`, method **Bank**, reference `T2-DEP1`. Save.
  - ✅ It appears at the **top** of **"Receipts & deposits · newest first"**.
- [ ] **43.** Click **Refund deposit**: customer `T2 Clinic`, amount `100`.
  - ✅ It's **blocked**, because the clinic still holds cylinders. **This is correct.**
- [ ] **44.** Find your **third** order (`T2-E`) → **Issue invoice**, price `200`. Don't pay it. Call this **invoice B**.
  - Click **Credit** on invoice B → amount = **half** of its total → reason `price correction` → **Issue credit note**.
  - ✅ Invoice B now owes only **the other half**.
- [ ] **45.** Click **Credit** on invoice A (the **paid** one) → amount `100` → reason `goodwill` → **Issue credit note**.
  - ✅ `T2 Clinic` now has **₹100 available credit** (shown in the customer balances table).
- [ ] **46.** Click **Apply credit** (button near the top of the Billing page). Choose that ₹100 credit note and apply `100` to **invoice B**, with a reason.
  - ✅ Invoice B's balance goes **down by ₹100**.
- [ ] **47.** Click **Undo credit allocation** (button near the top of the Billing page). Choose the allocation you just made, type a reason, save.
  - ✅ Invoice B's balance goes **back up by ₹100**, and the ₹100 credit is available again.
- [ ] **48.** Click **Refund credit**: customer `T2 Clinic`, the same credit note, amount `150`, method **Bank**, reference `T2-CREF0`, reason `test`.
  - ✅ It's **refused** (only ₹100 is available).
  - Try again with amount `50`, method **Bank**, reference `T2-CREF1`, and type a reason such as `customer request`.
  - ✅ It works. ₹50 credit remains.
- [ ] **49.** Click **Rental invoice**: customer `T2 Clinic`, with a period that **ends today**.
  - ✅ It's **refused**. Rental periods must end **yesterday or earlier**.

---

## Part 8 — Returns and pickups

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **50.** Go to **Orders & delivery → Collect empties**: customer `T2 Clinic`, tick `T2-A`, vehicle `DL01T2`, driver **Driver**. Save.
  - ✅ `T2-A` is now **on the collection vehicle**.
- [ ] **51.** Click **Undo collection**: choose that collection, tick `T2-A`, type a reason. Save.
  - ✅ `T2-A` is **back with the customer**.
- [ ] **52.** Collect `T2-A` again (repeat step 50). Then click **Receive returns**: customer `T2 Clinic`, tick `T2-A`, receiving branch **Delhi**, contents **Empty**, and type a short note. Save.
  - ✅ `T2-A` is back at the **Delhi plant**.
- [ ] **53.** Open `T2-A` and scroll down to **Movement timeline**.
  - ✅ Every step you did is listed in order (registered, inspection, fill, dispatch, delivery, collection, return…), with **names** such as *Delhi Plant & Distribution*, *T2 Clinic* and the order number, not codes.
- [ ] **54.** Click **Report unknown** (Orders & delivery). Branch **Delhi**, a made-up serial such as `T2-UNKNOWN`, and a note. Save.
  - ✅ An alert appears on the **Safety** page.
- [ ] **55.** Go to **Safety**, find that alert → click **Resolve**, type a note, save.
  - ✅ It shows **Resolved**.

---

## Part 9 — Two tabs at once

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **56.** Open the app in **two browser tabs** (right-click the tab → **Duplicate**). In both tabs open cylinder `T2-A`.
  1. **Tab 1:** click **Record inspection**, choose Serviceable, type a note, but **don't save**.
  2. **Tab 2:** click **Replace tag**, new tag `T2-A2`, reason `test`, save.
  3. Go back to **Tab 1** and click **Save**.
  - ✅ You see a message that the record changed, and a **Reload latest form** button.
- [ ] **57.** Click **Reload latest form**, then **Save**.
  - ✅ It saves. (From now on `T2-A` is called `T2-A2`.)

---

## Part 10 — Emptying, suppliers and purchases

- [ ] **58.** **Sign in as Quality.** Open `T2-B` (it came back from the truck in step 34, so its contents are unknown). Click **Record emptying** → method **Venting**, type a note. Save.
  - ✅ `T2-B` now says **Empty**.
- [ ] **59.** **Sign in as Administrator.** Go to **Suppliers & purchases → Send cylinders**:
  - Service: **Hydrotest / inspection** · Supplier: `T2 Gas Supplier` · tick `T2-G` · Transfer reference: `T2-SEND1`
  - Save.
  - ✅ `T2-G` is now **at the supplier**.
  - (If a form ever asks for an **Owner permission reference**, you picked a cylinder owned by a customer or supplier. Your `T2` cylinders are company owned, so this shouldn't happen.)
- [ ] **60.** Click **Receive from supplier**: supplier `T2 Gas Supplier`, tick `T2-G`, Gas **Medical oxygen**, service **Test / inspection only**, contents received **Empty**, reference `T2-BACK1`. Save.
  - ✅ `T2-G` is back at the plant and says **Empty**, not Full.
- [ ] **61.** Click **Send cylinders** again: service **Refill**, supplier `T2 Gas Supplier`, tick `T2-H`, reference `T2-SEND2`. Save.
- [ ] **62.** Click **Receive from supplier**: supplier `T2 Gas Supplier`, tick `T2-H`, **then** choose Gas **Medical oxygen**.
  - ✅ `T2-H` **stays ticked** after choosing the gas.
  - Service **Refill**, contents received **Full**, reference `T2-BACK2`. Save.
  - ✅ A new batch appears on **Production** as **Awaiting release**.
- [ ] **63.** **Sign in as Quality.** Cylinders back from a supplier must be checked first:
  1. Open `T2-H` → **Record inspection** → **Serviceable**, note `ok`. Save.
  2. Go to **Production** and **Release** the new batch (certificate `T2-QC3`, notes `ok`).
  - ✅ It shows **Released**.
- [ ] **64.** **Sign in as Administrator.** Click **Receive purchase**: supplier `T2 Gas Supplier`, branch **Delhi**, gas **Medical oxygen**, reference `T2-PO1`. In the CSV box paste exactly (change `T2` to your code):

  ```text
  serial,tag,manufacturer,size,ownerId,lastTest,testDue,certificate
  T2-SER-P,T2-P,Test Works,B,Company owned,2026-01-15,2029-01-15,T2-CERT
  ```

  Save.
  - ✅ A new purchase batch appears as **Awaiting release**, containing `T2-P`.
- [ ] **65.** Do **Receive purchase** again with the **same reference** `T2-PO1` (change the tag and serial in the CSV to `T2-Q` and `T2-SER-Q`).
  - ✅ It's **refused** (reference already used).

---

## Part 11 — Recall

- [ ] **66.** **Sign in as Quality.** Go to **Production**. Find your **second batch** (from step 27, the one containing only `T2-E`, which is now at `T2 Clinic`) → **Recall** → reason `drill`. Save.
  - ✅ The batch shows **Recalled**.
  - ✅ The **Safety** page shows a recall alert for `T2-E`.
  - ✅ The batch **Details** list `T2 Clinic` as having received the gas.
- [ ] **67.** **Sign in as Administrator.** Go to **Safety** → find the recall alert for `T2-E` → click **Resolve**, type a note, save.
  - ✅ It's **refused** ("Cylinder is still offsite"), because `T2-E` is still at the customer.
- [ ] **68.** Go to **Orders & delivery → Receive returns**: customer `T2 Clinic`, tick `T2-E`, receiving branch **Delhi**, contents **Empty**, and type a short note. Save. Then **sign in as Quality**:
  1. Open `T2-E` → **Record inspection** → **Serviceable** → save.
     - ✅ It's refused, with a message telling you to use **Record emptying** first.
  2. Click **Record emptying** → **Evacuation**, with a note. Save.
  3. **Record inspection** → **Serviceable** again.
     - ✅ It works: `T2-E` is **back in service**.
- [ ] **69.** **Sign in as Administrator.** On **Safety**, click **Resolve** on the recall alert for `T2-E` now, with a note.
  - ✅ It's **Resolved** (the cylinder is back at the plant).

---

## Part 12 — Driver without internet

You need three one-cylinder orders for this part.

- [ ] **70.** **Sign in as Administrator.** Make **three** new orders the same way as in step 28, each with quantity **1**. Dispatch each one to driver **Driver**, vehicle `DL01T2`. In each Dispatch form, tick **any one** cylinder the list offers. Write down the three order numbers: **O1**, **O2**, **O3**.
  - ✅ All three show **Dispatched**.
  - (If the list offers no cylinders, other testers used them all up. Ask the person who shared this file to reset the demo.)
- [ ] **71.** **Sign in as Driver.** Open **O1** → **Record delivery** → tick the cylinder, recipient `Nurse T2` → click **Save evidence on device** (not Record acceptance).
  - ✅ A yellow box appears near the top saying **"1 saved delivery"**, with **Review evidence** and **Sync deliveries** buttons.
- [ ] **72.** Click **Review evidence**.
  - ✅ It shows the **order number** and the **cylinder tag** (and a short evidence ID).
- [ ] **73.** Click **Sync deliveries**.
  - ✅ The box clears and **O1** shows **Delivered**, with exactly **one** delivery.
- [ ] **74.** Pretend the internet is off:
  1. Press **F12** to open Chrome's developer tools → click the **Network** tab → change **No throttling** to **Offline**.
  2. Open **O2** → **Record delivery** → tick the cylinder, recipient `Nurse T2` → **Save evidence on device**.
     - ✅ The yellow box says **"You are offline"**.
  3. Change **Offline** back to **No throttling**.
  4. Click **Sync deliveries**.
  - ✅ **O2** shows **Delivered**.
- [ ] **75.** Make a conflict on purpose:
  1. As Driver, open **O3** → **Record delivery** → tick the cylinder, recipient `Nurse T2` → **Save evidence on device**. **Don't** sync yet.
  2. Open a **second tab**, **sign in as Administrator** there, open **O3** → **Unload remainder** → tick the cylinder → **Not verified** → reason `conflict test` → save.
  3. Go back to the **Driver** tab and click **Sync deliveries**.
  - ✅ The evidence shows **Needs office review**, and **O3** is **not** delivered.
  - Click **Review evidence** → **Download evidence for office review**. ✅ A file downloads.
  - Then click **Discard reconciled evidence**. ✅ The box clears.
- [ ] **76.** Pretend to be on a phone:
  1. Press **F12** → click the **phone icon** (top left of the developer tools) → choose **iPhone SE** from the list at the top.
  2. Go to **Orders & delivery**.
     - ✅ Each order row's **action buttons** stay visible on the right, even though the table is narrow.
  3. Tap an order number → **Record delivery**.
     - ✅ All buttons (Cancel, Save evidence on device, Record acceptance) are visible, or you can reach them by **scrolling inside the pop-up**.
  - Press **F12** again to go back to the normal view.

---

## Part 13 — Lost cylinder

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **77.** Open order **O1** and note the cylinder tag in its **Dispatch manifest**. Go to **Cylinders**, search that tag and open it → **Report loss / damage** → **Lost**, with a note. Save.
  - ✅ An alert appears on the **Safety** page.
- [ ] **78.** On the same cylinder click **Approve rental stop**: date **today**, and a reason. Save.
  - ✅ Rent stops from today.
- [ ] **79.** Click **Write off lost cylinder**.
  - ✅ The **Rental stop date** is already filled in with the date from step 78. Keep it.
  - Type a reason and click **Approve writeoff**.
  - ✅ The cylinder is **Retired**, and its loss alert on **Safety** is **Resolved**.

---

## Part 14 — People and settings

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **80.** Go to **Settings → Add member**. Name `T2 Tester`, email `t2@test.local` (use your code), role **Finance**, branch **Delhi**, password `short`. Save.
  - ✅ You get a clear message about the **password** (12 characters or more).
- [ ] **81.** Change the password to `LongTestPass123` and save.
  - ✅ The new member appears in the team list.
- [ ] **82.** Click **Edit access** on that member → change the role to **Auditor** → save.
  - ✅ The list shows the new role.
- [ ] **83.** Click **Reset password** on that member → new password `NewTestPass456` → save.
- [ ] **84.** **Sign out.** On the sign-in page open **Demo account** → choose **Other account (type an email)**. Email `t2@test.local`, password `LongTestPass123` (the **old** one) → **Sign in**.
  - ✅ It's **refused** (the old password no longer works).
  - Sign in again with `NewTestPass456`.
  - ✅ You're in, as an Auditor.
- [ ] **85.** While signed in as that member, go to **Settings → Change my password**: current `NewTestPass456`, new `ThirdTestPass789`.
  - ✅ You're **signed out** and must sign in with the new password.
- [ ] **86.** Test the lock-out:
  1. On the sign-in page choose **Other account**, email `t2@test.local`, and a **wrong password**. Click **Sign in** **5 times**.
  2. Try once more with the correct password `ThirdTestPass789`.
     - ✅ It says **"Too many login attempts"**. The account is locked for 15 minutes.
  3. Now sign in as **Administrator** from the Demo account list.
     - ✅ **Administrator still gets in** (other people are not locked out).
- [ ] **87.** As Administrator, go to **Settings** and click **Edit access** on **yourself** (Administrator). Untick **Faridabad**. Save.
  - ✅ It's **refused** (you can't lock yourself out of the company).
- [ ] **88.** Click **Edit profile** → change the **company name** to `Test Company` → save. Then open **invoice A** (Billing & rentals → click its number).
  - ✅ Invoice A still shows the **old** company name.
  - 👉 Go back to **Edit profile** and change the company name **back** to what it was (other testers share it).
  - ⚠️ **Never** change the password of the six shared demo accounts.

---

## Part 15 — Reports, exports and labels

**Sign in as:** Administrator (`admin@batra.demo`)

- [ ] **89.** Go to **Reports & audit**. Click **every tab**, including **Stock position**, **Movement ledger** and **Audit trail**. In **Movement ledger**, search `T2-A2`. (Each tab has its own search; switching tabs clears it.)
  - ✅ Your cylinder's movements are listed with names, not codes.
  - ✅ The **Audit trail** lists your actions, **including payments and deposits**.
- [ ] **90.** Click **Full JSON export**, then **Cylinder CSV**.
  - ✅ Both files download.
- [ ] **91.** Open any of your cylinders → **Print label**.
  - ✅ The label shows the **tag** and a **QR code**. Close it without printing.

---

## Part 16 — Each role only sees its own things

Sign in as each person below and check:

- [ ] **92.** **Auditor**: click around every page.
  - ✅ You can **read** everything, but there are **no** buttons that save, pay or dispatch.
- [ ] **93.** **Driver**:
  - ✅ You only see **your own** deliveries. **No** prices and **no** export buttons.
- [ ] **94.** **Operations**:
  - ✅ There is **no Billing & rentals** item in the left menu, and **Customers** shows no money amounts.
- [ ] **95.** **Finance**: open **Customers**.
  - ✅ There is **no Return** button.
- [ ] **96.** **Quality**: open any order (Orders & delivery → click an order number).
  - ✅ The **Driver** field shows a name (for example "Driver"), not a code.

---

## Part 17 — Final check

- [ ] **97.** Press **F5** to refresh the page. Sign in as **Administrator**.
  - ✅ **Everything** you made today is still there.

🎉 **Done! Thank you for testing.**

---

## Things that need real equipment

These can't be tested on a laptop screen. Skip them unless you have the equipment, and write **"not tested"**.

| What | How to test it |
|---|---|
| Barcode scanner gun | In a Dispatch form, scan two cylinder labels one after the other. Only those two should be ticked. |
| Phone camera scanner | Open the app link on a phone (it must start with `https://`) and scan a printed label. |
| Label printer / A4 printer | Print a label and a challan. Is it readable? Does the QR code scan? |
| Real signal loss | Record a delivery in a moving vehicle with weak signal, then sync later. |
| Accountant review | GST, HSN codes, invoice numbering and credit notes need an accountant's check. |
| Legal / client review | Rules for cylinders owned by customers or suppliers need the client's or a lawyer's approval. |

---

## What to do if something goes wrong

If a step does **not** show what the ✅ says:

1. **Don't** click Save again, and **don't** try to fix it.
2. Take a **screenshot** of the whole screen.
3. Write down:
   - the **step number** (for example "Step 46"),
   - **what you expected** to see,
   - **what actually happened** (copy any error message exactly),
   - **which account** you were signed in as.
4. Send it to the person who shared this file, then **continue with the next step**.
