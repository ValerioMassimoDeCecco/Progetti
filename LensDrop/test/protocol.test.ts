import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, PROTOCOL_VERSION } from "../src/config";
import {
  authPayload,
  frameChunk,
  parseChunk,
  parseMessage,
  sanitizeFileName,
  serialize,
  type Message,
  type OfferMessage,
} from "../src/core/protocol";

const SID = "ABCDEFGHJKMN";

function offer(overrides: Partial<OfferMessage> = {}): OfferMessage {
  return {
    t: "offer",
    v: PROTOCOL_VERSION,
    sid: SID,
    items: [{ id: "ABCD2345", name: "foto.jpg", size: 1024, mime: "image/jpeg" }],
    totalBytes: 1024,
    ...overrides,
  };
}

describe("protocollo — messaggi", () => {
  it("serializza e rilegge un'offerta valida", () => {
    const parsed = parseMessage(serialize(offer()));
    expect(parsed).not.toBeNull();
    expect(parsed?.t).toBe("offer");
    if (parsed?.t === "offer") {
      expect(parsed.items[0]?.name).toBe("foto.jpg");
      expect(parsed.totalBytes).toBe(1024);
    }
  });

  it("rifiuta JSON malformato, tipi sconosciuti e versioni diverse", () => {
    expect(parseMessage("{")).toBeNull();
    expect(parseMessage("null")).toBeNull();
    expect(parseMessage("[]")).toBeNull();
    expect(parseMessage(JSON.stringify({ t: "hack", v: 1, sid: SID }))).toBeNull();
    expect(parseMessage(JSON.stringify({ t: "accept", v: 99, sid: SID }))).toBeNull();
    expect(parseMessage(JSON.stringify({ t: "accept", v: 1, sid: "" }))).toBeNull();
  });

  it("rifiuta offerte incoerenti", () => {
    const base = offer();
    expect(parseMessage(serialize({ ...base, totalBytes: 999 }))).toBeNull();
    expect(parseMessage(serialize({ ...base, items: [] }))).toBeNull();
    expect(
      parseMessage(
        serialize({
          ...base,
          items: [
            { id: "ABCD2345", name: "a", size: 1, mime: "text/plain" },
            { id: "ABCD2345", name: "b", size: 1, mime: "text/plain" },
          ],
          totalBytes: 2,
        }),
      ),
    ).toBeNull();
    expect(
      parseMessage(
        serialize({
          ...base,
          items: [{ id: "minuscoli", name: "a", size: 1, mime: "text/plain" }],
          totalBytes: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseMessage(
        serialize({
          ...base,
          items: [{ id: "ABCD2345", name: "a", size: -1, mime: "text/plain" }],
          totalBytes: 0,
        }),
      ),
    ).toBeNull();
  });

  it("valida i campi di fine file", () => {
    const valid: Message = {
      t: "end",
      v: PROTOCOL_VERSION,
      sid: SID,
      id: "ABCD2345",
      index: 0,
      bytes: 10,
      sha256: "a".repeat(64),
    };
    expect(parseMessage(serialize(valid))?.t).toBe("end");

    expect(
      parseMessage(serialize({ ...valid, sha256: "non-un-hash" })),
    ).toBeNull();
    expect(parseMessage(serialize({ ...valid, index: -1 }))).toBeNull();
    expect(parseMessage(serialize({ ...valid, bytes: 1.5 }))).toBeNull();
  });

  it("valida i messaggi di verifica", () => {
    const base = { t: "verified", v: PROTOCOL_VERSION, sid: SID, id: "ABCD2345", ok: true };
    expect(parseMessage(JSON.stringify(base))?.t).toBe("verified");
    expect(parseMessage(JSON.stringify({ ...base, ok: "sì" }))).toBeNull();
    expect(parseMessage(JSON.stringify({ ...base, error: 42 }))).toBeNull();
  });

  it("costruisce un payload di autenticazione con ruolo, sessione e nonce", () => {
    expect(authPayload("sender", SID, "nonce-1")).toBe(`lensdrop-auth-v1|sender|${SID}|nonce-1`);
    expect(authPayload("receiver", SID, "a|b")).toContain("a|b");
  });
});

describe("protocollo — frame binari", () => {
  it("impacchetta e spacchetta un blocco", () => {
    const payload = new Uint8Array(CHUNK_SIZE).fill(7);
    const frame = frameChunk(3, 12, payload);
    expect(frame.byteLength).toBe(CHUNK_SIZE + 12);
    const chunk = parseChunk(frame);
    expect(chunk).not.toBeNull();
    expect(chunk?.index).toBe(3);
    expect(chunk?.seq).toBe(12);
    expect(chunk?.payload).toHaveLength(CHUNK_SIZE);
    expect(chunk?.payload[0]).toBe(7);
  });

  it("rifiuta frame con intestazione incoerente o dimensione eccessiva", () => {
    const payload = new Uint8Array(100).fill(1);
    const frame = frameChunk(0, 0, payload);
    const view = new DataView(frame);
    view.setUint32(8, 50);
    expect(parseChunk(frame)).toBeNull();

    expect(parseChunk(new ArrayBuffer(8))).toBeNull();

    expect(() => frameChunk(0, 0, new Uint8Array(CHUNK_SIZE + 1))).toThrow();

    const huge = new ArrayBuffer(CHUNK_SIZE + 13);
    expect(parseChunk(huge)).toBeNull();
  });
});

describe("protocollo — nomi file", () => {
  it("rimuove percorsi e caratteri pericolosi", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(sanitizeFileName("foto<con>caratteri*proibiti?.jpg")).toBe("foto_con_caratteri_proibiti_.jpg");
    expect(sanitizeFileName("con")).toBe("_con");
    expect(sanitizeFileName("   ")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("limita la lunghezza mantenendo l'estensione", () => {
    const long = `${"a".repeat(400)}.jpeg`;
    const safe = sanitizeFileName(long);
    expect(safe.length).toBeLessThanOrEqual(255);
    expect(safe.endsWith(".jpeg")).toBe(true);
  });

  it("preserva caratteri unicode legittimi", () => {
    expect(sanitizeFileName("Relazione finale è così.pdf")).toBe("Relazione finale è così.pdf");
  });
});
