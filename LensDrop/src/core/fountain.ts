/**
 * Codice fountain di Luby (LT) su GF(2) — lo stesso schema usato da txqr e dagli
 * altri progetti di trasferimento ottico.
 *
 * Idea: il file viene tagliato in `k` blocchi. Ogni simbolo trasmesso è lo XOR
 * di un sottoinsieme di blocchi scelto da un seed. Il destinatario non deve
 * ricevere blocchi specifici: qualunque insieme di circa `k + O(sqrt(k) log²k)`
 * simboli indipendenti basta a ricostruire tutto. Un frame perso (mosso,
 * sfocato, riflesso) è quindi innocuo, e non serve alcun canale di ritorno.
 *
 * Il decodificatore usa il "peeling" (risoluzione iterativa dei simboli di grado
 * 1) e, quando il peeling si blocca vicino alla fine, completa con
 * un'eliminazione di Gauss su GF(2).
 */

import type { Bytes } from "./bytes";

/** Generatore congruenziale lineare: deterministico, veloce, identico ovunque. */
export function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    // Numeri di Marsaglia: 32 bit, nessuna dipendenza dalla piattaforma.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cdfCache = new Map<number, Float64Array>();
const MAX_CACHED_CDF = 6;

/**
 * Distribuzione "robust soliton": garantisce che il numero atteso di simboli
 * necessari resti vicino a `k` anche in presenza di perdite.
 */
function solitonCdf(k: number): Float64Array {
  const cached = cdfCache.get(k);
  if (cached) return cached;

  const delta = 0.5;
  const c = 0.1;
  const spike = c * Math.log(k / delta) * Math.sqrt(k);
  const rho = new Float64Array(k + 1);
  const tau = new Float64Array(k + 1);

  rho[1] = 1 / k;
  for (let degree = 2; degree <= k; degree += 1) rho[degree] = 1 / (degree * (degree - 1));

  const boundary = Math.max(1, Math.floor(k / spike));
  for (let degree = 1; degree < boundary && degree <= k; degree += 1) tau[degree] = 1 / (degree * spike);
  if (boundary <= k) tau[boundary] += Math.log(spike / delta) / spike;

  const cdf = new Float64Array(k + 1);
  let total = 0;
  for (let degree = 1; degree <= k; degree += 1) total += rho[degree] + tau[degree];
  let running = 0;
  for (let degree = 1; degree <= k; degree += 1) {
    running += (rho[degree] + tau[degree]) / total;
    cdf[degree] = running;
  }
  cdf[k] = 1;

  if (cdfCache.size >= MAX_CACHED_CDF) {
    const oldest = cdfCache.keys().next();
    if (!oldest.done) cdfCache.delete(oldest.value);
  }
  cdfCache.set(k, cdf);
  return cdf;
}

/** Indici dei blocchi combinati da un simbolo, dato il suo seed. */
export function symbolIndices(seed: number, k: number): number[] {
  if (k <= 1) return [0];

  const rng = makeRng(seed);
  const cdf = solitonCdf(k);
  const roll = rng();
  let degree = 1;
  while (degree < k && cdf[degree] < roll) degree += 1;

  const indices: number[] = [];
  const seen = new Set<number>();
  let guard = 0;
  while (indices.length < degree && guard < degree * 40 + 40) {
    const candidate = Math.min(k - 1, Math.floor(rng() * k));
    guard += 1;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    indices.push(candidate);
  }
  indices.sort((a, b) => a - b);
  return indices;
}

/** XOR in place: `target ^= source` (il target può essere più corto). */
export function xorInto(target: Uint8Array, source: Uint8Array): void {
  const length = Math.min(target.length, source.length);
  for (let index = 0; index < length; index += 1) {
    target[index] = (target[index] ?? 0) ^ (source[index] ?? 0);
  }
}

export function isZero(data: Uint8Array): boolean {
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== 0) return false;
  }
  return true;
}

/** Copia `data` in un blocco di dimensione fissa (l'ultimo blocco è più corto). */
function padTo(data: Uint8Array, size: number): Bytes {
  if (data.length === size) return data.slice(0, size) as Bytes;
  const out = new Uint8Array(size);
  out.set(data.subarray(0, Math.min(data.length, size)));
  return out;
}

interface Equation {
  unknowns: number[];
  data: Bytes;
}

export interface FountainStats {
  /** Blocchi ricostruiti. */
  solved: number;
  /** Blocchi totali (k). */
  total: number;
  /** Simboli accettati come nuove equazioni utili. */
  useful: number;
  /** Simboli scartati perché ridondanti. */
  redundant: number;
  /** Equazioni risolte con l'eliminazione di Gauss. */
  recoveredByGaussian: number;
}

