# One private cloud for DataChat and future apps

Use one Supabase project as the shared backend. It provides PostgreSQL, authentication, private file storage, backups, and a stable HTTPS project URL. Every app uses the same project URL and publishable/anon key; `app_id` separates application data while `user_id` isolates each account.

## Create it

1. Create a Supabase project and enable email authentication. Use a strong database password and MFA on the owner account.
2. Open SQL Editor and run `supabase/schema.sql`. It creates a generic multi-app data table, row-level security policies, and a private backup bucket.
3. Copy `.env.example` to `.env`, then insert the Project URL and publishable/anon key from Project Settings > API.
4. For each future app, reuse the URL and anon key but assign a different `VITE_DATACHAT_APP_ID` such as `inventory` or `family-finance`.
5. Replace the current local demo login with Supabase Auth before production. After login, pass the user's access token to `cloudRequest`; never use the service-role key in a browser or mobile build.

## Data model

Store each record as `{app_id, user_id, entity_type, entity_id, payload}`. Example entity types are `transaction`, `contact`, and `message`. Put backups/files at `private-backups/<authenticated-user-id>/<filename>`. The included policies allow users to access only their own rows and folder.

## Production requirements

- Add a small server/Edge Function for admin-only operations, payments, webhooks, rate-provider secrets, and access-code redemption.
- Keep the service-role key only in server secrets. Rotate it immediately if it is ever included in the app bundle or Git.
- Configure automated database backups, a custom domain, CAPTCHA/rate limiting, email verification, MFA for admins, audit logs, and restore testing.
- Publish a privacy policy, retention/deletion process, and obtain legal/security review before handling real financial or identity data.

The adapter in `src/cloud/supabaseClient.js` is intentionally not activated until credentials and real cloud authentication exist. This prevents the prototype from pretending local data is safely synchronized.
