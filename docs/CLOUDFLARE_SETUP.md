# Moving DataChat to Cloudflare (step 1: database and email sign-in)

This replaces Supabase sign-in with email codes sent from your own domain,
and stores accounts in Cloudflare D1. Data, files and live chat move in later
steps. Until you switch the app over, the new sign-in runs alongside
Supabase and nothing changes for current users.

## What you need

- The domain already on Cloudflare (yours is).
- The **Workers Paid** plan ($5/month). Email Service sends to arbitrary
  addresses only on Paid. It is in **beta**: the API may change.
- Node.js and this repo; log in once with `npx wrangler login`.

## 1. Create the database

```bash
npx wrangler d1 create datachat
```

Copy the `database_id` it prints, then add this to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "datachat"
database_id = "<the id it printed>"
migrations_dir = "migrations"
```

Create the tables:

```bash
npx wrangler d1 migrations apply datachat --remote
```

## 2. Turn on email sending for your domain

```bash
npx wrangler email sending enable datachat.harmongt.uk
```

Add the DNS records it asks for (SPF/DKIM), if Cloudflare does not add them
automatically; without them mail lands in spam. Then add to `wrangler.toml`:

```toml
[[send_email]]
name = "EMAIL"
```

and under `[vars]`:

```toml
AUTH_EMAIL_FROM = "DataChat <no-reply@datachat.harmongt.uk>"
```

## 3. Set the sign-in secret

A random value of at least 32 characters. Keep it secret; changing it
invalidates codes that are waiting to be used (not sessions).

```bash
npx wrangler secret put AUTH_SECRET
```

## 4. Deploy and check

```bash
npm run deploy:cloudflare
```

```bash
curl -s -X POST https://datachat.harmongt.uk/api/auth/email/start -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\"}"
```

You should get `{"sent":true}` and an email with an 8-digit code.

## The endpoints

| Method and path | Body | Result |
|---|---|---|
| `POST /api/auth/email/start` | `{ "email" }` | Emails a code (10 minutes, 5 tries). |
| `POST /api/auth/email/verify` | `{ "email", "code", "profile"?, "client"? }` | Opens a 30-day session. Creates the account on first sign-in from `profile` (`name`, `username`, `phone`, `country`; plan/role/status are ignored). Browsers get an HttpOnly cookie; `"client": "native"` also returns the token for the Android/iOS app. |
| `GET /api/auth/session` | – | The signed-in account, or 401. |
| `POST /api/auth/logout` | `{}` | Ends the session. |

Security details: codes and session tokens are stored only as hashes; codes
are single-use; requests are rate-limited per email and per IP; POSTs must be
JSON (blocks cross-site form posts); suspended accounts are signed out and
cannot sign in. Tests: `tests/unit/auth.test.js` (run `npm test`).

## Local development

`wrangler dev` runs the Worker with a local D1. Put this in `.dev.vars`
(git-ignored) so codes are printed in the terminal instead of emailed:

```
AUTH_SECRET=local-development-secret-at-least-32-chars
DEV_LOG_EMAIL_CODES=1
```

Apply migrations locally first: `npx wrangler d1 migrations apply datachat --local`.

## Next steps

2. Switch the app's sign-in screen to these endpoints and protect the admin
   portal with Cloudflare Access.
3. Move profiles, messages, records and Pro codes to D1 (every permission
   check in Worker code, ported from the 63 database tests).
4. Files to R2; live chat to Durable Objects.
5. Copy existing users and data from Supabase, run both for a few days,
   then turn Supabase off.
