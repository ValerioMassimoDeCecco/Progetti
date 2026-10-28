/**
 * Base32 in stile Crockford: alfabeto senza caratteri ambigui (I, L, O, U),
 * decodifica tollerante a minuscole, trattini e confusioni tipiche.
 * Usato per il codice di sessione leggibile a voce e a mano.
 */

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Lunghezza del codice di sessione: 12 caratteri = 60 bit di entropia. */
export const CODE_LENGTH = 12;

const CHAR_INDEX = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/** Converte i primi `chars` caratteri Base32 dei byte forniti. */
export function encodeBase32(bytes: Uint8Array, chars: number): string {
  if (chars <= 0) return "";
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    // Mantiene solo i bit non ancora consumati per evitare overflow a 32 bit.
    buffer &= bits > 0 ? (1 << bits) - 1 : 0;
    if (out.length >= chars) break;
  }

  if (out.length < chars && bits > 0) {
    out += ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return out.padEnd(chars, ALPHABET[0]);
}

function normalizeChar(char: string): string {
  const upper = char.toUpperCase();
  switch (upper) {
    case "O":
      return "0";
    case "I":
    case "L":
      return "1";
    case "U":
      return "V";
    default:
      return upper;
  }
}

/**
 * Normalizza un codice digitato o letto da QR: rimuove separatori e caratteri
 * non validi, corregge le confusioni più comuni.
 * Restituisce null se il codice non ha la lunghezza attesa o contiene simboli ignoti.
 */
export function normalizeCode(input: string): string | null {
  const cleaned = [...input.toUpperCase()]
    .filter((c) => c !== " " && c !== "-" && c !== "_" && c !== "." && c !== "/")
    .map(normalizeChar);

  // Accetta anche input con caratteri non validi interposti (es. un URL incollato).
  const valid = cleaned.filter((c) => CHAR_INDEX.has(c));
  if (valid.length !== CODE_LENGTH) return null;
  return valid.join("");
}

/** Raggruppa un codice normalizzato in blocchi da 4 per la lettura. */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CHAR_INDEX.has(c));
}

/** Decodifica un codice normalizzato nei byte originali (per derivare chiavi e ID). */
export function decodeBase32(code: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of code) {
    const value = CHAR_INDEX.get(char);
    if (value === undefined) throw new Error("Carattere non valido nel codice.");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    buffer &= bits > 0 ? (1 << bits) - 1 : 0;
  }
  return new Uint8Array(out);
}
