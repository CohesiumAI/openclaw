import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleControlUiHttpRequest } from "./control-ui.js";

const makeResponse = (): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} => {
  const setHeader = vi.fn();
  const end = vi.fn();
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return { res, setHeader, end };
};

describe("handleControlUiHttpRequest", () => {
  it("sets anti-clickjacking headers for Control UI responses", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<html></html>\n");
      const { res, setHeader } = makeResponse();
      const handled = handleControlUiHttpRequest(
        { url: "/", method: "GET", headers: {} } as IncomingMessage,
        res,
        {
          root: { kind: "resolved", path: tmp },
        },
      );
      expect(handled).toBe(true);
      expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
      // CSP is set twice: once without nonce (initial), then with nonce (serveIndexHtml override)
      const cspCalls = setHeader.mock.calls.filter(
        (c: unknown[]) => c[0] === "Content-Security-Policy",
      );
      expect(cspCalls.length).toBeGreaterThanOrEqual(1);
      const lastCsp = cspCalls[cspCalls.length - 1][1] as string;
      expect(lastCsp).toContain("script-src 'self' 'nonce-");
      expect(lastCsp).toContain("connect-src 'self' ws: wss:");
      expect(lastCsp).toContain("frame-ancestors 'none'");
      expect(setHeader).toHaveBeenCalledWith("X-XSS-Protection", "0");
      expect(setHeader).toHaveBeenCalledWith(
        "Permissions-Policy",
        "camera=(), microphone=(self), geolocation=(), payment=()",
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
