import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/config";
import { authenticateReceiver, authenticateSender } from "../src/core/auth";
import { Messenger, type Channel, type RawPayload } from "../src/core/channel";
import { deriveSessionKey } from "../src/core/crypto";
import { serialize, type Message, type OfferMessage } from "../src/core/protocol";
import {
  TransferReceiver,
  TransferSender,
  type ReceivedItem,
  type ReceiveSummary,
} from "../src/core/transfer";
import { createChannelPair, MemoryChannel, TamperChannel } from "./helpers/memory-channel";

const CODE = "ABCDEFGHJKMN";
const TIMEOUT = 20_000;

interface Pair {
  host: MemoryChannel;
  guest: MemoryChannel;
  hostMessenger: Messenger;
  guestMessenger: Messenger;
  protocolErrors: string[];
}

async function authenticatedPair(
  code = CODE,
  wrapGuest?: (channel: MemoryChannel) => Channel,
): Promise<Pair> {
  const [host, guest] = createChannelPair();
  const key = await deriveSessionKey(code);
  const protocolErrors: string[] = [];
  const hostMessenger = new Messenger(host, code, (reason) => protocolErrors.push(reason));
  const guestChannel = wrapGuest ? wrapGuest(guest) : guest;
  const guestMessenger = new Messenger(guestChannel, code, (reason) => protocolErrors.push(reason));

  await Promise.all([
    authenticateSender(hostMessenger, key, code, 5000),
    authenticateReceiver(guestMessenger, key, code, 5000),
  ]);

  return { host, guest, hostMessenger, guestMessenger, protocolErrors };
}

function makeFile(content: string | Uint8Array, name: string, mime = ""): File {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return new File([bytes as BlobPart], name, { type: mime });
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 256;
  return bytes;
}

describe("handshake", () => {
  it("autentica entrambe le parti con lo stesso codice", async () => {
    const pair = await authenticatedPair();
    expect(pair.protocolErrors).toEqual([]);
  }, TIMEOUT);

  it("rifiuta un dispositivo che non conosce il codice", async () => {
    const [host, guest] = createChannelPair();
    const hostKey = await deriveSessionKey(CODE);
    const guestKey = await deriveSessionKey("ABCDEFGHJKMP");
    const hostMessenger = new Messenger(host, CODE, () => undefined);
    const guestMessenger = new Messenger(guest, CODE, () => undefined);

    const results = await Promise.allSettled([
      authenticateSender(hostMessenger, hostKey, CODE, 3000),
      authenticateReceiver(guestMessenger, guestKey, CODE, 3000),
    ]);

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("rejected");
  }, TIMEOUT);

  it("recupera una sfida persa ripetendo l'hello", async () => {
    // Simula il caso reale in cui il primo 'hello' arriva prima che il
    // destinatario stia ascoltando sul DataChannel appena aperto.
    const [host, guest] = createChannelPair();
    const key = await deriveSessionKey(CODE);
    const hostMessenger = new Messenger(host, CODE, () => undefined);

    const hostAuth = authenticateSender(hostMessenger, key, CODE, 8000);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const guestMessenger = new Messenger(guest, CODE, () => undefined);
    const guestAuth = authenticateReceiver(guestMessenger, key, CODE, 8000);

    await Promise.all([hostAuth, guestAuth]);
  }, TIMEOUT);

  it("scarta un nonce riutilizzato in una seconda connessione", async () => {
    // Un attaccante che riproduce un vecchio 'welcome' non supera la verifica
    // perché il mittente genera un nonce nuovo a ogni connessione.
    const key = await deriveSessionKey(CODE);
    const [hostA, guestA] = createChannelPair();
    const hostMessengerA = new Messenger(hostA, CODE, () => undefined);
    const guestMessengerA = new Messenger(guestA, CODE, () => undefined);
    await Promise.all([
      authenticateSender(hostMessengerA, key, CODE, 3000),
      authenticateReceiver(guestMessengerA, key, CODE, 3000),
    ]);

    const replay = new MemoryChannel();
    const replayPeer = new MemoryChannel();
    replay.peer = replayPeer;
    replayPeer.peer = replay;
    const victim = new Messenger(replay, CODE, () => undefined);
    const attacker = new Messenger(replayPeer, CODE, () => undefined);

    const hijack = new Promise<void>((resolve) => {
      attacker.onMessage((message) => {
        if (message.t === "hello") {
          const fake: Message = {
            t: "welcome",
            v: PROTOCOL_VERSION,
            sid: CODE,
            n: "AAAAAAAAAAAAAAAAAAAAAA",
            mac: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          };
          attacker.send(fake);
          resolve();
        }
      });
    });

    const auth = authenticateSender(victim, key, CODE, 2000);
    await hijack;
    await expect(auth).rejects.toThrow(/non conosce il codice/i);
  }, TIMEOUT);
});

