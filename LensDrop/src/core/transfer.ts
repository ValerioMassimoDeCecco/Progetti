/**
 * Motore di trasferimento indipendente dal trasporto.
 *
 * - I file vengono letti e inviati a blocchi da 16 KB, senza caricare l'intero
 *   contenuto in memoria.
 * - Il controllo di flusso usa `bufferedAmount()` del DataChannel.
 * - Ogni file ha un SHA-256 calcolato in streaming da entrambe le parti.
 * - Tutti i messaggi e i blocchi sono validati; le sequenze fuori ordine
 *   interrompono la sessione invece di produrre file corrotti.
 */

import {
  ACCEPT_TIMEOUT_MS,
  CHUNK_SIZE,
  MAX_ITEMS,
  MAX_ITEM_BYTES,
  MAX_SESSION_BYTES,
  PROTOCOL_VERSION,
  SEND_HIGH_WATER_BYTES,
  TRANSFER_IDLE_TIMEOUT_MS,
} from "../config";
import { encodeBase32 } from "./base32";
import type { Messenger } from "./channel";
import { AuthError } from "./auth";
import {
  sanitizeFileName,
  type Chunk,
  type ItemMeta,
  type Message,
  type OfferMessage,
} from "./protocol";
import { Sha256 } from "./sha256";
import type { Bytes } from "./types";

export interface TransferProgress {
  totalBytes: number;
  transferredBytes: number;
  currentItemId: string | null;
  currentItemName: string | null;
  currentItemSize: number;
  currentItemTransferred: number;
  itemIndex: number;
  itemCount: number;
  speedBps: number;
  etaMs: number | null;
}

export interface ReceivedItem {
  meta: ItemMeta;
  blob: Blob;
  fileName: string;
  verified: boolean;
}

export interface SendSummary {
  items: number;
  totalBytes: number;
  elapsedMs: number;
}

export interface ReceiveSummary {
  items: number;
  totalBytes: number;
  elapsedMs: number;
  allVerified: boolean;
}

export interface SenderCallbacks {
  onAccepted?: (items: ItemMeta[], totalBytes: number) => void;
  onProgress?: (progress: TransferProgress) => void;
  onItemFinished?: (meta: ItemMeta, verified: boolean, error?: string) => void;
  onComplete?: (summary: SendSummary) => void;
  onCancel?: (reason: string, local: boolean) => void;
  onError?: (error: Error) => void;
  onClosed?: (reason: string) => void;
}

export interface ReceiverCallbacks {
  onOffer?: (offer: OfferMessage) => void;
  onProgress?: (progress: TransferProgress) => void;
  onItem?: (item: ReceivedItem) => void;
  onComplete?: (summary: ReceiveSummary) => void;
  onCancel?: (reason: string, local: boolean) => void;
  onError?: (error: Error) => void;
  onClosed?: (reason: string) => void;
}

/** Blocchi accumulati prima di consolidarli in un Blob: limita l'uso di heap. */
const BLOB_FLUSH_BYTES = 16 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomItemId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return encodeBase32(bytes, 8);
}

class SpeedMeter {
  private readonly samples: Array<{ time: number; bytes: number }> = [];

  add(bytes: number, now = Date.now()): void {
    this.samples.push({ time: now, bytes });
    const cutoff = now - 3000;
    while (this.samples.length > 2 && this.samples[0]!.time < cutoff) this.samples.shift();
  }

  speed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const elapsed = (last.time - first.time) / 1000;
    if (elapsed <= 0) return 0;
    return Math.max(0, (last.bytes - first.bytes) / elapsed);
  }

  reset(): void {
    this.samples.length = 0;
  }
}

interface Pending {
  predicate: (message: Message) => boolean;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Attesa di un messaggio specifico con gestione di annullamento, chiusura e timeout. */
class MessageWaiter {
  private pending: Pending | null = null;
  private abortError: Error | null = null;
  private closed = false;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeClose: () => void;

  constructor(
    messenger: Messenger,
    private readonly onRemoteCancel: (reason: string) => void,
    private readonly onClosed: (reason: string) => void,
  ) {
    this.unsubscribeMessage = messenger.onMessage((message) => this.handle(message));
    this.unsubscribeClose = messenger.onClose((reason) => {
      this.closed = true;
      this.failPending(new AuthError(reason));
      this.onClosed(reason);
    });
  }

  get isAborted(): boolean {
    return this.abortError !== null;
  }