/**
 * Decodificatore fountain: raccoglie simboli di sistema (`addSystematic`) e di
 * riparazione (`addRepair`) e ricostruisce i blocchi originali.
 */
export class FountainDecoder {
  private readonly blocks = new Map<number, Bytes>();
  private readonly pending: Equation[] = [];
  private readonly byUnknown = new Map<number, Set<Equation>>();
  private usefulCount = 0;
  private redundantCount = 0;
  private gaussianRecovered = 0;

  constructor(
    readonly k: number,
    readonly blockSize: number,
  ) {
    if (k <= 0) throw new Error("Il numero di blocchi deve essere positivo.");
    if (blockSize <= 0) throw new Error("La dimensione del blocco deve essere positiva.");
  }

  get solvedCount(): number {
    return this.blocks.size;
  }

  get complete(): boolean {
    return this.blocks.size >= this.k;
  }

  get stats(): FountainStats {
    return {
      solved: this.blocks.size,
      total: this.k,
      useful: this.usefulCount,
      redundant: this.redundantCount,
      recoveredByGaussian: this.gaussianRecovered,
    };
  }

  /** Blocchi ancora mancanti (per la diagnostica). */
  missing(limit = 24): number[] {
    const out: number[] = [];
    for (let index = 0; index < this.k && out.length < limit; index += 1) {
      if (!this.blocks.has(index)) out.push(index);
    }
    return out;
  }

  getBlock(index: number): Bytes | null {
    return this.blocks.get(index) ?? null;
  }

  /** Blocco di sistema: contiene esattamente il blocco `index`. */
  addSystematic(index: number, data: Uint8Array): void {
    if (index < 0 || index >= this.k) return;
    this.addEquation([index], data);
  }

  /** Simbolo di riparazione: XOR dei blocchi indicati dal seed. */
  addRepair(seed: number, data: Uint8Array): void {
    this.addEquation(symbolIndices(seed, this.k), data);
  }

  /** Equazione generica: utile nei test e per formati futuri. */
  addEquation(indices: number[], data: Uint8Array): void {
    const block = padTo(data, this.blockSize);
    const unknowns: number[] = [];
    const seen = new Set<number>();
    for (const index of indices) {
      if (index < 0 || index >= this.k || seen.has(index)) continue;
      seen.add(index);
      const known = this.blocks.get(index);
      if (known) xorInto(block, known);
      else unknowns.push(index);
    }
    unknowns.sort((a, b) => a - b);

    if (unknowns.length === 0) {
      // Equazione già soddisfatta: se il dato non è nullo, il simbolo è corrotto.
      this.redundantCount += 1;
      return;
    }

    this.usefulCount += 1;
    if (unknowns.length === 1) {
      this.solve(unknowns[0] as number, block);
      return;
    }

    const equation: Equation = { unknowns, data: block };
    this.pending.push(equation);
    for (const unknown of unknowns) {
      let set = this.byUnknown.get(unknown);
      if (!set) {
        set = new Set<Equation>();
        this.byUnknown.set(unknown, set);
      }
      set.add(equation);
    }
  }

  /** Risolve un blocco e propaga la soluzione alle equazioni che lo contengono. */
  private solve(index: number, data: Bytes): void {
    if (this.blocks.has(index)) return;
    this.blocks.set(index, data);

    const waiting = this.byUnknown.get(index);
    this.byUnknown.delete(index);
    if (!waiting) return;

    const queue: Equation[] = [];
    for (const equation of waiting) {
      const position = this.pending.indexOf(equation);
      if (position >= 0) this.pending.splice(position, 1);
      for (const unknown of equation.unknowns) {
        if (unknown === index) continue;
        this.byUnknown.get(unknown)?.delete(equation);
      }
      equation.unknowns = equation.unknowns.filter((unknown) => unknown !== index);
      xorInto(equation.data, data);
      queue.push(equation);
    }

    while (queue.length > 0) {
      const equation = queue.shift() as Equation;
      if (equation.unknowns.length === 0) {
        this.redundantCount += 1;
        continue;
      }
      if (equation.unknowns.length === 1) {
        const only = equation.unknowns[0] as number;
        if (this.blocks.has(only)) {
          this.redundantCount += 1;
          continue;
        }
        this.blocks.set(only, equation.data);
        const next = this.byUnknown.get(only);
        this.byUnknown.delete(only);
        if (!next) continue;
        for (const other of next) {
          const position = this.pending.indexOf(other);
          if (position >= 0) this.pending.splice(position, 1);
          for (const unknown of other.unknowns) {
            if (unknown === only) continue;
            this.byUnknown.get(unknown)?.delete(other);
          }
          other.unknowns = other.unknowns.filter((unknown) => unknown !== only);
          xorInto(other.data, equation.data);
          queue.push(other);
        }
        continue;
      }
      // Non ancora risolvibile: resta in attesa.
      this.pending.push(equation);
      for (const unknown of equation.unknowns) {
        let set = this.byUnknown.get(unknown);
        if (!set) {
          set = new Set<Equation>();
          this.byUnknown.set(unknown, set);
        }
        set.add(equation);
      }
    }
  }

