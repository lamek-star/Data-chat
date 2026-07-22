# DataChat professional email OTP setup

1. In Supabase open **Authentication → Sign In / Providers → Email**.
2. Enable **Email OTP** and keep email confirmations enabled.
3. Open **Authentication → Email Templates → Magic Link**. Use `{{ .Token }}` in the message; this makes Supabase send the six-digit code used by DataChat.
4. Open **Project Settings → Authentication → SMTP Settings** and enable custom SMTP.
5. Enter the SMTP credentials from the mail provider for `datachat.harmongt.uk`. Use a sender such as `DataChat <accounts@datachat.harmongt.uk>`.
6. Add `https://datachat.harmongt.uk` under **Authentication → URL Configuration → Redirect URLs**.
7. Run `supabase/production_upgrade.sql` in the Supabase SQL Editor for profile images and community approval tables.

Never place SMTP passwords, Supabase secret/service-role keys, or Stripe secret keys in Vite variables or the APK.
