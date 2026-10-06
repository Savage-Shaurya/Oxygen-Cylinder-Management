# Cylvero simplification plan

*Written 7 October 2026. This is a plan only. No app code has been changed.*

---

## Summary (read this first)

**The problem.** Cylvero was built for the office. Every person sees the office. A delivery driver who signs in today sees 9 menu items, tables with 7 columns, 7 filter buttons, and words like "custody", "manifest", "quarantine" and "revision 214". Only one of those 9 menu items is useful to him. To record one delivery of 3 cylinders he makes about 15 taps, types a name, and reads about 150 words.

**The fix.** Build a second, very simple face for the app, called **Basic mode**. Keep today's app as **Office mode**.

- Basic mode shows **4 big picture buttons**. Nothing else.
- Each button does **one job**. There are 6 jobs in total (see below).
- You **scan** cylinders. You never type a cylinder code.
- Every result is a **big green tick or a big red cross**, with a sound, a buzz and a spoken sentence in Hindi or English.
- Every save can be **undone for 5 seconds**.
- Office mode stays as it is. Admin, finance, quality and auditors keep working there. Drivers and godown helpers never see it.

**The 6 core jobs.**

| # | Job (what the worker would say) | Who | Uses today's server command |
|---|---|---|---|
| 1 | "I gave full cylinders" | Driver | `order.deliver` |
| 2 | "I took empty cylinders back" | Driver | `cylinder.collect` |
| 3 | "What is on my truck?" | Driver | read only |
| 4 | "What is this cylinder?" (scan) | Everyone | read only |
| 5 | "Cylinders came back to the godown" | Godown helper | `cylinder.return`, `order.unload` |
| 6 | "Load the truck" | Godown helper | `order.dispatch` |

Plus one small **"Problem"** button for drivers (unknown cylinder), which uses `return.discrepancy`.

**Why this is safe.** Phases 1 and 2 need **no server changes**. Basic mode sends the same commands, through the same `act()` function, with the same login cookie, CSRF token, retry key and audit record. The server still checks every permission. If Basic mode has a bug, the server still refuses unsafe work.

**Effort.** Phase 1 (drivers) about 2 weeks. Phase 2 (godown + Hindi voice) about 2 weeks. Phase 3 (tidy Office mode) about 1–2 weeks. Phase 4 (optional server work) only after you decide the questions in section 9.

---

## 1. Who uses Cylvero, and what they see today

### 1.1 The people

| Person | Today's role | Reads well? | Device | Needs |
|---|---|---|---|---|
| Delivery driver | `driver` | Often no | Cheap Android, outdoors, sun | Give cylinders, take empties, see his load |
| Godown / warehouse helper | `operations` (shares it with dispatch clerks) | Often no | Cheap Android or shared phone | Load trucks, receive returns |
| Hospital ward staff | **No role exists.** They never sign in. | Varies | — | Today they only give a name to the driver |
| Dispatch clerk / manager | `operations` / `admin` | Yes | Laptop | Orders, customers, everything |
| Quality checker | `quality` | Yes | Laptop or tablet | Inspections, batch release, recall |
| Accounts | `finance` | Yes | Laptop | Bills, payments, deposits |
| Auditor | `auditor` | Yes | Laptop | Read-only reports |

The basic users are the first three. Ward staff do not log in. In this plan they are served through the driver's phone (the "hand the phone to the nurse" step in Job 1).

### 1.2 Inventory of every screen

Counts below come from reading `src/App.tsx` and the component files. "Choices" means things you can tap. "Words" is an estimate of words on screen with typical demo data (5 rows in a table). Roles come from the `allowed(...)` checks in `src/App.tsx` and the `access` map in `server/domain.ts`.

**App frame (on every screen)** — `App()` in `src/App.tsx` lines ~2410–2510

| Part | What it shows | Roles | Choices | Words | Jargon |
|---|---|---|---|---|---|
| Sidebar | 10 menu items in 5 groups (Workspace, Operations, People, Finance, Control), "Demo workspace / Synthetic records" chip, user card, Sign out | All. Only "Billing" is hidden from drivers/ops/quality. **A driver sees 9 items, 8 of them useless to him.** | 11 | ~35 | Workspace, Synthetic records, Control |
| Top bar | Menu button (mobile), "Workspace / Page", Demo walkthrough, "Saved state · revision N", avatar | All | 2–3 | ~10 | **revision** |
| Offline panel | "Field evidence sync", list of saved deliveries with "Evidence ID", download JSON, discard | Driver (when items are queued) | 3 per item | ~40 | Evidence ID, sync, JSON |
| Toast | Server message as plain text for 5.5 seconds | All | 1 | 5–20 | Server texts such as "Invalid CSRF token", "Cylinder version changed", "Forbidden" are shown as-is |
| Demo walkthrough | 8 chapters of presenter notes | All (demo only) | ~10 | 300+ | many |

**Pages (menu items)**

| Screen | Contents | Roles that act here | Choices | Words | Jargon |
|---|---|---|---|---|---|
| Login | Demo account list (7), email, password, Sign in, marketing text | All | 4 | ~70 | workspace, role scoped, synthetic |
| Overview | Greeting with "saved revision N"; fleet card (4 numbers); 4 stat tiles; "Orders in motion" (6 rows); "Needs attention" (6 rows); "Recent activity" (6 rows); "Next actions" (2–3) | All (view). New order: admin, ops | ~28 | ~220 | Fleet position, custodian, revision, Quality watch, Traceable work, Audit trail |
| Cylinders | 4 header buttons (Download import template, Import CSV, Export CSV, Register cylinder); 4 stats; scan box; search; 7 filters; 7-column table; Details/Inspect/Retag per row | Register/import/retag: admin, ops. Inspect: admin, quality. Export: not driver | ~25 + 3 per row | ~180 | Asset register, serialized, **Custody**, Serviceable, **Quarantine**, Retag |
| Production | Create batch; 4 stats; search; 7-column table; Details/Release/Recall | Create: admin, ops. Release/recall: admin, quality | ~8 + 3 per row | ~120 | Batch, Release, Recall, Awaiting release, lot |
| Orders & delivery | **5 header buttons** (Undo collection, Receive returns, Collect empties, Report unknown, New order); 4 stats; search; **7 filters**; 7-column table; Details/Dispatch/Deliver/Unload/Cancel | Dispatch/unload/cancel/receive/undo: admin, ops. Deliver/collect/report: admin, ops, driver | ~19 + 5 per row | ~200 | Manifest, reconcile, Closed · short delivery, unloaded, Partial |
| Customers | Add customer; search; table; Details/Edit/Return | Add: admin, ops, finance. Edit: admin, finance | ~3 + 3 per row | ~90 | custody, commercial terms |
| Suppliers & purchases | 4 header buttons (Send, Receive filled, Receive new, Add supplier); 3 stats; table | admin, ops | ~6 + 2 per row | ~90 | custody, awaiting QC |
| Billing & rentals | Up to **7 header buttons**; 4 stats; Ready to bill; invoices table; customer account table; receipts table | admin, finance (auditor reads) | ~20+ | ~300 | allocation, credit note, deposit, outstanding, receivable |
| Safety | 4 stats; 3 sections (review queue, open investigations, recall register) | Inspect: admin, quality. Resolve: admin, ops, quality | ~10 + rows | ~150 | Quarantine, Exceptions, Investigations, Recall register |
| Reports & audit | 2 exports; 4 stats; 3 tabs (Stock, Movement, Audit trail) | Export: admin, auditor | ~6 | ~150 | **Audit**, movement, actor |
| Settings | Change password; business profile; integration status; team table | Admin edits. Others read | ~4–10 | ~120 | GSTIN, integrations, "Unconfigured" |

