import { describe, it, expect } from "vitest";
import {
  generateTotpSecret,
  buildTotpUri,
  verifyTotp,
  generateCurrentTotp,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
} from "./auth-totp.js";

describe("TOTP", () => {
  it("generates a base32 secret of expected length", () => {
    const secret = generateTotpSecret();
    // 20 bytes = 32 base32 chars
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBe(32);
  });

  it("builds a valid otpauth:// URI", () => {
    const secret = generateTotpSecret();
    const uri = buildTotpUri(secret, "alice");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(secret);
    expect(uri).toContain("OpenClaw");
    expect(uri).toContain("alice");
  });

  it("generates and verifies a current TOTP code", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateCurrentTotp(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    const result = verifyTotp(secret, code, undefined, now);
    expect(result).toBe(code);
  });

  it("verifies code within ±1 window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    // Generate code for previous period
    const prevCode = generateCurrentTotp(secret, now - 30_000);
    const result = verifyTotp(secret, prevCode, undefined, now);
    expect(result).toBe(prevCode);
  });

  it("rejects code outside window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    // Generate code for 3 periods ago (outside ±1)
    const oldCode = generateCurrentTotp(secret, now - 90_000);
    const result = verifyTotp(secret, oldCode, undefined, now);
    expect(result).toBeNull();
  });

  it("rejects replay of lastUsedCode", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateCurrentTotp(secret, now);
    // First use succeeds
    expect(verifyTotp(secret, code, undefined, now)).toBe(code);
    // Replay fails
    expect(verifyTotp(secret, code, code, now)).toBeNull();
  });

  it("rejects malformed codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "abc")).toBeNull();
    expect(verifyTotp(secret, "12345")).toBeNull();
    expect(verifyTotp(secret, "1234567")).toBeNull();
  });
});

describe("backup codes", () => {
  it("generates 10 unique codes by default", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
    }
  });

  it("generates custom count", () => {
    const codes = generateBackupCodes(5);
    expect(codes).toHaveLength(5);
  });

  it("hashes and verifies backup codes", async () => {
    const codes = generateBackupCodes(3);
    const hashes = await hashBackupCodes(codes);
    expect(hashes).toHaveLength(3);

    // Valid code
    const idx = await verifyBackupCode(codes[1], hashes);
    expect(idx).toBe(1);

    // Invalid code
    const badIdx = await verifyBackupCode("XXXXXXXX", hashes);
    expect(badIdx).toBe(-1);
  });

  it("verifies case-insensitively", async () => {
    const codes = generateBackupCodes(1);
    const hashes = await hashBackupCodes(codes);
    const idx = await verifyBackupCode(codes[0].toLowerCase(), hashes);
    expect(idx).toBe(0);
  });
});
