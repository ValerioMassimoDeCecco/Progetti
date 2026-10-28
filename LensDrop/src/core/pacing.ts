/**
 * Temporizzazione del flusso ottico.
 *
 * A 30 fps il budget per frame è di ~33 ms: il vecchio pavimento a 40 ms
 * rendeva l'opzione solo cosmetica (25 fps reali). Qui il passo è calcolato dal
 * frame rate richiesto e la pianificazione avviene su scadenze fisse, così il
 * tempo di disegno non si somma a ogni frame (deriva).
 */

/** Pavimento tecnico: sotto ~8 ms i timer del browser non sono affidabili. */
export const MIN_FRAME_INTERVAL_MS = 8;

/** Oltre questo valore il flusso non ha senso: nessun display lo mostra. */
export const MAX_FPS = 120;

/** Intervallo fra due frame, in millisecondi, per il frame rate richiesto. */
export function frameIntervalMs(fps: number): number {
  const safe = Number.isFinite(fps) && fps > 0 ? Math.min(fps, MAX_FPS) : 8;
  return Math.max(MIN_FRAME_INTERVAL_MS, Math.round(1000 / safe));
}

export interface TickPlan {
  /** Millisecondi da attendere prima del prossimo frame. */
  delay: number;
  /** Istante (performance.now) in cui il frame è dovuto. */
  dueAt: number;
}

/**
 * Calcola quando mostrare il frame successivo mantenendo la cadenza.
 *
 * - cadenza normale: `dueAt` precedente + intervallo, meno il tempo già speso;
 * - se il flusso è rimasto fermo (scheda in background, dispositivo lento) si
 *   riallinea al presente invece di "recuperare" con una raffica di frame,
 *   che confonderebbe la fotocamera senza guadagnare nulla.
 */
export function planNextTick(dueAt: number, now: number, interval: number): TickPlan {
  const step = Math.max(MIN_FRAME_INTERVAL_MS, Math.round(interval));
  let target = dueAt + step;
  if (target <= now) target = now + step;
  return { delay: Math.max(0, Math.round(target - now)), dueAt: target };
}

/**
 * Frame al secondo realmente ottenibili: se preparare un frame costa più
 * dell'intervallo richiesto, il flusso scende al ritmo che il dispositivo
 * riesce a sostenere (meglio fluido e lento che a scatti).
 */
export function effectiveFps(fps: number, renderCostMs: number): number {
  const interval = frameIntervalMs(fps);
  const cost = Number.isFinite(renderCostMs) ? Math.max(0, renderCostMs) : 0;
  return 1000 / Math.max(interval, cost);
}
