# Put Cylvero online (Vercel + Supabase)

This guide gives you a web link your friends can open. It takes about **20 minutes**. You need:

- A **Supabase** account (free): <https://supabase.com>
- A **Vercel** account: <https://vercel.com>
- The code on GitHub: `Savage-Shaurya/Oxygen-Cylinder-Management`

**How it fits together:** Vercel runs the website and the server. Supabase stores the data. Only the server talks to Supabase, using a secret link that lives in Vercel's settings. The website never sees it.

> Everything in the online copy is **fake demo data**. The six demo accounts and their password (`OxygenDemo!2026`) are public in `Rundown.md`, so anyone with the link can sign in. Only share the link with people you trust, and never type real customer information into it.

---

## Part A — Create the database (Supabase)

1. Go to <https://supabase.com> and sign in.
2. Click **New project**.
3. Fill in:
   - **Name:** `cylvero-demo`
   - **Database password:** click **Generate a password**, then **copy it and save it** somewhere safe (a password manager or a note only you can see). You need it in step 8.
   - **Region:** **South Asia (Mumbai)**. This must be Mumbai: the Vercel server is also set to Mumbai, and keeping them together makes the app fast.
4. Click **Create new project** and wait until it says the project is ready (1–2 minutes).
5. At the top of the project page, click **Connect**.
6. Find the **Transaction pooler** connection (it uses port **6543**). Choose the **URI** format.
7. Click **copy**. It looks like:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`
8. Paste it into a private note. Replace `[YOUR-PASSWORD]` (including the square brackets) with the database password from step 3.
   - ✅ The link now has **no** square brackets.
   - ⚠️ **This link is a secret.** Anyone who has it can read and change the database. Never paste it into GitHub, chat groups or the Rundown file.
9. **(Recommended, adds certificate checking):** go to **Project Settings → Database → SSL Configuration** and click **Download certificate**. Open the downloaded file with a text editor (TextEdit / Notepad) and keep it open. You'll copy its whole contents in Part B.

You do **not** need to create any tables or security rules. The app creates its own private tables and locks them down automatically the first time it starts.

---

## Part B — Put the app online (Vercel)

1. Go to <https://vercel.com> and sign in.
2. Click **Add New… → Project**.
3. Under **Import Git Repository**, find **Oxygen-Cylinder-Management** and click **Import**.
   - **Don't see it?** Vercel can only show repositories your GitHub account owns or is allowed to connect. Easiest fix: open <https://github.com/Savage-Shaurya/Oxygen-Cylinder-Management>, click **Fork** (top right) → **Create fork**. Then come back to Vercel, click **Adjust GitHub App Permissions** if needed, and import **your fork**.
4. On the **Configure Project** screen:
   - **Framework Preset:** leave as **Vite** (it is set by the project file).
   - **Root Directory:** leave as `./`.
   - **Build and Output Settings:** leave everything as it is.
5. Open **Environment Variables** and add:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the link from Part A, step 8 |
   | `DATABASE_CA_CERT` | *(recommended)* the **whole** contents of the certificate file from Part A, step 9, including the `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` lines |

6. Click **Deploy** and wait (2–3 minutes).
   - ✅ You see **Congratulations** and a preview of the site.
7. Click **Continue to Dashboard**. Your link is under **Domains**, like `https://oxygen-cylinder-management.vercel.app`.

---

## Part C — Check it works

1. Open your link followed by `/api/health`, for example
   `https://oxygen-cylinder-management.vercel.app/api/health`
   - ✅ It shows `{"ok":true,"mode":"demo"}`.
   - The very first open can take a few seconds while the app sets up the database.
2. Open your link (without `/api/health`). Sign in as `admin@batra.demo` with password `OxygenDemo!2026`.
   - ✅ You see the **Overview** page with demo numbers.
3. Click **Cylinders**. ✅ You see about 84 demo cylinders.

If step 1 shows `Service temporarily unavailable`, see **Problems** below.

---

## Part D — Share it with friends

1. Open `Rundown.md` (in the GitHub repository, click the file, then the pencil ✏️ to edit).
2. Replace `https://YOUR-APP-LINK` with your real link. Click **Commit changes**.
3. Send your friends:
   - your link, and
   - the `Rundown.md` file (or its GitHub link).

Tell them to each use their **own code** instead of `T2` (the Rundown explains this). Several people can test at the same time. Part 12 uses shared demo cylinders; if testers run out, reset the demo data (see below).

---

## Everyday care

- **Supabase pauses free projects after 7 days without use.** If the app stops working after a quiet week, open Supabase → your project → click **Restore project**, wait a minute, then reload the app.
- **Start the demo data fresh** (deletes all test records and puts back the original demo data):
  1. Supabase → **SQL Editor** → **New query**.
  2. Paste `DROP SCHEMA cylvero CASCADE;` and click **Run**.
  3. Open your app link again. It rebuilds the demo data on the first visit.
- **Updating the app:** anything pushed to the `main` branch on GitHub is deployed by Vercel automatically.
- **Never** change the database password without also updating `DATABASE_URL` in Vercel (**Settings → Environment Variables**, then **Deployments → ⋯ → Redeploy**).

---

## Problems

| What you see | What to do |
|---|---|
| `/api/health` says `Service temporarily unavailable` | In Vercel open **Logs**. `DATABASE_URL is not configured` → add it (Part B step 5) and redeploy. `password authentication failed` → the password inside `DATABASE_URL` is wrong. `self-signed certificate` or `unable to verify` → the `DATABASE_CA_CERT` value is incomplete; paste the whole file again or remove that variable. |
| The app is very slow | Supabase and Vercel are in different places. The Supabase project must be in **Mumbai** (Part A step 3). |
| Everything stopped after a quiet week | Supabase paused the project. **Restore** it (see Everyday care). |
| Someone is locked out ("Too many login attempts") | Wait 15 minutes. It protects against password guessing. |

---

## What keeps the data safe

- The Supabase link (`DATABASE_URL`) exists only in Vercel's encrypted settings. The browser never receives it, and the code on GitHub does not contain it.
- The app does **not** use Supabase's public API keys at all. Its tables live in a private area (`cylvero`) that Supabase's public API does not expose. Row-level security is switched on with no access rules, and all rights are removed from Supabase's public roles (`anon`, `authenticated`). Even a leaked public API key cannot read anything.
- The audit log cannot be edited or deleted, even by the app itself.
- Passwords are stored only as scrambled hashes, and login tokens only as hashes.
- Login cookies are `HttpOnly`, `Secure` and `SameSite=Strict`. Every change needs a CSRF token. Repeated wrong passwords lock the account for 15 minutes, and the lockout is shared across all server copies.
- The site sends strict browser security headers (Content-Security-Policy, HSTS, no framing).

These checks run automatically in `tests/pg-security.test.ts` against a real Postgres database.
