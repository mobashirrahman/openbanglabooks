import "server-only";

/**
 * Tokens for other services, sealed before they reach the database:
 * AES-256-GCM with a key only this server holds (CONNECTIONS_KEY, 32 bytes,
 * base64). The additional data binds a sealed value to one reader and one
 * purpose, so a value copied to another row does not open.
 *
 * Format: "v1." + base64url(iv[12] | ciphertext | tag[16]).
 */

let key: Promise<CryptoKey> | null = null;

export class SealError extends Error {}

export function connectionsConfigured(): boolean {
  const raw = process.env.CONNECTIONS_KEY;
  return !!raw && Buffer.from(raw, "base64").byteLength === 32;
}

function getKey(): Promise<CryptoKey> {
  if (!key) {
    const raw = process.env.CONNECTIONS_KEY;
    const bytes = raw ? Buffer.from(raw, "base64") : null;
    if (!bytes || bytes.byteLength !== 32) throw new SealError("CONNECTIONS_KEY must be 32 bytes, base64 encoded");
    key = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return key;
}

const encoder = new TextEncoder();

export async function seal(value: unknown, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(value));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(context) }, await getKey(), data));
  const out = new Uint8Array(iv.byteLength + sealed.byteLength);
  out.set(iv);
  out.set(sealed, iv.byteLength);
  return `v1.${Buffer.from(out).toString("base64url")}`;
}

export async function open<T>(sealed: string, context: string): Promise<T> {
  if (!sealed.startsWith("v1.")) throw new SealError("unknown format");
  const bytes = Buffer.from(sealed.slice(3), "base64url");
  if (bytes.byteLength < 12 + 16) throw new SealError("too short");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: encoder.encode(context) },
      await getKey(),
      bytes.subarray(12),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new SealError("does not open");
  }
}
