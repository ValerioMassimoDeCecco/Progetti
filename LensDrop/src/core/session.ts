/**
 * Livello WebRTC/PeerJS.
 *
 * PeerJS fornisce solo la segnalazione (scambio SDP/ICE) tramite PeerServer;
 * i contenuti viaggiano sul DataChannel in modalità diretta quando la rete lo
 * permette, altrimenti attraverso un relay TURN configurato.
 */

import Peer, { type DataConnection, type PeerJSOption } from "peerjs";
import { AUTH_TIMEOUT_MS, CONNECT_TIMEOUT_MS } from "../config";
import { authenticateReceiver, authenticateSender, createWelcomeMessage } from "./auth";
import type { Channel, RawPayload } from "./channel";
import { Messenger } from "./channel";
import { deriveSessionKey } from "./crypto";
import type { AppSettings, SignalingSettings } from "./settings";
import { resolveIceServers, resolveSignaling } from "./settings";
import { supportsWebRtc } from "./files";
import { peerIdForCode } from "./links";

export type SessionErrorCode =
  | "browser-incompatible"
  | "signaling-unreachable"
  | "peer-unavailable"
  | "id-taken"
  | "connection-failed"
  | "authentication-failed"
  | "expired"
  | "closed"
  | "unknown";

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

export type SessionPhase =
  | "idle"
  | "signaling"
  | "waiting"
  | "connecting"
  | "authenticating"
  | "connected"
  | "closed"
  | "error";

export interface SessionStatus {
  phase: SessionPhase;
  detail?: string;
}

export interface PeerHandle {
  messenger: Messenger;
  channel: PeerChannel;
}

/**
 * Adattatore `Channel` su una DataConnection PeerJS.
 * Accumula i messaggi ricevuti prima della registrazione di un listener, così
 * nessun frame va perso tra la fine dell'handshake e l'avvio del trasferimento.
 */
export class PeerChannel implements Channel {
  private readonly handlers = new Set<(payload: RawPayload) => void>();
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private readonly queue: RawPayload[] = [];
  private closed = false;
  private closeReason = "";

  constructor(private readonly conn: DataConnection) {
    conn.on("data", (data: unknown) => this.receive(data));
    conn.on("close", () => this.notifyClose("Il dispositivo si è disconnesso."));
    conn.on("error", () => this.notifyClose("Errore di comunicazione con il dispositivo."));
    conn.on("iceStateChanged", (state: RTCIceConnectionState) => {
      if (state === "failed") this.notifyClose("Connessione di rete non stabilita (ICE failed).");
    });
  }

  get isOpen(): boolean {
    return !this.closed && this.conn.open === true;
  }

  sendText(text: string): void {
    this.send(() => this.conn.send(text));
  }

  sendBinary(data: ArrayBuffer): void {
    this.send(() => this.conn.send(data));
  }

  /**
   * Determina se la connessione attuale è diretta o passa da un relay TURN,
   * leggendo la coppia di candidati selezionata da ICE.
   * Restituisce "unknown" quando il browser non espone statistiche utili.
   */
  async connectionRoute(): Promise<"direct" | "relay" | "unknown"> {
    const peerConnection = (this.conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
    if (!peerConnection || typeof peerConnection.getStats !== "function") return "unknown";
    try {
      const report = await peerConnection.getStats();
      const candidates = new Map<string, { candidateType?: string }>();
      let pairId: string | undefined;

      report.forEach((stat: { type?: string; [key: string]: unknown }) => {
        if (stat.type === "candidate") {
          candidates.set(String((stat as { id?: string }).id ?? ""), stat as { candidateType?: string });
        }
        if (stat.type === "transport" && typeof stat["selectedCandidatePairId"] === "string") {
          pairId = stat["selectedCandidatePairId"] as string;
        }
      });

      if (!pairId) {
        report.forEach((stat: { type?: string; [key: string]: unknown }) => {
          const pair = stat as { id?: string; selected?: boolean; nominated?: boolean; state?: string };
          if (stat.type === "candidate-pair" && (pair.selected === true || pair.nominated === true)) {
            pairId = pair.id;
          }
        });
      }
      if (!pairId) return "unknown";

      const pair = report.get(pairId) as
        | { localCandidateId?: string; remoteCandidateId?: string; state?: string; selected?: boolean }
        | undefined;
      if (!pair) return "unknown";
      const local = pair.localCandidateId ? candidates.get(pair.localCandidateId) : undefined;
      const remote = pair.remoteCandidateId ? candidates.get(pair.remoteCandidateId) : undefined;
      if (!local && !remote) return "unknown";
      const relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
      return relay ? "relay" : "direct";
    } catch {
      return "unknown";
    }
  }

  bufferedAmount(): number {
    const dataChannel = (this.conn as unknown as { dataChannel?: RTCDataChannel }).dataChannel;
    if (dataChannel) return dataChannel.bufferedAmount;
    const bufferSize = (this.conn as unknown as { bufferSize?: number }).bufferSize;
    return (bufferSize ?? 0) * 16_000;
  }

  subscribe(handler: (payload: RawPayload) => void): () => void {
    this.handlers.add(handler);
    while (this.queue.length > 0 && this.handlers.size > 0) handler(this.queue.shift()!);
    return () => this.handlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    if (this.closed) handler(this.closeReason);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.conn.close();
    } catch {
      // Connessione già chiusa dal browser.
    }
    this.notifyClose("Sessione chiusa.");
  }

