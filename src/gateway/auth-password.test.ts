import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, isHashedPassword } from "./auth-password.js";

describe("auth-password", () => {
  it("hashPassword produces a PHC scrypt string", async () => {
    const hash = await hashPassword("test-password");
    expect(hash).toMatch(/^\$scrypt\$ln=\d+,r=\d+,p=\d+\$/);
  });

  it("verifyPassword succeeds for matching password", async () => {
    const hash = await hashPassword("my-secret");
    expect(await verifyPassword("my-secret", hash)).toBe(true);
  });

  it("verifyPassword rejects wrong password", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("verifyPassword rejects empty password", async () => {
    const hash = await hashPassword("notempty");
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("verifyPassword rejects malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "$scrypt$bad")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });

  it("different calls produce different salts", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
    // Both should still verify
    expect(await verifyPassword("same", h1)).toBe(true);
    expect(await verifyPassword("same", h2)).toBe(true);
  });

  it("isHashedPassword detects PHC hashes", () => {
    expect(isHashedPassword("$scrypt$ln=15,r=8,p=1$salt$hash")).toBe(true);
    expect(isHashedPassword("$argon2id$v=19$m=65536,t=3,p=4$salt$hash")).toBe(true);
    expect(isHashedPassword("plaintext-password")).toBe(false);
    expect(isHashedPassword("")).toBe(false);
  });
});
