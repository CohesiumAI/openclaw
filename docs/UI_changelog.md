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

## `56edb5df6` — 2026-02-12

### security(headers): tighten CSP connect-src, add X-XSS-Protection and Permissions-Policy

- **CSP `connect-src`**: narrowed from `'self' ws: wss:` to `'self'` only (same-origin WS enforced).
- **X-XSS-Protection: 0**: disable legacy XSS auditor (rely on strict CSP instead).
- **Permissions-Policy**: `camera=(), microphone=(self), geolocation=(), payment=()` — restrict unused browser APIs, allow microphone for voice input.
- Updated `control-ui.test.ts` assertions for all new headers.

---

## `e568e0d1e` — 2026-02-12

### security(revocation): add session revocation via HTTP, WS, and CLI

- **`POST /auth/revoke-all`**: HTTP endpoint to revoke all sessions for the authenticated user.
- **`user.sessions.revoke-all`** WS method (scope: `operator.write`): same via WebSocket.
- **`openclaw user revoke`** CLI command: admin revocation of any user's sessions with confirmation prompt.
- **Frontend**: `revokeAllSessions()` function in `ui/src/ui/auth.ts`.
- E2E tests: revoke-all invalidates all user sessions, unauthenticated revoke returns 401.
- Unit tests: case-insensitive revocation, user isolation, CSRF token uniqueness.

---

## `6d9ad4807` — 2026-02-12

### security(credentials): add AES-256-GCM encryption for credentials at rest

- **`src/infra/credentials-crypto.ts`**: AES-256-GCM encryption with scrypt-derived key.
- **`openclaw credentials encrypt`**: encrypt `gateway-users.json` with a master password.
- **`openclaw credentials decrypt`**: decrypt back to plaintext.
- Round-trip unit tests, unique salt/IV per encryption, wrong-password rejection.

---

## `ab1ed54e0` — 2026-02-12

### docs: add reverse proxy guide, update security hardening docs and changelog

- **`docs/gateway/reverse-proxy.md`**: nginx, Caddy, Traefik config examples.
- Documents `trustedProxies`, `allowInsecureAuth`, `dangerouslyDisableDeviceAuth` flags.
- Misconfiguration consequences table.
- Links to `openclaw security audit` CLI command.
- Updated `web-ui-v2-features.md` §22 with session revocation, security headers table, credential encryption, and reverse proxy sections.

---

## Security Hardening — Session Persistence — 2026-02-12

### security(sessions): add encrypted session persistence across gateway restarts

- **`src/gateway/session-persistence.ts`**: AES-256-GCM encrypted persistence of the in-memory session store to `~/.openclaw/sessions/auth-sessions.enc`.
- Machine-generated 32-byte encryption key stored in `~/.openclaw/credentials/session-encryption-key` (mode `0o600`).
- Debounced writes (2 s) on every session mutation; synchronous flush on gateway shutdown.
- Expired sessions purged before persist; fail-open on corrupt/missing file (empty store, no crash).
- `initSessionPersistence()` called on gateway start; `flushSessionsToDisk()` on shutdown.
- 9 new unit tests (`session-persistence.test.ts`), 1 integration test in `auth-sessions.test.ts`.
- §22.13 (Encrypted Session Persistence) and §22.14 (Security Hardening Summary table) added to `web-ui-v2-features.md`.

---

## Security Roadmap P0–P3 — 2026-02-12

### security(P0): progressive rate limiting + recovery code endpoint

- **`src/gateway/rate-limiter.ts`** (**new**): generic progressive rate limiter (3→30s, 6→1min, 9→5min, 12+→15min) with double-keying (IP + username).
- **`src/gateway/auth-http.ts`**: refactored login rate limiter to use progressive module. Added `POST /auth/reset-password` (gated by `useHashedCredentials`, double-keyed rate limiting, timing-safe scrypt verify). Added `GET /auth/capabilities` for frontend feature discovery.
- **`src/cli/gateway-cli/user.ts`**: recovery code regex tightened from `4-12` to `8-12` digits for new codes. Existing shorter codes remain valid.
- **`src/gateway/server.impl.ts`**: `initSessionPersistence()` now gated by `resolvedAuth.useHashedCredentials` (v1 compat: no side effects in token mode). All new init modules wrapped in try/catch (fail-open).

### security(P1): audit logging

- **`src/gateway/audit-log.ts`** (**new**): singleton JSON Lines audit logger to `~/.openclaw/logs/audit.jsonl` (mode `0o600`). Async buffer (flush every 1s or 100 entries), sync flush on shutdown, file rotation at 50 MB with configurable retention.
- Instrumented `auth-http.ts`: login success/fail, logout, revoke-all, recovery success/fail.
- Audit init/shutdown integrated into `server.impl.ts` (all auth modes, fail-open).

