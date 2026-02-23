import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { extractText } from "../chat/message-extract.ts";
import { generateUUID } from "../uuid.ts";

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

/**
 * Strip gateway-injected image placeholder tags so we can match
 * optimistic (local) user text against server-fetched text.
 */
function stripImagePlaceholders(text: string): string {
  return text.replace(/\n*\[Image attached:[^\]]*\]/g, "").trim();
}

/**
 * Strip all gateway-injected file/media content from text for merge key matching.
 * Phase 1: strip preamble markers (before user text).
 * Phase 2: truncate from first file/content marker to end.
 */
function stripFileContentForKey(text: string): string {
  let result = text;
  // Phase 1: strip preamble markers injected before user text
  result = result.replace(/\[media attached(?:\s+\d+\/\d+)?:\s*[^\]]*\]/g, "");
  result = result.replace(/\[media attached:\s*\d+\s+files\]/g, "");
  result = result.replace(/\[Image attached:\s*[^\]]*\]/g, "");
  result = result.replace(
    /To send an image back, prefer the message tool \(media\/path\/filePath\)\.[^\n]*/g,
    "",
  );
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  // Phase 2: truncate from first file/content marker to end
  const marker = /\[File(?:\s+attached)?:\s*[^\]]+\]|<file\s+/.exec(result);
  if (marker) {
    result = result.slice(0, marker.index).trim();
  }
  return result;
}

/**
 * Merge image content blocks from optimistic (local) user messages into
 * server-fetched messages. The gateway transcript stores images separately
 * (passed to the model provider) so they're absent from chat.history.
 * We match by extracted text content to re-inject them for display.
 */
/** Extra data stored on optimistic user messages (images, files, raw attachments) */
type OptimisticExtra = {
  imageBlocks: unknown[];
  fileBlocks: unknown[];
  attachments: unknown[] | undefined;
  textParts: string[];
};

function mergeOptimisticImages(optimistic: unknown[], fetched: unknown[]): unknown[] {
  // Collect image/file blocks + _attachments from optimistic user messages, keyed by text
  const extraByText = new Map<string, OptimisticExtra>();
  for (const msg of optimistic) {
    const m = msg as Record<string, unknown>;
    if (m.role !== "user") {
      continue;
    }
    const content = m.content;
    if (!Array.isArray(content)) {
      continue;
    }
    const textParts: string[] = [];
    const imageBlocks: unknown[] = [];
    const fileBlocks: unknown[] = [];
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        textParts.push(b.text);
      } else if (b.type === "image") {
        imageBlocks.push(block);
      } else if (b.type === "file") {
        fileBlocks.push(block);
      }
    }
    const hasExtra = imageBlocks.length > 0 || fileBlocks.length > 0 || m._attachments;
    if (hasExtra) {
      const key = stripFileContentForKey(stripImagePlaceholders(textParts.join("\n").trim()));
      extraByText.set(key, {
        imageBlocks,
        fileBlocks,
        attachments: Array.isArray(m._attachments) ? m._attachments : undefined,
        textParts,
      });
    }
  }
  if (extraByText.size === 0) {
    return fetched;
  }

  return fetched.map((msg) => {
    const m = msg as Record<string, unknown>;
    if (m.role !== "user") {
      return msg;
    }
    const content = m.content;
    // Extract text from the fetched message
    let rawText = "";
    if (typeof content === "string") {
      rawText = content.trim();
    } else if (Array.isArray(content)) {
      // Already has images? Don't duplicate
      if (content.some((b) => (b as Record<string, unknown>)?.type === "image")) {
        return msg;
      }
      rawText = content
        .filter((b) => (b as Record<string, unknown>)?.type === "text")
        .map((b) => String((b as Record<string, unknown>).text ?? ""))
        .join("\n")
        .trim();
    }
    // Strip gateway-injected placeholders + file content before matching
    const text = stripFileContentForKey(stripImagePlaceholders(rawText));
    let extra = extraByText.get(text);
    // Fallback: gateway may replace user text entirely with [media attached:] content,
    // leaving the stripped key empty. Match the first unmatched optimistic with files.
    if (!extra && text === "") {
      for (const [k, v] of extraByText) {
        if (v.fileBlocks.length > 0) {
          extra = v;
          extraByText.delete(k);
          // Reconstruct content: use optimistic text (gateway lost it) + file blocks
          const rebuilt: unknown[] = [];
          const originalText = v.textParts.join("\n").trim();
          if (originalText) {
            rebuilt.push({ type: "text" as const, text: originalText });
          }
          return {
            ...m,
            content: [...rebuilt, ...v.imageBlocks, ...v.fileBlocks],
            _attachments: v.attachments,
          };
        }
      }
    }
    if (!extra) {
      return msg;
    }
    extraByText.delete(text); // consume — prevent duplicate injection
    let contentArray =
      typeof content === "string"
        ? [{ type: "text" as const, text: content }]
        : Array.isArray(content)
          ? [...content]
          : [{ type: "text" as const, text: String(content) }];
    // Remove gateway-generated file blocks when we have optimistic ones (gateway
    // blocks often carry only the extension, e.g. "pdf" instead of the real name)
    if (extra.fileBlocks.length > 0) {
      contentArray = contentArray.filter((b) => (b as Record<string, unknown>).type !== "file");
    }
    return {
      ...m,
      content: [...contentArray, ...extra.imageBlocks, ...extra.fileBlocks],
      _attachments: extra.attachments,
    };
  });
}

