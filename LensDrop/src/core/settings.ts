/**
 * Impostazioni locali, senza alcun dato sensibile: solo preferenze di lettura e
 * velocità. Restano nel localStorage del dispositivo e non vengono mai trasmesse.
 */

import { DEFAULT_BLOCK_SIZE, DEFAULT_FPS, DENSITY_PRESETS, SPEED_PRESETS } from "../config";

export type ThemeChoice = "auto" | "light" | "dark";

export interface AppSettings {
  theme: ThemeChoice;
  /** Byte di payload per frame QR. */
  blockSize: number;
  /** Frame al secondo del flusso animato. */
  fps: number;
  /** Evita lo spegnimento dello schermo durante l'invio, se il browser lo consente. */
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "auto",
  blockSize: DEFAULT_BLOCK_SIZE,
  fps: DEFAULT_FPS,
  keepAwake: true,
};

const STORAGE_KEY = "lensdrop.settings.v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTheme(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" || value === "auto" ? value : DEFAULT_SETTINGS.theme;
}

function readBlockSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.blockSize;
  const known = DENSITY_PRESETS.find((preset) => preset.blockSize === value);
  return known ? known.blockSize : DEFAULT_SETTINGS.blockSize;
}

function readFps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.fps;
  const known = SPEED_PRESETS.find((preset) => preset.fps === value);
  return known ? known.fps : DEFAULT_SETTINGS.fps;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_SETTINGS };
    return {
      theme: readTheme(parsed["theme"]),
      blockSize: readBlockSize(parsed["blockSize"]),
      fps: readFps(parsed["fps"]),
      keepAwake: typeof parsed["keepAwake"] === "boolean" ? parsed["keepAwake"] : DEFAULT_SETTINGS.keepAwake,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Archiviazione piena o disabilitata: le preferenze restano solo in memoria.
  }
}

/** Aggiorna una preferenza e la persiste, restituendo il nuovo stato. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}
