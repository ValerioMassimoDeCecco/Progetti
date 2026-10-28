import { defineConfig } from "vite";

/**
 * `base` è il sottopercorso su cui l'app verrà servita.
 * Su GitHub Pages il sito vive in /Progetti/LensDrop/, in locale in /.
 * Il workflow di deploy passa VITE_BASE, quindi non ci sono percorsi assoluti hardcoded.
 */
export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE ?? "/";
  return {
    base,
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      // Il sandbox di sviluppo espone il server tramite un host proxy diverso da localhost.
      allowedHosts: true,
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
      allowedHosts: true,
    },
    build: {
      target: "es2020",
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 900,
    },
  };
});
