# Web UI V2 — New Features & Improvements

This document provides an exhaustive comparison of every feature added or changed in Web UI V2 relative to V1.

**URL:** `http://localhost:18789/chat` (V2 is now the default and only UI)

> **Changelog:** see [UI_changelog.md](./UI_changelog.md) for the full commit history of this branch.

---

## 1. Complete UI Redesign

### 1.1 ChatGPT-Style Layout

- **Persistent conversations sidebar** (left panel) replaces V1's tab-based navigation. Conversations are listed with 2-line items: title + last-message preview + relative date.
- **Collapsible sidebar** with toggle button; state persisted in settings (`navCollapsed`).
- **Chat header bar** at the top shows the current session title, model badge, project badge, theme toggle, and a settings gear icon.
- **Branded sidebar** with OpenClaw logo, name, and live connection health indicator dot.

### 1.2 Date-Grouped Conversations

- Sidebar conversations are automatically grouped into **Today**, **Yesterday**, **This Week**, and **Older** sections.
- Session previews are loaded via `sessions.preview` RPC and displayed as a subtitle under each conversation title.

### 1.3 Settings & Navigation Modal

- V1's sidebar navigation tabs (Overview, Channels, Sessions, Usage, Agents, Skills, Nodes, Config, Logs, Debug) are moved into a **modal grid** accessible via the ⚙ settings button in the chat header.
- The modal is organized into sections: **Control**, **Agent**, and **Settings**, each with icon-labeled navigation buttons.
- **Chat-specific settings** are inline in the modal: Show Thinking, Focus Mode, TTS, STT, Stream Responses, Render Markdown, Show Default Web Session, Chat History filter, Thinking Budget, Max Attachment Size, and Session selector.

### 1.4 Dark/Light Theme

- Quick **theme toggle** directly in the chat header bar (no need to navigate to settings).

---

## 2. Multi-Chat (Multiple Conversations)

### 2.1 New Chat Creation

- **"New chat" button** in the sidebar creates a fresh web session via the gateway.
- Each new chat gets its own unique session key (`agent:<id>:web-<uuid>`).

### 2.2 Instant Session Switching

- Click any conversation in the sidebar to switch instantly. Chat history, attachments, stream state, and tool messages are fully reset and reloaded for the selected session.

### 2.3 Last-Message Previews

- The sidebar fetches and displays a truncated last-message preview for each session via `sessions.preview` RPC, with markdown markup stripped for clean display.

---

## 3. Pinning Conversations

- **Pin/Unpin** via the **⋯** (three dots) menu button on any conversation item.
- Pinned conversations appear in a dedicated collapsible **"Pinned"** section above the date-grouped list.
- Pin state is persisted in `pinnedSessionKeys` (synced cross-browser via gateway when authenticated).
- Mutual exclusion: adding a chat to a project automatically removes it from pinned.

---

## 4. Archiving Conversations

