// Copies the MediaPipe pose runtime (from node_modules) and the pose models into dist/artifact/mp,
// so the artifact page can load them from its own origin. Models are cached in tools/.cache/models.
import { mkdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
const SRC = "node_modules/@mediapipe/tasks-vision", OUT = "dist/artifact/mp", CACHE = "tools/.cache/models";
mkdirSync(OUT + "/wasm", { recursive: true }); mkdirSync(OUT + "/models", { recursive: true }); mkdirSync(CACHE, { recursive: true });
copyFileSync(`${SRC}/vision_bundle.mjs`, `${OUT}/vision_bundle.mjs`);
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) copyFileSync(`${SRC}/wasm/${f}`, `${OUT}/wasm/${f}`);
for (const m of ["pose_landmarker_lite", "pose_landmarker_full"]) {
  const c = `${CACHE}/${m}.task`;
  if (!existsSync(c)) execFileSync("curl", ["-sSfL", "--max-time", "300", "-o", c, `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${m}/float16/1/${m}.task`]);
  // the artifact host serves binary files only as known web types; the page fetches these bytes itself and
  // hands them to MediaPipe (modelAssetBuffer), so the .wasm name only picks a type the host will serve
  copyFileSync(c, `${OUT}/models/${m}.model.wasm`);
  console.log(m, (statSync(c).size / 1e6).toFixed(1), "MB");
}
console.log("assets ready in", OUT);
