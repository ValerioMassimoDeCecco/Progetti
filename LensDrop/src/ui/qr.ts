/**
 * Disegno dei frame QR.
 *
 * Due scelte che contano a 30 fps:
 * 1. **Base45**: l'alfabeto è quello della modalità alfanumerica dei QR (11 bit
 *    ogni 2 caratteri invece di 8 bit per carattere), quindi entrano circa un
 *    terzo di byte in più per frame.
 * 2. **Scala intera e buffer separati**: la matrice viene disegnata con un
 *    numero intero di pixel per modulo (moduli nitidi e tutti uguali) su un
 *    canvas fuori schermo, e solo in un secondo momento copiata sul canvas
 *    visibile. La codifica — la parte costosa — avviene quindi in anticipo,
 *    fuori dal percorso critico del frame.
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
      scale?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<void>;
}

/** Moduli di quiet zone per lato: il minimo dello standard è 4 in totale. */
const QUIET_MODULES = 2;
/** Lato massimo del buffer QR, per non sprecare memoria su schermi grandi. */
const MAX_PIXELS = 900;
/** Lato indicativo predefinito quando non si conosce il contenitore. */
const TARGET_PIXELS = 560;
/** Un modulo più piccolo di così diventa fragile per la fotocamera. */
const MIN_MODULE_SCALE = 3;
const MAX_MODULE_SCALE = 14;

const DARK = "#0a0f1cff";
const LIGHT = "#ffffffff";

let modulePromise: Promise<QrModule> | null = null;

function loadQrCode(): Promise<QrModule> {
  modulePromise ??= import("qrcode").then((module) => module.default as unknown as QrModule);
  return modulePromise;
}

/** Carica la libreria QR una volta sola, così il primo frame non paga il costo. */
export async function warmUpQr(): Promise<void> {
  await loadQrCode();
}

export interface FrameImage {
  /** Canvas fuori schermo con il frame già disegnato. */
  canvas: HTMLCanvasElement;
  /** Versione del codice QR (1–40). */
  version: number;
  /** Lato in moduli, quiet zone inclusa. */
  modules: number;
  /** Lato in pixel del canvas. */
  pixelSize: number;
}

/**
 * Sceglie il lato del canvas come multiplo esatto dei moduli: così ogni modulo
 * occupa lo stesso numero intero di pixel. Un fattore frazionario produce
 * moduli di larghezza diversa, che la fotocamera legge peggio.
 */
export function planPixelSize(totalModules: number, desiredPixels: number): { scale: number; pixelSize: number } {
  const modules = Math.max(1, Math.round(totalModules));
  const desired = Number.isFinite(desiredPixels) ? Math.max(160, desiredPixels) : TARGET_PIXELS;
  const scale = Math.min(MAX_MODULE_SCALE, Math.max(MIN_MODULE_SCALE, Math.round(desired / modules)));
  return { scale, pixelSize: modules * scale };
}

/**
 * Disegna `text` in un canvas dedicato e restituisce il buffer pronto.
 * `desiredPixels` è il lato indicativo: il risultato è il multiplo di moduli più
 * vicino, così ogni modulo occupa un numero intero di pixel.
 */
export async function renderFrameBuffer(canvas: HTMLCanvasElement, text: string, desiredPixels = TARGET_PIXELS): Promise<FrameImage> {
  const QRCode = await loadQrCode();
  const created = QRCode.create(text, { errorCorrectionLevel: "L" });
  const totalModules = created.modules.size + QUIET_MODULES * 2;

  const { scale, pixelSize } = planPixelSize(totalModules, desiredPixels);

  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: "L",
    margin: QUIET_MODULES,
    scale,
    color: { dark: DARK, light: LIGHT },
  });

  return { canvas, version: created.version, modules: totalModules, pixelSize };
}

/**
 * Copia il frame sul canvas visibile. Se il frame è più piccolo dell'area
 * (tipico dei metadati, che hanno meno dati) viene centrato; il canvas viene
 * ridimensionato solo quando serve davvero, non a ogni frame.
 */
export function drawFrame(target: HTMLCanvasElement, image: FrameImage): void {
  if (target.width !== image.pixelSize || target.height !== image.pixelSize) {
    if (target.width < image.pixelSize) {
      target.width = image.pixelSize;
      target.height = image.pixelSize;
    }
  }

  const context = target.getContext("2d");
  if (!context) return;

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, target.width, target.height);

  const offset = Math.floor((target.width - image.pixelSize) / 2);
  context.drawImage(image.canvas, offset, offset);
}

/**
 * Lato indicativo per il buffer: si parte dalla dimensione in CSS pixel del
 * canvas visibile, così il browser fa un ridimensionamento piccolo e non
 * distruttivo (ingrandire troppo e poi rimpicciolire con nearest-neighbour
 * consuma memoria e può cancellare intere colonne di moduli).
 */
export function preferredPixelSize(canvas: HTMLCanvasElement): number {
  const cssSize = Math.max(160, Math.floor(canvas.clientWidth || canvas.width || 320));
  return Math.min(MAX_PIXELS, cssSize);
}

/** Etichette di accessibilità del canvas: impostate una volta, non a ogni frame. */
export function describeCanvas(canvas: HTMLCanvasElement): void {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Flusso di codici QR con i dati da trasferire");
}

/** Versione del QR che verrebbe usata per un testo, senza disegnarlo. */
export async function versionFor(text: string): Promise<number> {
  const QRCode = await loadQrCode();
  return QRCode.create(text, { errorCorrectionLevel: "L" }).version;
}

export function clearCanvas(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}
