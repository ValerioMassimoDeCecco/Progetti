/** Caricamento su richiesta: il decoder QR pesa e serve solo in ricezione. */
interface Decoder {
  (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
  ): { data: string } | null;
}
let decoderPromise: Promise<Decoder> | null = null;

function loadDecoder(): Promise<Decoder> {
  decoderPromise ??= import("jsqr").then((module) => module.default as unknown as Decoder);
  return decoderPromise;
}
import { normalizeCode } from "../core/base32";
import { parseSessionLink } from "../core/links";

export type ScannerState = "idle" | "starting" | "live" | "error";

interface ScannerCallbacks {
  onCode: (code: string, expiresAt: number | null) => void;
  onError: (message: string) => void;
  onState?: (state: ScannerState) => void;
}

const SCAN_INTERVAL_MS = 90;
const MAX_DECODE_WIDTH = 720;

/**
 * Lettore QR basato su getUserMedia + jsQR.
 * - richiede un gesto utente (iOS) e un contesto sicuro (HTTPS);
 * - aggiorna i frame su un canvas ridotto per contenere i consumi;
 * - ferma e libera sempre track, animazione e stream.
 */
export class QrScanner {
  private stream: MediaStream | null = null;
  private animationFrame = 0;
  private lastScan = 0;
  private running = false;
  private canvas = document.createElement("canvas");
  private torchOn = false;
  private hasTorch = false;
  private decode: Decoder | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly callbacks: ScannerCallbacks,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get isTorchAvailable(): boolean {
    return this.hasTorch;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.callbacks.onState?.("starting");

    if (!window.isSecureContext) {
      this.fail("La fotocamera richiede una connessione sicura (HTTPS).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail("Questo browser non espone l'accesso alla fotocamera.");
      return;
    }

    try {
      // La fotocamera parte subito (gesto utente recente), il decoder si carica dopo.
      const stream = await this.requestStream();
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.setAttribute("playsinline", "true");
      await this.video.play();
      this.hasTorch = this.detectTorch(stream);
      this.decode = await loadDecoder();
      this.running = true;
      this.callbacks.onState?.("live");
      this.loop();
    } catch (error) {
      this.releaseStream();
      this.fail(this.describeCameraError(error));
    }
  }

  stop(): void {
    this.running = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.releaseStream();
    this.callbacks.onState?.("idle");
  }

  async toggleTorch(): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !this.hasTorch) return false;
    try {
      this.torchOn = !this.torchOn;
      await track.applyConstraints({
        advanced: [{ torch: this.torchOn } as unknown as MediaTrackConstraintSet],
      });
      return this.torchOn;
    } catch {
      this.torchOn = false;
      this.hasTorch = false;
      return false;
    }
  }

  /** Legge un QR da un'immagine scelta dall'utente (fallback senza fotocamera). */
  static async scanImage(file: File): Promise<{ code: string; expiresAt: number | null } | null> {
    const bitmap = await QrScanner.loadBitmap(file);
    try {
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas non disponibile.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const decode = await loadDecoder();
      const result = decode(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      return result ? interpretPayload(result.data) : null;
    } finally {
      if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
    }
  }

  private async requestStream(): Promise<MediaStream> {
    const preferred: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };
    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      if (error instanceof DOMException && error.name === "OverconstrainedError") {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw error;
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    this.animationFrame = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (now - this.lastScan < SCAN_INTERVAL_MS) return;
    this.lastScan = now;

    const video = this.video;
    if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth === 0) return;

    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (width === 0 || height === 0) return;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    if (!this.decode) return;
    const result = this.decode(image.data, width, height, { inversionAttempts: "dontInvert" });
    if (!result) return;

    const interpreted = interpretPayload(result.data);
    if (!interpreted) {
      this.callbacks.onError("Il codice inquadrato non è un invito LensDrop valido.");
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.releaseStream();
    this.callbacks.onCode(interpreted.code, interpreted.expiresAt);
  };

  private detectTorch(stream: MediaStream): boolean {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== "function") return false;
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    return capabilities.torch === true;
  }

  private releaseStream(): void {
    this.torchOn = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video.srcObject) this.video.srcObject = null;
  }

  private fail(message: string): void {
    this.callbacks.onState?.("error");
    this.callbacks.onError(message);
  }

  private describeCameraError(error: unknown): string {
    if (error instanceof DOMException) {
      switch (error.name) {
        case "NotAllowedError":
        case "SecurityError":
          return "Permesso fotocamera negato. Puoi inserire il codice a mano o caricare un'immagine del QR.";
        case "NotFoundError":
        case "OverconstrainedError":
          return "Nessuna fotocamera disponibile su questo dispositivo.";
        case "NotReadableError":
          return "La fotocamera è occupata da un'altra app. Chiudila e riprova.";
        case "AbortError":
          return "Attivazione della fotocamera interrotta.";
        default:
          return `Fotocamera non disponibile (${error.name}).`;
      }
    }
    return "Impossibile attivare la fotocamera.";
  }

  private static async loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file);
      } catch {
        // Fallback sotto (HEIC o formati non decodificabili da createImageBitmap).
      }
    }
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Immagine non leggibile."));
      };
      image.src = url;
    });
  }
}

/**
 * Estrae codice e scadenza da un payload QR: link LensDrop oppure codice nudo.
 * Qualsiasi altro contenuto viene rifiutato.
 */
export function interpretPayload(
  payload: string,
): { code: string; expiresAt: number | null } | null {
  const trimmed = payload.trim();
  if (trimmed.length > 2048) return null;
  const fromLink = parseSessionLink(trimmed);
  if (fromLink) {
    return {
      code: fromLink.code,
      expiresAt: Number.isFinite(fromLink.expiresAt) ? fromLink.expiresAt : null,
    };
  }
  const direct = normalizeCode(trimmed);
  return direct ? { code: direct, expiresAt: null } : null;
}
