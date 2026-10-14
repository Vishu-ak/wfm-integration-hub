import { createHmac, timingSafeEqual } from "node:crypto";

/** Signs `<timestamp>.<body>` with HMAC-SHA256, the same scheme Stripe-style webhooks use. */
export function sign(secret: string, timestamp: number, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Verifies a signature in constant time and rejects stale timestamps,
 * so a captured request cannot be replayed later.
 */
export function verify(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Constant-time comparison for bearer tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
