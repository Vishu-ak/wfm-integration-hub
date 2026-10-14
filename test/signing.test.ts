import { describe, expect, it } from "vitest";
import { safeEqual, sign, verify } from "../src/signing.js";

describe("webhook signing", () => {
  const secret = "s3cret-s3cret-s3cret";
  const now = 1_800_000_000;

  it("accepts a fresh, correctly signed body", () => {
    expect(verify(secret, now, '{"a":1}', sign(secret, now, '{"a":1}'), 300, now)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verify(secret, now, '{"a":2}', sign(secret, now, '{"a":1}'), 300, now)).toBe(false);
  });

  it("rejects a replayed request outside the tolerance window", () => {
    expect(verify(secret, now - 600, "{}", sign(secret, now - 600, "{}"), 300, now)).toBe(false);
  });

  it("compares tokens safely regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
