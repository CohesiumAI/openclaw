import { describe, expect, it } from "vitest";
import {
  decryptCredentials,
  encryptCredentials,
  isEncryptedCredentials,
} from "./credentials-crypto.js";

const SAMPLE_JSON = JSON.stringify({
  version: 1,
  users: [{ username: "admin", passwordHash: "$scrypt$...", role: "admin" }],
});

describe("credentials-crypto", () => {
  it("encrypt then decrypt round-trips correctly", () => {
    const password = "strong-test-password";
    const encrypted = encryptCredentials(SAMPLE_JSON, password);
    const decrypted = decryptCredentials(encrypted, password);
    expect(decrypted).toBe(SAMPLE_JSON);
  });

  it("isEncryptedCredentials detects encrypted payloads", () => {
    const encrypted = encryptCredentials(SAMPLE_JSON, "pw");
    expect(isEncryptedCredentials(encrypted)).toBe(true);
    expect(isEncryptedCredentials(SAMPLE_JSON)).toBe(false);
    expect(isEncryptedCredentials("not json")).toBe(false);
  });

  it("decrypt with wrong password throws", () => {
    const encrypted = encryptCredentials(SAMPLE_JSON, "correct");
    expect(() => decryptCredentials(encrypted, "wrong")).toThrow();
  });

  it("each encryption produces different ciphertext (unique salt/IV)", () => {
    const pw = "same-password";
    const a = encryptCredentials(SAMPLE_JSON, pw);
    const b = encryptCredentials(SAMPLE_JSON, pw);
    expect(a).not.toBe(b);
    // But both decrypt to the same plaintext
    expect(decryptCredentials(a, pw)).toBe(SAMPLE_JSON);
    expect(decryptCredentials(b, pw)).toBe(SAMPLE_JSON);
  });
});
