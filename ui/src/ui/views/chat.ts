import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { SlashCommandEntry } from "../controllers/chat-commands.ts";
import type { SessionsListResult } from "../types.ts";
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import { extractTextCached } from "../chat/message-extract.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { icons } from "../icons.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import "../components/resizable-divider.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  stream: string | null;
  streamStartedAt: number | null;
  activeToolName?: string | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  // Focus mode
  focusMode: boolean;
  // Sidebar state
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  // Image attachments
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  // Model selector (native <select>)
  modelsCatalog?: Array<{ id: string; name?: string; provider?: string }>;
  currentModel?: string | null;
  onModelChange?: (modelId: string) => void;
  // Skills popover
  skills?: Array<{ name: string; emoji?: string; enabled: boolean }>;
  skillsPopoverOpen?: boolean;
  onToggleSkillsPopover?: () => void;
  onToggleSkill?: (name: string) => void;
  // Linked chats popover
  linkedChats?: Array<{ key: string; title: string; linked: boolean }>;
  chatsPopoverOpen?: boolean;
  onToggleChatsPopover?: () => void;
  onToggleChat?: (key: string) => void;
  // Scroll control
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  // Event handlers
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  // Message actions
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
  // Voice input
  voiceListening?: boolean;
  onVoiceInput?: () => void;
  // Slash command autocomplete
  chatCommands?: SlashCommandEntry[];
  slashPopoverOpen?: boolean;
  slashPopoverIndex?: number;
  onSlashPopoverChange?: (open: boolean, index?: number) => void;
  onError?: (message: string) => void;
  maxAttachmentBytes?: number;
};

