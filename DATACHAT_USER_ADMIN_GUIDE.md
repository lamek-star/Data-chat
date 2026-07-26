# DataChat user and administrator guide

DataChat is a private contact, messaging, transaction-record, community, market-rate, and financial-reporting application. The user app and administrator portal share one cloud service while keeping private messages, contacts, transaction security keys, records, and backup contents outside the administrator interface.

## Internet addresses

- User app: `https://datachat.harmongt.uk/`
- Administrator portal: `https://datachat.harmongt.uk/admin.html`
- Product guide: `https://datachat.harmongt.uk/guide.html`
- Android installer: `https://datachat.harmongt.uk/downloads/DataChat-1.1.1.apk`
- iOS Xcode project: `https://datachat.harmongt.uk/downloads/DataChat-iOS-Xcode.zip`

The `www.datachat.harmongt.uk` versions of these addresses are also configured.

The iOS project must be opened on macOS with Xcode and signed with an Apple
Developer account before it can become an installable `.ipa` or App Store
submission.

## Registration and sign-in

| Label or button | Purpose |
|---|---|
| **Create account** | Registers a new user with full name, phone number, email, username, and password. |
| **Show password** | Temporarily displays the password so the user can check what was typed. |
| **Email confirmation code** | Accepts the one-time code sent by email during initial registration. OTP is not required for normal later sign-ins. |
| **Resend code** | Requests a new confirmation email after the countdown finishes. |
| **Sign in** | Opens an existing account with username/email and password. |
| **User agreement** | Explains account metadata visible to administrators and the private information that administrators cannot read. |
| **Sign out** | Ends the current session. Otherwise, the session remains signed in on that device. |

## Main user navigation

| Page | Purpose |
|---|---|
| **Home / Messages** | View contacts and exchange live messages, transaction cards, and Pro voice messages. |
| **Community Portal** | Discover approved communities, request membership, and manage contact groups. |
| **Market Rates (Pro)** | View market information and publish direct-contact offers. |
| **Records** | Create, search, edit, share, import, export, and securely complete transaction records. |
| **Reports (Pro)** | View financial summaries and reporting tools. |
| **Settings** | Manage profile photo, device security, backup choices, subscription, privacy, and sign-out. |

## Contacts and QR tools

| Label or button | Purpose |
|---|---|
| **My contact QR** | Shows the signed-in user’s shareable contact QR and text record. |
| **Add contact** | Opens the contact scanner and contact-code entry tools. Only contacts explicitly added by the user appear in the list. |
| **Scan with camera** | In the Android/iOS app, opens the native camera and scans a DataChat QR code. Camera permission must be allowed. |
| **Choose QR image** | Reads a QR code from a saved image when camera scanning is unavailable. |
| **Contact text** | Allows a copied DataChat contact record to be pasted and imported. |
| **Copy text** | Copies the complete contact record. |
| **Download .txt** | Saves the complete contact record as a text file. |
| **Profile picture** | Lets the user choose a JPEG, PNG, or WebP image for their account. |

## Messaging

| Label or button | Purpose |
|---|---|
| **Contact name** | Opens that contact’s conversation. |
| **Message field** | Types a message. Text uses a readable foreground color in both light and dark surfaces. |
| **Send** | Writes the message to Supabase and immediately adds it to the conversation. Realtime delivers it to the other online user. |
| **Attach / transaction** | Shares a transaction card, including its QR representation, with a contact. |
| **Add transaction** | Imports a received transaction into the user’s records. Existing transaction IDs are rejected with an “already exists” notice, and private security keys are not duplicated into chat. |
| **Voice message (Pro)** | Records and sends an audio message for Pro members. The browser/app asks for microphone permission. |
| **Report** | Reports inappropriate chat activity for administrator review metadata without exposing unrelated private account data. |
| **Block** | Prevents further contact messages from that user on the account. |

Messages are stored in the `direct_messages` cloud table and subscribed to through Supabase Realtime. Internet or Wi-Fi access is required for messages to reach another phone.

## Transactions and secure cash handoff

| Label or button | Purpose |
|---|---|
| **New transaction** | Creates a financial transaction record. |
| **Receiver** | Names the intended receiver and is encoded into the handoff data for identity matching. |
| **Currency** | Selects supported currencies, including AED and the other listed currencies. |
| **Generate handoff** | Creates a unique six-digit transaction security key and a QR/text handoff package. |
| **Share** | Shares the transaction details and QR code with a selected DataChat contact. |
| **Copy / Download** | Copies or downloads the handoff text for another delivery method. |
| **Scan handoff QR** | Reads a sender’s transaction QR through the native camera or an image. |
| **Confirm / Release cash** | Verifies transaction ID, receiver name, and the private security key before marking the cash handoff complete. |
| **Import / Export** | Moves transaction records through the supported file format. Duplicate transaction IDs are skipped. |

