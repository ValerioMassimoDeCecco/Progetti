/**
 * Schermata "Invia": si sceglie cosa trasmettere, l'app mostra un flusso di QR
 * animati che il secondo telefono inquadra. Nessuna connessione, nessuna attesa
 * di conferma: il flusso continua finché il destinatario ha finito.
 */

import {
  APP_NAME,
  DENSITY_PRESETS,
  HARDWARE_DECODE_FPS_THRESHOLD,
  MAX_ITEMS,
  MAX_PAYLOAD_BYTES,
  MAX_TEXT_LENGTH,
  SPEED_PRESETS,
} from "../config";
import type { BundleItem } from "../core/bundle";
import { compressionSupported } from "../core/compression";
import {
  collectDroppedFiles,
  createTextFile,
  formatBytes,
  formatDuration,
  readBlobBytes,
  readTextPreview,
} from "../core/files";
import { FrameStream } from "../core/frame-stream";
import { effectiveFps } from "../core/pacing";
import { LT_OVERHEAD_ESTIMATE, OpticalSender } from "../core/optical";
import { loadSettings, updateSettings, type AppSettings } from "../core/settings";
import { clear, el, must, show, toast } from "./dom";
import { diagnostics } from "./diagnostics";
import { addHistory } from "./history";
import { describeFile, renderSendList, type SendItem } from "./items";
import { describeCanvas, drawFrame, preferredPixelSize, renderFrameBuffer, warmUpQr, type FrameImage } from "./qr";

type Phase = "select" | "stream";

const WARN_BYTES = 8 * 1024 * 1024;

export class SendScreen {
  private items: SendItem[] = [];
  private settings: AppSettings = loadSettings();
  private sender: OpticalSender | null = null;
  private phase: Phase = "select";
  private stream: FrameStream<FrameImage> | null = null;
  private version = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private lastUiAt = 0;
  private busy = false;
  private itemSequence = 1;

  // Canvas riusati dal pre-rendering: nessuna allocazione nel percorso critico.
  private readonly spare: HTMLCanvasElement[] = [];
  private lastUnderrunAt = 0;

