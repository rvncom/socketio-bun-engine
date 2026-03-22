/** Shared utility functions. */

/** Generates a unique session ID using crypto.randomUUID(). */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Returns the byte length of string or Buffer data. */
export function byteSize(data: string | Buffer): number {
  return typeof data === "string" ? data.length : data.byteLength;
}
