# Platform spike — 11 October 2026

| Question | Result | Evidence |
|---|---|---|
| Express runs on Workers via `cloudflare:node` httpServerHandler | yes | `/health` returned `{"ok":true}` (wrangler 4.149.0, express 5, `nodejs_compat`) |
| scrypt (N=16384, 64-byte key) median time per request in `wrangler dev` | 26 ms | five curl timings: 49.7, 30.5, 25.7, 26.0, 25.6 ms (first is warm-up; median 25.96 ms) |
| `pg` through a Hyperdrive binding: BEGIN / SELECT … FOR UPDATE / COMMIT | ok | `/pg` returned `{"ok":true,"locked":1}` |
| PGlite: serialized transactions, FOR UPDATE, advisory locks, rollback | ok | `{"v":2,"failed":"boom"}` |

## Notes
- First `wrangler dev` attempt failed config validation, not the platform: `You must provide a password - e.g. 'user:password@database.example.com:port/databasename'` (path `workers[0].hyperdrives.HYPERDRIVE`). Wrangler requires a password in `localConnectionString`; the local cluster uses trust auth, so a dummy password (`app_owner:spike@127.0.0.1:55432/...`) works. Real config must include one.
- Timings are local `wrangler dev` (workerd on this Mac) measured client-side with curl; production Workers CPU limits were not measured.
- Workers `Date.now()` does not advance during a request, so timing is client-side.

## Decisions for Plan 1D
- Adapter: Express via httpServerHandler (works under nodejs_compat; keeps existing routes).
- Password hashing: keep scrypt (about 26 ms per hash locally; revisit only if production CPU limits bite).
