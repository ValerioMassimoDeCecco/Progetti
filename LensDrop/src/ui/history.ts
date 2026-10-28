/**
 * Cronologia locale: solo metadati (nomi, dimensioni, esito).
 * I contenuti non vengono mai salvati, nemmeno temporaneamente, in localStorage.
 */

export type TransferDirection = "in" | "out";
export type TransferOutcome = "ok" | "cancelled" | "error";

export interface HistoryFile {
  name: string;
  size: number;
}

export interface HistoryEntry {
  id: string;
  direction: TransferDirection;
  outcome: TransferOutcome;
  at: number;
  totalBytes: number;
  files: HistoryFile[];
}

const STORAGE_KEY = "lensdrop.history.v1";
const MAX_ENTRIES = 25;
const MAX_FILES_PER_ENTRY = 12;
const MAX_NAME_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeFile(value: unknown): HistoryFile | null {
  if (!isRecord(value)) return null;
  const name = value["name"];
  const size = value["size"];
  if (typeof name !== "string" || typeof size !== "number" || !Number.isFinite(size)) return null;
  return {
    name: name.slice(0, MAX_NAME_LENGTH),
    size: Math.max(0, Math.min(size, 10 * 1024 * 1024 * 1024)),
  };
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: HistoryEntry[] = [];
    for (const candidate of parsed) {
      if (!isRecord(candidate)) continue;
      const direction = candidate["direction"] === "in" ? "in" : "out";
      const outcome =
        candidate["outcome"] === "ok" ? "ok" : candidate["outcome"] === "cancelled" ? "cancelled" : "error";
      const at = candidate["at"];
      const id = candidate["id"];
      const totalBytes = candidate["totalBytes"];
      const rawFiles = candidate["files"];
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      if (typeof id !== "string" || id.length === 0 || id.length > 64) continue;
      if (typeof totalBytes !== "number" || !Number.isFinite(totalBytes)) continue;
      const files: HistoryFile[] = [];
      if (Array.isArray(rawFiles)) {
        for (const file of rawFiles) {
          const sanitized = sanitizeFile(file);
          if (sanitized) files.push(sanitized);
          if (files.length >= MAX_FILES_PER_ENTRY) break;
        }
      }
      entries.push({
        id,
        direction,
        outcome,
        at,
        totalBytes: Math.max(0, totalBytes),
        files,
      });
      if (entries.length >= MAX_ENTRIES) break;
    }
    return entries;
  } catch {
    return [];
  }
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "at">): void {
  try {
    const entries = loadHistory();
    const record: HistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      at: Date.now(),
      files: entry.files.slice(0, MAX_FILES_PER_ENTRY).map((file) => ({
        name: file.name.slice(0, MAX_NAME_LENGTH),
        size: Math.max(0, file.size),
      })),
    };
    const next = [record, ...entries].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage pieno o non disponibile: la cronologia è un extra, non blocca nulla.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nessuna azione necessaria.
  }
}
