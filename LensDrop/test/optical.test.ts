import { describe, expect, it } from "vitest";

import type { BundleItem } from "../src/core/bundle";
import { encodeFrame, type SessionMeta } from "../src/core/frame";
import { OpticalReceiver, OpticalSender } from "../src/core/optical";

function pseudoRandom(size: number, seed = 987654321): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let state = seed >>> 0;
  for (let index = 0; index < size; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[index] = state >>> 24;
  }
  return out;
}

function textItem(text: string, name = "nota.txt"): BundleItem {
  return { name, mime: "text/plain", data: new TextEncoder().encode(text) as Uint8Array<ArrayBuffer> };
}

/** Simula la fotocamera: scarta e duplica frame in modo pseudocasuale. */
function simulateCamera(sender: OpticalSender, receiver: OpticalReceiver, dropRate: number, maxFrames: number) {
  let state = 12345;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) / 0xffffff;
  };
  let frames = 0;
  while (!receiver.complete && frames < maxFrames) {
    const text = sender.nextText();
    frames += 1;
    if (next() < dropRate) continue;
    receiver.accept(text);
    if (next() < 0.05) receiver.accept(text);
  }
  return frames;
}

describe("trasmissione ottica", () => {
  it("trasferisce un file binario perdendo il 35% dei frame", async () => {
    const data = pseudoRandom(60_000);
    const sender = await OpticalSender.create([{ name: "foto.jpg", mime: "image/jpeg", data }], { blockSize: 600 });
    expect(sender.meta.compressed).toBe(false);
    expect(sender.meta.k).toBeGreaterThan(90);

    const receiver = new OpticalReceiver();
    const frames = simulateCamera(sender, receiver, 0.35, 6000);

    expect(receiver.complete).toBe(true);
    expect(frames).toBeLessThan(sender.meta.k * 5);

    const items = await receiver.finish();
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("foto.jpg");
    expect(items[0]?.mime).toBe("image/jpeg");
    expect(items[0]?.data.byteLength).toBe(data.byteLength);
    expect(Array.from(items[0]?.data ?? [])).toEqual(Array.from(data));
  });

  it("comprime il testo e trasferisce più elementi insieme", async () => {
    const body = "LensDrop trasferisce i dati con la luce. ".repeat(400);
    const sender = await OpticalSender.create([textItem(body), textItem("seconda nota", "b.txt")], {
      blockSize: 500,
    });
    expect(sender.meta.compressed).toBe(true);
    expect(sender.meta.size).toBeLessThan(body.length);

    const receiver = new OpticalReceiver();
    simulateCamera(sender, receiver, 0.2, 4000);
    expect(receiver.complete).toBe(true);

    const items = await receiver.finish();
    expect(items.map((item) => item.name)).toEqual(["nota.txt", "b.txt"]);
    expect(new TextDecoder().decode(items[0]?.data)).toBe(body);
  });

  it("funziona anche con un solo blocco", async () => {
    const sender = await OpticalSender.create([textItem("ciao")], { blockSize: 900 });
    expect(sender.meta.k).toBe(1);
    const receiver = new OpticalReceiver();
    simulateCamera(sender, receiver, 0, 50);
    expect(receiver.complete).toBe(true);
    const items = await receiver.finish();
    expect(new TextDecoder().decode(items[0]?.data)).toBe("ciao");
  });

  it("ignora QR estranei e frame di altre sessioni", async () => {
    const sender = await OpticalSender.create([textItem("dati")], { blockSize: 300 });
    const receiver = new OpticalReceiver();

    expect(receiver.accept("https://example.com").type).toBe("foreign");
    const text = sender.nextText();
    expect(receiver.accept(text).type).toBe("meta");

    const stranger = await OpticalSender.create([textItem("altro")], { blockSize: 300 });
    if (stranger.meta.sessionId !== sender.meta.sessionId) {
      expect(receiver.accept(stranger.nextText()).type).toBe("foreign");
    }

    // Un frame di dati con sessione diversa viene scartato anche senza metadati.
    expect(receiver.accept(encodeFrame({ kind: "block", sessionId: 1234, index: 0, data: new Uint8Array(8) })).type).toBe(
      "foreign",
    );
  });

  it("rifiuta un payload manomesso invece di consegnarlo", async () => {
    const data = pseudoRandom(500);
    const meta: SessionMeta = {
      version: 1,
      sessionId: 99,
      name: "taroccato.bin",
      itemCount: 1,
      size: 200,
      blockSize: 256,
      k: 1,
      hash: "b".repeat(64),
      compressed: false,
    };
    const receiver = new OpticalReceiver();
    receiver.accept(encodeFrame({ kind: "meta", meta }));
    receiver.accept(encodeFrame({ kind: "block", sessionId: 99, index: 0, data }));
    expect(receiver.complete).toBe(true);
    await expect(receiver.finish()).rejects.toThrow(/checksum/i);
  });

  it("stima throughput e durata in modo coerente", async () => {
    const sender = await OpticalSender.create([textItem("x".repeat(2000))], { blockSize: 800 });
    const throughput = sender.estimateBytesPerSecond(10);
    expect(throughput).toBeGreaterThan(1000);
    expect(sender.estimateDurationMs(10)).toBeGreaterThan(0);
    expect(sender.estimateBytesPerSecond(20)).toBeGreaterThan(throughput);
  });

  it("genera frame di metadati ripetuti all'inizio", async () => {
    const sender = await OpticalSender.create([textItem("ciao")], { blockSize: 200 });
    const receiver = new OpticalReceiver();
    const kinds = [sender.nextFrame(), sender.nextFrame(), sender.nextFrame(), sender.nextFrame()];
    expect(kinds.every((frame) => frame.kind === "meta")).toBe(true);
    const first = kinds[0];
    expect(first?.kind).toBe("meta");
    if (first) expect(receiver.accept(encodeFrame(first)).type).toBe("meta");
  });
});
