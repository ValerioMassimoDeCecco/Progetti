/** Gestione del tema: automatico, chiaro o scuro, con preferenza salvata. */

import { loadSettings, saveSettings, type ThemeChoice } from "../core/settings";
import { must } from "./dom";

const THEME_ORDER: ThemeChoice[] = ["auto", "light", "dark"];

export function applyTheme(choice: ThemeChoice, persist = true): void {
  document.documentElement.dataset.theme = choice;
  const settings = loadSettings();
  if (settings.theme !== choice) {
    settings.theme = choice;
    if (persist) saveSettings(settings);
  }
  updateThemeButton(choice);
}

function updateThemeButton(choice: ThemeChoice): void {
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (!button) return;
  const effective =
    choice === "auto"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : choice;
  const use = button.querySelector("use");
  use?.setAttribute("href", effective === "light" ? "#i-sun" : "#i-moon");
  const labels: Record<ThemeChoice, string> = {
    auto: "Tema automatico",
    light: "Tema chiaro",
    dark: "Tema scuro",
  };
  button.setAttribute("aria-label", `${labels[choice]} — cambia tema`);
  button.title = labels[choice];
}

export function initTheme(): void {
  const settings = loadSettings();
  applyTheme(settings.theme, false);

  const button = must<HTMLButtonElement>("#theme-toggle");
  button.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme as ThemeChoice | undefined;
    const index = THEME_ORDER.indexOf(current ?? "auto");
    const next = THEME_ORDER[(index + 1) % THEME_ORDER.length]!;
    applyTheme(next);
  });

  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => {
    if ((document.documentElement.dataset.theme as ThemeChoice) === "auto") {
      applyTheme("auto", false);
    }
  });
}
