/** Schermata impostazioni: tema, segnalazione, relay TURN e diagnostica. */

import { DEFAULT_SIGNALING } from "../config";
import { canShareFiles, isSecureContextAvailable, supportsWebRtc } from "../core/files";
import {
  loadSettings,
  saveSettings,
  resolveSignaling,
  type AppSettings,
  type ThemeChoice,
} from "../core/settings";
import { must, setText, show, toast } from "./dom";
import { applyTheme } from "./theme";

function hasCamera(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

export class SettingsScreen {
  private readonly form = must<HTMLFormElement>("#settings-form");
  private readonly customBlock = must<HTMLElement>("#custom-signaling");
  private readonly turnFields = must<HTMLElement>("#turn-fields");
  private readonly diagnostics = must<HTMLUListElement>("#diagnostics");

  constructor() {
    this.bind();
  }

  show(): void {
    this.populate(loadSettings());
    this.renderDiagnostics();
  }

  private bind(): void {
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.save();
    });

    for (const input of this.form.querySelectorAll<HTMLInputElement>('input[name="signaling-mode"]')) {
      input.addEventListener("change", () => this.syncConditionalFields());
    }
    const turnSwitch = this.form.querySelector<HTMLInputElement>('input[name="turn-enabled"]');
    turnSwitch?.addEventListener("change", () => this.syncConditionalFields());

    for (const input of this.form.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
      input.addEventListener("change", () => {
        if (input.checked) applyTheme(input.value as ThemeChoice, true);
      });
    }
  }

  private fields(): {
    signalingMode: HTMLInputElement[];
    host: HTMLInputElement;
    port: HTMLInputElement;
    path: HTMLInputElement;
    key: HTMLInputElement;
    secure: HTMLInputElement;
    turnEnabled: HTMLInputElement;
    turnUrls: HTMLInputElement;
    turnUser: HTMLInputElement;
    turnCredential: HTMLInputElement;
    themes: HTMLInputElement[];
  } {
    const byName = <T extends HTMLInputElement>(name: string) =>
      must<T>(`#settings-form input[name="${name}"]`);
    return {
      signalingMode: [...this.form.querySelectorAll<HTMLInputElement>('input[name="signaling-mode"]')],
      host: byName("signaling-host"),
      port: byName("signaling-port"),
      path: byName("signaling-path"),
      key: byName("signaling-key"),
      secure: byName("signaling-secure"),
      turnEnabled: byName("turn-enabled"),
      turnUrls: byName("turn-urls"),
      turnUser: byName("turn-username"),
      turnCredential: byName("turn-credential"),
      themes: [...this.form.querySelectorAll<HTMLInputElement>('input[name="theme"]')],
    };
  }

  private populate(settings: AppSettings): void {
    const fields = this.fields();

    for (const input of fields.themes) input.checked = input.value === settings.theme;
    for (const input of fields.signalingMode) input.checked = input.value === settings.signaling.mode;

    fields.host.value = settings.signaling.host;
    fields.port.value = String(settings.signaling.port);
    fields.path.value = settings.signaling.path;
    fields.key.value = settings.signaling.key;
    fields.secure.checked = settings.signaling.secure;

    fields.turnEnabled.checked = settings.turn.enabled;
    fields.turnUrls.value = settings.turn.urls;
    fields.turnUser.value = settings.turn.username;
    fields.turnCredential.value = settings.turn.credential;

    this.syncConditionalFields();
  }

  private syncConditionalFields(): void {
    const fields = this.fields();
    const custom = fields.signalingMode.find((input) => input.value === "custom")?.checked === true;
    show(this.customBlock, custom);
    show(this.turnFields, fields.turnEnabled.checked);
  }

  private save(): void {
    const fields = this.fields();
    const settings = loadSettings();

    const theme = fields.themes.find((input) => input.checked)?.value ?? "auto";
    if (theme === "light" || theme === "dark" || theme === "auto") settings.theme = theme;

    const custom = fields.signalingMode.find((input) => input.value === "custom")?.checked === true;
    if (custom) {
      const host = fields.host.value.trim();
      if (host === "" || /[\s/]/.test(host)) {
        toast("Inserisci un host valido per il server di segnalazione (senza schema né slash).", "error");
        fields.host.focus();
        return;
      }
      const port = Number.parseInt(fields.port.value, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        toast("La porta deve essere un numero tra 1 e 65535.", "error");
        fields.port.focus();
        return;
      }
      let path = fields.path.value.trim() || "/";
      if (!path.startsWith("/")) path = `/${path}`;
      const key = fields.key.value.trim();
      if (key === "") {
        toast("La chiave del server è obbligatoria.", "error");
        fields.key.focus();
        return;
      }
      settings.signaling = { mode: "custom", host, port, path, key, secure: fields.secure.checked };
    } else {
      settings.signaling = { ...DEFAULT_SIGNALING };
    }

    settings.turn = {
      enabled: fields.turnEnabled.checked,
      urls: fields.turnUrls.value.trim(),
      username: fields.turnUser.value,
      credential: fields.turnCredential.value,
    };

    if (settings.turn.enabled) {
      const urls = settings.turn.urls
        .split(/[\s,]+/)
        .map((url) => url.trim())
        .filter((url) => /^turns?:[a-z0-9.\-[\]:]+$/i.test(url));
      if (urls.length === 0) {
        toast("Inserisci almeno un URL TURN valido, ad esempio turn:host:3478.", "error");
        fields.turnUrls.focus();
        return;
      }
    }

    saveSettings(settings);
    applyTheme(settings.theme);
    toast("Impostazioni salvate. Valgono dalle prossime sessioni.", "ok");
    this.renderDiagnostics();
  }

  private renderDiagnostics(): void {
    const settings = loadSettings();
    const signaling = resolveSignaling(settings);
    const items: Array<{ label: string; value: string; state: "ok" | "warn" | "error" }> = [
      {
        label: "WebRTC",
        value: supportsWebRtc() ? "disponibile" : "non disponibile",
        state: supportsWebRtc() ? "ok" : "error",
      },
      {
        label: "Contesto sicuro (HTTPS)",
        value: isSecureContextAvailable() ? "attivo" : "assente",
        state: isSecureContextAvailable() ? "ok" : "error",
      },
      {
        label: "Fotocamera (getUserMedia)",
        value: hasCamera() ? "disponibile" : "non disponibile",
        state: hasCamera() ? "ok" : "warn",
      },
      {
        label: "Condivisione nativa",
        value: canShareFiles() ? "disponibile" : "solo download",
        state: canShareFiles() ? "ok" : "warn",
      },
      {
        label: "Service worker (PWA)",
        value: "serviceWorker" in navigator ? "disponibile" : "assente",
        state: "serviceWorker" in navigator ? "ok" : "warn",
      },
      {
        label: "Segnalazione",
        value:
          signaling.mode === "custom"
            ? `${signaling.host}:${signaling.port}${signaling.path}`
            : "PeerJS Cloud pubblico",
        state: signaling.mode === "custom" ? "ok" : "warn",
      },
      {
        label: "Relay TURN",
        value: settings.turn.enabled ? "configurato dall'utente" : "demo PeerJS",
        state: settings.turn.enabled ? "ok" : "warn",
      },
    ];

    this.diagnostics.replaceChildren(
      ...items.map((item) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = item.label;
        const value = document.createElement("span");
        value.className = `value value--${item.state}`;
        value.textContent = item.value;
        li.append(label, value);
        return li;
      }),
    );

    if (signaling.mode === "cloud") {
      const note = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = "Nota";
      const value = document.createElement("span");
      value.className = "value value--warn";
      value.textContent = "servizio gratuito senza garanzia di uptime";
      note.append(label, value);
      this.diagnostics.append(note);
    }

    setText(must("#settings-title"), "Impostazioni");
  }
}
