import { describe, expect, it } from "vitest";

import { buildBundle, parseBundle, sanitizeName } from "../src/core/bundle";

const encoder = new TextEncoder();

describe("bundle multi-file", () => {
  it("conserva nomi, tipi e contenuto", () => {
    const payload = buildBundle([
      { name: "foto.jpg", mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) },
      { name: "nota.txt", mime: "text/plain", data: encoder.encode("ciao mondo") as Uint8Array<ArrayBuffer> },
    ]);

    const items = parseBundle(payload);
    expect(items).toHaveLength(2);
    expect(items[0]?.name).toBe("foto.jpg");
    expect(items[0]?.mime).toBe("image/jpeg");
    expect(Array.from(items[0]?.data ?? [])).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(items[1]?.data)).toBe("ciao mondo");
  });

  it("neutralizza i nomi pericolosi ricevuti dalla rete ottica", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeName("cartella\\file.txt")).toBe("cartella_file.txt");
    expect(sanitizeName("")).toBe("file");
    expect(sanitizeName("...")).toBe("file");

    const payload = buildBundle([{ name: "../../malevolo.sh", mime: "text/x-sh", data: new Uint8Array(1) }]);
    expect(parseBundle(payload)[0]?.name).toBe("_.._malevolo.sh");
  });

  it("rifiuta payload troncati o non riconosciuti", () => {
    expect(() => parseBundle(new Uint8Array([1, 2, 3]))).toThrow(/corto|riconosciuto/);
    expect(() => parseBundle(encoder.encode("XXXX\x01\x00") as Uint8Array<ArrayBuffer>)).toThrow(/riconosciuto/);

    const payload = buildBundle([{ name: "a.bin", mime: "application/octet-stream", data: new Uint8Array(64) }]);
    expect(() => parseBundle(payload.slice(0, payload.length - 10))).toThrow(/troncato|coerente/);
  });

  it("rifiuta un contenitore vuoto", () => {
    expect(() => buildBundle([])).toThrow(/Nessun contenuto/);
  });
});
