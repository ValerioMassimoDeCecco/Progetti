import { describe, expect, it } from "vitest";
import { buildSessionLink, parseSessionLink, peerIdForCode } from "../src/core/links";
import { interpretPayload } from "../src/ui/scanner";

const CODE = "ABCDEFGHJKMN";

describe("link di sessione", () => {
  it("deriva un identificativo PeerJS valido e univoco dal codice", () => {
    expect(peerIdForCode(CODE)).toBe("lensdrop-abcdefghjkmn");
    expect(peerIdForCode("ABCDEFGHJKMP")).not.toBe(peerIdForCode(CODE));
    expect(peerIdForCode(CODE)).toMatch(/^[a-z0-9-]+$/);
  });

  it("costruisce un link con codice e scadenza nel fragment", () => {
    const expiresAt = Date.UTC(2030, 0, 1);
    const link = buildSessionLink("https://example.com/Progetti/LensDrop/", CODE, expiresAt);
    const url = new URL(link);
    expect(url.pathname).toBe("/Progetti/LensDrop/");
    expect(url.hash.startsWith("#/join?")).toBe(true);
    expect(url.search).toBe("");

    const parsed = parseSessionLink(link);
    expect(parsed?.code).toBe(CODE);
    expect(parsed?.expiresAt).toBe(expiresAt);
  });

  it("accetta query string senza percorso e rifiuta codici non validi", () => {
    expect(parseSessionLink("?c=abcdefghjkmn")?.code).toBe(CODE);
    expect(parseSessionLink("?c=abc")).toBeNull();
    expect(parseSessionLink("?c=AAAAAAAAAAAA")?.code).toBe("AAAAAAAAAAAA");
    expect(parseSessionLink("https://example.com/#/join")?.code).toBeUndefined();
    expect(parseSessionLink("niente da leggere")).toBeNull();
  });
});

describe("lettura del QR", () => {
  it("riconosce un link LensDrop con scadenza", () => {
    const link = buildSessionLink("https://example.com/app/", CODE, Date.UTC(2030, 5, 3, 12, 0));
    const result = interpretPayload(link);
    expect(result?.code).toBe(CODE);
    expect(result?.expiresAt).toBe(Date.UTC(2030, 5, 3, 12, 0));
  });

  it("riconosce un codice digitato o stampato", () => {
    expect(interpretPayload("abcd-efgh-jkmn")?.code).toBe(CODE);
    expect(interpretPayload("  ABCD EFGH JKMN  ")?.code).toBe(CODE);
    expect(interpretPayload(CODE)?.expiresAt).toBeNull();
  });

  it("rifiuta payload estranei o troppo lunghi", () => {
    expect(interpretPayload("https://youtube.com/watch?v=123456789012")).toBeNull();
    expect(interpretPayload("testo qualsiasi")).toBeNull();
    expect(interpretPayload("A".repeat(5000))).toBeNull();
  });
});
