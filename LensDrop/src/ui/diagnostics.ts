/**
 * Diagnostica in pagina.
 *
 * Con un canale ottico non esistono log di rete: se qualcosa non funziona,
 * l'unica informazione utile è cosa ha visto la fotocamera e cosa ha capito il
 * decodificatore. Questo modulo raccoglie gli eventi in un buffer circolare,
 * li mostra in un pannello copiabile e scaricabile, e mette a disposizione
 * `window.lensdropDiagnostics` per chi vuole guardare da console.
 */

import { MAX_LOG_LINES } from "../config";
import { formatClock } from "../core/files";

export type LogLevel = "info" | "ok" | "warn" | "error" | "frame";

export interface LogEntry {
  at: number;
  level: LogLevel;
  message: string;
}

type Listener = (entries: readonly LogEntry[]) => void;

class Diagnostics {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private errorCount = 0;
  private signature = "";

  log(level: LogLevel, message: string): void {
    const entry: LogEntry = { at: Date.now(), level, message };
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_LINES) this.entries.splice(0, this.entries.length - MAX_LOG_LINES);
    if (level === "error") this.errorCount += 1;

    // Gli errori e gli avvisi finiscono anche in console; gli eventi ordinari
    // restano nel pannello per non sporcare gli strumenti di sviluppo.
    if (level === "error") console.error(`[LensDrop] ${message}`);
    else if (level === "warn") console.warn(`[LensDrop] ${message}`);

    this.notify();
  }

  info(message: string): void {
    this.log("info", message);
  }

  ok(message: string): void {
    this.log("ok", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }

  /** Eventi di decodifica: frequenti, mostrati con un contatore compatto. */
  frame(message: string): void {
    this.log("frame", message);
  }

  get all(): readonly LogEntry[] {
    return this.entries;
  }

  get errors(): number {
    return this.errorCount;
  }

  clear(): void {
    this.entries.length = 0;
    this.errorCount = 0;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.entries);
    return () => this.listeners.delete(listener);
  }

  /** Rappresentazione testuale completa, pronta da copiare in una segnalazione. */
  toText(): string {
    const header = [
      `LensDrop — diagnostica`,
      `generato: ${new Date().toISOString()}`,
      `user agent: ${navigator.userAgent}`,
      `secure context: ${window.isSecureContext}`,
      `barcode detector: ${"BarcodeDetector" in window}`,
      "",
    ];
    const lines = this.entries.map((entry) => `${formatClock(new Date(entry.at))}.${String(entry.at % 1000).padStart(3, "0")} [${entry.level.toUpperCase()}] ${entry.message}`);
    return [...header, ...lines].join("\n");
  }

  private notify(): void {
    // Aggiorna l'interfaccia solo se il contenuto è cambiato in modo visibile.
    const signature = `${this.entries.length}:${this.errorCount}`;
    if (signature === this.signature) return;
    this.signature = signature;
    for (const listener of this.listeners) listener(this.entries);
  }
}

export const diagnostics = new Diagnostics();

declare global {
  interface Window {
    lensdropDiagnostics?: Diagnostics;
  }
}

if (typeof window !== "undefined") window.lensdropDiagnostics = diagnostics;

export interface DiagnosticsView {
  open: () => void;
  close: () => void;
}

/** Collega il pannello (dialog) agli eventi raccolti. */
export function initDiagnostics(): DiagnosticsView {
  const dialog = document.getElementById("diagnostics") as HTMLDialogElement | null;
  const output = document.getElementById("diagnostics-log");
  const badge = document.getElementById("diagnostics-count");
  const openButton = document.getElementById("open-diagnostics");

  const render = (entries: readonly LogEntry[]) => {
    if (output) {
      output.textContent =
        entries.length === 0
          ? "Nessun evento registrato."
          : entries.map((entry) => `${formatClock(new Date(entry.at))} [${entry.level}] ${entry.message}`).join("\n");
      output.scrollTop = output.scrollHeight;
    }
    if (badge) {
      badge.textContent = String(entries.length);
      badge.hidden = entries.length === 0;
    }
  };

  diagnostics.subscribe(render);

  const open = () => {
    if (dialog && !dialog.open) dialog.showModal();
  };
  const close = () => {
    if (dialog?.open) dialog.close();
  };

  openButton?.addEventListener("click", open);
  document.getElementById("diagnostics-close")?.addEventListener("click", close);
  document.getElementById("diagnostics-copy")?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(diagnostics.toText()).then(
      () => diagnostics.ok("Log copiati negli appunti."),
      () => diagnostics.warn("Copia non consentita dal browser."),
    );
  });
  document.getElementById("diagnostics-save")?.addEventListener("click", () => {
    const blob = new Blob([diagnostics.toText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lensdrop-diagnostica-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  document.getElementById("diagnostics-clear")?.addEventListener("click", () => diagnostics.clear());

  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  return { open, close };
}
