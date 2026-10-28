/** Rendering delle righe file: selezione, avanzamento, contenuti ricevuti. */

import type { ItemMeta } from "../core/protocol";
import type { ReceivedItem } from "../core/transfer";
import {
  fileExtension,
  formatBytes,
  kindOf,
  readTextPreview,
  type ContentKind,
} from "../core/files";
import { el, icon } from "./dom";

const KIND_ICON: Record<ContentKind, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  pdf: "file",
  archive: "archive",
  text: "text",
  file: "file",
};

const KIND_LABEL: Record<ContentKind, string> = {
  image: "immagine",
  video: "video",
  audio: "audio",
  pdf: "PDF",
  archive: "archivio",
  text: "testo",
  file: "file",
};

export function kindLabel(mime: string, name: string): string {
  return KIND_LABEL[kindOf(mime, name)];
}

function itemIcon(mime: string, name: string): HTMLElement {
  const kind = kindOf(mime, name);
  const holder = el("span", { className: `item__icon item__icon--${kind}` }, [icon(KIND_ICON[kind])]);
  return holder;
}

export function describeFile(size: number, mime: string, name: string): string {
  const parts = [formatBytes(size), kindLabel(mime, name)];
  const ext = fileExtension(name);
  if (ext && ext.length <= 6) parts.push(ext.toUpperCase());
  return parts.join(" · ");
}

export interface FileRow {
  row: HTMLLIElement;
  status: HTMLElement;
  bar: HTMLElement | null;
  barFill: HTMLElement | null;
}

interface FileRowOptions {
  name: string;
  size: number;
  mime: string;
  removable?: boolean;
  onRemove?: () => void;
}

export function createFileRow(options: FileRowOptions): FileRow {
  const status = el("span", { className: "item__status", text: options.removable ? "" : "in attesa" });
  const name = el("span", { className: "item__name", text: options.name });
  name.title = options.name;
  const meta = el("span", { className: "item__meta", text: describeFile(options.size, options.mime, options.name) });
  const body = el("div", { className: "item__body" }, [name, meta]);
  const row = el("li", { className: "item" }, [itemIcon(options.mime, options.name), body, status]);

  let bar: HTMLElement | null = null;
  let barFill: HTMLElement | null = null;

  if (options.removable) {
    const remove = el("button", {
      className: "item__remove icon-btn",
      attrs: { type: "button", "aria-label": `Rimuovi ${options.name}` },
    }, [icon("x")]);
    remove.addEventListener("click", () => options.onRemove?.());
    row.append(remove);
  } else {
    barFill = el("span");
    bar = el("div", { className: "item__bar" }, [barFill]);
    body.append(bar);
  }

  return { row, status, bar, barFill };
}

export function setRowProgress(row: FileRow, fraction: number, label?: string): void {
  if (row.barFill) row.barFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (label !== undefined) row.status.textContent = label;
}

export function setRowOutcome(row: FileRow, state: "ok" | "error" | "pending", text: string): void {
  row.status.textContent = text;
  row.status.classList.toggle("item__status--ok", state === "ok");
  row.status.classList.toggle("item__status--error", state === "error");
  if (state === "ok" && row.barFill) row.barFill.style.width = "100%";
}

/** Converte i metadati del protocollo in righe di avanzamento. */
export function rowsFromOffer(items: ItemMeta[]): Map<string, FileRow> {
  const map = new Map<string, FileRow>();
  for (const meta of items) {
    const row = createFileRow({ name: meta.name, size: meta.size, mime: meta.mime });
    map.set(meta.id, row);
  }
  return map;
}

export function appendRows(list: HTMLElement, rows: Map<string, FileRow>, order: ItemMeta[]): void {
  for (const meta of order) {
    const row = rows.get(meta.id);
    if (row) list.append(row.row);
  }
}

interface ReceivedRowHandlers {
  onDownload: (item: ReceivedItem) => void;
  onShare: (item: ReceivedItem) => void;
  onCopy: (text: string) => void;
  onPreviewUrl: (url: string) => void;
}

/**
 * Riga ricca per un contenuto ricevuto: anteprima immagine/audio/video,
 * estratto del testo, download e condivisione nativa quando disponibile.
 */
export function createReceivedRow(item: ReceivedItem, handlers: ReceivedRowHandlers): HTMLLIElement {
  const kind = kindOf(item.meta.mime, item.fileName);
  const status = el("span", { className: "item__status item__status--ok" }, [
    icon("check"),
    el("span", { text: "SHA-256 ok" }),
  ]);
  const name = el("span", { className: "item__name", text: item.fileName });
  name.title = item.fileName;
  const meta = el("span", {
    className: "item__meta",
    text: `${formatBytes(item.blob.size)} · ${item.meta.mime || "tipo sconosciuto"}`,
  });
  const body = el("div", { className: "item__body" }, [name, meta, status]);

  const actions = el("div", { className: "item__actions" });
  const download = el(
    "button",
    { className: "btn btn--primary", attrs: { type: "button" } },
    [icon("download"), el("span", { text: "Scarica" })],
  );
  download.addEventListener("click", () => handlers.onDownload(item));
  actions.append(download);

  const share = el(
    "button",
    { className: "btn btn--ghost", attrs: { type: "button" } },
    [icon("share"), el("span", { text: "Condividi" })],
  );
  share.addEventListener("click", () => handlers.onShare(item));
  actions.append(share);

  if (kind === "image") {
    const url = URL.createObjectURL(item.blob);
    handlers.onPreviewUrl(url);
    const image = el("img", { className: "thumb", attrs: { alt: `Anteprima di ${item.fileName}`, loading: "lazy" } });
    image.src = url;
    body.append(image);
  } else if (kind === "video") {
    const url = URL.createObjectURL(item.blob);
    handlers.onPreviewUrl(url);
    const video = el("video", { attrs: { controls: "true", playsinline: "true", preload: "metadata" } });
    video.src = url;
    body.append(video);
  } else if (kind === "audio") {
    const url = URL.createObjectURL(item.blob);
    handlers.onPreviewUrl(url);
    const audio = el("audio", { attrs: { controls: "true", preload: "metadata" } });
    audio.src = url;
    body.append(audio);
  } else if (kind === "text") {
    const preview = el("pre", { className: "text-preview", text: "Caricamento anteprima…" });
    body.append(preview);
    void readTextPreview(item.blob, 4000)
      .then((text) => {
        preview.textContent = text.length > 0 ? text : "(file di testo vuoto)";
      })
      .catch(() => {
        preview.textContent = "Anteprima non disponibile: scarica il file per leggerlo.";
      });
    const copy = el(
      "button",
      { className: "btn btn--ghost", attrs: { type: "button" } },
      [icon("copy"), el("span", { text: "Copia testo" })],
    );
    copy.addEventListener("click", () => {
      void readTextPreview(item.blob, 200_000)
        .then((text) => handlers.onCopy(text))
        .catch(() => handlers.onCopy(""));
    });
    actions.append(copy);
  }

  body.append(actions);

  return el("li", { className: "item item--rich" }, [itemIcon(item.meta.mime, item.fileName), body]);
}
