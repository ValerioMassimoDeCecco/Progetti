/**
 * Schermata "Ricevi": la fotocamera inquadra lo schermo del mittente e
 * ricostruisce il contenuto. L'avanzamento mostrato è quello reale del
 * decodificatore (blocchi risolti su blocchi totali), non una stima gonfiata.
 */

import { UI_UPDATE_INTERVAL_MS } from "../config";
import type { BundleItem } from "../core/bundle";
import { formatBytes, formatDuration, formatSpeed, isSecureContextAvailable } from "../core/files";
import { OpticalReceiver } from "../core/optical";
import { loadSettings } from "../core/settings";
import { confirmDialog, must, setText, show, toast } from "./dom";
import { diagnostics } from "./diagnostics";
import { addHistory } from "./history";
import { createReceivedRow } from "./items";
import { OpticalScanner, type ScannerState } from "./scanner";

export class ReceiveScreen {
  private readonly receiver = new OpticalReceiver();
  private scanner: OpticalScanner | null = null;
  private state: ScannerState = "idle";
  private finishing = false;
  private completed = false;
  private lastUiAt = 0;
  private samples: { at: number; bytes: number }[] = [];
  private previewUrls: string[] = [];
  private records: BundleItem[] = [];
  private mounted = false;

  private readonly scanView = must<HTMLElement>("#receive-scan");
  private readonly progressView = must<HTMLElement>("#receive-progress");
  private readonly resultView = must<HTMLElement>("#receive-result");
  private readonly video = must<HTMLVideoElement>("#scan-video");
  private readonly stage = must<HTMLElement>("#scan-stage");
  private readonly stateText = must<HTMLElement>("#scan-state");
  private readonly startButton = must<HTMLButtonElement>("#scan-start");
  private readonly stopButton = must<HTMLButtonElement>("#scan-stop");
  private readonly torchButton = must<HTMLButtonElement>("#scan-torch");
  private readonly percent = must<HTMLElement>("#receive-percent");
  private readonly bar = must<HTMLElement>("#receive-bar");
  private readonly details = must<HTMLElement>("#receive-details");
  private readonly headline = must<HTMLElement>("#receive-headline");
  private readonly resultList = must<HTMLElement>("#receive-items");
  private readonly resultSummary = must<HTMLElement>("#receive-summary");
  private readonly eyebrow = must<HTMLElement>("#receive-eyebrow");

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    this.startButton.addEventListener("click", () => void this.startCamera());
    this.stopButton.addEventListener("click", () => void this.stopCamera("richiesta dell'utente"));
    this.torchButton.addEventListener("click", () => void this.toggleTorch());
    must<HTMLButtonElement>("#receive-restart").addEventListener("click", () => this.resetTransfer());
    must<HTMLButtonElement>("#receive-new").addEventListener("click", () => this.resetTransfer());
    must<HTMLButtonElement>("#receive-save-all").addEventListener("click", () => this.saveAll());

    diagnostics.info("Schermata di ricezione pronta: serve solo la fotocamera.");

