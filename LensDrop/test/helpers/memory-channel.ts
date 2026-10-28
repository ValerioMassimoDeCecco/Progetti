/**
 * Canale in memoria per i test: imita un DataChannel affidabile e ordinato,
 * con consegna asincrona e coda di byte per il controllo di flusso.
 */

import type { Channel, RawPayload } from "../../src/core/channel";

export class MemoryChannel implements Channel {
  peer: MemoryChannel | null = null;
  private handlers = new Set<(payload: RawPayload) => void>();
  private closeHandlers = new Set<(reason: string) => void>();
  private open = true;
  private queuedBytes = 0;
  private closedReason = "";

  get isOpen(): boolean {
    return this.open;
  }

  sendText(text: string): void {
    if (!this.open) throw new Error("canale chiuso");
    queueMicrotask(() => this.peer?.deliver(text));
  }

  sendBinary(data: ArrayBuffer): void {
    if (!this.open) throw new Error("canale chiuso");
    this.queuedBytes += data.byteLength;
    queueMicrotask(() => {
      this.queuedBytes = Math.max(0, this.queuedBytes - data.byteLength);
      this.peer?.deliver(data);
    });
  }

  bufferedAmount(): number {
    return this.queuedBytes;
  }

  subscribe(handler: (payload: RawPayload) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    if (!this.open) handler(this.closedReason || "Canale chiuso.");
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.closedReason = "Canale chiuso.";
    const peer = this.peer;
    if (peer && peer.open) {
      peer.open = false;
      peer.closedReason = "L'altro dispositivo ha chiuso il canale.";
    }
    for (const handler of this.closeHandlers) handler(this.closedReason);
    if (peer) {
      for (const handler of peer.closeHandlers) handler(peer.closedReason);
    }
  }

  /** Inietta un payload come se arrivasse dalla rete (usato per i test di robustezza). */
  deliver(payload: RawPayload): void {
    if (!this.open) return;
    for (const handler of this.handlers) handler(payload);
  }
}

export function createChannelPair(): [MemoryChannel, MemoryChannel] {
  const host = new MemoryChannel();
  const guest = new MemoryChannel();
  host.peer = guest;
  guest.peer = host;
  return [host, guest];
}

/** Intercetta i payload in arrivo e permette di alterarli (test di integrità). */
export class TamperChannel implements Channel {
  constructor(
    private readonly inner: MemoryChannel,
    private readonly tamper: (payload: RawPayload) => RawPayload,
    private readonly filter: (payload: RawPayload) => boolean = () => true,
  ) {}

  get isOpen(): boolean {
    return this.inner.isOpen;
  }

  sendText(text: string): void {
    this.inner.sendText(text);
  }

  sendBinary(data: ArrayBuffer): void {
    this.inner.sendBinary(data);
  }

  bufferedAmount(): number {
    return this.inner.bufferedAmount();
  }

  subscribe(handler: (payload: RawPayload) => void): () => void {
    return this.inner.subscribe((payload) => handler(this.filter(payload) ? this.tamper(payload) : payload));
  }

  onClose(handler: (reason: string) => void): () => void {
    return this.inner.onClose(handler);
  }

  close(): void {
    this.inner.close();
  }
}
