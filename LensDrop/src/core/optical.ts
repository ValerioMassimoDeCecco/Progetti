/**
 * Trasmissione ottica: unidirezionale, senza rete e senza canale di ritorno.
 *
 * Mittente — costruisce il payload (più elementi in un contenitore), comprime se
 * conviene, calcola lo SHA-256 e genera una sequenza infinita di frame: qualche
 * frame di metadati, i blocchi di sistema in ordine, poi alcuni simboli di
 * riparazione, e si riparte. Chi arriva tardi si sintonizza al giro successivo.
 *
 * Destinatario — decodifica i frame che la fotocamera riesce a leggere, ignora i
 * duplicati e ricostruisce il payload con il decodificatore fountain. Non serve
 * che il mittente sappia nulla: quando i blocchi sono completi, il checksum
 * SHA-256 conferma che il contenuto è identico all'originale.
 */

import { buildBundle, parseBundle, type BundleItem } from "./bundle";
import { randomU16, type Bytes } from "./bytes";
import { gzip, gunzip } from "./compression";
import { decodeFrame, encodeFrame, FrameError, type Frame, type SessionMeta } from "./frame";
import { FountainDecoder, symbolIndices } from "./fountain";
import { sha256HexSync } from "./sha256";

/** Frequenza con cui ripetere i metadati, in frame di dati. */
const META_EVERY_FRAMES = 24;
/** Frame di metadati consecutivi all'inizio: aggancio rapido. */
const PREAMBLE_META_FRAMES = 4;
/**
 * Sovraccarico tipico della coda LT quando la fotocamera perde frame: serve a
 * dare all'utente una stima prudente della durata, non ottimistica.
 */
export const LT_OVERHEAD_ESTIMATE = 1.35;

export interface SenderOptions {
  blockSize: number;
}

export interface SenderSnapshot {
  sessionId: number;
  emitted: number;
  round: number;
  totalFrames: number;
}

export class OpticalSender {
  private constructor(
    readonly meta: SessionMeta,
    private readonly payload: Bytes,
    private readonly blockSize: number,
  ) {
    this.repairs = 0;
  }

  static async create(items: BundleItem[], options: SenderOptions): Promise<OpticalSender> {
    const blockSize = Math.floor(options.blockSize);
    if (!Number.isFinite(blockSize) || blockSize < 64 || blockSize > 4096) {
      throw new Error("Dimensione dei blocchi non valida.");
    }

    const bundle = buildBundle(items);
    const compressed = await gzip(bundle);
    const payload = compressed ?? bundle;
    const k = Math.max(1, Math.ceil(payload.byteLength / blockSize));
    const name =
      items.length === 1 ? (items[0]?.name ?? "lensdrop") : `${items[0]?.name ?? "file"} + altri ${items.length - 1}`;

    const meta: SessionMeta = {
      version: 1,
      sessionId: randomU16(),
      name: name.slice(0, 120),
      itemCount: items.length,
      size: payload.byteLength,
      blockSize,
      k,
      hash: sha256HexSync(payload),
      compressed: compressed !== null,
    };

    return new OpticalSender(meta, payload, blockSize);
  }

  private cursor = 0;
  private repairSeed = 1;
  private repairs = 0;
  private sinceMeta = 0;
  private preambleLeft = PREAMBLE_META_FRAMES;
  private emittedCount = 0;

  /**
   * Un solo giro di blocchi di sistema (percorso più rapido con fotocamera
   * buona), poi solo simboli di riparazione: ogni frame porta informazione
   * nuova, senza rimandare blocchi già risolti. Le perdite si recuperano con la
   * coda LT, e il flusso non finisce mai: chi arriva tardi si aggancia ai
   * metadati periodici.
   */

  get emitted(): number {
    return this.emittedCount;
  }

  get snapshot(): SenderSnapshot {
    return {
      sessionId: this.meta.sessionId,
      emitted: this.emittedCount,
      round: this.repairs > 0 ? 1 : 0,
      totalFrames: this.meta.k,
    };
  }

  get blockCount(): number {
    return this.meta.k;
  }

  get totalBytes(): number {
    return this.meta.size;
  }

  /** Prossimo frame della sequenza (ciclo infinito). */
  nextFrame(): Frame {
    this.emittedCount += 1;

    const frame = this.pickFrame();
    if (frame.kind !== "meta") this.sinceMeta += 1;
    return frame;
  }

