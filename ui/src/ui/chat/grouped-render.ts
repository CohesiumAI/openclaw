import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AssistantIdentity } from "../assistant-identity.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";
import { extractToolCards, renderToolCardSidebar } from "./tool-cards.ts";

type ImageBlock = {
  url: string;
  alt?: string;
};

export type FileBlock = {
  fileName: string;
  mimeType?: string;
};

/** Map file extension to a short icon label */
function fileExtIcon(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "PDF",
    doc: "DOC",
    docx: "DOC",
    xls: "XLS",
    xlsx: "XLS",
    csv: "CSV",
    json: "JSON",
    md: "MD",
    txt: "TXT",
    html: "HTML",
    js: "JS",
    ts: "TS",
    py: "PY",
    zip: "ZIP",
    rar: "RAR",
  };
  return map[ext] ?? (ext.toUpperCase() || "FILE");
}

/** Extract file blocks for rendering as chips.
 *
 * Priority chain (first non-empty wins):
 *  1. _attachments (set by optimistic UI and preserved through merge) — single source of truth
 *  2. Structured type:"file" content blocks
 *  3. Text-pattern fallback ([File: ...], [File attached: ...], [media attached: ...])
 */
export function extractFileBlocks(message: unknown): FileBlock[] {
  const m = message as Record<string, unknown>;

  // Priority 1: _attachments — authoritative, carries the real filename
  if (Array.isArray(m._attachments) && m._attachments.length > 0) {
    const files: FileBlock[] = [];
    for (const att of m._attachments) {
      const a = att as Record<string, unknown>;
      const mime = typeof a.mimeType === "string" ? a.mimeType : "";
      // Skip image attachments (handled by extractImages)
      if (mime.startsWith("image/")) {
        continue;
      }
      if (typeof a.fileName === "string") {
        files.push({ fileName: a.fileName, mimeType: mime || undefined });
      }
    }
    if (files.length > 0) {
      return files;
    }
  }

  // Priority 2: structured type:"file" content blocks
  const content = m.content;
  const files: FileBlock[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;
      if (b.type === "file" && typeof b.text === "string") {
        files.push({
          fileName: b.text,
          mimeType: typeof b.mimeType === "string" ? b.mimeType : undefined,
        });
      }
    }
  }
  if (files.length > 0) {
    return files;
  }

  // Priority 3: text-pattern fallback (gateway history without optimistic merge)
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        extractFileNamesFromText(b.text, files);
      }
    }
  }
  if (typeof content === "string") {
    extractFileNamesFromText(content, files);
  }
  return files;
}

/** Parse file attachment markers from text, highest-fidelity source first.
 *  Priority: [File attached:] (original name) → [media attached:] (path) → <file name=""> (temp)
 *  Only the first matching tier produces results (avoids duplicates).
 */
function extractFileNamesFromText(text: string, out: FileBlock[]): void {
  const startLen = out.length;

  // 1. [File: ...] / [File attached: ...] — gateway marker with original filename
  const fileRe = /\[File(?:\s+attached)?:\s*([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = fileRe.exec(text)) !== null) {
    const raw = match[1].trim();
    const nameOnly = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (nameOnly) {
      out.push({ fileName: nameOnly });
    }
  }
  if (out.length > startLen) {
    return;
  }

  // 2. [media attached: ...] — path-based name (authoritative for external channels)
  const mediaRe = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/g;
  let mm: RegExpExecArray | null;
  while ((mm = mediaRe.exec(text)) !== null) {
    const firstPath = mm[1]
      .split("|")[0]
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    const baseName = firstPath.replace(/^.*[/\\]/, "");
    const cleaned = baseName.replace(/^openclaw-chat-[0-9a-f-]+/, "").replace(/^\./, "");
    if (cleaned || baseName) {
      out.push({ fileName: cleaned || baseName });
    }
  }
  if (out.length > startLen) {
    return;
  }

  // 3. <file name="..."> — lowest priority (often temp filename from media understanding)
  const xmlRe = /<file\s+name="([^"]+)"/g;
  let xm: RegExpExecArray | null;
  while ((xm = xmlRe.exec(text)) !== null) {
    const name = xm[1].trim();
    if (name) {
      out.push({ fileName: name });
    }
  }
}

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Handle source object format (from sendChatMessage)
        const source = b.source as Record<string, unknown> | undefined;
        console.log(
          `[chat:extractImages] image block: source.type=${source?.type} source.media_type=${source?.media_type} source.data.len=${typeof source?.data === "string" ? (source.data as string).length : "N/A"} b.data=${typeof b.data} b.mimeType=${b.mimeType} b.url=${typeof b.url}`,
        );
        if (source?.type === "base64" && typeof source.data === "string") {
          // Anthropic / optimistic UI format: { source: { type: "base64", media_type, data } }
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
          console.log(`[chat:extractImages] → resolved source.base64 image, url.len=${url.length}`);
        } else if (typeof b.data === "string" && typeof b.mimeType === "string") {
          // Gateway ChatImageContent format: { type: "image", data: "base64...", mimeType: "image/..." }
          const data = b.data as string;
          const mediaType = b.mimeType as string;
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
          console.log(`[chat:extractImages] → resolved flat gateway image, url.len=${url.length}`);
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
          console.log(`[chat:extractImages] → resolved url image`);
        } else {
          console.warn(
            `[chat:extractImages] → UNRESOLVED image block, keys=${Object.keys(b).join(",")}`,
          );
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  console.log(`[chat:extractImages] role=${m.role} found=${images.length} images`);
  return images;
}

