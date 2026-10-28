import { describe, expect, it } from "vitest";

import { FountainDecoder, makeRng, symbolIndices } from "../src/core/fountain";

function payload(size: number): Uint8Array {
  const out = new Uint8Array(size);
  let state = 1234567;
  for (let index = 0; index < size; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    out[index] = state >>> 24;
  }
  return out;
}

function blocksOf(data: Uint8Array, blockSize: number): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += blockSize) {
    blocks.push(data.slice(offset, Math.min(data.length, offset + blockSize)));
  }
  return blocks;
}

function repairSymbol(blocks: Uint8Array[], blockSize: number, seed: number): Uint8Array {
  const out = new Uint8Array(blockSize);
  for (const index of symbolIndices(seed, blocks.length)) {
    const block = blocks[index] as Uint8Array;
    for (let position = 0; position < blockSize; position += 1) {
      out[position] = (out[position] ?? 0) ^ (block[position] ?? 0);
    }
  }
  return out;
}

describe("fountain", () => {
  it("genera lo stesso insieme di indici per lo stesso seed", () => {
    expect(symbolIndices(42, 100)).toEqual(symbolIndices(42, 100));
    expect(symbolIndices(42, 100)).not.toEqual(symbolIndices(43, 100));
  });

  it("produce indici sempre validi e senza duplicati", () => {
    for (let seed = 1; seed < 400; seed += 1) {
      const indices = symbolIndices(seed * 7919, 250);
      expect(indices.length).toBeGreaterThan(0);
      expect(new Set(indices).size).toBe(indices.length);
      for (const index of indices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(250);
      }
    }
  });

  it("ricostruisce con i soli blocchi di sistema", () => {
    const data = payload(1000);
    const blocks = blocksOf(data, 100);
    const decoder = new FountainDecoder(blocks.length, 100);
    blocks.forEach((block, index) => decoder.addSystematic(index, block));
    expect(decoder.complete).toBe(true);
    expect(Array.from(decoder.assemble(data.length) ?? [])).toEqual(Array.from(data));
  });

  it("ricostruisce perdendo metà dei blocchi, grazie ai simboli di riparazione", () => {
    const data = payload(6000);
    const blockSize = 120;
    const blocks = blocksOf(data, blockSize);
    const decoder = new FountainDecoder(blocks.length, blockSize);

    // Simula la fotocamera: metà dei frame di sistema vengono scartati.
    blocks.forEach((block, index) => {
      if (index % 2 === 0) decoder.addSystematic(index, block);
    });

    let seed = 1;
    let guard = 0;
    while (!decoder.complete && guard < 5000) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      decoder.addRepair(seed, repairSymbol(blocks, blockSize, seed));
      guard += 1;
    }

    expect(decoder.complete).toBe(true);
    expect(guard).toBeLessThan(blocks.length * 3);
    expect(Array.from(decoder.assemble(data.length) ?? [])).toEqual(Array.from(data));
  });

  it("si sblocca con l'eliminazione di Gauss quando il peeling si ferma", () => {
    const data = payload(6 * 40);
    const blockSize = 40;
    const blocks = blocksOf(data, blockSize);
    const decoder = new FountainDecoder(blocks.length, blockSize);

    // Arrivano solo tre blocchi di sistema: gli altri tre compaiono unicamente
    // dentro combinazioni di grado 2, che il peeling da solo non può risolvere.
    decoder.addSystematic(3, blocks[3] as Uint8Array);
    decoder.addSystematic(4, blocks[4] as Uint8Array);
    decoder.addSystematic(5, blocks[5] as Uint8Array);

    const combine = (indices: number[]) => {
      const out = new Uint8Array(blockSize);
      for (const index of indices) {
        const block = blocks[index] as Uint8Array;
        for (let position = 0; position < blockSize; position += 1) {
          out[position] = (out[position] ?? 0) ^ (block[position] ?? 0);
        }
      }
      return out;
    };

    // Tre equazioni indipendenti: [0,1], [1,2] e [0,1,2] hanno rango 3.
    decoder.addEquation([0, 1], combine([0, 1]));
    decoder.addEquation([1, 2], combine([1, 2]));
    decoder.addEquation([0, 1, 2], combine([0, 1, 2]));
    expect(decoder.complete).toBe(false);
    expect(decoder.stats.solved).toBe(3);

    expect(decoder.gaussianElimination()).toBe(3);
    expect(decoder.complete).toBe(true);
    expect(Array.from(decoder.assemble(data.length) ?? [])).toEqual(Array.from(data));
  });

  it("ignora i duplicati senza alterare il risultato", () => {
    const data = payload(300);
    const blocks = blocksOf(data, 100);
    const decoder = new FountainDecoder(3, 100);
    decoder.addSystematic(0, blocks[0] as Uint8Array);
    decoder.addSystematic(0, blocks[0] as Uint8Array);
    decoder.addSystematic(1, blocks[1] as Uint8Array);
    decoder.addSystematic(2, blocks[2] as Uint8Array);
    expect(decoder.stats.solved).toBe(3);
    expect(decoder.stats.redundant).toBeGreaterThan(0);
  });

  it("genera numeri pseudo-casuali riproducibili", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
  });
});
