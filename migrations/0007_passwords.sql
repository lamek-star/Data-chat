-- Password sign-in for members (the emailed code stays for sign-up,
-- recovery and accounts without a password). The app stretches the password
-- on the device (PBKDF2-SHA256, 310,000 rounds) and sends only the result;
-- the server stores an HMAC of it with a per-account salt and a secret
-- pepper (shared/password.js). The password itself never reaches the server.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_updated_at INTEGER;