  private send(action: () => void): void {
    if (!this.isOpen) throw new Error("Il canale non è aperto.");
    try {
      action();
    } catch {
      this.notifyClose("Invio non riuscito: il collegamento è stato interrotto.");
      throw new Error("Il collegamento è stato interrotto.");
    }
  }

  private receive(data: unknown): void {
    if (typeof data === "string" || data instanceof ArrayBuffer) {
      this.dispatch(data);
      return;
    }
    if (data instanceof Blob) {
      data
        .arrayBuffer()
        .then((buffer) => this.dispatch(buffer))
        .catch(() => this.notifyClose("Dati ricevuti non leggibili."));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as Uint8Array<ArrayBuffer>;
      this.dispatch(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
      return;
    }
    this.notifyClose("Formato dati non supportato.");
  }

  private dispatch(payload: RawPayload): void {
    if (this.closed) return;
    if (this.handlers.size === 0) {
      if (this.queue.length < 32) this.queue.push(payload);
      return;
    }
    for (const handler of this.handlers) handler(payload);
  }

  private notifyClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const handler of this.closeHandlers) handler(reason);
  }
}

function peerOptions(settings: AppSettings, id?: string): [string, PeerJSOption] | [undefined, PeerJSOption] {
  const signaling: SignalingSettings = resolveSignaling(settings);
  const options: PeerJSOption = {
    host: signaling.host,
    port: signaling.port,
    path: signaling.path,
    key: signaling.key,
    secure: signaling.secure,
    debug: 0,
    config: { iceServers: resolveIceServers(settings) as RTCIceServer[] },
  };
  return id === undefined ? [undefined, options] : [id, options];
}

function createPeer(settings: AppSettings, id?: string): Peer {
  const [peerId, options] = peerOptions(settings, id);
  return peerId === undefined ? new Peer(options) : new Peer(peerId, options);
}

/** Attende che il DataChannel sia realmente aperto (o fallisca) con un timeout. */
function waitForConnectionOpen(connection: DataConnection, timeoutMs: number): Promise<boolean> {
  if (connection.open === true) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.off("open", handleOpen);
      connection.off("close", handleClose);
      connection.off("error", handleError);
      resolve(ok);
    };
    const handleOpen = () => finish(true);
    const handleClose = () => finish(false);
    const handleError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    connection.on("open", handleOpen);
    connection.on("close", handleClose);
    connection.on("error", handleError);
  });
}

function mapPeerError(error: unknown): SessionError {
  const type =
    typeof error === "object" && error !== null && "type" in error
      ? String((error as { type: unknown }).type)
      : "unknown";

  switch (type) {
    case "browser-incompatible":
      return new SessionError(
        "browser-incompatible",
        "Questo browser non supporta WebRTC. Aggiorna il browser o usane un altro (Chrome, Safari, Edge, Firefox).",
      );
    case "peer-unavailable":
      return new SessionError(
        "peer-unavailable",
        "Nessun dispositivo in attesa con questo codice. Controlla il codice o chiedi al mittente di mostrarne uno nuovo.",
      );
    case "unavailable-id":
      return new SessionError("id-taken", "Codice già in uso. Genera un nuovo codice di sessione.");
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return new SessionError(
        "signaling-unreachable",
        "Il servizio di segnalazione non è raggiungibile. Controlla la connessione o configura un server PeerJS nelle impostazioni.",
      );
    case "ssl-unavailable":
      return new SessionError(
        "signaling-unreachable",
        "Il server di segnalazione richiede una connessione sicura (HTTPS/WSS).",
      );
    case "invalid-key":
      return new SessionError("signaling-unreachable", "La chiave del server di segnalazione non è valida.");
    case "webrtc":
      return new SessionError("connection-failed", "Connessione WebRTC non riuscita: rete o firewall troppo restrittivi.");
    default:
      return new SessionError("unknown", "Errore di connessione non previsto.");
  }
}

