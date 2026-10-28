/**
 * Cadenza del flusso con orologio virtuale: nessuna attesa reale, quindi il test
 * non dipende dalla velocità della macchina. Verifica ciò che a occhio non si
 * vede: che a 30 fps i frame escano ogni 33 ms, che il costo di codifica non si
 * sommi alla cadenza, e che un dispositivo lento degradi senza raffiche.
 */

import { describe, expect, it } from "vitest";

import { FrameStream } from "../src/core/frame-stream";

interface Timer {
  id: number;
  at: number;
  callback: () => void;
}

interface RenderJob {
  at: number;
  value: string;
  resolve: (value: string) => void;
}

/**
 * Orologio manuale: timer e "codifica dei frame" consumano tempo virtuale.
 * La codifica è asincrona come nella realtà: il frame è pronto solo dopo
 * `costMs`, e il produttore resta in attesa fino a quel momento.
 */
function createClock() {
  let now = 0;
  let sequence = 0;
  let timers: Timer[] = [];
  const jobs: RenderJob[] = [];

  const flush = async () => {
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
  };

  const clock = {
    now: () => now,
    setTimer: (callback: () => void, delay: number) => {
      sequence += 1;
      timers.push({ id: sequence, at: now + Math.max(0, delay), callback });
      return sequence;
    },
    clearTimer: (handle: number) => {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    /** Mette in coda una codifica che terminerà fra `costMs` di tempo virtuale. */
    render: (value: string, costMs: number) =>
      new Promise<string>((resolve) => {
        jobs.push({ at: now + Math.max(0, costMs), value, resolve });
      }),
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        jobs.sort((a, b) => a.at - b.at);
        const nextTimer = timers[0];
        const nextJob = jobs[0];

        const timerAt = nextTimer ? nextTimer.at : Number.POSITIVE_INFINITY;
        const jobAt = nextJob ? nextJob.at : Number.POSITIVE_INFINITY;
        const nextAt = Math.min(timerAt, jobAt);
        if (nextAt > target) break;

        now = Math.max(now, nextAt);
        if (jobAt <= timerAt) {
          jobs.shift();
          (nextJob as RenderJob).resolve((nextJob as RenderJob).value);
        } else {
          timers.shift();
          (nextTimer as Timer).callback();
        }
        await flush();
      }
      now = target;
      await flush();
    },
  };

  return clock;
}

