/**
 * Flusso di frame a cadenza fissa con pre-rendering.
 *
 * Il problema a 30 fps è che la codifica di un QR costa più di quanto si possa
 * permettere fra due frame: se il timer aspettasse il disegno, ogni frame
 * arriverebbe 33 ms + costo, e il flusso reale crollerebbe. Qui un produttore
 * prepara i frame in anticipo (fino a `bufferTarget`) e un consumatore mostra
 * quello dovuto sulla scadenza esatta, riallineandosi se il dispositivo è in
 * ritardo invece di "recuperare" con una raffica.
 *
 * Orologio e timer sono iniettabili: i test verificano la cadenza in tempo
 * virtuale, senza dipendere dalla velocità della macchina.
 */

import { frameIntervalMs, planNextTick } from "./pacing";

function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Frame rate non valido.");
  }
}

export interface FrameStreamStats {
  /** Frame preparati (possono essere più di quelli mostrati: sono in coda). */
  produced: number;
  /** Frame effettivamente mostrati. */
  presented: number;
  /** Volte in cui la coda si è svuotata: il dispositivo non tiene il passo. */
  underruns: number;
  /** Costo dell'ultima preparazione, in millisecondi. */
  renderCostMs: number;
  /** Frame al secondo misurati sull'ultima finestra. */
  measuredFps: number;
}

export interface FrameStreamOptions<T> {
  /** Testo del frame successivo (consuma la sequenza). */
  nextText: () => string;
  /** Prepara un frame: è la parte costosa, eseguita fuori dal percorso critico. */
  render: (text: string) => Promise<T>;
  /** Mostra un frame già pronto. */
  present: (frame: T) => void;
  fps: number;
  bufferTarget?: number;
  onPresent?: (stats: FrameStreamStats) => void;
  onUnderrun?: (stats: FrameStreamStats) => void;
  onError?: (error: unknown) => void;
  // Iniezioni per i test.
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => number;
  clearTimer?: (handle: number) => void;
}

const DEFAULT_BUFFER_TARGET = 5;
/** Attesa breve quando la coda è vuota: si ritenta senza perdere la cadenza. */
const STARVE_RETRY_MS = 8;
/** Finestra di misura del frame rate reale. */
const FPS_WINDOW_MS = 750;

export class FrameStream<T> {
  private readonly queue: T[] = [];
  private readonly counters: FrameStreamStats = {
    produced: 0,
    presented: 0,
    underruns: 0,
    renderCostMs: 0,
    measuredFps: 0,
  };

  private producing = false;
  private playing = false;
  private timer: number | null = null;
  private dueAt = 0;
  private windowAt = 0;
  private windowFrames = 0;

  private fps: number;
  private buffer: number;

  constructor(private readonly options: FrameStreamOptions<T>) {
    assertFps(options.fps);
    this.fps = options.fps;
    this.buffer = Math.max(2, options.bufferTarget ?? DEFAULT_BUFFER_TARGET);
  }

  get stats(): FrameStreamStats {
    return { ...this.counters };
  }

  get buffered(): number {
    return this.queue.length;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get intervalMs(): number {
    return frameIntervalMs(this.fps);
  }

  /**
   * Cambia la cadenza a flusso avviato: la schermata di invio permette di
   * scegliere la velocità mentre trasmette, e la scelta deve valere subito
   * (con una nuova scadenza a partire da adesso, senza raffiche di recupero).
   */
  setFps(fps: number): void {
    assertFps(fps);
    if (fps === this.fps) return;
    this.fps = fps;
    if (!this.playing) return;
    this.cancelTimer();
    this.dueAt = this.now();
    this.windowAt = this.dueAt;
    this.windowFrames = this.counters.presented;
    this.counters.measuredFps = 0;
    this.produce();
    this.tick();
  }

  /** Prepara i primi frame e misura il costo di uno. Richiede un `fps` valido. */
  async prime(count = 1): Promise<void> {
    for (let index = 0; index < Math.max(1, count); index += 1) {
      const frame = await this.renderNext();
      this.queue.push(frame);
    }
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    const now = this.now();
    this.dueAt = now;
    this.windowAt = now;
    this.windowFrames = this.counters.presented;
    this.counters.measuredFps = 0;
    this.produce();
    this.tick();
  }

  pause(): void {
    this.playing = false;
    this.cancelTimer();
  }

  /** Ferma tutto e libera la coda. */
  stop(): void {
    this.pause();
    this.queue.length = 0;
    this.producing = false;
  }

  // ─────────────────────────────── interni ────────────────────────────────

  private get bufferTarget(): number {
    return this.buffer;
  }

  private now(): number {
    return this.options.now ? this.options.now() : performance.now();
  }

  private setTimer(callback: () => void, delay: number): number {
    if (this.options.setTimer) return this.options.setTimer(callback, delay);
    return window.setTimeout(callback, delay);
  }

  private clearTimer(handle: number): void {
    if (this.options.clearTimer) this.options.clearTimer(handle);
    else window.clearTimeout(handle);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private async renderNext(): Promise<T> {
    const text = this.options.nextText();
    const startedAt = this.now();
    const frame = await this.options.render(text);
    this.counters.renderCostMs = Math.max(0, this.now() - startedAt);
    this.counters.produced += 1;
    return frame;
  }

  /** Riempie la coda in modo sequenziale finché c'è spazio. */
  private produce(): void {
    if (this.producing || !this.playing) return;
    this.producing = true;

    const step = (): void => {
      if (!this.producing || !this.playing) {
        this.producing = false;
        return;
      }
      if (this.queue.length >= this.bufferTarget) {
        this.producing = false;
        return;
      }

      void this.renderNext()
        .then((frame) => {
          if (!this.playing) {
            this.producing = false;
            return;
          }
          this.queue.push(frame);
          step();
        })
        .catch((error: unknown) => {
          this.producing = false;
          this.options.onError?.(error);
        });
    };

    step();
  }

  private tick(): void {
    if (!this.playing) return;
    const interval = this.intervalMs;
    const frame = this.queue.shift();

    if (frame === undefined) {
      // Coda vuota: il dispositivo non sta al passo. Si conta l'evento (utile in
      // diagnostica) e si ritenta fra poco ripartendo dall'istante attuale.
      if (this.counters.presented > 0) {
        this.counters.underruns += 1;
        this.options.onUnderrun?.(this.stats);
      }
      this.dueAt = this.now();
      this.produce();
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.tick();
      }, Math.min(interval, STARVE_RETRY_MS));
      return;
    }

    this.options.present(frame);
    this.counters.presented += 1;
    this.measureFps();
    this.options.onPresent?.(this.stats);

    const plan = planNextTick(this.dueAt, this.now(), interval);
    this.dueAt = plan.dueAt;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.tick();
    }, plan.delay);

    this.produce();
  }

  private measureFps(): void {
    const now = this.now();
    const elapsed = now - this.windowAt;
    if (elapsed < FPS_WINDOW_MS) return;
    this.counters.measuredFps = Math.round(((this.counters.presented - this.windowFrames) * 1000) / elapsed);
    this.windowAt = now;
    this.windowFrames = this.counters.presented;
  }
}
