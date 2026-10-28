import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  resolveIceServers,
  resolveSignaling,
  saveSettings,
  type AppSettings,
} from "../src/core/settings";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
});

function withSettings(overrides: Partial<AppSettings>): AppSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

describe("impostazioni", () => {
  it("restituisce i valori predefiniti in assenza di dati", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("salva e ricarica le preferenze valide", () => {
    const settings = withSettings({ theme: "dark" });
    settings.turn = { enabled: true, urls: "turn:turn.example.com:3478", username: "u", credential: "p" };
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.theme).toBe("dark");
    expect(loaded.turn.urls).toBe("turn:turn.example.com:3478");
  });

  it("ignora dati corrotti o parziali", () => {
    localStorage.setItem("lensdrop.settings.v1", "{non-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    localStorage.setItem(
      "lensdrop.settings.v1",
      JSON.stringify({ theme: "viola", signaling: { mode: "custom", port: -5 }, turn: [] }),
    );
    const loaded = loadSettings();
    expect(loaded.theme).toBe("auto");
    expect(loaded.signaling.mode).toBe("custom");
    expect(loaded.signaling.port).toBe(DEFAULT_SETTINGS.signaling.port);
    expect(loaded.turn.enabled).toBe(false);
  });

  it("usa il server pubblico quando la modalità è cloud", () => {
    const signaling = resolveSignaling(withSettings({}));
    expect(signaling.mode).toBe("cloud");
    expect(signaling.host).toBe("0.peerjs.com");
    expect(signaling.secure).toBe(true);
  });

  it("mantiene il server personalizzato quando configurato", () => {
    const settings = withSettings({});
    settings.signaling = {
      mode: "custom",
      host: "peer.example.org",
      port: 443,
      path: "/peerjs",
      key: "chiave",
      secure: true,
    };
    const signaling = resolveSignaling(settings);
    expect(signaling.host).toBe("peer.example.org");
    expect(signaling.path).toBe("/peerjs");
  });

  it("accetta solo URL TURN validi e ignora il resto", () => {
    const settings = withSettings({});
    settings.turn = {
      enabled: true,
      urls: "turn:turn.example.com:3478 turns:turn.example.com:5349 javascript:alert(1) http://x",
      username: "utente",
      credential: "segreto",
    };
    const servers = resolveIceServers(settings);
    const custom = servers.at(-1);
    expect(Array.isArray(custom?.urls)).toBe(true);
    expect(custom?.urls).toEqual([
      "turn:turn.example.com:3478",
      "turns:turn.example.com:5349",
    ]);
    expect(custom?.username).toBe("utente");
  });

  it("non aggiunge TURN personalizzati se l'opzione è spenta", () => {
    const settings = withSettings({});
    settings.turn = { enabled: false, urls: "turn:turn.example.com:3478", username: "", credential: "" };
    const servers = resolveIceServers(settings);
    expect(servers.some((server) => String(server.urls).includes("turn.example.com"))).toBe(false);
    expect(servers.length).toBeGreaterThan(0);
  });
});