  /**
   * Eliminazione di Gauss sulle equazioni residue: recupera i blocchi quando il
   * peeling si blocca (tipico nelle code della distribuzione LT).
   * Restituisce il numero di blocchi recuperati.
   */
  gaussianElimination(maxRows = 340, maxColumns = 260): number {
    if (this.complete || this.pending.length === 0) return 0;

    const unknownIndex = new Map<number, number>();
    for (const equation of this.pending) {
      for (const unknown of equation.unknowns) {
        if (!unknownIndex.has(unknown) && unknownIndex.size < maxColumns) {
          unknownIndex.set(unknown, unknownIndex.size);
        }
      }
    }
    if (unknownIndex.size === 0) return 0;

    const words = Math.ceil(unknownIndex.size / 32);
    interface Row {
      bits: Uint32Array;
      data: Bytes;
    }
    const rows: Row[] = [];

    for (const equation of this.pending) {
      if (rows.length >= maxRows) break;
      const bits = new Uint32Array(words);
      for (const unknown of equation.unknowns) {
        const column = unknownIndex.get(unknown);
        if (column === undefined) continue;
        bits[column >>> 5] = (bits[column >>> 5] ?? 0) | (1 << (column & 31));
      }
      // Copia: l'eliminazione non deve corrompere le equazioni ancora in attesa
      // se il sistema si rivela dipendente e non produce blocchi nuovi.
      rows.push({ bits, data: equation.data.slice() });
    }

    const pivotColumn: number[] = [];
    let pivotRow = 0;

    for (let column = 0; column < unknownIndex.size && pivotRow < rows.length; column += 1) {
      let selected = -1;
      for (let row = pivotRow; row < rows.length; row += 1) {
        const bits = (rows[row] as Row).bits;
        if (((bits[column >>> 5] ?? 0) & (1 << (column & 31))) !== 0) {
          selected = row;
          break;
        }
      }
      if (selected < 0) continue;

      const pivot = rows[selected] as Row;
      rows[selected] = rows[pivotRow] as Row;
      rows[pivotRow] = pivot;

      for (let row = 0; row < rows.length; row += 1) {
        if (row === pivotRow) continue;
        const current = rows[row] as Row;
        if (((current.bits[column >>> 5] ?? 0) & (1 << (column & 31))) === 0) continue;
        for (let word = 0; word < words; word += 1) {
          current.bits[word] = (current.bits[word] ?? 0) ^ (pivot.bits[word] ?? 0);
        }
        xorInto(current.data, pivot.data);
      }

      pivotColumn.push(column);
      pivotRow += 1;
    }

    let recovered = 0;
    const byColumn = new Map<number, number>();
    for (const [index, column] of unknownIndex) byColumn.set(column, index);

    for (let row = 0; row < pivotRow; row += 1) {
      const current = rows[row] as Row;
      let setBits = 0;
      let column = -1;
      for (let word = 0; word < words; word += 1) {
        let value = current.bits[word] ?? 0;
        while (value !== 0) {
          setBits += 1;
          column = word * 32 + (31 - Math.clz32(value & -value));
          value &= value - 1;
        }
      }
      if (setBits !== 1) continue;
      const index = byColumn.get(column);
      if (index === undefined || this.blocks.has(index)) continue;
      this.blocks.set(index, current.data);
      recovered += 1;
    }

    this.gaussianRecovered += recovered;
    if (recovered > 0) {
      // Le equazioni residue non aggiungono più informazione utile.
      this.pending.length = 0;
      this.byUnknown.clear();
    }
    return recovered;
  }

  /**
   * Assembla il payload completo; restituisce `null` se mancano blocchi.
   * `size` è la lunghezza esatta del payload originale.
   */
  assemble(size: number): Bytes | null {
    if (!this.complete) return null;
    const total = Math.min(size, this.k * this.blockSize);
    const out = new Uint8Array(total);
    for (let index = 0; index < this.k; index += 1) {
      const block = this.blocks.get(index);
      if (!block) return null;
      const offset = index * this.blockSize;
      const length = Math.min(this.blockSize, total - offset);
      if (length <= 0) break;
      out.set(block.subarray(0, length), offset);
    }
    return out;
  }
}
