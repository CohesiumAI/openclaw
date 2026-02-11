import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
};

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

const LEGACY_STORAGE_KEY = "openclaw-device-identity-v1";
const IDB_NAME = "openclaw-device-identity";
const IDB_VERSION = 1;
const IDB_STORE = "identity";
const IDB_KEY = "current";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", publicKey.slice().buffer);
  return bytesToHex(new Uint8Array(hash));
}

async function generateIdentity(): Promise<DeviceIdentity> {
  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  return {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
  };
}

// --- IndexedDB helpers (private key stored in IDB, not localStorage) ---

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.addEventListener("upgradeneeded", () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    });
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

async function loadFromIdb(): Promise<StoredIdentity | null> {
  try {
    const db = await openIdentityDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.addEventListener("success", () => {
        const val = req.result as StoredIdentity | undefined;
        resolve(val ?? null);
      });
      req.addEventListener("error", () => resolve(null));
    });
  } catch {
    return null;
  }
}

async function saveToIdb(stored: StoredIdentity): Promise<void> {
  try {
    const db = await openIdentityDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(stored, IDB_KEY);
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {
    // best-effort
  }
}

/** Migrate legacy localStorage identity to IndexedDB, then purge localStorage. */
async function migrateLegacyIdentity(): Promise<StoredIdentity | null> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredIdentity;
    if (
      parsed?.version === 1 &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.publicKey === "string" &&
      typeof parsed.privateKey === "string"
    ) {
      await saveToIdb(parsed);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return parsed;
    }
    // Invalid format — purge anyway
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // best-effort purge
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return null;
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  // Try IndexedDB first
  let stored = await loadFromIdb();
  if (!stored) {
    // Migrate from legacy localStorage if present
    stored = await migrateLegacyIdentity();
  }
  if (stored) {
    const derivedId = await fingerprintPublicKey(base64UrlDecode(stored.publicKey));
    if (derivedId !== stored.deviceId) {
      const updated: StoredIdentity = { ...stored, deviceId: derivedId };
      await saveToIdb(updated);
      return { deviceId: derivedId, publicKey: stored.publicKey, privateKey: stored.privateKey };
    }
    return {
      deviceId: stored.deviceId,
      publicKey: stored.publicKey,
      privateKey: stored.privateKey,
    };
  }

  // Generate new identity and store in IndexedDB
  const identity = await generateIdentity();
  const newStored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    createdAtMs: Date.now(),
  };
  await saveToIdb(newStored);
  return identity;
}

export async function signDevicePayload(privateKeyBase64Url: string, payload: string) {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}
