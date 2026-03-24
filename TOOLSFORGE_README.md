# ToolsForge

**Built by:** Michael Barrett
**Purpose:** Multi-user modular platform — a foundation for building shared tools across an organisation
**Status:** Foundation + first tool — auth, roles, permission service, invitation workflow, frontend shell, admin UI, datetime tool proving tool-scoped permissions end-to-end
**Stack:** Node.js/Express · PostgreSQL · Docker · Railway · React/Vite · Tailwind CSS

---

## What's Built

### Backend

#### Authentication
- User registration and login with bcryptjs password hashing
- 7-day token-based sessions (`auth_sessions` table)
- Admin user auto-seeded from environment variables on every startup
- New users auto-assigned `org_member` role on registration
- Login response includes full roles array (not a flat role string)
- Inactive users (pending invitation) are blocked from logging in

#### Security
- CORS locked to origin whitelist (`APP_URL` env var + localhost dev ports)
- Rate limiting on `/api/auth/login` and `/api/auth/register` — 20 requests per 15 minutes
- `requireAuth` middleware extracts and validates token, attaches `req.user` with `id`, `email`, `org_id`
- `requireRole(['role_name'])` middleware delegates to `PermissionService` — no inline SQL in routes

#### PermissionService (`server/services/permissions.js`)
Single source of truth for all authorisation checks. Every route and future tool calls this — nothing writes its own permission SQL.

| Method | Description |
|---|---|
| `hasRole(userId, roleNames, scope)` | Check if user holds any of the given roles at the given scope |
| `isOrgAdmin(userId)` | Convenience check for org-level admin |
| `getUserRoles(userId, scopeType)` | Return all role assignments, optionally filtered by scope type |
| `grantRole(userId, roleName, scope, grantedBy)` | Assign a role, creating it if it doesn't exist |
| `revokeRole(userId, roleName, scope)` | Remove a role assignment |

**Role scoping tiers:**
- `global` — applies across the entire organisation (e.g. `org_admin`)
- `tool` — applies within a specific tool (e.g. `chat_editor` scoped to `chat`)
- `resource` — applies to a specific record (e.g. `project_owner` scoped to project id `42`)

A global role satisfies any scope check. Scoping is stored in `user_roles(scope_type, scope_id)` — not in the users table.

#### InvitationService (`server/services/invitations.js`)
Admin-controlled user onboarding. No open registration.

| Method | Description |
|---|---|
| `createInvitation(email, orgId, roleName, invitedBy)` | Create inactive user + one-time token |
| `getInvitation(token)` | Validate token, return email |
| `acceptInvitation(token, passwordHash)` | Set password, activate account |
| `resendInvitation(userId, invitedBy)` | Invalidate existing unused tokens, issue fresh 48h token |

Flow: admin invites → inactive user + 48h token created → admin copies activation link → user sets password → account activated → logged in immediately. Admin can resend to regenerate the link at any time while the account is pending.

#### API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/health` | GET | No | Server health check |
| `/api/auth/register` | POST | No | Create new user (rate limited) |
| `/api/auth/login` | POST | No | Login, returns token + roles (rate limited) |
| `/api/auth/logout` | POST | Yes | Invalidate session token |
| `/api/auth/me` | GET | Yes | Current user with roles |
| `/api/org` | GET | Yes | Current organisation details |
| `/api/tools` | GET | Yes | List installed tools |
| `/api/tools/datetime` | GET | tool role or org_admin | Datetime tool — basic or extended response by role |
| `/api/admin/users` | GET | org_admin | All users with roles and activation status |
| `/api/admin/invite` | POST | org_admin | Create invitation, returns activation URL |
| `/api/admin/users/:id/resend-invite` | POST | org_admin | Regenerate activation link for pending user |
| `/api/admin/users/:id/roles` | GET | org_admin | All roles for a user (global + tool-scoped) |
| `/api/admin/users/:id/grant-role` | POST | org_admin | Grant a role at any scope |
| `/api/admin/users/:id/revoke-role` | POST | org_admin | Revoke a role at any scope |
| `/api/invitations/:token` | GET | No | Validate invitation token |
| `/api/invitations/accept` | POST | No | Accept invitation, set password, return session |

