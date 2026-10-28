/** Piccoli helper DOM condivisi: nessun framework, nessun HTML dinamico non sicuro. */

const SVG_NS = "http://www.w3.org/2000/svg";

export function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento richiesto non trovato: ${selector}`);
  return element;
}

export function icon(name: string, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; attrs?: Record<string, string> } = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Sostituisce il contenuto di un pulsante con icona + etichetta. */
export function setButtonContent(
  button: HTMLButtonElement | HTMLLinkElement,
  iconName: string,
  label: string,
): void {
  button.replaceChildren(icon(iconName), document.createTextNode(` ${label}`));
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: HTMLElement, visible: boolean): void {
  node.hidden = !visible;
}

export function setText(node: Element | null, text: string): void {
  if (node) node.textContent = text;
}

type ToastVariant = "default" | "ok" | "error";

/** Notifica non invasiva in basso; si auto-rimuove senza bloccare l'interazione. */
export function toast(message: string, variant: ToastVariant = "default", durationMs = 4200): void {
  const container = must<HTMLDivElement>("#toasts");
  const node = el("div", { className: `toast${variant === "default" ? "" : ` toast--${variant}`}` }, [
    icon(variant === "error" ? "warning" : variant === "ok" ? "check" : "shield"),
    el("span", { text: message }),
  ]);
  container.append(node);
  const remove = () => {
    node.classList.add("is-leaving");
    window.setTimeout(() => node.remove(), 300);
  };
  const timer = window.setTimeout(remove, durationMs);
  node.addEventListener("click", () => {
    window.clearTimeout(timer);
    remove();
  });
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const dialog = must<HTMLDialogElement>("#confirm-dialog");
  const title = must<HTMLElement>("#confirm-title");
  const message = must<HTMLElement>("#confirm-message");
  const ok = must<HTMLButtonElement>("#confirm-ok");
  const cancel = dialog.querySelector<HTMLButtonElement>('button[value="cancel"]');

  title.textContent = options.title;
  message.textContent = options.message;
  ok.textContent = options.confirmLabel ?? "Conferma";
  if (cancel) cancel.textContent = options.cancelLabel ?? "Annulla";
  ok.classList.toggle("btn--danger", options.danger === true);
  ok.classList.toggle("btn--primary", options.danger !== true);

  return new Promise<boolean>((resolve) => {
    const handleClose = () => {
      dialog.removeEventListener("close", handleClose);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.returnValue = "cancel";
    dialog.addEventListener("close", handleClose);
    dialog.showModal();
  });
}

/** Imposta lo stato occupato di un pulsante mantenendo l'etichetta accessibile. */
export function setBusy(button: HTMLButtonElement, busy: boolean, busyLabel = "Attendi…"): void {
  if (busy) {
    button.dataset.idleLabel = button.textContent ?? "";
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Si è verificato un errore imprevisto.";
}
