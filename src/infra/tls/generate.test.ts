import { X509Certificate } from "node:crypto";
import { describe, it, expect } from "vitest";
import { generateSelfSignedCertNative } from "./generate.js";

describe("generateSelfSignedCertNative", () => {
  it("generates valid PEM cert and key", () => {
    const { certPem, keyPem } = generateSelfSignedCertNative();
    expect(certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(certPem).toContain("-----END CERTIFICATE-----");
    expect(keyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(keyPem).toContain("-----END PRIVATE KEY-----");
  });

  it("cert is parseable by X509Certificate", () => {
    const { certPem } = generateSelfSignedCertNative();
    const x509 = new X509Certificate(certPem);
    expect(x509.subject).toContain("CN=openclaw-gateway");
    expect(x509.issuer).toContain("CN=openclaw-gateway");
  });

  it("cert has a SHA256 fingerprint", () => {
    const { certPem } = generateSelfSignedCertNative();
    const x509 = new X509Certificate(certPem);
    expect(x509.fingerprint256).toBeTruthy();
    expect(x509.fingerprint256.length).toBeGreaterThan(10);
  });

  it("cert contains SAN with localhost", () => {
    const { certPem } = generateSelfSignedCertNative();
    const x509 = new X509Certificate(certPem);
    const san = x509.subjectAltName ?? "";
    expect(san).toContain("localhost");
  });

  it("cert validity spans ~3650 days by default", () => {
    const { certPem } = generateSelfSignedCertNative();
    const x509 = new X509Certificate(certPem);
    const notBefore = new Date(x509.validFrom);
    const notAfter = new Date(x509.validTo);
    const diffDays = (notAfter.getTime() - notBefore.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(3649);
    expect(diffDays).toBeLessThanOrEqual(3651);
  });

  it("accepts custom CN and days", () => {
    const { certPem } = generateSelfSignedCertNative({ cn: "test-cn", days: 30 });
    const x509 = new X509Certificate(certPem);
    expect(x509.subject).toContain("CN=test-cn");
    const notBefore = new Date(x509.validFrom);
    const notAfter = new Date(x509.validTo);
    const diffDays = (notAfter.getTime() - notBefore.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it("cert can be used to create a TLS context", () => {
    const { certPem, keyPem } = generateSelfSignedCertNative();
    // Should not throw
    const tls = require("node:tls");
    const ctx = tls.createSecureContext({ cert: certPem, key: keyPem });
    expect(ctx).toBeTruthy();
  });
});
