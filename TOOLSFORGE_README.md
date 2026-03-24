# ToolsForge

**Built by:** Michael Barrett
**Purpose:** Multi-user modular platform — a foundation for building shared tools across an organisation
**Status:** Foundation complete — auth, roles, permission service, invitation workflow, frontend shell, admin UI
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

Flow: admin invites → inactive user + 48h token created → admin copies activation link → user sets password → account activated → logged in immediately.

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
| `/api/admin/users` | GET | org_admin | All users with roles and activation status |
| `/api/admin/invite` | POST | org_admin | Create invitation, returns activation URL |
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
| `roles` | System-defined roles (`org_admin`, `org_member`) + future tool-defined roles |
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

**Login** — Vault-style card layout. ToolsForge brand mark. Email/password with show/hide toggle.

**Accept Invitation** — Validates token on load. Shows set-password form. On activation, logs user in immediately and redirects to dashboard. Shows clear error for invalid/expired tokens.

**Dashboard** — Displays org name and signed-in user. Tool cards from registry. Empty state placeholder when no tools installed. Admin badge shown for org_admin users.

**Settings — Profile tab** — Email (read-only), display name, change password with show/hide toggles.

**Settings — Appearance tab** — Live theme picker (5 swatches), font picker.

**Admin — Users** — Table of all org users showing email, active/pending status badge, global roles as pills, join date. Invite User button opens modal. Invite modal: email + role selector → shows copyable 48h activation link on success.

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
```

---

## Server File Structure

```
server/
  index.js                     # App entry — CORS, routes, startup
  db.js                        # Schema init, idempotent migrations, seeding
  middleware/
    requireAuth.js             # requireAuth + requireRole (delegates to PermissionService)
    rateLimit.js               # authLimiter (20 req / 15 min)
  services/
    permissions.js             # PermissionService — all authorisation logic
    invitations.js             # InvitationService — invite + activate flow
  routes/
    auth.js                    # register, login, logout, me
    tools.js                   # GET /api/tools
    org.js                     # GET /api/org
    admin.js                   # GET /api/admin/users, POST /api/admin/invite
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

---

## What's Next

- [ ] Role Management UI — assign/revoke contextual roles on existing users from the admin panel
- [ ] Password reset flow — tokens table is ready, needs email service + routes + UI
- [ ] `requireToolAccess` middleware — check if user can access a specific tool
- [ ] First tool installation — proves PermissionService end-to-end with a real tool scope
- [ ] Tool schema isolation — each tool gets its own DB schema
- [ ] SettingsService — shared service for user + system config reads/writes
- [ ] Email service — needed for invitation emails and password reset (currently activation link is copied manually)

---

**Foundation complete. Ready to build tools.**