export interface HostOptions {
  code: string;
  expiresAt: number;
  settings: AppSettings;
  onStatus?: (status: SessionStatus) => void;
  onPeer?: (peer: PeerHandle) => void;
  onPeerClosed?: (reason: string) => void;
  onWarning?: (message: string) => void;
}

/** Lato mittente: crea la stanza di segnalazione e attende un destinatario. */
export class HostSession {
  readonly code: string;
  readonly sid: string;
  readonly expiresAt: number;
  private peer: Peer | null = null;
  private key: CryptoKey | null = null;
  private active: PeerHandle | null = null;
  private pendingConnection = false;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: HostOptions) {
    this.code = options.code;
    this.sid = options.code;
    this.expiresAt = options.expiresAt;
  }

  async start(): Promise<void> {
    if (!supportsWebRtc()) {
      throw new SessionError("browser-incompatible", "WebRTC non è disponibile in questo browser.");
    }
    this.key = await deriveSessionKey(this.code);
    this.emit("signaling", "Connessione al servizio di segnalazione…");

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const peer = createPeer(this.options.settings, peerIdForCode(this.code));
      this.peer = peer;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new SessionError(
            "signaling-unreachable",
            "Il servizio di segnalazione non risponde. Controlla la rete e riprova.",
          ),
        );
        this.close();
      }, 15_000);

      peer.on("open", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.emit("waiting", "In attesa del destinatario…");
        resolve();
      });

      peer.on("error", (error: unknown) => {
        const sessionError = mapPeerError(error);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(sessionError);
          this.close();
          return;
        }
        if (sessionError.code === "signaling-unreachable") {
          this.emit("error", sessionError.message);
          return;
        }
        this.options.onWarning?.(sessionError.message);
      });

      peer.on("connection", (connection: DataConnection) => {
        void this.handleConnection(connection);
      });

      peer.on("disconnected", () => {
        if (this.closed) return;
        this.emit("signaling", "Segnalazione interrotta, tentativo di riconnessione…");
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.closed || !this.peer || this.peer.destroyed) return;
          try {
            this.peer.reconnect();
          } catch {
            this.emit("error", "Impossibile riconnettersi al servizio di segnalazione.");
          }
        }, 1500);
      });
    });
  }

  get connected(): boolean {
    return this.active !== null;
  }

  get remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  /** Chiude definitivamente la stanza e le risorse associate. */
  close(reason = "Sessione chiusa."): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.active?.messenger.close(reason);
    this.active = null;
    try {
      this.peer?.destroy();
    } catch {
      // Peer già distrutto.
    }
    this.peer = null;
    this.emit("closed", reason);
  }

  private async handleConnection(connection: DataConnection): Promise<void> {
    if (this.closed) {
      connection.close();
      return;
    }
    if (this.active || this.pendingConnection) {
      connection.close();
      this.options.onWarning?.("Un altro dispositivo ha tentato il collegamento: sessione già occupata.");
      return;
    }
    if (Date.now() > this.expiresAt) {
      connection.close();
      this.options.onWarning?.("Il codice di questa sessione è scaduto: generane uno nuovo.");
      return;
    }

    this.pendingConnection = true;

    // PeerJS emette "connection" prima che il DataChannel sia aperto: attendere
    // l'evento "open" evita di inviare la sfida su un canale non pronto.
    const opened = await waitForConnectionOpen(connection, 15_000);
    if (!opened || this.closed) {
      this.pendingConnection = false;
      try {
        connection.close();
      } catch {
        // Connessione già chiusa.
      }
      if (!this.closed) this.emit("waiting", "In attesa del destinatario…");
      return;
    }

    const channel = new PeerChannel(connection);
    const messenger = new Messenger(channel, this.sid, (message) => {
      this.options.onWarning?.(`Protocollo non valido: ${message}`);
    });

    connection.on("close", () => {
      if (this.active?.channel === channel) {
        this.active = null;
        this.options.onPeerClosed?.("Il dispositivo si è disconnesso.");
        if (!this.closed) this.emit("waiting", "In attesa del destinatario…");
      }
    });

    this.emit("authenticating", "Verifica del codice di sicurezza…");

    try {
      if (!this.key) throw new SessionError("authentication-failed", "Chiave di sessione non disponibile.");
      await authenticateSender(messenger, this.key, this.sid, AUTH_TIMEOUT_MS);
      if (this.closed) {
        messenger.close("Sessione chiusa.");
        return;
      }
      this.active = { messenger, channel };
      this.emit("connected", "Dispositivo collegato.");
      this.options.onPeer?.({ messenger, channel });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Collegamento rifiutato: verifica di sicurezza fallita.";
      messenger.close(message);
      this.options.onWarning?.(message);
      if (!this.closed) this.emit("waiting", "In attesa del destinatario…");
    } finally {
      this.pendingConnection = false;
    }
  }

  private emit(phase: SessionPhase, detail?: string): void {
    this.options.onStatus?.({ phase, ...(detail ? { detail } : {}) });
  }
}

