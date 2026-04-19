/** Shared utility functions. */

/** Generates a compact unique session ID (16 random bytes, base64url-encoded, 22 chars). */
export function generateId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64url",
  );
}

/** Returns the byte length of string or Buffer data. */
export function byteSize(data: string | Buffer): number {
  return typeof data === "string" ? data.length : data.byteLength;
}
