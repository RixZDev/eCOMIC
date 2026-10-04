// Builds a ZIP of the app's source files. Uses Vite's import.meta.glob with
// ?raw so the source is bundled at build time — this works in both the dev
// server AND the production preview (where fetching ?raw at runtime is not
// available), letting the builder export the source from the studio.
import { makeZip } from "@/lib/zip";

const SRC_MODULES = import.meta.glob(
  "/src/**/*.{js,jsx,ts,tsx,css,html,json,jsonc,md}",
  { query: "?raw", import: "default", eager: false }
);
const ROOT_MODULES = import.meta.glob(
  "/*.{js,jsx,ts,tsx,css,html,json,jsonc,md}",
  { query: "?raw", import: "default", eager: false }
);
const BASE44_MODULES = import.meta.glob(
  "/base44/**/*.{ts,js,jsonc,json,md}",
  { query: "?raw", import: "default", eager: false }
);

const README = `eCOMICS — Código fuente

Este es el código fuente crudo del proyecto, listo para compilar.

Requisitos:
- Node.js 18+
- Acceso a la plataforma Base44 (el app usa @base44/sdk, @base44/vite-plugin,
  entidades, funciones y auth de Base44). Estos paquetes se instalan con el
  resto de dependencias mediante "npm install".

Pasos para compilar:
1. npm install
2. Revisa base44/config.jsonc y src/lib/app-params.js con los valores de tu
   app en Base44 (appId, URL del backend, etc.).
3. npm run dev   -> entorno de desarrollo
   npm run build -> build de producción

Nota: los componentes de UI (src/components/ui) usan shadcn/ui.

== Compilar un APK con Capacitor ==
Requisitos extra: Android Studio + JDK 17 (para Capacitor 6).

1. npm install
2. npm run build              (genera la web en dist/)
3. npx cap add android        (solo la primera vez; crea la carpeta android/)
4. npx cap sync android       (copia dist/ al proyecto nativo)
5. npx cap open android       (abre Android Studio)
   -> Build > Build APK(s) / Generate Signed Bundle

Atajos definidos en package.json:
  npm run apk:android  -> build + sync + abrir Android Studio

Notas:
- El APK necesita conexión a internet (usa el backend de Base44 y la API de e621).
- La carpeta android/ se genera con "cap add android"; no se incluye en este ZIP.
`;

export async function buildSourceZip(onProgress) {
  const enc = new TextEncoder();
  const all = { ...SRC_MODULES, ...ROOT_MODULES, ...BASE44_MODULES };
  const paths = Object.keys(all);
  const files = [];
  let done = 0;
  const total = paths.length + 1;

  const queue = [...paths];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        const content = await all[p]();
        if (content != null) {
          files.push({ name: p.replace(/^\//, ""), data: enc.encode(content) });
        }
      } catch {}
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  files.push({ name: "LEEME.txt", data: enc.encode(README) });
  return makeZip(files);
}