**Detail panel** (opens over any page) — `Detail()` lines ~4570–5206

| Kind | Fields | Buttons | Jargon |
|---|---|---|---|
| Cylinder | 10 fields (serial, gas & size, manufacturer, owner, branch, custodian, last test, next test, certificate, **record version**), QR label, movement timeline | Up to 7 (Record inspection, Record emptying, Report incident, Replace tag, Approve rental stop, Write off) | custodian, version, certificate |
| Order | 9 fields, dispatch manifest | Dispatch, Record delivery, Unload remainder, Issue invoice, Print challan | manifest, challan |
| Batch | 8 fields, cylinders, recipients | Release, Reject cylinder, Recall | release, recall |
| Party | 10 fields, holdings | Edit | GSTIN, credit limit, free days |
| Invoice | Bill, lines, receipts | Print, Record payment, Credit | credit note, allocation |

**Forms** (pop-up dialogs from `ActionForm`): about **40 forms**. Field counts (required fields in brackets):

| Form | Fields | Who | Basic-user relevant? |
|---|---|---|---|
| Record delivery | 3 (2) + "Save evidence on device" | driver, ops, admin | **Yes** |
| Collect empties | 5 (4) incl. typed vehicle number | driver, ops, admin | **Yes** |
| Report unknown return | 3 (3) incl. branch dropdown | driver, ops, admin | **Yes** |
| Receive customer returns | 5 (5) incl. required typed notes | ops, admin | **Yes** |
| Unload remaining stock | 3 (3) incl. seal question | ops, admin | **Yes** |
| Dispatch order | 4 (3) — first field is "Owner permission reference" | ops, admin | **Yes** |
| Create fill batch | 5 (5) | ops, admin | Later |
| Inspect cylinder | 6 (5) | quality, admin | Later |
| Register cylinder | 11 (11) | ops, admin | No (office) |
| New order | 8–9 (7) | ops, admin | No (office) |
| Supplier send / receive / purchase | 5–7 each | ops, admin | No (office) |
| All finance forms (invoice, rental, receipt, deposit, refund, credit, allocate, unallocate, credit refund) | 1–5 each | finance, admin | No (office) |
| Settings, users, passwords, import CSV, incidents, write-off, rental stop, retag, recall, release, reject, resolve exception, cancel order, undo collection | 1–5 each | admin/ops/quality | No (office) |

### 1.3 Status labels people see

Made by `display()` and `statusTone()` in `src/App.tsx`.

- Cylinder condition: Serviceable, Inspection due, Quarantine, Testing, Retired, Recalled.
- Cylinder place: Plant, Vehicle, Customer, Supplier. Contents: Empty, Full, Partial, Unknown.
- Order: Open, Dispatched, Partial, Closed · short delivery, Delivered, Cancelled.
- Batch: Awaiting release, Released, Recalled.
- Invoice: Issued, Paid, Credited.

A basic user needs only **five** of these ideas: *full*, *empty*, *safe to use*, *on hold (do not use)*, and *where it is*.

### 1.4 Jargon found on screen

Custody, custodian, manifest, quarantine, serviceable, batch, release, recall, revision, record version, certificate reference, owner permission reference, exception, discrepancy, evidence ID, audit trail, actor, challan, GSTIN, allocation, credit note, synthetic records, workspace, idempotent (in docs), CSRF (in a server error message), JSON (in offline download). Cylinder tags and serials (e.g. `BAT-00031`) and order numbers (`ORD-00012`) are shown as the main label of almost every row.

### 1.5 Other findings that matter for basic users

1. **The camera closes after every scan.** `ScannerInput.tsx` calls `control.stop()` after one code. To scan 5 cylinders you tap the camera button 5 times.
2. **Drivers see the whole office menu**, read-only. The server already limits the data they get (`server/http-app.ts` line ~106), but the screens are still there.
3. **The vehicle number is typed every time** you collect empties, and the driver is asked to pick himself from a list.
4. **Recipient name must be typed** for every delivery.
5. **"Receiving notes" must be typed** for every warehouse return.
6. **Errors are raw server text** ("Cylinder version changed", "Forbidden").
7. **Success is a small text toast** that disappears in 5.5 seconds. No sound, no buzz.
8. **No undo** for deliveries, returns or dispatch. Only "Undo collection" exists, and only for ops/admin.
9. **Fonts come from Google Fonts** (Geist). There is no Hindi font. On a weak network the page can render in a fallback font.
10. **English only.** No translation system exists. `index.html` has `lang="en"`.
11. Tap targets are small: many buttons are 34–39 px tall; text is often 10–13 px.
12. No "Add to home screen" support (no web manifest), so the app is opened from a browser bookmark.

---

## 2. The jobs, and how many steps they take today

Steps are counted on a phone, signed in already, starting from the Overview page. "N" is the number of cylinders.

### Job 1 — "I gave full cylinders" (driver)

Today:
1. Tap menu (☰).
2. Tap "Orders & delivery".
3. Find the order in a wide table (search box, 7 filters and 4 numbers above it).
4. Tap the order number. A detail panel opens with 9 fields.
5. Tap "Record delivery".
6. For each cylinder: tap the camera, aim, wait (camera closes). Or read "BAT-00031 · SER-1234 · B · Delhi" and tick a box. **2 taps per cylinder.**
7. Tap "Recipient name" and type it.
8. Tap "Record acceptance".
9. Read a small toast before it vanishes.

**Total: about 7 + 2N taps, 1 typed name, ~150 words read.** For 3 cylinders: ~13 taps.

### Job 2 — "I took empty cylinders back" (driver)

Today: menu → Orders & delivery → "Collect empties" → pick customer from a long dropdown → scan/tick each (2 taps each) → type vehicle number → check the driver dropdown (already him) → optional notes → Save.

**Total: about 6 + 2N taps, 1 typed vehicle number, ~100 words.**

### Job 3 — "What is on my truck?" (driver)

Today there is no such screen. The driver opens Orders, reads the table, and opens each order's detail to see which cylinders are on it.

**Total: 3 taps + 1 per order, and a lot of reading.**

### Job 4 — "What is this cylinder?" (everyone)

Today: menu → Cylinders → tap camera → scan → detail panel with 10 labelled fields, jargon, and a timeline.

