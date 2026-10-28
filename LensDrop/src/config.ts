/**
 * Costanti dell'applicazione.
 *
 * Il canale è ottico: schermo → fotocamera. Non c'è rete tra i due dispositivi,
 * quindi ogni costante qui sotto è un compromesso tra densità del QR (più byte
 * per frame) e affidabilità di lettura (più moduli, più sfocatura).
 */

export const APP_NAME = "LensDrop";
export const APP_TAGLINE = "Passa tutto. Basta uno sguardo.";

/** Versione del protocollo: cambia solo se cambia il formato dei frame. */
export const PROTOCOL_VERSION = 1;

/**
 * Densità proposte: byte di payload per frame.
 * - 520  → QR compatto (v16), si legge anche da lontano o con poca luce
 * - 700  → equilibrio predefinito (v19), circa 3,9 px per modulo su 360 px
 * - 1200 → massima velocità (v25), richiede schermo luminoso e mano ferma
 */
export interface DensityPreset {
  id: string;
  label: string;
  hint: string;
  blockSize: number;
}

export const DENSITY_PRESETS: DensityPreset[] = [
  { id: "compatto", label: "Compatto", hint: "Massima distanza, più lento", blockSize: 520 },
  { id: "equilibrato", label: "Equilibrato", hint: "Scelta consigliata", blockSize: 700 },
  { id: "denso", label: "Denso", hint: "Più veloce, serve mano ferma", blockSize: 1200 },
];

export const DEFAULT_BLOCK_SIZE = 700;

/** Frame al secondo proposti per il flusso animato. */
export interface SpeedPreset {
  id: string;
  label: string;
  hint: string;
  fps: number;
}

export const SPEED_PRESETS: SpeedPreset[] = [
  { id: "lenta", label: "Lenta", hint: "4 fps · fotocamere lente", fps: 4 },
  { id: "normale", label: "Normale", hint: "8 fps · consigliata", fps: 8 },
  { id: "veloce", label: "Veloce", hint: "14 fps · dispositivi recenti", fps: 14 },
  { id: "massima", label: "Massima", hint: "30 fps · serve decodifica hardware", fps: 30 },
];

/**
 * Frame al secondo oltre i quali il guadagno dipende solo dal destinatario:
 * senza `BarcodeDetector` (iOS/Safari) jsQR decodifica ~10–15 frame/s, quindi
 * un flusso più veloce non aumenta la velocità di ricezione.
 */
export const HARDWARE_DECODE_FPS_THRESHOLD = 20;

export const DEFAULT_FPS = 8;

/** Limite di sicurezza sul payload complessivo di una sessione ottica. */
export const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

/** Numero massimo di elementi per sessione. */
export const MAX_ITEMS = 200;

/** Lunghezza massima del testo condiviso come file .txt. */
export const MAX_TEXT_LENGTH = 200_000;

/** Righe di log conservate in memoria per la diagnostica. */
export const MAX_LOG_LINES = 400;

/** Intervallo minimo tra due aggiornamenti dell'interfaccia in ricezione. */
export const UI_UPDATE_INTERVAL_MS = 200;