  abort(error: Error): void {
    if (this.abortError === null) this.abortError = error;
    this.failPending(error);
  }

  throwIfAborted(): void {
    if (this.abortError) throw this.abortError;
    if (this.closed) throw new AuthError("Il collegamento è stato chiuso.");
  }

  wait(predicate: (message: Message) => boolean, timeoutMs: number, errorMessage: string): Promise<Message> {
    this.throwIfAborted();
    return new Promise<Message>((resolve, reject) => {
      if (this.pending) {
        reject(new Error("Attesa concorrente non supportata."));
        return;
      }
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(errorMessage));
      }, timeoutMs);
      this.pending = { predicate, resolve, reject, timer };
    });
  }

  dispose(): void {
    this.failPending(new AuthError("Sessione chiusa."));
    this.unsubscribeMessage();
    this.unsubscribeClose();
  }

  private handle(message: Message): void {
    if (message.t === "cancel") {
      const reason = message.reason;
      this.abort(new AuthError(reason));
      this.onRemoteCancel(reason);
      return;
    }
    if (this.pending && this.pending.predicate(message)) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  }

  private failPending(error: Error): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}

/** Lato mittente del trasferimento. */
export class TransferSender {
  private readonly waiter: MessageWaiter;
  private readonly speed = new SpeedMeter();
  private lastProgressEmit = 0;
  private cancelled = false;

  constructor(
    private readonly messenger: Messenger,
    private readonly sid: string,
    private readonly callbacks: SenderCallbacks = {},
  ) {
    this.waiter = new MessageWaiter(
      messenger,
      (reason) => {
        this.cancelled = true;
        this.callbacks.onCancel?.(reason, false);
      },
      (reason) => {
        if (!this.cancelled) this.callbacks.onClosed?.(reason);
      },
    );
  }

  /**
   * Invia un lotto di file: proposta, attesa della conferma, invio a blocchi,
   * verifica di integrità e chiusura del lotto.
   */
  async send(items: File[]): Promise<SendSummary> {
    if (items.length === 0) throw new Error("Nessun contenuto da inviare.");
    if (items.length > MAX_ITEMS) throw new Error(`Massimo ${MAX_ITEMS} elementi per invio.`);

    const metas: ItemMeta[] = [];
    let totalBytes = 0;
    for (const file of items) {
      if (!(file instanceof Blob)) throw new Error("Contenuto non valido.");
      if (file.size > MAX_ITEM_BYTES) throw new Error(`"${file.name}" supera il limite per singolo file.`);
      totalBytes += file.size;
      if (totalBytes > MAX_SESSION_BYTES) throw new Error("La selezione supera il limite per sessione.");
      metas.push({
        id: randomItemId(),
        name: sanitizeFileName(file.name || "file", "file"),
        size: file.size,
        mime: normalizeMime(file.type),
      });
    }

    const offer: OfferMessage = {
      t: "offer",
      v: PROTOCOL_VERSION,
      sid: this.sid,
      items: metas,
      totalBytes,
    };
    this.messenger.send(offer);

    const response = await this.waiter.wait(
      (message) => message.t === "accept" || message.t === "reject",
      ACCEPT_TIMEOUT_MS,
      "Il destinatario non ha confermato in tempo. La sessione è scaduta.",
    );
    if (response.t === "reject") {
      throw new AuthError(response.reason || "Il destinatario ha rifiutato il trasferimento.");
    }
    this.callbacks.onAccepted?.(metas, totalBytes);

    const startedAt = Date.now();
    this.speed.reset();
    this.speed.add(0, startedAt);
    let transferred = 0;

    for (let index = 0; index < items.length; index += 1) {
      const file = items[index]!;
      const meta = metas[index]!;
      this.waiter.throwIfAborted();
      this.messenger.send({ t: "start", v: PROTOCOL_VERSION, sid: this.sid, id: meta.id, index });

      const hasher = new Sha256();
      let itemTransferred = 0;
      let seq = 0;

      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        this.waiter.throwIfAborted();
        await this.waitForCapacity();
        const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
        const buffer = await slice.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        this.waiter.throwIfAborted();
        hasher.update(bytes);
        this.messenger.sendChunk(index, seq, bytes);
        seq += 1;
        itemTransferred += bytes.length;
        transferred += bytes.length;
        this.emitProgress(metas, totalBytes, transferred, meta, itemTransferred, index);
        if (seq % 16 === 0) await sleep(0);
      }

      const digest = hasher.digestHex();
      this.messenger.send({
        t: "end",
        v: PROTOCOL_VERSION,
        sid: this.sid,
        id: meta.id,
        index,
        bytes: itemTransferred,
        sha256: digest,
      });

      const verdict = await this.waiter.wait(
        (message) => message.t === "verified" && message.id === meta.id,
        TRANSFER_IDLE_TIMEOUT_MS,
        "Il destinatario non ha confermato la ricezione del file.",
      );
      if (verdict.t !== "verified") throw new Error("Risposta inattesa dal destinatario.");
      this.callbacks.onItemFinished?.(meta, verdict.ok, verdict.error);
      if (!verdict.ok) {
        throw new Error(
          verdict.error
            ? `Verifica fallita per "${meta.name}": ${verdict.error}`
            : `Verifica di integrità fallita per "${meta.name}".`,
        );
      }
    }