**Total: 3 taps, ~120 words to read, and "Serviceable / Plant / Full" must be understood.**

### Job 5 — "Cylinders came back to the godown" (godown helper)

Today (empties): menu → Orders & delivery → "Receive returns" → pick customer → scan/tick each → check receiving branch → pick contents → **type receiving notes (required)** → Save.

Today (full cylinders the driver could not deliver): menu → Orders → find order → open → "Unload remainder" → tick each → answer seal question → type reason → Save.

**Total: about 7 + 2N taps and typed notes. The helper must first know whether each cylinder is an "empty from a customer" or a "full from a truck". They are two different screens.**

### Job 6 — "Load the truck" (godown helper)

Today: menu → Orders → find the open order → open → "Dispatch order" → skip "Owner permission reference" → scan/tick exactly the right number of cylinders → type vehicle number → pick driver → Confirm.

**Total: about 8 + 2N taps, typed vehicle number. Wrong count gives an error only at the end.**

### Problem — "I found a cylinder I don't know" (driver)

Today: menu → Orders → "Report unknown" → pick branch → type serial → type what you saw → Save. **6 taps and 2 typed fields.**

### Summary of today vs. target

| Job | Taps today (N=3) | Typing today | Target taps (N=3) | Target typing |
|---|---|---|---|---|
| 1 Give | ~13 | name | **3–4** + scans | none (tap a saved name) |
| 2 Take back | ~12 | vehicle | **3** + scans | none |
| 3 My truck | 3 + 1/order | none | **1** | none |
| 4 What is this? | 3 | none | **1** + scan | none |
| 5 Came back | ~13 | notes | **2–3** + scans | none |
| 6 Load truck | ~14 | vehicle | **3–4** + scans | none |
| Problem | 6 | 2 fields | **3** | none |

Scans with the new continuous camera cost **zero taps each**.

---

## 3. The new Basic mode

### 3.1 Big ideas

1. **Pictures first.** Every action is a big tile with one picture and one colour. Words are short and optional.
2. **One job per screen.** No menus, no tables, no filters, no search boxes.
3. **Scan, don't type.** The camera opens by itself and **stays open** until you tap Done.
4. **Count with dots.** "3 cylinders" is also shown as ● ● ○ (2 of 3 done).
5. **Loud feedback.** Green tick + happy sound + one buzz for success. Red cross + low sound + two buzzes for failure. A voice says what happened.
6. **Undo for 5 seconds.** Nothing is sent to the server until the 5-second ring runs out (see 3.6).
7. **The app guesses the boring parts.** Vehicle, driver, branch, customer and "contents = empty" are filled in from what is already known. The user only confirms.
8. **The office is a different door.** Basic users never see Office mode.

### 3.2 Who gets which mode

| Role | Starts in | Can switch? |
|---|---|---|
| driver | Basic | No |
| operations | Basic | Yes — small "Office" button in the corner |
| quality | Office | Yes — to Basic (for "What is this?"; later "Check cylinder") |
| admin | Office | Yes — to see what workers see |
| finance, auditor | Office | No |

This is decided in the browser from `session.user.role`. The server does not change. The choice is remembered per phone in `localStorage` (only as a convenience).

### 3.3 Colours, sizes and pictures

- **Tap targets:** at least **64 px** tall (the rule is 56 px; we leave room for gloves and hurry). At least 12 px between tiles.
- **Text:** at least 20 px, bold. Numbers 40–64 px.
- **Contrast:** dark text on white, or white on strong colour. No pale grey text. Test in sunlight at full brightness.
- **Colour always has a shape too** (tick, cross, triangle), so colour-blind users are not lost.

| Meaning | Colour | Shape |
|---|---|---|
| Give / done / safe | Green `#0A7A3B` | ✔ tick, cylinder with arrow out |
| Take back / empties | Blue `#1557B0` | cylinder with arrow in |
| Load / truck | Orange `#C25E00` | truck |
| Scan / look | Purple `#5B3CC4` | QR frame |
| Problem / hold / stop | Red `#B3261E` | ✖ cross, raised hand |

**Cylinder pictures** (custom SVG, new file `src/basic/pictures.tsx`):

```
  FULL        EMPTY       ON HOLD      UNKNOWN
  .--.        .--.        .--.         .--.
 |####|      |    |      | \/ |       | ?? |
 |####|      |    |      | /\ |       |    |
 |####|      |    |      |    |       |    |
  '--'        '--'        '--'         '--'
  blue        white      red + ✖      grey + ?
```

**Place pictures:** factory (godown), truck, hospital/home (customer), building with gear (supplier). Phosphor (already installed) has `Truck`, `Factory`, `Warehouse`, `Hospital`, `House`, `QrCode`, `CheckCircle`, `XCircle`, `SpeakerHigh`, `ArrowUUpLeft`, `CloudSlash`, `Warning`, `HandPalm`. Use those plus the custom cylinder.

**Status mapping for Basic mode** (one new function, `basicStatus(cylinder)`):

| Server value | Basic picture | Spoken (English / Hindi) |
|---|---|---|
| `contents: full` + serviceable + released + test not due | Full cylinder + green tick | "Full. Ready." / "भरा हुआ। तैयार।" |
| `contents: empty` + serviceable | Empty cylinder | "Empty." / "खाली।" |
| quarantine / testing / recalled / inspection_due / test overdue / retired | Red ✖ cylinder + hand | "Stop. Do not use. Give to office." / "रुको। इस्तेमाल मत करो। ऑफिस को दो।" |
| custody plant / vehicle / customer / supplier | Factory / truck / hospital / building | "At godown" / "गोदाम में", etc. |

Serial, tag, batch and order numbers are **hidden behind a small "i" button** for anyone who needs them.

### 3.4 Language (i18n)

- **Start with English and Hindi.** Keep the door open for Marathi, Gujarati, Bengali, Tamil, etc.
- **Structure:** a tiny home-made system. No library is needed for ~150 short strings.
  - `src/i18n/en.ts`, `src/i18n/hi.ts` — plain objects with the same keys, for example `give.title`, `give.say.done`.
  - `src/i18n/index.ts` — `t(key, params)`, `speakText(key, params)`, `useLang()` hook, and the language choice stored per phone.
  - TypeScript checks that `hi.ts` has every key that `en.ts` has.
  - Each key can have two forms: **short label** (on screen) and **spoken sentence** (a little longer and friendlier).
  - Numbers use normal digits (1, 2, 3), which most Hindi readers know. Dots show the same count.
  - `<html lang>` is switched to `hi` or `en`, so screen readers and TTS pick the right voice.
- **Language picker** on the first screen: two big buttons showing the language **in its own script** — "हिंदी" and "English" — and a speaker icon on each. No flags.
- **Font:** bundle **Noto Sans** and **Noto Sans Devanagari** (OFL licence) inside the app, through the `@fontsource` packages or as files in `public/`. Do not load Google Fonts for Basic mode: it fails on a weak network.
- **Office mode stays English** in Phases 1–3. Translate later if needed.

