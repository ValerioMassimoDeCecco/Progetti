/** Flusso di ricezione: scansione QR → conferma → ricezione → salvataggio. */

import { normalizeCode } from "../core/base32";
import {
  canShareFiles,
  copyText,
  downloadBlob,
  formatBytes,
  formatDuration,
  shareFiles,
} from "../core/files";
import type { ItemMeta, OfferMessage } from "../core/protocol";
import { GuestSession, type PeerHandle, type SessionStatus } from "../core/session";
import { loadSettings } from "../core/settings";
import { TransferReceiver, type ReceivedItem, type TransferProgress } from "../core/transfer";
import { clear, confirmDialog, formatError, must, setButtonContent, setText, show, toast } from "./dom";
import { addHistory } from "./history";
import { createFileRow, createReceivedRow } from "./items";
import { ProgressPanel } from "./progress";
import { QrScanner } from "./scanner";

type ReceiveView = "scan" | "connecting" | "confirm" | "progress" | "done";

export class ReceiveScreen {
  private readonly scanView = must<HTMLElement>("#receive-scan");
  private readonly connectingView = must<HTMLElement>("#receive-connecting");
  private readonly confirmView = must<HTMLElement>("#receive-confirm");
  private readonly progressView = must<HTMLElement>("#receive-progress");
  private readonly doneView = must<HTMLElement>("#receive-done");
  private readonly scannerEl = must<HTMLElement>("#scanner");
  private readonly video = must<HTMLVideoElement>("#scanner-video");
  private readonly scannerStatus = must<HTMLElement>("#scanner-status");
  private readonly connectingStatus = must<HTMLElement>("#receive-connecting-status");
  private readonly errorBox = must<HTMLElement>("#receive-error");
  private readonly offerSummary = must<HTMLElement>("#receive-offer-summary");
  private readonly offerList = must<HTMLUListElement>("#receive-offer-items");
  private readonly receivedList = must<HTMLUListElement>("#receive-items");
  private readonly doneSummary = must<HTMLElement>("#receive-done-summary");
  private readonly routeBadge = must<HTMLElement>("#receive-route");
  private readonly eyebrow = must<HTMLElement>("#receive-eyebrow");
  private readonly manualForm = must<HTMLFormElement>("#manual-form");
  private readonly manualInput = must<HTMLInputElement>("#manual-code");
  private readonly cameraButton = must<HTMLButtonElement>("#start-camera");
  private readonly torchButton = must<HTMLButtonElement>("#torch-toggle");
  private readonly scanImageInput = must<HTMLInputElement>("#scan-image-input");
  private readonly shareAllButton = must<HTMLButtonElement>("#receive-share-all");
  private readonly downloadAllButton = must<HTMLButtonElement>("#receive-download-all");
  private readonly progress = new ProgressPanel(
    {
      percent: must("#receive-percent"),
      bar: must("#receive-progress-bar"),
      fill: must("#receive-progress-fill"),
      bytes: must("#receive-bytes"),
      total: must("#receive-total-bytes"),
      speed: must("#receive-speed"),
      eta: must("#receive-eta"),
      current: must("#receive-current"),
      list: must("#receive-progress-items"),
    },
    "Ricezione",
  );

  private scanner: QrScanner | null = null;
  private guest: GuestSession | null = null;
  private receiver: TransferReceiver | null = null;
  private handle: PeerHandle | null = null;
  private offer: OfferMessage | null = null;
  private items: ReceivedItem[] = [];
  private previewUrls: string[] = [];

  private view: ReceiveView = "scan";
  private code = "";
  private intentionalClose = false;
  private connectToken = 0;

  constructor() {
    this.bind();
  }

  show(): void {
    this.setView(this.view);
  }

  hide(): void {
    // Privacy: la fotocamera si spegne appena si lascia la schermata.
    this.stopScanner();
  }

  dispose(): void {
    this.stopScanner();
    this.resetConnection();
    this.clearResults();
  }

  // ------------------------------- Binding ---------------------------------

  private bind(): void {
    this.cameraButton.addEventListener("click", () => void this.toggleCamera());
    this.torchButton.addEventListener("click", () => void this.toggleTorch());
    must("#scan-image").addEventListener("click", () => this.scanImageInput.click());
    this.scanImageInput.addEventListener("change", () => {
      const file = this.scanImageInput.files?.[0];
      this.scanImageInput.value = "";
      if (file) void this.scanFromImage(file);
    });

    const toggleManual = must<HTMLButtonElement>("#toggle-manual");
    toggleManual.addEventListener("click", () => {
      const opening = this.manualForm.hidden;
      this.manualForm.hidden = !opening;
      toggleManual.setAttribute("aria-expanded", String(opening));
      if (opening) this.manualInput.focus();
    });

    this.manualInput.addEventListener("input", () => {
      const raw = this.manualInput.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 12);
      this.manualInput.value = raw.match(/.{1,4}/g)?.join("-") ?? raw;
    });

