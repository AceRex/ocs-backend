# OCS Backend API

Production-ready backend API for the OCS Web Platform and Desktop App Authentication, hosted on Netlify Functions with MongoDB Atlas.

---

## 🏗️ Architecture & Serverless Design

- **Runtime**: Node.js + Express 4.x
- **Serverless Adapter**: `serverless-http` wrapping the unified Express application as a single Netlify Function (`netlify/functions/api.js`).
- **Database**: MongoDB Atlas via Mongoose with **cached connection reuse**:
  ```javascript
  // Global cached promise prevents new connections on every serverless invocation
  let cached = global.mongoose || (global.mongoose = { conn: null, promise: null });
  ```
- **Routing**: `netlify.toml` maps all incoming requests from `/api/*` to `/.netlify/functions/api/*`.
- **CORS Handling**:
  - Whitelists `FRONTEND_URL` in production (and localhost ports in development).
  - Explicitly handles header-less requests from the Electron desktop app (`/auth/validate-token`, `/auth/revoke`).

---

## 🔐 Environment Variables

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | **Yes** | — | MongoDB Atlas connection string |
| `JWT_SECRET` | **Yes** | — | Secret key used for signing authentication JWTs |
| `JWT_EXPIRY` | No | `30d` | JWT expiration duration (e.g. `30d`, `7d`) |
| `GRACE_PERIOD_MONTHS` | No | `3` | Free trial grace period duration in months |
| `FRONTEND_URL` | No | `https://churchocs.com` | Allowed CORS origin for web clients |
| `NODE_ENV` | No | `development` | Environment mode (`development`, `production`, `test`) |
| `PORT` | No | `5000` | Local standalone server port |

---

## 📑 API Endpoints & Contracts

### 1. Authentication & Licensing (`/api/auth`)

| Method | Path | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/signup` | No | Creates church account, hashes password (bcrypt), computes 3-month `graceExpiresAt`, returns JWT. |
| `POST` | `/api/auth/login` | No (Rate Limited) | Validates credentials against bcrypt hash, checks grace period. Returns 403 `trial_expired` if expired. Locks out after 5 failed attempts. |
| `POST` | `/api/auth/validate-token` | No / Bearer | Re-verifies signature, checks `revokedTokens`, checks user grace period. Returns `{ valid: true/false, reason }`. |
| `POST` | `/api/auth/revoke` | No / Bearer | Adds token `jti` to `revokedTokens` collection on desktop/web logout. |
| `GET` | `/api/auth/me` | Bearer Token | Returns authenticated user profile (`email`, `churchName`, `role`, `graceExpiresAt`). |

#### Alignment with `AUTH_CONTRACT.md`
The issued JWT payload embeds:
```json
{
  "userId": "64f1...",
  "email": "pastor@church.org",
  "role": "user",
  "org": "Grace Church",
  "tier": "standard",
  "jti": "550e8400-e29b-41d4-a716-446655440000"
}
```
When the desktop app initiates browser login via `https://auth.churchocs.com/login?state={STATE}&app=desktop&redirect_uri=ocs%3A%2F%2Fauth-callback`, the web frontend validates user login and redirects back to `ocs://auth-callback?token={TOKEN}&state={STATE}&email={EMAIL}&org={ORG}&tier={TIER}`. Subsequent desktop calls to `/api/auth/validate-token` and `/api/auth/revoke` work seamlessly.

---

### 2. Downloads Tracking (`/api/downloads`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/downloads` | Optional | Logs download event (`platform`, `appVersion`, `email`, `churchName`). Derives country server-side from IP. |
| `GET` | `/api/admin/downloads` | Admin | Downloads analytics: total downloads, counts by platform, daily timeline. |

---

### 3. Testimonials Moderation (`/api/testimonials`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/testimonials` | No (Rate Limited) | Public submission (`name`, `churchName`, `message`, `rating`). Always stored with `status: 'pending'`. |
| `GET` | `/api/testimonials` | Public | Returns **ONLY** `approved` testimonials for the public marketing site. |
| `GET` | `/api/admin/testimonials` | Admin | Lists all testimonials across statuses (`pending`, `approved`, `rejected`). |
| `PATCH` | `/api/admin/testimonials/:id` | Admin | Updates status to `approved` (sets `approvedAt`) or `rejected`. |

---

### 4. Support Tickets & Admin Notes (`/api/tickets`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/tickets` | Optional (Rate Limited) | Submits support ticket. Attaches `userId` if authenticated. |
| `GET` | `/api/admin/tickets` | Admin | Lists support tickets with status and priority filtering. |
| `GET` | `/api/admin/tickets/:id` | Admin | Returns full ticket detail including internal admin notes. |
| `PATCH` | `/api/admin/tickets/:id` | Admin | Updates ticket status (`open`, `in_progress`, `resolved`) or priority. |
| `POST` | `/api/admin/tickets/:id/notes` | Admin | Adds internal admin-only note. **Never exposed through public endpoints.** |

---

## 🧪 Testing & Verification

```bash
# Run unit & integration test suite (Jest + in-memory MongoDB)
npm test

# Run real HTTP end-to-end verification script
npm run verify

# Start local development server
npm start
```
