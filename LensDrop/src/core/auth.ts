/**
 * Handshake di autenticazione reciproca.
 *
 * Il codice di sessione non viene mai trasmesso: entrambe le parti lo usano
 * come materiale per derivare una chiave HMAC. Il mittente invia un nonce
 * firmato, il destinatario risponde firmando il nonce del mittente insieme al
 * proprio. Solo chi conosce il codice può produrre una firma valida, quindi:
 *  - il mittente sa di parlare con chi ha scansionato il QR;
 *  - il destinatario sa di parlare con il dispositivo che ha mostrato il QR;
 *  - un replay di messaggi catturati in passato non è accettato.
 */

import { PROTOCOL_VERSION } from "../config";
import type { Messenger } from "./channel";
import { authPayload, type HelloMessage, type Message, type WelcomeMessage } from "./protocol";
import { bytesToBase64Url, hmacBase64Url, randomNonce, safeEqual } from "./crypto";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function timeoutError(ms: number): AuthError {
  return new AuthError(
    ms >= 1000 ? "Nessuna risposta dal dispositivo entro il tempo previsto." : "Tempo scaduto.",
  );
}

/**
 * Attende il primo messaggio che soddisfa il predicato.
 * La promessa viene rifiutata se il canale si chiude o scade il timeout.
 */
export function waitForMessage(
  messenger: Messenger,
  predicate: (message: Message) => boolean,
  timeoutMs: number,
  errorMessage?: string,
): Promise<Message> {
  return new Promise<Message>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeClose();
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const unsubscribeMessage = messenger.onMessage((message) => {
      if (predicate(message)) finish(() => resolve(message));
    });
    const unsubscribeClose = messenger.onClose((reason) => {
      finish(() => reject(new AuthError(reason)));
    });
    const timer = setTimeout(() => {
      finish(() => reject(new AuthError(errorMessage ?? timeoutError(timeoutMs).message)));
    }, timeoutMs);

    if (!messenger.isOpen) {
      finish(() => reject(new AuthError("Il collegamento è già stato chiuso.")));
    }
  });
}

async function signHello(key: CryptoKey, sid: string, nonce: string): Promise<string> {
  return hmacBase64Url(key, authPayload("sender", sid, nonce));
}

async function signWelcome(
  key: CryptoKey,
  sid: string,
  senderNonce: string,
  receiverNonce: string,
): Promise<string> {
  return hmacBase64Url(key, authPayload("receiver", sid, `${senderNonce}|${receiverNonce}`));
}

/** Costruisce una risposta firmata al nonce del mittente. */
export async function createWelcomeMessage(
  key: CryptoKey,
  sid: string,
  senderNonce: string,
): Promise<WelcomeMessage> {
  const nonce = bytesToBase64Url(randomNonce());
  return {
    t: "welcome",
    v: PROTOCOL_VERSION,
    sid,
    n: nonce,
    mac: await signWelcome(key, sid, senderNonce, nonce),
  };
}

/**
 * Lato mittente: invia la sfida e verifica la risposta del destinatario.
 * La sfida viene ripetuta con lo stesso nonce finché non arriva risposta:
 * un messaggio perso durante l'apertura del DataChannel non blocca la sessione.
 */
export async function authenticateSender(
  messenger: Messenger,
  key: CryptoKey,
  sid: string,
  timeoutMs: number,
): Promise<void> {
  const nonce = bytesToBase64Url(randomNonce());
  const hello: HelloMessage = {
    t: "hello",
    v: PROTOCOL_VERSION,
    sid,
    n: nonce,
    mac: await signHello(key, sid, nonce),
  };
  let settled = false;
  const resend = setInterval(() => {
    if (settled || !messenger.isOpen) return;
    try {
      messenger.send(hello);
    } catch {
      // Se il canale è chiuso la promessa termina comunque per timeout o close.
    }
  }, 2500);

  try {
    messenger.send(hello);
    const reply = await waitForMessage(
      messenger,
      (message) => message.t === "welcome" || message.t === "reject" || message.t === "cancel",
      timeoutMs,
    );

    if (reply.t === "reject") throw new AuthError(reply.reason);
    if (reply.t === "cancel") throw new AuthError(reply.reason);
    if (reply.t !== "welcome") throw new AuthError("Risposta di autenticazione inattesa.");

    const expected = await signWelcome(key, sid, nonce, reply.n);
    if (!safeEqual(expected, reply.mac)) {
      throw new AuthError("Il dispositivo non conosce il codice di questa sessione.");
    }
  } finally {
    settled = true;
    clearInterval(resend);
  }
}

/** Lato destinatario: verifica la sfida del mittente e dimostra di conoscere il codice. */
export async function authenticateReceiver(
  messenger: Messenger,
  key: CryptoKey,
  sid: string,
  timeoutMs: number,
): Promise<void> {
  const hello = await waitForMessage(
    messenger,
    (message) => message.t === "hello" || message.t === "reject" || message.t === "cancel",
    timeoutMs,
  );

  if (hello.t === "reject" || hello.t === "cancel") throw new AuthError(hello.reason);
  if (hello.t !== "hello") throw new AuthError("Sfida di autenticazione inattesa.");

  const expectedHello = await signHello(key, sid, hello.n);
  if (!safeEqual(expectedHello, hello.mac)) {
    throw new AuthError("Il dispositivo non conosce il codice di questa sessione.");
  }

  messenger.send(await createWelcomeMessage(key, sid, hello.n));
}
