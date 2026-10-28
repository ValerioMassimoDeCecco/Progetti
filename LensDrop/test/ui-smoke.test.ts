// @vitest-environment jsdom
/**
 * Smoke test dell'interfaccia: carica il markup reale di index.html, avvia
 * l'app e attraversa le schermate. Intercetta selettori mancanti, errori di
 * wiring e regressioni nel routing senza richiedere un browser completo.
 *
 * L'app viene avviata una sola volta: i test condividono lo stesso documento,
 * come accade in una vera sessione utente.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const bodyMarkup = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? "";

function installStubs(): void {
  window.scrollTo = () => undefined;
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }),
      configurable: true,
    });
  }
  const dialogProto = window.HTMLDialogElement?.prototype;
  if (dialogProto && typeof dialogProto.showModal !== "function") {
    dialogProto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    dialogProto.close = function close(this: HTMLDialogElement, value?: string) {
      if (value !== undefined) this.returnValue = value;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:lensdrop-test";
    URL.revokeObjectURL = () => undefined;
  }
}

installStubs();
document.body.innerHTML = bodyMarkup.replace(/<script type="module"[\s\S]*?<\/script>/g, "");

let started = false;
async function boot(): Promise<void> {
  if (started) return;
  const { startApp } = await import("../src/ui/app");
  startApp();
  started = true;
}

function go(hash: string): void {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function isVisible(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  return element !== null && !element.hidden;
}

describe("interfaccia LensDrop", () => {
  it("naviga tra tutte le schermate senza errori di wiring", async () => {
    await boot();

    expect(isVisible("#screen-home")).toBe(true);
    expect(isVisible("#screen-send")).toBe(false);

    go("#/send");
    expect(isVisible("#screen-send")).toBe(true);
    expect(isVisible("#screen-home")).toBe(false);

    go("#/receive");
    expect(isVisible("#screen-receive")).toBe(true);

    go("#/history");
    expect(isVisible("#screen-history")).toBe(true);
    expect(document.querySelector<HTMLElement>("#history-empty")?.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#history-clear")?.disabled).toBe(true);

    go("#/settings");
    expect(isVisible("#screen-settings")).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="signaling-host"]')?.value).toBe(
      "0.peerjs.com",
    );
    expect(document.querySelectorAll("#diagnostics li").length).toBeGreaterThan(4);

    go("#/pagina-inesistente");
    expect(isVisible("#screen-notfound")).toBe(true);

    go("#/");
    expect(isVisible("#screen-home")).toBe(true);
  });

  it("cambia tema dal pulsante dell'intestazione", async () => {
    await boot();
    const root = document.documentElement;
    const initial = root.dataset.theme;
    document.querySelector<HTMLButtonElement>("#theme-toggle")?.click();
    expect(root.dataset.theme).not.toBe(initial);
    const label = document.querySelector("#theme-toggle")?.getAttribute("aria-label");
    expect(label).toMatch(/tema/i);
  });

  it("aggiunge testo alla selezione e abilita l'invio", async () => {
    await boot();
    go("#/send");

    document.querySelector<HTMLButtonElement>("#add-text")?.click();
    const textarea = document.querySelector<HTMLTextAreaElement>("#text-input");
    expect(textarea).not.toBeNull();
    if (textarea) {
      textarea.value = "Ciao dal test di LensDrop";
      textarea.dispatchEvent(new Event("input"));
    }
    expect(document.querySelector("#text-count")?.textContent).toContain("25");

    const dialog = document.querySelector<HTMLDialogElement>("#text-dialog");
    if (dialog) {
      dialog.returnValue = "confirm";
      dialog.dispatchEvent(new Event("close"));
    }

    expect(document.querySelectorAll("#send-items .item").length).toBe(1);
    expect(document.querySelector("#send-items .item__name")?.textContent).toMatch(/^testo-.*\.txt$/);
    expect(document.querySelector<HTMLButtonElement>("#send-start")?.disabled).toBe(false);
    expect(document.querySelector("#send-total")?.textContent).toContain("1 elemento");

    // Il pulsante di rimozione svuota la selezione e disabilita l'invio.
    document.querySelector<HTMLButtonElement>("#send-items .item__remove")?.click();
    expect(document.querySelectorAll("#send-items .item").length).toBe(0);
    expect(document.querySelector<HTMLButtonElement>("#send-start")?.disabled).toBe(true);
  });

  it("salva le impostazioni del tema e mostra conferma", async () => {
    await boot();
    go("#/settings");

    const darkRadio = document.querySelector<HTMLInputElement>('input[name="theme"][value="dark"]');
    expect(darkRadio).not.toBeNull();
    if (darkRadio) {
      darkRadio.checked = true;
      darkRadio.dispatchEvent(new Event("change"));
    }
    expect(document.documentElement.dataset.theme).toBe("dark");

    document
      .querySelector<HTMLFormElement>("#settings-form")
      ?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    const toasts = [...document.querySelectorAll("#toasts .toast")].map((node) => node.textContent ?? "");
    expect(toasts.some((text) => /salvate/i.test(text))).toBe(true);
  });

  it("mostra un invito valido e blocca quelli scaduti", async () => {
    await boot();
    const expires = Math.floor((Date.now() + 5 * 60_000) / 1000);
    go(`#/join?c=ABCDEFGHJKMN&e=${expires}`);

    expect(isVisible("#screen-join")).toBe(true);
    expect(document.querySelector("#join-code")?.textContent).toBe("ABCD-EFGH-JKMN");
    expect(document.querySelector("#join-expiry")?.textContent).toMatch(/Valido fino alle/);
    expect(document.querySelector<HTMLButtonElement>("#join-connect")?.disabled).toBe(false);

    go("#/join?c=ABCDEFGHJKMN&e=1");
    expect(document.querySelector<HTMLButtonElement>("#join-connect")?.disabled).toBe(true);
    expect(document.querySelector("#join-expiry")?.textContent).toMatch(/scaduto/i);

    go("#/join?c=?!");
    expect(document.querySelector("#join-code")?.textContent).toBe("—");
  });
});
