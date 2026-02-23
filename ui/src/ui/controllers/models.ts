import type { GatewayBrowserClient } from "../gateway.ts";

export type ModelCatalogEntry = {
  id: string;
  name?: string;
  provider?: string;
  contextWindow?: number;
};

export type ModelsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  modelsLoading: boolean;
  modelsCatalog: ModelCatalogEntry[];
};

/** Load model catalog from gateway via models.list */
export async function loadModels(state: ModelsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.modelsLoading) {
    return;
  }
  state.modelsLoading = true;
  try {
    const res = await state.client.request<{ models?: ModelCatalogEntry[] }>("models.list", {});
    if (res?.models) {
      state.modelsCatalog = res.models;
    }
  } catch {
    // Best-effort; model list is non-critical for basic chat
  } finally {
    state.modelsLoading = false;
  }
}
