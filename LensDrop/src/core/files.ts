/** Utility su file, formati e API di download/condivisione. */

export type ContentKind = "image" | "video" | "audio" | "pdf" | "archive" | "text" | "file";

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "svg", "bmp", "tif", "tiff"];
const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "ogv"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "aiff", "weba"];
const ARCHIVE_EXT = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst"];
const TEXT_EXT = ["txt", "md", "csv", "json", "xml", "html", "css", "js", "ts", "log", "yml", "yaml", "ini"];

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(mime: string, name: string): ContentKind {
  const type = (mime || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar")) return "archive";

  const ext = fileExtension(name);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ARCHIVE_EXT.includes(ext)) return "archive";
  if (type.startsWith("text/")) return "text";
  if (TEXT_EXT.includes(ext)) return "text";
  return "file";
}

const octet = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatter = value >= 100 ? octet : precise;
  return `${formatter.format(value)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function formatPercent(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `${Math.round(clamped)}%`;
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "adesso";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min fa`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h fa`;
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(new Date(timestamp));
}

/** Crea un file di testo pronto per la condivisione. */
export function createTextFile(text: string, fileName?: string): File {
  const stamp = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const name =
    fileName ??
    `testo-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.txt`;
  return new File([text], name, { type: "text/plain;charset=utf-8" });
}

/** Legge fino a `maxChars` caratteri da un blob testuale, per l'anteprima. */
export async function readTextPreview(blob: Blob, maxChars = 20_000): Promise<string> {
  const slice = blob.slice(0, Math.min(blob.size, maxChars * 4));
  const text = await slice.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

/**
 * Legge un Blob/File in memoria.
 * `arrayBuffer()` non esiste in tutti gli ambienti (per esempio nei DOM
 * simulati dei test): si ricade su FileReader senza cambiare il comportamento.
 */
export async function readBlobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error("Lettura del file non riuscita."));
    };
    reader.onerror = () => reject(new Error("Lettura del file non riuscita."));
    reader.readAsArrayBuffer(blob);
  });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoca differita: Safari deve poter avviare il download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Condivisione nativa (iOS/Android). Restituisce false se non è possibile. */
export async function shareFiles(files: File[], title: string): Promise<boolean> {
  if (!canShareFiles()) return false;
  try {
    if (typeof navigator.canShare === "function" && !navigator.canShare({ files })) return false;
    await navigator.share({ files, title });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return true;
    return false;
  }
}

export function isSecureContextAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function supportsWebRtc(): boolean {
  return typeof RTCPeerConnection !== "undefined" && typeof navigator.mediaDevices !== "undefined";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback sotto.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: unknown) => void) => void };
}

const MAX_DROPPED_FILES = 500;
const MAX_DROP_DEPTH = 6;

async function readDirectory(entry: FileSystemEntryLike, depth: number, out: File[]): Promise<void> {
  if (depth > MAX_DROP_DEPTH || out.length >= MAX_DROPPED_FILES) return;
  const reader = entry.createReader?.();
  if (!reader) return;
  // readEntries restituisce al massimo 100 elementi per chiamata: si itera fino a fine.
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    for (const child of batch) {
      if (out.length >= MAX_DROPPED_FILES) return;
      if (child.isFile) {
        const file = await new Promise<File | null>((resolve) => {
          child.file?.(
            (value) => resolve(value),
            () => resolve(null),
          );
        });
        if (file) out.push(file);
      } else if (child.isDirectory) {
        await readDirectory(child, depth + 1, out);
      }
    }
  }
}

/**
 * Estrae i file da un drop, incluse le cartelle quando il browser espone
 * `webkitGetAsEntry`. Senza questa API restituisce solo i file piatti.
 */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries: FileSystemEntryLike[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const withEntry = item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    };
    const entry = withEntry.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) return Array.from(dataTransfer.files ?? []);

  const files: File[] = [];
  for (const entry of entries) {
    if (files.length >= MAX_DROPPED_FILES) break;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        entry.file?.(
          (value) => resolve(value),
          () => resolve(null),
        );
      });
      if (file) files.push(file);
    } else if (entry.isDirectory) {
      await readDirectory(entry, 0, files);
    }
  }
  return files;
}
