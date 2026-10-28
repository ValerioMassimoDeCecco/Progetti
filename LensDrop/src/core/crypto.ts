/**
 * Primitive crittografiche basate esclusivamente su Web Crypto (HTTPS richiesto).
 *
 * Modello: il codice di sessione (60 bit) è il segreto condiviso. Da esso si deriva
 * una chiave HMAC non estraibile, usata per un handshake challenge/response.
 * Chi non conosce il codice non può né ricevere né inviare contenuti, anche se
 * scopre l'identificativo PeerJS della sessione.
 */

import { encodeBase32, CODE_LENGTH } from "./base32";
import type { Bytes } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Byte UTF-8 su buffer standard (Web Crypto non accetta SharedArrayBuffer). */
export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Genera un codice di sessione casuale di 12 caratteri Base32 (60 bit). */
export function generateCode(): string {
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  return encodeBase32(random, CODE_LENGTH);
}

export function randomNonce(bytes = 16): Uint8Array {
  const nonce = new Uint8Array(bytes);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Deriva la chiave HMAC della sessione dal codice tramite HKDF-SHA256.
 * La chiave è non estraibile: non può essere letta da script né loggata.
 */
export async function deriveSessionKey(code: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    utf8(`lensdrop/session/v1/${code}`),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8("lensdrop-hkdf-salt-v1"),
      info: utf8("lensdrop hmac auth v1"),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

export async function hmacBase64Url(key: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", key, utf8(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** Confronto a tempo costante tra due stringhe Base64URL. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** SHA-256 di un buffer singolo, in esadecimale minuscolo. */
export async function sha256Hex(data: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export function supportsWebCrypto(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}
