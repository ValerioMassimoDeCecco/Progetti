import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveSessionKey,
  generateCode,
  hmacBase64Url,
  safeEqual,
  sha256Hex,
} from "../src/core/crypto";
import { isValidCode } from "../src/core/base32";

describe("crypto", () => {
  it("genera codici validi e statisticamente distinti", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(isValidCode(code)).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });

  it("deriva la stessa chiave dallo stesso codice e chiavi diverse da codici diversi", async () => {
    const keyA = await deriveSessionKey("ABCDEFGHJKMN");
    const keyB = await deriveSessionKey("ABCDEFGHJKMN");
    const keyC = await deriveSessionKey("ABCDEFGHJKMP");

    const message = "lensdrop-auth-v1|sender|ABCDEFGHJKMN|nonce";
    const macA = await hmacBase64Url(keyA, message);
    const macB = await hmacBase64Url(keyB, message);
    const macC = await hmacBase64Url(keyC, message);

    expect(macA).toBe(macB);
    expect(macA).not.toBe(macC);
    expect(macA).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("confronta in modo corretto le firme", async () => {
    const key = await deriveSessionKey("ABCDEFGHJKMN");
    const mac = await hmacBase64Url(key, "payload");
    expect(safeEqual(mac, mac)).toBe(true);
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(safeEqual(mac, flipped)).toBe(false);
    expect(safeEqual("corto", "più lungo")).toBe(false);
  });

  it("calcola SHA-256 coerente con node:crypto", async () => {
    const data = new TextEncoder().encode("LensDrop test payload");
    const expected = createHash("sha256").update(data).digest("hex");
    expect(await sha256Hex(data)).toBe(expected);
  });

  it("non espone la chiave derivata (non estraibile)", async () => {
    const key = await deriveSessionKey("ABCDEFGHJKMN");
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeDefined();
  });
});