export async function loadChatHistory(state: ChatState) {
  if (!state.client || !state.connected) {
    return;
  }
  // Only show loading indicator on initial load (empty chat).
  // Post-run reloads are background refreshes — no visible loading flash.
  state.chatLoading = state.chatMessages.length === 0;
  state.lastError = null;
  // Capture run state before the async fetch — if a send starts during the
  // RPC, chatMessages will already contain the user's message and we must
  // not overwrite it with stale gateway data.
  const runIdAtStart = state.chatRunId;
  const sessionAtStart = state.sessionKey;
  try {
    const res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
      "chat.history",
      {
        sessionKey: sessionAtStart,
        limit: 200,
      },
    );
    // Guard: a new run started during fetch, or session changed — skip overwrite
    if (state.sessionKey !== sessionAtStart) {
      return;
    }
    if (!runIdAtStart && state.chatRunId) {
      return;
    }
    const fetched = Array.isArray(res.messages) ? res.messages : [];
    // Guard: don't overwrite optimistic local messages with fewer backend
    // messages (protects user message + [Cancelled] trace after fast abort).
    // Trust the backend only when it has at least as many messages.
    if (fetched.length > 0 || state.chatMessages.length === 0) {
      // Re-inject image content blocks from optimistic messages that the
      // gateway transcript doesn't persist (images go to model separately).
      state.chatMessages = mergeOptimisticImages(state.chatMessages, fetched);
    }
    state.chatThinkingLevel = res.thinkingLevel ?? null;
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.chatLoading = false;
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
  skillFilter?: string[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add attachment previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      if (att.mimeType.startsWith("image/")) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
        });
      } else {
        contentBlocks.push({
          type: "file",
          text: att.fileName || "file",
          mimeType: att.mimeType,
        } as Record<string, string> & { type: string; text?: string });
      }
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
      // Preserve raw attachments for edit/resend flows
      _attachments: hasAttachments ? attachments!.map((a) => ({ ...a })) : undefined,
    },
  ];

  state.chatSending = true;
  state.lastError = null;
  const runId = generateUUID();
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: att.mimeType.startsWith("image/") ? "image" : "file",
            mimeType: parsed.mimeType,
            fileName: att.fileName,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
      skillFilter,
    });
    return runId;
  } catch (err) {
    const error = String(err);
    console.error(`[chat:send] ERROR: ${error}`);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.lastError = error;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      },
    ];
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/openclaw/openclaw/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string") {
      const current = state.chatStream ?? "";
      if (!current || next.length >= current.length) {
        state.chatStream = next;
      }
    }
  } else if (payload.state === "final") {
    // Commit streamed text as a regular assistant message so the response
    // stays visible while loadChatHistory refreshes in the background.
    if (state.chatStream?.trim()) {
      state.chatMessages = [
        ...state.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: state.chatStream }],
          timestamp: Date.now(),
        },
      ];
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "aborted") {
    // Keep partial stream text if any, then add a cancellation trace
    const partial = state.chatStream?.trim() || null;
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    const cancelText = partial ? `${partial}\n\n_[Cancelled]_` : "_[Cancelled]_";
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: cancelText }],
        timestamp: Date.now(),
      },
    ];
  } else if (payload.state === "error") {
    console.error(`[chat:event] ERROR — ${payload.errorMessage}`);
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    const errMsg = payload.errorMessage ?? "chat error";
    state.lastError = errMsg;
    // Show error inline in chat thread so it's visible next to the user's message
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: `Error: ${errMsg}` }],
        timestamp: Date.now(),
      },
    ];
  }
  return payload.state;
}
