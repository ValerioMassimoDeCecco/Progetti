/** La libreria QR viene caricata solo quando serve: primo avvio più leggero. */
async function loadQrCode() {
  const module = await import("qrcode");
  return module.default;
}

/**
 * Disegna il QR della sessione su canvas.
 * Il payload contiene un link con codice e scadenza nel fragment: non viene
 * mai inviato a un server (i fragment non viaggiano nelle richieste HTTP).
 */
export async function renderQr(canvas: HTMLCanvasElement, payload: string): Promise<void> {
  const QRCode = await loadQrCode();
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 560,
    color: { dark: "#0b1224", light: "#ffffff" },
  });
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Codice QR della sessione di trasferimento");
}

export function clearQr(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}
