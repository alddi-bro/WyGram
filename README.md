# WyGram — real multi-user starter

This is a starter project for a standalone WyGram messaging service using:
- Expo + React Native: one app codebase for Android and web.
- Supabase Auth: accounts and login.
- Supabase Postgres: shared database.
- Supabase Realtime: live messages.
- Row Level Security (RLS): restricts private conversations to members.

## Important
This is an MVP starter, not a finished production messenger. It currently implements email/password auth, username claiming, direct chats, basic groups/channels, and live text messages. Stars/gifts/collectible usernames have schema foundations only; there is no real payment or finished gift transfer flow. Before public launch, add email verification UX, password reset, blocking/reporting, moderation, rate limits, file upload validation, notifications, tests, and a privacy policy. Do not put a Supabase `service_role` key in the client app.

## Step 1 — create the shared database
1. Open https://supabase.com and create a project.
2. In the project, open **SQL Editor**.
3. Open `supabase/schema.sql` from this project, copy all SQL, paste it in the editor and run it.
4. In Supabase **Project Settings → API**, copy the Project URL and the publishable/anon client key. Never use the `service_role` secret in the app.

## Step 2 — configure the app
1. Install Node.js LTS on your computer.
2. Extract this project ZIP into a folder.
3. Copy `.env.example` to `.env`.
4. Put your values in `.env`:
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_CLIENT_KEY
5. In the project folder, run:
   npm install
   npx expo start
6. For the web version run `npx expo start --web`.
7. For Android, install Expo Go on your phone, scan the QR shown by Expo while phone and computer are on the same network, and test the app.

## Step 3 — verify two-user messaging
1. Register a test account with one email.
2. Register a second test account in a separate browser/profile/device.
3. Note each account's username.
4. From one account, enter the other user's username in **Найти пользователя** and open the chat.
5. Send messages in both directions. The messages should appear through Supabase Realtime.

## Step 4 — deploy the website
The web app can be hosted on a static web host after building it. Set the same two `EXPO_PUBLIC_...` variables in the host's build settings, then build with:
   npx expo export --platform web
Upload the generated `dist` folder to your chosen web host. A custom domain is optional.

## Step 5 — make an installable Android APK
1. Create an Expo account at https://expo.dev.
2. Install EAS CLI: `npm install --global eas-cli`
3. Sign in: `eas login`
4. Configure build: `eas build:configure`
5. For an installable test build, configure an APK profile in `eas.json` with `"android": {"buildType": "apk"}` under a build profile, then run:
   `eas build --platform android --profile preview`
6. EAS provides a build page/link when the build finishes. For Google Play publication, you will need a Play Console developer account.

## Current limitations / next implementation milestones
- The direct-message and basic group/channel flows are MVP-level.
- Group invitations, channel subscriptions, roles and moderation still need full UI.
- Stars are not purchasable, transferable or backed by a server-side ledger yet.
- Collectible username table is a foundation only; implement ownership changes via secure database RPCs, not client-side updates.
- Add push notifications, media uploads, message edits/deletes, search, user blocking/reporting, spam controls, backups, and a tested privacy/security policy before inviting the public.
