/**
 * Contenitore del payload ottico: più elementi (file, testo, anteprime) in un
 * unico flusso, così una sessione trasferisce tutto in una volta sola.
 *
 * Formato (little-endian):
 *   "LDB1" | conteggio u16 | per ogni elemento: lunghezza nome u16, nome UTF-8,
 *   lunghezza MIME u16, MIME UTF-8, lunghezza dati u32, dati
 */

import { concatBytes, readU16, readU32, u16, u32, type Bytes } from "./bytes";

export interface BundleItem {
  name: string;
  mime: string;
  data: Bytes;
}

const MAGIC = "LDB1";
const MAX_ITEMS = 200;
const MAX_NAME_BYTES = 512;
const MAX_MIME_BYTES = 160;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/** Rimuove separatori di percorso e caratteri di controllo da un nome ricevuto. */
export function sanitizeName(name: string, fallback = "file"): string {
  const cleaned = name
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function buildBundle(items: BundleItem[]): Bytes {
  if (items.length === 0) throw new Error("Nessun contenuto da trasferire.");
  if (items.length > MAX_ITEMS) throw new Error(`Troppi elementi: massimo ${MAX_ITEMS}.`);

  const chunks: Uint8Array[] = [encoder.encode(MAGIC), u16(items.length)];

  for (const item of items) {
    const name = encoder.encode(sanitizeName(item.name));
    const mime = encoder.encode(item.mime.slice(0, MAX_MIME_BYTES));
    if (name.byteLength > MAX_NAME_BYTES) throw new Error("Nome file troppo lungo.");
    chunks.push(u16(name.byteLength), name, u16(mime.byteLength), mime, u32(item.data.byteLength), item.data);
  }

  return concatBytes(chunks);
}

export function parseBundle(payload: Uint8Array): BundleItem[] {
  if (payload.byteLength < 6) throw new Error("Payload troppo corto.");
  if (decoder.decode(payload.subarray(0, 4)) !== MAGIC) throw new Error("Formato del payload non riconosciuto.");

  let offset = 4;
  const count = readU16(payload, offset);
  offset += 2;
  if (count === 0 || count > MAX_ITEMS) throw new Error("Numero di elementi non valido.");

  const items: BundleItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const nameLength = readU16(payload, offset);
    offset += 2;
    if (nameLength > MAX_NAME_BYTES || offset + nameLength > payload.byteLength) throw new Error("Payload troncato.");
    const name = sanitizeName(decoder.decode(payload.subarray(offset, offset + nameLength)));
    offset += nameLength;

    if (offset + 2 > payload.byteLength) throw new Error("Payload troncato.");
    const mimeLength = readU16(payload, offset);
    offset += 2;
    if (mimeLength > MAX_MIME_BYTES || offset + mimeLength > payload.byteLength) throw new Error("Payload troncato.");
    const mime = decoder.decode(payload.subarray(offset, offset + mimeLength)) || "application/octet-stream";
    offset += mimeLength;

    if (offset + 4 > payload.byteLength) throw new Error("Payload troncato.");
    const dataLength = readU32(payload, offset);
    offset += 4;
    if (dataLength > payload.byteLength - offset) throw new Error("Lunghezza dei dati non coerente.");

    const data = payload.slice(offset, offset + dataLength);
    offset += dataLength;
    items.push({ name, mime, data });
  }

  return items;
}
