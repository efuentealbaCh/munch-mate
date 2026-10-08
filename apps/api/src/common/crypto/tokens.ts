import { createHash, randomBytes } from "node:crypto";

/** Generates an unguessable, URL-safe token (256 bits) for refresh sessions and one-time links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hashes a token for storage. SHA-256 (not argon2) is enough: tokens are random 256-bit values,
 * so there is nothing to brute-force, and lookups by hash must be fast.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
