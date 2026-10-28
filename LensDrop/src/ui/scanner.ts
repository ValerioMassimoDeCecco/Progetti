/**
 * Lettore ottico: fotocamera + decodifica QR.
 *
 * Due strade, scelte a runtime:
 * 1. `BarcodeDetector` nativo (Chrome/Android): decodifica hardware, molto veloce;
 * 2. `jsQR` in WebAssembly/JS (Safari, Firefox): più lento, quindi il frame viene
 *    ridotto prima della decodifica e non si accumulano frame in coda.
 *
 * Ogni frame scartato (mosso, sfocato, controluce) è normale: il protocollo
 * fountain non richiede una sequenza precisa. Per questo la diagnostica registra
 * il ritmo di decodifica invece di trattare i frame persi come errori.
 */

import { diagnostics } from "./diagnostics";

interface Decoder {
  (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
  ): { data: string } | null;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

let decoderPromise: Promise<Decoder> | null = null;

function loadDecoder(): Promise<Decoder> {
  decoderPromise ??= import("jsqr").then((module) => module.default as unknown as Decoder);
  return decoderPromise;
}

export type ScannerState = "idle" | "starting" | "live" | "error";

export interface ScannerStats {
  /** Frame al secondo effettivamente decodificati. */
  decodeRate: number;
  /** QR riconosciuti in totale. */
  hits: number;
  /** Frame processati senza QR. */
  misses: number;
}

interface ScannerCallbacks {
  onText: (text: string) => void;
  onError: (message: string) => void;
  onState?: (state: ScannerState) => void;
  onStats?: (stats: ScannerStats) => void;
}

/** Larghezza massima del frame passato a jsQR: oltre si perde solo tempo. */
const MAX_DECODE_WIDTH = 780;
const MIN_DECODE_INTERVAL_MS = 33;

export class OpticalScanner {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private detector: BarcodeDetectorLike | null = null;
  private decode: Decoder | null = null;
  private canvas = document.createElement("canvas");
  private frameHandle = 0;
  private running = false;
  private busy = false;
  private lastDecodeAt = 0;
  private torchOn = false;
  private hits = 0;
  private misses = 0;
  private decodedTimestamps: number[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly callbacks: ScannerCallbacks,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get hasTorch(): boolean {
    const capabilities = this.track?.getCapabilities?.() as { torch?: boolean } | undefined;
    return capabilities?.torch === true;
  }

  get stats(): ScannerStats {
    const now = Date.now();
    this.decodedTimestamps = this.decodedTimestamps.filter((at) => now - at < 2000);
    return {
      decodeRate: this.decodedTimestamps.length / 2,
      hits: this.hits,
      misses: this.misses,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!window.isSecureContext) {
      this.fail("La fotocamera richiede HTTPS (o localhost).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail("Questo browser non espone la fotocamera (getUserMedia assente).");
      return;
    }

    this.callbacks.onState?.("starting");
    diagnostics.info("Richiesta accesso alla fotocamera…");

    try {
      this.stream = await this.requestStream();
    } catch (error) {
      this.fail(describeCameraError(error));
      return;
    }

    const [track] = this.stream.getVideoTracks();
    if (!track) {
      this.fail("Nessuna traccia video disponibile.");
      return;
    }
    this.track = track;

    const settings = track.getSettings();
    diagnostics.ok(
      `Fotocamera attiva: ${track.label || "sconosciuta"} · ${settings.width ?? "?"}×${settings.height ?? "?"} · ${
        this.hasTorch ? "torcia disponibile" : "senza torcia"
      }`,
    );

    // La messa a fuoco continua è ciò che rende leggibile un QR in movimento.
    try {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
    } catch {
      diagnostics.info("Messa a fuoco continua non supportata: uso l'impostazione predefinita.");
    }

    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "true");
    this.video.muted = true;

    try {
      await this.video.play();
    } catch {
      this.fail("Il browser ha bloccato la riproduzione del video: tocca di nuovo il pulsante.");
      return;
    }

    await this.prepareDetector();

    this.running = true;
    this.callbacks.onState?.("live");
    diagnostics.ok("Scansione avviata.");
    this.schedule();
  }

  private async requestStream(): Promise<MediaStream> {
    const preferred: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    };

    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      // Alcuni browser rifiutano i vincoli ideali: si riprova con la camera di default.
      if (error instanceof DOMException && (error.name === "OverconstrainedError" || error.name === "NotFoundError")) {
        diagnostics.warn("Camera posteriore non disponibile: provo la fotocamera predefinita.");
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      throw error;
    }
  }

