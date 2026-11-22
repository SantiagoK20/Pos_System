# Atecles Grill POS deployment

## Private Windows installer

Build on Windows x64 using the approved existing Firebase and Supabase projects. Put the build settings in `laravel-backend/.env` and the Firebase Admin JSON in `laravel-backend/storage/firebase-credentials.json` or set `FIREBASE_CREDENTIALS` to its build-machine path. The build packages the selected POS settings and the Firebase Admin JSON. Keep the Firebase Admin and Supabase service-role credentials restricted to approved workstation deployments.

```powershell
npm.cmd ci
npm.cmd run dist
```

The one-file artifact for version 1.2.2 is `release-private-1.2.2.local/Atecles Grill POS Setup.exe`. It includes Electron, React, PHP, the Laravel application and the private configuration. The setup program and unpacked build directory both contain extractable production credentials. Transfer the installer through a private channel to trusted operators and install only on managed terminals. Treat a lost copy as a credential exposure.

Electron launches PHP on a dedicated loopback port, supplies an instance token to the renderer, and waits for Laravel health before showing the POS. Laravel receives the private settings from the install directory and creates writable storage, logs and caches in the Windows user profile. The instance token limits access to the local API during the desktop session. Firebase ID tokens and existing Laravel role and approval checks still control user access. No separately hosted Laravel API, tunnel, or user-provided configuration file is used at runtime.

Electron keeps the existing app identity and renderer location for upgrades. Cached menu and sales snapshots, pending actions, and transaction IDs remain in the existing Windows profile. Sign-in requires internet access. An already signed-in operator can continue using supported offline functions. Laravel stores shared POS records in Firebase Realtime Database and sends kitchen orders to the existing Supabase table. The desktop administrator board reads and completes orders via Laravel. Entitled kitchen viewers still use read-only realtime access through Supabase RLS. No client receives the service-role key from Laravel.

This private build validates its desktop configuration against a single local file cache. An enabled administrator TOTP pilot requires a separately coordinated shared cache and causes the private build to stop before packaging. Keep the existing pilot configuration for environments that meet its requirements.

For local browser development, use `npm.cmd run dev`. Vite proxies `/api` to Laravel on port 8001. For staging, use approved test identities to verify administrator and cashier login, administrator approval, menu loading, a test sale and kitchen completion, and replay of the same offline sale ID across a reconnect.

## Kitchen Display prerequisites

The integration uses the existing `public.kitchen_orders` table; it does not create or alter Supabase objects. Confirm that the table has:

- `id` (primary key), `firebase_sale_id` (unique), `order_number`, `items` (JSON/JSONB), `status`, `created_at`, and `updated_at`.
- A status constraint that permits `new`, `preparing`, `ready`, and `completed`.
- Realtime publication enabled for `kitchen_orders`.
- Supabase Third-Party Auth configured for the existing Firebase project. The admin's Firebase ID token is supplied to Supabase; no separate kitchen account or Supabase password login is used.
- RLS policies that validate the Firebase JWT and restrict direct reading to the named administrator and entitled kitchen viewers and direct status updates to the named administrator. Keep insert/delete unavailable to clients. Confirm the policies apply to Realtime as well as PostgREST.

The administrator desktop board uses Laravel for kitchen reads and completion. Laravel adds the Firebase custom claim `role: authenticated` after an existing backend check has verified an administrator or cashier, preserving their other custom claims. Cashier login and the admin Kitchen Live View refresh the Firebase ID token after this claim is set so Supabase receives the updated token, including Firebase's standard `exp` claim.

Laravel uses the service-role key to upsert by `firebase_sale_id` and to read or complete orders for authorized administrators. `GET /api/kitchen/config` sends administrators to the Laravel board. For entitled viewers it returns the Supabase URL and anon key for read-only access using a Firebase ID token. Never expose the service-role key to the renderer or return it from an API.