### 3.5 Voice

- Every screen has a **speaker button** (top right). Tapping it reads the screen's one-line instruction.
- Results (tick/cross) are **spoken automatically**. A setting can turn auto-voice off.
- Use the browser's **`speechSynthesis`** with `lang = 'hi-IN'` or `'en-IN'`. It works with no internet when the phone has the Google voice data for that language.
- **Fallback:** if the phone has no Hindi voice (`speechSynthesis.getVoices()` has no `hi` voice), play **pre-recorded short clips** shipped inside the app (about 30 clips × 2 languages, Opus/MP3, ~4 KB each, ~250 KB total). These are allowed by the current CSP because they come from the same site. *(Owner decision: record real voices, or rely on phone voices only.)*
- Sounds for tick and cross are made in code with the Web Audio API (two short tones). No sound files needed.
- Buzz with `navigator.vibrate` (Android Chrome supports it). One short buzz = OK. Two = problem.
- All three (voice, sound, buzz) must be guarded so nothing breaks in old browsers or in the test runner (jsdom has none of them).

### 3.6 Undo

The server has **no undo command** for deliveries, returns or dispatch (only `collection.reverse`, for ops/admin). Adding server undo would also add audit records and rule risks.

So Basic mode uses a **"wait 5 seconds, then send"** pattern:

1. User taps Done.
2. A big card shows the result **and a ring that empties over 5 seconds**, with a big **UNDO** button.
3. If the user taps UNDO, nothing was sent. Nothing is in the audit log. We go back to the scan screen with the same cylinders.
4. When the ring finishes, the command is sent through `act()` as today. Then the green tick (or red cross) shows.
5. If the user leaves the page during the 5 seconds (`pagehide`), the command is sent at once.
6. Deliveries made while offline go straight into the existing device queue (`queueDelivery`) after the 5 seconds.

Trade-off: the result appears 5 seconds later. For a driver standing at a ward this is fine. *(Owner decision: 5 seconds, 3 seconds, or a real server undo later — see section 9.)*

### 3.7 Errors in plain words

All server errors are mapped to **four friendly screens** (new `src/basic/errors.ts`). The real message is kept under the "i" button for the office.

| What happened | Detected by | Picture + words |
|---|---|---|
| No internet | `ApiError.status === 0` | Cloud with slash. "No network. Saved on phone." (for deliveries) or "No network. Try again." |
| Someone else changed it | 409 | Circular arrows. App reloads data by itself and says "Updated. Check again." |
| Not allowed / wrong cylinder | 403, or scan not in the list | Red hand. "Not this one. Give to office." |
| Anything else | other | Red cross + phone icon. "Problem. Call the office." + office phone number from Settings |

### 3.8 Motion (Anime.js and Skiper-style ideas)

Motion is used **only to explain**, never to decorate. Everything must be **bundled from npm** because `vercel.json` sets `script-src 'self'`. No CDN.

**Library choice:** add **`animejs` v4** (MIT, no dependencies, tree-shakable). Use its `createScope({ mediaQueries: { reduceMotion: '(prefers-reduced-motion: reduce)' } })` so every animation has a "no motion" version. Do **not** add `framer-motion` or `motion`: the Skiper UI legacy components depend on it, and two animation systems would bloat a cheap-phone bundle. Skiper ideas are **re-built** with Anime.js instead of copied.

| Where | Animation | Anime.js feature | Why it helps |
|---|---|---|---|
| Success | Tick **draws itself** in a green circle, circle pops 1.0 → 1.1 → 1.0 (~400 ms) | `svg.createDrawable` + `animate` | Eye goes straight to the answer |
| Failure | Red cross draws, card **shakes left-right 3 times** (~300 ms) | `createDrawable` + `animate` with keyframes | "No" without words |
| Undo ring | Ring **empties over 5 s** around the UNDO button | `createDrawable` on a circle (`draw: '0 1' → '0 0'`) | Shows "you still have time" |
| Scan count | New dot **fills and bounces** when a cylinder is scanned | `animate` scale with spring easing; `stagger` when several fill | Shows progress as a count |
| Big number | Count on "My truck" **rolls up** to its value | `animate` on a number object (`modifier: Math.round`) | Rebuilds Skiper's *animated-number-counter* without framer-motion |
| Scan frame | Corner brackets **breathe** slowly | `animate` loop, alternate | "Point the camera here" |
| First use hint | A **pointing hand** taps the main tile twice, only the first 3 times | `createTimeline` | Teaches without text |
| Final confirm (optional) | **Slide-to-finish** bar, like answering a phone call | `createDraggable` | Re-creates Skiper legacy *slide-button* idea; stops pocket taps. Must also accept a long-press so it is not the only way. |
| Home tiles | Tiles **rise in one after another** once after login (total < 300 ms) | `stagger` | Gentle, shows "these are your 4 choices" |

**Reduced motion:** when the phone asks for less motion, tick and cross **appear instantly**, nothing shakes or bounces, the undo ring becomes a **5-4-3-2-1 number countdown**, the hand hint becomes a still arrow. Sound, buzz and voice remain.

**Other libraries in `_resources/`:** most (Magic UI, Aceternity, Motion Primitives, Cult UI, SmoothUI) need `motion`/`framer-motion` and Tailwind patterns built for marketing pages. React Bits has a Commons Clause licence. **Recommendation: use none of them for Basic mode.** At most, copy a CSS-only "pulse ring" idea for the scan button.

### 3.9 Scanning (the main way in)

The app already has scanning: `src/ScannerInput.tsx` uses `@zxing/browser` (bundled, CSP-safe). QR labels are printed by `src/CylinderLabel.tsx` and encode the **cylinder tag**. Old tags and serial numbers already scan too (`aliases` in `recordOptions`).

Changes for Basic mode:

1. New `continuous` option: camera **stays open** and keeps reading. The same code is ignored for 2 seconds so one cylinder is not counted twice.
2. Every good scan: dot fills, short beep, buzz.
3. Every bad scan (not in the list): red flash on the frame, low beep, spoken reason ("Not on this order").
4. Torch button (flashlight) if the phone supports it (`track.applyConstraints({ advanced: [{ torch: true }] })`), for dark godowns.
5. Typing a code stays possible, but only behind a small keyboard icon (for a torn label).
6. Handheld Bluetooth scanners that "type" the code keep working, because the hidden input stays.

---

## 4. Wireframes

All screens are phone portrait (360–412 px wide). `[ ]` = big tile/button. `(🔊)` = speaker. `(i)` = more details. Words in quotes are the short labels; Hindi is shown in the same place when Hindi is chosen.

### 4.1 First time on a phone — language

```
+--------------------------------------+
|                                      |
|            [ Cylvero logo ]          |
|                                      |
|   +------------------------------+   |
|   |                              |   |
|   |        हिंदी           (🔊)  |   |
|   |                              |   |
|   +------------------------------+   |
|   +------------------------------+   |
|   |                              |   |
|   |       English          (🔊)  |   |
|   |                              |   |
|   +------------------------------+   |
|                                      |
+--------------------------------------+
```

