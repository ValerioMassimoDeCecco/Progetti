/** Bootstrap dell'interfaccia: routing, tema, cronologia, avvisi globali. */

import { formatBytes, formatRelative, isSecureContextAvailable } from "../core/files";
import { clear, confirmDialog, must, show, toast } from "./dom";
import { initDiagnostics, diagnostics } from "./diagnostics";
import { clearHistory, loadHistory } from "./history";
import { ReceiveScreen } from "./receive";
import { SendScreen } from "./send";
import { SettingsScreen } from "./settings-screen";
import { initTheme } from "./theme";

type RouteName = "home" | "send" | "receive" | "history" | "settings" | "notfound";

const SCREEN_SELECTORS: Record<RouteName, string> = {
  home: "#screen-home",
  send: "#screen-send",
  receive: "#screen-receive",
  history: "#screen-history",
  settings: "#screen-settings",
  notfound: "#screen-notfound",
};

const sendScreen = new SendScreen();
const receiveScreen = new ReceiveScreen();
const settingsScreen = new SettingsScreen();

let currentScreen: RouteName | null = null;
let booted = false;

function parseRoute(): RouteName {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const path = raw.split("?")[0]?.replace(/\/+$/, "") ?? "";
  switch (path) {
    case "":
      return "home";
    case "send":
      return "send";
    case "receive":
      return "receive";
    case "history":
      return "history";
    case "settings":
      return "settings";
    default:
      return "notfound";
  }
}

function showScreen(name: RouteName): void {
  for (const selector of Object.values(SCREEN_SELECTORS)) {
    must<HTMLElement>(selector).hidden = true;
  }
  must<HTMLElement>(SCREEN_SELECTORS[name]).hidden = false;
  if (currentScreen !== name && currentScreen !== null) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  currentScreen = name;
}

function route(): void {
  const next = parseRoute();

  // Uscendo da invio o ricezione, le risorse hardware vanno sempre rilasciate.
  if (currentScreen === "send" && next !== "send") sendScreen.hide();
  if (currentScreen === "receive" && next !== "receive") receiveScreen.hide();

  switch (next) {
    case "send":
      showScreen("send");
      sendScreen.show();
      break;
    case "receive":
      showScreen("receive");
      receiveScreen.show();
      break;
    case "history":
      showScreen("history");
      renderHistory();
      break;
    case "settings":
      showScreen("settings");
      settingsScreen.show();
      break;
    case "notfound":
      showScreen("notfound");
      break;
    case "home":
    default:
      showScreen("home");
      break;
  }
}

const OUTCOME_LABEL = {
  ok: "completato",
  cancelled: "interrotto",
  error: "errore",
} as const;

function renderHistory(): void {
  const entries = loadHistory();
  const list = must<HTMLUListElement>("#history-list");
  const empty = must<HTMLElement>("#history-empty");
  const clearButton = must<HTMLButtonElement>("#history-clear");

  clear(list);
  show(empty, entries.length === 0);
  show(list, entries.length > 0);
  clearButton.disabled = entries.length === 0;

  for (const entry of entries) {
    const row = document.createElement("li");
    row.className = "history-row";

    const direction = document.createElement("span");
    direction.className = `history-row__dir${entry.direction === "out" ? " history-row__dir--out" : ""}`;
    direction.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", entry.direction === "out" ? "#i-send" : "#i-receive");
    svg.append(use);
    direction.append(svg);

    const body = document.createElement("div");
    body.className = "history-row__body";

    const title = document.createElement("span");
    title.className = "history-row__title";
    const first = entry.files[0]?.name;
    title.textContent =
      entry.files.length === 0
        ? entry.direction === "out"
          ? "Invio"
          : "Ricezione"
        : entry.files.length === 1 && first
          ? first
          : `${entry.files.length} contenuti${first ? ` · ${first}` : ""}`;

    const meta = document.createElement("span");
    meta.className = "history-row__meta";
    meta.textContent = `${entry.direction === "out" ? "Inviato" : "Ricevuto"} · ${formatBytes(
      entry.totalBytes,
    )} · ${formatRelative(entry.at)} · ${OUTCOME_LABEL[entry.outcome]}`;

    body.append(title, meta);
    row.append(direction, body);
    list.append(row);
  }
}

function bindGlobalShortcuts(): void {
  must("#history-clear").addEventListener("click", () => {
    void confirmDialog({
      title: "Svuotare la cronologia?",
      message: "Vengono eliminati solo i metadati dei trasferimenti: nessun file è mai stato salvato.",
      confirmLabel: "Svuota",
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      clearHistory();
      renderHistory();
      toast("Cronologia svuotata.", "ok");
    });
  });

  window.addEventListener("hashchange", route);

  // Un drop fuori dalle aree di invio non deve aprire il file nel browser.
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => event.preventDefault());

  window.addEventListener("offline", () => diagnostics.info("Dispositivo offline: il canale ottico continua a funzionare."));
  window.addEventListener("online", () => diagnostics.info("Rete disponibile (non necessaria per il trasferimento)."));

  window.addEventListener("pagehide", () => {
    sendScreen.hide();
    receiveScreen.hide();
  });
}

function warnEnvironment(): void {
  if (!isSecureContextAvailable()) {
    toast("Apri LensDrop in HTTPS: senza contesto sicuro la fotocamera è bloccata.", "error", 9000);
    diagnostics.error("Contesto non sicuro: la fotocamera richiede HTTPS.");
    return;
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    toast("Questo browser non espone la fotocamera: il trasferimento ottico non può funzionare.", "error", 9000);
    diagnostics.error("getUserMedia non disponibile.");
    return;
  }
  diagnostics.ok("Ambiente pronto: fotocamera disponibile, contesto sicuro.");
}

export function startApp(): void {
  if (booted) return;
  booted = true;

  initTheme();
  initDiagnostics();
  bindGlobalShortcuts();

  if (window.location.hash === "" || window.location.hash === "#") {
    window.location.hash = "#/";
  }
  route();
  warnEnvironment();
}
