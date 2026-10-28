/**
 * Protocollo applicativo di LensDrop.
 *
 * I messaggi di controllo viaggiano come stringhe JSON sul DataChannel WebRTC,
 * i contenuti come frame binari con intestazione di 12 byte.
 * Ogni messaggio in ingresso viene validato: campi sconosciuti, tipi errati,
 * sequenze fuori ordine o dimensioni fuori limite interrompono la sessione.
 */

import {
  CHUNK_HEADER_SIZE,
  CHUNK_SIZE,
  MAX_ITEMS,
  MAX_ITEM_BYTES,
  MAX_NAME_LENGTH,
  MAX_SESSION_BYTES,
  PROTOCOL_VERSION,
} from "../config";
import type { Bytes } from "./types";

export type MessageType =
  | "hello"
  | "welcome"
  | "offer"
  | "accept"
  | "reject"
  | "start"
  | "end"
  | "verified"
  | "done"
  | "cancel"
  | "ping"
  | "pong";

export interface ItemMeta {
  /** Identificativo casuale Base32 (8 caratteri) generato dal mittente. */
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface HelloMessage {
  t: "hello";
  v: number;
  sid: string;
  n: string;
  mac: string;
}

export interface WelcomeMessage {
  t: "welcome";
  v: number;
  sid: string;
  n: string;
  mac: string;
}

export interface OfferMessage {
  t: "offer";
  v: number;
  sid: string;
  items: ItemMeta[];
  totalBytes: number;
}

export interface AcceptMessage {
  t: "accept";
  v: number;
  sid: string;
}

export interface RejectMessage {
  t: "reject";
  v: number;
  sid: string;
  reason: string;
}

export interface StartMessage {
  t: "start";
  v: number;
  sid: string;
  id: string;
  index: number;
}

export interface EndMessage {
  t: "end";
  v: number;
  sid: string;
  id: string;
  index: number;
  bytes: number;
  sha256: string;
}

export interface VerifiedMessage {
  t: "verified";
  v: number;
  sid: string;
  id: string;
  ok: boolean;
  error?: string;
}

export interface DoneMessage {
  t: "done";
  v: number;
  sid: string;
}

export interface CancelMessage {
  t: "cancel";
  v: number;
  sid: string;
  reason: string;
}

export interface PingMessage {
  t: "ping";
  v: number;
  sid: string;
}

export interface PongMessage {
  t: "pong";
  v: number;
  sid: string;
}

export type Message =
  | HelloMessage
  | WelcomeMessage
  | OfferMessage
  | AcceptMessage
  | RejectMessage
  | StartMessage
  | EndMessage
  | VerifiedMessage
  | DoneMessage
  | CancelMessage
  | PingMessage
  | PongMessage;

export interface Chunk {
  index: number;
  seq: number;
  payload: Bytes;
}

const ITEM_ID_PATTERN = /^[0-9A-Z]{8}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  return value;
}

function readInteger(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

function readItemId(source: Record<string, unknown>): string | null {
  const value = source["id"];
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) return null;
  return value;
}

/** Valida i metadati di un elemento dichiarati dal mittente. */
export function parseItemMeta(value: unknown): ItemMeta | null {
  if (!isRecord(value)) return null;
  const id = readItemId(value);
  const name = readString(value, "name", MAX_NAME_LENGTH);
  const size = readInteger(value, "size", 0, MAX_ITEM_BYTES);
  const mime = value["mime"];
  if (id === null || name === null || size === null) return null;
  if (typeof mime !== "string" || mime.length > 200) return null;
  return { id, name, size, mime };
}

