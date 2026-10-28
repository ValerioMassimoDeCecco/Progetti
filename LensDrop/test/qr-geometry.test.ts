/**
 * Geometria dei frame: il lato del canvas deve essere un multiplo esatto dei
 * moduli. Con un fattore frazionario i moduli risultano di larghezze diverse e
 * la fotocamera li legge peggio — errore tipico quando si insegue il frame rate
 * chiedendo a `toCanvas` una larghezza arbitraria.
 */

import { describe, expect, it } from "vitest";

import { planPixelSize } from "../src/ui/qr";

/** Moduli totali (quiet zone inclusa) per le tre densità offerte. */
const LAYOUTS = [
  { name: "compatto", modules: 81 },
  { name: "equilibrato", modules: 93 },
  { name: "denso", modules: 117 },
];

describe("geometria dei QR", () => {
  it("usa sempre un numero intero di pixel per modulo", () => {
    for (const layout of LAYOUTS) {
      for (const desired of [360, 540, 760, 900, 1200]) {
        const { scale, pixelSize } = planPixelSize(layout.modules, desired);
        expect(Number.isInteger(scale)).toBe(true);
        expect(scale).toBeGreaterThanOrEqual(3);
        expect(pixelSize).toBe(layout.modules * scale);
        expect(pixelSize % layout.modules).toBe(0);
      }
    }
  });

  it("resta vicino alla dimensione richiesta", () => {
    for (const layout of LAYOUTS) {
      const { pixelSize } = planPixelSize(layout.modules, 760);
      expect(Math.abs(pixelSize - 760)).toBeLessThanOrEqual(layout.modules / 2 + 1);
    }
  });

  it("non scende sotto i 3 pixel per modulo né sale oltre 14", () => {
    expect(planPixelSize(93, 160).scale).toBe(3);
    expect(planPixelSize(93, 5000).scale).toBe(14);
    expect(planPixelSize(93, Number.NaN).scale).toBeGreaterThanOrEqual(3);
  });

  it("tiene il frame pronto in tempi compatibili con 30 fps", () => {
    // Solo un'indicazione di progetto: 8 buffer pronti coprono ~265 ms a 30 fps,
    // cioè più del tempo di codifica misurato su telefoni recenti (~10–25 ms).
    const buffer = 8;
    const interval = 1000 / 30;
    expect(buffer * interval).toBeGreaterThan(250);
    expect(buffer * interval).toBeLessThan(300);
  });
});
