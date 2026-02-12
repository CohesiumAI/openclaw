# Web UI V2 — Changelog

Full commit history for the `feature/web-ui-v2` branch, from first to last.

See [Web UI V2 Features](./web-ui-v2-features.md) for the exhaustive feature documentation.

---

## `a21e064b4` — 2026-02-09

### feat(web-ui): V2 UI — squashed rebase onto updated main (188 upstream commits)

Initial V2 UI implementation squashed into a single commit on top of the latest `main` branch. Includes:

- Complete ChatGPT-style layout redesign (sidebar + chat)
- Multi-chat (multiple conversations with instant switching)
- Pinning & archiving conversations
- Projects (grouping chats + files)
- Linked chats (cross-chat context)
- Live model switching
- Skills management popover
- File attachments (multi-file, paste, drag & drop, size validation)
- Message actions (regenerate, edit & resend, TTS read-aloud)
- Voice input (speech-to-text)
- Slash command autocomplete
- Search modal (Cmd+K)
- Context menu (⋯ three-dots)
- Dark/light theme toggle
- +3,400 lines of CSS across 7 stylesheets
- 6 new controller modules

---

## `b0f110805` — 2026-02-10

### chore(web-ui-v2): remove local-only artifacts and debug console.log

Cleanup pass: remove leftover debug `console.log` statements and local-only artifacts that were included in the squashed rebase.

---

## `7d5430f88` — 2026-02-10

### chore(docs): rename screenshot folder to screenshot UI v2

Rename docs screenshot folder for clarity.

---

## `9381c2dec` — 2026-02-10

### chore(docs): rename screenshots folder to screenshots_UI_v2

Follow-up rename to final naming convention (`screenshots_UI_v2`).

---

## `cadecbecf` — 2026-02-11

### security: add password hashing, credentials store, HTTP sessions, CSRF, auth endpoints

Foundation for password-based authentication:

