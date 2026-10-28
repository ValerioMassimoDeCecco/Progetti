// @vitest-environment jsdom
/** Impostazioni locali: valori ammessi, fallback e persistenza. */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, loadSettings, saveSettings, updateSettings } from "../src/core/settings";

describe("impostazioni", () => {
  beforeEach(() => localStorage.clear());

  it("usa i valori predefiniti quando non c'è nulla di salvato", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("salva e rilegge le preferenze", () => {
    saveSettings({ theme: "light", blockSize: 520, fps: 4, keepAwake: false });
    expect(loadSettings()).toEqual({ theme: "light", blockSize: 520, fps: 4, keepAwake: false });
  });

  it("ignora valori non ammessi", () => {
    localStorage.setItem(
      "lensdrop.settings.v2",
      JSON.stringify({ theme: "arcobaleno", blockSize: 999, fps: 120, keepAwake: "sì" }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("sopravvive a JSON corrotto", () => {
    localStorage.setItem("lensdrop.settings.v2", "{non-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("aggiorna solo le chiavi indicate", () => {
    saveSettings(DEFAULT_SETTINGS);
    const next = updateSettings({ fps: 14 });
    expect(next.fps).toBe(14);
    expect(next.blockSize).toBe(DEFAULT_SETTINGS.blockSize);
    expect(loadSettings().fps).toBe(14);
  });
});
