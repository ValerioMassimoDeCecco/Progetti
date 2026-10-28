import "./styles/base.css";
import "./styles/screens.css";
import { startApp } from "./ui/app";

startApp();

/**
 * Service worker: cache dell'app shell per l'avvio offline e per il sottopercorso
 * di GitHub Pages. In sviluppo non viene registrato (evita cache sorprendenti).
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        // La PWA è un extra: il fallimento non deve disturbare l'uso dell'app.
      });
  });
}