describe("trasferimento", () => {
  it("trasferisce più file, incluso uno vuoto, verificando SHA-256", async () => {
    const pair = await authenticatedPair();
    const received: ReceivedItem[] = [];
    let summary: ReceiveSummary | null = null;
    const completed = new Promise<void>((resolve) => {
      const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
        onOffer: () => receiver.accept(),
        onItem: (item) => received.push(item),
        onComplete: (value) => {
          summary = value;
          resolve();
        },
        onError: (error) => {
          throw error;
        },
      });
    });

    const sender = new TransferSender(pair.hostMessenger, CODE);
    const files = [
      makeFile(new Uint8Array([0, 1, 2, 3, 4, 255]), "binario.dat", "application/octet-stream"),
      makeFile("Ciao LensDrop, questo è un test.", "nota.txt", "text/plain"),
      makeFile(new Uint8Array(0), "vuoto.bin"),
    ];

    const sendSummary = await sender.send(files);
    await completed;

    expect(sendSummary.items).toBe(3);
    expect(received.map((item) => item.fileName)).toEqual(["binario.dat", "nota.txt", "vuoto.bin"]);
    expect(received.every((item) => item.verified)).toBe(true);
    expect(new Uint8Array(await received[0]!.blob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3, 4, 255]));
    expect(await received[1]!.blob.text()).toBe("Ciao LensDrop, questo è un test.");
    expect(received[2]!.blob.size).toBe(0);
    expect(summary).not.toBeNull();
    expect(summary!.allVerified).toBe(true);
    expect(summary!.totalBytes).toBe(files.reduce((sum, file) => sum + file.size, 0));
  }, TIMEOUT);

  it("gestisce file grandi a blocchi con controllo di flusso", async () => {
    const pair = await authenticatedPair();
    const data = randomBytes(1024 * 1024 + 123);
    const received: ReceivedItem[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
        onOffer: () => receiver.accept(),
        onItem: (item) => received.push(item),
        onComplete: () => resolve(),
        onError: reject,
      });
    });

    const progress: number[] = [];
    const sender = new TransferSender(pair.hostMessenger, CODE, {
      onProgress: (value) => progress.push(value.transferredBytes),
    });
    await sender.send([makeFile(data, "grande.bin")]);
    await completed;

    expect(received).toHaveLength(1);
    const roundTrip = new Uint8Array(await received[0]!.blob.arrayBuffer());
    expect(roundTrip.byteLength).toBe(data.byteLength);
    expect(roundTrip[0]).toBe(data[0]);
    expect(roundTrip[data.byteLength - 1]).toBe(data[data.byteLength - 1]);
    expect(progress.length).toBeGreaterThan(1);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    }
    expect(progress.at(-1)).toBe(data.byteLength);
  }, TIMEOUT);

  it("consente al destinatario di annullare a metà invio", async () => {
    const pair = await authenticatedPair();
    let reactiveReceiver: TransferReceiver | null = null;
    let cancelFired = false;

    const cancelled = new Promise<void>((resolve) => {
      const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
        onOffer: () => {
          receiver.accept();
          setTimeout(() => receiver.cancel("Mi serve spazio libero."), 10);
        },
        onCancel: () => {
          cancelFired = true;
          resolve();
        },
      });
      reactiveReceiver = receiver;
    });

    const sender = new TransferSender(pair.hostMessenger, CODE, {
      onCancel: () => {
        cancelFired = true;
      },
    });

    const big = makeFile(randomBytes(3 * 1024 * 1024), "enorme.bin");
    await expect(sender.send([big])).rejects.toBeDefined();
    await cancelled;
    expect(cancelFired).toBe(true);
    expect(reactiveReceiver).not.toBeNull();
  }, TIMEOUT);

  it("rileva un payload alterato tramite SHA-256", async () => {
    const pair = await authenticatedPair(CODE, (guest) =>
      new TamperChannel(
        guest,
        (payload: RawPayload) => {
          if (payload instanceof ArrayBuffer) {
            const copy = payload.slice(0);
            const view = new Uint8Array(copy);
            view[20] = view[20]! ^ 0x5a;
            return copy;
          }
          return payload;
        },
        (payload) => payload instanceof ArrayBuffer,
      ),
    );

    const errors: Error[] = [];
    const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
      onOffer: () => receiver.accept(),
      onError: (error) => errors.push(error),
    });

    const sender = new TransferSender(pair.hostMessenger, CODE);
    await expect(sender.send([makeFile(randomBytes(60_000), "corrotto.bin")])).rejects.toThrow(/verifica/i);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/verifica|hash/i);
  }, TIMEOUT);

  it("interrompe la sessione se i blocchi arrivano fuori sequenza", async () => {
    const pair = await authenticatedPair(CODE, (guest) => {
      let duplicated = false;
      return {
        get isOpen() {
          return guest.isOpen;
        },
        sendText: (text: string) => guest.sendText(text),
        sendBinary: (data: ArrayBuffer) => guest.sendBinary(data),
        bufferedAmount: () => guest.bufferedAmount(),
        subscribe: (handler: (payload: RawPayload) => void) =>
          guest.subscribe((payload) => {
            handler(payload);
            if (!duplicated && payload instanceof ArrayBuffer) {
              duplicated = true;
              handler(payload);
            }
          }),
        onClose: (handler: (reason: string) => void) => guest.onClose(handler),
        close: () => guest.close(),
      } satisfies Channel;
    });

    const errors: Error[] = [];
    const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
      onOffer: () => receiver.accept(),
      onError: (error) => errors.push(error),
    });
    const sender = new TransferSender(pair.hostMessenger, CODE);
    await expect(sender.send([makeFile(randomBytes(40_000), "sequenza.bin")])).rejects.toBeDefined();
    expect(errors.some((error) => /sequenza|interrotto|chiuso/i.test(error.message))).toBe(true);
  }, TIMEOUT);

  it("supporta un secondo lotto di file sulla stessa sessione", async () => {
    const pair = await authenticatedPair();
    const received: string[] = [];
    let batches = 0;
    const bothDone = new Promise<void>((resolve) => {
      const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
        onOffer: () => receiver.accept(),
        onItem: (item) => received.push(item.fileName),
        onComplete: () => {
          batches += 1;
          if (batches === 2) resolve();
        },
      });
    });

    const sender = new TransferSender(pair.hostMessenger, CODE);
    await sender.send([makeFile("primo", "primo.txt")]);
    await sender.send([makeFile("secondo", "secondo.txt"), makeFile("terzo", "terzo.txt")]);
    await bothDone;

    expect(received).toEqual(["primo.txt", "secondo.txt", "terzo.txt"]);
    expect(batches).toBe(2);
  }, TIMEOUT);

  it("rifiuta la proposta se il destinatario non accetta", async () => {
    const pair = await authenticatedPair();
    const receiver = new TransferReceiver(pair.guestMessenger, CODE, {
      onOffer: (offer: OfferMessage) => {
        expect(offer.items).toHaveLength(1);
        receiver.reject("Non mi serve.");
      },
    });
    const sender = new TransferSender(pair.hostMessenger, CODE);
    await expect(sender.send([makeFile("x", "x.txt")])).rejects.toThrow(/Non mi serve/);
  }, TIMEOUT);
});