- **Archive/Unarchive** via the **⋯** (three dots) menu button on any conversation item.
- Archived chats are hidden from the sidebar (unless it's the currently active session).
- Dedicated **Archive modal** accessible from the settings modal shows all archived conversations with an "Unarchive" button for each.
- Archive state is persisted in `archivedSessionKeys` (synced cross-browser via gateway when authenticated).

---

## 5. Projects

### 5.1 Project Concept

Projects group multiple chat sessions and their files into a single organizational unit. All documents shared in a project's chats are accessible across every chat in the project. Linked chats (see Section 6) are restricted to other chats within the same project.

### 5.2 Project Management

- **Create**: via the sidebar "+" button next to Projects, or via `/project create <name>` slash command.
- **Edit**: rename, change color via the project detail view's edit button or `/project rename <old> | <new>`.
- **Delete**: only when the project has 0 chats; via project modal or `/project delete <name>`.
- **Color-coded**: 8 preset colors (green, blue, purple, amber, red, pink, teal, indigo). Color shown as a dot badge in the sidebar and project header.

### 5.3 Project Sidebar Section

- Collapsible **"Projects"** accordion in the sidebar lists all projects with chat count.
- Clicking a project opens its **detail view** in the main area.

### 5.4 Project Detail View

- Shows project name, color badge, edit button, and file count badge.
- **Files panel** (toggleable) lists all imported files with download capability.
- **"New chat in [project]"** button creates a new session and auto-assigns it to the project.
- **Chat list** with 2-line items (title, preview, date) and context menu for each chat.

### 5.5 Adding/Removing Chats

- **⋯ menu**: click the three-dots button on a conversation → "Add to project" submenu lists available projects.
- **Slash commands**: `/project add <name>` and `/project remove <name>`.
- Mutual exclusion: a chat can only belong to one project at a time.

### 5.6 Project Files (Server-Side + IndexedDB Fallback)

- When a chat is added to a project, all existing image attachments and file content blocks are automatically imported into the project's file store.
- **Primary storage**: gateway server via `user.projects.files.*` WS methods (cross-browser sync).
- **Fallback**: IndexedDB (`openclaw-project-files` database) when gateway is disconnected or unauthenticated.
- Files can be downloaded from the project detail view.
- When a chat is removed from a project, its associated files are also cleaned up.
- Full CRUD operations: `putProjectFile`, `getProjectFile`, `removeProjectFiles`, `removeAllProjectFiles`, `importChatFilesIntoProject`.
- **Server-side limits**: 35 MB max file size, 500 files per project, strict ID validation (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`).

### 5.7 Project Slash Commands

Full CLI-style management from the chat input:

- `/project create <name>` — Create a new project
- `/project rename <old> | <new>` — Rename a project
- `/project list` — List all projects with chat counts
- `/project delete <name>` — Delete a project (must have 0 chats)
- `/project add <name>` — Add the current chat to a project
- `/project remove <name>` — Remove the current chat from a project

---

## 6. Linked Chats (Cross-Chat Context)

- **"Chats" popover** in the compose bar lets users link other chat sessions as context for the current conversation.
- When inside a project, the list is scoped to only show other chats from the same project.
- Linking is done via `sessions.patch` with `linkedSessions` parameter.
- Linked chat count displayed on the button badge.

---

## 7. Live Model Switching

### 7.1 Model Selector

- **Native `<select>` dropdown** in the compose bar, grouped by provider (e.g., Anthropic, OpenAI, Google).
- Loaded from the gateway's `models.list` RPC at connection time.
- Displays `provider / model-name` format.

### 7.2 Hot-Swap

- Changing the model applies immediately to the current session via `sessions.patch` with `model` parameter.
- The current model is displayed as a badge in the chat header bar.

---

## 8. Skills Management from Chat UI

### 8.1 Skills Popover

- **"Skills" button** with enabled-count badge in the compose bar.
- Popover lists all installed (non-bundled) skills with toggle buttons.
- Skills can be enabled/disabled per-session; overrides are stored in `sessionSkillOverrides` Map.

### 8.2 Per-Session Skill Filtering

- When sending a message, the active skill filter set is passed as `skillFilter` to `chat.send`.
- First toggle snapshots the current state (all eligible & non-disabled skills), then individual toggles add/remove from the set.

---

## 9. File Attachments

### 9.1 Multi-File Support

- **Paperclip button** in the compose bar opens a native file picker (`multiple` enabled).
- **Paste support**: images and files pasted from clipboard are auto-detected and attached.
- **Drag & drop**: files can be dragged into the input area.

### 9.2 Attachment Preview

- **Image attachments** display as thumbnails with a remove (×) button.
- **Non-image files** display with a file icon, filename, and human-readable file size (B/KB/MB).

### 9.3 Size Validation

- Configurable max attachment size (default 25 MB, adjustable in settings).
- Oversized files show a user-friendly error with the file name, actual size, and maximum allowed.

### 9.4 Attachment Processing

- Files are read as base64 data URLs on the client side.
- Images are sent as `image` content blocks with `base64` source.
- Non-image files are sent as `file` content blocks with metadata.
- Raw `_attachments` are preserved on optimistic user messages for edit/resend flows.

### 9.5 Optimistic Merge

- After `chat.history` reload, image/file content blocks from local (optimistic) messages are re-injected into server-fetched messages via text-matching merge logic. This ensures attachments remain visible even though the gateway transcript stores them separately.

---

## 10. Message Actions

### 10.1 Regenerate Response

- **Regenerate button** on assistant message groups truncates the conversation at that point and resends the preceding user message (including its attachments).
- Uses `chat.truncate` + `chat.send` for server-side consistency.

### 10.2 Edit & Resend

- **Edit button** on user messages opens an inline editor with the original text and attachments.
- "Save" truncates from that message onward and sends the edited version.
- "Cancel" discards changes.
- Attachments can be added/removed during editing.

### 10.3 Read Aloud (TTS)

- **Speaker button** on assistant messages reads the text aloud.
- **Gateway TTS first**: calls `tts.convert` RPC (ElevenLabs/OpenAI/Edge) and plays the returned audio URL.
- **Browser fallback**: uses `speechSynthesis` API if gateway TTS is unavailable.
- **Toggle behavior**: clicking while playing stops playback.
- **Markdown stripping**: code blocks, links, bold/italic, headings, etc. are stripped before speech synthesis for clean prose.

---

## 11. Voice Input (Speech-to-Text)

- **Microphone button** in the compose bar toggles browser-native speech recognition.
- Uses `SpeechRecognition` / `webkitSpeechRecognition` API.
- **Continuous mode** with interim results displayed live in the text area.
- **Auto-stop** after 5–8 seconds of silence.
- Visual indicator (pulsing animation via `voice-listening` class) when active.

---

## 12. Slash Command Autocomplete

- **Popover** appears when typing `/` in the compose input.
- Commands are fetched from the gateway via `chat.commands` RPC.
- **Keyboard navigation**: Arrow Up/Down to select, Tab/Enter to autocomplete, Escape to dismiss.
- **Mouse support**: click to select a command.
- Commands that accept arguments autocomplete with a trailing space.

---

## 13. Search Modal (Cmd+K)

- **Global search** modal for quickly finding and switching between conversations.
- Sessions are filtered by title and grouped by date (Today, Yesterday, Previous 7 days, Older).
- "New chat" shortcut at the top of results.
- Keyboard-accessible with autofocus on the search input.

---

## 14. Context Menu (⋯ Three-Dots Button)

- **Custom context menu** triggered by clicking the **⋯** button on each conversation item in the sidebar, with actions:
  - **Pin / Unpin**
  - **Archive / Unarchive**
  - **Add to project** (submenu with available projects)
  - **Remove from project** (if already in one)
  - **Delete** (with confirmation modal)
- Position-aware: clamped to viewport bounds to prevent overflow.

---

## 15. Confirmation Modal

- **Generic confirm/cancel dialog** used for destructive actions (e.g., delete session).
- Customizable title, description, and OK button label.
- Overlay click to dismiss.

---

## 16. Session Management Enhancements

### 16.1 Session Patching

- V2 adds `model`, `thinkingLevel`, `verboseLevel`, `reasoningLevel` fields to `sessions.patch`.
- **Optimistic labels**: renamed session titles are preserved locally (`pendingLabels`) while the gateway confirms.
- **Coalesced loading**: concurrent `loadSessions` calls are queued to prevent dropped updates.

### 16.2 Session Delete

- Delete via the ⋯ menu triggers a confirmation modal (no `window.confirm`).
- Auto-switches to another session if the deleted one was active.

---

## 17. UI Settings Persistence & Cross-Browser Sync

V2 persists settings in `localStorage` under `openclaw.control.settings.v1`. When the user is authenticated via the gateway, a subset of settings is **synced server-side** for cross-browser access.

| Setting                 | Type      | Default | Synced | Description                                |
| ----------------------- | --------- | ------- | ------ | ------------------------------------------ |
| `splitRatio`            | number    | 0.6     | Yes    | Sidebar split ratio (0.2–0.9)              |
| `navCollapsed`          | boolean   | false   | Yes    | Collapsible sidebar state                  |
| `navGroupsCollapsed`    | Record    | {}      | Yes    | Per-group collapsed state (e.g., "pinned") |
| `showDefaultWebSession` | boolean   | false   | Yes    | Show auto-created web session in sidebar   |
| `sessionsActiveMinutes` | number    | 0       | Yes    | Sidebar filter: 0=all, >0=recent N minutes |
| `ttsAutoPlay`           | boolean   | false   | Yes    | Auto-play TTS on responses                 |
| `maxAttachmentMb`       | number    | 25      | Yes    | Max file attachment size (capped at 500)   |
| `pinnedSessionKeys`     | string[]  | []      | Yes    | User-pinned sessions (max 1000)            |
| `archivedSessionKeys`   | string[]  | []      | Yes    | Archived sessions (max 5000)               |
| `projects`              | Project[] | []      | Yes    | User-created project groups (max 100)      |
| `chatFocusMode`         | boolean   | false   | Yes    | Focus mode for chat                        |
| `chatShowThinking`      | boolean   | false   | Yes    | Show model thinking blocks                 |
| `chatStreamResponses`   | boolean   | true    | Yes    | Stream responses in real-time              |
| `chatRenderMarkdown`    | boolean   | true    | Yes    | Render markdown in messages                |

### 17.1 Sync Mechanism

- **On connect**: server preferences are fetched and merged (server wins for synced keys).
- **On change**: debounced push (600ms) to server via `user.preferences.set` WS method.
- **Migration**: if server is empty, local settings are pushed as initial sync.
- **Offline fallback**: localStorage-only when gateway is disconnected.

---

## 18. Visual & CSS Overhaul

### 18.1 Scope of Changes

- **+3,400 lines of CSS** across 7 stylesheets (base, layout, components, chat/layout, chat/grouped, chat/text, chat/tool-cards).

### 18.2 Key Visual Changes

- Modern chat-centric layout replacing the V1 dashboard/tab layout.
- Conversation sidebar with hover states, active indicators, and preview text.
- Chat header bar with model badge, project badge, and action buttons.
- Compose bar with attachment preview strip, model selector, skills button, linked chats button, voice input button.
- Context menu, confirmation modal, search modal, settings modal, archive modal, project modal — all with backdrop overlay and smooth transitions.
- Project color badges (dot indicators) throughout the UI.
- Slash command autocomplete popover with keyboard-navigable items.
- Resizable split-pane for sidebar content viewer.
- New message indicator ("New messages ↓") for scrolled-up chat threads.

---

## 19. New Controller Modules

| Module                                | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `controllers/chat-commands.ts`        | Fetches slash command catalog from gateway (`chat.commands` RPC)  |
| `controllers/models.ts`               | Loads model catalog from gateway (`models.list` RPC)              |
| `controllers/project-commands.ts`     | Handles `/project` slash commands locally                         |
| `controllers/project-files.ts`        | Project file storage (WS primary, IndexedDB fallback)             |
| `controllers/project-files-client.ts` | Gateway client registry for project file WS routing               |
| `auth.ts`                             | Auth API client (`/auth/login`, `/auth/me`, `/auth/logout`)       |
| `auth-refresh.ts`                     | Automatic session refresh (sliding window, Page Visibility API)   |
| `views/login.ts`                      | Login screen component (username/password form)                   |
| `preferences-sync.ts`                 | Debounced sync of user preferences to/from gateway                |
| `projects-sync.ts`                    | Sync user projects to/from gateway (migration + mutations)        |
| `device-identity.ts`                  | Device Ed25519 identity (migrated from localStorage to IndexedDB) |

---

## 20. New Standalone Module: TTS (`app-tts.ts`)

- Full text-to-speech pipeline with gateway-first, browser-fallback strategy.
- Markdown stripping (code blocks, links, formatting, lists, headings, blockquotes).
- Toggle play/stop behavior with `onPlayingChange` callback.
- AbortController-based cancellation for in-flight gateway TTS requests.

---

## 21. Authentication & User Management

### 21.1 Login Screen

- **Login gate**: the UI displays a login form when the gateway requires password authentication.
- Username/password fields with autofocus, Enter-to-submit, loading state, and error display.
- On successful login, the gateway sets an **HttpOnly session cookie** (`openclaw_session`) — no tokens stored client-side.

### 21.2 HTTP Auth Endpoints

| Endpoint           | Method | Description                                       |
| ------------------ | ------ | ------------------------------------------------- |
| `/auth/login`      | POST   | Authenticate with username + password             |
| `/auth/logout`     | POST   | Clear session cookie                              |
| `/auth/me`         | GET    | Check current session (returns user + CSRF token) |
| `/auth/refresh`    | POST   | Sliding window session renewal                    |
| `/auth/revoke-all` | POST   | Revoke all sessions for the current user          |

### 21.3 Session Management

- **30-minute TTL** with sliding window refresh.
- **Auto-refresh**: the UI calls `/auth/refresh` every 5 minutes while the tab is visible.
- **Page Visibility API**: pauses refresh when tab is hidden, refreshes immediately on return if session is stale (>10 min hidden).
- On refresh failure (401), the user is automatically redirected to the login screen.

### 21.4 CLI User Management

Full user CRUD via the CLI:

```
openclaw user create    # Interactive: username, password, role, optional recovery code
openclaw user passwd    # Change password for existing user
openclaw user list      # List all gateway users
openclaw user delete    # Delete a user with confirmation
openclaw user rename    # Rename a user
openclaw user recovery  # Set/update recovery code
openclaw user revoke    # Revoke all active sessions for a user
```

- Passwords hashed with **scrypt** (N=16384, r=8, p=1).
- Recovery codes (4–12 digit numeric) hashed with the same scheme.
- Credentials stored in `~/.openclaw/credentials/gateway-users.json` (mode `0o600`).

### 21.5 Roles & RBAC

- Users are assigned a **role** (`admin`, `operator`, `viewer`).
- Roles map to **scopes** (`operator.admin`, `operator.read`, `operator.write`, `operator.approvals`, `operator.pairing`).
- Every WS method is gated by scope — read methods require `operator.read`, mutations require `operator.write`, config changes require `operator.admin`.

---

## 22. Security Hardening

### 22.1 Content Security Policy (CSP)

- Strict CSP headers on all gateway HTTP responses.
- `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `connect-src 'self'`.
- `frame-ancestors 'none'` (equivalent to `X-Frame-Options: DENY`).
- Prevents inline script injection (XSS) and clickjacking.

### 22.2 HSTS

- Conditional `Strict-Transport-Security` header when gateway detects HTTPS (via reverse proxy headers).

### 22.3 CSRF Protection

- CSRF token returned on login and `/auth/me`.
- Validated on state-changing requests.

### 22.4 Timing-Safe Authentication

- **Login**: constant-time password comparison via scrypt (no early exit on wrong username).
- **WS auth**: timing-safe token comparison prevents oracle attacks.
- **Hooks tokens**: timing-safe comparison for webhook authentication.

### 22.5 Rate Limiting

- Login endpoint rate-limited: 5 failed attempts trigger a 429 response.

### 22.6 Network Exposure Check

- Gateway warns on startup if bound to `0.0.0.0` without authentication configured.

### 22.7 Device Identity Hardening

- Ed25519 private key migrated from `localStorage` to **IndexedDB** (harder to exfiltrate via XSS).
- Legacy `localStorage` key (`openclaw-device-identity-v1`) is purged after migration.
- Auth tokens no longer stored client-side — session cookies handle authentication.

### 22.8 Session Revocation

- **HTTP endpoint**: `POST /auth/revoke-all` — revokes all active sessions for the authenticated user.
- **WS method**: `user.sessions.revoke-all` — same via WebSocket (scope: `operator.write`).
- **CLI command**: `openclaw user revoke` — admin revocation of any user's sessions.
- Use case: compromised session, device loss, or password change.

### 22.9 Additional Security Headers

| Header                      | Value                                                      | Purpose                                  |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `X-Frame-Options`           | `DENY`                                                     | Prevent clickjacking                     |
| `X-Content-Type-Options`    | `nosniff`                                                  | Prevent MIME sniffing                    |
| `X-XSS-Protection`          | `0`                                                        | Disable legacy XSS auditor (rely on CSP) |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                          | Limit referrer leakage                   |
| `Permissions-Policy`        | `camera=(), microphone=(self), geolocation=(), payment=()` | Restrict browser APIs                    |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                      | HSTS (HTTPS only)                        |

### 22.10 Input Validation & Resource Limits

Server-side validation on all user-data endpoints:

| Resource                | Limit                                    |
| ----------------------- | ---------------------------------------- |
| Project IDs / File IDs  | Regex `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` |
| Projects per user       | 100                                      |
| Files per project       | 500                                      |
| File data size          | 35 MB                                    |
| Project name            | 200 chars                                |
| File name               | 255 chars                                |
| Pinned sessions         | 1000 entries, 200 chars each             |
| Archived sessions       | 5000 entries, 200 chars each             |
| `maxAttachmentMb`       | 1–500                                    |
| `sessionsActiveMinutes` | 0–525,600 (1 year)                       |
| `navGroupsCollapsed`    | Values must be booleans                  |
| Username (filesystem)   | Sanitized to `[a-z0-9_-]` only           |

### 22.11 Credential Encryption at Rest

- **CLI commands**: `openclaw credentials encrypt` / `openclaw credentials decrypt`.
- Encrypts `~/.openclaw/credentials/gateway-users.json` with AES-256-GCM using a scrypt-derived key from a user-supplied password.
- Each encryption produces unique salt + IV (no ciphertext reuse).
- File format: `{ version: 1, encrypted: true, salt, iv, authTag, data }`.

### 22.12 Reverse Proxy Guide

- Dedicated documentation at [Reverse Proxy](/gateway/reverse-proxy).
- Configuration examples for **nginx**, **Caddy**, and **Traefik**.
- Documents `trustedProxies`, `allowInsecureAuth`, `dangerouslyDisableDeviceAuth` behavior and misconfiguration consequences.
- Links to `openclaw security audit` for verification.

---

## 23. Cross-Browser Synchronization

### 23.1 Architecture

- **Server-side storage**: JSON files in `~/.openclaw/user-preferences/<username>.json` and `~/.openclaw/user-projects/<username>/` (mode `0o600`).
- **Transport**: WebSocket RPC methods (`user.preferences.get/set`, `user.projects.*`, `user.projects.files.*`).
- **Gating**: only available for password-authenticated users (session cookie auth). Token-only connections fall back to local storage.

### 23.2 WS Methods

| Method                       | Scope | Description                          |
| ---------------------------- | ----- | ------------------------------------ |
| `user.preferences.get`       | read  | Fetch preferences for current user   |
| `user.preferences.set`       | write | Merge-patch preferences              |
| `user.projects.list`         | read  | List all projects                    |
| `user.projects.create`       | write | Create a project                     |
| `user.projects.update`       | write | Update project name/color/sessions   |
| `user.projects.delete`       | write | Delete project + cleanup files       |
| `user.projects.files.get`    | read  | Retrieve a project file (dataUrl)    |
| `user.projects.files.put`    | write | Store a project file                 |
| `user.projects.files.delete` | write | Remove project files by IDs          |
| `user.sessions.revoke-all`   | write | Revoke all sessions for current user |

### 23.3 Preferences Sync Flow

1. On gateway connect: fetch server prefs via `user.preferences.get`.
2. Merge: server values win for synced keys (server is source of truth).
3. If server is empty: push local settings as initial migration.
4. On each local change: debounced push (600ms) via `user.preferences.set`.
5. Whitelist-based field validation server-side (unknown/invalid fields silently rejected).

### 23.4 Projects Sync Flow

1. On connect: fetch server projects via `user.projects.list`.
2. If server has projects: use as source of truth, overwrite local.
3. If server is empty but local has projects: migrate each to server.
4. On local mutations (create/update/delete): push to server fire-and-forget.

### 23.5 Project Files Sync

- `putProjectFile`, `getProjectFile`, `removeProjectFiles` try WS methods first.
- On WS failure or disconnection, fall back to IndexedDB.
- `removeAllProjectFiles` always cleans IndexedDB (server cleanup handled by `user.projects.delete`).
- Code-split preserved: `project-files-client.ts` (gateway registry) is statically imported, while `project-files.ts` (IndexedDB code) remains dynamically imported.

---

## 24. Unified Settings Panel

- Redesigned settings modal with **search** (filters settings by label).
- **Visual indicators**: active/non-default settings highlighted.
- **Prefill**: settings fields show current values on open.
- Organized into collapsible sections: Chat, Display, Sessions, TTS, Attachments.

---

## 25. V2 as Default UI

- V1/V2 build split removed — V2 is the single UI served at `/chat`.
- Legacy V1 routes removed from the gateway.
- Single Vite build output (no conditional V1/V2 compilation).

---

## Summary

| Category           | V1                    | V2                                                  |
| ------------------ | --------------------- | --------------------------------------------------- |
| Layout             | Tab-based dashboard   | ChatGPT-style sidebar + chat                        |
| Authentication     | Token-only            | Login screen, password auth, RBAC, session cookies  |
| Conversations      | Single active session | Multi-chat with sidebar list                        |
| Organization       | None                  | Pin, Archive, Projects                              |
| File Attachments   | Basic image paste     | Multi-file, paste, picker, preview, size validation |
| Model Selection    | Config-only           | Live hot-swap dropdown in compose bar               |
| Skills             | Settings page only    | Per-session toggle popover in compose bar           |
| Voice              | None                  | Speech-to-text input + TTS read-aloud               |
| Search             | None                  | Cmd+K modal with date-grouped results               |
| Commands           | None                  | Slash command autocomplete popover                  |
| Message Actions    | None                  | Regenerate, Edit, Resend, Read Aloud                |
| Context Menu (⋯)   | None                  | Pin, Archive, Project, Delete via three-dots button |
| Settings           | Inline in tabs        | Centralized modal with search + visual indicators   |
| Cross-Browser Sync | None                  | Preferences, projects, files synced via gateway     |
| Security           | Basic token           | CSP, HSTS, CSRF, timing-safe auth, RBAC scopes      |
| CSS                | ~2,400 lines          | ~5,800 lines (+3,400)                               |
| JS Modules         | 127 bundled           | 143+ bundled (+16 new)                              |