const COMPACTION_TOAST_DURATION_MS = 5000;

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }

  // Show "compacting..." while active
  if (status.active) {
    return html`
      <div class="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
        ${icons.loader} Compacting context...
      </div>
    `;
  }

  // Show "compaction complete" briefly after completion
  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div class="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          ${icons.check} Context compacted
        </div>
      `;
    }
  }

  return nothing;
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Max file size for attachments (5 MB — aligned with gateway parseMessageWithAttachments limit) */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Readable file size (e.g. "1.2 MB") */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }

  const fileItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      fileItems.push(item);
    }
  }

  if (fileItems.length === 0) {
    return;
  }

  e.preventDefault();

  for (const item of fileItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const maxBytes = props.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES;
    if (file.size > maxBytes) {
      props.onError?.(
        `File "${file.name}" is too large (${formatFileSize(file.size)}). Maximum is ${formatFileSize(maxBytes)}.`,
      );
      continue;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      const newAttachment: ChatAttachment = {
        id: generateAttachmentId(),
        dataUrl,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
      };
      const current = props.attachments ?? [];
      props.onAttachmentsChange?.([...current, newAttachment]);
    });
    reader.readAsDataURL(file);
  }
}

function renderAttachmentPreview(props: ChatProps) {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-attachments">
      ${attachments.map((att) => {
        const isImage = isImageMime(att.mimeType);
        // Estimate raw size from base64 data URL
        const b64Start = att.dataUrl.indexOf(",");
        const b64Len = b64Start >= 0 ? att.dataUrl.length - b64Start - 1 : 0;
        const sizeBytes = Math.floor(b64Len * 0.75);

        if (isImage) {
          return html`
            <div class="chat-attachment">
              <img
                src=${att.dataUrl}
                alt=${att.fileName || "Attachment preview"}
                class="chat-attachment__img"
              />
              <button
                class="chat-attachment__remove"
                type="button"
                aria-label="Remove attachment"
                @click=${() => {
                  const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                  props.onAttachmentsChange?.(next);
                }}
              >
                ${icons.x}
              </button>
            </div>
          `;
        }

        // Non-image file: show icon + name + size
        return html`
          <div class="chat-attachment chat-attachment--file">
            <div class="chat-attachment__file-icon">${icons.file}</div>
            <div class="chat-attachment__file-info">
              <span class="chat-attachment__file-name">${att.fileName || "file"}</span>
              <span class="chat-attachment__file-size">${formatFileSize(sizeBytes)}</span>
            </div>
            <button
              class="chat-attachment__remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `;
      })}
    </div>
  `;
}

/** Filter commands matching the current draft prefix (e.g. "/sta" → /status, /start). */
function filterSlashCommands(
  commands: SlashCommandEntry[] | undefined,
  draft: string,
): SlashCommandEntry[] {
  if (!commands || commands.length === 0) {
    return [];
  }
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  // Don't show popover if there's a space after the command (user is typing args)
  if (/^\/\S+\s/.test(trimmed)) {
    return [];
  }
  const prefix = trimmed.toLowerCase();
  return commands.filter((cmd) => cmd.name.toLowerCase().startsWith(prefix));
}

function renderSlashPopover(props: ChatProps, filtered: SlashCommandEntry[]) {
  if (!props.slashPopoverOpen || filtered.length === 0) {
    return nothing;
  }
  const selectedIdx = props.slashPopoverIndex ?? 0;
  return html`
    <div class="slash-popover" role="listbox">
      ${filtered.map(
        (cmd, i) => html`
        <button
          class="slash-popover__item ${i === selectedIdx ? "active" : ""}"
          type="button"
          role="option"
          aria-selected=${i === selectedIdx}
          @mousedown=${(e: Event) => {
            // mousedown instead of click to fire before textarea blur
            e.preventDefault();
            const text = cmd.acceptsArgs ? `${cmd.name} ` : cmd.name;
            props.onDraftChange(text);
            props.onSlashPopoverChange?.(false);
          }}
        >
          <span class="slash-popover__name">${cmd.name}</span>
          <span class="slash-popover__desc">${cmd.description}</span>
        </button>
      `,
      )}
    </div>
  `;
}

export function renderChat(props: ChatProps) {
  const canCompose = props.connected;
  const isBusy = props.sending || props.stream !== null;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar: props.assistantAvatar ?? props.assistantAvatarUrl ?? null,
  };

  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const composePlaceholder = props.connected
    ? hasAttachments
      ? "Add a message or paste more images..."
      : "Message (↩ to send, Shift+↩ for line breaks, paste images)"
    : "Connect to the gateway to start chatting…";

  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);
  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
    >
      ${
        props.loading
          ? html`
              <div class="muted">Loading chat…</div>
            `
          : nothing
      }
      ${repeat(
        buildChatItems(props),
        (item) => item.key,
        (item) => {
          if (item.kind === "divider") {
            return html`
              <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                <span class="chat-divider__line"></span>
                <span class="chat-divider__label">${item.label}</span>
                <span class="chat-divider__line"></span>
              </div>
            `;
          }

          if (item.kind === "reading-indicator") {
            return renderReadingIndicatorGroup(
              assistantIdentity,
              item.activeToolName,
              props.onAbort,
            );
          }

          if (item.kind === "stream") {
            return renderStreamingGroup(
              item.text,
              item.startedAt,
              props.onOpenSidebar,
              assistantIdentity,
            );
          }

          if (item.kind === "group") {
            return renderMessageGroup(item, {
              onOpenSidebar: props.onOpenSidebar,
              showReasoning,
              showToolCards: props.showThinking,
              assistantName: props.assistantName,
              assistantAvatar: assistantIdentity.avatar,
              actions: {
                onRegenerate: props.onRegenerate,
                onReadAloud: props.onReadAloud,
                ttsPlaying: props.ttsPlaying,
                onEditMessage: props.onEditMessage,
                onResendMessage: props.onResendMessage,
                onSaveEdit: props.onSaveEdit,
                onCancelEdit: props.onCancelEdit,
                editingMessageIndex: props.editingMessageIndex,
                editingMessageText: props.editingMessageText,
                editingAttachments: props.editingAttachments,
                onEditingAttachmentsChange: props.onEditingAttachmentsChange,
                onEditingTextChange: props.onEditingTextChange,
              },
            });
          }

          return nothing;
        },
      )}
    </div>
  `;

  return html`
    <section class="card chat">
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      ${
        props.focusMode
          ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label="Exit focus mode"
              title="Exit focus mode"
            >
              ${icons.x}
            </button>
          `
          : nothing
      }

      <div
        class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}"
      >
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${
          sidebarOpen
            ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
            : nothing
        }
      </div>

      ${
        props.queue.length
          ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__title">Queued (${props.queue.length})</div>
              <div class="chat-queue__list">
                ${props.queue.map(
                  (item) => html`
                    <div class="chat-queue__item">
                      <div class="chat-queue__text">
                        ${
                          item.text ||
                          (item.attachments?.length ? `Image (${item.attachments.length})` : "")
                        }
                      </div>
                      <button
                        class="btn chat-queue__remove"
                        type="button"
                        aria-label="Remove queued message"
                        @click=${() => props.onQueueRemove(item.id)}
                      >
                        ${icons.x}
                      </button>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : nothing
      }

      ${renderCompactionIndicator(props.compactionStatus)}

      ${
        props.showNewMessages
          ? html`
            <button
              class="btn chat-new-messages"
              type="button"
              @click=${props.onScrollToBottom}
            >
              New messages ${icons.arrowDown}
            </button>
          `
          : nothing
      }

      <div class="chat-compose">
        ${renderAttachmentPreview(props)}
        <div class="chat-compose__card">
          ${renderSlashPopover(props, filterSlashCommands(props.chatCommands, props.draft))}
          <div class="chat-compose__row">
            <label class="field chat-compose__field">
              <span>Message</span>
              <textarea
                ${ref((el) => el && adjustTextareaHeight(el as HTMLTextAreaElement))}
                .value=${props.draft}
                ?disabled=${!props.connected}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.isComposing || e.keyCode === 229) {
                    return;
                  }
                  const filtered = filterSlashCommands(props.chatCommands, props.draft);
                  const popoverOpen = Boolean(props.slashPopoverOpen && filtered.length > 0);
                  // Slash popover keyboard navigation
                  if (popoverOpen) {
                    const idx = props.slashPopoverIndex ?? 0;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      props.onSlashPopoverChange?.(true, Math.min(idx + 1, filtered.length - 1));
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      props.onSlashPopoverChange?.(true, Math.max(idx - 1, 0));
                      return;
                    }
                    if (e.key === "Tab" || e.key === "Enter") {
                      e.preventDefault();
                      const cmd = filtered[idx];
                      if (cmd) {
                        const text = cmd.acceptsArgs ? `${cmd.name} ` : cmd.name;
                        props.onDraftChange(text);
                      }
                      props.onSlashPopoverChange?.(false);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      props.onSlashPopoverChange?.(false);
                      return;
                    }
                  }
                  if (e.key !== "Enter") {
                    return;
                  }
                  if (e.shiftKey) {
                    return;
                  }
                  if (!props.connected) {
                    return;
                  }
                  e.preventDefault();
                  if (canCompose) {
                    props.onSend();
                  }
                }}
                @input=${(e: Event) => {
                  const target = e.target as HTMLTextAreaElement;
                  adjustTextareaHeight(target);
                  props.onDraftChange(target.value);
                  // Slash popover auto-open/close
                  const filtered = filterSlashCommands(props.chatCommands, target.value);
                  if (filtered.length > 0) {
                    props.onSlashPopoverChange?.(true, 0);
                  } else {
                    props.onSlashPopoverChange?.(false);
                  }
                }}
                @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
                placeholder=${composePlaceholder}
              ></textarea>
            </label>
          </div>
          <div class="chat-compose__bottom">
            <div class="chat-compose__bottom-left">
              <button
                class="btn-icon input-action"
                type="button"
                title="Attach file (or paste)"
                ?disabled=${!props.connected}
                @click=${() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.addEventListener("change", () => {
                    if (!input.files || !props.onAttachmentsChange) return;
                    for (const file of Array.from(input.files)) {
                      const maxBytes = props.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES;
                      if (file.size > maxBytes) {
                        props.onError?.(
                          `File "${file.name}" is too large (${formatFileSize(file.size)}). Maximum is ${formatFileSize(maxBytes)}.`,
                        );
                        continue;
                      }
                      const reader = new FileReader();
                      reader.addEventListener("load", () => {
                        const dataUrl = reader.result as string;
                        const att: ChatAttachment = {
                          id: generateAttachmentId(),
                          dataUrl,
                          mimeType: file.type || "application/octet-stream",
                          fileName: file.name,
                        };
                        const current = props.attachments ?? [];
                        props.onAttachmentsChange?.([...current, att]);
                      });
                      reader.readAsDataURL(file);
                    }
                  });
                  input.click();
                }}
              >
                ${icons.paperclip}
              </button>
              ${renderModelSelector(props)}
              ${renderSkillsPopover(props)}
              ${renderChatsPopover(props)}
            </div>
            <div class="chat-compose__bottom-right">
              ${
                props.onVoiceInput
                  ? html`
                <button
                  class="btn-icon input-action ${props.voiceListening ? "voice-listening" : ""}"
                  type="button"
                  title=${props.voiceListening ? "Listening…" : "Voice input"}
                  @click=${props.onVoiceInput}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </button>
              `
                  : nothing
              }
              <button
                class="btn btn-primary btn-send"
                type="button"
                ?disabled=${!props.connected}
                @click=${props.onSend}
                title=${isBusy ? "Queue message" : "Send message"}
              >
                ${icons.send}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

const CHAT_HISTORY_RENDER_LIMIT = 200;

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const timestamp = normalized.timestamp || Date.now();

    if (!currentGroup || currentGroup.role !== role) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
        startIndex: item.originalIndex ?? 0,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showThinking && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }
    // Hide assistant messages that only contain tool_call blocks (no text for the user)
    if (!props.showThinking && normalized.role === "assistant") {
      const text = extractTextCached(msg);
      if (!text?.trim()) {
        continue;
      }
    }
    // Hide system messages (internal prompts) from the chat UI
    if (normalized.role.toLowerCase() === "system") {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
      originalIndex: i,
    });
  }
  if (props.showThinking) {
    for (let i = 0; i < tools.length; i++) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key, activeToolName: props.activeToolName ?? null });
    }
  }

  return groupMessages(items);
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}

/** Model selector — native <select> grouped by provider */
function renderModelSelector(props: ChatProps) {
  const catalog = props.modelsCatalog;
  if (!catalog || catalog.length === 0) return nothing;

  const currentModel =
    props.currentModel ||
    (catalog[0]?.provider ? `${catalog[0].provider}/${catalog[0].id}` : catalog[0]?.id) ||
    "";

  // Group by provider
  const groups = new Map<string, typeof catalog>();
  for (const m of catalog) {
    const provider = m.provider || "Other";
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)!.push(m);
  }

  return html`
    <div class="model-selector-bottom">
      <select
        class="model-select"
        .value=${currentModel}
        @change=${(e: Event) => {
          const val = (e.target as HTMLSelectElement).value;
          props.onModelChange?.(val);
        }}
      >
        ${[...groups.entries()].map(
          ([provider, models]) => html`
            <optgroup label=${provider}>
              ${models.map(
                (m) => html`
                  <option value=${m.provider ? `${m.provider}/${m.id}` : m.id} ?selected=${(m.provider ? `${m.provider}/${m.id}` : m.id) === currentModel}>
                    ${m.provider ? `${m.provider} / ` : ""}${m.name || m.id}
                  </option>
                `,
              )}
            </optgroup>
          `,
        )}
      </select>
    </div>
  `;
}

/** Skills button + popover */
function renderSkillsPopover(props: ChatProps) {
  const skills = props.skills;
  if (!skills || skills.length === 0) return nothing;

  const enabledCount = skills.filter((s) => s.enabled).length;

  return html`
    <div 
      class="skills-btn-wrapper"
      ${ref((el) => {
        const wrapper = el as HTMLElement | undefined;
        if (!wrapper || !props.skillsPopoverOpen) return;

        // Store handler on the element to avoid duplicates and enable cleanup
        const handleClick = (e: MouseEvent) => {
          if (!wrapper.contains(e.target as Node)) {
            props.onToggleSkillsPopover?.();
          }
        };

        // Remove any existing handler first
        const existingHandler = (wrapper as unknown as { _clickHandler?: (e: MouseEvent) => void })
          ._clickHandler;
        if (existingHandler) {
          document.removeEventListener("click", existingHandler);
        }

        // Store new handler and add listener on next tick
        (wrapper as unknown as { _clickHandler: (e: MouseEvent) => void })._clickHandler =
          handleClick;
        setTimeout(() => {
          document.addEventListener("click", handleClick, { once: true });
        }, 0);
      })}
    >
      <button
        class="skills-btn"
        type="button"
        @click=${() => props.onToggleSkillsPopover?.()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        Skills <span class="skills-count">${enabledCount}</span>
      </button>
      ${
        props.skillsPopoverOpen
          ? html`
          <div class="skills-popover">
            <div class="skills-popover-header">Skills</div>
            <div class="skills-popover-list">
              ${skills.map(
                (s) => html`
                  <button
                    class="skill-toggle ${s.enabled ? "active" : ""}"
                    @click=${() => props.onToggleSkill?.(s.name)}
                  >
                    <span class="skill-toggle-icon">${s.emoji || "⚡"}</span>
                    ${s.name}
                  </button>
                `,
              )}
            </div>
          </div>
        `
          : nothing
      }
    </div>
  `;
}

/** Linked chats button + popover (mirrors skills pattern) */
function renderChatsPopover(props: ChatProps) {
  const chats = props.linkedChats;
  if (!chats || chats.length === 0) return nothing;

  const linkedCount = chats.filter((c) => c.linked).length;

  return html`
    <div
      class="chats-btn-wrapper"
      ${ref((el) => {
        const wrapper = el as HTMLElement | undefined;
        if (!wrapper || !props.chatsPopoverOpen) return;

        const handleClick = (e: MouseEvent) => {
          if (!wrapper.contains(e.target as Node)) {
            props.onToggleChatsPopover?.();
          }
        };

        const existingHandler = (
          wrapper as unknown as { _chatClickHandler?: (e: MouseEvent) => void }
        )._chatClickHandler;
        if (existingHandler) {
          document.removeEventListener("click", existingHandler);
        }

        (wrapper as unknown as { _chatClickHandler: (e: MouseEvent) => void })._chatClickHandler =
          handleClick;
        setTimeout(() => {
          document.addEventListener("click", handleClick, { once: true });
        }, 0);
      })}
    >
      <button
        class="chats-btn"
        type="button"
        @click=${() => props.onToggleChatsPopover?.()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Chats ${linkedCount > 0 ? html`<span class="chats-count">${linkedCount}</span>` : nothing}
      </button>
      ${
        props.chatsPopoverOpen
          ? html`
          <div class="chats-popover">
            <div class="chats-popover-header">Link chats as context</div>
            <div class="chats-popover-list">
              ${chats.map(
                (c) => html`
                  <button
                    class="chat-toggle ${c.linked ? "active" : ""}"
                    @click=${() => props.onToggleChat?.(c.key)}
                  >
                    <span class="chat-toggle-icon">${c.linked ? "🔗" : "💬"}</span>
                    ${c.title}
                  </button>
                `,
              )}
            </div>
          </div>
        `
          : nothing
      }
    </div>
  `;
}