    this.messenger.send({ t: "done", v: PROTOCOL_VERSION, sid: this.sid });
    const summary: SendSummary = { items: items.length, totalBytes, elapsedMs: Date.now() - startedAt };
    this.emitFinalProgress(metas, totalBytes, transferred);
    this.callbacks.onComplete?.(summary);
    return summary;
  }

  /** Annulla il trasferimento e informa il destinatario. */
  cancel(reason = "Trasferimento annullato dal mittente."): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.waiter.abort(new AuthError(reason));
    try {
      this.messenger.send({ t: "cancel", v: PROTOCOL_VERSION, sid: this.sid, reason });
    } catch {
      // Il canale può essere già chiuso: l'annullamento locale resta valido.
    }
    this.callbacks.onCancel?.(reason, true);
  }

  dispose(): void {
    this.waiter.dispose();
  }

  private async waitForCapacity(): Promise<void> {
    let guard = 0;
    while (this.messenger.bufferedAmount() > SEND_HIGH_WATER_BYTES) {
      this.waiter.throwIfAborted();
      if (!this.messenger.isOpen) throw new AuthError("Il collegamento è stato interrotto.");
      await sleep(20);
      guard += 1;
      if (guard > 15_000) throw new Error("Il collegamento non smaltisce i dati (rete troppo lenta).");
    }
  }

  private emitProgress(
    metas: ItemMeta[],
    totalBytes: number,
    transferred: number,
    meta: ItemMeta,
    itemTransferred: number,
    index: number,
  ): void {
    const now = Date.now();
    this.speed.add(transferred, now);
    if (now - this.lastProgressEmit < 100) return;
    this.lastProgressEmit = now;
    const speed = this.speed.speed();
    const remaining = Math.max(0, totalBytes - transferred);
    this.callbacks.onProgress?.({
      totalBytes,
      transferredBytes: transferred,
      currentItemId: meta.id,
      currentItemName: meta.name,
      currentItemSize: meta.size,
      currentItemTransferred: itemTransferred,
      itemIndex: index,
      itemCount: metas.length,
      speedBps: speed,
      etaMs: speed > 0 ? (remaining / speed) * 1000 : null,
    });
  }

  private emitFinalProgress(metas: ItemMeta[], totalBytes: number, transferred: number): void {
    const last = metas[metas.length - 1] ?? null;
    this.callbacks.onProgress?.({
      totalBytes,
      transferredBytes: transferred,
      currentItemId: last?.id ?? null,
      currentItemName: last?.name ?? null,
      currentItemSize: last?.size ?? 0,
      currentItemTransferred: last?.size ?? 0,
      itemIndex: Math.max(0, metas.length - 1),
      itemCount: metas.length,
      speedBps: 0,
      etaMs: 0,
    });
  }
}

function normalizeMime(mime: string): string {
  if (typeof mime !== "string") return "application/octet-stream";
  const trimmed = mime.trim().slice(0, 200);
  if (!/^[\w.+-]+\/[\w.+-]+/.test(trimmed)) return "application/octet-stream";
  return trimmed;
}

/** Assembla i blocchi in un Blob consolidando periodicamente per non saturare la memoria. */
class BlobAssembler {
  private parts: Bytes[] = [];
  private pendingBytes = 0;
  private consolidated: Blob | null = null;

  add(payload: Bytes): void {
    this.parts.push(payload);
    this.pendingBytes += payload.length;
    if (this.pendingBytes >= BLOB_FLUSH_BYTES) this.consolidate();
  }