    if (!isSecureContextAvailable()) {
      this.stateText.textContent = "Serve HTTPS per usare la fotocamera.";
      this.startButton.disabled = true;
      diagnostics.error("Contesto non sicuro: getUserMedia è disponibile solo in HTTPS.");
    }
  }

  show(): void {
    this.mount();
    this.eyebrow.textContent = this.completed ? "Trasferimento completato" : "Inquadra il flusso QR";
    if (this.state === "live") this.startButton.disabled = true;
  }

  hide(): void {
    void this.stopCamera("uscita dalla schermata");
  }

  private async startCamera(): Promise<void> {
    if (this.scanner?.isRunning) return;

    this.startButton.disabled = true;
    this.stateText.textContent = "Attivazione fotocamera…";

    const scanner = new OpticalScanner(this.video, {
      onText: (text) => this.handleText(text),
      onError: (message) => {
        this.stateText.textContent = message;
        this.startButton.disabled = false;
        toast(message, "error");
      },
      onState: (state) => this.handleState(state),
      onStats: () => {
        // Il ritmo di decodifica è utile soprattutto in diagnostica.
        const stats = scanner.stats;
        if (stats.hits + stats.misses > 0 && (stats.hits + stats.misses) % 40 === 0) {
          diagnostics.frame(`Decodifica: ${stats.decodeRate.toFixed(1)} fps · ${stats.hits} letture, ${stats.misses} scarti.`);
        }
      },
    });

    this.scanner = scanner;
    await scanner.start();

    if (scanner.isRunning) {
      this.startButton.disabled = true;
      this.stopButton.hidden = false;
      this.torchButton.hidden = !scanner.hasTorch;
      show(this.progressView, true);
    } else {
      this.startButton.disabled = false;
    }
  }

  private async stopCamera(reason: string): Promise<void> {
    if (!this.scanner) return;
    const scanner = this.scanner;
    this.scanner = null;
    await scanner.stop();
    this.stopButton.hidden = true;
    this.torchButton.hidden = true;
    this.startButton.disabled = false;
    this.stateText.textContent = "Fotocamera spenta.";
    diagnostics.info(`Scansione interrotta (${reason}).`);
  }

  private async toggleTorch(): Promise<void> {
    const scanner = this.scanner;
    if (!scanner) return;
    const on = await scanner.setTorch(!scanner.stats ? false : this.torchButton.dataset["on"] !== "true");
    this.torchButton.dataset["on"] = String(on);
    this.torchButton.setAttribute("aria-pressed", String(on));
    this.torchButton.classList.toggle("is-active", on);
  }

  private handleState(state: ScannerState): void {
    this.state = state;
    if (state === "live") {
      this.stage.classList.add("is-live");
      this.stateText.textContent = "Inquadra il codice sull'altro telefono.";
    }
    if (state === "idle") {
      this.stage.classList.remove("is-live");
    }
  }

  /** Ogni QR letto passa di qui: la logica di protocollo sta nel core. */
  private handleText(text: string): void {
    if (this.completed || this.finishing) return;

    const result = this.receiver.accept(text);

    switch (result.type) {
      case "foreign":
        this.note("QR di un altro tipo: continuo a cercare il flusso LensDrop.");
        return;
      case "invalid":
        this.note(`Frame scartato: ${result.detail}`);
        diagnostics.warn(`Frame non valido: ${result.detail}`);
        return;
      case "meta": {
        const meta = this.receiver.meta;
        if (meta) {
          diagnostics.ok(
            `Agganciato: "${meta.name}" · ${formatBytes(meta.size)} · ${meta.k} blocchi · SHA-256 ${meta.hash.slice(0, 12)}…`,
          );
        }
        this.updateProgress(true);
        return;
      }
      case "complete":
        this.updateProgress(true);
        void this.completeTransfer();
        return;
      default:
        this.updateProgress();
    }
  }

  private note(message: string): void {
    const hint = must<HTMLElement>("#receive-hint");
    if (hint.textContent !== message) hint.textContent = message;
  }

  private updateProgress(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastUiAt < UI_UPDATE_INTERVAL_MS) return;
    this.lastUiAt = now;

    const snapshot = this.receiver.snapshot;
    const meta = this.receiver.meta;

    if (!meta) {
      this.headline.textContent = "Cerco il codice…";
      this.percent.textContent = "0%";
      this.bar.style.width = "0%";
      this.details.textContent = "Inquadra lo schermo che mostra il flusso animato.";
      return;
    }

    const ratio = Math.max(0, Math.min(1, snapshot.ratio));
    this.headline.textContent = meta.name;
    this.percent.textContent = `${Math.round(ratio * 100)}%`;
    this.bar.style.width = `${ratio * 100}%`;
    this.bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));

    const solvedBytes = Math.min(meta.size, Math.round(snapshot.solved * meta.blockSize));
    this.samples.push({ at: Date.now(), bytes: solvedBytes });
    this.samples = this.samples.filter((sample) => Date.now() - sample.at < 4000);
    const first = this.samples[0];
    const elapsed = first ? (Date.now() - first.at) / 1000 : 0;
    const speed = elapsed > 0 && first ? Math.max(0, solvedBytes - first.bytes) / elapsed : 0;
    const remaining = Math.max(0, meta.size - solvedBytes);
    const eta = speed > 32 ? (remaining / speed) * 1000 : null;

    const parts = [
      `${snapshot.solved.toLocaleString("it-IT")} / ${meta.k.toLocaleString("it-IT")} blocchi`,
      `${formatBytes(solvedBytes)} di ${formatBytes(meta.size)}`,
    ];
    if (speed > 32) parts.push(formatSpeed(speed));
    if (eta !== null) parts.push(`mancano ${formatDuration(eta)}`);
    if (snapshot.duplicates > 0) parts.push(`${snapshot.duplicates} ripetizioni`);
    this.details.textContent = parts.join(" · ");

    const hint = must<HTMLElement>("#receive-hint");
    if (snapshot.solved === 0) {
      hint.textContent = "Nessun blocco letto: avvicina il telefono, evita riflessi e riempi l'inquadratura.";
    } else if (ratio < 1) {
      hint.textContent = "Continua a inquadrare: i blocchi mancanti arrivano con i simboli di riparazione.";
    }
  }

  private async completeTransfer(): Promise<void> {
    if (this.finishing || this.completed) return;
    this.finishing = true;

    diagnostics.ok("Tutti i blocchi sono stati ricostruiti: verifico l'integrità.");
    this.headline.textContent = "Verifica SHA-256…";
    this.percent.textContent = "100%";
    this.bar.style.width = "100%";

    try {
      const items = await this.receiver.finish();
      this.completed = true;
      this.records = items;

      await this.stopCamera("trasferimento completato");

      this.eyebrow.textContent = "Trasferimento completato";
      must<HTMLElement>("#receive-title").textContent = "Contenuto ricevuto";
      show(this.progressView, false);
      show(this.resultView, true);

      const total = items.reduce((sum, item) => sum + item.data.byteLength, 0);
      this.resultSummary.textContent = `${items.length} element${items.length === 1 ? "o" : "i"} · ${formatBytes(
        total,
      )} · verificato con SHA-256`;
      this.resultList.replaceChildren();
      for (const item of items) {
        this.resultList.append(createReceivedRow(item, this.handlers));
      }

      addHistory({
        direction: "in",
        outcome: "ok",
        totalBytes: total,
        files: items.map((item) => ({ name: item.name, size: item.data.byteLength })),
      });

      diagnostics.ok(`Ricevuti ${items.length} elementi (${formatBytes(total)}), checksum verificato.`);
      toast("Trasferimento completato e verificato.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verifica non riuscita.";
      diagnostics.error(`Verifica fallita: ${message}`);
      this.finishing = false;
      toast(message, "error");
      await this.stopCamera("errore di verifica");
      this.headline.textContent = "Verifica non riuscita";
      this.details.textContent = `${message} — inquadra di nuovo il flusso per ripetere la ricezione.`;
    }
  }

  private readonly handlers = {
    onSave: (item: BundleItem) => this.saveItem(item),
    onShare: (item: BundleItem) => void this.shareItem(item),
    onCopy: (text: string) => {
      void navigator.clipboard?.writeText(text).then(
        () => toast("Testo copiato.", "ok"),
        () => toast("Copia non consentita: salva il file.", "error"),
      );
    },
    onPreview: (url: string) => this.previewUrls.push(url),
  };

  private saveItem(item: BundleItem): void {
    const blob = new Blob([item.data], { type: item.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    link.rel = "noopener";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    diagnostics.info(`Salvato ${item.name} (${formatBytes(item.data.byteLength)}).`);
  }

  private async shareItem(item: BundleItem): Promise<void> {
    const file = new File([item.data], item.name, { type: item.mime || "application/octet-stream" });
    if (!navigator.canShare?.({ files: [file] })) {
      this.saveItem(item);
      return;
    }
    try {
      await navigator.share({ files: [file], title: item.name });
    } catch {
      diagnostics.warn("Condivisione annullata o non disponibile.");
    }
  }

  private async saveAll(): Promise<void> {
    if (this.records.length === 0) return;
    if (this.records.length > 3) {
      const confirmed = await confirmDialog({
        title: "Salvare tutti i file?",
        message: `Il browser chiederà conferma per ${this.records.length} download consecutivi.`,
        confirmLabel: "Salva tutti",
      });
      if (!confirmed) return;
    }
    for (const item of this.records) {
      this.saveItem(item);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  private resetTransfer(): void {
    for (const url of this.previewUrls) URL.revokeObjectURL(url);
    this.previewUrls = [];
    this.records = [];
    this.receiver.reset();
    this.completed = false;
    this.finishing = false;
    this.samples = [];
    this.lastUiAt = 0;

    this.resultList.replaceChildren();
    show(this.resultView, false);
    show(this.progressView, false);
    show(this.scanView, true);
    must<HTMLElement>("#receive-title").textContent = "Inquadra il codice";
    this.eyebrow.textContent = "Inquadra il flusso QR";
    this.headline.textContent = "Cerco il codice…";
    this.percent.textContent = "0%";
    this.bar.style.width = "0%";
    this.details.textContent = "";
    setText(must<HTMLElement>("#receive-hint"), "Avvia la fotocamera e inquadra il flusso QR sull'altro telefono.");
    this.startButton.disabled = false;
    diagnostics.info("Ricezione azzerata: pronta per un nuovo trasferimento.");
  }

  /** Usato dai test di interfaccia per verificare il rendering dei risultati. */
  renderResults(items: BundleItem[]): void {
    this.records = items;
    this.resultList.replaceChildren();
    for (const item of items) this.resultList.append(createReceivedRow(item, this.handlers));
  }

  get settingsSnapshot(): ReturnType<typeof loadSettings> {
    return loadSettings();
  }
}
