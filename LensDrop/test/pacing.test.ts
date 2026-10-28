import { describe, expect, it } from "vitest";

import { SPEED_PRESETS, HARDWARE_DECODE_FPS_THRESHOLD } from "../src/config";
import { effectiveFps, frameIntervalMs, planNextTick, MIN_FRAME_INTERVAL_MS } from "../src/core/pacing";

describe("temporizzazione del flusso ottico", () => {
  it("calcola il passo reale per ogni preset", () => {
    expect(frameIntervalMs(4)).toBe(250);
    expect(frameIntervalMs(8)).toBe(125);
    expect(frameIntervalMs(14)).toBe(71);
    expect(frameIntervalMs(30)).toBe(33);
  });

  it("non taglia i 30 fps con un pavimento arbitrario", () => {
    // Regressione: con un minimo di 40 ms l'opzione "30 fps" girava a 25 fps.
    expect(frameIntervalMs(30)).toBeLessThan(40);
    expect(frameIntervalMs(30)).toBeLessThanOrEqual(34);
  });

  it("resta prudente su valori limite", () => {
    expect(frameIntervalMs(0)).toBe(125);
    expect(frameIntervalMs(-5)).toBe(125);
    expect(frameIntervalMs(Number.NaN)).toBe(125);
    expect(frameIntervalMs(1000)).toBe(MIN_FRAME_INTERVAL_MS);
  });

  it("mantiene la cadenza senza accumulare ritardo", () => {
    // Frame dovuto a 1000 ms, siamo a 1005: il prossimo resta a 1033.
    const regular = planNextTick(1000, 1005, 33);
    expect(regular.dueAt).toBe(1033);
    expect(regular.delay).toBe(28);

    // Il tempo di disegno non si somma: 33 ms di cadenza restano 33 ms.
    let dueAt = 0;
    let now = 0;
    const stamps: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const plan = planNextTick(dueAt, now, 33);
      dueAt = plan.dueAt;
      stamps.push(dueAt);
      now = dueAt + 6; // 6 ms spesi per disegnare
    }
    const span = (stamps.at(-1) ?? 0) - (stamps[0] ?? 0);
    expect(span).toBe(29 * 33);
  });

  it("si riallinea invece di recuperare a raffica dopo una pausa", () => {
    const afterStall = planNextTick(1000, 1500, 33);
    expect(afterStall.dueAt).toBe(1533);
    expect(afterStall.delay).toBe(33);
    expect(afterStall.delay).toBeLessThanOrEqual(33);
  });

  it("stima il frame rate sostenibile dal costo di rendering", () => {
    expect(effectiveFps(30, 5)).toBeCloseTo(30.3, 0);
    expect(effectiveFps(30, 50)).toBeCloseTo(20, 0);
    expect(effectiveFps(8, 0)).toBe(8);
  });

  it("espone il preset 30 fps senza renderlo predefinito", () => {
    const preset = SPEED_PRESETS.find((item) => item.fps === 30);
    expect(preset?.hint).toMatch(/hardware/i);
    expect(SPEED_PRESETS.map((item) => item.fps)).toEqual([4, 8, 14, 30]);
    expect(HARDWARE_DECODE_FPS_THRESHOLD).toBeGreaterThan(14);
    expect(HARDWARE_DECODE_FPS_THRESHOLD).toBeLessThan(30);
  });
});
