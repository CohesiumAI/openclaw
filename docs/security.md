# Security

OpenClaw gateway includes several layers of security to protect your instance.

## Authentication

### Password Mode (recommended for remote access)

When `gateway.auth.mode` is `password`, the gateway authenticates users via hashed credentials stored in `~/.openclaw/credentials/gateway-users.json`.

Passwords are hashed using **scrypt** (PHC format) with:
- Cost parameter: 2^14 (16384)
- Block size: 8
- Parallelism: 1
- Key length: 64 bytes
- Salt: 32 random bytes

Legacy plaintext passwords from config are still supported for backward compatibility but hashed credentials take precedence when gateway users exist.

### Token Mode

When `gateway.auth.mode` is `token`, clients must provide the token configured in `gateway.auth.token` or `OPENCLAW_GATEWAY_TOKEN`.

### Tailscale

When `gateway.auth.allowTailscale` is enabled and the gateway is exposed via Tailscale Serve, Tailscale identity headers are verified via whois lookup.

## Sessions

HTTP sessions are managed server-side with secure cookies:

- **Cookie**: `openclaw_session` — `HttpOnly`, `SameSite=Strict`, `Secure` (when TLS), `Path=/`
- **TTL**: 30 minutes with sliding-window refresh
- **CSRF**: Double-submit token returned by `/auth/me` and verified on mutative requests via `X-CSRF-Token` header

### Auth Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/auth/login` | POST | Authenticate with username/password |
| `/auth/logout` | POST | Invalidate session |
| `/auth/me` | GET | Get current user info + CSRF token |
| `/auth/refresh` | POST | Extend session TTL |

Login is rate-limited to 5 attempts per IP per 15-minute window.

## WebSocket Authentication

WebSocket connections can authenticate via:
1. **HTTP session cookie** — Control UI clients authenticated via `/auth/login`
2. **Token/password in connect frame** — CLI and programmatic clients
3. **Device identity** — Paired devices with signed payloads
4. **Tailscale identity** — When enabled

Session-authenticated WS clients inherit the user's role and scopes.

## RBAC

Three built-in roles control access to gateway methods:

| Role | Scopes | Access |
|---|---|---|
| `admin` | `operator.admin`, `operator.approvals`, `operator.pairing` | Full access |
| `operator` | `operator.read`, `operator.write`, `operator.approvals` | Read + write, no config changes |
| `read-only` | `operator.read` | View-only access |

Roles are enforced server-side on every RPC method call.

## Content Security Policy

The Control UI applies a strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' ws: wss:;
img-src 'self' data: blob:;
font-src 'self' data:;
frame-ancestors 'none'
```

Additional headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`.

## Network Exposure

The gateway **refuses to bind to non-loopback addresses** unless authentication is configured (token, password, or hashed credentials). This prevents accidental exposure of an unprotected gateway.

## Secrets Hygiene

- Credential files are stored with mode `0o600` (owner read/write only)
- Credential directories use mode `0o700`
- Log redaction covers passwords, tokens, API keys, PEM blocks, and common secret patterns
- No secrets are stored in the frontend — authentication uses `HttpOnly` cookies

## Origin Checks

Browser clients (Control UI, Webchat) are subject to origin validation. The request origin must match the gateway host or be listed in `gateway.controlUi.allowedOrigins`.
