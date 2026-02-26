/**
 * Manages the session encryption CryptoKey lifecycle.
 *
 * - Derives the AES-256-GCM key from the user's password + salt at login.
 * - Keeps the key in memory (non-extractable — lost on tab close / logout).
 * - Processes the `pendingEncryption` queue in background after login.
 */

import {
  deriveEncryptionKey,
  encryptTranscript,
  decryptTranscript,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "../crypto/session-crypto.ts";
import type { GatewayBrowserClient } from "./gateway.ts";

let encryptionKey: CryptoKey | null = null;
let processingQueue = false;

/** Whether a CryptoKey is currently available in memory. */
export function hasEncryptionKey(): boolean {
  return encryptionKey !== null;
}

/** Clear the encryption key (called on logout). */
export function clearEncryptionKey(): void {
  encryptionKey = null;
}

/**
 * Derive and store the encryption key from password + salt.
 * Called once at login when `encryptionSalt` is present.
 */
export async function initEncryptionKey(
  password: string,
  saltHex: string,
): Promise<void> {
  encryptionKey = await deriveEncryptionKey(password, saltHex);
}

/**
 * Process the `pendingEncryption` queue in background.
 * Fetches each pending session transcript, encrypts client-side, and pushes back.
 */
export async function processPendingEncryption(
  client: GatewayBrowserClient,
): Promise<void> {
  if (!encryptionKey || processingQueue) {
    return;
  }
  processingQueue = true;
  try {
    const pending = await client.request<
      { entries: Array<{ filename: string; sessionsDir: string }> }
    >("sessions.encrypt.pending", {});

    if (!pending?.entries?.length) {
      return;
    }

    for (const entry of pending.entries) {
      if (!encryptionKey) {
        break; // key was cleared (logout during processing)
      }
      try {
        const fetched = await client.request<{ content: string }>(
          "sessions.encrypt.fetch",
          { filename: entry.filename },
        );
        if (!fetched?.content) {
          continue;
        }

        const encryptedBuf = await encryptTranscript(encryptionKey, fetched.content);
        const encryptedBase64 = arrayBufferToBase64(encryptedBuf);

        await client.request("sessions.encrypt.push", {
          filename: entry.filename,
          encryptedData: encryptedBase64,
        });
      } catch (err) {
        console.warn(`[crypto] Failed to encrypt ${entry.filename}:`, err);
      }
    }
  } catch (err) {
    console.warn("[crypto] Failed to process pending encryption queue:", err);
  } finally {
    processingQueue = false;
  }
}

/**
 * Re-encrypt all encrypted sessions with a new key after password change.
 * 1. Fetch all encrypted blobs via `sessions.encrypt.reencrypt`
 * 2. Decrypt each blob with the old key
 * 3. Re-encrypt with the new key
 * 4. Push each re-encrypted blob back
 */
export async function reencryptSessions(
  client: GatewayBrowserClient,
  oldPassword: string,
  oldSaltHex: string,
  newPassword: string,
  newSaltHex: string,
): Promise<{ ok: boolean; reencrypted: number; failed: number }> {
  const oldKey = await deriveEncryptionKey(oldPassword, oldSaltHex);
  const newKey = await deriveEncryptionKey(newPassword, newSaltHex);

  const result = await client.request<{
    entries: Array<{ filename: string; encryptedData: string }>;
  }>("sessions.encrypt.reencrypt", {});

  if (!result?.entries?.length) {
    // Update the in-memory key to the new one
    encryptionKey = newKey;
    return { ok: true, reencrypted: 0, failed: 0 };
  }

  let reencrypted = 0;
  let failed = 0;

  for (const entry of result.entries) {
    try {
      const oldBlob = base64ToArrayBuffer(entry.encryptedData);
      const plaintext = await decryptTranscript(oldKey, oldBlob);
      const newBlob = await encryptTranscript(newKey, plaintext);
      const newBase64 = arrayBufferToBase64(newBlob);

      await client.request("sessions.encrypt.push", {
        filename: entry.filename,
        encryptedData: newBase64,
      });
      reencrypted++;
    } catch (err) {
      console.warn(`[crypto] Failed to re-encrypt ${entry.filename}:`, err);
      failed++;
    }
  }

  // Update the in-memory key to the new one
  encryptionKey = newKey;
  return { ok: failed === 0, reencrypted, failed };
}
