import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

const GATEWAY_TARGET = "http://127.0.0.1:18789";
const GATEWAY_WS_TARGET = "ws://127.0.0.1:18789";

export default defineConfig(() => {
  const envBase = process.env.OPENCLAW_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  const outDir = "../dist/control-ui";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, outDir),
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      host: true,
      port: 5174,
      strictPort: true,
      proxy: {
        "/v1": {
          target: GATEWAY_TARGET,
          changeOrigin: true,
          ws: true,
        },
        "/auth": {
          target: GATEWAY_TARGET,
          changeOrigin: true,
        },
        "/avatar": {
          target: GATEWAY_TARGET,
          changeOrigin: true,
        },
        "/preferences": {
          target: GATEWAY_TARGET,
          changeOrigin: true,
        },
      },
      // Use a dedicated path for Vite HMR so root-level WS can be proxied to gateway
      hmr: {
        path: "/__vite_hmr",
      },
    },
    plugins: [
      {
        name: "gateway-ws-proxy",
        configureServer(server) {
          // Proxy root-level WebSocket upgrade requests to the gateway.
          // The UI's GatewayBrowserClient connects via `new WebSocket(ws://localhost:5174)`
          // which needs to reach the gateway on port 18789.
          server.httpServer?.on("upgrade", (req, socket, head) => {
            const url = req.url ?? "/";
            // Skip Vite HMR connections
            if (url.startsWith("/__vite_hmr") || url.includes("vite")) {
              return;
            }
            // Skip paths already handled by the Vite proxy config
            if (url.startsWith("/v1")) {
              return;
            }
            // Forward root-level WS upgrade to the gateway
            const gatewayUrl = new URL(url, GATEWAY_WS_TARGET);
            const proxyReq = http.request({
              hostname: "127.0.0.1",
              port: 18789,
              path: gatewayUrl.pathname + gatewayUrl.search,
              method: "GET",
              headers: {
                ...req.headers,
                host: "127.0.0.1:18789",
              },
            });

            proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
              // Send the 101 Switching Protocols response back to the client
              let rawHeaders = `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
              for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
                rawHeaders += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
              }
              rawHeaders += "\r\n";
              socket.write(rawHeaders);

              if (proxyHead.length > 0) {
                socket.write(proxyHead);
              }

              // Bi-directional piping
              proxySocket.pipe(socket);
              socket.pipe(proxySocket);

              proxySocket.on("error", () => socket.destroy());
              socket.on("error", () => proxySocket.destroy());
              proxySocket.on("close", () => socket.destroy());
              socket.on("close", () => proxySocket.destroy());
            });

            proxyReq.on("error", () => {
              socket.destroy();
            });

            proxyReq.end();
          });
        },
      },
    ],
  };
});
