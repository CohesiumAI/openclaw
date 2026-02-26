import type { WebSocket } from "ws";
import type { GatewayUserRole } from "../../infra/auth-credentials.js";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  /** Authenticated username from HTTP session (password auth). */
  authUser?: string;
  /** Role of the authenticated user (admin, operator, read-only). */
  authRole?: GatewayUserRole;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
};