  /** Testo da disegnare nel QR per il prossimo frame. */
  nextText(): string {
    return encodeFrame(this.nextFrame());
  }

  private pickFrame(): Frame {
    if (this.preambleLeft > 0) {
      this.preambleLeft -= 1;
      this.sinceMeta = 0;
      return { kind: "meta", meta: this.meta };
    }

    if (this.sinceMeta >= META_EVERY_FRAMES) {
      this.sinceMeta = 0;
      return { kind: "meta", meta: this.meta };
    }

    if (this.cursor < this.meta.k) {
      const start = this.cursor * this.blockSize;
      const end = Math.min(this.payload.byteLength, start + this.blockSize);
      const data = this.payload.slice(start, end);
      this.cursor += 1;
      return { kind: "block", sessionId: this.meta.sessionId, index: this.cursor - 1, data };
    }

    const seed = this.repairSeed;
    this.repairSeed = (this.repairSeed + 0x9e3779b1) >>> 0 || 1;
    this.repairs += 1;
    return { kind: "repair", sessionId: this.meta.sessionId, seed, data: this.repairSymbol(seed) };
  }

  /** XOR dei blocchi indicati dal seed: deve restare identico al destinatario. */
  private repairSymbol(seed: number): Bytes {
    const indices = symbolIndices(seed, this.meta.k);
    const out = new Uint8Array(this.blockSize);
    for (const index of indices) {
      const start = index * this.blockSize;
      const end = Math.min(this.payload.byteLength, start + this.blockSize);
      const block = this.payload.subarray(start, end);
      for (let position = 0; position < block.byteLength; position += 1) {
        out[position] = (out[position] ?? 0) ^ (block[position] ?? 0);
      }
    }
    return out;
  }

  /** Byte utili al secondo ipotizzando il frame rate indicato (stima onesta). */
  estimateBytesPerSecond(fps: number): number {
    const dataFrames = 1 - 1 / (META_EVERY_FRAMES + 1);
    return Math.max(1, (this.blockSize * fps * dataFrames) / LT_OVERHEAD_ESTIMATE);
  }

  /** Durata stimata: trasmissione di un giro completo più il margine dei simboli extra. */
  estimateDurationMs(fps: number): number {
    return Math.round((this.payload.byteLength / this.estimateBytesPerSecond(fps)) * 1000);
  }
}

export type ReceiverFrameResult =
  | { type: "ignored" }
  | { type: "foreign" }
  | { type: "invalid"; detail: string }
  | { type: "meta" }
  | { type: "block" }
  | { type: "repair" }
  | { type: "complete" };

export interface ReceiverSnapshot {
  frames: number;
  accepted: number;
  duplicates: number;
  foreign: number;
  invalid: number;
  solved: number;
  total: number;
  ratio: number;
  recoveredByGaussian: number;
}

export class OpticalReceiver {
  private decoder: FountainDecoder | null = null;
  private sessionMeta: SessionMeta | null = null;
  private framesSeen = 0;
  private acceptedCount = 0;
  private duplicateCount = 0;
  private foreignCount = 0;
  private invalidCount = 0;
  private seenSystematic = new Set<number>();
  private lastRecoveryAttempt = 0;
  private solvedAtLastAttempt = 0;
  private records: BundleItem[] | null = null;
  private lastSessionId = 0;

  get meta(): SessionMeta | null {
    return this.sessionMeta;
  }

  get complete(): boolean {
    return this.decoder?.complete ?? false;
  }

  get snapshot(): ReceiverSnapshot {
    const solved = this.decoder?.solvedCount ?? 0;
    const total = this.sessionMeta?.k ?? 0;
    return {
      frames: this.framesSeen,
      accepted: this.acceptedCount,
      duplicates: this.duplicateCount,
      foreign: this.foreignCount,
      invalid: this.invalidCount,
      solved,
      total,
      ratio: total > 0 ? solved / total : 0,
      recoveredByGaussian: this.decoder?.stats.recoveredByGaussian ?? 0,
    };
  }

  /** Blocchi mancanti, per la diagnostica. */
  missing(limit = 16): number[] {
    return this.decoder?.missing(limit) ?? [];
  }

