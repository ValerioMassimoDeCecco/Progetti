/**
 * Formato dei frame ottici.
 *
 * Ogni frame è un codice QR il cui testo è `LD2` + Base45(dati binari).
 * Tre tipi di frame, tutti con un'intestazione di 5–7 byte che include
 * l'identificativo di sessione (così frame di sessioni diverse non si mescolano):
 *
 *   M  meta    : sessione u16 | lunghezza u16 | JSON con nome, dimensione, k, hash
 *   B  blocco  : sessione u16 | indice u32 | byte del blocco
 *   R  ripar.  : sessione u16 | seed u32   | simbolo fountain
 *
 * I meta vengono ripetuti periodicamente: chi si sintonizza a metà flusso
 * capisce comunque cosa sta ricevendo.
 */

import { decodeBase45, encodeBase45 } from "./base45";
import { concatBytes, readU16, readU32, toBytes, u16, u32, type Bytes } from "./bytes";

export const FRAME_PREFIX = "LD2";
export const FRAME_TYPE_META = 0x4d;
export const FRAME_TYPE_BLOCK = 0x42;
export const FRAME_TYPE_REPAIR = 0x52;

/** Oltre questa lunghezza il codice QR diventa irriconoscibile e il testo è sospetto. */
const MAX_FRAME_CHARS = 7900;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SessionMeta {
  /** Versione del formato del payload. */
  version: number;
  sessionId: number;
  name: string;
  itemCount: number;
  /** Dimensione del payload inviato (già compresso se `compressed`). */
  size: number;
  blockSize: number;
  /** Numero di blocchi. */
  k: number;
  /** SHA-256 del payload, esadecimale. */
  hash: string;
  compressed: boolean;
}

export type Frame =
  | { kind: "meta"; meta: SessionMeta }
  | { kind: "block"; sessionId: number; index: number; data: Bytes }
  | { kind: "repair"; sessionId: number; seed: number; data: Bytes };

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

function metaToJson(meta: SessionMeta): string {
  return JSON.stringify({
    v: meta.version,
    n: meta.name,
    i: meta.itemCount,
    z: meta.size,
    b: meta.blockSize,
    k: meta.k,
    h: meta.hash,
    c: meta.compressed ? 1 : 0,
  });
}

export function encodeFrame(frame: Frame): string {
  if (frame.kind === "meta") {
    const json = encoder.encode(metaToJson(frame.meta));
    const body = concatBytes([u16(frame.meta.sessionId), u16(json.byteLength), json]);
    return FRAME_PREFIX + encodeBase45(concatBytes([new Uint8Array([FRAME_TYPE_META]), body]));
  }

  const header =
    frame.kind === "block"
      ? concatBytes([new Uint8Array([FRAME_TYPE_BLOCK]), u16(frame.sessionId), u32(frame.index)])
      : concatBytes([new Uint8Array([FRAME_TYPE_REPAIR]), u16(frame.sessionId), u32(frame.seed)]);

  return FRAME_PREFIX + encodeBase45(concatBytes([header, frame.data]));
}

function parseMeta(json: string, sessionId: number): SessionMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new FrameError("Metadati illeggibili.");
  }
  if (typeof raw !== "object" || raw === null) throw new FrameError("Metadati non validi.");
  const record = raw as Record<string, unknown>;

  const name = typeof record["n"] === "string" ? record["n"].slice(0, 180) : "";
  const size = record["z"];
  const blockSize = record["b"];
  const k = record["k"];
  const hash = record["h"];

  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) throw new FrameError("Dimensione non valida.");
  if (typeof blockSize !== "number" || !Number.isInteger(blockSize) || blockSize < 64 || blockSize > 4096) {
    throw new FrameError("Dimensione blocco non valida.");
  }
  if (typeof k !== "number" || !Number.isInteger(k) || k <= 0 || k > 2_000_000) {
    throw new FrameError("Numero di blocchi non valido.");
  }
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw new FrameError("Checksum non valido.");

  return {
    version: typeof record["v"] === "number" ? record["v"] : 1,
    sessionId,
    name: name || "lensdrop",
    itemCount: typeof record["i"] === "number" && record["i"] > 0 ? Math.floor(record["i"]) : 1,
    size,
    blockSize,
    k,
    hash,
    compressed: record["c"] === 1,
  };
}

/**
 * Interpreta il testo letto da un QR.
 * Restituisce `null` se il codice non appartiene a LensDrop (altri QR nello
 * stesso ambiente non devono produrre errori), solleva `FrameError` se il codice
 * è nostro ma corrotto.
 */
export function decodeFrame(text: string): Frame | null {
  const value = text.trim();
  if (!value.startsWith(FRAME_PREFIX)) return null;
  if (value.length > MAX_FRAME_CHARS) throw new FrameError("Frame troppo grande.");

  let body: Bytes;
  try {
    body = toBytes(decodeBase45(value.slice(FRAME_PREFIX.length)));
  } catch (error) {
    throw new FrameError(error instanceof Error ? `Base45 non valido: ${error.message}` : "Base45 non valido.");
  }
  if (body.byteLength < 7) throw new FrameError("Frame troncato.");

  const type = body[0];
  const sessionId = readU16(body, 1);

  if (type === FRAME_TYPE_META) {
    if (body.byteLength < 5) throw new FrameError("Metadati troncati.");
    const jsonLength = readU16(body, 3);
    if (jsonLength === 0 || 5 + jsonLength > body.byteLength) throw new FrameError("Metadati troncati.");
    const meta = parseMeta(decoder.decode(body.subarray(5, 5 + jsonLength)), sessionId);
    return { kind: "meta", meta };
  }

  if (type === FRAME_TYPE_BLOCK) {
    return { kind: "block", sessionId, index: readU32(body, 3), data: body.slice(7) };
  }

  if (type === FRAME_TYPE_REPAIR) {
    return { kind: "repair", sessionId, seed: readU32(body, 3), data: body.slice(7) };
  }

  throw new FrameError("Tipo di frame sconosciuto.");
}

/** Lunghezza esatta del testo QR per un blocco di `blockSize` byte. */
export function frameChars(blockSize: number): number {
  const bytes = blockSize + 7;
  return FRAME_PREFIX.length + Math.floor(bytes / 2) * 3 + (bytes % 2 === 0 ? 0 : 2);
}