  private async prepareDetector(): Promise<void> {
    const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (ctor) {
      try {
        const formats = (await ctor.getSupportedFormats?.()) ?? ["qr_code"];
        if (formats.includes("qr_code")) {
          this.detector = new ctor({ formats: ["qr_code"] });
          diagnostics.ok("Decodifica hardware (BarcodeDetector) disponibile.");
          return;
        }
      } catch {
        // Si passa al decoder software.
      }
    }
    this.decode = await loadDecoder();
    diagnostics.info("Decodifica software (jsQR): il frame rate effettivo dipende dal processore.");
  }

  private schedule(): void {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(() => {
      void this.tick();
    });
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = performance.now();
    if (this.busy || this.video.readyState < 2 || now - this.lastDecodeAt < MIN_DECODE_INTERVAL_MS) {
      this.schedule();
      return;
    }

    this.busy = true;
    this.lastDecodeAt = now;

    try {
      const values = await this.decodeFrame();
      for (const value of values) {
        if (!value) continue;
        this.hits += 1;
        this.decodedTimestamps.push(Date.now());
        this.callbacks.onText(value);
      }
      if (values.length === 0) this.misses += 1;
    } catch (error) {
      diagnostics.warn(`Errore di decodifica: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      this.callbacks.onStats?.(this.stats);
      this.schedule();
    }
  }

  private async decodeFrame(): Promise<string[]> {
    if (this.detector) {
      const codes = await this.detector.detect(this.video);
      return codes.map((code) => code.rawValue);
    }

    const decode = this.decode;
    if (!decode) return [];

    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width === 0 || height === 0) return [];

    const scale = Math.min(1, MAX_DECODE_WIDTH / width);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];

    context.drawImage(this.video, 0, 0, targetWidth, targetHeight);
    const image = context.getImageData(0, 0, targetWidth, targetHeight);
    const result = decode(image.data, targetWidth, targetHeight, { inversionAttempts: "dontInvert" });
    return result ? [result.data] : [];
  }

  async setTorch(on: boolean): Promise<boolean> {
    if (!this.track || !this.hasTorch) return this.torchOn;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      this.torchOn = on;
      diagnostics.info(`Torcia ${on ? "accesa" : "spenta"}.`);
    } catch {
      diagnostics.warn("Il browser ha rifiutato il controllo della torcia.");
    }
    return this.torchOn;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.busy = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;

    if (this.torchOn) await this.setTorch(false);

    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
    this.detector = null;
    this.callbacks.onState?.("idle");
    diagnostics.info("Fotocamera rilasciata.");
  }

  private fail(message: string): void {
    this.running = false;
    this.callbacks.onState?.("error");
    this.callbacks.onError(message);
    diagnostics.error(`Fotocamera: ${message}`);
    void this.stop();
  }
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "Permesso fotocamera negato: riabilitalo nelle impostazioni del sito e riprova.";
      case "NotFoundError":
        return "Nessuna fotocamera trovata su questo dispositivo.";
      case "NotReadableError":
        return "La fotocamera è occupata da un'altra app o scheda.";
      case "OverconstrainedError":
        return "La fotocamera richiesta non esiste: provo con quella predefinita.";
      case "SecurityError":
        return "La fotocamera è bloccata dal browser in questa pagina (serve HTTPS).";
      default:
        return `Accesso alla fotocamera non riuscito (${error.name}).`;
    }
  }
  return error instanceof Error ? error.message : "Accesso alla fotocamera non riuscito.";
}
