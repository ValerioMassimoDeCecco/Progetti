import { describe, expect, it } from "vitest";

import { Base45Error, decodeBase45, encodeBase45 } from "../src/core/base45";

describe("base45", () => {
  it("rispetta i vettori ufficiali di RFC 9285", () => {
    expect(encodeBase45(new TextEncoder().encode("AB"))).toBe("BB8");
    expect(encodeBase45(new TextEncoder().encode("Hello!!"))).toBe("%69 VD92EX0");
    expect(encodeBase45(new TextEncoder().encode("base-45"))).toBe("UJCLQE7W581");
    expect(encodeBase45(new TextEncoder().encode("ietf!"))).toBe("QED8WEX0");

    const decoder = new TextDecoder();
    expect(decoder.decode(decodeBase45("BB8"))).toBe("AB");
    expect(decoder.decode(decodeBase45("%69 VD92EX0"))).toBe("Hello!!");
    expect(decoder.decode(decodeBase45("UJCLQE7W581"))).toBe("base-45");
  });

  it("sopravvive a un round-trip su tutte le lunghezze", () => {
    for (let length = 0; length <= 300; length += 1) {
      const data = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) data[index] = (index * 37 + length) & 0xff;
      const encoded = encodeBase45(data);
      expect(encoded).toMatch(/^[0-9A-Z $%*+\-./:]*$/);
      expect(Array.from(decodeBase45(encoded))).toEqual(Array.from(data));
    }
  });

  it("copre tutti i valori di un byte", () => {
    const data = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) data[index] = index;
    expect(Array.from(decodeBase45(encodeBase45(data)))).toEqual(Array.from(data));
  });

  it("rifiuta input non validi", () => {
    expect(() => decodeBase45("A")).toThrow(Base45Error);
    expect(() => decodeBase45("ab!")).toThrow(Base45Error);
    expect(() => decodeBase45(":::")).toThrow(Base45Error);
  });
});