  // Elementi stabili della pagina.
  private readonly selectView = must<HTMLElement>("#send-select");
  private readonly streamView = must<HTMLElement>("#send-stream");
  private readonly list = must<HTMLElement>("#send-items");
  private readonly empty = must<HTMLElement>("#send-empty");
  private readonly total = must<HTMLElement>("#send-total");
  private readonly startButton = must<HTMLButtonElement>("#send-start");
  private readonly canvas = must<HTMLCanvasElement>("#send-canvas");
  private readonly stage = must<HTMLElement>("#send-stage");
  private readonly stageHint = must<HTMLElement>("#send-stage-hint");
  private readonly frameStats = must<HTMLElement>("#send-frame-stats");
  private readonly blockStats = must<HTMLElement>("#send-block-stats");
  private readonly sessionStats = must<HTMLElement>("#send-session-stats");
  private readonly playButton = must<HTMLButtonElement>("#send-play");
  private readonly eyebrow = must<HTMLElement>("#send-eyebrow");
  private mounted = false;

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    must<HTMLInputElement>("#file-input").addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      void this.addFiles(Array.from(input.files ?? []));
      input.value = "";
    });

    must<HTMLInputElement>("#folder-input").addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      void this.addFiles(Array.from(input.files ?? []));
      input.value = "";
    });

    must<HTMLButtonElement>("#pick-files").addEventListener("click", () => {
      must<HTMLInputElement>("#file-input").click();
    });
    must<HTMLButtonElement>("#pick-folder").addEventListener("click", () => {
      must<HTMLInputElement>("#folder-input").click();
    });
    must<HTMLButtonElement>("#add-text").addEventListener("click", () => this.openTextDialog());

    const dropzone = must<HTMLElement>("#dropzone");
    dropzone.addEventListener("click", (event) => {
      if (event.target === dropzone) must<HTMLInputElement>("#file-input").click();
    });
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        must<HTMLInputElement>("#file-input").click();
      }
    });
    for (const type of ["dragenter", "dragover"] as const) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
      });
    }
    for (const type of ["dragleave", "drop"] as const) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        if (type === "dragleave" && event.target !== dropzone) return;
        dropzone.classList.remove("is-dragging");
      });
    }
    dropzone.addEventListener("drop", (event) => {
      const transfer = (event as DragEvent).dataTransfer;
      if (!transfer) return;
      void collectDroppedFiles(transfer).then((files) => this.addFiles(files));
    });

    this.startButton.addEventListener("click", () => void this.start());
    this.playButton.addEventListener("click", () => (this.stream?.isPlaying ? this.pause("manuale") : this.resume()));
    must<HTMLButtonElement>("#send-restart").addEventListener("click", () => void this.restart());
    must<HTMLButtonElement>("#send-fullscreen").addEventListener("click", () => void this.toggleFullscreen());
    must<HTMLButtonElement>("#send-back").addEventListener("click", () => this.backToSelection());

    document.addEventListener("visibilitychange", () => {
      if (this.phase !== "stream" || !this.stream?.isPlaying) return;
      if (document.hidden) {
        this.pause("scheda in background");
        diagnostics.warn("Flusso in pausa: la scheda è passata in background.");
      }
    });

    this.renderDensityOptions();
    this.renderSpeedOptions();
    diagnostics.info(`${APP_NAME}: modalità ottica, nessun collegamento di rete.`);
  }

  show(): void {
    this.mount();
    this.settings = loadSettings();
    this.syncControls();

    if (this.phase === "stream") {
      this.eyebrow.textContent = "Trasmissione · schermo";
      show(this.selectView, false);
      show(this.streamView, true);
    } else {
      this.eyebrow.textContent = "Passaggio 1 · Contenuti";
      show(this.streamView, false);
      show(this.selectView, true);
      this.refreshEstimate();
    }
  }

  hide(): void {
    if (this.phase === "stream" || this.sender) this.backToSelection();
    this.releaseWakeLock();
  }

  // ─────────────────────────── selezione contenuti ───────────────────────────

  private async addFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;

    const room = MAX_ITEMS - this.items.length;
    if (room <= 0) {
      toast(`Massimo ${MAX_ITEMS} elementi per trasferimento.`, "error");
      return;
    }

    const accepted = files.slice(0, room);
    if (files.length > room) toast(`Aggiunti i primi ${room} file: il limite è ${MAX_ITEMS}.`, "error");

    for (const file of accepted) {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const name = relative && relative.length > 0 ? relative : file.name;
      const data = await readBlobBytes(file);
      this.items.push({
        id: `item-${this.itemSequence++}`,
        name,
        mime: file.type || guessMime(name),
        size: data.byteLength,
        data,
      });
    }

    diagnostics.info(`Aggiunti ${accepted.length} file (${formatBytes(accepted.reduce((sum, f) => sum + f.size, 0))}).`);
    this.afterItemsChanged();
  }

  private openTextDialog(): void {
    const dialog = must<HTMLDialogElement>("#text-dialog");
    const input = must<HTMLTextAreaElement>("#text-input");
    const nameInput = must<HTMLInputElement>("#text-name");
    input.value = "";
    nameInput.value = "";

    const close = () => dialog.close();
    const save = () => {
      const text = input.value;
      if (text.trim().length === 0) {
        toast("Scrivi qualcosa prima di aggiungerlo.", "error");
        return;
      }
      void this.addText(text, nameInput.value.trim() || undefined);
      close();
    };

    must<HTMLButtonElement>("#text-save").onclick = save;
    must<HTMLButtonElement>("#text-cancel").onclick = close;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    dialog.showModal();
    input.focus();
  }

  private async addText(text: string, fileName?: string): Promise<void> {
    if (text.length > MAX_TEXT_LENGTH) {
      toast(`Testo troppo lungo: massimo ${MAX_TEXT_LENGTH.toLocaleString("it-IT")} caratteri.`, "error");
      return;
    }
    const file = createTextFile(text, fileName);
    const data = await readBlobBytes(file);
    this.items.push({
      id: `item-${this.itemSequence++}`,
      name: file.name,
      mime: "text/plain",
      size: data.byteLength,
      data,
    });
    diagnostics.info(`Aggiunto testo (${formatBytes(data.byteLength)}).`);
    this.afterItemsChanged();
  }

  private removeItem(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.afterItemsChanged();
  }

  private afterItemsChanged(): void {
    renderSendList(this.list, this.items, (id) => this.removeItem(id));
    this.empty.hidden = this.items.length > 0;
    const bytes = this.items.reduce((sum, item) => sum + item.size, 0);
    this.total.textContent =
      this.items.length === 0 ? "Nessun contenuto" : `${this.items.length} element${this.items.length === 1 ? "o" : "i"} · ${formatBytes(bytes)}`;
    this.startButton.disabled = this.items.length === 0;
    this.refreshEstimate();
  }

  private totalBytes(): number {
    return this.items.reduce((sum, item) => sum + item.size, 0);
  }

  // ───────────────────────────── impostazioni rapide ─────────────────────────

  private renderDensityOptions(): void {
    const holder = must<HTMLElement>("#density-options");
    clear(holder);
    for (const preset of DENSITY_PRESETS) {
      const button = el(
        "button",
        {
          className: "segmented__item",
          attrs: { type: "button", role: "radio", "data-value": String(preset.blockSize), title: preset.hint },
        },
        [
          el("span", { className: "segmented__label", text: preset.label }),
          el("span", { className: "segmented__hint", text: preset.hint }),
        ],
      );
      button.addEventListener("click", () => {
        this.settings = updateSettings({ blockSize: preset.blockSize });
        diagnostics.info(`Densità: ${preset.label} (${preset.blockSize} B per frame).`);
        this.syncControls();
        this.refreshEstimate();
      });
      holder.append(button);
    }
  }

  private renderSpeedOptions(): void {
    const holder = must<HTMLElement>("#speed-options");
    clear(holder);
    for (const preset of SPEED_PRESETS) {
      const button = el(
        "button",
        {
          className: "segmented__item",
          attrs: { type: "button", role: "radio", "data-value": String(preset.fps), title: preset.hint },
        },
        [
          el("span", { className: "segmented__label", text: preset.label }),
          el("span", { className: "segmented__hint", text: preset.hint }),
        ],
      );
      button.addEventListener("click", () => {
        this.settings = updateSettings({ fps: preset.fps });
        diagnostics.info(`Velocità: ${preset.label} (${preset.fps} fps).`);
        this.stream?.setFps(preset.fps);
        this.syncControls();
        this.refreshEstimate();
      });
      holder.append(button);
    }
  }

  private syncControls(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>("#density-options .segmented__item")) {
      const active = Number(button.dataset["value"]) === this.settings.blockSize;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("#speed-options .segmented__item")) {
      const active = Number(button.dataset["value"]) === this.settings.fps;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    }
  }

  /** Estimazione preliminare: mostra subito quanto durerà, senza illusioni. */
  private refreshEstimate(): void {
    const holder = must<HTMLElement>("#send-estimate");
    const bytes = this.totalBytes();

    if (this.items.length === 0) {
      holder.textContent = "Aggiungi un contenuto per vedere la stima.";
      return;
    }
    if (bytes > MAX_PAYLOAD_BYTES) {
      holder.textContent = `Troppo grande per il canale ottico: ${formatBytes(bytes)}. Limite prudente ${formatBytes(
        MAX_PAYLOAD_BYTES,
      )}.`;
      this.startButton.disabled = true;
      return;
    }

    const blocks = Math.ceil(bytes / this.settings.blockSize);
    // Stima prudente: frame di dati al netto dei metadati, diviso il sovraccarico
    // dei codici LT misurato con perdite realistiche di frame.
    const throughput = (this.settings.blockSize * this.settings.fps * (23 / 24)) / LT_OVERHEAD_ESTIMATE;
    const estimate = Math.round((bytes / throughput) * 1000);
    const compressible = compressionSupported() && looksCompressible(this.items);
    const parts = [
      `${formatBytes(bytes)} · ${blocks.toLocaleString("it-IT")} frame`,
      `stima ${formatDuration(estimate)}`,
    ];
    if (compressible) parts.push("compressione attiva");
    holder.textContent = parts.join(" · ");

    if (this.settings.fps >= HARDWARE_DECODE_FPS_THRESHOLD) {
      holder.textContent += " — a 30 fps il guadagno c'è solo se il destinatario decodifica in hardware (Android/Chrome).";
    }
    if (bytes > WARN_BYTES) {
      holder.textContent += " — oltre 8 MB il trasferimento ottico richiede parecchi minuti.";
    }
    this.startButton.disabled = false;
  }

  // ─────────────────────────────── trasmissione ──────────────────────────────

  private async start(): Promise<void> {
    if (this.items.length === 0 || this.sender !== null || this.busy) return;
    this.busy = true;
    this.startButton.disabled = true;

    try {
      const items: BundleItem[] = this.items.map((item) => ({ name: item.name, mime: item.mime, data: item.data }));
      const sender = await OpticalSender.create(items, { blockSize: this.settings.blockSize });
      this.sender = sender;
      this.version = 0;
      this.spare.length = 0;

      diagnostics.ok(
        `Sessione ${sender.meta.sessionId} pronta: ${formatBytes(sender.meta.size)}${
          sender.meta.compressed ? " (compresso)" : ""
        }, ${sender.meta.k} blocchi da ${sender.meta.blockSize} B, SHA-256 ${sender.meta.hash.slice(0, 12)}…`,
      );

      this.phase = "stream";
      this.eyebrow.textContent = "Trasmissione · schermo";
      show(this.selectView, false);
      show(this.streamView, true);
      must<HTMLElement>("#send-title").textContent = "Inquadra questo flusso";

      this.sessionStats.textContent = `${formatBytes(sender.meta.size)} · ${sender.meta.k} blocchi · ${
        sender.meta.compressed ? "compresso gzip" : "nessuna compressione utile"
      }`;
      this.stageHint.textContent = "Tieni lo schermo luminoso e inquadra tutto il codice.";

      this.stream = this.createStream();
      await warmUpQr();
      describeCanvas(this.canvas);
      await this.stream.prime(1);
      this.resume();
      await this.requestWakeLock();
    } catch (error) {
      diagnostics.error(`Impossibile preparare il flusso: ${error instanceof Error ? error.message : String(error)}`);
      toast(error instanceof Error ? error.message : "Impossibile preparare il flusso.", "error");
      this.startButton.disabled = false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Il flusso vero e proprio: la logica di cadenza e pre-rendering vive in
   * `FrameStream`, qui si forniscono solo testo, disegno e presentazione.
   */
  private createStream(): FrameStream<FrameImage> {
    return new FrameStream<FrameImage>({
      nextText: () => this.sender?.nextText() ?? "",
      render: (text) => this.renderFrame(text),
      present: (image) => this.presentFrame(image),
      fps: this.settings.fps,
      // Più fps richiesti, più margine serve per assorbire gli scatti del sistema.
      bufferTarget: this.settings.fps >= HARDWARE_DECODE_FPS_THRESHOLD ? 8 : 5,
      onPresent: () => this.updateStats(),
      onUnderrun: () => this.reportUnderrun(),
      onError: (error: unknown) => {
        diagnostics.error(`Disegno del frame non riuscito: ${error instanceof Error ? error.message : String(error)}`);
        this.pause("errore di disegno");
      },
    });
  }

  /** Codifica un frame su un canvas di riserva (fuori dal percorso critico). */
  private async renderFrame(text: string): Promise<FrameImage> {
    const canvas = this.spare.pop() ?? document.createElement("canvas");
    const image = await renderFrameBuffer(canvas, text, preferredPixelSize(this.canvas));
    this.reportGeometry(image, text.length);
    return image;
  }

  /** Copia il frame sul canvas visibile e ricicla il buffer. */
  private presentFrame(image: FrameImage): void {
    drawFrame(this.canvas, image);
    this.spare.push(image.canvas);
  }

  private reportGeometry(image: FrameImage, textLength: number): void {
    if (this.version === image.version) return;
    this.version = image.version;
    diagnostics.frame(
      `QR versione ${image.version} · ${image.modules}×${image.modules} moduli · ${textLength} caratteri · ${image.pixelSize}px`,
    );
  }

  private reportUnderrun(): void {
    const now = performance.now();
    if (now - this.lastUnderrunAt < 3000) return;
    this.lastUnderrunAt = now;
    const stats = this.stream?.stats;
    diagnostics.warn(
      `Coda dei frame vuota (${stats?.underruns ?? 0} volte): questo dispositivo non sostiene ${this.settings.fps} fps, il flusso scende al ritmo possibile.`,
    );
  }

  private updateStats(): void {
    const now = performance.now();
    if (now - this.lastUiAt < 180) return;
    this.lastUiAt = now;

    const sender = this.sender;
    const stream = this.stream;
    if (!sender || !stream) return;

    const stats = stream.stats;
    const rate = stats.measuredFps > 0 ? `${stats.measuredFps} fps` : `${this.settings.fps} fps`;
    this.frameStats.textContent = `frame ${stats.presented.toLocaleString("it-IT")} · ${rate}`;

    const snapshot = sender.snapshot;
    const pass = snapshot.round === 0 ? "dati" : "riparazione";
    const position = Math.min(snapshot.emitted, sender.meta.k);
    this.blockStats.textContent = `passata ${pass} · ${position}/${sender.meta.k}`;
  }

  private resume(): void {
    const stream = this.stream;
    if (!stream || stream.isPlaying) return;

    this.playButton.setAttribute("aria-label", "Metti in pausa");
    this.playButton.dataset["state"] = "playing";
    must<HTMLElement>("#send-play-label").textContent = "Pausa";

    const interval = stream.intervalMs;
    const cost = stream.stats.renderCostMs;
    if (cost > interval) {
      diagnostics.warn(
        `Ogni frame costa ${Math.round(cost)} ms ma l'intervallo richiesto è ${interval} ms: il flusso scenderà a circa ${Math.round(
          effectiveFps(this.settings.fps, cost),
        )} fps.`,
      );
    }
    diagnostics.info(
      `Flusso avviato a ${this.settings.fps} fps (intervallo ${interval} ms, ${Math.round(cost)} ms per frame).`,
    );

    stream.play();
  }

  private pause(reason: string): void {
    if (!this.stream?.isPlaying) return;
    this.stream.pause();
    this.playButton.setAttribute("aria-label", "Riprendi il flusso");
    this.playButton.dataset["state"] = "paused";
    must<HTMLElement>("#send-play-label").textContent = "Riprendi";
    diagnostics.info(`Flusso in pausa (${reason}).`);
  }

  private async restart(): Promise<void> {
    if (!this.sender) return;
    this.stop("riavvio", false);
    await this.start();
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        diagnostics.info("Schermo intero disattivato.");
        return;
      }
      await this.stage.requestFullscreen();
      diagnostics.info("Schermo intero attivo: QR il più grande possibile.");
    } catch {
      diagnostics.warn("Schermo intero non disponibile in questo browser.");
      toast("Schermo intero non supportato: aumenta la luminosità e avvicina il codice.", "error");
    }
  }

  private backToSelection(): void {
    this.stop("ritorno alla selezione");
    this.phase = "select";
    this.eyebrow.textContent = "Passaggio 1 · Contenuti";
    must<HTMLElement>("#send-title").textContent = "Cosa vuoi inviare?";
    show(this.streamView, false);
    show(this.selectView, true);
    this.afterItemsChanged();
  }

  /** Ferma il flusso e registra l'esito nella cronologia locale. */
  private stop(reason: string, navigate = true): void {
    this.pause(reason);

    const sender = this.sender;
    const stats = this.stream?.stats;
    this.stream?.stop();
    this.stream = null;
    this.sender = null;
    this.spare.length = 0;
    this.releaseWakeLock();

    if (sender && stats) {
      const completePass = stats.produced >= sender.meta.k;
      addHistory({
        direction: "out",
        outcome: completePass ? "ok" : "cancelled",
        totalBytes: sender.meta.size,
        files: this.items.map((item) => ({ name: item.name, size: item.size })),
      });
      diagnostics.info(
        `Trasmissione fermata (${reason}) dopo ${stats.produced} frame preparati, ${stats.presented} mostrati, ${
          stats.underruns
        } attese${completePass ? "; almeno una passata completa trasmessa" : ""}.`,
      );
    }

    if (navigate) this.startButton.disabled = this.items.length === 0;
  }

  private async requestWakeLock(): Promise<void> {
    if (!this.settings.keepAwake) return;
    const wakeLock = (navigator as unknown as { wakeLock?: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock;
    if (!wakeLock) {
      diagnostics.info("Wake Lock non disponibile: evita che lo schermo si spenga manualmente.");
      return;
    }
    try {
      this.wakeLock = await wakeLock.request("screen");
      diagnostics.info("Schermo mantenuto accesso durante la trasmissione.");
    } catch {
      diagnostics.warn("Il browser ha negato il blocco dello spegnimento dello schermo.");
    }
  }

  private releaseWakeLock(): void {
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  /** Anteprima del testo scelto: usata dal test di interfaccia. */
  async previewText(item: SendItem): Promise<string> {
    return readTextPreview(new Blob([item.data], { type: "text/plain" }), 400);
  }

  describe(item: SendItem): string {
    return describeFile(item.size, item.mime, item.name);
  }
}

function looksCompressible(items: SendItem[]): boolean {
  const textish = items.filter((item) =>
    /^(text\/|application\/(json|xml|javascript|pdf)|image\/svg)/.test(item.mime),
  );
  const bytes = textish.reduce((sum, item) => sum + item.size, 0);
  return bytes > 0 && bytes >= items.reduce((sum, item) => sum + item.size, 0) * 0.5;
}

function guessMime(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    zip: "application/zip",
  };
  return map[extension] ?? "application/octet-stream";
}
