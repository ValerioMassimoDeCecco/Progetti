/** Rendering delle righe: contenuti selezionati per l'invio e file ricevuti. */

import type { BundleItem } from "../core/bundle";
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

export interface SendItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: Uint8Array<ArrayBuffer>;
}

export function kindLabel(mime: string, name: string): string {
  return KIND_LABEL[kindOf(mime, name)];
}

function itemIcon(mime: string, name: string): HTMLElement {
  const kind = kindOf(mime, name);
  return el("span", { className: `item__icon item__icon--${kind}` }, [icon(KIND_ICON[kind])]);
}

export function describeFile(size: number, mime: string, name: string): string {
  const parts = [formatBytes(size), kindLabel(mime, name)];
  const ext = fileExtension(name);
  if (ext && ext.length <= 6) parts.push(ext.toUpperCase());
  return parts.join(" · ");
}

/** Elenco dei contenuti scelti per l'invio, con rimozione singola. */
export function renderSendList(list: HTMLElement, items: SendItem[], onRemove: (id: string) => void): void {
  list.replaceChildren();

  for (const item of items) {
    const name = el("span", { className: "item__name", text: item.name });
    name.title = item.name;
    const meta = el("span", { className: "item__meta", text: describeFile(item.size, item.mime, item.name) });
    const body = el("div", { className: "item__body" }, [name, meta]);

    if (kindOf(item.mime, item.name) === "image" && item.size > 0) {
      const url = URL.createObjectURL(new Blob([item.data], { type: item.mime }));
      const image = el("img", { className: "thumb", attrs: { alt: `Anteprima di ${item.name}`, loading: "lazy" } });
      image.src = url;
      image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      image.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
      body.append(image);
    }

    const remove = el(
      "button",
      {
        className: "item__remove icon-btn",
        attrs: { type: "button", "aria-label": `Rimuovi ${item.name}` },
      },
      [icon("x")],
    );
    remove.addEventListener("click", () => onRemove(item.id));

    list.append(el("li", { className: "item" }, [itemIcon(item.mime, item.name), body, remove]));
  }
}

export interface ReceivedHandlers {
  onSave: (item: BundleItem) => void;
  onShare: (item: BundleItem) => void;
  onCopy: (text: string) => void;
  onPreview: (url: string) => void;
}

/**
 * Riga di un contenuto ricevuto: anteprima quando il tipo lo consente,
 * salvataggio, condivisione nativa e copia del testo.
 */
export function createReceivedRow(item: BundleItem, handlers: ReceivedHandlers): HTMLLIElement {
  const kind = kindOf(item.mime, item.name);
  const blob = new Blob([item.data], { type: item.mime || "application/octet-stream" });

  const name = el("span", { className: "item__name", text: item.name });
  name.title = item.name;
  const meta = el("span", {
    className: "item__meta",
    text: describeFile(item.data.byteLength, item.mime, item.name),
  });
  const status = el("span", { className: "item__status item__status--ok" }, [
    icon("check"),
    el("span", { text: "SHA-256 verificato" }),
  ]);
  const body = el("div", { className: "item__body" }, [name, meta, status]);

  const actions = el("div", { className: "item__actions" });
  const save = el("button", { className: "btn btn--primary", attrs: { type: "button" } }, [
    icon("download"),
    el("span", { text: "Salva" }),
  ]);
  save.addEventListener("click", () => handlers.onSave(item));
  actions.append(save);

  if (kind === "image" || kind === "video" || kind === "audio") {
    const url = URL.createObjectURL(blob);
    handlers.onPreview(url);

    if (kind === "image") {
      const image = el("img", { className: "thumb", attrs: { alt: `Anteprima di ${item.name}`, loading: "lazy" } });
      image.src = url;
      body.append(image);
    } else if (kind === "video") {
      const video = el("video", { attrs: { controls: "true", playsinline: "true", preload: "metadata" } });
      video.src = url;
      body.append(video);
    } else {
      const audio = el("audio", { attrs: { controls: "true", preload: "metadata" } });
      audio.src = url;
      body.append(audio);
    }
  }

  if (kind === "text") {
    const preview = el("pre", { className: "text-preview", text: "Anteprima…" });
    body.append(preview);
    void readTextPreview(blob, 4000)
      .then((text) => {
        preview.textContent = text.length > 0 ? text : "(testo vuoto)";
      })
      .catch(() => {
        preview.textContent = "Anteprima non disponibile: salva il file per leggerlo.";
      });

    const copy = el("button", { className: "btn btn--ghost", attrs: { type: "button" } }, [
      icon("copy"),
      el("span", { text: "Copia" }),
    ]);
    copy.addEventListener("click", () => {
      void readTextPreview(blob, 200_000)
        .then((text) => handlers.onCopy(text))
        .catch(() => handlers.onCopy(""));
    });
    actions.append(copy);
  }

  if (typeof navigator.canShare === "function") {
    const share = el("button", { className: "btn btn--ghost", attrs: { type: "button" } }, [
      icon("share"),
      el("span", { text: "Condividi" }),
    ]);
    share.addEventListener("click", () => handlers.onShare(item));
    actions.append(share);
  }

  body.append(actions);
  return el("li", { className: "item item--rich" }, [itemIcon(item.mime, item.name), body]);
}
