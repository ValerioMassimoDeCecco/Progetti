/** Flusso di invio: selezione → codice QR → trasferimento → esito. */

import {
  MAX_ITEMS,
  MAX_SESSION_BYTES,
  MAX_TEXT_LENGTH,
  SESSION_TTL_MS,
} from "../config";
import { formatCode } from "../core/base32";
import {
  collectDroppedFiles,
  copyText,
  createTextFile,
  formatBytes,
  formatDuration,
  supportsWebRtc,
} from "../core/files";
import type { ItemMeta } from "../core/protocol";
import { buildSessionLink } from "../core/links";
import { HostSession, type PeerHandle, type SessionStatus } from "../core/session";
import { loadSettings } from "../core/settings";
import { generateCode } from "../core/crypto";
import { TransferSender, type TransferProgress } from "../core/transfer";
import { clear, confirmDialog, formatError, icon, must, setText, show, toast } from "./dom";
import { addHistory } from "./history";
import { createFileRow } from "./items";
import { ProgressPanel } from "./progress";
import { clearQr, renderQr } from "./qr";

type SendView = "select" | "pair" | "progress" | "done";

export class SendScreen {
  private readonly selectView = must<HTMLElement>("#send-select");
  private readonly pairView = must<HTMLElement>("#send-pair");
  private readonly progressView = must<HTMLElement>("#send-progress");
  private readonly doneView = must<HTMLElement>("#send-done");
  private readonly itemsList = must<HTMLUListElement>("#send-items");
  private readonly emptyHint = must<HTMLElement>("#send-empty");
  private readonly totalLabel = must<HTMLElement>("#send-total");
  private readonly startButton = must<HTMLButtonElement>("#send-start");
  private readonly errorBox = must<HTMLElement>("#send-error");
  private readonly warningBox = must<HTMLElement>("#send-warning");
  private readonly codeValue = must<HTMLElement>("#send-code");
  private readonly qrCanvas = must<HTMLCanvasElement>("#send-qr");
  private readonly qrExpired = must<HTMLElement>("#qr-expired");
  private readonly statusText = must<HTMLElement>("#send-status");
  private readonly statusLine = this.statusText.closest(".status-line");
  private readonly countdownBar = must<HTMLElement>("#send-countdown-bar");
  private readonly countdownLabel = must<HTMLElement>("#send-countdown");
  private readonly doneSummary = must<HTMLElement>("#send-done-summary");
  private readonly routeBadge = must<HTMLElement>("#send-route");
  private readonly eyebrow = must<HTMLElement>("#send-eyebrow");
  private readonly fileInput = must<HTMLInputElement>("#file-input");
  private readonly folderInput = must<HTMLInputElement>("#folder-input");
  private readonly dropzone = must<HTMLElement>("#dropzone");
  private readonly textDialog = must<HTMLDialogElement>("#text-dialog");
  private readonly textArea = must<HTMLTextAreaElement>("#text-input");
  private readonly textCount = must<HTMLElement>("#text-count");
  private readonly progress = new ProgressPanel(
    {
      percent: must("#send-percent"),
      bar: must("#send-progress-bar"),
      fill: must("#send-progress-fill"),
      bytes: must("#send-bytes"),
      total: must("#send-total-bytes"),
      speed: must("#send-speed"),
      eta: must("#send-eta"),
      current: must("#send-current"),
      list: must("#send-progress-items"),
    },
    "Invio",
  );

  private selected: File[] = [];
  private code = "";
  private expiresAt = 0;
  private link = "";
  private host: HostSession | null = null;
  private handle: PeerHandle | null = null;
  private sender: TransferSender | null = null;
  private countdownTimer: number | null = null;
  private warningTimer: number | null = null;
  private view: SendView = "select";
  private qrToken = 0;
  private failureHandled = false;
  private reusableSession = false;
  private starting = false;

  constructor() {
    this.bind();
  }

  show(): void {
    this.setView(this.view);
  }

  hide(): void {
    // La sessione continua: l'utente può tornare senza perdere il trasferimento.
  }

  /** Chiude sessioni e timer (chiamato alla chiusura della pagina). */
  dispose(): void {
    this.closeSession();
  }

  // ------------------------------- Eventi UI -------------------------------

