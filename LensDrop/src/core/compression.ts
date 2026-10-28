/**
 * Compressione opzionale con `CompressionStream` (gzip), disponibile in tutti i
 * browser recenti. Serve perché il canale ottico è lentissimo: un testo o un PDF
 * si riducono tipicamente del 50–80%, cioè minuti di trasferimento in meno.
 * Se l'API non esiste o la compressione non conviene, si trasmette l'originale.
 */

import type { Bytes } from "./bytes";

export function compressionSupported(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function pump(readable: ReadableStream<Uint8Array>): Promise<Bytes> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Comprime con gzip; restituisce `null` se non disponibile o non conveniente. */
export async function gzip(data: Bytes): Promise<Bytes | null> {
  if (!compressionSupported()) return null;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = await pump(stream);
    // Sotto il 2% di guadagno il costo di decodifica non vale la pena.
    return compressed.byteLength < data.byteLength * 0.98 ? compressed : null;
  } catch {
    return null;
  }
}

export async function gunzip(data: Bytes): Promise<Bytes> {
  if (!compressionSupported()) throw new Error("Questo browser non supporta la decompressione gzip.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return pump(stream);
}