---

### Database Schema

#### Core Tables

| Table | Description |
|---|---|
| `organizations` | Single org; all users and data scoped to it |
| `users` | Email + bcrypt password hash (nullable until activated) + `is_active` flag |
| `auth_sessions` | Token-based sessions with expiry |
| `password_reset_tokens` | One-time tokens for password reset flow (ready, not yet wired) |
| `roles` | System-defined roles (`org_admin`, `org_member`) + tool-defined roles (`datetime_viewer`, `datetime_extended`, …) |
| `user_roles` | Many-to-many role assignments with contextual scoping (`global` / `tool` / `resource`) |
| `invitation_tokens` | One-time 48h activation tokens for invited users |
| `user_settings` | JSONB key/value settings per user |
| `system_settings` | Admin-managed global configuration |
| `tools` | Tool registry — slug, name, version, enabled flag, schema name |

#### Key Design Decisions
- `users.password_hash` is nullable — invited users have no password until they activate
- `users.is_active = false` for invited users — blocks login until activation
- Roles are never stored on the `users` table — always in `user_roles` with scope
- `user_roles` unique index uses `COALESCE(scope_id, '')` to handle nullable scope correctly

---

### Frontend (React/Vite)

Located in `client/`.

#### Design System
Ported from Curam Vault — same patterns, rebranded for ToolsForge:
- CSS custom properties for theming (`--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, `--color-muted`)
- 5 themes: Warm Sand (default), Dark Slate, Forest, Midnight Blue, Paper White
- Font switcher: DM Sans (default), Inter, Lato, Merriweather, JetBrains Mono
- Lucide icon set via `IconProvider`
- `ThemeProvider` injects CSS variables dynamically — no page reload needed
- Zustand stores persisted to localStorage

#### Pages

| Page | Route | Access |
|---|---|---|
| Login | `/login` | Public |
| Accept Invitation | `/invite/:token` | Public |
| Dashboard | `/` | Authenticated |
| Settings | `/settings` | Authenticated |
| Admin — Users | `/admin/users` | org_admin only |
| Date & Time tool | `/tools/datetime` | datetime role or org_admin |

**Login** — Vault-style card layout. ToolsForge brand mark. Email/password with show/hide toggle.

**Accept Invitation** — Validates token on load. Shows set-password form. On activation, logs user in immediately and redirects to dashboard. Shows clear error for invalid/expired tokens.

**Dashboard** — Displays org name and signed-in user. Tool cards from registry. Enabled tool cards link to their route. Empty state placeholder when no tools installed. Admin badge shown for org_admin users.

**Settings — Profile tab** — Email (read-only), display name, change password with show/hide toggles.

**Settings — Appearance tab** — Live theme picker (5 swatches), font picker.

**Admin — Users** — Table of all org users showing email, active/pending status badge, global roles as pills, join date. Invite User button opens modal. Invite modal: email + role selector → shows copyable 48h activation link on success. Resend Invite button on pending users regenerates the link (invalidates previous). Manage Roles button opens role modal — shows current tool roles, grant/revoke tool-scoped access.

**Date & Time** — Proof-of-concept tool demonstrating three access tiers: no role → access denied screen; `datetime_viewer` → date and time; `datetime_extended` (or org_admin) → date, time, timezone, UTC offset, server location. Refresh button re-fetches live server time.

#### Component Structure
```
client/src/
  App.jsx                      # Router, providers, future flags
  main.jsx
  index.css                    # Tailwind + CSS variables + scrollbar
  themes.js                    # 5 theme definitions + font options
  providers/
    ThemeProvider.jsx          # Injects CSS vars on theme/font change
    IconProvider.jsx           # Semantic icon map (Lucide)
  store/
    authStore.js               # token, user — persisted
    settingsStore.js           # theme, font — persisted
  utils/
    apiClient.js               # Fetch wrapper — auto-attaches Bearer token
  components/
    AuthGuard.jsx              # Validates token on mount, redirects to /login
    Layout.jsx                 # Top bar + collapsible sidebar + Outlet
    Sidebar.jsx                # Nav: Home, Admin section (org_admin), Settings
    Toast.jsx                  # Toast context + floating notifications
  pages/
    LoginPage.jsx
    AcceptInvitePage.jsx
    DashboardPage.jsx
    SettingsPage.jsx
    AdminUsersPage.jsx
    DateTimePage.jsx
```

---

## Server File Structure

```
server/
  index.js                     # App entry — static serving, CORS (API only), routes, startup
  db.js                        # Schema init, idempotent migrations, seeding
  middleware/
    requireAuth.js             # requireAuth + requireRole (delegates to PermissionService)
    requireToolAccess.js       # Tool gate — any tool-scoped role or org_admin; attaches req.toolAccess
    rateLimit.js               # authLimiter (20 req / 15 min)
  services/
    permissions.js             # PermissionService — all authorisation logic
    invitations.js             # InvitationService — invite + activate + resend flow
  routes/
    auth.js                    # register, login, logout, me
    tools.js                   # GET /api/tools
    datetime.js                # GET /api/tools/datetime — basic or extended by role
    org.js                     # GET /api/org
    admin.js                   # users, invite, resend-invite, grant/revoke role
    invitations.js             # GET /api/invitations/:token, POST /api/invitations/accept
```

---

## Local Development Setup

### Prerequisites
- Docker Desktop running
- Node.js v22

### Start Database
```powershell
docker start toolsforge-db
```

**Create container if it doesn't exist:**
```powershell
docker run -d `
  --name toolsforge-db `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres123 `
  -e POSTGRES_DB=platform_dev `
  -p 5433:5432 `
  pgvector/pgvector:pg15
```

### Start Server
```powershell
cd "C:\users\micha\local sites\toolsforge\server"
node index.js
```

### Start Client
```powershell
cd "C:\users\micha\local sites\toolsforge\client"
npm run dev
```

**Client:** http://localhost:5173
**Server:** http://localhost:3001

---

## Environment Variables

**Local (`.env` in project root):**
```bash
DATABASE_URL=postgresql://postgres:postgres123@localhost:5433/platform_dev
NODE_ENV=development
APP_URL=http://localhost:5173
SEED_ADMIN_EMAIL=your@email.com
SEED_ADMIN_PASSWORD=your-password
```

**Railway:**
- Set in Railway dashboard → Service → Variables tab
- Admin user created/updated on every deploy

---

## Database Commands

**View users with activation status:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT id, email, is_active, created_at FROM users;"
```

**View user roles:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT u.email, r.name, ur.scope_type FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id;"
```

**View pending invitations:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "SELECT u.email, it.expires_at, it.used FROM invitation_tokens it JOIN users u ON u.id = it.user_id;"
```

**View all tables:**
```powershell
docker exec -it toolsforge-db psql -U postgres -d platform_dev -c "\dt"
```

---

## Production (Railway)

**URL:** https://toolsforge-production.up.railway.app

**Deploy:**
```powershell
git add .
git commit -m "Your changes"
git push origin main
```

Railway auto-deploys on push to `main`.

### How the Production Build Works

The app is deployed as a single Railway service using a multi-stage Dockerfile:

1. **Stage 1** — builds the React client (`npm run build` via Vite) inside an Alpine Node container
2. **Stage 2** — sets up the Express server and copies the built `client/dist` into `server/public`
3. Express serves static files from `server/public` if the directory exists, with a catch-all for React Router

The Dockerfile lives at the project root. Railway is configured to use it via `railway.json` (`"builder": "DOCKERFILE"`).

### Key Architecture Decisions

#### 1. CORS scoped to `/api` only — never global

CORS middleware must be applied **only to `/api` routes**, not globally.

**Why:** Vite's production build adds `crossorigin` to `<script>` and `<link>` tags. This causes the browser to send an `Origin` header even for same-origin asset requests. If CORS runs globally and rejects unknown origins with `new Error(...)`, every CSS and JS asset returns 500. Two rules to follow:
- Scope CORS to `/api` so static files never touch it
- Use `callback(null, false)` to deny unknown origins — not `callback(new Error(...))`. The error form triggers Express's error handler and returns 500. The `false` form quietly omits CORS headers and lets the request continue (same-origin requests don't need CORS headers anyway)

#### 2. Middleware order matters

```
app.set('trust proxy', 1)    ← must be first (see below)
app.use('/api', cors(...))   ← CORS only for /api
app.use(express.json())      ← body parsing
API routes                   ← /api/* resolved here, never reach static
express.static(clientDist)   ← serves built assets
app.get('*', ...)            ← React Router catch-all (last resort)
```

The catch-all `app.get('*', ...)` must come **after all API routes**. If registered earlier, it intercepts GET requests to `/api/*` and returns `index.html` instead of the API response.

#### 3. Trust proxy on Railway

Railway runs behind a load balancer. Without `app.set('trust proxy', 1)`, all requests appear to come from the same IP. This breaks per-user rate limiting — 20 login attempts from one user would trigger the limiter for everyone. With `trust proxy: 1`, Express reads the real client IP from the `X-Forwarded-For` header.

#### 4. Use a Dockerfile, not railway.json buildCommand

Railway's Railpack builder ignores custom `buildCommand` in `railway.json` for monorepos. Use a multi-stage Dockerfile instead — it gives full control over the build and is reliable across Railway builder versions.

```dockerfile
# Stage 1 — build React
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --include=dev   # --include=dev required — Vite is a devDependency
COPY client/ ./
RUN npm run build

# Stage 2 — run Express
FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client-build /app/client/dist /app/server/public
EXPOSE 3001
CMD ["node", "index.js"]
```

Key points:
- Use `--include=dev` for the client install — Vite won't exist otherwise
- Copy built `dist` into `server/public` so Express can find it with `path.join(__dirname, 'public')` — avoids unreliable `../` path traversal
- Set `"builder": "DOCKERFILE"` in `railway.json` and clear any dashboard build command

#### 5. Serving the React app from Express

Express conditionally serves the frontend if `server/public` exists (i.e. a production build is present). Local dev is unaffected — Vite runs separately and `public/` never exists locally.

```js
const clientDist = path.join(__dirname, 'public');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) =>
    res.sendFile(path.join(clientDist, 'index.html'))
  );
}
```

### Railway Environment Variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway Postgres plugin) |
| `APP_URL` | `https://toolsforge-production.up.railway.app` |
| `SEED_ADMIN_EMAIL` | Admin account email |
| `SEED_ADMIN_PASSWORD` | Admin account password |

`APP_URL` is used for invitation activation links. It is no longer required for CORS to function correctly.

### `.dockerignore`

```
**/node_modules
client/dist
```

Prevents host `node_modules` from polluting the Docker build context. Without this, a Windows `node_modules` could overwrite the clean Linux install inside the container and break native binaries.

---

## What's Next

- [ ] Global role management UI — promote/demote org_admin from admin panel (plumbing exists, no UI yet)
- [ ] Password reset flow — tokens table is ready, needs email service + routes + UI
- [ ] Email service — invitations and password reset currently require manual link copying
- [ ] Tool schema isolation — each tool gets its own DB schema
- [ ] SettingsService — shared service for user + system config reads/writes
- [ ] Deploy client to Railway as a separate static service
- [ ] Update `apiClient.js` to use `VITE_API_URL` for production Railway client deployment

---

**Foundation proven. Tool framework operational.**