/** Converte un payload di rete in un messaggio validato, o null se non è conforme. */
export function parseMessage(raw: string): Message | null {
  if (raw.length > 512_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const type = parsed["t"];
  const version = readInteger(parsed, "v", 1, 1000);
  const sid = readString(parsed, "sid", 64);
  if (typeof type !== "string" || version !== PROTOCOL_VERSION || sid === null) return null;

  switch (type) {
    case "hello":
    case "welcome": {
      const n = readString(parsed, "n", 64);
      const mac = readString(parsed, "mac", 64);
      if (n === null || mac === null) return null;
      return { t: type, v: version, sid, n, mac };
    }
    case "offer": {
      const rawItems = parsed["items"];
      if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_ITEMS) {
        return null;
      }
      const items: ItemMeta[] = [];
      const seen = new Set<string>();
      let totalBytes = 0;
      for (const candidate of rawItems) {
        const item = parseItemMeta(candidate);
        if (item === null || seen.has(item.id)) return null;
        seen.add(item.id);
        totalBytes += item.size;
        if (totalBytes > MAX_SESSION_BYTES) return null;
        items.push(item);
      }
      const declaredTotal = readInteger(parsed, "totalBytes", 0, MAX_SESSION_BYTES);
      if (declaredTotal === null || declaredTotal !== totalBytes) return null;
      return { t: "offer", v: version, sid, items, totalBytes };
    }
    case "accept":
    case "done":
    case "ping":
    case "pong":
      return { t: type, v: version, sid };
    case "reject":
    case "cancel": {
      const reason = readString(parsed, "reason", 300);
      if (reason === null) return null;
      return { t: type, v: version, sid, reason };
    }
    case "start": {
      const id = readItemId(parsed);
      const index = readInteger(parsed, "index", 0, MAX_ITEMS - 1);
      if (id === null || index === null) return null;
      return { t: "start", v: version, sid, id, index };
    }
    case "end": {
      const id = readItemId(parsed);
      const index = readInteger(parsed, "index", 0, MAX_ITEMS - 1);
      const bytes = readInteger(parsed, "bytes", 0, MAX_ITEM_BYTES);
      const hash = parsed["sha256"];
      if (id === null || index === null || bytes === null) return null;
      if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) return null;
      return { t: "end", v: version, sid, id, index, bytes, sha256: hash };
    }
    case "verified": {
      const id = readItemId(parsed);
      if (id === null) return null;
      const ok = parsed["ok"];
      if (typeof ok !== "boolean") return null;
      const error = parsed["error"];
      if (error !== undefined && (typeof error !== "string" || error.length > 300)) return null;
      return error === undefined
        ? { t: "verified", v: version, sid, id, ok }
        : { t: "verified", v: version, sid, id, ok, error };
    }
    default:
      return null;
  }
}

export function serialize(message: Message): string {
  return JSON.stringify(message);
}

/**
 * Costruisce un frame binario: indice file (u32), sequenza (u32), lunghezza (u32) + dati.
 * Il buffer restituito è esattamente della dimensione del frame, così da poter
 * essere inviato senza copie aggiuntive.
 */
export function frameChunk(index: number, seq: number, payload: Bytes): ArrayBuffer {
  if (payload.length > CHUNK_SIZE) throw new Error("Blocco troppo grande.");
  const buffer = new ArrayBuffer(CHUNK_HEADER_SIZE + payload.length);
  const view = new DataView(buffer);
  view.setUint32(0, index);
  view.setUint32(4, seq);
  view.setUint32(8, payload.length);
  new Uint8Array(buffer, CHUNK_HEADER_SIZE).set(payload);
  return buffer;
}

/** Interpreta un frame binario verificandone intestazione e coerenza. */
export function parseChunk(buffer: ArrayBuffer): Chunk | null {
  if (buffer.byteLength <= CHUNK_HEADER_SIZE || buffer.byteLength > CHUNK_HEADER_SIZE + CHUNK_SIZE) {
    return null;
  }
  const view = new DataView(buffer);
  const index = view.getUint32(0);
  const seq = view.getUint32(4);
  const length = view.getUint32(8);
  if (length !== buffer.byteLength - CHUNK_HEADER_SIZE) return null;
  if (index >= MAX_ITEMS || seq > 10_000_000) return null;
  return { index, seq, payload: new Uint8Array(buffer, CHUNK_HEADER_SIZE, length) };
}

/** Testo firmato nell'handshake: lega ruolo, sessione e nonce. */
export function authPayload(role: "sender" | "receiver", sid: string, nonceB64: string): string {
  return `lensdrop-auth-v1|${role}|${sid}|${nonceB64}`;
}

const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * Rende sicuro un nome di file ricevuto: rimuove separatori di percorso e
 * caratteri di controllo, evita nomi riservati e limita la lunghezza.
 */
export function sanitizeFileName(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let cleaned = base.replace(FORBIDDEN_NAME_CHARS, "_").replace(/^\.+/, "").trim();
  if (cleaned.length === 0) cleaned = fallback;
  if (cleaned.length > MAX_NAME_LENGTH) {
    const dot = cleaned.lastIndexOf(".");
    const ext = dot > 0 ? cleaned.slice(dot).slice(0, 16) : "";
    cleaned = cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned;
}