Treat the six-digit handoff key like cash: send it only to the intended receiver and do not post it in a public group.

## Communities

| Label or button | Purpose |
|---|---|
| **Create contact group** | Creates a group from the user’s own contacts. |
| **Invite contact** | Invites an added contact when the group owner has invite permission. |
| **Discover / Request to join** | Sends a membership request to an approved community. |
| **Approve / Reject** | Lets the community owner decide a pending membership request. |
| **Parent community** | Places a group under the administrator-created location or hierarchy. |

Only the administrator can create root communities. Root communities define location, hierarchy, purpose, and permissions. Ordinary users can create contact groups beneath the permitted structure.

## Market rates, offers, and reports

- Market Rates and financial Reports are Pro features.
- Rate filters let users choose market/country and asset type such as currencies, cryptocurrencies, gold, and silver.
- A Pro member can publish their own rate with name, contact information, currency/asset, and rate.
- **Direct message** starts an order conversation with the offer owner.
- Market values are informational and should be confirmed before a financial decision.

## Pro subscription and payment

| Label or button | Purpose |
|---|---|
| **Upgrade to Pro / Pay by card** | Creates a Stripe Checkout session for the signed-in account. |
| **Admin cash code** | Redeems a strong, one-use code purchased through the administrator. It is used only for Pro activation, not ordinary registration or login. |
| **Apply code** | Validates the code in the cloud, prevents reuse, upgrades the account, and records the redeemer’s name for the administrator. |
| **Backup storage (Pro)** | Adds managed backup choices for Pro users. |

The currently configured Stripe account and payment link are in **test mode**. Replace the test secret, test price/payment link, and webhook secret with live Stripe values before accepting real money.

## Backup and recovery

- **Phone storage** downloads a user-controlled backup file.
- Configured cloud/drive choices upload through the corresponding connected provider.
- Pro managed backup stores an encrypted backup package; the backup password must be kept securely.
- The administrator can manage recovery-package metadata but should not be able to read private content without the user’s backup password.

## Biometric access

In **Settings → Device security**, enable **Biometric access**. The installed app authenticates with fingerprint, face recognition, or the phone’s device PIN. When the app returns from the background, the active session is locked until the device owner authenticates. This protects the local session; username and password remain the account recovery method.

## Administrator portal

The administrator username is `datachat-harmony`. On the first local administrator setup, choose a unique password of at least 12 characters. Do not share it or store it inside the APK.

| Administrator label or button | Purpose |
|---|---|
| **Administration** | Main overview of accounts, plans, access, codes, communities, and configuration. |
| **Accounts** | Displays allowed account metadata such as name, email, plan, status, and registration information. |
| **Account status / plan controls** | Activates, suspends, or changes supported account settings. |
| **Generate Pro cash code** | Creates a strong, one-use cloud code and copies it for delivery after cash payment. |
| **Access codes** | Shows unused/used status. A used code displays the username/account that redeemed it. |
| **Configuration** | Stores shared repository, payment, support, or service configuration intended for the app. Secrets must remain in Cloudflare/Supabase secret storage, never this form. |
| **Root communities** | Creates official location/hierarchy communities and defines their purpose and permissions. |
| **Recovery backups** | Manages allowed encrypted recovery-package metadata and downloads/deletes packages when authorized. |
| **Guide** | Opens this document. |
| **Sign out** | Ends the administrator session in the current browser. |

The administrator portal must not display message bodies, private contacts, financial records, transaction security keys, or decrypted backup contents.

## Service configuration

- Cloudflare Worker serves the website, administrator portal, guide, APK, health endpoint, and Stripe API.
- Supabase provides authentication, user profiles, direct-message persistence and Realtime delivery, and one-use Pro-code redemption.
- Stripe creates card checkout sessions. A verified webhook should be used for automatic production plan activation.
- Android uses Capacitor with native barcode-scanner, biometric, and app-lifecycle plugins.

## Troubleshooting

1. **OTP missing:** check Spam/Promotions, confirm the address, wait for the resend timer, and verify Supabase SMTP sender/DNS configuration.
2. **QR camera does not open:** use the installed APK, allow Camera permission, and ensure Google Play Services is current. Use **Choose QR image** as a fallback.
3. **Messages do not arrive:** confirm both users added one another, both phones have internet, neither account is blocked, and the Supabase `direct_messages` Realtime publication is enabled.
4. **Admin code fails:** generate a new cloud code from the internet administrator portal; local/offline codes cannot be redeemed on another phone, and each code works once.
5. **Stripe opens test checkout:** this is expected until live Stripe credentials are configured.
6. **Biometric option unavailable:** configure fingerprint/face or device PIN in Android/iOS settings, then reopen DataChat.
