/**
 * Astrazione del canale dati e livello di messaggistica.
 *
 * `Channel` è implementato da `PeerChannel` (WebRTC/PeerJS) nei test tramite
 * un canale in memoria: in questo modo il protocollo è verificabile senza rete.
 */

import { PROTOCOL_VERSION } from "../config";
import {
  frameChunk,
  parseChunk,
  parseMessage,
  serialize,
  type Chunk,
  type Message,
} from "./protocol";
import type { Bytes } from "./types";

export type RawPayload = string | ArrayBuffer;

export interface Channel {
  readonly isOpen: boolean;
  sendText(text: string): void;
  sendBinary(data: ArrayBuffer): void;
  /** Byte attualmente in coda nel canale: usato per il controllo di flusso. */
  bufferedAmount(): number;
  /** Registra un listener sui messaggi grezzi; restituisce la funzione di rimozione. */
  subscribe(handler: (payload: RawPayload) => void): () => void;
  onClose(handler: (reason: string) => void): () => void;
  close(): void;
}

const MAX_QUEUED_MESSAGES = 64;
const MAX_QUEUED_CHUNKS = 8;

type MessageHandler = (message: Message) => void;
type ChunkHandler = (chunk: Chunk) => void;

/**
 * Incapsula un canale grezzo, valida i messaggi e distribuisce gli eventi.
 * I messaggi arrivati prima che un handler sia registrato vengono accodati,
 * evitando race condition tra handshake e avvio del trasferimento.
 */
export class Messenger {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly chunkHandlers = new Set<ChunkHandler>();
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private readonly queuedMessages: Message[] = [];
  private readonly queuedChunks: Chunk[] = [];
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly channel: Channel,
    private readonly expectedSid: string,
    private readonly onProtocolError: (reason: string) => void,
  ) {
    this.unsubscribe = channel.subscribe((payload) => this.handlePayload(payload));
    channel.onClose((reason) => this.handleClose(reason));
  }

  get isOpen(): boolean {
    return this.channel.isOpen && !this.closed;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    this.flush();
    return () => this.messageHandlers.delete(handler);
  }

  onChunk(handler: ChunkHandler): () => void {
    this.chunkHandlers.add(handler);
    this.flush();
    return () => this.chunkHandlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    if (this.closed) handler("Canale chiuso.");
    return () => this.closeHandlers.delete(handler);
  }

  send(message: Message): void {
    if (!this.isOpen) throw new Error("Canale non disponibile.");
    this.channel.sendText(serialize(message));
  }

  sendChunk(index: number, seq: number, payload: Bytes): void {
    if (!this.isOpen) throw new Error("Canale non disponibile.");
    this.channel.sendBinary(frameChunk(index, seq, payload));
  }

  bufferedAmount(): number {
    return this.channel.bufferedAmount();
  }

  /** Converte un payload grezzo in evento tipizzato, con validazione completa. */
  private handlePayload(payload: RawPayload): void {
    if (this.closed) return;

    if (typeof payload === "string") {
      const message = parseMessage(payload);
      if (message === null) {
        this.fail("Messaggio di controllo non valido.");
        return;
      }
      if (message.sid !== this.expectedSid) {
        this.fail("Sessione non corrispondente.");
        return;
      }
      if (message.v !== PROTOCOL_VERSION) {
        this.fail("Versione del protocollo non compatibile.");
        return;
      }
      if (message.t === "ping") {
        this.send({ t: "pong", v: PROTOCOL_VERSION, sid: this.expectedSid });
        return;
      }
      if (message.t === "pong") return;
      this.dispatchMessage(message);
      return;
    }

    if (payload instanceof ArrayBuffer) {
      const chunk = parseChunk(payload);
      if (chunk === null) {
        this.fail("Blocco di dati non valido.");
        return;
      }
      this.dispatchChunk(chunk);
      return;
    }

    this.fail("Tipo di dato non riconosciuto.");
  }

  private dispatchMessage(message: Message): void {
    if (this.messageHandlers.size === 0) {
      if (this.queuedMessages.length >= MAX_QUEUED_MESSAGES) {
        this.fail("Troppi messaggi in attesa.");
        return;
      }
      this.queuedMessages.push(message);
      return;
    }
    for (const handler of this.messageHandlers) handler(message);
  }

  private dispatchChunk(chunk: Chunk): void {
    if (this.chunkHandlers.size === 0) {
      if (this.queuedChunks.length >= MAX_QUEUED_CHUNKS) {
        this.fail("Troppi blocchi in attesa.");
        return;
      }
      this.queuedChunks.push(chunk);
      return;
    }
    for (const handler of this.chunkHandlers) handler(chunk);
  }

  private flush(): void {
    while (this.queuedMessages.length > 0) {
      const message = this.queuedMessages.shift()!;
      for (const handler of this.messageHandlers) handler(message);
    }
    while (this.queuedChunks.length > 0 && this.chunkHandlers.size > 0) {
      const chunk = this.queuedChunks.shift()!;
      for (const handler of this.chunkHandlers) handler(chunk);
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const handler of this.closeHandlers) handler(reason);
  }

  private fail(reason: string): void {
    this.onProtocolError(reason);
    this.close(reason);
  }

  /** Chiude il canale e libera le risorse, notificando gli osservatori. */
  close(reason = "Sessione chiusa."): void {
    this.handleClose(reason);
    try {
      this.channel.close();
    } catch {
      // Il canale potrebbe essere già chiuso dal browser: nessuna azione necessaria.
    }
  }
}
