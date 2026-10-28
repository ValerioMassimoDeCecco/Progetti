/**
 * Base45 (RFC 9285).
 *
 * Perché non Base64: l'alfabeto Base45 è esattamente quello della modalità
 * alfanumerica dei codici QR (`0-9 A-Z spazio $%*+-./:`). Un payload Base45
 * viene quindi codificato in modalità alfanumerica (11 bit ogni 2 caratteri)
 * invece che in modalità byte (8 bit per carattere): a parità di dimensione del
 * QR entrano circa il 35% di byte in più, e a parità di payload il codice è più
 * piccolo e più facile da mettere a fuoco.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const VALUES = new Int16Array(128).fill(-1);

for (let index = 0; index < ALPHABET.length; index += 1) {
  VALUES[ALPHABET.charCodeAt(index)] = index;
}

export class Base45Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base45Error";
  }
}

/** Codifica i byte in Base45: 2 byte → 3 caratteri (1 byte finale → 2 caratteri). */
export function encodeBase45(data: Uint8Array): string {
  let out = "";
  let index = 0;

  while (index + 1 < data.length) {
    const value = (data[index] ?? 0) * 256 + (data[index + 1] ?? 0);
    out += ALPHABET[value % 45] ?? "";
    out += ALPHABET[Math.floor(value / 45) % 45] ?? "";
    out += ALPHABET[Math.floor(value / 2025)] ?? "";
    index += 2;
  }

  if (index < data.length) {
    const value = data[index] ?? 0;
    out += ALPHABET[value % 45] ?? "";
    out += ALPHABET[Math.floor(value / 45)] ?? "";
  }

  return out;
}

/** Decodifica Base45; solleva `Base45Error` su caratteri o lunghezze non validi. */
export function decodeBase45(text: string): Uint8Array<ArrayBuffer> {
  const remainder = text.length % 3;
  if (remainder === 1) throw new Base45Error("Lunghezza Base45 non valida.");

  const byteLength = Math.floor(text.length / 3) * 2 + (remainder === 2 ? 1 : 0);
  const out = new Uint8Array(byteLength);
  let outIndex = 0;
  let index = 0;

  while (index + 2 < text.length) {
    const a = valueOf(text, index);
    const b = valueOf(text, index + 1);
    const c = valueOf(text, index + 2);
    const value = a + b * 45 + c * 2025;
    if (value > 0xffff) throw new Base45Error("Gruppo Base45 fuori intervallo.");
    out[outIndex] = value >> 8;
    out[outIndex + 1] = value & 0xff;
    outIndex += 2;
    index += 3;
  }

  if (index < text.length) {
    const a = valueOf(text, index);
    const b = valueOf(text, index + 1);
    const value = a + b * 45;
    if (value > 0xff) throw new Base45Error("Byte Base45 finale fuori intervallo.");
    out[outIndex] = value;
  }

  return out;
}

function valueOf(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const value = code < VALUES.length ? VALUES[code] : -1;
  if (value === undefined || value < 0) {
    throw new Base45Error(`Carattere non ammesso in Base45: "${text[index] ?? "?"}".`);
  }
  return value;
}