export function renderReadingIndicatorGroup(
  assistant?: AssistantIdentity,
  toolName?: string | null,
  onAbort?: (() => void) | null,
) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
          <span class="chat-reading-indicator__label">${toolName ? `Working (${toolName})` : "Working..."}</span>
          ${
            onAbort
              ? html`
            <button class="chat-reading-indicator__stop" title="Stop" @click=${onAbort}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            </button>
          `
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? "Assistant";

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: startedAt,
          },
          { isStreaming: true, showReasoning: false },
          onOpenSidebar,
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${name}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

export type MessageGroupActions = {
  onRegenerate?: (startIndex: number) => void;
  onReadAloud?: (text: string) => void;
  ttsPlaying?: boolean;
  onEditMessage?: (text: string, startIndex: number) => void;
  onResendMessage?: (text: string, startIndex: number) => void;
  onSaveEdit?: (text: string, messageIndex: number) => void;
  onCancelEdit?: () => void;
  editingMessageIndex?: number | null;
  editingMessageText?: string;
  editingAttachments?: ChatAttachment[];
  onEditingAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  onEditingTextChange?: (text: string) => void;
};

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    showToolCards?: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
    actions?: MessageGroupActions;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const who =
    normalizedRole === "user"
      ? "You"
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const editIdx = opts.actions?.editingMessageIndex ?? null;
  const isEditing =
    editIdx !== null &&
    normalizedRole === "user" &&
    group.startIndex !== undefined &&
    editIdx >= group.startIndex &&
    editIdx < group.startIndex + group.messages.length;

  return html`
    <div class="chat-group ${roleClass}">
      ${renderAvatar(group.role, {
        name: assistantName,
        avatar: opts.assistantAvatar ?? null,
      })}
      <div class="chat-group-messages">
        ${
          isEditing
            ? renderInlineEdit(opts.actions!)
            : group.messages.map((item, index) =>
                renderGroupedMessage(
                  item.message,
                  {
                    isStreaming: group.isStreaming && index === group.messages.length - 1,
                    showReasoning: opts.showReasoning,
                    showToolCards: opts.showToolCards ?? true,
                  },
                  opts.onOpenSidebar,
                ),
              )
        }
        <div class="chat-group-footer">
          <span class="chat-sender-name">${who}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
          ${isEditing ? nothing : renderMessageActions(normalizedRole, group, opts.actions)}
        </div>
      </div>
    </div>
  `;
}