Sign-in itself stays email + password in Phase 1–2 (one time per 12-hour shift; the session cookie lasts 12 hours). A simpler sign-in is a Phase 4 decision (section 9).

### 4.2 Driver home

```
+--------------------------------------+
| (☁ 2)   Ramesh            (🔊) (?)   |   ☁ 2 = two deliveries saved on phone
+--------------------------------------+
| +----------------+ +----------------+|
| |   [cyl]→[🏥]   | |   [🏥]→[cyl]   ||
| |                | |                ||
| |     GIVE       | |   TAKE BACK    ||
| |   ● ● ● ○      | |                ||
| |  green         | |  blue          ||
| +----------------+ +----------------+|
| +----------------+ +----------------+|
| |    [truck]     | |   [QR frame]   ||
| |                | |                ||
| |   MY TRUCK     | |     SCAN       ||
| |      6         | |                ||
| |  orange        | |  purple        ||
| +----------------+ +----------------+|
|                                      |
|  [ ✋ Problem ]              red, small|
+--------------------------------------+
```

- The dots on GIVE show cylinders still to deliver today.
- The number on MY TRUCK is cylinders on the truck right now.
- (?) replays the pointing-hand hint and reads the screen aloud.
- No menu. No sign-out on the home screen: it sits inside (?) → "Exit" with a confirm picture.

### 4.3 Godown helper home (operations role)

```
+--------------------------------------+
| (☁)   Suresh      [Office]  (🔊) (?) |   [Office] only for ops/admin/quality
+--------------------------------------+
| +----------------+ +----------------+|
| |  [truck]→[🏭]  | |  [🏭]→[truck]  ||
| |                | |                ||
| |  CAME BACK     | |  LOAD TRUCK    ||
| |                | |   3 orders     ||
| |  blue          | |  orange        ||
| +----------------+ +----------------+|
| +----------------+ +----------------+|
| |   [QR frame]   | |   [cyl ✔]      ||
| |                | |                ||
| |     SCAN       | |   FILLED       ||  (Phase 3; empty slot until then)
| |  purple        | |  green         ||
| +----------------+ +----------------+|
+--------------------------------------+
```

### 4.4 Job 1 — Give (deliver)

**Step 1: who?** Cards come from the driver's own dispatched orders (the server already sends only his). If there is only one, this step is skipped.

```
+--------------------------------------+
| (←)        GIVE              (🔊)    |
+--------------------------------------+
| +----------------------------------+ |
| | [🏥]  City Care Hospital         | |
| |       ● ● ○      2 of 3 left     | |
| +----------------------------------+ |
| +----------------------------------+ |
| | [🏠]  Sharma (home care)         | |
| |       ●          1 left          | |
| +----------------------------------+ |
+--------------------------------------+
  🔊 "Who are you giving to? Tap the picture."
```

The customer card shows the **first letter in a big circle** and the name, so a non-reader can match by shape and the driver can be told "the green H".

**Step 2: scan.**

```
+--------------------------------------+
| (←)  [🏥] City Care          (🔊)    |
+--------------------------------------+
|  +--------------------------------+  |
|  |  ┌─                        ─┐  |  |
|  |                                |  |
|  |        live camera view        |  |
|  |                                |  |
|  |  └─                        ─┘  |  |
|  +--------------------------------+  |
|          [🔦]          [⌨]          |
|                                      |
|          ●   ●   ○                   |   fills as cylinders are scanned
|                                      |
|  +--------------------------------+  |
|  |      ✔  DONE  (2)              |  |  green, appears after 1st scan
|  +--------------------------------+  |
+--------------------------------------+
  🔊 "Scan each cylinder you give."
```

