import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/** Write U+FFFD (from a bundled string_decoder polyfill) as an escape so the output is clean ASCII-safe text. */
const escapeReplacementChar = (): Plugin => ({
  name: "escape-replacement-char",
  enforce: "post",
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) if (f.type === "chunk" && f.code.includes("\uFFFD")) f.code = f.code.replace(/\uFFFD/g, "\\uFFFD");
  },
});

export default defineConfig({
  plugins: [react(), escapeReplacementChar()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
      "/auth": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
});
