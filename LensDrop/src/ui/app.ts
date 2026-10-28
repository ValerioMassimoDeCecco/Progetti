/** Bootstrap dell'interfaccia: routing, tema, cronologia, avvisi globali. */

import { formatCode, normalizeCode } from "../core/base32";
import { formatBytes, formatClock, formatRelative, isSecureContextAvailable, supportsWebRtc } from "../core/files";
import { clear, confirmDialog, must, setText, show, toast } from "./dom";
import { clearHistory, loadHistory } from "./history";
import { ReceiveScreen } from "./receive";
import { SendScreen } from "./send";
import { SettingsScreen } from "./settings-screen";
import { initTheme } from "./theme";

type Route =
  | { name: "home" }
  | { name: "send" }
  | { name: "receive" }
  | { name: "join"; code: string; expiresAt: number | null }
  | { name: "history" }
  | { name: "settings" }
  | { name: "notfound" };

const SCREEN_SELECTORS = {
  home: "#screen-home",
  send: "#screen-send",
  receive: "#screen-receive",
  join: "#screen-join",
  history: "#screen-history",
  settings: "#screen-settings",
  notfound: "#screen-notfound",
} as const;

const sendScreen = new SendScreen();
const receiveScreen = new ReceiveScreen();
const settingsScreen = new SettingsScreen();

let currentScreen: keyof typeof SCREEN_SELECTORS | null = null;
let pendingJoin: { code: string; expiresAt: number | null } | null = null;

function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [rawPath = "", rawQuery = ""] = raw.split("?");
  const path = rawPath.replace(/\/+$/, "");
  const params = new URLSearchParams(rawQuery);

  switch (path) {
    case "":
      return { name: "home" };
    case "send":
      return { name: "send" };
    case "receive":
      return { name: "receive" };
    case "join": {
      const expiration = Number(params.get("e"));
      return {
        name: "join",
        code: params.get("c") ?? "",
        expiresAt: Number.isFinite(expiration) && expiration > 0 ? expiration * 1000 : null,
      };
    }
    case "history":
      return { name: "history" };
    case "settings":
      return { name: "settings" };
    default:
      return { name: "notfound" };
  }
}

function showScreen(name: keyof typeof SCREEN_SELECTORS): void {
  for (const selector of Object.values(SCREEN_SELECTORS)) {
    must<HTMLElement>(selector).hidden = true;
  }
  must<HTMLElement>(SCREEN_SELECTORS[name]).hidden = false;
  if (currentScreen !== name) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  currentScreen = name;
}

function route(): void {
  const next = parseRoute();
  if (currentScreen === "receive" && next.name !== "receive") receiveScreen.hide();

  switch (next.name) {
    case "send":
      showScreen("send");
      sendScreen.show();
      break;
    case "receive":
      showScreen("receive");
      receiveScreen.show();
      if (pendingJoin) {
        const join = pendingJoin;
        pendingJoin = null;
        void receiveScreen.connectWithCode(join.code, join.expiresAt);
      }
      break;
    case "join":
      showScreen("join");
      renderJoin(next);
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

function renderJoin(routeData: Extract<Route, { name: "join" }>): void {
  const code = normalizeCode(routeData.code);
  const codeEl = must("#join-code");
  const expiryEl = must("#join-expiry");
  const errorBox = must<HTMLElement>("#join-error");
  const connectButton = must<HTMLButtonElement>("#join-connect");
  errorBox.hidden = true;

  if (!code) {
    setText(codeEl, "—");
    setText(expiryEl, "Il link non contiene un codice di sessione valido.");
    connectButton.disabled = true;
    return;
  }

  setText(codeEl, formatCode(code));
  if (routeData.expiresAt === null) {
    setText(expiryEl, "Nessuna scadenza indicata nel link.");
  } else if (Date.now() > routeData.expiresAt) {
    setText(expiryEl, "Questo invito è scaduto: chiedi al mittente un nuovo codice.");
    connectButton.disabled = true;
    return;
  } else {
    setText(expiryEl, `Valido fino alle ${formatClock(new Date(routeData.expiresAt))}.`);
  }

  connectButton.disabled = false;
  connectButton.onclick = () => {
    pendingJoin = { code, expiresAt: routeData.expiresAt };
    if (window.location.hash === "#/receive") {
      const join = pendingJoin;
      pendingJoin = null;
      void receiveScreen.connectWithCode(join.code, join.expiresAt);
    } else {
      window.location.hash = "#/receive";
    }
  };
}

const OUTCOME_LABEL = {
  ok: "completato",
  cancelled: "annullato",
  error: "errore",
} as const;

function renderHistory(): void {
  const entries = loadHistory();
  const list = must<HTMLUListElement>("#history-list");
  const empty = must<HTMLElement>("#history-empty");
  const clearButton = must<HTMLButtonElement>("#history-clear");
  clear(list);
  show(empty, entries.length === 0);
  clearButton.disabled = entries.length === 0;

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "history-row";

    const direction = document.createElement("span");
    direction.className = `history-row__dir${entry.direction === "out" ? " history-row__dir--out" : ""}`;
    direction.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", entry.direction === "out" ? "#i-send" : "#i-receive");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
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
    meta.textContent = `${entry.direction === "out" ? "Inviato" : "Ricevuto"} · ${formatBytes(entry.totalBytes)} · ${formatRelative(entry.at)} · ${OUTCOME_LABEL[entry.outcome]}`;
    body.append(title, meta);
    li.append(direction, body);
    list.append(li);
  }
}

function bindGlobalShortcuts(): void {
  must("#history-clear").addEventListener("click", () => {
    void confirmDialog({
      title: "Svuotare la cronologia?",
      message: "Verranno eliminati solo i metadati dei trasferimenti. I file non sono mai stati salvati.",
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

  // Evita che un drop fuori dall'area di invio apra il file nel browser.
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => event.preventDefault());

  window.addEventListener("online", () => toast("Connessione ripristinata.", "ok"));
  window.addEventListener("offline", () =>
    toast("Sei offline: il trasferimento richiede una connessione attiva.", "error"),
  );

  window.addEventListener("pagehide", () => {
    sendScreen.dispose();
    receiveScreen.dispose();
  });
}

function warnEnvironment(): void {
  if (!supportsWebRtc()) {
    toast("Questo browser non supporta WebRTC: il trasferimento non può funzionare.", "error", 9000);
    return;
  }
  if (!isSecureContextAvailable()) {
    toast("Apri LensDrop in HTTPS: senza contesto sicuro fotocamera e clipboard sono bloccati.", "error", 9000);
    return;
  }
  const local = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (local && !window.isSecureContext) {
    toast("In locale usa localhost o HTTPS per attivare la fotocamera.", "error", 9000);
  }
}

export function startApp(): void {
  initTheme();
  bindGlobalShortcuts();
  if (window.location.hash === "" || window.location.hash === "#") {
    window.location.hash = "#/";
  }
  route();
  warnEnvironment();
}