    this.manualForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = normalizeCode(this.manualInput.value);
      if (!code) {
        this.showError("Il codice deve avere 12 caratteri (lettere e numeri, senza I, L, O, U).");
        return;
      }
      this.clearError();
      void this.connectWithCode(code, null);
    });

    must("#receive-accept").addEventListener("click", () => this.acceptOffer());
    must("#receive-reject").addEventListener("click", () => this.rejectOffer());
    must("#receive-cancel").addEventListener("click", () => void this.cancelTransfer());
    must("#cancel-connect").addEventListener("click", () => {
      this.intentionalClose = true;
      this.resetConnection();
      this.intentionalClose = false;
      this.setView("scan");
    });
    must("#receive-again").addEventListener("click", () => {
      if (!this.handle?.messenger.isOpen) {
        this.resetConnection();
        this.setView("scan");
        toast("La sessione è terminata: inquadra un nuovo codice.", "error");
        return;
      }
      this.setView("connecting");
      setText(this.connectingStatus, "In attesa di nuovi contenuti dal mittente…");
    });
    this.downloadAllButton.addEventListener("click", () => this.downloadAll());
    this.shareAllButton.addEventListener("click", () => void this.shareAll());
  }

  // ------------------------------- Fotocamera ------------------------------

  private async toggleCamera(): Promise<void> {
    if (this.scanner?.isRunning) {
      this.stopScanner();
      return;
    }
    this.clearError();
    this.scanner = new QrScanner(this.video, {
      onCode: (code, expiresAt) => {
        this.stopScanner();
        this.setScannerStatus("Codice letto.");
        void this.connectWithCode(code, expiresAt);
      },
      onError: (message) => {
        this.showError(message);
        this.setScannerStatus(message, "error");
      },
      onState: (state) => {
        this.scannerEl.classList.toggle("is-live", state === "live");
        this.cameraButton.disabled = state === "starting";
        setButtonContent(this.cameraButton, "camera", state === "live" ? "Ferma fotocamera" : "Attiva fotocamera");
        if (state === "live") {
          this.setScannerStatus("Punta il codice QR del mittente all'interno della cornice.");
        }
      },
    });
    await this.scanner.start();
    show(this.torchButton, this.scanner.isTorchAvailable);
  }

  private stopScanner(): void {
    this.scanner?.stop();
    this.scanner = null;
    this.scannerEl.classList.remove("is-live");
    show(this.torchButton, false);
    setButtonContent(this.cameraButton, "camera", "Attiva fotocamera");
    this.cameraButton.disabled = false;
  }

  private async toggleTorch(): Promise<void> {
    if (!this.scanner) return;
    const on = await this.scanner.toggleTorch();
    this.torchButton.classList.toggle("btn--primary", on);
    setButtonContent(this.torchButton, "torch", on ? "Torcia accesa" : "Torcia");
    if (!this.scanner.isTorchAvailable) show(this.torchButton, false);
  }

  private async scanFromImage(file: File): Promise<void> {
    this.clearError();
    try {
      const result = await QrScanner.scanImage(file);
      if (!result) {
        this.showError("Nessun codice QR riconosciuto nell'immagine.");
        return;
      }
      await this.connectWithCode(result.code, result.expiresAt);
    } catch (error) {
      this.showError(formatError(error));
    }
  }

  private setScannerStatus(message: string, variant: "ok" | "error" | "idle" = "idle"): void {
    const line = this.scannerStatus;
    line.textContent = "";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = message;
    line.append(dot, text);
    line.classList.toggle("is-ok", variant === "ok");
    line.classList.toggle("is-error", variant === "error");
  }

  // ------------------------------- Connessione -----------------------------

  /** Avvia il collegamento a partire da un codice (QR, link o inserimento manuale). */
  async connectWithCode(code: string, expiresAt: number | null): Promise<void> {
    const normalized = normalizeCode(code);
    if (!normalized) {
      this.showError("Codice non valido.");
      return;
    }
    if (expiresAt !== null && Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      this.showError("Questo invito è scaduto: chiedi al mittente di generare un nuovo codice.");
      this.setView("scan");
      return;
    }

    this.stopScanner();
    this.clearError();
    this.clearResults();
    this.intentionalClose = true;
    this.resetConnection();
    this.intentionalClose = false;

    this.code = normalized;
    const token = ++this.connectToken;
    this.setView("connecting");
    setText(this.connectingStatus, "Apertura del canale sicuro…");

    const guest = new GuestSession({
      code: normalized,
      settings: loadSettings(),
      onStatus: (status) => this.onGuestStatus(status, token),
      onClosed: (reason) => this.onConnectionClosed(reason),
    });
    this.guest = guest;

    try {
      const handle = await guest.connect();
      if (token !== this.connectToken || this.guest !== guest) {
        handle.messenger.close("Collegamento annullato.");
        return;
      }
      this.handle = handle;
      setText(this.connectingStatus, "In attesa che il mittente proponga i contenuti…");
      this.attachReceiver(handle);
      void this.updateRoute(handle);
    } catch (error) {
      if (token !== this.connectToken || this.intentionalClose) return;
      const message = formatError(error);
      this.resetConnection();
      this.showError(message);
      this.setView("scan");
      toast(message, "error");
    }
  }

  private onGuestStatus(status: SessionStatus, token: number): void {
    if (token !== this.connectToken) return;
    if (this.view !== "connecting") return;
    if (status.phase === "connecting") setText(this.connectingStatus, "Collegamento al dispositivo…");
    if (status.phase === "authenticating") setText(this.connectingStatus, "Verifica del codice di sicurezza…");
    if (status.phase === "error" && status.detail) {
      this.showError(status.detail);
      setText(this.connectingStatus, status.detail);
    }
  }

  private attachReceiver(handle: PeerHandle): void {
    this.receiver?.dispose();
    const receiver = new TransferReceiver(handle.messenger, this.code, {
      onOffer: (offer) => this.handleOffer(offer),
      onProgress: (progress: TransferProgress) => {
        if (this.view === "progress") this.progress.update(progress);
      },
      onItem: (item) => this.handleReceivedItem(item),
      onComplete: (summary) => this.finishReceiving(summary),
      onCancel: (reason, local) => {
        if (this.intentionalClose) return;
        const message = local ? "Ricezione annullata." : reason;
        toast(message, "error");
        this.showError(message);
        this.resetConnection();
        this.setView("scan");
      },
      onError: (error) => {
        if (this.intentionalClose) return;
        this.showError(formatError(error));
        toast(formatError(error), "error");
      },
      onClosed: (reason) => this.onConnectionClosed(reason),
    });
    this.receiver = receiver;
  }

  private handleOffer(offer: OfferMessage): void {
    if (this.items.length > 0 || this.previewUrls.length > 0) this.clearResults();
    this.offer = offer;
    clear(this.offerList);
    for (const meta of offer.items) {
      const row = createFileRow({ name: meta.name, size: meta.size, mime: meta.mime });
      row.status.textContent = "";
      this.offerList.append(row.row);
    }
    const label = `${offer.items.length} ${offer.items.length === 1 ? "contenuto" : "contenuti"} · ${formatBytes(offer.totalBytes)}`;
    setText(this.offerSummary, `Totale: ${label}. Verifica i nomi prima di accettare.`);
    this.setView("confirm");
    toast("Proposta ricevuta: conferma per iniziare.", "ok");
  }

  private acceptOffer(): void {
    if (!this.receiver || !this.offer) return;
    this.progress.reset(this.offer.items, this.offer.totalBytes);
    this.setView("progress");
    this.progress.waiting("In attesa dei primi dati dal mittente…");
    try {
      this.receiver.accept();
    } catch (error) {
      this.showError(formatError(error));
      toast(formatError(error), "error");
    }
  }

  private rejectOffer(): void {
    this.receiver?.reject("Il destinatario ha rifiutato il trasferimento.");
    toast("Trasferimento rifiutato.");
    this.intentionalClose = true;
    this.resetConnection();
    this.intentionalClose = false;
    this.setView("scan");
  }

  private handleReceivedItem(item: ReceivedItem): void {
    this.items.push(item);
    this.progress.markItem(item.meta, "verificato", true);
    toast(`Ricevuto: ${item.fileName}`, "ok");
  }

  private finishReceiving(summary: {
    items: number;
    totalBytes: number;
    elapsedMs: number;
    allVerified: boolean;
  }): void {
    this.progress.finish();
    this.renderReceivedItems();
    setText(
      this.doneSummary,
      `${summary.items} ${summary.items === 1 ? "contenuto" : "contenuti"} · ${formatBytes(summary.totalBytes)} · ${formatDuration(summary.elapsedMs)}${summary.allVerified ? " · integrità verificata" : ""}`,
    );
    addHistory({
      direction: "in",
      outcome: summary.allVerified ? "ok" : "error",
      totalBytes: summary.totalBytes,
      files: this.items.map((item) => ({ name: item.fileName, size: item.blob.size })),
    });
    this.setView("done");
    toast("Ricezione completata.", "ok");
  }

  private onConnectionClosed(reason: string): void {
    if (this.intentionalClose) return;
    if (this.view === "done") {
      toast(reason);
      return;
    }
    this.showError(reason);
    toast(reason, "error");
    this.resetConnection();
    this.setView("scan");
  }

  private async updateRoute(handle: PeerHandle): Promise<void> {
    const route = await handle.channel.connectionRoute();
    if (route === "relay") setText(this.routeBadge, "Tramite relay TURN");
    else if (route === "direct") setText(this.routeBadge, "Connessione diretta P2P");
    else setText(this.routeBadge, "Percorso non determinabile");
  }

  private resetConnection(): void {
    this.connectToken += 1;
    this.receiver?.dispose();
    this.receiver = null;
    this.guest?.close();
    this.guest = null;
    this.handle = null;
    this.offer = null;
  }

  // ------------------------------ Contenuti --------------------------------

  private renderReceivedItems(): void {
    clear(this.receivedList);
    for (const item of this.items) {
      const row = createReceivedRow(item, {
        onDownload: (received) => this.downloadItem(received),
        onShare: (received) => void this.shareItem(received),
        onCopy: (text) => {
          if (!text) {
            toast("Testo non leggibile.", "error");
            return;
          }
          void copyText(text).then((copied) => {
            toast(copied ? "Testo copiato negli appunti." : "Copia non consentita dal browser.", copied ? "ok" : "error");
          });
        },
        onPreviewUrl: (url) => this.previewUrls.push(url),
      });
      this.receivedList.append(row);
    }
    show(this.shareAllButton, canShareFiles());
    show(this.downloadAllButton, this.items.length > 0);
  }

  private downloadItem(item: ReceivedItem): void {
    downloadBlob(item.blob, item.fileName);
  }

  private async shareItem(item: ReceivedItem): Promise<void> {
    const file = new File([item.blob], item.fileName, {
      type: item.meta.mime || "application/octet-stream",
    });
    const shared = await shareFiles([file], item.fileName);
    if (!shared) toast("Condivisione non disponibile: usa Scarica.", "error");
  }

  private downloadAll(): void {
    if (this.items.length === 0) return;
    this.items.forEach((item, index) => {
      window.setTimeout(() => downloadBlob(item.blob, item.fileName), index * 250);
    });
    if (this.items.length > 1) {
      toast(`${this.items.length} download avviati: il browser potrebbe chiedere il permesso.`);
    }
  }

  private async shareAll(): Promise<void> {
    if (this.items.length === 0) return;
    const files = this.items.map(
      (item) =>
        new File([item.blob], item.fileName, { type: item.meta.mime || "application/octet-stream" }),
    );
    const shared = await shareFiles(files, "Contenuti ricevuti con LensDrop");
    if (!shared) toast("Condivisione multipla non supportata: scarica i file.", "error");
  }

  private clearResults(): void {
    this.items = [];
    clear(this.offerList);
    clear(this.receivedList);
    for (const url of this.previewUrls) URL.revokeObjectURL(url);
    this.previewUrls = [];
    this.progress.reset([], 0);
    show(this.downloadAllButton, false);
    show(this.shareAllButton, false);
    this.setView(this.view);
  }

  private async cancelTransfer(): Promise<void> {
    const confirmed = await confirmDialog({
      title: "Annullare la ricezione?",
      message: "I file già ricevuti in questa sessione andranno persi.",
      confirmLabel: "Annulla ricezione",
      cancelLabel: "Continua",
      danger: true,
    });
    if (!confirmed) return;
    this.intentionalClose = true;
    this.receiver?.cancel("Ricezione annullata dal destinatario.");
    this.resetConnection();
    this.intentionalClose = false;
    this.clearResults();
    this.setView("scan");
    toast("Ricezione annullata.");
  }

  private showError(message: string): void {
    this.errorBox.textContent = message;
    this.errorBox.hidden = false;
  }

  private clearError(): void {
    this.errorBox.hidden = true;
    this.errorBox.textContent = "";
  }

  private setView(view: ReceiveView): void {
    this.view = view;
    setText(
      this.eyebrow,
      view === "scan"
        ? "Passaggio 1 · Scansione"
        : view === "connecting"
          ? "Passaggio 2 · Collegamento"
          : view === "confirm"
            ? "Passaggio 3 · Conferma"
            : view === "progress"
              ? "Passaggio 4 · Ricezione"
              : "Completato",
    );
    show(this.scanView, view === "scan");
    show(this.connectingView, view === "connecting");
    show(this.confirmView, view === "confirm");
    show(this.progressView, view === "progress");
    show(this.doneView, view === "done");
    if (view !== "scan") this.clearError();
  }

  /** Metadati dell'offerta corrente, esposti per test/diagnostica. */
  get offeredItems(): ItemMeta[] {
    return this.offer?.items ?? [];
  }
}
