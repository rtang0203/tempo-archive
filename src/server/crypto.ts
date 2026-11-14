import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(name: "TOKEN_KEY" | "SESSION_SECRET"): Buffer {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  const k = Buffer.from(v, "base64");
  if (k.length < 32) throw new Error(`${name} must be at least 32 bytes (base64)`);
  return k.subarray(0, 32);
}

/** AES-256-GCM; output is base64url(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("TOKEN_KEY"), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function decrypt(sealed: string): string {
  const buf = Buffer.from(sealed, "base64url");
  const d = createDecipheriv("aes-256-gcm", key("TOKEN_KEY"), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** `value.signature` with HMAC-SHA256; `unsign` returns null for anything tampered. */
export function sign(value: string): string {
  return `${value}.${createHmac("sha256", key("SESSION_SECRET")).update(value).digest("base64url")}`;
}

export function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i);
  const expected = Buffer.from(sign(value));
  const got = Buffer.from(signed);
  return expected.length === got.length && timingSafeEqual(expected, got) ? value : null;
}
