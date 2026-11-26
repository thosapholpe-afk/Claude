// Bundles src/ into a single self-contained index.html (works from file://, no server needed).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

// Artifact variant (claude.ai page): the host adds <!doctype>, <html>, <head> and <body> itself, its CSP only
// lets scripts come from a few CDNs and blocks other fetches, so the pose runtime and models are published
// beside the page (see tools/artifact-assets.mjs) and found through window.__GAIT_ENV.
const tpl = readFileSync("src/template.html", "utf8");
const headInner = tpl.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, "").replace(/<meta name="viewport"[^>]*>\s*/, "").replace(/<meta name="description"[^>]*>\s*/, "")
  .replace(/<link rel="preload" as="style" href="([^"]+)"[^>]*>/, (m, href) => `<link rel="stylesheet" href="${href}">`);
const bodyInner = tpl.match(/<body>([\s\S]*?)<\/body>/)[1];
const env = `window.__GAIT_ENV={artifact:true,mpBase:"mp",mpModel:"mp/models",modelExt:".model.wasm",heavy:false};\n`;
const art = (headInner.trim() + "\n" + bodyInner.trim() + "\n").replace("/*CSS*/", () => css).replace("/*JS*/", () => env + code);
mkdirSync("dist/artifact", { recursive: true });
writeFileSync("dist/artifact/index.html", art);
console.log(`dist/artifact/index.html ${(art.length / 1024).toFixed(0)} KB`);