  finish(): Blob {
    return new Blob([this.consolidated ?? new Uint8Array(0), ...this.parts]);
  }

  private consolidate(): void {
    this.consolidated = new Blob([this.consolidated ?? new Uint8Array(0), ...this.parts]);
    this.parts = [];
    this.pendingBytes = 0;
  }
}

interface IncomingFile {
  meta: ItemMeta;
  index: number;
  assembler: BlobAssembler;
  hasher: Sha256;
  received: number;
  expectedSeq: number;
}

/** Lato destinatario del trasferimento. */
export class TransferReceiver {
  private readonly waiter: MessageWaiter;
  private readonly speed = new SpeedMeter();
  private offer: OfferMessage | null = null;
  private current: IncomingFile | null = null;
  private nextItemIndex = 0;
  private totalReceived = 0;
  private receivedItems = 0;
  private startedAt = 0;
  private lastProgressEmit = 0;
  private closed = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribeChunk: () => void;

  constructor(
    private readonly messenger: Messenger,
    private readonly sid: string,
    private readonly callbacks: ReceiverCallbacks = {},
  ) {
    this.waiter = new MessageWaiter(
      messenger,
      (reason) => {
        this.callbacks.onCancel?.(reason, false);
      },
      (reason) => {
        if (!this.closed) this.callbacks.onClosed?.(reason);
      },
    );

    messenger.onMessage((message) => this.handleMessage(message));
    this.unsubscribeChunk = messenger.onChunk((chunk) => this.handleChunk(chunk));
  }

  private handleMessage(message: Message): void {
    switch (message.t) {
      case "offer":
        this.handleOffer(message);
        break;
      case "start":
        this.handleStart(message);
        break;
      case "end":
        this.handleEnd(message);
        break;
      case "done":
        this.handleDone();
        break;
      case "ping":
      case "pong":
        break;
      default:
        this.fail(new Error("Messaggio inatteso durante la ricezione."));
        break;
    }
  }

  private handleOffer(offer: OfferMessage): void {
    if (this.offer !== null) {
      this.fail(new Error("Seconda proposta ricevuta nella stessa sessione."));
      return;
    }
    this.offer = offer;
    this.startedAt = Date.now();
    this.callbacks.onOffer?.(offer);
  }

  /** Conferma esplicita: nessun file viene accettato prima di questa chiamata. */
  accept(): void {
    if (!this.offer) throw new Error("Nessuna proposta da accettare.");
    this.messenger.send({ t: "accept", v: PROTOCOL_VERSION, sid: this.sid });
    this.speed.reset();
    this.speed.add(0);
  }

  reject(reason = "Il destinatario ha rifiutato il trasferimento."): void {
    try {
      this.messenger.send({ t: "reject", v: PROTOCOL_VERSION, sid: this.sid, reason });
    } catch {
      // Se il canale non è disponibile non c'è nulla da notificare.
    }
    this.closed = true;
    this.waiter.dispose();
    // Breve attesa: il mittente deve poter leggere il rifiuto prima della chiusura.
    this.scheduleClose(reason);
  }

