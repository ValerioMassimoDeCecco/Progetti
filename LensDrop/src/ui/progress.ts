/** Vista di avanzamento condivisa tra invio e ricezione. */

import type { ItemMeta } from "../core/protocol";
import type { TransferProgress } from "../core/transfer";
import { formatBytes, formatDuration, formatPercent, formatSpeed } from "../core/files";
import { appendRows, rowsFromOffer, setRowOutcome, setRowProgress, type FileRow } from "./items";
import { setText } from "./dom";

export interface ProgressRefs {
  percent: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  bytes: HTMLElement;
  total: HTMLElement;
  speed: HTMLElement;
  eta: HTMLElement;
  current: HTMLElement;
  list: HTMLElement;
}

export class ProgressPanel {
  private rows = new Map<string, FileRow>();
  private order: ItemMeta[] = [];
  private totalBytes = 0;
  private lastProgress: TransferProgress | null = null;

  constructor(
    private readonly refs: ProgressRefs,
    private readonly actionLabel: string,
  ) {}

  reset(items: ItemMeta[], totalBytes: number): void {
    this.order = items;
    this.totalBytes = totalBytes;
    this.rows = rowsFromOffer(items);
    this.lastProgress = null;
    this.refs.list.replaceChildren();
    appendRows(this.refs.list, this.rows, items);
    this.setPercent(0);
    setText(this.refs.bytes, formatBytes(0));
    setText(this.refs.total, formatBytes(totalBytes));
    setText(this.refs.speed, "—");
    setText(this.refs.eta, "—");
    setText(this.refs.current, items.length > 0 ? `Preparazione di ${items[0]!.name}…` : "Preparazione…");
  }

  update(progress: TransferProgress): void {
    this.lastProgress = progress;
    const fraction = progress.totalBytes > 0 ? progress.transferredBytes / progress.totalBytes : 1;
    this.setPercent(fraction * 100);
    setText(this.refs.bytes, formatBytes(progress.transferredBytes));
    setText(this.refs.total, formatBytes(progress.totalBytes));
    setText(this.refs.speed, formatSpeed(progress.speedBps));
    setText(this.refs.eta, progress.etaMs === null ? "—" : formatDuration(progress.etaMs));

    if (progress.currentItemId) {
      const row = this.rows.get(progress.currentItemId);
      if (row && progress.currentItemSize >= 0) {
        const itemFraction =
          progress.currentItemSize > 0
            ? progress.currentItemTransferred / progress.currentItemSize
            : progress.currentItemTransferred > 0
              ? 1
              : 0;
        setRowProgress(row, itemFraction, formatPercent(itemFraction * 100));
      }
    }

    if (progress.currentItemName) {
      setText(
        this.refs.current,
        `${this.actionLabel} ${progress.itemIndex + 1} di ${progress.itemCount}: ${progress.currentItemName}`,
      );
    }
  }

  markItem(meta: ItemMeta, text: string, ok: boolean): void {
    const row = this.rows.get(meta.id);
    if (row) setRowOutcome(row, ok ? "ok" : "error", text);
  }

  finish(): void {
    this.setPercent(100);
    setText(this.refs.bytes, formatBytes(this.totalBytes));
    setText(this.refs.total, formatBytes(this.totalBytes));
    setText(this.refs.speed, "—");
    setText(this.refs.eta, "0 s");
    for (const meta of this.order) {
      const row = this.rows.get(meta.id);
      if (!row) continue;
      if (row.status.classList.contains("item__status--error")) continue;
      if (!row.status.classList.contains("item__status--ok")) {
        setRowOutcome(row, "ok", "completato");
      }
      if (row.barFill) row.barFill.style.width = "100%";
    }
    if (this.lastProgress) {
      setText(this.refs.current, "Trasferimento completato.");
    }
  }

  /** In attesa della conferma del destinatario, prima che inizino i byte. */
  waiting(message: string): void {
    setText(this.refs.current, message);
  }

  showError(message: string): void {
    setText(this.refs.current, message);
  }

  private setPercent(value: number): void {
    const clamped = Math.max(0, Math.min(100, value));
    setText(this.refs.percent, formatPercent(clamped));
    this.refs.fill.style.width = `${clamped}%`;
    this.refs.bar.setAttribute("aria-valuenow", String(Math.round(clamped)));
  }
}
