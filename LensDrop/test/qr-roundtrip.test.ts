/**
 * Verifica del canale ottico vero e proprio, senza fotocamera né browser:
 * il frame viene codificato in matrice QR, rasterizzato in un'immagine RGBA
 * (come quella che il sensore consegnerebbe) e riletto con jsQR — lo stesso
 * decoder usato in produzione quando `BarcodeDetector` non c'è.
 *
 * Se questo test passa, l'unico elemento non verificabile qui resta l'ottica
 * reale (messa a fuoco, riflessi, luminosità dello schermo).
 */

import jsQR from "jsqr";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import { encodeFrame, decodeFrame, type SessionMeta } from "../src/core/frame";
import { OpticalReceiver, OpticalSender } from "../src/core/optical";

const META: SessionMeta = {
  version: 1,
  sessionId: 1234,
  name: "prova.bin",
  itemCount: 1,
  size: 4096,
  blockSize: 900,
  k: 5,
  hash: "c".repeat(64),
  compressed: false,
};

/** Rasterizza il QR come farebbe uno schermo: moduli chiari e scuri, quiet zone. */
function rasterize(text: string, scale = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const matrix = QRCode.create(text, { errorCorrectionLevel: "L" });
  const modules = matrix.modules.size;
  const quiet = 2;
  const side = (modules + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);

  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!matrix.modules.get(row, column)) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const px = (column + quiet) * scale + x;
          const py = (row + quiet) * scale + y;
          const offset = (py * side + px) * 4;
          pixels[offset] = 10;
          pixels[offset + 1] = 15;
          pixels[offset + 2] = 28;
          pixels[offset + 3] = 255;
        }
      }
    }
  }

  return { data: pixels, width: side, height: side };
}

function readBack(text: string): string | null {
  const image = rasterize(text);
  return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
}

describe("canale ottico su QR reali", () => {
  it("rilegge i metadati di sessione dall'immagine", () => {
    const text = encodeFrame({ kind: "meta", meta: META });
    const decoded = readBack(text);
    expect(decoded).toBe(text);
    expect(decodeFrame(decoded ?? "")).toEqual({ kind: "meta", meta: META });
  });

  it("rilegge un blocco dati completo", () => {
    const data = new Uint8Array(900);
    for (let index = 0; index < data.length; index += 1) data[index] = (index * 17) & 0xff;
    const text = encodeFrame({ kind: "block", sessionId: 77, index: 3, data });
    const decoded = readBack(text);
    expect(decoded).toBe(text);

    const frame = decodeFrame(decoded ?? "");
    expect(frame?.kind).toBe("block");
    if (frame?.kind === "block") {
      expect(frame.index).toBe(3);
      expect(frame.sessionId).toBe(77);
      expect(Array.from(frame.data)).toEqual(Array.from(data));
    }
  });

  it("trasferisce un file passando davvero per i QR e perdendo frame", async () => {
    const payload = new TextEncoder().encode(
      "LensDrop: questo testo compie l'intero percorso, dallo schermo alla fotocamera simulata.",
    ) as Uint8Array<ArrayBuffer>;
    const sender = await OpticalSender.create([{ name: "prova.txt", mime: "text/plain", data: payload }], {
      blockSize: 300,
    });

    const receiver = new OpticalReceiver();
    let emitted = 0;
    let decoded = 0;

    while (!receiver.complete && emitted < 120) {
      const text = sender.nextText();
      emitted += 1;

      // Un frame su quattro "sfugge" alla fotocamera.
      if (emitted % 4 === 0) continue;

      const read = readBack(text);
      decoded += 1;
      expect(read).toBe(text);
      if (read) receiver.accept(read);
    }

    expect(receiver.complete).toBe(true);
    expect(decoded).toBeGreaterThan(0);

    const items = await receiver.finish();
    expect(items[0]?.name).toBe("prova.txt");
    expect(new TextDecoder().decode(items[0]?.data)).toBe(new TextDecoder().decode(payload));
  }, 20_000);
});
