/**
 * Piccoli helper sui byte: tutte le API restituiscono `Uint8Array<ArrayBuffer>`,
 * che è il tipo accettato da Web Crypto e dai costruttori di Blob.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

export function toBytes(view: Uint8Array): Bytes {
  if (view.buffer instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view as Bytes;
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

export function concatBytes(chunks: Uint8Array[]): Bytes {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Intero little-endian a 16 bit, usato per identificatori di sessione. */
export function u16(value: number): Bytes {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value & 0xffff, true);
  return out;
}

/** Intero little-endian a 32 bit, usato per indici di blocco e seed. */
export function u32(value: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

export function readU16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** Identificativo casuale a 16 bit: distingue sessioni consecutive. */
export function randomU16(): number {
  const buffer = new Uint16Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

/** Seed casuale a 32 bit per i simboli di riparazione. */
export function randomU32(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

/** Confronto a tempo costante fra due sequenze di byte. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}