### security(P2): native Node.js TLS certificate generation

- **`src/infra/tls/generate.ts`** (**new**): pure Node.js self-signed X.509 certificate generation using `node:crypto` (RSA 2048, SHA256, SAN: localhost + 127.0.0.1 + ::1, 3650-day validity). Replaces `openssl` CLI dependency.
- **`src/infra/tls/gateway.ts`**: `generateSelfSignedCert` refactored to use native generation. No external binary required.

### security(P3a): 2FA TOTP with backup codes

- **`src/gateway/auth-totp.ts`** (**new**): RFC 6238 TOTP implementation using `node:crypto` HMAC-SHA1. Base32 encoding, ±1 window verification, anti-replay (`lastUsedTotpCode`), `otpauth://` URI builder. Backup codes: 8-char alphanumeric, scrypt-hashed.
- **`src/infra/auth-credentials.ts`**: `GatewayUser` extended with optional `totpSecret`, `totpEnabled`, `backupCodeHashes`, `lastUsedTotpCode`. New `updateGatewayUserTotp()` function.
- **`src/gateway/auth-sessions.ts`**: `AuthSession` extended with `pendingTotpChallenge`. Added `getPendingTotpSession()` and `promoteTotpSession()` for 2FA flow. `getAuthSession()` excludes pending TOTP sessions.
- **`src/gateway/auth-http.ts`**: 4 new endpoints — `POST /auth/totp/setup`, `/auth/totp/verify`, `/auth/totp/challenge`, `/auth/totp/backup`. Login flow modified: if `totpEnabled`, creates partial session (5 min TTL) instead of full session.

### security(P3b): session key age warning

- **`src/gateway/session-persistence.ts`**: `generateOrLoadSessionKey()` now checks key file `mtime`; warns if > 365 days old with rotation suggestion.

### CLI: 2FA management + TLS commands — 2026-02-12

- **`src/cli/gateway-cli/user.ts`**: recovery code regex extended to `8-16` digits. New commands: `gateway user totp-setup` (enable TOTP, display secret/URI, verify code, generate 10 backup codes), `gateway user totp-disable` (disable with password confirmation), `gateway user totp-backup-regenerate` (regenerate backup codes with password + TOTP verification). `gateway user list` now shows `totp: yes/no` column (text + JSON).
- **`src/cli/gateway-cli/tls.ts`** (**new**): `gateway tls enable` (activate TLS, auto-generate self-signed cert), `gateway tls disable`, `gateway tls status` (show cert info, fingerprint, SAN, expiry), `gateway tls regenerate` (force new self-signed cert).

### Onboarding: hashed credentials + 2FA + TLS/proxy — 2026-02-12

- **`src/wizard/onboarding.gateway-config.ts`**: when auth=password in advanced flow, user can choose "Hashed credentials (recommended)" which creates a `GatewayUser` with scrypt-hashed password + recovery code (8-16 digits). Optional TOTP 2FA setup inline (secret display, code verify, backup codes). Legacy shared password still available.
- **TLS/proxy prompt** (advanced flow, when Tailscale=off): "No TLS / Self-signed / Custom cert / Behind reverse proxy". Reverse proxy option prompts for `trustedProxies` IPs/CIDRs and writes to `gateway.trustedProxies`.

### Frontend: 2FA TOTP login flow — 2026-02-12

- **`ui/src/ui/auth.ts`**: `login()` now detects `totpRequired` + `challengeSessionId`. New functions: `submitTotpChallenge()`, `submitTotpBackup()`.
- **`ui/src/ui/views/login.ts`**: new `renderTotpChallengeView` — 6-digit TOTP code input (numeric inputmode, autocomplete=one-time-code), backup code toggle, back-to-login link. Styled consistently with existing login card.
- **`ui/src/ui/app.ts`**: new state fields (`totpChallengeSessionId`, `totpCode`, `totpError`, `totpLoading`, `totpBackupMode`). `handleLogin()` transitions to `totp-challenge` status on TOTP-required response. New `handleTotpSubmit()` and `handleTotpBack()` methods.
- **`ui/src/ui/app-render.ts`**: auth gate renders TOTP challenge view when `authStatus === "totp-challenge"`.
- **`ui/src/ui/app-view-state.ts`**: `AuthStatus` type extended with `"totp-challenge"`.

### Frontend: first-time setup wizard + password change — 2026-02-12

