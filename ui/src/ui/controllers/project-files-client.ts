/**
 * Shared gateway client registry for project file storage.
 * Extracted into a tiny module so app-gateway.ts can import it statically
 * without pulling the full project-files.ts (and its IndexedDB code) into
 * the main chunk — keeping code-split via dynamic import() intact.
 */

import type { GatewayBrowserClient } from "../gateway.ts";

let _gwClient: GatewayBrowserClient | null = null;

/** Register the active gateway client for server-side file storage. */
export function setProjectFilesGatewayClient(client: GatewayBrowserClient | null): void {
  _gwClient = client;
}

/** Get the currently registered gateway client (may be null). */
export function getProjectFilesGatewayClient(): GatewayBrowserClient | null {
  return _gwClient;
}
