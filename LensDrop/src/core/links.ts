/**
 * Collegamenti di sessione e identificativi PeerJS.
 * Separati dal livello WebRTC per poter essere testati senza browser.
 */

import { PEER_PREFIX } from "../config";

/** Identificativo PeerJS derivato dal codice: 12 caratteri Base32. */
export function peerIdForCode(code: string): string {
  return `${PEER_PREFIX}-${code.toLowerCase()}`;
}

/**
 * Link condivisibile/codificato nel QR: codice e scadenza vivono nel fragment,
 * che il browser non invia mai al server.
 */
export function buildSessionLink(baseUrl: string, code: string, expiresAt: number): string {
  const url = new URL(baseUrl);
  url.hash = `/join?c=${encodeURIComponent(code)}&e=${Math.floor(expiresAt / 1000)}`;
  return url.toString();
}

/** Estrae codice e scadenza da un link (o da una query string) LensDrop. */
export function parseSessionLink(input: string): { code: string; expiresAt: number } | null {
  const match = /[?&#]c=([0-9A-Za-z]{1,32})/.exec(input);
  if (!match) return null;
  const code = match[1]!.toUpperCase();
  if (!/^[0-9A-HJ-NP-TV-Z]{12}$/.test(code)) return null;
  const expiration = /[?&#]e=(\d{1,12})/.exec(input);
  return {
    code,
    expiresAt: expiration ? Number(expiration[1]) * 1000 : Number.POSITIVE_INFINITY,
  };
}
