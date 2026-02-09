import type { GatewayBrowserClient } from "../gateway.ts";

export type SlashCommandEntry = {
  name: string;
  description: string;
  category?: string;
  acceptsArgs?: boolean;
};

export type ChatCommandsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  chatCommands: SlashCommandEntry[];
};

/** Fetch the slash command list from the gateway. */
export async function loadChatCommands(state: ChatCommandsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ commands?: SlashCommandEntry[] }>(
      "chat.commands",
      {},
    );
    if (Array.isArray(res?.commands)) {
      state.chatCommands = res.commands;
    }
  } catch {
    // Best-effort — commands stay empty until next attempt
  }
}
