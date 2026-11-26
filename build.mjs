// Bundles src/ into a single self-contained index.html (works from file://, no server needed).
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// compressed human asset (decompressed in the browser with fflate)
writeFileSync("src/assets/human.gz", gzipSync(readFileSync("src/assets/human.bin"), { level: 9 }));

const js = await build({
  entryPoints: ["src/main.js"], bundle: true, minify: true, format: "iife",
  target: "es2020", write: false, legalComments: "none", loader: { ".gz": "binary" },
});
const code = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/style.css", "utf8");
const html = readFileSync("src/template.html", "utf8")
  .replace("/*CSS*/", () => css)
  .replace("/*JS*/", () => code);
writeFileSync("index.html", html);
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