  /** Elabora il testo di un QR letto dalla fotocamera. */
  accept(text: string): ReceiverFrameResult {
    this.framesSeen += 1;

    let frame: Frame | null;
    try {
      frame = decodeFrame(text);
    } catch (error) {
      this.invalidCount += 1;
      return { type: "invalid", detail: error instanceof FrameError ? error.message : "Frame illeggibile." };
    }

    if (!frame) {
      this.foreignCount += 1;
      return { type: "foreign" };
    }

    if (frame.kind === "meta") {
      return this.adoptMeta(frame.meta);
    }

    if (!this.sessionMeta || !this.decoder) {
      // Senza metadati non si conosce k: il frame verrà ripreso quando arriverà un meta.
      this.duplicateCount += 1;
      return { type: "ignored" };
    }

    if (frame.sessionId !== this.sessionMeta.sessionId) {
      this.foreignCount += 1;
      return { type: "foreign" };
    }

    this.acceptedCount += 1;

    if (frame.kind === "block") {
      if (this.seenSystematic.has(frame.index)) {
        this.duplicateCount += 1;
        return { type: "block" };
      }
      this.seenSystematic.add(frame.index);
      this.decoder.addSystematic(frame.index, frame.data);
      return this.afterSymbol("block");
    }

    this.decoder.addRepair(frame.seed, frame.data);
    return this.afterSymbol("repair");
  }

  private adoptMeta(meta: SessionMeta): ReceiverFrameResult {
    if (this.sessionMeta && this.sessionMeta.sessionId !== meta.sessionId) {
      // Un'altra sessione sullo schermo: non si butta via un trasferimento a metà.
      if (!this.sessionMeta || !this.decoder?.complete) {
        this.foreignCount += 1;
        return { type: "foreign" };
      }
      this.reset(meta.sessionId);
    }
    this.sessionMeta = meta;
    if (!this.decoder) {
      this.decoder = new FountainDecoder(meta.k, meta.blockSize);
    }
    return { type: "meta" };
  }

  private afterSymbol(type: "block" | "repair"): ReceiverFrameResult {
    const decoder = this.decoder;
    if (!decoder) return { type };

    if (decoder.complete) return { type: "complete" };

    // Nelle code della distribuzione LT il peeling si blocca: Gauss recupera.
    // Si tenta Gauss solo quando il peeling si è fermato per un po': costa CPU
    // e serve unicamente nelle code della distribuzione LT.
    const pending = this.acceptedCount - this.lastRecoveryAttempt;
    const stalled = decoder.solvedCount === this.solvedAtLastAttempt;
    if (stalled && pending >= Math.max(24, Math.ceil(decoder.k * 0.05))) {
      this.lastRecoveryAttempt = this.acceptedCount;
      this.solvedAtLastAttempt = decoder.solvedCount;
      decoder.gaussianElimination();
    }

    return decoder.complete ? { type: "complete" } : { type };
  }

  /** Forza un tentativo di completamento (usato quando il flusso è fermo). */
  tryRecover(): boolean {
    const decoder = this.decoder;
    if (!decoder || decoder.complete) return decoder?.complete ?? false;
    decoder.gaussianElimination();
    return decoder.complete;
  }

  /** Verifica il checksum e restituisce gli elementi originali. */
  async finish(): Promise<BundleItem[]> {
    if (this.records) return this.records;
    const decoder = this.decoder;
    const meta = this.sessionMeta;
    if (!decoder || !meta) throw new Error("Nessun trasferimento in corso.");
    if (!decoder.complete) throw new Error("Mancano ancora dei blocchi.");

    const payload = decoder.assemble(meta.size);
    if (!payload) throw new Error("Impossibile ricomporre il payload.");

    if (sha256HexSync(payload) !== meta.hash) {
      throw new Error("Il checksum non corrisponde: trasferimento corrotto, riprova.");
    }

    const raw = meta.compressed ? await gunzip(payload) : payload;
    const items = parseBundle(raw);
    this.records = items;
    return items;
  }

  /** Azzera lo stato (nuovo trasferimento o cambio di sessione). */
  reset(sessionId?: number): void {
    this.decoder = null;
    this.sessionMeta = null;
    this.framesSeen = 0;
    this.acceptedCount = 0;
    this.duplicateCount = 0;
    this.foreignCount = 0;
    this.invalidCount = 0;
    this.seenSystematic = new Set<number>();
    this.lastRecoveryAttempt = 0;
    this.solvedAtLastAttempt = 0;
    this.records = null;
    if (sessionId !== undefined) this.lastSessionId = sessionId;
  }

  get sessionId(): number {
    return this.sessionMeta?.sessionId ?? this.lastSessionId;
  }
}