Failed kitchen syncs remain marked pending in Firebase. The POS retries while it is online and open; operations can also run `php artisan kitchen:sync-pending` from `laravel-backend/`. Keep the Laravel worker/deployment available for retries.

## Audit log integrity

Set `AUDIT_LOG_HMAC_KEY` on the Laravel server to an independently generated random value of at least 32 characters. For example, generate one with `php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"`. Do not reuse the Firebase or Supabase credentials. Audit entries are appended at Firebase `audit_logs`; ensure Firebase Realtime Database rules deny ordinary users direct write/delete access to that path.

## POS login protection

Set `FIREBASE_WEB_API_KEY` to the Firebase project's Web API key for Identity Toolkit password verification, and keep the Laravel `APP_KEY` stable. Firebase Admin credentials also need custom-token signing permissions. Deploy the frontend and Laravel API together. The browser exchanges a short-lived custom token and continues using its normal Firebase session.

New applicants select **Create Admin Account**, enter a Gmail address and password, and select **Register**. Laravel creates a Firebase account, records the pending request, and asks Firebase to deliver its built-in verification email. After verification, **Check Status** shows whether the account has been approved. Pending applicants see only the status screen. A verified administrator reviews the request under **Administrator Requests** in the top bar. A rejection is final for that Firebase UID. Resends share a 60-second cooldown per Firebase UID across sign-in sources and use the POS login cache.

Existing configured administrator UIDs and the legacy administrator email remain supported. The existing `pos:create-administrator` command is for operator provisioning of accounts whose UID or email is already authorized in server configuration. It does not process applicant approvals.

Keep `administrators`, `administrator_requests`, and `audit_logs` private to the Firebase Admin SDK. Client access must be denied at these paths, including any inherited grants from ancestor rules. Laravel stores request history under `administrator_requests` and the approved account under `administrators`, both keyed by a hash of the applicant’s UID. A Firebase ETag prevents a second decision. Laravel publishes the approved account, audit entry, and publication markers in one Firebase update. Existing signed approvals are copied into `administrators` when accessed or when the requests page is refreshed. Refreshing the page also retries interrupted audit publication. Approved access depends on the approval signature, so keep `AUDIT_LOG_HMAC_KEY` stable. Newly approved administrators use the Laravel kitchen API with the existing server-side Supabase configuration.

After opening the link, the administrator signs in again. Laravel checks the signed `email_verified` claim and the current Firebase user record before issuing administrator credentials or authorizing protected API requests. The React sign-in flow reloads the Firebase user and refreshes the ID token before opening the POS. Cashiers continue to sign in with their username and password.

POS login uses five failed submissions per normalized identifier and source IP and 60 failures per IP, each in a five-minute window beginning at the first failure. Successful password verification clears the identifier counter for that source. The application uses Laravel's request IP. If the API is behind a proxy, configure only trusted proxy addresses so requests are attributed to their actual source.

The default Laravel cache works on a single API host. Multiple API hosts must share a lock-capable cache, such as Redis or the Laravel database cache, through `POS_LOGIN_CACHE_STORE`. They must share the same app key and cache prefix. The limiter applies to the POS sign-in endpoint. Firebase's own protections still apply to direct Firebase authentication.

The TOTP pilot requires an explicit `POS_LOGIN_CACHE_STORE` using Redis, a database, or the file driver. Use the file driver only on one API host. Set `POS_LOGIN_FILE_CACHE_SINGLE_HOST=true` only after confirming that all PHP workers and Artisan use the same writable, persistent cache directory. With multiple hosts, verify that all workers and Artisan use the same persistent Redis or database cache and lock connections. Use authoritative reads and configure bounded connection and read timeouts. A driver name alone does not establish that the deployment shares or retains cache records.

Keep the pilot store out of routine cache flushes and eviction. The approved factor fingerprint is retained there. Before enabling the pilot, test enrollment contention and revocation on the deployed store. Keep Firebase and cache outages from being mistaken for successful enrollment or logout.

