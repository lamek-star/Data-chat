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

Copy the reported `whsec_...` value into `STRIPE_WEBHOOK_SECRET`. Card checkout creates a Stripe-hosted subscription session; the app verifies the returned session with the server before granting Pro access. Cash customers can instead redeem a one-time Pro code generated in the administrator portal.

Demo: `demo@datachat.app` / `demo123`

Local administrator: `admin@datachat.app` / `admin123`

The administrator console manages account metadata, plans, status, external links, and one-time access codes. It intentionally has no interface for users' messages, contacts, financial records, transaction keys, or encrypted backup contents. Replace the local demonstration credentials and browser storage with server-side authentication, role enforcement, audit logs, and a production database before deployment.

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
