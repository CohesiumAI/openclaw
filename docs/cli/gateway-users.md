---
summary: "Manage gateway user accounts (`openclaw gateway user`) — create, passwd, reset-password, rename, recovery-code, list, delete"
read_when:
  - Creating or managing gateway user accounts
  - Setting up password-based auth for the gateway
  - Resetting a forgotten password with a recovery code
title: "gateway user"
---

# Gateway User Management

Manage password-based gateway user accounts stored in `~/.openclaw/credentials/gateway-users.json`.

All commands live under `openclaw gateway user`.

## Prerequisites

- The gateway must be configured with `gateway.auth.mode: password` (or `--auth password`).
- At least one user must exist for HTTP login to work.
- Credentials are hashed with scrypt (N=16384, r=8, p=1) and never stored in plaintext.

## Commands

### `gateway user create`

Interactive wizard to create a new user account.

```bash
openclaw gateway user create
```

Prompts for:
- **Username** (min 2 characters)
- **Password** (min 8 characters, entered twice)
- **Recovery code** (4-12 digits, entered twice)
- **Role** — one of:
  - `admin` — full access (all scopes)
  - `operator` — read + write + approvals
  - `read-only` — view only

### `gateway user passwd`

Change the password for an existing user. Requires the current password.

```bash
openclaw gateway user passwd
```

### `gateway user reset-password`

Reset a forgotten password using the recovery code.

```bash
openclaw gateway user reset-password
```

The recovery code must have been set during user creation or via `recovery-code`.

### `gateway user rename`

Change a username. Requires the current password.

```bash
openclaw gateway user rename
```

### `gateway user recovery-code`

Set or update the recovery code for a user. Requires the current password.

```bash
openclaw gateway user recovery-code
```

Recovery codes are 4-12 digit numbers, hashed with the same scrypt scheme as passwords.

### `gateway user list`

List all gateway users with their role, recovery code status, and creation date.

```bash
openclaw gateway user list
openclaw gateway user list --json
```

### `gateway user delete`

Delete a user account (with confirmation prompt).

```bash
openclaw gateway user delete
```

## Security

- Passwords and recovery codes are hashed with scrypt (PHC format) — never stored in plaintext.
- The credentials file (`gateway-users.json`) has restricted permissions (`0600` on Unix, ACL-restricted on Windows).
- Login attempts are rate-limited (5 attempts per 15 minutes per IP).
- Sessions use 256-bit cryptographic random IDs with 30-minute sliding-window TTL.
- Session cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` (when HTTPS).

## Roles and Scopes

| Role | Scopes |
|------|--------|
| `admin` | `operator.admin`, `operator.approvals`, `operator.pairing` |
| `operator` | `operator.read`, `operator.write`, `operator.approvals` |
| `read-only` | `operator.read` |