- Only cylinders on this order can be scanned (today's rule). Others give a red flash: "Not on this order."
- Giving fewer than all is fine (partial delivery, as today).

**Step 3: who took them?** (recipient is required by the server)

```
+--------------------------------------+
| (←)   Who took them?         (🔊)    |
+--------------------------------------+
|  +--------------------------------+  |
|  | [👤]  Sister Mary              |  |   names used before at this
|  +--------------------------------+  |   customer, saved on this phone
|  +--------------------------------+  |
|  | [👤]  Ward boy Raju            |  |
|  +--------------------------------+  |
|  +--------------------------------+  |
|  | [✏ 🎤]  New name               |  |   opens keyboard; Gboard mic works
|  +--------------------------------+  |
|                                      |
|  [ 📱 Hand phone to nurse ]          |   big-text screen: "Type your name"
+--------------------------------------+
```

**Step 4: result with undo.**

```
+--------------------------------------+
|                                      |
|              .-------.               |
|             /    ✔    \              |   tick draws itself
|             \         /              |
|              '-------'               |
|                                      |
|          2  [cyl][cyl]  given        |
|          to  [🏥] City Care          |
|                                      |
|        +----------------------+      |
|        |  ( ◔ )   UNDO        |      |   ring empties in 5 s
|        +----------------------+      |
|                                      |
+--------------------------------------+
  🔊 "Two cylinders given to City Care." *(beep, buzz)*
```

After 5 seconds the UNDO button turns into **[ 🏠 HOME ]**. If offline, the tick has a small phone icon: "Saved on phone. Will send later."

### 4.5 Job 2 — Take back (collect empties)

```
Step 1: customer                     Step 2: scan
+-----------------------------+      +-----------------------------+
| (←)   TAKE BACK      (🔊)   |      | (←) [🏥] City Care   (🔊)   |
+-----------------------------+      +-----------------------------+
| +-------------------------+ |      |  [ camera ]                 |
| | [🏥] City Care      [H] | |      |                             |
| |   has 7 of ours         | |      |   ● ● ●   3 taken           |
| +-------------------------+ |      |                             |
| +-------------------------+ |      |  [ ✔ DONE (3) ]             |
| | [🏠] Sharma         [S] | |      +-----------------------------+
| |   has 1 of ours         | |
| +-------------------------+ |      Step 3: tick + UNDO (as Job 1)
+-----------------------------+      🔊 "Three empties taken from City Care."
```

- Customers listed are those on his route today (same rule the server and today's form use).
- **Vehicle** comes from today's dispatched order for this driver. If he has none, ask once with big number keys and remember it.
- **Driver** is himself. Not shown.
- A scanned cylinder that is **not at this customer** gives: red hand, "This is not at City Care. Keep it apart. Tell office." and a one-tap **"Report it"** (goes to the Problem flow with the code filled in).

### 4.6 Job 3 — My truck

```
+--------------------------------------+
| (←)      MY TRUCK            (🔊)    |
+--------------------------------------+
|        [truck]   DL01 AB 1234        |
|                                      |
|   FULL  [cyl] x 4        ● ● ● ●     |
|   EMPTY [cyl] x 2        ○ ○         |
|                                      |
|  Stops today:                        |
| +----------------------------------+ |
| | [🏥] City Care      ● ● ○  GIVE ▶| |   ▶ jumps into Job 1 for them
| +----------------------------------+ |
| | [🏠] Sharma         ●      GIVE ▶| |
| +----------------------------------+ |
| | [✔] Apollo Clinic   done         | |
| +----------------------------------+ |
+--------------------------------------+
  🔊 "Four full and two empty on your truck."
```

Read-only. Built from data the driver already receives.

### 4.7 Job 4 — Scan: what is this cylinder?

```
+--------------------------------------+
| (←)       SCAN               (🔊)    |
+--------------------------------------+
|  [ camera, opens by itself ]         |
+--------------------------------------+

after a scan:

+--------------------------------------+
| (←)                   (🔊)   (i)     |
+--------------------------------------+
|                                      |
|     .--.                             |
|    |####|      FULL                  |
|    |####|      ✔ READY               |   green band
|     '--'                             |
|                                      |
|   Where:  [🏭]  Godown, Delhi        |
|   Gas:    O₂  (medical)              |
|                                      |
|  [ 🔁 Scan next ]                    |
+--------------------------------------+
  🔊 "Full. Ready. At godown."

If on hold:  red band, [cyl ✖] [✋] "STOP. Do not use. Give to office."
(i) shows tag, serial, test due, batch, owner for office staff.
```

### 4.8 Problem — unknown or wrong cylinder (driver)

```
+--------------------------------------+
| (←)      PROBLEM             (🔊)    |
+--------------------------------------+
|   Scan it (or [⌨] type)              |
|   [ camera ]                         |
+--------------------------------------+
then: what is wrong?
| +----------------+ +----------------+|
| |   [cyl ?]      | |  [cyl, no tag] ||
| |  NOT OURS      | |  NO LABEL      ||
| +----------------+ +----------------+|
| +----------------+ +----------------+|
| |  [cyl crack]   | |   [cyl ✚]      ||
| |  DAMAGED       | |  OTHER (🎤)    ||
| +----------------+ +----------------+|
then: red-orange tick "Office will check" + UNDO
```

Sends `return.discrepancy`. The branch comes from the driver's only branch (if he has more than one, his current order's branch). The picture choice becomes the note text, in English, for the office ("Driver reported: damaged"), so the user's real choice is recorded.

### 4.9 Job 5 — Came back to godown (helper)

```
Step 1: scan everything that came off the truck
+--------------------------------------+
| (←)     CAME BACK            (🔊)    |
+--------------------------------------+
|  [ camera ]                          |
|                                      |
|  EMPTY from customers                |
|   [🏥] City Care      ○ ○ ○   3      |
|   [🏠] Sharma         ○       1      |
|  FULL back from truck                |
|   [truck] ORD for Apollo   ● ●  2    |
|                                      |
|  [ ✔ DONE (6) ]                      |
+--------------------------------------+
```

The app sorts each scan by itself:
- cylinder at a customer or on a pickup truck → **empty return** group (by customer);
- cylinder still on a delivery truck → **full, not delivered** group (by order).

```
Step 2 (only if a FULL group exists): seal question
+--------------------------------------+
|   Are the seals OK on these 2?       |
|   [picture: valve with seal]         |
| +----------------+ +----------------+|
| |  ✔  YES, SEAL  | |  ✖  NOT SURE   ||
| |     OK         | |  (hold them)   ||
| +----------------+ +----------------+|
+--------------------------------------+

Step 3 (optional): anything wrong?
| [✔ ALL OK]   [cyl crack] SOME DAMAGED   [cyl ½] NOT EMPTY |

Step 4: tick + UNDO. 🔊 "Six cylinders back in godown."
```

- Sends one `cylinder.return` **per customer** and one `order.unload` **per order**, one after another, each with its own retry key. If one fails, the result screen shows which group failed (red) and which worked (green).
- Receiving branch = the helper's branch (same default as today). Contents = empty unless "Not empty" is chosen.
- The required notes are filled from the helper's picture choice ("Received by scan. All OK."). The office sees the same note as today.
- "Not sure" on seals keeps today's safe default: cylinders are held for inspection.

### 4.10 Job 6 — Load truck (helper)

```
Step 1: which order?
+--------------------------------------+
| (←)     LOAD TRUCK           (🔊)    |
+--------------------------------------+
| +----------------------------------+ |
| | [🏥] City Care   O₂  B   ○○○  3  | |
| |      🔴 URGENT                    | |
| +----------------------------------+ |
| | [🏠] Sharma      O₂  B   ○    1  | |
| +----------------------------------+ |
+--------------------------------------+

Step 2: scan until the dots are full        Step 3: which driver?
+-----------------------------+             +-----------------------------+
| [ camera ]                  |             | +-------------------------+ |
|                             |             | | [R] Ramesh  DL01AB1234  | |
|   ● ● ○      2 of 3         |             | +-------------------------+ |
|                             |             | | [M] Mohan   DL02CD5678  | |
| (DONE appears only when     |             | +-------------------------+ |
|  all 3 are scanned)         |             +-----------------------------+
+-----------------------------+             Step 4: tick + UNDO
```

- Only safe, released, full stock for this order can be scanned (the same rule as today's `dispatch()` eligibility list). Others: red flash + reason in words and voice ("Not filled", "On hold", "Wrong size").
- The exact count rule stays: DONE appears only at N of N.
- The vehicle shown next to each driver is the last one used with that driver on this phone. Tapping the number lets the helper change it with big number keys.
- **If any scanned cylinder belongs to another company** (third-party owner), Basic mode stops: "Ask office to load this one." The owner-permission field stays in Office mode only.

---

## 5. Remove, hide, merge, keep

### 5.1 Remove or hide in Basic mode (never shown)

- Sidebar, menu button, breadcrumb "Workspace / …", "Saved state · revision N", Demo walkthrough, workspace chip.
- All tables, filter pills, search boxes, stat strips, "Recent activity", "Needs attention".
- Production, Customers, Suppliers, Billing, Safety, Reports, Settings pages.
- CSV import/export, template download, print challan, QR label printing.
- Tag, serial, order and batch numbers as main labels (moved behind "i").
- Owner permission reference, certificate, test dates, record version, branch pickers, driver picker for drivers, notes boxes.
- "Evidence ID" and JSON download in the offline panel (replaced by a ☁ count; the download stays in Office mode for support).
- Raw server error text (moved behind "i").

### 5.2 Hide in Office mode for roles that cannot use them (Phase 3)

- Drivers: Office mode is not reachable at all.
- Operations: hide Billing (already), Reports' audit tab, Settings except "Change password".
- Quality: hide Suppliers, Customers editing, Billing.
- Remove "Saved state · revision N" from the top bar for everyone (keep it in Settings for support).
- Remove "Demo walkthrough" outside demo mode (already) and move it into the user menu in demo mode.

### 5.3 Merge

| Today | Becomes |
|---|---|
| "Receive returns" + "Unload remainder" | Basic: **Came back** (one scan, app sorts) |
| "Collect empties" + "Report unknown" | Basic: **Take back**, with "Report it" when a scan does not match |
| "Record delivery" + "Save evidence on device" | Basic: one **Done**. The app picks online or device queue by itself. |
| Cylinders page scan box + detail panel | Basic: **Scan** card |
| Office: "Register cylinder", "Import CSV", "Download import template" | Office: one **Add cylinders** button with two tabs (one / many) |
| Office: 5 header buttons on Orders | Office: **New order** + a "More ▾" menu |
| Office: 7 header buttons on Billing | Office: **Record payment** + "More ▾" |
| Office: Customers + Suppliers | Office: **People** page with two tabs (optional) |

### 5.4 Keep exactly as is

- All server rules, permissions, CSRF, sessions, idempotency keys, revision checks, audit log.
- Every Office mode form and page (only tidied in Phase 3).
- The offline delivery queue (`src/offline.ts`, `src/offline-rules.ts`).
- QR label content (tag) and scanner library.
- Indian date and rupee formatting.

---

## 6. Phased plan

Effort is for one experienced front-end developer. "Day" = one working day.

### Phase 0 — Prepare (2–3 days)

- Owner answers the decisions in section 9.
- Buy or borrow **2 cheap Android phones** (e.g. 2–3 GB RAM, Android 11–13, Chrome). Test the current QR scan and Hindi voice on them.
- Record 3 drivers and 2 helpers doing today's jobs (time and taps). This is the "before" number.
- Add `animejs` and the two Noto fonts to `package.json`. Run `npm audit`.

### Phase 1 — Drivers get Basic mode (biggest win, lowest risk) — about 10–12 days

No server change. Office mode untouched.

**New files**

| File | What it does | Effort |
|---|---|---|
| `src/basic/BasicApp.tsx` | Basic shell: top bar (☁, name, 🔊, ?), screen stack, back button, mode switch | 1 d |
| `src/basic/Home.tsx` | 4 tiles per role (driver set in Phase 1) | 0.5 d |
| `src/basic/jobs/Give.tsx` | Job 1 (customer → scan → recipient → result) | 2 d |
| `src/basic/jobs/TakeBack.tsx` | Job 2 | 1 d |
| `src/basic/jobs/MyTruck.tsx` | Job 3 | 0.5 d |
| `src/basic/jobs/ScanLookup.tsx` | Job 4 | 0.5 d |
| `src/basic/jobs/Problem.tsx` | Unknown cylinder | 0.5 d |
| `src/basic/components/BigTile.tsx`, `CountDots.tsx`, `CustomerCard.tsx`, `ResultScreen.tsx`, `UndoButton.tsx`, `SpeakButton.tsx` | Shared big parts | 1.5 d |
| `src/basic/pictures.tsx` | Cylinder / place SVG pictures | 0.5 d |
| `src/basic/status.ts` | `basicStatus()` and eligibility helpers (reuse rules from `App.tsx`) | 0.5 d |
| `src/basic/feedback.ts` | Sound (Web Audio), vibrate, speak — all guarded | 0.5 d |
| `src/basic/pending.ts` | 5-second "send later / undo" logic, `pagehide` flush, offline handoff to `queueDelivery` | 1 d |
| `src/basic/errors.ts` | Map `ApiError` to 4 friendly screens | 0.25 d |
| `src/basic/motion.ts` | Anime.js scope with reduced-motion branch; tick, cross, dots, ring | 1 d |
| `src/basic/basic.css` | Big sizes, high-contrast colours | 0.5 d |
| `src/i18n/index.ts`, `en.ts`, `hi.ts` | Strings (Hindi text first draft, checked by a native speaker) | 1 d |

**Changed files**

| File | Change |
|---|---|
| `src/App.tsx` | After sign-in: if role is `driver` (or Basic chosen), render `<BasicApp>` instead of the office shell. Pass `session`, a `run()` wrapper and `bootstrap` refresh. ~20 lines. |
| `src/ScannerInput.tsx` | Add `continuous`, `onReject`/duplicate-guard and torch props. Default behaviour unchanged so office forms keep working. |
| `src/OfflinePanel.tsx` | Export the queue count/sync logic as a hook so Basic mode can show ☁ N and sync with one tap. Office UI unchanged. |
| `index.html` | Keep; `lang` set at runtime. |

**New tests** (`tests/basic-*.test.tsx`, same jsdom + esbuild style as `forms-app.test.tsx`):
- Driver sees Basic home, not the sidebar.
- Give sends exactly `order.deliver` with the scanned IDs and chosen recipient.
- UNDO within 5 s sends nothing.
- Offline Give writes to the device queue.
- Scanning a cylinder not on the order does not add it.
- Each Hindi key exists (type check + test).

**Done when:** a driver who cannot read English can do Jobs 1–4 on a cheap phone after a 5-minute demo, in under half today's taps.

### Phase 2 — Godown helpers, voice and install — about 10 days

| Work | Files | Effort |
|---|---|---|
| Job 5 Came back (sort scans, seal question, per-group sends, partial-failure result) | `src/basic/jobs/CameBack.tsx` | 3 d |
| Job 6 Load truck (order cards, exact count, driver cards, remembered vehicle, third-party stop) | `src/basic/jobs/LoadTruck.tsx` | 2.5 d |
| Operations role gets Basic home + "Office" switch | `BasicApp.tsx`, `App.tsx` | 0.5 d |
| Pre-recorded voice fallback clips (if chosen) | `public/voice/hi/*.mp3`, `public/voice/en/*.mp3`, `feedback.ts` | 1.5 d (+ recording time) |
| Self-hosted Noto fonts; drop Google Fonts for Basic | `basic.css`, `package.json` | 0.5 d |
| "Add to home screen": `public/manifest.webmanifest`, icons, `<link rel="manifest">` (CSP already allows `manifest-src 'self'`) | `index.html`, `public/` | 0.5 d |
| First-use pointing-hand hints | `motion.ts`, `Home.tsx` | 0.5 d |
| Field test on 2 phones in sun, with gloves, with Hindi | — | 1 d |

### Phase 3 — Tidy Office mode — about 6–8 days

- Role-filtered menu; drivers cannot reach Office mode at all (`nav` filter in `App.tsx`).
- Remove the revision pill; plain-language error messages in office toasts; merge header buttons (section 5.3).
- Add a "Check cylinder" Basic job for quality: scan → **Good** / **Hold** (uses `cylinder.inspect` with today's dates and certificate pre-filled; notes from picture choice). Third-party-owned cylinders stay office-only.
- Add "Filled" Basic job for helpers (`batch.create`; operator = signed-in user; source picked from last-used lot chips).
- These touch existing office screens, so **some tests will need updated text** (`tests/forms-app.test.tsx`, `forms-actions.test.tsx`, `forms-render.test.tsx` look buttons up by name, e.g. "Add customer", "Suppliers & purchases").

### Phase 4 — Optional server work (only after decisions)

| Idea | Server change | Risk |
|---|---|---|
| New `helper` role (godown worker who cannot create orders or edit customers) | `shared/types.ts` `Role`, `ROLES`; `server/domain.ts` `access`; `server/http-app.ts` scoping; user forms; seed; many auth tests | Medium. Every permission test must be extended. |
| Simpler sign-in: 4-digit PIN on a registered phone, or scan a staff QR badge | New endpoints in `server/auth.ts`, device registration, throttling, revocation | **High.** Must not weaken login throttling, session revocation or CSRF. Needs a security review. |
| Proof of delivery photo or finger signature instead of typed name | New field, storage (Supabase storage), size limits, privacy | Medium; storage and privacy rules |
| Real server "undo last action" (e.g. `order.undeliver` within 10 minutes) | New commands with their own audit entries | Medium; must add, never delete, audit rows |
| Customer / ward staff sign-in ("I received / please collect") | New role and scoped data | High; outside users |
| Make "receiving notes" optional for scan-based returns | `server/domain.ts` schema | Low |
| Offline cold start (service worker caching the app shell) | No server change, but a new service worker; CSP already allows `worker-src 'self'` | Medium; cache bugs can show old code |

---

## 7. Risks and how we handle them

### 7.1 Security must not get weaker

- **Auth and sessions:** Basic mode uses the same `login()`, cookie and 12-hour session. No new login path in Phases 1–3.
- **CSRF:** all writes go through `request()` in `src/api.ts`, which adds `X-CSRF-Token`. Basic mode must **only** call `act()` — never `fetch` directly. Add a lint rule or test that `src/basic/` does not call `fetch`.
- **Idempotency:** `act()` creates a retry key per command. The 5-second wait happens **before** `act()` is called, so a retry still reuses the same key. Do not create a new key on each retry.
- **Audit log:** unchanged. Undo-before-send means nothing is written, which is correct (nothing happened). Basic mode must never "fake" a reversal on the client.
- **Permissions:** the server stays the judge (`access` map). Hiding a button is not security. Tests in `tests/api.test.ts`, `hardening.test.ts`, `pg-security.test.ts` must stay green unchanged.
- **The `pagehide` flush** must use the same `act()` path. If it cannot finish, the delivery is put in the device queue (for deliveries) or the user sees "Not saved" next time (for others). Never silently drop.
- **CSP:** no CDN, no inline scripts, no `eval`. Anime.js and fonts are bundled. Voice clips are same-site files. Keep `vercel.json` unchanged.
- **Data shown on a shared godown phone:** Basic mode shows less data than today, which is a privacy gain. Customer names still show; that is needed.

### 7.2 Things that could go wrong for users

| Risk | Mitigation |
|---|---|
| Phone has no Hindi voice | Check `getVoices()`; fall back to recorded clips; pictures still work silently |
| Camera blocked or broken | Big "Allow camera" picture guide; ⌨ manual code entry behind a small icon; Bluetooth scanners still work |
| Same cylinder scanned twice | 2-second duplicate guard + set of IDs (as today) |
| Driver walks away during 5-second undo | `pagehide` sends at once; deliveries fall back to device queue |
| Many customers in one "Came back" | One command per group, each shown green/red; failed groups stay on screen to retry |
| 409 conflicts (one shared revision for the whole company, see Findings M3) | Delta responses already reduce this. Basic mode auto-reloads with `bootstrap()` and re-checks scans, then asks the user to tap Done again |
| Bright sunlight | High-contrast theme; no pale colours; tested outside in Phase 2 |
| Motion sickness / slow phones | Reduced-motion branch; animations under 500 ms; only `transform`/`opacity`/SVG stroke |
| Hindi translations wrong or too formal | Native-speaker review with real drivers; use everyday words ("खाली", "भरा", "गाड़ी") |

### 7.3 Accessibility

- Every tile is a real `<button>` with an `aria-label` in the chosen language.
- Result screens use `role="status"` (tick) or `role="alert"` (cross) so screen readers announce them.
- Focus moves to the result card and then to UNDO.
- Colour is never the only signal (shapes + words + voice).
- Text can grow to 200% without breaking (tiles wrap to one column).
- Reduced motion respected.

### 7.4 Tests that may break

- **Phases 1–2:** none expected. Existing UI tests render `App` as **admin**, who stays in Office mode. Watch `tests/forms-app.test.tsx` and `tests/forms-actions.test.tsx`, which bundle `src/App.tsx` with esbuild: new imports (Anime.js, fonts, CSS) must bundle in that test setup, and browser-only APIs (`speechSynthesis`, `AudioContext`, `navigator.vibrate`, camera) must be guarded because jsdom lacks them.
- `tests/offline-integration.test.ts` and `offline.test.ts`: keep `queueDelivery` behaviour identical.
- **Phase 3:** office text and button changes will break name-based lookups in `forms-*.test.tsx`. Update them in the same change.
- **Phase 4:** any role or auth change touches `api.test.ts`, `hardening.test.ts`, `pg-security.test.ts`, `domain-audit.test.ts`, and needs `npm run bundle:api` (a test fails if the API bundle is stale).

---

## 8. How we will know it worked

Measure on real phones with real workers, before and after:

- Taps per job (target: half or less; see table in section 2).
- Time per job (target: Give 3 cylinders in under 30 seconds after arrival).
- Errors per 20 jobs (wrong customer, missed cylinder, abandoned form).
- "Could you do it alone?" — yes/no for 5 workers who do not read English.
- Office calls from drivers per day.

---

## 9. Decisions the owner must make

1. **Languages.** Hindi + English to start. Which next (Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada…)? Who checks the translations?
2. **Voice.** Phone voices only, or also record a real person saying ~30 phrases in each language (better, ~1 day of recording)?
3. **Undo window.** 5 seconds before sending (recommended), 3 seconds, or none? Or pay later for a real server undo?
4. **Recipient proof.** Keep "tap or type a name" (no server change), or add **photo / finger signature** later (Phase 4)?
5. **Godown helpers.** Keep them on the `operations` role with Basic mode by default (no server change), or create a new limited **`helper` role** (Phase 4)?
6. **Sign-in.** Keep email + password once per 12-hour shift, or build **PIN / staff QR badge** sign-in (Phase 4, needs security review)?
7. **Shared phones.** Does each driver have his own phone, or do several share one? (Affects remembered names/vehicles and sign-out.)
8. **Hospital ward staff.** Is "hand the phone to the nurse" enough, or do hospitals need their own simple screen later?
9. **Slide-to-finish.** Use a slide bar for the final Done (prevents pocket taps) or a plain big button? Recommended: plain button + 5-second undo; slide only if testing shows accidental taps.
10. **Office mode for operations.** Should dispatch clerks start in Office mode and godown helpers in Basic, on the same role? (We need some way to tell them apart: per-phone setting in Phases 1–3, a role in Phase 4.)
