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

This starts Vite and the Cloudflare Worker locally (`wrangler dev`) with a local D1 database. The first time, create the local tables and a `.dev.vars` file (git-ignored) so sign-in codes are printed in the terminal instead of emailed:

```bash
npm run db:migrate:local
```

```
AUTH_SECRET=local-development-secret-at-least-32-chars-long
DEV_LOG_EMAIL_CODES=1
```

For local webhook testing, install the Stripe CLI and forward events:

```bash
stripe listen --forward-to localhost:4242/api/stripe/webhook
```

Card checkout creates a Stripe-hosted session for the signed-in member. Pro is granted only by the server: the Stripe webhook (and the post-checkout status check) sets the member's plan in D1. Cash customers can instead redeem a one-time Pro code generated in the administrator portal.

## How it runs (Cloudflare only)

Everything runs on your Cloudflare account; there is no Supabase or other backend.

| Piece | Cloudflare service | Code |
|---|---|---|
| Web app and API | Worker (`worker/index.js`) | `shared/api.js` |
| Accounts, records, messages, Pro codes | D1 (`migrations/`) | `shared/auth.js`, `shared/data.js` |
| Sign-in codes by email | Email Service (`send_email` binding) | `shared/auth.js` |
| Profile photos (optional) | R2 (`FILES` binding); without it small photos are stored in D1 | `shared/data.js` |

Sign-in is passwordless: members enter their email and the 8-digit code they receive. The browser keeps the session in an HttpOnly cookie; the Android/iOS app keeps a token. Plan, role and status are stored in D1 and changed only by server code; every API call checks the signed-in member, so one member can never read or change another member's data. Chat messages arrive by checking for new ones every few seconds while the app is open.

Setup, with the exact commands: [docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md).

| Setting | Where | Purpose |
|---|---|---|
| `DB` | `wrangler.toml` `[[d1_databases]]` | The database |
| `EMAIL`, `AUTH_EMAIL_FROM` | `wrangler.toml` `[[send_email]]` and `[vars]` | Sign-in emails |
| `AUTH_SECRET` | `wrangler secret put` (**secret**) | Protects sign-in codes |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `wrangler secret put` (**secret**) | Checkout and webhooks |
| `STRIPE_PRO_PRICE_ID`, `APP_URL` | `wrangler.toml` `[vars]` | Checkout price and redirect URL |

Never give a secret a `VITE_` prefix; anything prefixed `VITE_` is shipped to every browser.

## Administration

The admin dashboard has its own address: **https://admin.datachat.harmongt.uk**
(the old `/admin` page on the app redirects there). Make an account an
administrator once, after it has signed in to the app at least once:

```bash
npx wrangler d1 execute datachat --remote --command "UPDATE users SET role='admin' WHERE email='you@example.com'"
```

How it is protected (`shared/adminHost.js`, tests in `tests/unit/admin-host.test.js`):

- Admin routes exist only on the admin host; the app host answers 404 for `/api/admin/*`.
- Sign-in codes are emailed only to active administrators (everyone gets the same
  answer), and signing in there never creates an account.
- Separate admin sessions: a host-only `__Host-dc_admin` cookie (HttpOnly, Secure,
  SameSite=Strict), 30 minutes idle and 12 hours at most. Member sessions can't open
  the dashboard and the admin cookie means nothing to the app.
- Writes must be JSON from the dashboard's own origin; strict CSP, `frame-ancestors
  'none'`, `no-store`, `noindex`. No service worker on that host.
- Every sign-in and change is in the activity log; numbers are counts only, never
  messages, contacts, records or keys.

### Optional second lock: Cloudflare Access

Put Cloudflare Access (Zero Trust, free for up to 50 users) in front of the admin host
so Cloudflare asks for a second sign-in before the page even loads:

1. Cloudflare dashboard → Zero Trust → Access → Applications → Add → Self-hosted.
2. Domain `admin.datachat.harmongt.uk`; policy: Allow, Emails = your admin email(s).
3. Copy the application's **AUD tag** and your team domain (e.g. `https://yourteam.cloudflareaccess.com`).
4. Add them to `wrangler.toml` `[vars]` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, then deploy.

With both set, the Worker also checks Cloudflare's signed token on every admin request,
so a request that gets around Access is still refused.

## Testing

```bash
npm test            # unit tests: sign-in, member data permissions, Stripe, claim codes, CSV, backups
npm run dev:offline # runs the app on browser storage only, without the API
```

CI (`.github/workflows/ci.yml`) runs the unit tests, the build and the runtime dependency audit on every push to `main` and every pull request.

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