  private bind(): void {
    this.folderInput.setAttribute("webkitdirectory", "");
    this.folderInput.setAttribute("directory", "");

    this.dropzone.addEventListener("click", (event) => {
      // Gli input nascosti sono dentro la dropzone: evita il rientro del click.
      if (event.target === this.fileInput || event.target === this.folderInput) return;
      this.fileInput.click();
    });
    this.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.fileInput.click();
      }
    });
    must("#pick-files").addEventListener("click", () => this.fileInput.click());
    must("#pick-folder").addEventListener("click", () => this.folderInput.click());

    this.fileInput.addEventListener("change", () => {
      this.addFiles(this.fileInput.files);
      this.fileInput.value = "";
    });
    this.folderInput.addEventListener("change", () => {
      this.addFiles(this.folderInput.files);
      this.folderInput.value = "";
    });

    for (const type of ["dragenter", "dragover"] as const) {
      this.selectView.addEventListener(type, (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        this.dropzone.classList.add("is-dragging");
      });
    }
    for (const type of ["dragleave", "dragend"] as const) {
      this.selectView.addEventListener(type, (event) => {
        if (event.target === this.dropzone) this.dropzone.classList.remove("is-dragging");
      });
    }
    this.selectView.addEventListener("drop", (event) => {
      event.preventDefault();
      this.dropzone.classList.remove("is-dragging");
      const transfer = event.dataTransfer;
      if (!transfer) return;
      void collectDroppedFiles(transfer)
        .then((files) => this.addFiles(files))
        .catch((error: unknown) => this.showError(formatError(error)));
    });

    this.startButton.addEventListener("click", () => void this.start());
    must("#add-text").addEventListener("click", () => this.openTextDialog());
    this.textArea.addEventListener("input", () => {
      setText(this.textCount, `${this.textArea.value.length.toLocaleString("it-IT")} caratteri`);
    });
    this.textDialog.addEventListener("close", () => this.handleTextDialog());
    must("#new-code").addEventListener("click", () => void this.regenerate());
    must("#send-back").addEventListener("click", () => {
      this.closeSession();
      this.setView("select");
    });
    must("#copy-code").addEventListener("click", () => void this.copyCode());
    must("#copy-link").addEventListener("click", () => void this.copyLink());
    const shareButton = must<HTMLButtonElement>("#share-link");
    show(shareButton, typeof navigator.share === "function");
    shareButton.addEventListener("click", () => void this.shareLink());
    must("#send-cancel").addEventListener("click", () => void this.cancelTransfer());
    must("#send-more").addEventListener("click", () => {
      this.selected = [];
      this.renderSelection();
      this.setView("select");
    });
    must("#send-finish").addEventListener("click", () => {
      this.closeSession();
      this.selected = [];
      this.renderSelection();
      this.setView("select");
      window.location.hash = "#/";
    });
  }

  private openTextDialog(): void {
    this.textArea.value = "";
    setText(this.textCount, "0 caratteri");
    this.textDialog.returnValue = "cancel";
    this.textDialog.showModal();
    this.textArea.focus();
  }

  private handleTextDialog(): void {
    if (this.textDialog.returnValue !== "confirm") return;
    const text = this.textArea.value;
    if (text.trim().length === 0) {
      toast("Il testo è vuoto: nulla da inviare.", "error");
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      toast(`Testo troppo lungo (massimo ${MAX_TEXT_LENGTH.toLocaleString("it-IT")} caratteri).`, "error");
      return;
    }
    const file = createTextFile(text);
    this.addFiles([file]);
    this.textArea.value = "";
    toast(`Testo aggiunto (${formatBytes(file.size)}).`, "ok");
  }

  // ------------------------------ Selezione --------------------------------

  private addFiles(files: FileList | File[] | null): void {
    if (!files) return;
    const incoming = Array.from(files).filter((file) => file.name.trim() !== "");
    if (incoming.length === 0) {
      this.showError("Nessun file valido nella selezione.");
      return;
    }
    const known = new Set(this.selected.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    let duplicates = 0;
    let rejected = 0;
    let skippedSize = 0;

    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(key)) {
        duplicates += 1;
        continue;
      }
      if (this.selected.length >= MAX_ITEMS) {
        rejected += 1;
        continue;
      }
      const projected = this.totalBytes() + file.size;
      if (projected > MAX_SESSION_BYTES) {
        skippedSize += 1;
        continue;
      }
      this.selected.push(file);
      known.add(key);
    }

    this.renderSelection();
    this.clearError();

    if (duplicates > 0) toast(`${duplicates} file già presenti ignorati.`);
    if (rejected > 0) toast(`Massimo ${MAX_ITEMS} elementi per sessione.`, "error");
    if (skippedSize > 0) toast("Alcuni file superano il limite complessivo di 20 GB.", "error");
  }

  private totalBytes(): number {
    return this.selected.reduce((sum, file) => sum + file.size, 0);
  }

  private renderSelection(): void {
    clear(this.itemsList);
    this.selected.forEach((file, index) => {
      const row = createFileRow({
        name: file.name,
        size: file.size,
        mime: file.type,
        removable: true,
        onRemove: () => {
          this.selected.splice(index, 1);
          this.renderSelection();
        },
      });
      this.itemsList.append(row.row);
    });

    const count = this.selected.length;
    const total = this.totalBytes();
    setText(
      this.totalLabel,
      count === 0 ? "Nessun contenuto" : `${count} ${count === 1 ? "elemento" : "elementi"} · ${formatBytes(total)}`,
    );
    show(this.emptyHint, count === 0);
    this.startButton.disabled = count === 0;
    const label =
      this.reusableSession && this.handle?.messenger.isOpen
        ? "Invia sulla sessione attiva"
        : "Genera codice di sessione";
    this.startButton.replaceChildren(icon("send"), document.createTextNode(` ${label}`));
  }

  // ------------------------------ Sessione ---------------------------------

  private baseUrl(): string {
    return new URL(import.meta.env.BASE_URL, window.location.href).toString();
  }

  private async start(): Promise<void> {
    if (this.selected.length === 0 || this.starting) return;
    if (!supportsWebRtc()) {
      this.showError("Questo browser non supporta WebRTC: impossibile creare una sessione.");
      return;
    }

    if (this.reusableSession && this.handle?.messenger.isOpen && this.sender) {
      await this.runBatch();
      return;
    }

    this.starting = true;
    this.startButton.disabled = true;
    try {
      await this.createSession();
    } finally {
      this.starting = false;
      this.startButton.disabled = this.selected.length === 0;
    }
  }

  /** Crea il codice, pubblica la stanza di segnalazione e mostra il QR. */
  private async createSession(): Promise<void> {
    this.clearError();
    this.closeSession();
    this.code = "";
    this.expiresAt = Date.now() + SESSION_TTL_MS;
    this.setView("pair");
    this.qrExpired.hidden = true;
    setText(this.codeValue, "—");
    clearQr(this.qrCanvas);
    this.startCountdown();

    this.code = generateCode();
    this.link = buildSessionLink(this.baseUrl(), this.code, this.expiresAt);
    setText(this.codeValue, formatCode(this.code));
    await this.paintQr();

    const host = new HostSession({
      code: this.code,
      expiresAt: this.expiresAt,
      settings: loadSettings(),
      onStatus: (status) => this.onSessionStatus(status),
      onPeer: (peer) => void this.onPeer(peer),
      onPeerClosed: (reason) => this.onPeerClosed(reason),
      onWarning: (message) => this.showWarning(message),
    });
    this.host = host;

    try {
      await host.start();
    } catch (error) {
      if (this.host !== host) return;
      this.showError(formatError(error));
      toast(formatError(error), "error");
      this.closeSession();
      this.setView("select");
    }
  }

  private async paintQr(): Promise<void> {
    const token = ++this.qrToken;
    try {
      await renderQr(this.qrCanvas, this.link);
      if (token !== this.qrToken) clearQr(this.qrCanvas);
    } catch {
      this.showError("Impossibile generare il codice QR. Usa il codice testuale o il link.");
    }
  }

  private onSessionStatus(status: SessionStatus): void {
    if (this.view !== "pair") return;
    const line = this.statusLine;
    line?.classList.toggle("is-ok", status.phase === "connected");
    line?.classList.toggle("is-error", status.phase === "error" || status.phase === "closed");
    switch (status.phase) {
      case "signaling":
        setText(this.statusText, "Connessione al servizio di segnalazione…");
        break;
      case "waiting":
        setText(this.statusText, "In attesa del destinatario: inquadra il QR con l'altro telefono.");
        break;
      case "authenticating":
        setText(this.statusText, "Verifica del codice di sicurezza…");
        break;
      case "connected":
        setText(this.statusText, "Dispositivo collegato.");
        break;
      case "error":
        setText(this.statusText, status.detail ?? "Errore di connessione.");
        this.showError(status.detail ?? "Errore di connessione.");
        break;
      case "closed":
        setText(this.statusText, status.detail ?? "Sessione chiusa.");
        break;
      default:
        break;
    }
  }

  private showWarning(message: string): void {
    this.warningBox.textContent = message;
    this.warningBox.hidden = false;
    if (this.warningTimer) window.clearTimeout(this.warningTimer);
    this.warningTimer = window.setTimeout(() => {
      this.warningBox.hidden = true;
    }, 9000);
  }

  private async onPeer(peer: PeerHandle): Promise<void> {
    this.stopCountdown();
    this.failureHandled = false;
    this.reusableSession = false;
    this.handle = peer;
    this.sender?.dispose();

    const sender = new TransferSender(peer.messenger, this.code, {
      onAccepted: (metas, totalBytes) => {
        this.progress.reset(metas, totalBytes);
        this.setView("progress");
      },
      onProgress: (progress: TransferProgress) => {
        if (this.view === "progress") this.progress.update(progress);
      },
      onItemFinished: (meta, ok, error) => {
        this.progress.markItem(
          meta,
          ok ? "verificato · SHA-256" : (error ?? "verifica fallita"),
          ok,
        );
      },
      onComplete: (summary) => this.finishBatch(summary),
      onCancel: (reason, local) => this.handleCancel(reason, local),
      onClosed: (reason) => this.handleConnectionLost(reason),
    });
    this.sender = sender;

    const provisional: ItemMeta[] = this.selected.map((file, index) => ({
      id: `p${index}`,
      name: file.name,
      size: file.size,
      mime: file.type,
    }));
    this.progress.reset(provisional, this.totalBytes());
    this.progress.waiting("Dispositivo collegato: attendo la conferma del destinatario…");
    this.setView("progress");
    void this.updateRoute(peer);
    await this.runBatch();
  }

  private async runBatch(): Promise<void> {
    if (!this.sender) return;
    this.failureHandled = false;
    this.setView("progress");
    const batch = [...this.selected];
    try {
      await this.sender.send(batch);
    } catch (error) {
      if (this.failureHandled) return;
      this.failureHandled = true;
      const message = formatError(error);
      this.progress.showError(message);
      this.showError(message);
      toast(message, "error");
      this.closeSession();
      this.setView("select");
    }
  }

  private finishBatch(summary: { items: number; totalBytes: number; elapsedMs: number }): void {
    this.failureHandled = true;
    this.reusableSession = true;
    this.progress.finish();
    setText(
      this.doneSummary,
      `${summary.items} ${summary.items === 1 ? "contenuto" : "contenuti"} · ${formatBytes(summary.totalBytes)} · ${formatDuration(summary.elapsedMs)}`,
    );
    addHistory({
      direction: "out",
      outcome: "ok",
      totalBytes: summary.totalBytes,
      files: this.selected.map((file) => ({ name: file.name, size: file.size })),
    });
    this.selected = [];
    this.renderSelection();
    this.setView("done");
    toast("Invio completato e verificato.", "ok");
  }

  private async updateRoute(peer: PeerHandle): Promise<void> {
    const route = await peer.channel.connectionRoute();
    if (route === "relay") {
      setText(this.routeBadge, "Tramite relay TURN");
    } else if (route === "direct") {
      setText(this.routeBadge, "Connessione diretta P2P");
    } else {
      setText(this.routeBadge, "Percorso non determinabile");
    }
  }

  private handleCancel(reason: string, local: boolean): void {
    this.failureHandled = true;
    this.stopCountdown();
    const message = local ? "Invio annullato." : `Invio annullato dal destinatario: ${reason}`;
    toast(message, "error");
    this.showError(message);
    this.closeSession();
    this.setView("select");
  }

  private handleConnectionLost(reason: string): void {
    if (this.view === "done") {
      this.reusableSession = false;
      toast(reason);
      return;
    }
    if (this.failureHandled) return;
    this.failureHandled = true;
    toast(reason, "error");
    this.showError(`${reason} Puoi riprovare generando un nuovo codice.`);
    this.closeSession();
    this.setView("select");
  }

  private onPeerClosed(reason: string): void {
    this.reusableSession = false;
    if (this.view === "progress" || this.view === "pair") {
      this.showWarning(reason);
    }
  }

  private async cancelTransfer(): Promise<void> {
    const confirmed = await confirmDialog({
      title: "Annullare l'invio?",
      message: "Il destinatario perderà i file parzialmente ricevuti. La selezione resta disponibile.",
      confirmLabel: "Annulla invio",
      cancelLabel: "Continua",
      danger: true,
    });
    if (!confirmed) return;
    const sender = this.sender;
    if (sender) {
      sender.cancel("Trasferimento annullato dal mittente.");
      return;
    }
    this.stopCountdown();
    this.closeSession();
    this.setView("select");
    this.renderSelection();
  }

  private async regenerate(): Promise<void> {
    if (this.selected.length === 0) {
      this.setView("select");
      return;
    }
    this.closeSession();
    await this.start();
  }

  private closeSession(): void {
    this.stopCountdown();
    this.sender?.dispose();
    this.sender = null;
    this.host?.close();
    this.host = null;
    this.handle = null;
    this.reusableSession = false;
    this.qrToken += 1;
  }

  private startCountdown(): void {
    this.stopCountdown();
    const tick = () => {
      const remaining = Math.max(0, this.expiresAt - Date.now());
      const ratio = Math.max(0, Math.min(1, remaining / SESSION_TTL_MS));
      this.countdownBar.style.width = `${ratio * 100}%`;
      const seconds = Math.ceil(remaining / 1000);
      setText(
        this.countdownLabel,
        remaining > 0
          ? `Scade tra ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
          : "Codice scaduto",
      );
      if (remaining === 0) {
        this.qrExpired.hidden = false;
        this.countdownBar.style.width = "0%";
        this.stopCountdown();
        this.host?.close("Sessione scaduta.");
        this.host = null;
        setText(this.statusText, "Codice scaduto: generane uno nuovo per continuare.");
        this.statusLine?.classList.add("is-error");
      }
    };
    tick();
    this.countdownTimer = window.setInterval(tick, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private showError(message: string): void {
    this.errorBox.textContent = message;
    this.errorBox.hidden = false;
  }

  private clearError(): void {
    this.errorBox.hidden = true;
    this.errorBox.textContent = "";
  }

  private setView(view: SendView): void {
    this.view = view;
    setText(
      this.eyebrow,
      view === "select"
        ? "Passaggio 1 · Contenuti"
        : view === "pair"
          ? "Passaggio 2 · Accoppiamento"
          : view === "progress"
            ? "Passaggio 3 · Invio"
            : "Completato",
    );
    show(this.selectView, view === "select");
    show(this.pairView, view === "pair");
    show(this.progressView, view === "progress");
    show(this.doneView, view === "done");
    if (view !== "pair") {
      this.warningBox.hidden = true;
      this.stopCountdown();
    }
  }

  // --------------------------- Codice e link --------------------------------

  private async copyCode(): Promise<void> {
    const copied = await copyText(formatCode(this.code));
    toast(copied ? "Codice copiato." : "Copia non disponibile: leggi il codice dallo schermo.", copied ? "ok" : "error");
  }

  private async copyLink(): Promise<void> {
    const copied = await copyText(this.link);
    toast(copied ? "Link copiato." : "Copia non consentita dal browser.", copied ? "ok" : "error");
  }

  private async shareLink(): Promise<void> {
    try {
      await navigator.share({
        title: "LensDrop",
        text: "Ricevi i miei contenuti con LensDrop. Apri il link e premi Collegati.",
        url: this.link,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast("Condivisione non disponibile: copia il link.", "error");
    }
  }
}
