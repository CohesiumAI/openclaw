import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";
import { handleJoinChatCommand } from "./commands-joinchat.js";

// Mock callGateway to return controlled session lists
vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

// Mock updateSessionStore to avoid disk writes
vi.mock("../../config/sessions.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    updateSessionStore: vi.fn(),
    resolveMainSessionKey: () => "agent:main:main",
  };
});

import { callGateway } from "../../gateway/call.js";

const mockedCallGateway = vi.mocked(callGateway);

let testWorkspaceDir = os.tmpdir();

beforeAll(async () => {
  testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-joinchat-"));
});

afterAll(async () => {
  await fs.rm(testWorkspaceDir, { recursive: true, force: true });
});

function buildTestParams(
  commandBody: string,
  overrides?: {
    sessionEntry?: Partial<SessionEntry>;
    sessionStore?: Record<string, SessionEntry>;
    sessionKey?: string;
    storePath?: string;
    isAuthorized?: boolean;
  },
) {
  const cfg: OpenClawConfig = {};
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: overrides?.isAuthorized !== false,
    Provider: "webchat",
    Surface: "webchat",
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized: overrides?.isAuthorized !== false,
  });

  const sessionEntry: SessionEntry = {
    sessionId: "test-session-id",
    updatedAt: Date.now(),
    ...(overrides?.sessionEntry ?? {}),
  };

  const sessionStore: Record<string, SessionEntry> = overrides?.sessionStore ?? {
    [overrides?.sessionKey ?? "agent:main:main"]: sessionEntry,
  };

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] as Array<{ gate: string; key: string }> },
    sessionKey: overrides?.sessionKey ?? "agent:main:main",
    sessionEntry,
    sessionStore,
    storePath: overrides?.storePath ?? "/tmp/sessions.json",
    workspaceDir: testWorkspaceDir,
    defaultGroupActivation: () => "mention" as const,
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "webchat",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("handleJoinChatCommand", () => {
  it("returns null for non-joinchat commands", async () => {
    const params = buildTestParams("/help");
    const result = await handleJoinChatCommand(params, true);
    expect(result).toBeNull();
  });

  it("ignores command when text commands are disabled", async () => {
    const params = buildTestParams("/joinchat list");
    const result = await handleJoinChatCommand(params, false);
    expect(result).toBeNull();
  });

  it("ignores unauthorized sender", async () => {
    const params = buildTestParams("/joinchat list", { isAuthorized: false });
    const result = await handleJoinChatCommand(params, true);
    expect(result).toEqual({ shouldContinue: false });
  });

  it("shows help when no args given", async () => {
    const params = buildTestParams("/joinchat");
    const result = await handleJoinChatCommand(params, true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("/joinchat list");
    expect(result?.reply?.text).toContain("/joinchat remove");
  });

  describe("/joinchat list", () => {
    it("lists available sessions excluding main", async () => {
      mockedCallGateway.mockResolvedValueOnce({
        sessions: [
          { key: "agent:main:main", displayName: "Agent-Main", updatedAt: Date.now() },
          { key: "agent:main:web-abc123", displayName: "My Chat", updatedAt: Date.now() },
          { key: "agent:main:web-def456", label: "Research", updatedAt: Date.now() },
        ],
      });

      const params = buildTestParams("/joinchat list");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.shouldContinue).toBe(false);
      expect(result?.reply?.text).toContain("My Chat");
      expect(result?.reply?.text).toContain("Research");
      expect(result?.reply?.text).toContain("web-abc123");
      expect(result?.reply?.text).not.toContain("Agent-Main");
    });

    it("shows empty message when no sessions exist", async () => {
      mockedCallGateway.mockResolvedValueOnce({
        sessions: [
          { key: "agent:main:main", displayName: "Agent-Main", updatedAt: Date.now() },
        ],
      });

      const params = buildTestParams("/joinchat list");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("No chat sessions found");
    });

    it("shows currently linked sessions in the list", async () => {
      mockedCallGateway.mockResolvedValueOnce({
        sessions: [
          { key: "agent:main:web-abc123", displayName: "My Chat", updatedAt: Date.now() },
        ],
      });

      const params = buildTestParams("/joinchat list", {
        sessionEntry: { linkedSessions: ["agent:main:web-abc123"] },
      });
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("Currently linked");
      expect(result?.reply?.text).toContain("web-abc123");
    });
  });

  describe("/joinchat <key>", () => {
    it("links a valid session", async () => {
      mockedCallGateway.mockResolvedValueOnce({
        sessions: [
          { key: "agent:main:web-target", displayName: "Target Chat", updatedAt: Date.now() },
        ],
      });

      const params = buildTestParams("/joinchat agent:main:web-target");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.shouldContinue).toBe(false);
      expect(result?.reply?.text).toContain("linked");
      expect(result?.reply?.text).toContain("Target Chat");
      expect(params.sessionEntry.linkedSessions).toContain("agent:main:web-target");
    });

    it("prevents joining self", async () => {
      const params = buildTestParams("/joinchat agent:main:main");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("Cannot join the current session to itself");
    });

    it("reports error for non-existent session", async () => {
      mockedCallGateway.mockResolvedValueOnce({ sessions: [] });

      const params = buildTestParams("/joinchat agent:main:web-nonexistent");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("not found");
    });

    it("deduplicates already linked sessions", async () => {
      mockedCallGateway.mockResolvedValueOnce({
        sessions: [
          { key: "agent:main:web-target", displayName: "Target Chat", updatedAt: Date.now() },
        ],
      });

      const params = buildTestParams("/joinchat agent:main:web-target", {
        sessionEntry: { linkedSessions: ["agent:main:web-target"] },
      });
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("already linked");
    });
  });

  describe("/joinchat remove", () => {
    it("removes a linked session", async () => {
      const params = buildTestParams("/joinchat remove agent:main:web-target", {
        sessionEntry: { linkedSessions: ["agent:main:web-target"] },
      });
      const result = await handleJoinChatCommand(params, true);
      expect(result?.shouldContinue).toBe(false);
      expect(result?.reply?.text).toContain("unlinked");
    });

    it("reports error when session is not linked", async () => {
      const params = buildTestParams("/joinchat remove agent:main:web-other");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("not linked");
    });

    it("shows usage when no key provided", async () => {
      const params = buildTestParams("/joinchat remove ");
      const result = await handleJoinChatCommand(params, true);
      expect(result?.reply?.text).toContain("Usage");
    });
  });
});
