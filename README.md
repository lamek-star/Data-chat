# DataChat

User app: `http://localhost:5173/`  
Administrator portal: `http://localhost:5173/admin.html`

Rates and financial reports require a Pro account. See `CLOUD_STORAGE_SETUP.md` to connect this project and future apps to one private cloud backend.

Secure financial messaging, international-transfer records, approval workflows and receiver-bound cash handoffs.

## Run locally

```bash
npm install
npm run dev
```

This starts both Vite and the private payment server. Copy `.env.example` to `.env`, then add a Stripe test secret key and the ID of a recurring Pro Price. Never use a `VITE_` prefix for the Stripe secret key.

For local webhook testing, install the Stripe CLI and forward events:

```bash
stripe listen --forward-to localhost:4242/api/stripe/webhook
```

Copy the reported `whsec_...` value into `STRIPE_WEBHOOK_SECRET`. Card checkout creates a Stripe-hosted session for the signed-in account. Pro is granted only by the server: the Stripe webhook (and the post-checkout status check) records it in the `datachat_entitlements` table with the Supabase service-role key. Cash customers can instead redeem a one-time Pro code generated in the administrator portal; the database records Pro when the code is redeemed.

The API server (`shared/api.js`, run locally by `server/index.js` and in production by the Cloudflare Worker) needs these settings in `.env` locally, or as Worker variables/secrets:

| Name | Where | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `.env` / `wrangler.toml` vars (public) | Verify sign-ins |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` / `wrangler secret put` (**secret**) | Grant Pro, resolve usernames at sign-in |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `.env` / `wrangler secret put` (**secret**) | Checkout and webhooks |
| `STRIPE_PRO_PRICE_ID`, `APP_URL` | `.env` / `wrangler.toml` vars | Checkout price and redirect URL |

Never give the service-role key or Stripe secret a `VITE_` prefix; anything prefixed `VITE_` is shipped to every browser.

## Security setup (required)

1. In the Supabase SQL Editor, run in order: `supabase/schema.sql`, `supabase/realtime_chat.sql`, `supabase/production_upgrade.sql`, `supabase/auth_codes_upgrade.sql`, then `supabase/security_hardening.sql`.
2. Make your own account an administrator (replace the email):

   ```sql
   insert into public.datachat_entitlements (user_id, role, source)
   select id, 'admin', 'bootstrap' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set role = 'admin', updated_at = now();
   ```

3. Set the Worker secrets: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, `wrangler secret put STRIPE_SECRET_KEY`, `wrangler secret put STRIPE_WEBHOOK_SECRET`.
4. In the Stripe dashboard, point a webhook for `checkout.session.completed` and `checkout.session.async_payment_succeeded` at `https://<your domain>/api/stripe/webhook`.

Plan, role and account status are read only from `datachat_entitlements`, which users can read but never write. Supabase `user_metadata` is editable by every user and is never trusted for access.

The administrator portal (`/admin.html`) signs in with a normal DataChat account that has the `admin` role; the database re-checks that role on every administrator call. It lists members, changes their plan, suspends or reactivates them, and manages one-time access codes. It intentionally has no interface for users' messages, contacts, financial records, transaction keys, or encrypted backup contents.

A suspended account is signed out by the app at sign-in. Because a modified app could skip that, the database also refuses the account's writes: sending messages, adding or changing records, creating or joining communities, and redeeming codes. Administrators cannot change their own status.

## Moving to Cloudflare

DataChat is moving off Supabase to Cloudflare only: D1 for data, Email Service for sign-in codes from your own domain, R2 for files and Durable Objects for live chat. Step 1 (email-code sign-in on D1) is built and tested but not yet switched on; see [docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md) for the exact commands.

## Testing

```bash
npm test            # unit tests: API, claim codes, CSV, encrypted backups
npm run test:sql    # applies every supabase/*.sql file to a throwaway Postgres (needs Docker) and checks permissions
npm run dev:offline # runs the app on browser storage only, without touching the production Supabase project
```

CI (`.github/workflows/ci.yml`) runs the unit tests, the build, the runtime dependency audit and the database permission suite on every push to `main` and every pull request.

## Account access and backups

New registration requires a single-use administrator code and acceptance of the User Access & Privacy Agreement. Administrators can issue codes for cash payments, online payments, or invitations. Users can create password-encrypted `.dcbackup` files using AES-256-GCM, download them to phone storage, share them through the device share sheet to Drive/Gmail, and restore them after confirmation.

## Android and iOS

The project uses Capacitor with application ID `com.lamekstar.datachat`.

```bash
npm run mobile:sync
npm run android:open
# macOS with Xcode is required for the iOS build
npm run ios:open
```

Before store submission, replace browser-local persistence with an audited backend, add production authentication, supply final app icons/screenshots, configure signing, publish a hosted privacy policy, and complete financial/compliance review for every operating country.

## Network resilience

The production web build caches the application shell for offline access. This preserves access to locally stored records during temporary outages. It is not a VPN and does not claim to bypass ISP or government network controls. A real VPN requires separately operated tunnel infrastructure, native OS entitlements, external security audit, and legal review.

## Cash handoff security

Each transfer receives a cryptographically generated six-digit secret. DataChat binds it to the transaction ID and normalized receiver name in a complete claim code. Cash agents must validate the full text or QR claim, never the six-digit number alone.

## Rates marketplace

The Rates page loads latest published reference exchange rates from Frankfurter's official-provider API. These are comparison references, not guaranteed transaction quotes. Pro members can post their own buy, sell, or exchange offers with contact information, limits, instrument, and terms; interested users can create a direct order inquiry in chat.
