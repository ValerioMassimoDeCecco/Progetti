/**
 * Disegno dei frame QR.
 *
 * La modalità alfanumerica dei QR codifica 11 bit ogni 2 caratteri: usando
 * Base45 (alfabeto compatibile) si guadagna circa un terzo di byte rispetto
 * alla modalità byte. La correzione d'errore resta bassa (L) perché i byte
 * ridondanti sono già forniti dai simboli di riparazione fountain.
 */

interface QrModule {
  create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): {
    version: number;
    modules: { size: number };
  };
  toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: {
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<void>;
}

let modulePromise: Promise<QrModule> | null = null;

function loadQrCode(): Promise<QrModule> {
  modulePromise ??= import("qrcode").then((module) => module.default as unknown as QrModule);
  return modulePromise;
}

export interface RenderedFrame {
  /** Versione del codice QR (1–40): utile per la diagnostica. */
  version: number;
  /** Lato in moduli, esclusa la quiet zone. */
  modules: number;
}

/**
 * Rende un frame sul canvas, adattandolo al contenitore e alla densità dello
 * schermo. Restituisce i metadati del codice per il pannello di diagnostica.
 */
export async function renderFrame(canvas: HTMLCanvasElement, text: string): Promise<RenderedFrame> {
  const QRCode = await loadQrCode();

  const cssSize = Math.max(160, Math.floor(canvas.clientWidth || canvas.width || 320));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelSize = Math.round(cssSize * ratio);
  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize;
    canvas.height = pixelSize;
  }

  const created = QRCode.create(text, { errorCorrectionLevel: "L" });
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: "L",
    margin: 2,
    width: pixelSize,
    color: { dark: "#0a0f1cff", light: "#ffffffff" },
  });

  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Flusso di codici QR con i dati da trasferire");

  return { version: created.version, modules: created.modules.size };
}

/** Versione del QR che verrebbe usata per un testo, senza disegnarlo. */
export async function versionFor(text: string): Promise<number> {
  const QRCode = await loadQrCode();
  return QRCode.create(text, { errorCorrectionLevel: "L" }).version;
}

export function clearCanvas(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}
