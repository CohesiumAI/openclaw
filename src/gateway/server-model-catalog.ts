import { ensureAuthProfileStore, listProfilesForProvider } from "../agents/auth-profiles.js";
import {
  resolveEnvApiKey,
  getCustomProviderApiKey,
  resolveAwsSdkEnvVarName,
} from "../agents/model-auth.js";
import {
  loadModelCatalog,
  type ModelCatalogEntry,
  resetModelCatalogCacheForTest,
} from "../agents/model-catalog.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { loadConfig } from "../config/config.js";

export type GatewayModelChoice = ModelCatalogEntry;

// Test-only escape hatch: model catalog is cached at module scope for the
// process lifetime, which is fine for the real gateway daemon, but makes
// isolated unit tests harder. Keep this intentionally obscure.
export function __resetModelCatalogCacheForTest() {
  resetModelCatalogCacheForTest();
}

/** Strict check: provider has real credentials (profiles, env, config, or actual AWS vars) */
function hasExplicitAuth(
  provider: string,
  cfg: ReturnType<typeof loadConfig>,
  store: ReturnType<typeof ensureAuthProfileStore>,
): boolean {
  // Auth profiles (OAuth, token, API key)
  if (listProfilesForProvider(store, provider).length > 0) return true;
  // Environment variable
  if (resolveEnvApiKey(provider)?.apiKey) return true;
  // Explicit apiKey in models.providers config
  if (getCustomProviderApiKey(cfg, provider)) return true;
  // AWS: only if actual env vars are present (not just the default chain fallback)
  if (normalizeProviderId(provider) === "amazon-bedrock") {
    return resolveAwsSdkEnvVarName() !== undefined;
  }
  return false;
}

export async function loadGatewayModelCatalog(): Promise<GatewayModelChoice[]> {
  const cfg = loadConfig();
  const all = await loadModelCatalog({ config: cfg });
  if (all.length === 0) return all;

  // Only expose models whose provider has explicit auth configured
  const store = ensureAuthProfileStore();
  const authByProvider = new Map<string, boolean>();
  return all.filter((m) => {
    let ok = authByProvider.get(m.provider);
    if (ok === undefined) {
      ok = hasExplicitAuth(m.provider, cfg, store);
      authByProvider.set(m.provider, ok);
    }
    return ok;
  });
}