function setup(options: { fps: number; renderCostMs: number; bufferTarget?: number }) {
  const clock = createClock();
  const presented: number[] = [];
  const errors: unknown[] = [];
  let text = 0;
  let cost = options.renderCostMs;

  const stream = new FrameStream<string>({
    nextText: () => String(text++),
    render: (value) => clock.render(value, cost),
    present: () => presented.push(clock.now()),
    fps: options.fps,
    ...(options.bufferTarget === undefined ? {} : { bufferTarget: options.bufferTarget }),
    onError: (error) => errors.push(error),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  return {
    clock,
    stream,
    presented,
    errors,
    setRenderCost: (ms: number) => {
      cost = ms;
    },
    costMs: () => cost,
  };
}

/**
 * `prime()` attende la codifica, che nell'orologio virtuale avanza solo dentro
 * `advance()`: qui si avvia la preparazione e si lascia scorrere il tempo.
 */
async function prime(test: ReturnType<typeof setup>, count = 1): Promise<void> {
  const pending = test.stream.prime(count);
  await test.clock.advance(count * (test.costMs() + 2) + 2);
  await pending;
}

function gapsOf(stamps: number[]): number[] {
  return stamps.slice(1).map((stamp, index) => stamp - (stamps[index] as number));
}

describe("FrameStream", () => {
  it("rispetta la cadenza di 30 fps senza deriva", async () => {
    const test = setup({ fps: 30, renderCostMs: 4 });
    await prime(test, 1);
    test.stream.play();
    await test.clock.advance(1000);

    const stats = test.stream.stats;
    expect(stats.presented).toBeGreaterThanOrEqual(28);
    expect(stats.presented).toBeLessThanOrEqual(31);
    expect(stats.underruns).toBe(0);

    // Ogni intervallo è 33 ms: il costo di rendering non si somma alla cadenza.
    expect(new Set(gapsOf(test.presented))).toEqual(new Set([33]));
  });

  it("tiene il passo con un costo di rendering vicino al budget", async () => {
    const test = setup({ fps: 30, renderCostMs: 25, bufferTarget: 8 });
    await prime(test, 3);
    test.stream.play();
    await test.clock.advance(1000);

    expect(test.stream.stats.presented).toBeGreaterThanOrEqual(27);
    expect(test.stream.stats.underruns).toBe(0);
  });

  it("degrada senza raffiche se la codifica supera l'intervallo", async () => {
    const test = setup({ fps: 30, renderCostMs: 60, bufferTarget: 2 });
    test.stream.play();
    await test.clock.advance(2000);

    const stats = test.stream.stats;
    // Il device prepara un frame ogni 60 ms: ~33 frame in 2 s, non 60.
    expect(stats.presented).toBeGreaterThan(25);
    expect(stats.presented).toBeLessThan(40);
    expect(stats.underruns).toBeGreaterThan(0);

    // Nessun frame "recuperato" in blocco: nessun intervallo quasi nullo.
    expect(Math.min(...gapsOf(test.presented))).toBeGreaterThanOrEqual(30);
  });

  it("a 4 fps un rendering lento non provoca attese", async () => {
    const test = setup({ fps: 4, renderCostMs: 120 });
    await prime(test, 1);
    test.stream.play();
    await test.clock.advance(2000);

    expect(test.stream.stats.presented).toBeGreaterThanOrEqual(7);
    expect(test.stream.stats.underruns).toBe(0);
  });

  it("resta stabile quando il costo di rendering scende", async () => {
    const test = setup({ fps: 30, renderCostMs: 20 });
    await prime(test, 1);
    test.stream.play();
    await test.clock.advance(1000);
    const first = test.stream.stats;

    test.setRenderCost(3);
    await test.clock.advance(1000);
    const second = test.stream.stats;

    expect(second.presented - first.presented).toBeGreaterThanOrEqual(28);
    expect(second.underruns).toBe(0);
  });

  it("limita il buffer e si ferma con pause()", async () => {
    const test = setup({ fps: 8, renderCostMs: 2, bufferTarget: 3 });
    await prime(test, 1);
    test.stream.play();
    await test.clock.advance(200);

    expect(test.stream.buffered).toBeLessThanOrEqual(3);

    const before = test.stream.stats.presented;
    test.stream.pause();
    await test.clock.advance(500);
    expect(test.stream.stats.presented).toBe(before);
    expect(test.stream.isPlaying).toBe(false);

    test.stream.stop();
    expect(test.stream.buffered).toBe(0);
    expect(test.stream.stats.presented).toBe(before);
  });

  it("propaga gli errori di rendering e riprende al tentativo successivo", async () => {
    const clock = createClock();
    const errors: unknown[] = [];
    let attempts = 0;

    const stream = new FrameStream<string>({
      nextText: () => "x",
      render: async (value) => {
        attempts += 1;
        if (attempts === 1) throw new Error("codifica fallita");
        return value;
      },
      present: () => undefined,
      fps: 8,
      onError: (error) => errors.push(error),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    await expect(stream.prime(1)).rejects.toThrow(/codifica fallita/);
    await stream.prime(1);
    expect(stream.buffered).toBe(1);
    expect(errors.length).toBe(0);
  });

  it("applica subito una nuova velocità senza raffiche", async () => {
    const test = setup({ fps: 8, renderCostMs: 2 });
    await prime(test, 1);
    test.stream.play();
    await test.clock.advance(500);
    const before = test.stream.stats.presented;

    test.stream.setFps(30);
    expect(test.stream.intervalMs).toBe(33);
    const startAt = test.clock.now();
    await test.clock.advance(1000);

    // Nessun recupero arretrato: i frame mostrati sono quelli del nuovo ritmo.
    const shown = test.stream.stats.presented - before;
    expect(shown).toBeGreaterThanOrEqual(29);
    expect(shown).toBeLessThanOrEqual(32);
    expect(test.presented.slice(-shown).every((stamp) => stamp >= startAt)).toBe(true);
    expect(test.stream.stats.underruns).toBe(0);
  });

  it("rifiuta un frame rate non valido", () => {
    expect(
      () =>
        new FrameStream<string>({
          nextText: () => "x",
          render: async (value) => value,
          present: () => undefined,
          fps: 0,
        }),
    ).toThrow(/Frame rate/);
  });
});
