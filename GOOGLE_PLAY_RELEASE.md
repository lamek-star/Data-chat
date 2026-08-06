# DataChat Google Play release

## 1. Create the Play Console app

1. Open https://play.google.com/console and pay Google's developer registration fee.
2. Choose **Create app**.
3. Set the name to **DataChat**, default language, **App**, and **Free**.
4. Use the Android application ID `com.lamekstar.datachat`. It cannot be changed after publishing.

## 2. Create a private upload key

Never publish with the shared Android debug certificate. Create one upload key and keep both the `.jks` file and passwords in a password manager and an offline backup.

```powershell
keytool -genkeypair -v -keystore datachat-upload.jks -alias datachat-upload -keyalg RSA -keysize 2048 -validity 10000
```

Store the signing values outside Git, then configure the Android release signing environment described in `android/app/build.gradle`. Build with:

```powershell
npm run mobile:sync
cd android
.\gradlew.bat bundleRelease
```

Upload the generated `app-release.aab`; APK files are for direct device testing, not a new Play listing.

## 3. Complete the required Play forms

- App access: provide a working reviewer account if login is required.
- Ads: answer based on the production app behavior.
- Content rating questionnaire.
- Target audience and content.
- Data safety: disclose account/profile, contacts, messages, transaction records, microphone audio, camera/QR use, notifications, and diagnostic data accurately.
- Privacy policy: publish a public HTTPS privacy-policy page on `datachat.harmongt.uk`.
- Account deletion: provide an in-app and public web deletion path if accounts can be created.

## 4. Store listing assets

- App icon: 512×512 PNG.
- Feature graphic: 1024×500 PNG.
- At least two current phone screenshots.
- Short description up to 80 characters and full description up to 4,000 characters.
- Support email: `Admin.D.C@datachat.harmongt.uk`.

## 5. Test before production

1. Upload the signed AAB to **Internal testing**.
2. Add tester Gmail addresses and install using the Play testing link.
3. Test registration, QR contacts on two physical phones, messages/read receipts, microphone, voice messages, incoming calls, transaction cards, biometrics, notification permission, and community approval.
4. Promote to Closed testing and satisfy any testing requirement shown by Play Console.
5. Create the Production release only after the pre-launch report has no blocking crash or security issue.

## Closed-app push notification requirement

Local notifications cannot appear after Android has completely stopped DataChat. Production closed-app alerts require:

1. Create a Firebase project and Android app with package `com.lamekstar.datachat`.
2. Download `google-services.json` into `android/app/` (never invent this file).
3. Enable Firebase Cloud Messaging and install `@capacitor/push-notifications`.
4. Store each device token in a private Supabase `push_tokens` table protected by RLS.
5. Trigger a Supabase Edge Function after a `direct_messages` insert; the function sends FCM HTTP v1 using a Firebase service account stored only as an Edge Function secret.
6. For iOS, upload an APNs authentication key to Firebase and enable Push Notifications in the Xcode target.

Do not store a Firebase service-account private key in the APK, web bundle, GitHub, or a public Supabase table.
