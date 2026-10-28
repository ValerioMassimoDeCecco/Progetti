/** Impostazioni: tema, densità dei frame, velocità e stato delle API del browser. */

import { DENSITY_PRESETS, SPEED_PRESETS } from "../config";
import { compressionSupported } from "../core/compression";
import { isSecureContextAvailable } from "../core/files";
import { loadSettings, saveSettings, type AppSettings, type ThemeChoice } from "../core/settings";
import { must, toast } from "./dom";
import { applyTheme } from "./theme";

interface Capability {
  label: string;
  available: boolean;
  hint: string;
}

export class SettingsScreen {
  private readonly form = must<HTMLFormElement>("#settings-form");
  private readonly capabilities = must<HTMLUListElement>("#capabilities");
  private bound = false;

  show(): void {
    this.bind();
    this.populate(loadSettings());
    this.renderCapabilities();
  }

  private bind(): void {
    if (this.bound) return;
    this.bound = true;

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.save();
    });

    for (const input of this.form.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
      input.addEventListener("change", () => {
        if (input.checked) applyTheme(input.value as ThemeChoice, true);
      });
    }

    must<HTMLButtonElement>("#open-diagnostics-form").addEventListener("click", () => {
      document.getElementById("open-diagnostics")?.click();
    });
  }

  private populate(settings: AppSettings): void {
    for (const input of this.form.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
      input.checked = input.value === settings.theme;
    }
    for (const input of this.form.querySelectorAll<HTMLInputElement>('input[name="density"]')) {
      input.checked = Number(input.value) === settings.blockSize;
    }
    for (const input of this.form.querySelectorAll<HTMLInputElement>('input[name="speed"]')) {
      input.checked = Number(input.value) === settings.fps;
    }
    must<HTMLInputElement>("#setting-keep-awake").checked = settings.keepAwake;
  }

  private save(): void {
    const theme = this.form.querySelector<HTMLInputElement>('input[name="theme"]:checked')?.value ?? "auto";
    const density = Number(this.form.querySelector<HTMLInputElement>('input[name="density"]:checked')?.value ?? "");
    const speed = Number(this.form.querySelector<HTMLInputElement>('input[name="speed"]:checked')?.value ?? "");
    const keepAwake = must<HTMLInputElement>("#setting-keep-awake").checked;

    const settings: AppSettings = {
      theme: theme === "light" || theme === "dark" ? theme : "auto",
      blockSize: DENSITY_PRESETS.some((preset) => preset.blockSize === density) ? density : 700,
      fps: SPEED_PRESETS.some((preset) => preset.fps === speed) ? speed : 8,
      keepAwake,
    };

    saveSettings(settings);
    applyTheme(settings.theme, false);
    toast("Impostazioni salvate.", "ok");
  }

  private renderCapabilities(): void {
    const detector = "BarcodeDetector" in window;
    const list: Capability[] = [
      {
        label: "Contesto sicuro (HTTPS)",
        available: isSecureContextAvailable(),
        hint: "Necessario per la fotocamera e per la PWA.",
      },
      {
        label: "Fotocamera (getUserMedia)",
        available: typeof navigator.mediaDevices?.getUserMedia === "function",
        hint: "Serve al dispositivo che riceve.",
      },
      {
        label: "Decodifica hardware (BarcodeDetector)",
        available: detector,
        hint: detector ? "Usata quando presente." : "In assenza si usa jsQR: più lento ma funzionante.",
      },
      {
        label: "Compressione gzip",
        available: compressionSupported(),
        hint: "Riduce i frame necessari per testi e PDF.",
      },
      {
        label: "Condivisione file",
        available: typeof navigator.canShare === "function",
        hint: "Per inoltrare i file ricevuti ad altre app.",
      },
    ];

    this.capabilities.replaceChildren();
    for (const capability of list) {
      const item = document.createElement("li");
      item.className = `capability${capability.available ? " capability--ok" : ""}`;

      const name = document.createElement("span");
      name.className = "capability__name";
      name.textContent = capability.label;

      const state = document.createElement("span");
      state.className = "capability__state";
      state.textContent = capability.available ? "disponibile" : "non disponibile";

      const hint = document.createElement("span");
      hint.className = "capability__hint";
      hint.textContent = capability.hint;

      item.append(name, state, hint);
      this.capabilities.append(item);
    }
  }
}