describe("livello di messaggistica", () => {
  it("accoda i messaggi ricevuti prima della registrazione dell'handler", async () => {
    const [host, guest] = createChannelPair();
    const key = await deriveSessionKey(CODE);
    const messenger = new Messenger(host, CODE, () => undefined);

    const auth = authenticateSender(messenger, key, CODE, 3000);
    const guestMessenger = new Messenger(guest, CODE, () => undefined);
    await authenticateReceiver(guestMessenger, key, CODE, 3000).catch(() => undefined);

    await auth;

    const offer: Message = {
      t: "offer",
      v: PROTOCOL_VERSION,
      sid: CODE,
      items: [{ id: "ABCD2345", name: "a.txt", size: 3, mime: "text/plain" }],
      totalBytes: 3,
    };
    guestMessenger.send(offer);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const received = await new Promise<Message>((resolve) => {
      messenger.onMessage((message) => {
        if (message.t === "offer") resolve(message);
      });
    });
    expect(received.t).toBe("offer");
  }, TIMEOUT);

  it("chiude il canale quando arriva un messaggio non valido", async () => {
    const [host, guest] = createChannelPair();
    const errors: string[] = [];
    new Messenger(host, CODE, (reason) => errors.push(reason));
    guest.sendText(serialize({ t: "accept", v: PROTOCOL_VERSION, sid: "ZZZZZZZZZZZZ" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errors.length).toBeGreaterThan(0);
    expect(host.isOpen).toBe(false);
  }, TIMEOUT);

  it("gestisce i ping senza chiudere il canale", async () => {
    const [host, guest] = createChannelPair();
    const errors: string[] = [];
    new Messenger(host, CODE, (reason) => errors.push(reason));
    const guestMessenger = new Messenger(guest, CODE, (reason) => errors.push(reason));
    guestMessenger.send({ t: "ping", v: PROTOCOL_VERSION, sid: CODE });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errors).toEqual([]);
    expect(host.isOpen).toBe(true);
  }, TIMEOUT);
});
