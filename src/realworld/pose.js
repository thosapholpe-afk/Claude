// In-browser pose estimation (MediaPipe Pose Landmarker, BlazePose GHUM 33 points).
// The library, WASM runtime and model are fetched on first use only, so the page itself stays small.
// Video frames never leave the device: everything below runs locally.

const VER = "0.10.21";
const qs = new URLSearchParams(location.search);
const LIB_BASES = [qs.get("mp"), `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`, `https://unpkg.com/@mediapipe/tasks-vision@${VER}`].filter(Boolean);
const MODEL_BASE = qs.get("mpmodel") || "https://storage.googleapis.com/mediapipe-models/pose_landmarker";
export const MODELS = {
  lite: { file: "pose_landmarker_lite", mb: 5.8, th: "เร็ว" },
  full: { file: "pose_landmarker_full", mb: 9.4, th: "มาตรฐาน" },
  heavy: { file: "pose_landmarker_heavy", mb: 30.7, th: "ละเอียดสุด" },
};
const modelUrl = (q) => (qs.get("mpmodel") ? `${MODEL_BASE}/${MODELS[q].file}.task` : `${MODEL_BASE}/${MODELS[q].file}/float16/1/${MODELS[q].file}.task`);

let lib = null;
const modelBufs = {};

async function loadLib(say) {
  if (lib) return lib;
  let err = null;
  for (const base of LIB_BASES) {
    try {
      say("กำลังโหลดไลบรารี AI ตรวจจับท่าทาง…");
      const url = base + "/vision_bundle.mjs";
      const mod = await import(/* @vite-ignore */ url);
      lib = { mod, base };
      return lib;
    } catch (e) { err = e; }
  }
  throw new Error("โหลดไลบรารี MediaPipe ไม่ได้ (ต้องต่ออินเทอร์เน็ตในการใช้ครั้งแรก) · " + (err && err.message ? err.message : err));
}

async function fetchModel(q, say) {
  if (modelBufs[q]) return modelBufs[q];
  const url = modelUrl(q);
  let cache = null;
  try { cache = window.caches ? await caches.open("gaitlab-pose-v1") : null; } catch (e) { cache = null; }
  if (cache) {
    try { const hit = await cache.match(url); if (hit) { modelBufs[q] = new Uint8Array(await hit.arrayBuffer()); return modelBufs[q]; } } catch (e) { /* ignore */ }
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`ดาวน์โหลดโมเดลไม่สำเร็จ (HTTP ${res.status})`);
  const total = +res.headers.get("content-length") || MODELS[q].mb * 1e6;
  let buf;
  if (res.body && res.body.getReader) {
    const rd = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      say(`กำลังดาวน์โหลดโมเดล AI ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`, got / total);
    }
    buf = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
  } else buf = new Uint8Array(await res.arrayBuffer());
  if (cache) { try { await cache.put(url, new Response(buf.slice().buffer, { headers: { "content-type": "application/octet-stream" } })); } catch (e) { /* storage full or not allowed */ } }
  modelBufs[q] = buf;
  return buf;
}

// Creates a VIDEO-mode landmarker. GPU first, CPU (XNNPACK) as fallback.
export async function createLandmarker(quality = "full", say = () => {}) {
  const { mod, base } = await loadLib(say);
  const buf = await fetchModel(quality, say);
  say("กำลังเตรียมโมเดล…");
  const fileset = await mod.FilesetResolver.forVisionTasks(base + "/wasm");
  const order = qs.get("mpcpu") ? ["CPU"] : ["GPU", "CPU"];
  let err = null;
  for (const delegate of order) {
    try {
      const lm = await mod.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: buf, delegate },
        runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      lm._delegate = delegate;
      return lm;
    } catch (e) { err = e; }
  }
  throw new Error("เริ่มโมเดลไม่สำเร็จ: " + (err && err.message ? err.message : err));
}

// Some recorders write WebM without a duration; seeking to the end forces the browser to compute it.
export async function ensureDuration(video) {
  if (isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise((res) => {
    const done = () => { video.removeEventListener("durationchange", chk); res(); };
    const chk = () => { if (isFinite(video.duration)) done(); };
    video.addEventListener("durationchange", chk);
    video.currentTime = 1e7;
    setTimeout(done, 4000);
  });
  video.currentTime = 0;
  return isFinite(video.duration) ? video.duration : 0;
}

function seek(video, t) {
  return new Promise((res) => {
    let to = 0;
    const done = () => { clearTimeout(to); video.removeEventListener("seeked", done); res(); };
    video.addEventListener("seeked", done);
    to = setTimeout(done, 2500);
    video.currentTime = t;
  });
}

let tsBase = 0;

// Steps through the clip at a fixed rate (deterministic, independent of device speed) and returns
// per-frame landmarks: lm = Float32Array(33*4) of [x, y, z, visibility] in normalised image coordinates.
export async function extractPoses(video, landmarker, { fps = 30, t0 = 0, t1 = video.duration, onFrame = () => {}, signal } = {}) {
  const W = video.videoWidth, H = video.videoHeight;
  const s = Math.min(1, 960 / Math.max(W, H));
  const cv = document.createElement("canvas");
  cv.width = Math.max(2, Math.round(W * s)); cv.height = Math.max(2, Math.round(H * s));
  const ctx = cv.getContext("2d");
  const n = Math.max(1, Math.floor((t1 - t0) * fps + 1e-6));
  const frames = [];
  video.pause();
  const tStart = performance.now();
  for (let k = 0; k <= n; k++) {
    if (signal && signal.aborted) throw new DOMException("ยกเลิกแล้ว", "AbortError");
    const t = Math.min(t1, t0 + k / fps);
    await seek(video, t);
    ctx.drawImage(video, 0, 0, cv.width, cv.height);
    const ts = tsBase + Math.round((t - t0) * 1000) + 1;
    let lm = null, wl = null;
    try {
      const r = landmarker.detectForVideo(cv, ts);
      const a = r && r.landmarks && r.landmarks[0];
      if (a && a.length >= 33) {
        lm = new Float32Array(33 * 4);
        for (let j = 0; j < 33; j++) { const p = a[j]; lm[j * 4] = p.x; lm[j * 4 + 1] = p.y; lm[j * 4 + 2] = p.z; lm[j * 4 + 3] = p.visibility ?? 1; }
        const w = r.worldLandmarks && r.worldLandmarks[0];
        if (w && w.length >= 33) { wl = new Float32Array(33 * 3); for (let j = 0; j < 33; j++) { wl[j * 3] = w[j].x; wl[j * 3 + 1] = w[j].y; wl[j * 3 + 2] = w[j].z; } }
      }
    } catch (e) { /* skip frame */ }
    frames.push({ t, lm, wl });
    const el = (performance.now() - tStart) / 1000;
    onFrame({ k, n, t, lm, eta: (el / (k + 1)) * (n - k) });
    if (k % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  tsBase += Math.round((t1 - t0) * 1000) + 1000;
  return { frames, W, H, fps, t0, t1 };
}

export { LM, BONES } from "./landmarks.js";
