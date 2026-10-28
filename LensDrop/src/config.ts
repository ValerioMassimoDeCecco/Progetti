/**
 * Costanti condivise dall'applicazione.
 * Le dimensioni sono scelte per restare dentro i limiti dei DataChannel
 * e del serializzatore binario di PeerJS (16.300 byte per messaggio).
 */

export const APP_NAME = "LensDrop";
export const APP_TAGLINE = "Passa tutto. Basta uno sguardo.";

/** Versione del protocollo applicativo, trasmessa in ogni messaggio. */
export const PROTOCOL_VERSION = 1;

/** Prefisso degli identificatori PeerJS derivati dal codice di sessione. */
export const PEER_PREFIX = "lensdrop";

/** Durata di validità di un codice QR: oltre, la sessione rifiuta nuove connessioni. */
export const SESSION_TTL_MS = 10 * 60 * 1000;

/** Payload massimo di un singolo blocco (PeerJS accetta al massimo 16.300 byte). */
export const CHUNK_SIZE = 16_000;

/** Intestazione binaria dei blocchi: indice file, sequenza, lunghezza (4 byte ciascuno). */
export const CHUNK_HEADER_SIZE = 12;

/** Soglia di backpressure: sopra questo valore si attende che il canale si svuoti. */
export const SEND_HIGH_WATER_BYTES = 4 * 1024 * 1024;

/** Numero massimo di elementi per sessione. */
export const MAX_ITEMS = 200;

/** Dimensione massima dichiarabile per un singolo elemento (10 GiB). */
export const MAX_ITEM_BYTES = 10 * 1024 * 1024 * 1024;

/** Dimensione massima dichiarabile per una sessione (20 GiB). */
export const MAX_SESSION_BYTES = 20 * 1024 * 1024 * 1024;

/** Lunghezza massima del nome di un file ricevuto. */
export const MAX_NAME_LENGTH = 255;

/** Lunghezza massima del testo condiviso come file .txt. */
export const MAX_TEXT_LENGTH = 200_000;

/** Timeout del handshake crittografico. */
export const AUTH_TIMEOUT_MS = 20_000;

/** Timeout per l'apertura del canale dati dopo la segnalazione. */
export const CONNECT_TIMEOUT_MS = 35_000;

/** Timeout in cui il mittente attende la conferma del destinatario. */
export const ACCEPT_TIMEOUT_MS = 3 * 60 * 1000;

/** Timeout di inattività durante l'invio di un file. */
export const TRANSFER_IDLE_TIMEOUT_MS = 90_000;

/** Intervallo di emissione degli eventi di avanzamento. */
export const PROGRESS_INTERVAL_MS = 120;

export interface IceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Server ICE predefiniti: STUN pubblico Google + TURN dimostrativo distribuito
 * con PeerJS. Il TURN demo non ha garanzie di disponibilità: chi ne ha bisogno
 * può configurare il proprio in Impostazioni (nessuna credenziale è nel codice).
 */
export const DEFAULT_ICE_SERVERS: IceServerLike[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
    username: "peerjs",
    credential: "peerjsp",
  },
];

/** Configurazione predefinita del server di segnalazione (PeerJS Cloud pubblico). */
export const DEFAULT_SIGNALING = {
  mode: "cloud" as const,
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  key: "peerjs",
  secure: true,
};