  cancel(reason = "Ricezione annullata."): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.messenger.send({ t: "cancel", v: PROTOCOL_VERSION, sid: this.sid, reason });
    } catch {
      // Canale già chiuso.
    }
    this.waiter.dispose();
    this.scheduleClose(reason);
    this.callbacks.onCancel?.(reason, true);
  }

  dispose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.waiter.dispose();
    this.unsubscribeChunk();
  }

  /** Chiude il canale dopo aver lasciato il tempo di consegnare l'ultimo messaggio. */
  private scheduleClose(reason: string): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.messenger.close(reason);
    }, 250);
  }

  private handleStart(message: Extract<Message, { t: "start" }>): void {
    if (!this.offer) {
      this.fail(new Error("Avvio di un file senza proposta."));
      return;
    }
    const meta = this.offer.items[message.index];
    if (!meta || meta.id !== message.id) {
      this.fail(new Error("Metadati del file non coerenti."));
      return;
    }
    if (message.index !== this.nextItemIndex || this.current !== null) {
      this.fail(new Error("Sequenza dei file non valida."));
      return;
    }
    this.current = {
      meta,
      index: message.index,
      assembler: new BlobAssembler(),
      hasher: new Sha256(),
      received: 0,
      expectedSeq: 0,
    };
  }

  private handleChunk(chunk: Chunk): void {
    const current = this.current;
    if (!current) {
      this.fail(new Error("Blocco ricevuto senza file in corso."));
      return;
    }
    if (chunk.index !== current.index || chunk.seq !== current.expectedSeq) {
      this.fail(new Error("Blocchi fuori sequenza: trasferimento interrotto per sicurezza."));
      return;
    }
    if (current.received + chunk.payload.length > current.meta.size) {
      this.fail(new Error("Il file ricevuto supera la dimensione dichiarata."));
      return;
    }

    current.assembler.add(chunk.payload);
    current.hasher.update(chunk.payload);
    current.received += chunk.payload.length;
    current.expectedSeq += 1;
    this.totalReceived += chunk.payload.length;

    if (this.totalReceived > (this.offer?.totalBytes ?? 0)) {
      this.fail(new Error("La sessione supera la dimensione dichiarata."));
      return;
    }

    this.emitProgress(current);
  }

  private handleEnd(message: Extract<Message, { t: "end" }>): void {
    const current = this.current;
    if (!current || message.id !== current.meta.id || message.index !== current.index) {
      this.fail(new Error("Fine file non coerente."));
      return;
    }
    this.current = null;
    this.nextItemIndex += 1;

    let verified = false;
    let error: string | undefined;

    if (message.bytes !== current.received) {
      error = "dimensione diversa da quella dichiarata";
    } else if (current.received !== current.meta.size) {
      error = "conteggio byte non coerente";
    } else {
      const digest = current.hasher.digestHex();
      verified = digest === message.sha256;
      if (!verified) error = "impronta SHA-256 diversa";
    }

    const fileName = sanitizeFileName(current.meta.name, "file");
    let blob: Blob | null = null;
    if (verified) {
      try {
        blob = new Blob([current.assembler.finish()], {
          type: current.meta.mime || "application/octet-stream",
        });
      } catch {
        verified = false;
        error = "impossibile creare il file in memoria";
      }
    }

    this.messenger.send({
      t: "verified",
      v: PROTOCOL_VERSION,
      sid: this.sid,
      id: current.meta.id,
      ok: verified,
      ...(error ? { error } : {}),
    });

    if (verified && blob) {
      this.receivedItems += 1;
      this.callbacks.onItem?.({ meta: current.meta, blob, fileName, verified: true });
    } else {
      this.callbacks.onError?.(new Error(`Verifica fallita per "${fileName}": ${error ?? "errore sconosciuto"}.`));
    }
    this.emitProgress(null, true);
  }

  private handleDone(): void {
    if (!this.offer) return;
    const offer = this.offer;
    if (this.nextItemIndex !== offer.items.length) {
      this.fail(new Error("Trasferimento concluso con file mancanti."));
      return;
    }
    const summary: ReceiveSummary = {
      items: this.receivedItems,
      totalBytes: this.totalReceived,
      elapsedMs: Date.now() - this.startedAt,
      allVerified: this.receivedItems === offer.items.length,
    };
    // Il canale resta aperto: il mittente può proporre un altro lotto di file.
    this.offer = null;
    this.nextItemIndex = 0;
    this.totalReceived = 0;
    this.receivedItems = 0;
    this.startedAt = 0;
    this.callbacks.onComplete?.(summary);
  }

  private emitProgress(current: IncomingFile | null, force = false): void {
    const now = Date.now();
    this.speed.add(this.totalReceived, now);
    if (!force && now - this.lastProgressEmit < 100) return;
    this.lastProgressEmit = now;
    const totalBytes = this.offer?.totalBytes ?? 0;
    const speed = this.speed.speed();
    const remaining = Math.max(0, totalBytes - this.totalReceived);
    this.callbacks.onProgress?.({
      totalBytes,
      transferredBytes: this.totalReceived,
      currentItemId: current?.meta.id ?? null,
      currentItemName: current?.meta.name ?? null,
      currentItemSize: current?.meta.size ?? 0,
      currentItemTransferred: current?.received ?? 0,
      itemIndex: current?.index ?? Math.max(0, this.nextItemIndex - 1),
      itemCount: this.offer?.items.length ?? 0,
      speedBps: speed,
      etaMs: speed > 0 ? (remaining / speed) * 1000 : null,
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.waiter.abort(error);
    this.callbacks.onError?.(error);
    this.messenger.close(error.message);
  }
}
