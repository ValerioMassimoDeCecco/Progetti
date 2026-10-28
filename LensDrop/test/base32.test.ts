import { describe, expect, it } from "vitest";
import {
  ALPHABET,
  CODE_LENGTH,
  decodeBase32,
  encodeBase32,
  formatCode,
  isValidCode,
  normalizeCode,
} from "../src/core/base32";

describe("base32", () => {
  it("genera codici della lunghezza attesa usando solo l'alfabeto previsto", () => {
    const bytes = new Uint8Array([255, 128, 42, 7, 99, 12, 200, 1]);
    const code = encodeBase32(bytes, CODE_LENGTH);
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((char) => ALPHABET.includes(char))).toBe(true);
    expect(isValidCode(code)).toBe(true);
  });

  it("normalizza minuscole, separatori e caratteri ambigui", () => {
    expect(normalizeCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeCode("O0I1L1UVWXAB")).toBe("001111VVWXAB");
    expect(normalizeCode("ABCD EFGH JKMN")).toBe("ABCDEFGHJKMN");
  });

  it("rifiuta codici con lunghezza o simboli errati", () => {
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("ABCDEFGHJKMNN")).toBeNull();
  });

  it("raggruppa il codice in blocchi leggibili", () => {
    expect(formatCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });

  it("decodifica in modo coerente con la codifica", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const code = encodeBase32(bytes, CODE_LENGTH);
    const decoded = decodeBase32(code);
    expect(decoded).toHaveLength(7);
    expect([...decoded]).toEqual([...bytes.slice(0, 7)]);
  });
});
