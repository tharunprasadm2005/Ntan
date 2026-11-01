# NTAN Inventory

Phase 1 vertical slice for a multi-tenant inventory product: MongoDB, FastAPI, and an Expo React Native app for Android and iOS.

The implemented journey is:

1. Create a company and owner account, or join with a secure invitation.
2. Sign in and restore the session securely.
3. Create items, optional reorder points, and a warehouse with default receiving/main locations.
4. Receive stock as a draft and post it to the ledger.
5. Use the role-aware, logistics-focused Home dashboard for today's inbound/outbound activity, the receiving queue, low-stock alerts, warehouse availability, and recent movements.
6. View on-hand, available stock, and movement history.

## Repository layout

```text
backend/          FastAPI API, MongoDB access, tests
mobile/           Expo React Native TypeScript app
docs/product/     Product, architecture, and Gate 0 documents
docker-compose.yml
```

## Prerequisites

- Docker Desktop
- Python 3.11 or 3.12 with `uv`
- Node.js 22.6 or newer and npm (the mobile tests run TypeScript directly with Node's type stripping)
- Expo Go on a device, or an Android/iOS simulator

## 1. Start MongoDB

From the repository root:

```powershell
docker compose up -d
docker compose ps
```

The local database is a single-node MongoDB replica set named `rs0` on `127.0.0.1:27017`. Transactions require the replica set. This setup is for local development only.

## 2. Start the API

```powershell
Set-Location backend
Copy-Item .env.example .env
```

Replace `JWT_SECRET` in `backend/.env` with a random value of at least 32 characters. The file is ignored by Git.

```powershell
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API: `http://localhost:8000/api/v1`
- OpenAPI docs: `http://localhost:8000/api/v1/docs`
- Health: `http://localhost:8000/api/v1/health`
- Readiness: `http://localhost:8000/api/v1/health/ready`

Run the backend checks:

```powershell
uv run pytest
uv run ruff check app tests
```

## 3. Start the mobile app

```powershell
Set-Location mobile
npm install
Copy-Item .env.example .env
```

Set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the API address reachable from the device:

- Android emulator without `.env`: `http://10.0.2.2:8000/api/v1`
- iOS simulator without `.env`: `http://localhost:8000/api/v1`
- Physical device: `http://<your-computer-LAN-IP>:8000/api/v1`

On Android 17+ (API 37), Expo Go needs local network access to reach Metro and the emulator host. If the permission prompt was dismissed, enable **Local network access** (shown as **Nearby devices**) for Expo Go in Android settings, then reload the project. Without it, requests to `10.0.2.2` fail even when the backend is running.

Start Expo:

```powershell
npm start
```

Then open the app in Expo Go or a simulator. Check the mobile app with:

```powershell
npm run typecheck
npm test
npx expo-doctor
```

### Developer mode versus production

Developer menus, the Expo Go launcher, reload prompts, and the floating developer tools belong to Expo Go and Metro. They are development tooling, not screens shipped by NTAN. The app itself has no test-account screen, public role selector, or developer-only UI. During local development the app runs inside Expo Go (`host.exp.exponent`); a production Android build uses the application ID `com.ntan.inventory` from `mobile/app.json`.

Do not use Expo Go developer behaviour to judge the production app surface. Release builds omit the developer menu and load the bundled JavaScript.

## First-use flow

1. Open the app and select **Create** to start a new company. The creator becomes the Owner.
2. Enter your name, company name, email, and a password of at least 8 characters.
3. Existing team members select **Join** and paste the invitation code supplied by an Owner or Admin. The inviter chooses the role; the join screen has no public role selector.
4. Open **Items**, add an item with a SKU, name, base unit, and optional reorder point.
5. Open **Receive**, create a warehouse when prompted, select the item, and enter a quantity.
6. Post the receipt. **Home** and the stock ledger update immediately. Draft receipts saved on another device or from an interrupted post are listed on **Receive** and can be posted from there.

Every receipt is drafted first and then committed atomically. The receipt create endpoint requires an `Idempotency-Key`; repeated submissions with the same key return the original receipt. **Account** shows the signed-in name, email, company, role, and location scope, with a sign-out action at the top. Tabs and quick actions adapt to the signed-in role, while the API remains the access-control boundary.

## Roles and access control

Permissions are enforced by the API from a centralized matrix; hiding UI is not an access control.

- `owner` has the full permission set. The last active Owner cannot be demoted or deactivated.
- `company_admin` can manage company settings, members, invitations, and audit history, but cannot assign or manage the Owner role.
- `inventory_manager` can manage items, locations, receiving, stock, and reports, but not members or company settings.
- `inventory_operator` can receive and record stock, but cannot manage items or company settings.
- `warehouse_supervisor` and `warehouse_operator` cover receiving/stock operations.
- `project_manager`, `technician`, and `purchasing` cover their named operational areas.
- `viewer` has read-only inventory/report access.
- `auditor` has read access plus audit history.

Sensitive role, status, scope, and invitation changes are written to the audit log. Role changes and deactivation take effect on the next request because authorization loads the current membership from MongoDB. Deactivation also revokes refresh tokens. Invitation codes are single-use, expire after seven days, are bound to the invited email, and are stored only as hashes. Only one pending invitation is allowed per company and email; expired, revoked, or accepted invitations no longer block a new invite. Login attempts and bulk invitation batches are rate-limited.

Owners and Admins can open **Account → Team & access** to review members, roles, warehouse scope, and pending invitations. The invite form accepts up to 50 comma-separated or line-separated email addresses with one shared role and warehouse scope. Results are reported per recipient, and each newly created code is shown once for manual copy/share.

A membership with no assigned locations can access all company locations. A non-empty location scope restricts dashboard activity, stock, receipt, balance, movement, and warehouse/location reads and receiving to those locations. Owner-only role assignment, tenant filtering, and last-Owner protection are enforced server-side.

## API summary

All routes are under `/api/v1`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register-company`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/session`, `GET /auth/me`, `GET /auth/me/memberships`, `POST /auth/invitation-preview`, `POST /auth/accept-invitation` |
| Company | `GET /company`, `PATCH /company`, `GET /audit-events` |
| Members | `GET /members`, `PATCH /members/{id}`, `GET /members/invitations`, `POST /members/invitations`, `POST /members/invitations/bulk`, `DELETE /members/invitations/{id}` |
| Items | `GET /items`, `POST /items`, `POST /items/lookup`, `GET /items/{id}`, `PATCH /items/{id}` |
| Warehouses | `GET /warehouses`, `POST /warehouses`, `PATCH /warehouses/{id}`, `GET /locations`, `POST /locations` |
| Receiving | `POST /receipts`, `GET /receipts`, `GET /receipts/{id}`, `POST /receipts/{id}/commit` |
| Stock | `GET /balances`, `GET /items/{id}/balances`, `GET /items/{id}/availability`, `GET /movements`, `GET /movements/{id}`, `GET /reports/stock` |
| Dashboard | `GET /dashboard` |

Access tokens are short-lived JWTs. Refresh tokens rotate on every use and are tracked server-side by unique token ID. Passwords use Argon2. Tenant identity comes from the verified token plus a server-loaded membership; client-supplied tenant headers are not trusted.

## Production Android build (later)

This repository does not yet include an EAS build profile or signing configuration, and no production build is part of the local development setup. When a release build is needed:

1. Set `EXPO_PUBLIC_API_URL` to the production HTTPS API URL before building.
2. Either generate the native project and build it with Android Studio/Gradle:

   ```powershell
   Set-Location mobile
   npx expo prebuild --platform android
   Set-Location android
   .\gradlew.bat assembleRelease
   ```

3. Or configure an EAS project and `eas.json`, then run `npx eas-cli build --platform android --profile production`.

Release signing, store credentials, and the production API/domain must be configured outside this repository. Do not use Expo Go or a debug APK as a production release.

## Current Phase 1 limits

- Online-first only. Offline draft storage and sync conflict handling are not implemented yet.
- Barcode scanning, password recovery, Google sign-in, and self-service account creation outside invitation/company setup are not implemented.
- Lot and serial tracking are modelled but rejected at receiving because their full workflows are not in this slice.
- Unit conversion is rejected; receipts use the item base unit.
- Purchase orders, approvals, transfers, issues, counts, and reporting exports are not implemented yet.
- The local MongoDB deployment is not a production configuration.
- Cost visibility is permission-gated by the API, but the first mobile journey does not expose cost entry.
- The API supports multiple company memberships, and sign-in requires a `company_id` when an account belongs to more than one company. The mobile client does not yet provide a multi-company picker.

## Product documentation

- `docs/product/01-product-vision.md`
- `docs/product/03-feature-blueprint.md`
- `docs/product/04-mobile-blueprint.md`
- `docs/product/05-technical-architecture.md`
- `docs/product/06-roadmap.md`
- `docs/product/09-gate0-resolution.md`
- `docs/product/10-gate0-management-brief.md`
#   N t a n  
 