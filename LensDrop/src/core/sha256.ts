/**
 * SHA-256 incrementale in TypeScript puro.
 *
 * Web Crypto espone solo il digest di un buffer completo: non consente di
 * calcolare l'hash mentre i blocchi vengono ricevuti, obbligando a tenere in
 * memoria l'intero file. Questa implementazione permette di verificare
 * l'integrità in streaming, anche per file molto grandi.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const BLOCK_SIZE = 64;

export class Sha256 {
  private readonly h = new Uint32Array(IV);
  private readonly buffer = new Uint8Array(BLOCK_SIZE);
  private readonly words = new Uint32Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error("Sha256: digest già calcolato.");
    this.bytesHashed += data.length;

    let offset = 0;

    if (this.bufferLength > 0) {
      const needed = BLOCK_SIZE - this.bufferLength;
      const take = Math.min(needed, data.length);
      this.buffer.set(data.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset += take;
      if (this.bufferLength === BLOCK_SIZE) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }

    while (offset + BLOCK_SIZE <= data.length) {
      this.processBlock(data, offset);
      offset += BLOCK_SIZE;
    }

    if (offset < data.length) {
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLength = data.length - offset;
    }

    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error("Sha256: digest già calcolato.");
    this.finished = true;

    const bitLengthHi = Math.floor(this.bytesHashed / 0x20000000);
    const bitLengthLo = (this.bytesHashed * 8) >>> 0;

    const padding = new Uint8Array(BLOCK_SIZE);
    padding[0] = 0x80;
    const padLength = this.bufferLength < 56 ? 56 - this.bufferLength : 120 - this.bufferLength;

    this.updateInternal(padding.subarray(0, padLength));

    const lengthBytes = new Uint8Array(8);
    const view = new DataView(lengthBytes.buffer);
    view.setUint32(0, bitLengthHi);
    view.setUint32(4, bitLengthLo);
    this.updateInternal(lengthBytes);

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, this.h[i]!);
    return out;
  }

  digestHex(): string {
    let hex = "";
    for (const byte of this.digest()) hex += byte.toString(16).padStart(2, "0");
    return hex;
  }

  /** Variante di `update` usata per il padding: non aggiorna il conteggio dei byte. */
  private updateInternal(data: Uint8Array): void {
    for (const byte of data) {
      this.buffer[this.bufferLength] = byte;
      this.bufferLength += 1;
      if (this.bufferLength === BLOCK_SIZE) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }
  }

  private processBlock(data: Uint8Array, offset: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((data[j]! << 24) | (data[j + 1]! << 16) | (data[j + 2]! << 8) | data[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = this.h[0]!;
    let b = this.h[1]!;
    let c = this.h[2]!;
    let d = this.h[3]!;
    let e = this.h[4]!;
    let f = this.h[5]!;
    let g = this.h[6]!;
    let hh = this.h[7]!;

    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h[0] = (this.h[0]! + a) >>> 0;
    this.h[1] = (this.h[1]! + b) >>> 0;
    this.h[2] = (this.h[2]! + c) >>> 0;
    this.h[3] = (this.h[3]! + d) >>> 0;
    this.h[4] = (this.h[4]! + e) >>> 0;
    this.h[5] = (this.h[5]! + f) >>> 0;
    this.h[6] = (this.h[6]! + g) >>> 0;
    this.h[7] = (this.h[7]! + hh) >>> 0;
  }
}

/** Comodità: hash di un singolo buffer. */
export function sha256HexSync(data: Uint8Array): string {
  return new Sha256().update(data).digestHex();
}