- `auth-password.ts`: scrypt-based password hashing (N=16384, r=8, p=1) with constant-time verification.
- `auth-credentials.ts`: CRUD for gateway user credentials stored in `~/.openclaw/credentials/gateway-users.json` (mode `0o600`). Supports roles (`admin`, `operator`, `viewer`).
- `auth-sessions.ts`: in-memory HTTP session store with 30-minute TTL, sliding window refresh, CSRF token generation.
- HTTP auth endpoints: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/refresh`.
- CSRF protection on state-changing requests.
- Session cookies: `HttpOnly`, `SameSite=Strict`, `Secure` (when HTTPS detected).

---

## `8fe6f2d5d` — 2026-02-11

### security: integrate auth into gateway (WS session auth, RBAC, CSP hardening, network exposure check, remove V2 routes)

Full auth integration into the gateway server:

- WebSocket session authentication: `httpSession.username` resolved during WS upgrade handshake, populates `authUser` on the connection.
- RBAC scope enforcement: every WS method gated by role-based scopes (`operator.read`, `operator.write`, `operator.admin`, `operator.approvals`, `operator.pairing`).
- Content Security Policy (CSP) headers on all HTTP responses.
- Network exposure warning on startup if bound to `0.0.0.0` without authentication.
- Legacy V2-specific routes removed (V2 becomes the default).

---

## `4bf6dffb7` — 2026-02-11

### ui: make V2 the default UI, remove V1/V2 build split

- V2 is now the single UI served at `/chat`.
- V1/V2 conditional compilation removed from Vite config.
- Legacy V1 route references cleaned up.

---

## `2d31a51e5` — 2026-02-11

### ui: add auth client and login view component

Frontend authentication layer:

- `auth.ts`: API client for `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/refresh`. Manages CSRF token lifecycle.
- `views/login.ts`: Lit-based login form component with username/password fields, autofocus, Enter-to-submit, loading state, and error display.
- App routing: login gate — UI displays login screen when gateway requires password authentication.

---

## `712fb5b36` — 2026-02-11

### test: add unit tests for auth-password, auth-sessions, auth-credentials

Unit test coverage for the auth foundation:

- `auth-password.test.ts`: hash/verify round-trip, wrong password rejection, constant-time behavior.
- `auth-sessions.test.ts`: create/get/delete sessions, TTL expiry, CSRF token validation, refresh sliding window.
- `auth-credentials.test.ts`: user CRUD, duplicate rejection, password update, role management.

---

## `c59381279` — 2026-02-11

### docs: add security documentation

Security documentation covering the authentication system, RBAC model, session management, and hardening measures.

---

## `fc41068bc` — 2026-02-11

### auth: add login gate, CLI user management, recovery codes, E2E tests

Complete auth feature set:

- **Login gate**: UI blocks access and shows login form when auth is configured.
- **CLI user management** (`openclaw user` subcommands): `create`, `passwd`, `list`, `delete`, `rename`, `recovery`.
- **Recovery codes**: 4–12 digit numeric codes, hashed with scrypt, stored alongside credentials.
- **E2E tests**: full flow — HTTP login, session cookie extraction, authenticated WS connection, method authorization, logout.

---

## `a28b7867f` — 2026-02-11

### security: fix user enumeration timing oracle in login

Prevent username enumeration via timing differences:

- On invalid username, perform a dummy scrypt hash to equalize response time with valid-username-wrong-password path.
- Ensures constant-time behavior regardless of whether the user exists.

---

## `6352dc6fa` — 2026-02-11

### security: fix WS auth timing oracle + hooks token timing attack

Timing-safe fixes for two attack vectors:

- **WS auth**: replace naive string comparison with `crypto.timingSafeEqual` for WebSocket token verification.
- **Hooks tokens**: same timing-safe comparison for webhook authentication tokens.

---

## `3b4b56eae` — 2026-02-11

### feat: auto session refresh + handleMe sliding window + gateway user docs

Session lifecycle improvements:

- `auth-refresh.ts`: automatic session refresh every 5 minutes while tab is visible.
- **Page Visibility API**: pauses refresh timer when tab is hidden, refreshes immediately on return if session is stale (>10 min hidden).
- On refresh failure (401), auto-redirect to login screen.
- `handleMe` endpoint supports sliding window renewal.
- Gateway user management documentation.

---

## `30feb49bb` — 2026-02-11

### feat(ui): unified settings panel with prefill, search, visual indicators

Settings panel redesign:

- **Search**: filter settings by label in real-time.
- **Visual indicators**: active/non-default settings are highlighted.
- **Prefill**: all fields show current values on open.
- Organized into collapsible sections.
- Sensitive value detection regex widened to cover credential, bearer, passphrase, and private key patterns.

---

## `3da47174e` — 2026-02-11

### security: remove localStorage auth tokens, harden WS upgrade pre-auth, conditional HSTS

Three security hardening measures:

- **Remove device auth token storage from localStorage** (`device-auth.ts`): auth tokens are now handled exclusively via HttpOnly session cookies. Legacy tokens are purged on module load. All storage functions replaced with no-op stubs preserving the call-site API.
- **WS upgrade pre-authentication gate** (`server-http.ts`): in password mode with hashed credentials, non-local WebSocket upgrade requests without a valid session cookie are rejected at the TCP level (HTTP 401) before consuming WS resources.
- **Conditional HSTS** (`control-ui.ts`): `Strict-Transport-Security` header only sent on encrypted connections or when `X-Forwarded-Proto` indicates HTTPS. Avoids misleading header presence over plain HTTP.

---

## `b2705f473` — 2026-02-11

### feat: server-side user preferences and projects sync, remove secrets from localStorage

Cross-browser synchronization — the largest feature commit post-initial-UI:

#### User Preferences Sync

- `src/gateway/user-preferences.ts`: per-user JSON store in `~/.openclaw/user-preferences/<username>.json` (mode `0o600`). Whitelist-validated fields, merge-patch support.
- WS methods `user.preferences.get` / `user.preferences.set` with RBAC gating (read/write scopes). Username resolved server-side from authenticated session — never from client params.
- `preferences-sync.ts`: on connect, fetches server prefs and merges (server wins). On settings change, debounced push (600ms). Falls back to localStorage-only if gateway is disconnected.
- `authUser` field added to `GatewayWsClient`, populated during WS handshake from `httpSession.username`.

#### User Projects Sync

- `src/gateway/user-projects.ts`: CRUD for projects + file storage on disk (`~/.openclaw/user-projects/<username>/`). Strict ID validation (alphanumeric regex), path traversal prevention, 25 MB file size limit.
- WS methods: `user.projects.{list,create,update,delete}`, `user.projects.files.{put,get,delete}` with RBAC gating.
- `projects-sync.ts`: on connect, fetches server projects (server wins if non-empty). One-shot migration from localStorage to server on first sync.

#### Security Hardening

- `storage.ts`: token field is never persisted to localStorage. On load, always returns empty string. On save, strips token.
- `device-identity.ts`: migrated private key storage from localStorage to IndexedDB (harder to exfiltrate via XSS). Legacy localStorage entries are auto-migrated then purged.
- `gateway.ts`: removed device-auth token storage/loading from connect flow. Auth relies on HttpOnly session cookies.

---

## `bb09f10a1` — 2026-02-12

### test+feat: unit tests for user-preferences/projects, migrate project-files to WS

#### Tests (34 cases)

- `user-preferences.test.ts`: load/save round-trip, user isolation, username sanitization, merge-patch (valid/invalid/unknown fields, range validation, array validation), corrupted JSON, wrong version.
- `user-projects.test.ts`: CRUD (create, list, duplicate rejection, invalid ID rejection, user isolation, truncation, update partial, delete with file cleanup), file storage (put/get round-trip, non-existent file/project, unsafe ID rejection, re-put update, removeProjectFiles with count).

#### project-files.ts migration to WS

- Extracted `project-files-client.ts` micro-module (gateway client registry) so `app-gateway.ts` can import it statically without pulling full IndexedDB code into main chunk (code-split preserved).
- `putProjectFile`, `getProjectFile`, `removeProjectFiles` now try `user.projects.files.*` WS methods first, falling back to IndexedDB on error or when gateway is disconnected.
- `removeAllProjectFiles` still cleans IndexedDB (server-side cleanup handled by `user.projects.delete`).
- `app-gateway.ts`: registers/clears gateway client on connect/close.

---

## `86848080c` — 2026-02-12

### test: add E2E tests for user.preferences WS methods

7 E2E tests covering the full auth + RPC flow:

- `get` returns defaults for fresh user.
- `set` merges valid fields, persists across connections.
- `set` ignores unknown/invalid fields silently.
- `set` rejects missing preferences object / empty params.
- `get` fails without session cookie (no `authUser`).

---

## `2adeb39f5` — 2026-02-12

### security: harden input validation after security audit

Fixes identified during security audit:

- **[M1]** `navGroupsCollapsed`: validate values are booleans, not arbitrary data.
- **[M2]** `sessionKeys`: filter non-string elements in create/update project.
- **[M3]** `pinnedSessionKeys` capped at 1000, `archivedSessionKeys` at 5000, individual strings capped at 200 chars (disk-space DoS prevention).
- **[M4]** Max 100 projects per user.
- **[M5]** Max 500 files per project (re-put of existing file always allowed).
- **[L1]** `maxAttachmentMb` capped at 500.
- **[L2]** `sessionsActiveMinutes` capped at 525,600 (1 year).

---

## `36255c240` — 2026-02-12

### docs: update web-ui-v2-features.md with auth, security, sync, and settings features

Updated feature documentation with 5 new sections (§21–25) and updates to 6 existing sections covering authentication, security hardening, cross-browser synchronization, unified settings panel, and V2 as default UI.

---

## Security Hardening — 2026-02-12

### security(headers): tighten CSP, add X-XSS-Protection, Permissions-Policy

- **CSP `connect-src`**: narrowed from `'self' ws: wss:` to `'self'` only (same-origin WS enforced).
- **X-XSS-Protection: 0**: disable legacy XSS auditor (rely on strict CSP instead).
- **Permissions-Policy**: `camera=(), microphone=(self), geolocation=(), payment=()` — restrict unused browser APIs, allow microphone for voice input.
- Updated `control-ui.test.ts` assertions for all new headers.

### security(revocation): add session revocation (HTTP, WS, CLI)

- **`POST /auth/revoke-all`**: HTTP endpoint to revoke all sessions for the authenticated user.
- **`user.sessions.revoke-all`** WS method (scope: `operator.write`): same via WebSocket.
- **`openclaw user revoke`** CLI command: admin revocation of any user's sessions with confirmation prompt.
- **Frontend**: `revokeAllSessions()` function in `ui/src/ui/auth.ts`.
- E2E tests: revoke-all invalidates all user sessions, unauthenticated revoke returns 401.
- Unit tests: case-insensitive revocation, user isolation, CSRF token uniqueness.

### security(credentials): add credentials encryption at rest

- **`src/infra/credentials-crypto.ts`**: AES-256-GCM encryption with scrypt-derived key.
- **`openclaw credentials encrypt`**: encrypt `gateway-users.json` with a master password.
- **`openclaw credentials decrypt`**: decrypt back to plaintext.
- Round-trip unit tests, unique salt/IV per encryption, wrong-password rejection.

### docs(gateway): add reverse proxy configuration guide

- **`docs/gateway/reverse-proxy.md`**: nginx, Caddy, Traefik examples.
- Documents `trustedProxies`, `allowInsecureAuth`, `dangerouslyDisableDeviceAuth` flags.
- Misconfiguration consequences table.
- Links to `openclaw security audit` CLI command.