- **`src/gateway/auth-http.ts`**: `GET /auth/capabilities` now exposes `needsSetup: true` when password mode has no users. New `POST /auth/setup` endpoint — creates first admin user (username, password, optional 8-16 digit recovery code), rate-limited, auto-login on success. New `POST /auth/change-password` endpoint — authenticated users change password (current password verification via scrypt, min 8 chars). Both endpoints audit-logged.
- **`ui/src/ui/auth.ts`**: new functions `fetchCapabilities()`, `setupFirstUser()`, `changePassword()`.
- **`ui/src/ui/views/login.ts`**: new `renderSetupView` — "Welcome to OpenClaw" card with username, password (x2), optional recovery code (8-16 digits). Same visual style as login card.
- **`ui/src/ui/app-lifecycle.ts`**: `checkAuthAndConnect()` calls `fetchCapabilities()` when unauthenticated; routes to `needs-setup` status when `needsSetup: true`.
- **`ui/src/ui/app.ts`**: setup wizard state fields + `handleSetup()` (client-side validation + API call + auto-connect). Password change state fields + `handlePasswordChange()`.
- **`ui/src/ui/app-render.ts`**: auth gate renders setup wizard when `authStatus === "needs-setup"`.
- **`ui/src/ui/app-view-state.ts`**: `AuthStatus` type extended with `"needs-setup"`. New state fields for setup wizard and password change.
- **`ui/src/ui/views/settings-unified.ts`**: new "Security" category in settings sidebar. Password change form (current password, new password x2) with inline success/error alerts.

### Security hardening: 2FA onboarding, HTTPS redirect, credentials rotate, audit CLI — 2026-02-12

- **2FA onboarding "secure by default"**: After first-user setup wizard, users are now shown a 2FA prompt screen with amber warning encouraging TOTP activation. Flow: prompt → QR code + manual entry → 6-digit verification → backup codes display. "Skip for now" link available but de-emphasized. New `AuthStatus: "setup-totp-prompt"` with sub-steps (`prompt`, `qr`, `verify`, `backup-codes`).
  - **`ui/src/ui/views/login.ts`**: 3 new views — `renderSetupTotpPromptView`, `renderSetupTotpQrView`, `renderSetupTotpBackupCodesView`.
  - **`ui/src/ui/auth.ts`**: new `setupTotp()` and `verifyTotp()` API functions.
  - **`ui/src/ui/app.ts`**: `handleSetup()` now transitions to `setup-totp-prompt` instead of `authenticated`. New handlers: `handleSetupTotpInit()`, `handleSetupTotpVerify()`, `handleSetupTotpSkip()`.
  - **`ui/src/ui/app-render.ts`**: auth gate for `setup-totp-prompt` with sub-step routing.
  - **`ui/src/ui/app-view-state.ts`**: `AuthStatus` extended with `"setup-totp-prompt"`. New state fields for TOTP onboarding flow.

- **HTTP → HTTPS redirect**: When TLS is enabled and `gateway.tls.httpRedirectPort` is configured, a plain HTTP server listens on that port and responds `301 Location: https://...` for all requests.
  - **`src/config/types.gateway.ts`**: new `httpRedirectPort?: number` in `GatewayTlsConfig`.
  - **`src/config/zod-schema.ts`**: zod validation for `httpRedirectPort` (int, 1-65535).
  - **`src/gateway/server-runtime-state.ts`**: creates and binds the redirect server when TLS + `httpRedirectPort` configured.
  - **`src/gateway/server.impl.ts`**: closes redirect server on shutdown.

- **`openclaw credentials rotate`**: New CLI subcommand that rotates the session encryption key (`~/.openclaw/credentials/session-encryption-key`). Decrypts persisted sessions with old key, generates new 32-byte key, re-encrypts and saves. Prints reminder to restart gateway.
  - **`src/cli/gateway-cli/credentials.ts`**: new `rotate` subcommand.
  - **`src/gateway/session-persistence.ts`**: new exported `rotateSessionKey()` helper.

- **`openclaw audit tail` / `openclaw audit search`**: New CLI commands for querying the JSONL audit log.
  - `audit tail` — show last N lines (`-n`), follow mode (`-f`), JSON output (`--json`).
  - `audit search` — filter by `--event`, `--actor`, `--since` (duration like `1h`/`24h`/`7d` or ISO date), JSON output.
  - **`src/cli/audit-cli.ts`** (new): `registerAuditCli` with `tail` and `search` subcommands.
  - **`src/cli/program/register.subclis.ts`**: registered `audit` subcommand.
  - **`src/gateway/audit-log.ts`**: exported `resolveAuditPath()`.

- **CSP nonce + dynamic isHashedMode**: Inline config script now uses a per-request cryptographic nonce (CSP `script-src 'nonce-...'`). `connect-src` includes `ws: wss:`. `isHashedMode()` now checks `hasGatewayUsers()` regardless of auth mode (fixes TOTP 404 in hybrid token+hashed setups).

### v1 → v2 migration safety

- All new features gated by auth mode — token-mode users see zero side effects.
- All init modules wrapped in try/catch (fail-open) — gateway never fails to start.
- New config fields optional with safe defaults.
- 11 new test files covering rate limiter, audit logging, TLS generation, TOTP, and backup codes.