/** Render inline textarea for editing a user message */
function renderInlineEdit(actions: MessageGroupActions) {
  const idx = actions.editingMessageIndex!;
  const atts = actions.editingAttachments ?? [];
  return html`
    <div class="chat-bubble chat-inline-edit">
      ${
        atts.length > 0
          ? html`
        <div class="chat-file-chips chat-inline-edit__attachments">
          ${atts.map(
            (att) => html`
            <div class="chat-file-chip chat-file-chip--removable">
              <span class="chat-file-chip__ext">${fileExtIcon(att.fileName ?? "file")}</span>
              <span class="chat-file-chip__name">${att.fileName ?? "file"}</span>
              <button class="chat-file-chip__remove" title="Remove" @click=${() => {
                actions.onEditingAttachmentsChange?.(atts.filter((a) => a.id !== att.id));
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `,
          )}
        </div>
      `
          : nothing
      }
      <textarea
        class="chat-inline-edit__textarea"
        .value=${actions.editingMessageText ?? ""}
        @input=${(e: Event) => {
          actions.onEditingTextChange?.((e.target as HTMLTextAreaElement).value);
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const text = (actions.editingMessageText ?? "").trim();
            if (text) {
              actions.onSaveEdit?.(text, idx);
            }
          }
          if (e.key === "Escape") {
            actions.onCancelEdit?.();
          }
        }}
      ></textarea>
      <div class="chat-inline-edit__buttons">
        <button class="msg-action-btn" title="Save & Send" @click=${() => {
          const text = (actions.editingMessageText ?? "").trim();
          if (text) {
            actions.onSaveEdit?.(text, idx);
          }
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="msg-action-btn" title="Cancel" @click=${() => actions.onCancelEdit?.()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;
}

/** Extract plain text from all messages in a group for action callbacks */
function extractGroupText(group: MessageGroup): string {
  return group.messages
    .map((item) => extractTextCached(item.message)?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

/** Render action buttons for a message group (hover-visible) */
function renderMessageActions(role: string, group: MessageGroup, actions?: MessageGroupActions) {
  if (!actions) return nothing;
  const text = extractGroupText(group);
  if (!text) return nothing;

  if (role === "assistant") {
    return html`
      <div class="message-actions">
        <button class="msg-action-btn" title="Copy" @click=${() => {
          void navigator.clipboard.writeText(text);
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        ${
          actions.onRegenerate
            ? html`
          <button class="msg-action-btn" title="Regenerate" @click=${() => actions.onRegenerate!(group.startIndex)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        `
            : nothing
        }
        ${
          actions.onReadAloud
            ? html`
          <button class="msg-action-btn${actions.ttsPlaying ? " tts-playing" : ""}" title=${actions.ttsPlaying ? "Stop reading" : "Read aloud"} @click=${() => actions.onReadAloud!(text)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          </button>
        `
            : nothing
        }
      </div>
    `;
  }

  if (role === "user") {
    return html`
      <div class="message-actions">
        ${
          actions.onEditMessage
            ? html`
          <button class="msg-action-btn" title="Edit" @click=${() => actions.onEditMessage!(text, group.startIndex)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        `
            : nothing
        }
        ${
          actions.onResendMessage
            ? html`
          <button class="msg-action-btn" title="Resend" @click=${() => actions.onResendMessage!(text, group.startIndex)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        `
            : nothing
        }
      </div>
    `;
  }

  return nothing;
}

function renderAvatar(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? "🦞"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<div class="chat-avatar ${className}">${assistantAvatar}</div>`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => window.open(img.url, "_blank")}
          />
        `,
      )}
    </div>
  `;
}

function renderFileChips(files: FileBlock[]) {
  if (files.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-file-chips">
      ${files.map(
        (f) => html`
        <div class="chat-file-chip">
          <span class="chat-file-chip__ext">${fileExtIcon(f.fileName)}</span>
          <span class="chat-file-chip__name">${f.fileName}</span>
        </div>
      `,
      )}
    </div>
  `;
}

function renderGroupedMessage(
  message: unknown,
  opts: { isStreaming: boolean; showReasoning: boolean; showToolCards?: boolean },
  onOpenSidebar?: (content: string) => void,
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const toolCards = extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;
  const fileBlocks = extractFileBlocks(message);
  const hasFiles = fileBlocks.length > 0;

  const extractedText = extractTextCached(message);
  const extractedThinking =
    opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  const markdown = markdownBase;
  const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());

  const bubbleClasses = [
    "chat-bubble",
    canCopyMarkdown ? "has-copy" : "",
    opts.isStreaming ? "streaming" : "",
    "fade-in",
  ]
    .filter(Boolean)
    .join(" ");

  if (!markdown && hasToolCards && isToolResult) {
    return html`${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar))}`;
  }

  if (!markdown && !hasToolCards && !hasImages && !hasFiles) {
    return nothing;
  }

  return html`
    <div class="${bubbleClasses}">
      ${canCopyMarkdown ? renderCopyAsMarkdownButton(markdown!) : nothing}
      ${renderMessageImages(images)}
      ${renderFileChips(fileBlocks)}
      ${
        reasoningMarkdown
          ? html`<div class="thinking-block collapsed">
              <button class="thinking-toggle" @click=${(e: Event) => {
                const block = (e.currentTarget as HTMLElement).closest(".thinking-block");
                block?.classList.toggle("collapsed");
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <span>Thinking</span>
                <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <div class="thinking-content">${unsafeHTML(
                toSanitizedMarkdownHtml(reasoningMarkdown),
              )}</div>
            </div>`
          : nothing
      }
      ${
        markdown
          ? html`<div class="chat-text">${unsafeHTML(toSanitizedMarkdownHtml(markdown))}</div>`
          : nothing
      }
      ${opts.showToolCards !== false ? toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar)) : nothing}
    </div>
  `;
}
