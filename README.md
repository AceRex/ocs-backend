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




