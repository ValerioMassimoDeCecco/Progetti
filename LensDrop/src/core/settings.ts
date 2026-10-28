/**
 * Impostazioni locali (localStorage). Nessun dato lascia il dispositivo.
 * Le credenziali TURN eventualmente inserite dall'utente restano in locale e
 * non vengono mai incluse nei log, nei QR o nell'HTML.
 */

import { DEFAULT_ICE_SERVERS, DEFAULT_SIGNALING, type IceServerLike } from "../config";

export type ThemeChoice = "auto" | "light" | "dark";

export interface SignalingSettings {
  mode: "cloud" | "custom";
  host: string;
  port: number;
  path: string;
  key: string;
  secure: boolean;
}

export interface TurnSettings {
  enabled: boolean;
  urls: string;
  username: string;
  credential: string;
}

export interface AppSettings {
  theme: ThemeChoice;
  signaling: SignalingSettings;
  turn: TurnSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "auto",
  signaling: { ...DEFAULT_SIGNALING },
  turn: { enabled: false, urls: "", username: "", credential: "" },
};

const STORAGE_KEY = "lensdrop.settings.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTheme(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" || value === "auto" ? value : DEFAULT_SETTINGS.theme;
}

function readString(value: unknown, fallback: string, maxLength = 200): string {
  return typeof value === "string" && value.length <= maxLength ? value : fallback;
}

function readPort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536
    ? value
    : DEFAULT_SETTINGS.signaling.port;
}

function readSignaling(value: unknown): SignalingSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS.signaling };
  const mode = value["mode"] === "custom" ? "custom" : "cloud";
  const host = readString(value["host"], DEFAULT_SETTINGS.signaling.host);
  return {
    mode,
    host: host.trim() === "" ? DEFAULT_SETTINGS.signaling.host : host,
    port: readPort(value["port"]),
    path: readString(value["path"], DEFAULT_SETTINGS.signaling.path) || "/",
    key: readString(value["key"], DEFAULT_SETTINGS.signaling.key) || "peerjs",
    secure: value["secure"] !== false,
  };
}

function readTurn(value: unknown): TurnSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS.turn };
  return {
    enabled: value["enabled"] === true,
    urls: readString(value["urls"], "", 500).trim(),
    username: readString(value["username"], "", 200),
    credential: readString(value["credential"], "", 200),
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return structuredClone(DEFAULT_SETTINGS);
    return {
      theme: readTheme(parsed["theme"]),
      signaling: readSignaling(parsed["signaling"]),
      turn: readTurn(parsed["turn"]),
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage non disponibile (modalità privata o quota): le impostazioni valgono per la sessione.
  }
}

/** Elenco ICE effettivo: STUN pubblici + TURN demo + eventuale TURN dell'utente. */
export function resolveIceServers(settings: AppSettings): IceServerLike[] {
  const servers: IceServerLike[] = DEFAULT_ICE_SERVERS.map((server) => ({ ...server }));
  const custom = settings.turn;
  if (custom.enabled && custom.urls.trim() !== "") {
    const urls = custom.urls
      .split(/[\s,]+/)
      .map((url) => url.trim())
      .filter((url) => /^turns?:[a-z0-9.\-[\]:]+$/i.test(url))
      .slice(0, 4);
    if (urls.length > 0) {
      servers.push({
        urls,
        ...(custom.username ? { username: custom.username } : {}),
        ...(custom.credential ? { credential: custom.credential } : {}),
      });
    }
  }
  return servers;
}

export function resolveSignaling(settings: AppSettings): SignalingSettings {
  return settings.signaling.mode === "custom"
    ? { ...settings.signaling }
    : { ...DEFAULT_SIGNALING };
}
