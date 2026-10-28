import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Sha256 } from "../src/core/sha256";

describe("Sha256 incrementale", () => {
  it("coincide con node:crypto per varie dimensioni e suddivisioni", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 1000, 16000, 100000]) {
      const data = randomBytes(size);
      const expected = createHash("sha256").update(data).digest("hex");
      const h = new Sha256();
      // feed in odd-sized pieces to exercise buffering
      let off = 0;
      while (off < size) { const n = Math.min(size - off, 1 + ((off * 7) % 999)); h.update(new Uint8Array(data.subarray(off, off + n))); off += n; }
      expect(h.digestHex(), `size ${size}`).toBe(expected);
    }
  });

  it("calcola i vettori noti di SHA-256", () => {
    expect(new Sha256().update(new Uint8Array(0)).digestHex()).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(new Sha256().update(new TextEncoder().encode("abc")).digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("non permette di riusare un digest già calcolato", () => {
    const hasher = new Sha256().update(new Uint8Array([1]));
    hasher.digestHex();
    expect(() => hasher.digestHex()).toThrow();
  });
});