export interface GuestOptions {
  code: string;
  settings: AppSettings;
  onStatus?: (status: SessionStatus) => void;
  onClosed?: (reason: string) => void;
}

/** Lato destinatario: si collega alla stanza indicata dal codice e si autentica. */
export class GuestSession {
  private peer: Peer | null = null;
  private messenger: Messenger | null = null;
  private closed = false;

  constructor(private readonly options: GuestOptions) {}

  async connect(): Promise<PeerHandle> {
    if (!supportsWebRtc()) {
      throw new SessionError("browser-incompatible", "WebRTC non è disponibile in questo browser.");
    }
    this.emit("signaling", "Connessione al servizio di segnalazione…");

    const key = await deriveSessionKey(this.options.code);
    const peer = createPeer(this.options.settings);
    this.peer = peer;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new SessionError("connection-failed", "Connessione non riuscita entro il tempo previsto."));
        this.close();
      }, 15_000);

      peer.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });

      peer.on("error", (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(mapPeerError(error));
          this.close();
          return;
        }
        if (this.closed) return;
        const mapped = mapPeerError(error);
        if (mapped.code !== "peer-unavailable") this.options.onStatus?.({ phase: "error", detail: mapped.message });
      });
    });

    this.emit("connecting", "Collegamento al dispositivo…");

    const connection = await new Promise<DataConnection>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off("error", onPeerError);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => {
          reject(new SessionError("connection-failed", "Il dispositivo non ha risposto in tempo."));
          this.close();
        });
      }, CONNECT_TIMEOUT_MS);

      const conn = peer.connect(peerIdForCode(this.options.code), {
        reliable: true,
        serialization: "binary",
      });

      conn.on("open", () => finish(() => resolve(conn)));
      const fail = (message: string) => finish(() => reject(new SessionError("connection-failed", message)));
      conn.on("error", () => fail("Collegamento dati non riuscito."));
      conn.on("close", () => fail("Il dispositivo ha chiuso il collegamento."));
      peer.on("disconnected", () => fail("Segnalazione interrotta prima del collegamento."));

      // Se il codice non esiste (o il servizio cade) non ha senso attendere il timeout.
      function onPeerError(error: unknown): void {
        const mapped = mapPeerError(error);
        if (mapped.code === "peer-unavailable" || mapped.code === "signaling-unreachable") {
          fail(mapped.message);
        }
      }
      peer.on("error", onPeerError);
    });

    const channel = new PeerChannel(connection);
    const messenger = new Messenger(channel, this.options.code, (message) => {
      this.options.onStatus?.({ phase: "error", detail: `Protocollo non valido: ${message}` });
    });
    this.messenger = messenger;

    this.emit("authenticating", "Verifica del codice di sicurezza…");
    await authenticateReceiver(messenger, key, this.options.code, AUTH_TIMEOUT_MS);

    if (this.closed) {
      messenger.close("Sessione chiusa.");
      throw new SessionError("closed", "Collegamento annullato.");
    }

    messenger.onClose((reason) => {
      if (this.closed) return;
      this.options.onClosed?.(reason);
    });

    // Se il mittente ripete la sfida (perché la prima risposta si è persa),
    // rispondiamo di nuovo finché il canale resta aperto.
    const unsubscribeHello = messenger.onMessage((message) => {
      if (message.t !== "hello") return;
      void createWelcomeMessage(key, this.options.code, message.n)
        .then((welcome) => {
          if (messenger.isOpen) messenger.send(welcome);
        })
        .catch(() => undefined);
    });
    messenger.onClose(() => unsubscribeHello());

    this.emit("connected", "Dispositivo collegato.");
    return { messenger, channel };
  }

  close(reason = "Sessione chiusa."): void {
    if (this.closed) return;
    this.closed = true;
    this.messenger?.close(reason);
    this.messenger = null;
    try {
      this.peer?.destroy();
    } catch {
      // Peer già distrutto.
    }
    this.peer = null;
  }

  private emit(phase: SessionPhase, detail?: string): void {
    this.options.onStatus?.({ phase, ...(detail ? { detail } : {}) });
  }
}
