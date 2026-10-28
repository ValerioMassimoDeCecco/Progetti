import { describe, expect, it } from "vitest";

import { decodeFrame, encodeFrame, frameChars, FrameError, type SessionMeta } from "../src/core/frame";

const meta: SessionMeta = {
  version: 1,
  sessionId: 4242,
  name: "vacanze.jpeg",
  itemCount: 2,
  size: 123456,
  blockSize: 900,
  k: 138,
  hash: "a".repeat(64),
  compressed: true,
};

describe("frame ottici", () => {
  it("codifica e rilegge i metadati", () => {
    const text = encodeFrame({ kind: "meta", meta });
    expect(text.startsWith("LD2")).toBe(true);
    expect(text).toMatch(/^[0-9A-Z $%*+\-./:]+$/);

    const frame = decodeFrame(text);
    expect(frame).toEqual({ kind: "meta", meta });
  });

  it("codifica e rilegge blocchi e riparazioni", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const block = decodeFrame(encodeFrame({ kind: "block", sessionId: 7, index: 99, data }));
    expect(block).toEqual({ kind: "block", sessionId: 7, index: 99, data });

    const repair = decodeFrame(encodeFrame({ kind: "repair", sessionId: 7, seed: 123456789, data }));
    expect(repair).toEqual({ kind: "repair", sessionId: 7, seed: 123456789, data });
  });

  it("mantiene intatto un blocco pieno da 2000 byte", () => {
    const data = new Uint8Array(2000);
    for (let index = 0; index < data.length; index += 1) data[index] = (index * 31) & 0xff;
    const frame = decodeFrame(encodeFrame({ kind: "block", sessionId: 1, index: 3, data }));
    expect(frame?.kind).toBe("block");
    if (frame?.kind === "block") expect(Array.from(frame.data)).toEqual(Array.from(data));
  });

  it("ignora i QR che non sono di LensDrop", () => {
    expect(decodeFrame("https://example.com")).toBeNull();
    expect(decodeFrame("WIFI:S:rete;T:WPA;P:segreta;;")).toBeNull();
  });

  it("rifiuta frame corrotti invece di interpretarli", () => {
    expect(() => decodeFrame("LD2")).toThrow(FrameError);
    expect(() => decodeFrame("LD2!!!")).toThrow(FrameError);
    expect(() => decodeFrame("LD2" + "AAAA")).toThrow(FrameError);

    const text = encodeFrame({ kind: "block", sessionId: 1, index: 0, data: new Uint8Array(64) });
    const corrupted = text.slice(0, -6) + "::::::";
    expect(() => decodeFrame(corrupted)).toThrow(FrameError);
  });

  it("stima la dimensione del testo QR in modo coerente", () => {
    const data = new Uint8Array(900);
    const text = encodeFrame({ kind: "block", sessionId: 1, index: 1, data });
    expect(Math.abs(text.length - frameChars(900))).toBeLessThanOrEqual(4);
  });
});
