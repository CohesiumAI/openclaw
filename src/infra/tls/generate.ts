/**
 * Native Node.js self-signed certificate generation using node:crypto.
 * Replaces the previous openssl CLI dependency.
 * Uses RSA 2048-bit key with SAN for localhost, 127.0.0.1, ::1.
 */

import { generateKeyPairSync, createSign, randomBytes } from "node:crypto";

// --- ASN.1 DER encoding helpers ---

function encodeLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  if (len < 0x100) {
    return Buffer.from([0x81, len]);
  }
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derSequence(items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), encodeLength(content.length), content]);
}

function derSet(items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x31]), encodeLength(content.length), content]);
}

function derOid(oid: number[]): Buffer {
  const first = oid[0] * 40 + oid[1];
  const rest: number[] = [];
  for (let i = 2; i < oid.length; i++) {
    let val = oid[i];
    if (val < 128) {
      rest.push(val);
    } else {
      const bytes: number[] = [];
      while (val > 0) {
        bytes.unshift(val & 0x7f);
        val >>= 7;
      }
      for (let j = 0; j < bytes.length - 1; j++) {
        bytes[j] |= 0x80;
      }
      rest.push(...bytes);
    }
  }
  const body = Buffer.from([first, ...rest]);
  return Buffer.concat([Buffer.from([0x06]), encodeLength(body.length), body]);
}

function derUtf8String(str: string): Buffer {
  const buf = Buffer.from(str, "utf8");
  return Buffer.concat([Buffer.from([0x0c]), encodeLength(buf.length), buf]);
}

function derInteger(value: Buffer): Buffer {
  // Ensure positive by prepending 0x00 if high bit set
  const needsPad = value[0] & 0x80;
  const body = needsPad ? Buffer.concat([Buffer.from([0x00]), value]) : value;
  return Buffer.concat([Buffer.from([0x02]), encodeLength(body.length), body]);
}

function derBitString(content: Buffer): Buffer {
  // Prepend unused-bits byte (0)
  const body = Buffer.concat([Buffer.from([0x00]), content]);
  return Buffer.concat([Buffer.from([0x03]), encodeLength(body.length), body]);
}

function derOctetString(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), encodeLength(content.length), content]);
}

function derExplicit(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xa0 | tag]), encodeLength(content.length), content]);
}

function derGeneralizedTime(date: Date): Buffer {
  const s = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  const buf = Buffer.from(s, "ascii");
  return Buffer.concat([Buffer.from([0x18]), encodeLength(buf.length), buf]);
}

// --- OIDs ---

const OID_CN = [2, 5, 4, 3];
const OID_SHA256_RSA = [1, 2, 840, 113549, 1, 1, 11];
const OID_RSA_ENCRYPTION = [1, 2, 840, 113549, 1, 1, 1];
const OID_SUBJECT_ALT_NAME = [2, 5, 29, 17];

// --- SAN encoding ---

function encodeSanDnsName(name: string): Buffer {
  const buf = Buffer.from(name, "ascii");
  return Buffer.concat([Buffer.from([0x82]), encodeLength(buf.length), buf]);
}

function encodeSanIpAddress(ip: string): Buffer {
  let buf: Buffer;
  if (ip.includes(":")) {
    // IPv6 — parse ::1
    const parts = ip.split(":").map((p) => (p === "" ? "0" : p));
    // Expand :: shorthand
    const expanded: string[] = [];
    for (const part of parts) {
      if (part === "0" && expanded.length < 8) {
        expanded.push("0000");
      } else {
        expanded.push(part.padStart(4, "0"));
      }
    }
    while (expanded.length < 8) {
      expanded.splice(expanded.indexOf("0000"), 0, "0000");
    }
    buf = Buffer.from(expanded.join(""), "hex");
  } else {
    // IPv4
    buf = Buffer.from(ip.split(".").map(Number));
  }
  return Buffer.concat([Buffer.from([0x87]), encodeLength(buf.length), buf]);
}

function buildSanExtension(): Buffer {
  const names = Buffer.concat([
    encodeSanDnsName("localhost"),
    encodeSanIpAddress("127.0.0.1"),
    encodeSanIpAddress("::1"),
  ]);
  const sanSequence = derSequence([names]);
  // Not critical
  return derSequence([derOid(OID_SUBJECT_ALT_NAME), derOctetString(sanSequence)]);
}

// --- Certificate generation ---

export type SelfSignedResult = {
  certPem: string;
  keyPem: string;
};

/**
 * Generate a self-signed X.509 certificate using native Node.js crypto.
 * RSA 2048-bit, SHA256, 3650 days validity, SAN: localhost + 127.0.0.1 + ::1.
 */
export function generateSelfSignedCertNative(opts?: {
  days?: number;
  cn?: string;
}): SelfSignedResult {
  const days = opts?.days ?? 3650;
  const cn = opts?.cn ?? "openclaw-gateway";

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const pubKeyDer = publicKey as unknown as Buffer;

  // Serial number — 16 random bytes
  const serial = derInteger(randomBytes(16));

  // Signature algorithm
  const sigAlg = derSequence([derOid(OID_SHA256_RSA), Buffer.from([0x05, 0x00])]);

  // Issuer = Subject = CN=openclaw-gateway
  const rdnCn = derSet([derSequence([derOid(OID_CN), derUtf8String(cn)])]);
  const name = derSequence([rdnCn]);

  // Validity
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);
  const validity = derSequence([derGeneralizedTime(notBefore), derGeneralizedTime(notAfter)]);

  // Subject public key info
  const spki = derSequence([
    derSequence([derOid(OID_RSA_ENCRYPTION), Buffer.from([0x05, 0x00])]),
    derBitString(pubKeyDer),
  ]);

  // Extensions (v3) — SAN
  const extensions = derExplicit(3, derSequence([buildSanExtension()]));

  // TBS (to-be-signed) certificate
  const version = derExplicit(0, derInteger(Buffer.from([0x02]))); // v3
  const tbsCert = derSequence([version, serial, sigAlg, name, validity, name, spki, extensions]);

  // Sign TBS with private key
  const signer = createSign("SHA256");
  signer.update(tbsCert);
  const signature = signer.sign(privateKey);

  // Full certificate = SEQUENCE { tbsCert, sigAlg, signature }
  const cert = derSequence([tbsCert, sigAlg, derBitString(signature)]);

  // PEM encode
  const certPem =
    "-----BEGIN CERTIFICATE-----\n" +
    cert.toString("base64").replace(/(.{64})/g, "$1\n") +
    "\n-----END CERTIFICATE-----\n";

  return { certPem, keyPem: privateKey as string };
}
