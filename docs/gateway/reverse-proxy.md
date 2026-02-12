---
summary: "Deploying the gateway behind a reverse proxy (nginx, Caddy, Traefik)"
read_when:
  - Setting up a reverse proxy in front of the gateway
  - Configuring trustedProxies
  - Troubleshooting IP-based access checks behind a proxy
title: "Reverse Proxy"
---

# Reverse Proxy

When you expose the OpenClaw gateway through a reverse proxy (nginx, Caddy, Traefik, etc.), you must configure **trusted proxies** so the gateway can determine the real client IP from forwarded headers.

Without this, the gateway treats every request as coming from the proxy's IP, which breaks local-client detection, rate limiting, and IP-based access controls.

## Configuration

Add your proxy's IP(s) to `gateway.trustedProxies` in `~/.openclaw/config.yaml`:

```yaml
gateway:
  trustedProxies:
    - "127.0.0.1"
    - "::1"
    # Add your proxy IPs here, e.g.:
    # - "10.0.0.1"
    # - "192.168.1.0/24"
```

When a request arrives from a trusted proxy IP, the gateway reads the client IP from `X-Forwarded-For` or `X-Real-IP` headers. For untrusted sources, these headers are ignored.

## Security Flags

Two config flags affect authentication behavior. Both default to `false` (secure). **Do not enable them in production.**

| Flag | Default | Effect when `true` |
|------|---------|-------------------|
| `gateway.controlUi.allowInsecureAuth` | `false` | Allows token-only auth over plain HTTP; skips device identity checks |
| `gateway.controlUi.dangerouslyDisableDeviceAuth` | `false` | Disables device identity verification entirely |

The built-in security audit flags both as **critical** findings:

```bash
openclaw security audit
```

## Reverse Proxy Examples

### nginx

```nginx
server {
    listen 443 ssl;
    server_name openclaw.example.com;

    ssl_certificate     /etc/ssl/certs/openclaw.pem;
    ssl_certificate_key /etc/ssl/private/openclaw.key;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;

        # WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Forward real client IP
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
    }
}
```

### Caddy

```
openclaw.example.com {
    reverse_proxy 127.0.0.1:18789
}
```

Caddy automatically handles TLS, WebSocket upgrades, and forwarded headers.

### Traefik

```yaml
# docker-compose labels
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.openclaw.rule=Host(`openclaw.example.com`)"
  - "traefik.http.routers.openclaw.tls=true"
  - "traefik.http.services.openclaw.loadbalancer.server.port=18789"
```

## What Happens on Misconfiguration

| Scenario | Consequence |
|----------|------------|
| `trustedProxies` empty + behind proxy | All requests appear from proxy IP; local-client checks may incorrectly pass |
| `trustedProxies` too broad (e.g. `0.0.0.0/0`) | Any client can spoof `X-Forwarded-For`; IP-based controls are bypassed |
| `allowInsecureAuth=true` | Tokens transmitted in cleartext over HTTP; session hijacking trivial |
| `dangerouslyDisableDeviceAuth=true` | No device identity verification; any client with a valid token gets access |

## Verification

After configuring, run the security audit to verify:

```bash
openclaw security audit
```

The audit checks for:
- Missing `trustedProxies` when bind is loopback with Control UI enabled
- `allowInsecureAuth=true` (critical)
- `dangerouslyDisableDeviceAuth=true` (critical)
- Public bind without authentication
