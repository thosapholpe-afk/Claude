// Gait analysis from 2D pose landmarks (single smartphone camera).
// Side view: sagittal hip/knee/ankle/trunk angles, events by the Zeni et al. (2008) coordinate method,
// spatiotemporal parameters, symmetry. Front view: knee frontal-plane projection angle, pelvic
// obliquity, trunk lateral lean, step width and timing. Everything is compared with a personalised
// normal pattern from the simulator's own gait model (age, sex, BMI, measured speed).
import { model, curves, COEF_DEFAULT } from "../model.js";
import { LM } from "./landmarks.js";

const D = 180 / Math.PI;
const ok = (v) => v === v && v !== Infinity && v !== -Infinity;
const nanArr = (n) => new Float64Array(n).fill(NaN);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function median(a) { const b = Array.from(a).filter(ok).sort((x, y) => x - y); if (!b.length) return NaN; const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; }
export function quantile(a, q) { const b = Array.from(a).filter(ok).sort((x, y) => x - y); if (!b.length) return NaN; const i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); }
export function mean(a) { let s = 0, n = 0; for (const v of a) if (ok(v)) { s += v; n++; } return n ? s / n : NaN; }
export function stdev(a) { const m = mean(a); let s = 0, n = 0; for (const v of a) if (ok(v)) { s += (v - m) ** 2; n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : 0; }
const SI = (a, b) => (ok(a) && ok(b) && a + b !== 0 ? (Math.abs(a - b) / (0.5 * Math.abs(a + b))) * 100 : NaN);

// ---------------------------------------------------------------- signal helpers
function fillGaps(x, maxGap) {
  const n = x.length;
  for (let i = 0; i < n;) {
    if (ok(x[i])) { i++; continue; }
    let j = i;
    while (j < n && !ok(x[j])) j++;
    if (i > 0 && j < n && j - i <= maxGap) for (let k = i; k < j; k++) x[k] = x[i - 1] + ((x[j] - x[i - 1]) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
}
function runsOf(valid, minLen = 1) {
  const out = [];
  for (let i = 0; i < valid.length;) {
    if (!valid[i]) { i++; continue; }
    let j = i;
    while (j < valid.length && valid[j]) j++;
    if (j - i >= minLen) out.push([i, j]);
    i = j;
  }
  return out;
}
function biquadLP(fc, fs) {
  const K = Math.tan((Math.PI * fc) / fs), Q = Math.SQRT1_2, nrm = 1 / (1 + K / Q + K * K);
  return { b0: K * K * nrm, b1: 2 * K * K * nrm, b2: K * K * nrm, a1: 2 * (K * K - 1) * nrm, a2: (1 - K / Q + K * K) * nrm };
}
function runBiquad(x, c) {
  const y = new Float64Array(x.length);
  let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
  for (let i = 0; i < x.length; i++) { const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
// zero-phase low-pass Butterworth (2nd order run forwards and backwards), applied per valid run
export function lowpass(x, fc, fs) {
  const out = Float64Array.from(x), c = biquadLP(Math.min(fc, fs * 0.45), fs);
  for (const [a, b] of runsOf(Array.from(x, ok), 1)) {
    const n = b - a;
    if (n < 7) continue;
    const pad = Math.min(n - 1, Math.round(fs * 0.4)), e = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) e[i] = 2 * x[a] - x[a + pad - i];
    for (let i = 0; i < n; i++) e[pad + i] = x[a + i];
    for (let i = 0; i < pad; i++) e[pad + n + i] = 2 * x[b - 1] - x[b - 2 - i];
    let y = runBiquad(e, c).reverse();
    y = runBiquad(y, c).reverse();
    for (let i = 0; i < n; i++) out[a + i] = y[pad + i];
  }
  return out;
}
function medianFilter(x, w) {
  const out = nanArr(x.length), h = w >> 1;
  for (let i = 0; i < x.length; i++) out[i] = median(x.slice(Math.max(0, i - h), Math.min(x.length, i + h + 1)));
  return out;
}
// local maxima with a minimum spacing and prominence (relative to the lowest point within +-win)
function peaks(x, a, b, minDist, minProm, win) {
  const cand = [];
  for (let i = a + 1; i < b - 1; i++) {
    if (!ok(x[i]) || !ok(x[i - 1]) || !ok(x[i + 1])) continue;
    if (!(x[i] >= x[i - 1] && x[i] > x[i + 1])) continue;
    let lo = Infinity, hiNb = -Infinity;
    for (let k = Math.max(a, i - win); k < Math.min(b, i + win + 1); k++) if (ok(x[k])) { lo = Math.min(lo, x[k]); if (Math.abs(k - i) <= minDist && k !== i) hiNb = Math.max(hiNb, x[k]); }
    if (x[i] - lo < minProm || hiNb > x[i]) continue;
    cand.push(i);
  }
  const out = [];
  for (const i of cand) {
    if (out.length && i - out[out.length - 1] < minDist) { if (x[i] > x[out[out.length - 1]]) out[out.length - 1] = i; }
    else out.push(i);
  }
  return out;
}
// refine an integer peak to sub-frame precision with a parabola
function subframe(x, i) {
  const a = x[i - 1], b = x[i], c = x[i + 1];
  if (!ok(a) || !ok(c)) return i;
  const d = a - 2 * b + c;
  return d === 0 ? i : i + clamp((0.5 * (a - c)) / d, -0.5, 0.5);
}
const ang = (ax, ay, bx, by) => Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * D; // signed angle a -> b (CCW +)

// resample a per-frame series over [i0, i1] (fractional frame indices) to 101 points
function cycleCurve(s, i0, i1) {
  const out = new Array(101);
  for (let q = 0; q <= 100; q++) {
    const x = i0 + ((i1 - i0) * q) / 100, i = Math.floor(x), f = x - i;
    const a = s[i], b = s[Math.min(s.length - 1, i + 1)];
    out[q] = ok(a) && ok(b) ? a + (b - a) * f : ok(a) ? a : b;
  }
  return out;
}
function meanCurve(cs) {
  const m = new Array(101).fill(0), sd = new Array(101).fill(0);
  if (!cs.length) return { m: null, sd: null };
  for (let q = 0; q <= 100; q++) { const v = cs.map((c) => c[q]).filter(ok); m[q] = mean(v); sd[q] = stdev(v); }
  return { m, sd };
}
const win = (a, f0, f1, fn) => { const v = []; for (let q = Math.max(0, Math.round(f0 * 100)); q <= Math.min(100, Math.round(f1 * 100)); q++) v.push(a[q]); return fn(...v.filter(ok)); };

// ---------------------------------------------------------------- normal references
// comfortable walking speed by age and sex (Bohannon & Andrews 2011, meta-analysis)
const SPEED_NORM = [[29, 1.36, 1.34], [39, 1.43, 1.34], [49, 1.43, 1.39], [59, 1.43, 1.31], [69, 1.34, 1.24], [79, 1.26, 1.13], [200, 0.97, 0.94]];
export function speedNorm(age, sex) { const r = SPEED_NORM.find((x) => age <= x[0]); return sex === "F" ? r[2] : r[1]; }

function normFor(o, v) {
  const cfg = { age: o.age, sex: o.sex, ht: o.ht, wt: o.wt, mode: "normal", speed: "comf", v: ok(v) ? clamp(v, 0.5, 1.9) : undefined };
  const m = model(cfg, COEF_DEFAULT), c = curves(m);
  return { m, curves: { hip: c.R.hip, knee: c.R.knee, ank: c.R.ank }, sf: m.legs.R.sf };
}
// normal between-subject spread (deg) widened for 2D-video measurement error
export const BAND = { hip: 7, knee: 7, ank: 6 };

// phase features of one cycle curve set, using that cycle's own toe-off fraction
function features(c, sf) {
  const f = {};
  f.kneeIC = win(c.knee, 0, 0.02, (...v) => mean(v));
  f.kneeLR = win(c.knee, 0, 0.42 * sf, Math.max);
  f.kneeSt = win(c.knee, 0.42 * sf, 0.92 * sf, Math.min);
  f.kneeSw = win(c.knee, sf, 1, Math.max);
  f.hipIC = win(c.hip, 0, 0.02, (...v) => mean(v));
  f.hipExt = win(c.hip, 0.45 * sf, Math.min(1, sf + 0.06), Math.min);
  f.hipFlex = Math.max(win(c.hip, 0.75, 1, Math.max), win(c.hip, 0, 0.05, Math.max));
  f.hipROM = Math.max(...c.hip.filter(ok)) - Math.min(...c.hip.filter(ok));
  f.ankIC = win(c.ank, 0, 0.02, (...v) => mean(v));
  f.ankDF = win(c.ank, 0.3 * sf, 0.95 * sf, Math.max);
  f.ankPF = win(c.ank, 0.85 * sf, Math.min(1, sf + 0.14), Math.min);
  f.ankSw = win(c.ank, sf + 0.45 * (1 - sf), sf + 0.85 * (1 - sf), (...v) => mean(v));
  return f;
}

// ---------------------------------------------------------------- main entry
// rec: { frames:[{t, lm: Float32Array(33*4)|null}], W, H, fps }
// o:   { ht (cm), wt (kg), age, sex: 'M'|'F', view: 'auto'|'side'|'front', swapLR: bool }
export function analyze(rec, o) {
  const { frames, W, H, fps } = rec, n = frames.length;
  const t = Float64Array.from(frames, (f) => f.t);
  const ids = Object.values(LM);
  const P = {};
  for (const id of ids) P[id] = { x: nanArr(n), y: nanArr(n), z: nanArr(n), v: nanArr(n) };
  let det = 0;
  frames.forEach((f, i) => {
    if (!f.lm) return;
    det++;
    for (const id of ids) { const k = id * 4; P[id].x[i] = f.lm[k] * W; P[id].y[i] = f.lm[k + 1] * H; P[id].z[i] = f.lm[k + 2] * W; P[id].v[i] = f.lm[k + 3]; }
  });
  // frames where the body is cut by the image border or the skeleton is implausible are dropped
  const core = [LM.shL, LM.shR, LM.hipL, LM.hipR, LM.kneeL, LM.kneeR, LM.ankL, LM.ankR];
  const segLen = (i) => {
    const d = (a, b) => Math.hypot(P[a].x[i] - P[b].x[i], P[a].y[i] - P[b].y[i]);
    const tor = Math.hypot(0.5 * (P[LM.shL].x[i] + P[LM.shR].x[i] - P[LM.hipL].x[i] - P[LM.hipR].x[i]), 0.5 * (P[LM.shL].y[i] + P[LM.shR].y[i] - P[LM.hipL].y[i] - P[LM.hipR].y[i]));
    return { tor, lL: d(LM.hipL, LM.kneeL) + d(LM.kneeL, LM.ankL), lR: d(LM.hipR, LM.kneeR) + d(LM.kneeR, LM.ankR), up: (0.5 * (P[LM.hipL].y[i] + P[LM.hipR].y[i]) - 0.5 * (P[LM.shL].y[i] + P[LM.shR].y[i])) };
  };
  const segs = [];
  for (let i = 0; i < n; i++) if (ok(P[LM.hipL].x[i])) segs.push(segLen(i));
  const mTor = median(segs.map((q) => q.tor)), mLeg = median(segs.flatMap((q) => [q.lL, q.lR]));
  let cut = 0;
  for (let i = 0; i < n; i++) {
    if (!ok(P[LM.hipL].x[i])) continue;
    let bad = false;
    for (const id of core) { const x = P[id].x[i] / W, y = P[id].y[i] / H; if (x < -0.03 || x > 1.03 || y < -0.03 || y > 1.03) bad = true; }
    const q = segLen(i);
    if (q.tor < 0.6 * mTor || q.tor > 1.5 * mTor || q.lL < 0.6 * mLeg || q.lL > 1.4 * mLeg || q.lR < 0.6 * mLeg || q.lR > 1.4 * mLeg || q.up < 0.4 * mTor) bad = true;
    if (bad) { cut++; det--; for (const id of ids) for (const k of ["x", "y", "z", "v"]) P[id][k][i] = NaN; }
  }
  const R = { ok: false, n, fps, W, H, t, detRate: det / n, cutFrac: cut / n, issues: [], o };
  if (det < fps * 1.2) { R.error = "ตรวจไม่พบคนในวิดีโอ หรือเห็นคนสั้นเกินไป (ต้องเห็นทั้งตัวอย่างน้อย 2–3 วินาที)"; return R; }
  const gap = Math.round(fps * 0.25);
  for (const id of ids) for (const k of ["x", "y", "z", "v"]) fillGaps(P[id][k], gap);

  // body scale in pixels
  const dist = (a, b, i) => Math.hypot(P[a].x[i] - P[b].x[i], P[a].y[i] - P[b].y[i]);
  const legPx = [], torsoPx = [], shW = [], hipW = [];
  for (let i = 0; i < n; i++) {
    if (!ok(P[LM.hipL].x[i])) continue;
    legPx.push(0.5 * (dist(LM.hipL, LM.kneeL, i) + dist(LM.kneeL, LM.ankL, i) + dist(LM.hipR, LM.kneeR, i) + dist(LM.kneeR, LM.ankR, i)));
    const sx = 0.5 * (P[LM.shL].x[i] + P[LM.shR].x[i]), sy = 0.5 * (P[LM.shL].y[i] + P[LM.shR].y[i]);
    const hx = 0.5 * (P[LM.hipL].x[i] + P[LM.hipR].x[i]), hy = 0.5 * (P[LM.hipL].y[i] + P[LM.hipR].y[i]);
    torsoPx.push(Math.hypot(sx - hx, sy - hy));
    shW.push(Math.abs(P[LM.shL].x[i] - P[LM.shR].x[i])); hipW.push(Math.abs(P[LM.hipL].x[i] - P[LM.hipR].x[i]));
  }
  const leg = quantile(legPx, 0.8), torso = median(torsoPx);
  const htM = o.ht / 100;
  // stature in pixels: eye height is 0.936 of stature (Drillis & Contini); the tallest postures
  // (mid-stance, straight leg) are the 90th percentile. Leg length (0.491 of stature) is the fallback.
  const eyeH = [];
  for (let i = 0; i < n; i++) {
    const ey = 0.5 * (P[LM.eyeL].y[i] + P[LM.eyeR].y[i]), hy = Math.max(P[LM.heelL].y[i], P[LM.heelR].y[i]);
    if (ok(ey) && ok(hy)) eyeH.push((hy - ey) / 0.936);
  }
  const statEye = quantile(eyeH, 0.9), statLeg = leg / 0.491;
  const stat = ok(statEye) && Math.abs(statEye / statLeg - 1) < 0.2 ? statEye : statLeg;
  R.pxPerM = stat / htM;
  R.sizeFrac = stat / H; // body height as a fraction of frame height
  const widthRatio = median(shW.map((s, i) => (s + hipW[i]) / 2 / (torsoPx[i] || 1)));
  R.widthRatio = widthRatio;
  let view = o.view && o.view !== "auto" ? o.view : widthRatio < 0.42 ? "side" : "front";
  R.view = view;
  R.oblique = widthRatio > 0.32 && widthRatio < 0.55;
  const norm0 = normFor(o);

  if (view === "side") sideAnalysis(R, P, t, fps, o, leg, torso);
  else frontAnalysis(R, P, t, fps, o, leg, torso);
  if (!R.ok) return R;

  // personalised normal pattern at the measured speed
  const nv = normFor(o, R.st.speed);
  R.norm = { curves: nv.curves, sf: nv.sf, band: BAND, cadence: nv.m.cadence, speed: speedNorm(o.age, o.sex), stepLenH: 0.41 * (o.sex === "F" ? 0.98 : 1), bmi: norm0.m.bmi, varusIC: curves(norm0.m).R.varus[0], irMax: Math.max(...curves(norm0.m).R.ir) };
  if (R.view === "side") R.norm.feat = features(nv.curves, nv.sf);
  assess(R, o);
  return R;
}

// ---------------------------------------------------------------- side view
function sideAnalysis(R, P, t, fps, o, leg, torso) {
  const n = t.length, Lc = [LM.hipL, LM.kneeL, LM.ankL, LM.heelL, LM.toeL], Rc = [LM.hipR, LM.kneeR, LM.ankR, LM.heelR, LM.toeR];
  // facing direction per frame: feet point forward, nose is ahead of the ears
  const dir0 = nanArr(n);
  for (let i = 0; i < n; i++) {
    if (!ok(P[LM.heelL].x[i])) continue;
    const fd = P[LM.toeL].x[i] - P[LM.heelL].x[i] + P[LM.toeR].x[i] - P[LM.heelR].x[i];
    const nd = P[LM.nose].x[i] - 0.5 * (P[LM.earL].x[i] + P[LM.earR].x[i]);
    dir0[i] = fd + 2 * (ok(nd) ? nd : 0);
  }
  const dirS = medianFilter(dir0, Math.round(fps * 0.6) | 1);
  const dir = Array.from(dirS, (v) => (ok(v) ? (v >= 0 ? 1 : -1) : 0));
  // passes = runs of constant facing direction, short flips merged away
  let passes = [];
  for (let i = 0; i < n;) {
    if (!dir[i]) { i++; continue; }
    let j = i;
    while (j < n && dir[j] === dir[i]) j++;
    passes.push({ a: i, b: j, dir: dir[i] });
    i = j;
  }
  passes = passes.filter((p) => p.b - p.a >= fps * 1.0);
  if (!passes.length) { R.error = "หาทิศทางการเดินไม่ได้ ลองถ่ายจากด้านข้างให้เห็นเท้าชัดเจน"; return; }

  // ---- left/right identity
  // MediaPipe labels anatomical sides from appearance; near the leg crossings single joints can flip.
  // (1) whole-pass check with depth: walking to the right in the image shows the right side to the camera.
  // (2) per-joint 2-state Viterbi (knee, ankle, heel, toe in that order) on trajectory smoothness,
  //     bone-length consistency with the already-fixed parent joint and a weak depth cue.
  // (3) spikes against a running median are dropped and re-interpolated.
  const C = { L: {}, R: {} };
  for (const sd of ["L", "R"]) for (const [k, id] of [["hip", 0], ["knee", 1], ["ank", 2], ["heel", 3], ["toe", 4]]) {
    const src = P[(sd === "L" ? Lc : Rc)[id]];
    C[sd][k] = { x: Float64Array.from(src.x), y: Float64Array.from(src.y), z: Float64Array.from(src.z), v: Float64Array.from(src.v) };
  }
  const swapPair = (k, i) => { for (const f of ["x", "y", "z", "v"]) { const t = C.L[k][f][i]; C.L[k][f][i] = C.R[k][f][i]; C.R[k][f][i] = t; } };
  let swapped = 0;
  for (const ps of passes) {
    const nearR = ps.dir > 0;
    let agree = 0, cnt = 0;
    for (let i = ps.a; i < ps.b; i++) {
      let zl = 0, zr = 0;
      for (const k of ["knee", "ank", "heel", "toe"]) { zl += C.L[k].z[i]; zr += C.R[k].z[i]; }
      if (ok(zl) && ok(zr)) { cnt++; if ((zr < zl) === nearR) agree++; }
    }
    ps.depthAgree = cnt ? agree / cnt : 1;
    if (cnt && agree / cnt < 0.3) for (let i = ps.a; i < ps.b; i++) for (const k of ["hip", "knee", "ank", "heel", "toe"]) swapPair(k, i);
  }
  // two-target tracking of the distal leg chains (knee, ankle, heel, toe) in pelvis-relative coordinates:
  // an alpha-beta filter predicts each leg, MediaPipe's two chains are assigned to the closer prediction
  // (fixes stretches where the labels flip), and frames where neither assignment fits (both legs merged
  // during the crossing) are dropped and re-interpolated.
  const DIST = ["knee", "ank", "heel", "toe"], gate = (leg * 0.14) ** 2 * DIST.length;
  const dropped = new Uint8Array(n);
  const meas = (sd, i) => {
    const hx = 0.5 * (C.L.hip.x[i] + C.R.hip.x[i]), hy = 0.5 * (C.L.hip.y[i] + C.R.hip.y[i]), out = [];
    for (const k of DIST) out.push(C[sd][k].x[i] - hx, C[sd][k].y[i] - hy);
    return out;
  };
  const d2 = (u, v) => { let s2 = 0; for (let j = 0; j < u.length; j++) { const e = u[j] - v[j]; s2 += ok(e) ? e * e : 0; } return s2; };
  // one tracking pass over frames in the given order; returns per-frame swap flag (relative to the
  // MediaPipe labels), drop flag and "age" = frames of continuous tracking evidence behind the decision
  const runTrack = (order) => {
    const sw = new Uint8Array(n), drop = new Uint8Array(n), age = new Float64Array(n);
    let T = null, coast = 0, run = 0;
    for (const i of order) {
      const mL = meas("L", i), mR = meas("R", i);
      if (!mL.every(ok) || !mR.every(ok)) continue;
      if (!T || coast > 8) {
        // (re)start from MediaPipe's own labels
        T = { L: { p: mL, v: mL.map(() => 0) }, R: { p: mR, v: mR.map(() => 0) } };
        sw[i] = 0; coast = 0; run = 0; age[i] = 0;
        continue;
      }
      const pL = T.L.p.map((x, j) => x + T.L.v[j]), pR = T.R.p.map((x, j) => x + T.R.v[j]);
      const keep = d2(mL, pL) + d2(mR, pR), swp = d2(mR, pL) + d2(mL, pR);
      // right after a (re)start there is no velocity yet, so only overwhelming evidence may flip labels
      const s1 = swp < keep * (run < 5 ? 0.25 : 0.8);
      if (Math.min(keep, swp) > 2 * gate) {
        drop[i] = 1; coast++; age[i] = run;
        T.L.p = pL; T.R.p = pR; T.L.v = T.L.v.map((v) => v * 0.93); T.R.v = T.R.v.map((v) => v * 0.93);
        continue;
      }
      sw[i] = s1 ? 1 : 0;
      const nL = s1 ? mR : mL, nR = s1 ? mL : mR;
      for (const [tr, m, pr] of [[T.L, nL, pL], [T.R, nR, pR]]) for (let j = 0; j < m.length; j++) { const r = m[j] - pr[j]; tr.p[j] = pr[j] + 0.65 * r; tr.v[j] = tr.v[j] + 0.35 * r; }
      coast = 0; run++; age[i] = run;
    }
    return { sw, drop, age };
  };
  for (const ps of passes) {
    const { a, b } = ps;
    if (b - a < 4) continue;
    const order = [];
    for (let i = a; i < b; i++) order.push(i);
    const src = runTrack(order);
    for (let i = a; i < b; i++) {
      if (src.drop[i]) dropped[i] = 1;
      if (src.sw[i]) { for (const k of ["hip", ...DIST]) swapPair(k, i); swapped++; }
    }
  }
  for (let i = 0; i < n; i++) if (dropped[i]) for (const sd of ["L", "R"]) for (const k of DIST) { C[sd][k].x[i] = NaN; C[sd][k].y[i] = NaN; }
  for (const sd of ["L", "R"]) for (const k of DIST) { fillGaps(C[sd][k].x, 10); fillGaps(C[sd][k].y, 10); }
  R.dropFrac = dropped.reduce((s2, v) => s2 + v, 0) / n;
  R.swapFrac = swapped / n;
  if (o.swapLR) for (let i = 0; i < n; i++) for (const k of ["hip", "knee", "ank", "heel", "toe"]) swapPair(k, i);
  // spike removal against a 7-frame running median, then gap fill
  const spike = leg * 0.15;
  for (const sd of ["L", "R"]) for (const k of ["knee", "ank", "heel", "toe"]) {
    const c = C[sd][k], mx = medianFilter(c.x, 9), my = medianFilter(c.y, 9);
    for (let i = 0; i < n; i++) if (Math.hypot(c.x[i] - mx[i], c.y[i] - my[i]) > spike) { c.x[i] = NaN; c.y[i] = NaN; }
    fillGaps(c.x, 6); fillGaps(c.y, 6);
  }
  // corrected + smoothed landmark tracks (pixel space)
  const fc = 6;
  const S = {};
  const legKey = { [LM.hipL]: ["L", "hip"], [LM.hipR]: ["R", "hip"], [LM.kneeL]: ["L", "knee"], [LM.kneeR]: ["R", "knee"], [LM.ankL]: ["L", "ank"], [LM.ankR]: ["R", "ank"], [LM.heelL]: ["L", "heel"], [LM.heelR]: ["R", "heel"], [LM.toeL]: ["L", "toe"], [LM.toeR]: ["R", "toe"] };
  for (const id of Object.values(LM)) {
    const lk = legKey[id], src = lk ? C[lk[0]][lk[1]] : P[id];
    S[id] = { x: lowpass(src.x, fc, fps), y: lowpass(src.y, fc, fps) };
  }
  R.track = S;

  // camera roll: stance heels lie on the floor line when the camera is static
  const hipMid = (i) => [0.5 * (S[LM.hipL].x[i] + S[LM.hipR].x[i]), 0.5 * (S[LM.hipL].y[i] + S[LM.hipR].y[i])];
  let roll = 0;
  {
    const xs = [], ys = [];
    for (const ps of passes) {
      const h0 = hipMid(ps.a), h1 = hipMid(ps.b - 1);
      if (Math.abs(h1[0] - h0[0]) < leg * 1.2) continue; // camera follows the walker: no floor reference
      for (let i = ps.a; i < ps.b; i++) for (const id of [LM.heelL, LM.heelR]) { xs.push(S[id].x[i]); ys.push(S[id].y[i]); }
    }
    if (xs.length > fps) {
      // lower envelope: fit a line through the lowest heel points (largest y) in x bins
      const lo = Math.min(...xs), hi = Math.max(...xs), nb = 8, bx = [], by = [];
      for (let k = 0; k < nb; k++) {
        let best = -Infinity, bxx = 0;
        for (let i = 0; i < xs.length; i++) if (xs[i] >= lo + ((hi - lo) * k) / nb && xs[i] < lo + ((hi - lo) * (k + 1)) / nb && ys[i] > best) { best = ys[i]; bxx = xs[i]; }
        if (best > -Infinity) { bx.push(bxx); by.push(best); }
      }
      if (bx.length >= 4) {
        const mx = mean(bx), my = mean(by);
        let sxy = 0, sxx = 0;
        for (let k = 0; k < bx.length; k++) { sxy += (bx[k] - mx) * (by[k] - my); sxx += (bx[k] - mx) ** 2; }
        roll = clamp(Math.atan(sxy / sxx) * D, -8, 8);
      }
    }
  }
  R.roll = roll;
  const cr = Math.cos(roll / D), sr = Math.sin(roll / D);
  // per-frame forward/up coordinates (X forward along the walk, Y up), roll-corrected
  const XY = (id, i, d) => { const x = S[id].x[i], y = S[id].y[i], xr = cr * x + sr * y, yr = -sr * x + cr * y; return [d * xr, -yr]; };

  const ser = { hip: { L: nanArr(n), R: nanArr(n) }, knee: { L: nanArr(n), R: nanArr(n) }, ank: { L: nanArr(n), R: nanArr(n) }, foot: { L: nanArr(n), R: nanArr(n) }, arm: { L: nanArr(n), R: nanArr(n) }, trunk: nanArr(n), pelY: nanArr(n), heelRel: { L: nanArr(n), R: nanArr(n) }, toeRel: { L: nanArr(n), R: nanArr(n) }, heelX: { L: nanArr(n), R: nanArr(n) }, toeX: { L: nanArr(n), R: nanArr(n) } };
  const passOf = new Int16Array(n).fill(-1);
  passes.forEach((ps, k) => { for (let i = ps.a; i < ps.b; i++) passOf[i] = k; });
  for (let i = 0; i < n; i++) {
    const k = passOf[i];
    if (k < 0 || !ok(S[LM.hipL].x[i])) continue;
    const d = passes[k].dir;
    const p = (id) => XY(id, i, d);
    const sh = [0.5 * (p(LM.shL)[0] + p(LM.shR)[0]), 0.5 * (p(LM.shL)[1] + p(LM.shR)[1])];
    const hp = [0.5 * (p(LM.hipL)[0] + p(LM.hipR)[0]), 0.5 * (p(LM.hipL)[1] + p(LM.hipR)[1])];
    const T = [sh[0] - hp[0], sh[1] - hp[1]];
    ser.trunk[i] = Math.atan2(T[0], T[1]) * D;
    ser.pelY[i] = hp[1];
    for (const sd of ["L", "R"]) {
      const c = sd === "L" ? Lc : Rc, [h, kn, an, he, to] = c.map(p);
      const th = [kn[0] - h[0], kn[1] - h[1]], sk = [an[0] - kn[0], an[1] - kn[1]], ft = [to[0] - he[0], to[1] - he[1]];
      ser.hip[sd][i] = ang(0, -1, th[0], th[1]);               // thigh vs vertical, + = flexion (forward)
      ser.knee[sd][i] = -ang(th[0], th[1], sk[0], sk[1]);       // + = flexion
      ser.ank[sd][i] = ang(sk[0], sk[1], ft[0], ft[1]) - 90;    // + = dorsiflexion
      ser.foot[sd][i] = Math.atan2(ft[1], ft[0]) * D;           // foot vs floor, + = toes up
      const shp = p(sd === "L" ? LM.shL : LM.shR), el = p(sd === "L" ? LM.elL : LM.elR);
      ser.arm[sd][i] = ang(-T[0], -T[1], el[0] - shp[0], el[1] - shp[1]);
      ser.heelRel[sd][i] = he[0] - hp[0];
      ser.toeRel[sd][i] = to[0] - hp[0];
      ser.heelX[sd][i] = he[0];
      ser.toeX[sd][i] = to[0];
    }
  }
  R.ser = ser; R.passes = passes; R.passOf = passOf;

  // ---- events (Zeni): IC = heel most anterior to the pelvis, TO = toe most posterior
  const ev = { L: { ic: [], to: [] }, R: { ic: [], to: [] } };
  // stride period from the autocorrelation of the heel signals (keeps spurious extra peaks out)
  let period = NaN;
  {
    let best = -Infinity;
    for (let lag = Math.round(0.7 * fps); lag <= Math.round(1.8 * fps); lag++) {
      let sxy = 0, cnt = 0;
      for (const sd of ["L", "R"]) { const h = ser.heelRel[sd], m0 = mean(h); for (let i = 0; i + lag < n; i++) if (ok(h[i]) && ok(h[i + lag])) { sxy += (h[i] - m0) * (h[i + lag] - m0); cnt++; } }
      const r = cnt > fps ? sxy / cnt : -Infinity;
      if (r > best) { best = r; period = lag; }
    }
  }
  R.period = period / fps;
  const minD = Math.round(ok(period) ? 0.65 * period : fps * 0.45), prom = leg * 0.25, wn = Math.round(ok(period) ? 0.6 * period : fps * 0.6);
  for (const ps of passes) for (const sd of ["L", "R"]) {
    const hr = ser.heelRel[sd], tr = ser.toeRel[sd], neg = Float64Array.from(tr, (v) => -v);
    const edge = 2;
    for (const i of peaks(hr, ps.a, ps.b, minD, prom, wn)) if (i > ps.a + edge && i < ps.b - 1 - edge) ev[sd].ic.push(subframe(hr, i));
    for (const i of peaks(neg, ps.a, ps.b, minD, prom, wn)) if (i > ps.a + edge && i < ps.b - 1 - edge) ev[sd].to.push(subframe(neg, i));
  }
  R.events = { L: { ic: ev.L.ic.map((i) => i / fps + t[0]), to: ev.L.to.map((i) => i / fps + t[0]) }, R: { ic: ev.R.ic.map((i) => i / fps + t[0]), to: ev.R.to.map((i) => i / fps + t[0]) } };
  R.evIdx = ev;

  // ---- cycles
  const cyc = { L: [], R: [] };
  for (const sd of ["L", "R"]) {
    const ic = ev[sd].ic, to = ev[sd].to;
    for (let k = 0; k + 1 < ic.length; k++) {
      const i0 = ic[k], i1 = ic[k + 1];
      if (passOf[Math.round(i0)] !== passOf[Math.round(i1)]) continue;
      const dur = (i1 - i0) / fps;
      if (dur < 0.6 || dur > 2.2) continue;
      const tos = to.filter((x) => x > i0 && x < i1);
      if (tos.length !== 1) continue;
      const sf = (tos[0] - i0) / (i1 - i0);
      if (sf < 0.45 || sf > 0.82) continue;
      cyc[sd].push({ i0, i1, ito: tos[0], dur, sf, pass: passOf[Math.round(i0)] });
    }
    const md = median(cyc[sd].map((c) => c.dur));
    cyc[sd] = cyc[sd].filter((c) => Math.abs(c.dur - md) < 0.3 * md);
  }
  if (cyc.L.length + cyc.R.length < 2 || (!cyc.L.length && !cyc.R.length)) {
    R.error = "หารอบการเดินที่สมบูรณ์ไม่พอ: ควรเห็นการเดินต่อเนื่องอย่างน้อย 3–4 ก้าว จากด้านข้าง เห็นเท้าชัดเจน";
    return;
  }
  // foot-flat calibration: in mid-stance the sole is flat on the floor, so the median heel->toe angle
  // there is landmark bias (shoe shape, heel point placement); bounded so toe-walking is not hidden
  const footBias = { L: 0, R: 0 };
  for (const sd of ["L", "R"]) {
    const fl = [];
    for (const c of cyc[sd]) for (let i = Math.ceil(c.i0 + 0.2 * (c.ito - c.i0)); i <= Math.floor(c.i0 + 0.55 * (c.ito - c.i0)); i++) fl.push(ser.foot[sd][i]);
    const b = median(fl);
    footBias[sd] = ok(b) && Math.abs(b) > 2 ? clamp(b, -12, 12) : 0;
    for (let i = 0; i < n; i++) ser.foot[sd][i] -= footBias[sd];
  }
  R.footBias = footBias;
  for (const sd of ["L", "R"]) for (const c of cyc[sd]) {
    c.curves = { hip: cycleCurve(ser.hip[sd], c.i0, c.i1), knee: cycleCurve(ser.knee[sd], c.i0, c.i1), ank: cycleCurve(ser.ank[sd], c.i0, c.i1), arm: cycleCurve(ser.arm[sd], c.i0, c.i1), trunk: cycleCurve(ser.trunk, c.i0, c.i1) };
    c.footIC = ser.foot[sd][Math.round(c.i0)];
    c.feat = features(c.curves, c.sf);
    // which leg faced the camera in this pass (walking right shows the right side)
    c.near = (passes[c.pass].dir > 0) === (sd === "R");
  }
  R.cycles = cyc;
  const mc = {};
  for (const sd of ["L", "R"]) {
    if (!cyc[sd].length) { mc[sd] = null; continue; }
    // joint angles from the side facing the camera when available; the far leg is partly hidden
    const nearC = cyc[sd].filter((c) => c.near), use = nearC.length ? nearC : cyc[sd];
    const g = (k) => meanCurve(use.map((c) => c.curves[k]));
    const hip = g("hip"), knee = g("knee"), ank = g("ank"), arm = g("arm");
    const sf = mean(cyc[sd].map((c) => c.sf));
    mc[sd] = { hip: hip.m, knee: knee.m, ank: ank.m, arm: arm.m, sd: { hip: hip.sd, knee: knee.sd, ank: ank.sd }, sf, n: cyc[sd].length, nAng: use.length, near: nearC.length > 0, dur: mean(cyc[sd].map((c) => c.dur)) };
    // per-cycle features, then the median: averaging curves first would smear peaks that shift in time
    mc[sd].feat = Object.fromEntries(Object.keys(use[0].feat).map((k) => [k, median(use.map((c) => c.feat[k]))]));
    mc[sd].footIC = median(use.map((c) => c.footIC));
    mc[sd].armROM = nearC.length ? median(nearC.map((c) => Math.max(...c.curves.arm) - Math.min(...c.curves.arm))) : NaN;
  }
  // a side seen in no complete cycle borrows the other one (flagged as missing)
  R.missing = ["L", "R"].filter((sd) => !mc[sd]);
  for (const sd of R.missing) mc[sd] = { ...mc[sd === "L" ? "R" : "L"], borrowed: true, near: false };
  R.mean = mc;
  R.farOnly = ["L", "R"].filter((sd) => !mc[sd].near && !mc[sd].borrowed);

  // ---- spatiotemporal
  const k = R.pxPerM, st = {};
  st.strideT = mean([...cyc.L, ...cyc.R].map((c) => c.dur));
  st.cadence = 120 / st.strideT;
  // stride-time variability: robust (MAD) per leg, averaged
  const rcv = (a) => { if (a.length < 3) return NaN; const md = median(a); return ((1.4826 * median(a.map((x) => Math.abs(x - md)))) / md) * 100; };
  st.cv = mean([rcv(cyc.L.map((c) => c.dur)), rcv(cyc.R.map((c) => c.dur))]);
  st.stance = { L: mc.L.sf * 100, R: mc.R.sf * 100 };
  const stepT = { L: [], R: [] }, stepL = { L: [], R: [] }, ds = [];
  // heel-to-toe length of each foot while flat (pixels): the trailing foot pivots on its toes at the
  // other foot's heel strike, so heel(lead) - toe(trail) + foot length = heel-to-heel step length
  const footPx = {};
  for (const sd of ["L", "R"]) {
    const fl = [];
    for (const c of cyc[sd]) for (let i = Math.ceil(c.i0 + 0.2 * (c.ito - c.i0)); i <= Math.floor(c.i0 + 0.55 * (c.ito - c.i0)); i++) fl.push(ser.toeX[sd][i] - ser.heelX[sd][i]);
    footPx[sd] = median(fl);
  }
  for (const sd of ["L", "R"]) if (!ok(footPx[sd])) footPx[sd] = ok(footPx[sd === "L" ? "R" : "L"]) ? footPx[sd === "L" ? "R" : "L"] : 0.15 * leg / 0.491;
  // static camera: the stance heel stays put in the image while the pelvis travels across it
  const hv = [], fv = [];
  for (const sd of ["L", "R"]) for (const c of cyc[sd]) {
    const i0 = Math.ceil(c.i0 + 0.2 * (c.ito - c.i0)), i1 = Math.floor(c.i0 + 0.55 * (c.ito - c.i0));
    if (i1 - i0 < 2) continue;
    const hp = (i) => 0.5 * (S[LM.hipL].x[i] + S[LM.hipR].x[i]);
    hv.push(Math.abs(hp(i1) - hp(i0)) / (i1 - i0)); fv.push(Math.abs(ser.heelX[sd][i1] - ser.heelX[sd][i0]) / (i1 - i0));
  }
  const staticCam = median(hv) > 0.004 * leg * 30 / fps && median(fv) < 0.45 * median(hv);
  R.staticCam = staticCam;
  for (const sd of ["L", "R"]) {
    const os = sd === "L" ? "R" : "L";
    for (const i of ev[sd].ic) {
      const prev = ev[os].ic.filter((x) => x < i && passOf[Math.round(x)] === passOf[Math.round(i)]).pop();
      if (prev !== undefined) { const dt = (i - prev) / fps; if (dt > 0.25 && dt < 1.1) stepT[sd].push(dt); }
      const ii = Math.round(i);
      let d = ser.heelX[sd][ii] - ser.toeX[os][ii] + footPx[os];
      if (staticCam && prev !== undefined) d = ser.heelX[sd][ii] - ser.heelX[os][Math.round(prev)];
      if (ok(d) && d > 0) stepL[sd].push(d / k);
    }
  }
  for (const sd of ["L", "R"]) for (const c of cyc[sd]) {
    const os = sd === "L" ? "R" : "L";
    const toO = ev[os].to.find((x) => x > c.i0 && x < c.ito), icO = ev[os].ic.find((x) => x > c.i0 && x < c.ito);
    if (toO !== undefined && icO !== undefined) ds.push(((toO - c.i0) + (c.ito - icO)) / (c.i1 - c.i0) * 100);
  }
  st.stepT = { L: median(stepT.L), R: median(stepT.R) };
  st.stepLen = { L: median(stepL.L), R: median(stepL.R) };
  for (const sd of ["L", "R"]) if (!ok(st.stepLen[sd])) st.stepLen[sd] = st.stepLen[sd === "L" ? "R" : "L"];
  // per-step values that scatter a lot (event timing, foot sliding) are not used for symmetry
  const cvOf = (a) => (a.length >= 2 ? stdev(a) / mean(a) : 0);
  st.stepConsistent = cvOf(stepL.L) < 0.25 && cvOf(stepL.R) < 0.25;
  st.strideLen = st.stepLen.L + st.stepLen.R;
  st.speed = st.strideLen / st.strideT;
  if (staticCam) {
    // with a fixed camera the pelvis' travel across the image is the most direct speed measure
    const rates = [];
    for (const ps of passes) {
      const xs = [], ts = [];
      for (let i = ps.a; i < ps.b; i++) { const x = 0.5 * (S[LM.hipL].x[i] + S[LM.hipR].x[i]); if (ok(x)) { xs.push(x); ts.push(i / fps); } }
      if (xs.length < fps) continue;
      const mx = mean(xs), mt = mean(ts);
      let sxy = 0, sxx = 0;
      for (let j = 0; j < xs.length; j++) { sxy += (ts[j] - mt) * (xs[j] - mx); sxx += (ts[j] - mt) ** 2; }
      rates.push(Math.abs(sxy / sxx));
    }
    const v = median(rates) / k;
    if (ok(v) && v > 0.2 && v < 2.5) { st.speed = v; st.strideLen = v * st.strideT; if (!st.stepConsistent) st.stepLen = { L: st.strideLen / 2, R: st.strideLen / 2 }; }
  }
  st.ds = mean(ds);
  st.stepLenH = (0.5 * st.strideLen) / (o.ht / 100);
  // vertical pelvis excursion per stride (cm)
  const ex = [];
  for (const c of [...cyc.L, ...cyc.R]) { const s = cycleCurve(ser.pelY, c.i0, c.i1).filter(ok); if (s.length) ex.push(((Math.max(...s) - Math.min(...s)) / k) * 100); }
  st.vert = median(ex);
  st.trunk = median(Array.from(ser.trunk).filter((_, i) => passOf[i] >= 0));
  st.armROM = { L: mc.L.armROM, R: mc.R.armROM };
  // phase offset of the left leg relative to the right (for the 3D replay)
  const offs = [];
  for (const c of cyc.R) { const l = ev.L.ic.find((x) => x > c.i0 && x < c.i1); if (l !== undefined) offs.push((l - c.i0) / (c.i1 - c.i0)); }
  st.offL = offs.length ? clamp(1 - median(offs), 0.35, 0.65) : 0.5;
  R.st = st;
  R.sym = { stance: SI(st.stance.L, st.stance.R), stepT: SI(st.stepT.L, st.stepT.R), stepLen: st.stepConsistent ? SI(st.stepLen.L, st.stepLen.R) : NaN, kneeSw: SI(mc.L.feat.kneeSw, mc.R.feat.kneeSw), arm: SI(st.armROM.L, st.armROM.R) };

  // reliability
  const vis = mean([LM.kneeL, LM.kneeR, LM.ankL, LM.ankR, LM.heelL, LM.heelR, LM.toeL, LM.toeR].map((id) => mean(P[id].v)));
  R.vis = vis;
  R.ok = true;
}

// ---------------------------------------------------------------- front / back view
function frontAnalysis(R, P, t, fps, o, leg, torso) {
  const n = t.length, S = {};
  for (const id of Object.values(LM)) S[id] = { x: lowpass(P[id].x, 6, fps), y: lowpass(P[id].y, 6, fps) };
  R.track = S;
  // toward the camera: the face is visible (nose ahead of ears in depth)
  const zNose = mean(P[LM.nose].z), zEar = mean([...P[LM.earL].z, ...P[LM.earR].z]);
  R.toward = zNose < zEar;
  const ser = { fppa: { L: nanArr(n), R: nanArr(n) }, ext: { L: nanArr(n), R: nanArr(n) }, pelvis: nanArr(n), trunkLat: nanArr(n), width: nanArr(n), scale: nanArr(n) };
  for (let i = 0; i < n; i++) {
    if (!ok(S[LM.hipL].x[i])) continue;
    const g = (id) => [S[id].x[i], S[id].y[i]];
    const hL = g(LM.hipL), hR = g(LM.hipR), sL = g(LM.shL), sR = g(LM.shR);
    const legPx = 0.5 * (Math.hypot(hL[0] - g(LM.kneeL)[0], hL[1] - g(LM.kneeL)[1]) + Math.hypot(g(LM.kneeL)[0] - g(LM.ankL)[0], g(LM.kneeL)[1] - g(LM.ankL)[1]) + Math.hypot(hR[0] - g(LM.kneeR)[0], hR[1] - g(LM.kneeR)[1]) + Math.hypot(g(LM.kneeR)[0] - g(LM.ankR)[0], g(LM.kneeR)[1] - g(LM.ankR)[1]));
    const sc = Math.hypot(0.5 * (sL[0] + sR[0]) - 0.5 * (hL[0] + hR[0]), 0.5 * (sL[1] + sR[1]) - 0.5 * (hL[1] + hR[1]));
    ser.scale[i] = legPx;
    // image-right of the subject: left side when facing the camera
    const lat = (hL[0] - hR[0]) >= 0 ? 1 : -1; // +1 if the left hip is on the image right (subject faces camera)
    for (const sd of ["L", "R"]) {
      const h = sd === "L" ? hL : hR, kn = g(sd === "L" ? LM.kneeL : LM.kneeR), an = g(sd === "L" ? LM.ankL : LM.ankR);
      // FPPA: + = valgus (knee medial to the hip-ankle line), - = varus
      const side = (sd === "L" ? 1 : -1) * lat; // direction pointing laterally for this leg in the image
      const a = ang(kn[0] - h[0], kn[1] - h[1], an[0] - kn[0], an[1] - kn[1]);
      ser.fppa[sd][i] = -a * side * -1;
      ser.ext[sd][i] = (an[1] - 0.5 * (hL[1] + hR[1])) / sc;
    }
    ser.pelvis[i] = Math.atan2(hL[1] - hR[1], Math.abs(hL[0] - hR[0])) * D; // + = left hip lower in the image
    ser.trunkLat[i] = Math.atan2(0.5 * (sL[0] + sR[0]) - 0.5 * (hL[0] + hR[0]), -(0.5 * (sL[1] + sR[1]) - 0.5 * (hL[1] + hR[1]))) * D * lat;
    ser.width[i] = Math.abs(g(LM.ankL)[0] - g(LM.ankR)[0]) / legPx * (0.491 * o.ht / 100);
  }
  R.ser = ser;
  // stance = planted foot: with a fixed camera the stance foot stays still in the image while the
  // swing foot travels; speed is normalised by the apparent leg length (which grows as they approach)
  const ev = { L: { ic: [], to: [] }, R: { ic: [], to: [] } }, stance = { L: new Uint8Array(n), R: new Uint8Array(n) };
  const speeds = {};
  for (const sd of ["L", "R"]) {
    const A = sd === "L" ? LM.ankL : LM.ankR, Hh = sd === "L" ? LM.heelL : LM.heelR, sp = nanArr(n);
    for (let i = 1; i < n - 1; i++) {
      const dx = 0.5 * (S[A].x[i + 1] - S[A].x[i - 1] + S[Hh].x[i + 1] - S[Hh].x[i - 1]) / 2, dy = 0.5 * (S[A].y[i + 1] - S[A].y[i - 1] + S[Hh].y[i + 1] - S[Hh].y[i - 1]) / 2;
      sp[i] = (Math.hypot(dx, dy) / ser.scale[i]) * fps;
    }
    speeds[sd] = lowpass(sp, 5, fps);
  }
  // stride period from the autocorrelation of both feet's speed (robust to missed or doubled events)
  let period = NaN;
  {
    let best = -Infinity;
    for (let lag = Math.round(0.7 * fps); lag <= Math.round(1.9 * fps); lag++) {
      let sxy = 0, cnt = 0;
      for (const sd of ["L", "R"]) { const h = speeds[sd], m0 = mean(h); for (let i = 0; i + lag < n; i++) if (ok(h[i]) && ok(h[i + lag])) { sxy += (h[i] - m0) * (h[i + lag] - m0); cnt++; } }
      const r = cnt > fps ? sxy / cnt : -Infinity;
      if (r > best) { best = r; period = lag; }
    }
  }
  R.period = period / fps;
  for (const sd of ["L", "R"]) {
    const sp = speeds[sd];
    const v = sp, lo = quantile(v, 0.15), hi = quantile(v, 0.85), on = lo + 0.3 * (hi - lo), off = lo + 0.5 * (hi - lo);
    const gapMin = ok(period) ? 0.3 * period : fps * 0.25;
    let s0 = ok(v[1]) && v[1] < on ? 1 : 0, last = -99, lastIc = -99;
    for (let i = 2; i < n; i++) {
      if (!ok(v[i])) continue;
      if (!s0 && v[i] < on && i - last > gapMin && i - lastIc > 0.6 * (ok(period) ? period : fps)) { s0 = 1; ev[sd].ic.push(i); last = i; lastIc = i; }
      else if (s0 && v[i] > off && i - last > gapMin) { s0 = 0; ev[sd].to.push(i); last = i; }
      stance[sd][i] = s0;
    }
  }
  R.events = { L: { ic: ev.L.ic.map((i) => t[i]), to: ev.L.to.map((i) => t[i]) }, R: { ic: ev.R.ic.map((i) => t[i]), to: ev.R.to.map((i) => t[i]) } };
  R.evIdx = ev;
  const cyc = { L: [], R: [] };
  for (const sd of ["L", "R"]) {
    const ic = ev[sd].ic;
    for (let k = 0; k + 1 < ic.length; k++) {
      const dur = (ic[k + 1] - ic[k]) / fps;
      const tos = ev[sd].to.filter((x) => x > ic[k] && x < ic[k + 1]);
      if (dur < 0.6 || dur > 2.2 || tos.length !== 1) continue;
      const sf = (tos[0] - ic[k]) / (ic[k + 1] - ic[k]);
      if (sf < 0.4 || sf > 0.85) continue;
      const mid = Math.round(ic[k] + 0.3 * (tos[0] - ic[k]) / 0.6 * 0.6 + 0.2 * (tos[0] - ic[k]));
      const stIdx = []; for (let i = Math.round(ic[k] + 0.2 * (tos[0] - ic[k])); i <= Math.round(ic[k] + 0.7 * (tos[0] - ic[k])); i++) stIdx.push(i);
      cyc[sd].push({ i0: ic[k], i1: ic[k + 1], ito: tos[0], dur, sf, mid, fppa: mean(stIdx.map((i) => ser.fppa[sd][i])), fppaPk: Math.max(...stIdx.map((i) => ser.fppa[sd][i]).filter(ok)), fppaMin: Math.min(...stIdx.map((i) => ser.fppa[sd][i]).filter(ok)), pelvis: stIdx.map((i) => ser.pelvis[i]), trunk: stIdx.map((i) => ser.trunkLat[i]) });
    }
  }
  if (cyc.L.length + cyc.R.length < 2) { R.error = "หารอบการเดินจากมุมหน้าไม่พอ ควรเดินเข้าหากล้องอย่างน้อย 4–6 ก้าว เห็นทั้งตัว"; return; }
  R.cycles = cyc;
  const st = {};
  const all = [...cyc.L, ...cyc.R];
  st.strideT = ok(R.period) ? R.period : mean(all.map((c) => c.dur)); st.cadence = 120 / st.strideT;
  st.cv = (stdev(all.map((c) => c.dur)) / st.strideT) * 100;
  st.stance = { L: mean(cyc.L.map((c) => c.sf)) * 100, R: mean(cyc.R.map((c) => c.sf)) * 100 };
  const stepT = { L: [], R: [] };
  for (const sd of ["L", "R"]) { const os = sd === "L" ? "R" : "L"; for (const i of ev[sd].ic) { const p = ev[os].ic.filter((x) => x < i).pop(); if (p !== undefined && (i - p) / fps < 1.1) stepT[sd].push((i - p) / fps); } }
  st.stepT = { L: mean(stepT.L), R: mean(stepT.R) };
  // signed so that + = pelvis drops on the swing side during single support of the named leg
  const drop = { L: [], R: [] }, lean = { L: [], R: [] }, fppa = { L: [], R: [] };
  for (const sd of ["L", "R"]) for (const c of cyc[sd]) {
    const s = sd === "L" ? -1 : 1; // left stance: right hip should not drop (right hip lower = pelvis angle negative)
    drop[sd].push(Math.max(...c.pelvis.filter(ok).map((v) => v * s)) - Math.min(...c.pelvis.filter(ok).map((v) => v * s)) * 0);
    lean[sd].push(Math.max(...c.trunk.filter(ok).map((v) => v * -s)));
    fppa[sd].push(c.fppa);
  }
  st.pelvicDrop = { L: median(drop.L), R: median(drop.R) };
  st.trunkLat = { L: median(lean.L), R: median(lean.R) };
  st.fppa = { L: median(fppa.L), R: median(fppa.R) };
  // step width: ankle separation during double support (both feet down)
  const w = [];
  for (let i = 0; i < n; i++) if (stance.L[i] && stance.R[i]) w.push(ser.width[i]);
  st.stepWidth = median(w);
  st.speed = NaN; st.strideLen = NaN;
  R.st = st;
  R.sym = { stance: SI(st.stance.L, st.stance.R), stepT: SI(st.stepT.L, st.stepT.R) };
  R.vis = mean([LM.kneeL, LM.kneeR, LM.ankL, LM.ankR].map((id) => mean(P[id].v)));
  R.missing = ["L", "R"].filter((sd) => !cyc[sd].length);
  R.ok = true;
}

// ---------------------------------------------------------------- principles, findings, score
const STAT = { ok: 1, warn: 0.5, bad: 0 };
function assess(R, o) {
  const items = [], issues = R.issues, st = R.st, N = R.norm;
  const fmt = (v, d = 0, u = "°") => (ok(v) ? v.toFixed(d) + u : "–");
  const sideTxt = (sd) => (sd === "L" ? "ขาซ้าย" : "ขาขวา");
  // reliability
  let rel = 100;
  if (R.detRate < 0.85) { rel -= 20; issues.push(`ตรวจเจอคนเพียง ${(R.detRate * 100).toFixed(0)}% ของเฟรม`); }
  const nc = R.cycles.L.length + R.cycles.R.length;
  if (nc < 4) { rel -= 25; issues.push(`ได้รอบการเดินที่สมบูรณ์ ${nc} รอบ (ควรมีอย่างน้อย 4 รอบ)`); }
  if (R.missing.length) { rel -= 15; issues.push(`ไม่มีรอบที่สมบูรณ์ของ${R.missing.map(sideTxt).join(" และ ")} จึงใช้ค่าของอีกข้างแทน`); }
  if (R.sizeFrac < 0.3) { rel -= 15; issues.push("คนในภาพเล็กเกินไป ควรถ่ายให้ตัวสูงอย่างน้อยครึ่งหนึ่งของภาพ"); }
  if (R.vis < 0.55) { rel -= 15; issues.push("มองเห็นขาและเท้าไม่ชัด (แสงน้อย ถูกบัง หรือกางเกงยาวคลุมข้อเท้า)"); }
  if (R.view === "side" && R.oblique) { rel -= 15; issues.push("กล้องไม่ได้ตั้งฉากกับทางเดิน (มุมเฉียง) มุมข้อต่อจะคลาดเคลื่อน"); }
  if (st.cv > 12 && Math.min(R.cycles.L.length, R.cycles.R.length) >= 4) { rel -= 10; issues.push("ระยะเวลาแต่ละก้าวต่างกันมาก อาจมีการหยุด เลี้ยว หรือจุดตรวจจับกระโดด"); }
  R.reliability = clamp(rel, 5, 100);

  const add = (id, w, title, value, normal, status, why = "", tip = "", side = null) => items.push({ id, w, title, value, normal, status, why, tip, side });
  const grade = (dev, warnAt, badAt) => (dev >= badAt ? "bad" : dev >= warnAt ? "warn" : "ok");

  if (R.view === "side") {
    const F = { L: R.mean.L.feat, R: R.mean.R.feat }, NF = N.feat;
    // joint angles are judged only on legs filmed from the near side (the far leg is partly hidden)
    const evalSides = ["L", "R"].filter((sd) => R.mean[sd].near && !R.mean[sd].borrowed);
    const SD = evalSides.length ? evalSides : ["L", "R"];
    const worst = (fn) => SD.map((sd) => ({ ...fn(sd), sd })).reduce((a, b) => (b.dev > a.dev ? b : a));
    const tag = (sd) => (SD.includes(sd) ? "" : " (ไม่ชัด)");
    const both = (k, d = 0) => `ซ้าย ${fmt(F.L[k], d)}${tag("L")} · ขวา ${fmt(F.R[k], d)}${tag("R")}`;
    for (const sd of ["L", "R"]) if (!SD.includes(sd)) issues.push(`${sideTxt(sd)}อยู่ฝั่งไกลกล้องตลอดคลิป จึงใช้วัดจังหวะก้าวได้ แต่ไม่นำมุมข้อต่อมาประเมิน · ถ้าอยากวัดขาข้างนี้ ให้เดินกลับอีกทาง (ไป–กลับ)`);
    // 1 heel strike
    {
      const fa = { L: R.mean.L.footIC, R: R.mean.R.footIC };
      const w = worst((sd) => ({ dev: Math.max(0, 8 - fa[sd]) }));
      const s = fa[w.sd] < -2 ? "bad" : fa[w.sd] < 6 ? "warn" : "ok";
      add("heel", 1.2, "ลงส้นเท้าก่อน (heel strike)", `มุมฝ่าเท้ากับพื้นตอนแตะ: ซ้าย ${fmt(fa.L)}${tag("L")} · ขวา ${fmt(fa.R)}${tag("R")}`, "ปลายเท้ายกขึ้น 10–25°", s,
        s === "ok" ? "" : `${sideTxt(w.sd)}แตะพื้นด้วย${fa[w.sd] < -2 ? "ปลายเท้า" : "ทั้งฝ่าเท้าพร้อมกัน"} แทนการลงส้นเท้า ทำให้ช่วงรับแรงกระแทกสั้นลง`,
        "ฝึกก้าวโดยให้ส้นเท้าแตะพื้นก่อน กระดกข้อเท้าขึ้นตอนก้าว และยืดกล้ามเนื้อน่อง", w.sd);
    }
    // 2 knee flexion at loading response
    {
      const w = worst((sd) => ({ dev: Math.abs(F[sd].kneeLR - NF.kneeLR) }));
      const s = grade(w.dev, 9, 16), hi = F[w.sd].kneeLR > NF.kneeLR;
      add("kneeLR", 1, "เข่างอเล็กน้อยรับน้ำหนักตอนเท้าลงพื้น", both("kneeLR"), `${fmt(NF.kneeLR - 8)}–${fmt(NF.kneeLR + 8)}`, s,
        s === "ok" ? "" : hi ? `${sideTxt(w.sd)}งอเข่ามากเกินไปตอนรับน้ำหนัก อาจกล้ามเนื้อต้นขาด้านหน้า (quadriceps) ต้องออกแรงมาก` : `${sideTxt(w.sd)}เข่าเหยียดตึงตอนเท้าลงพื้น ไม่มีการงอเข่าเพื่อลดแรงกระแทก`,
        hi ? "เสริมความแข็งแรงกล้ามเนื้อต้นขาด้านหน้า เช่น นั่ง–ลุกจากเก้าอี้ช้า ๆ" : "ลองให้เข่างอนุ่ม ๆ ตอนเท้าแตะพื้น ไม่ล็อกเข่าตึง", w.sd);
    }
    // 3 knee extension in mid/terminal stance
    {
      const w = worst((sd) => ({ dev: F[sd].kneeSt > 12 ? F[sd].kneeSt - 12 : F[sd].kneeSt < -6 ? -6 - F[sd].kneeSt : 0 }));
      const v = F[w.sd].kneeSt, s = v > 22 || v < -10 ? "bad" : v > 13 || v < -6 ? "warn" : "ok";
      add("kneeSt", 1, "เข่าเหยียดเกือบสุดช่วงกลางการยืน", both("kneeSt"), "0–10°", s,
        s === "ok" ? "" : v > 0 ? `${sideTxt(w.sd)}เข่างอค้างตลอดช่วงยืน (crouch) ทำให้ต้นขาทำงานหนักและเหนื่อยง่าย` : `${sideTxt(w.sd)}เข่าแอ่นไปด้านหลัง (genu recurvatum) เพิ่มแรงกดที่ข้อเข่าด้านหลัง`,
        v > 0 ? "ยืดกล้ามเนื้อหลังต้นขา (hamstrings) และฝึกเหยียดเข่าให้สุดตอนยืน" : "ฝึกคุมเข่าไม่ให้ล็อกแอ่น เสริมกล้ามเนื้อหลังต้นขาและน่อง", w.sd);
    }
    // 4 hip extension in terminal stance
    {
      const w = worst((sd) => ({ dev: Math.max(0, F[sd].hipExt - NF.hipExt) }));
      const s = grade(w.dev, 9, 16);
      add("hipExt", 1, "สะโพกเหยียดไปด้านหลังพอก่อนยกเท้า", both("hipExt"), `≤ ${fmt(NF.hipExt + 8)}`, s,
        s === "ok" ? "" : `${sideTxt(w.sd)}ต้นขาเหยียดไปด้านหลังน้อย ทำให้ก้าวสั้น อาจกล้ามเนื้องอสะโพกตึง`,
        "ยืดกล้ามเนื้อหน้าสะโพก (hip flexor stretch) ท่าก้าวขาย่อตัวไปด้านหน้า", w.sd);
    }
    // 5 push-off
    {
      const w = worst((sd) => ({ dev: Math.max(0, F[sd].ankPF - NF.ankPF) }));
      const s = grade(w.dev, 14, 20);
      add("push", 1, "ถีบปลายเท้าส่งตัวตอนยกเท้า (push-off)", both("ankPF"), `≤ ${fmt(NF.ankPF + 6)}`, s,
        s === "ok" ? "" : `${sideTxt(w.sd)}ข้อเท้าถีบส่งตัวน้อย กล้ามเนื้อน่อง (gastrocnemius/soleus) อาจอ่อนแรง ทำให้เดินช้าลง`,
        "ฝึกเขย่งปลายเท้าขึ้นลง (calf raise) วันละ 2–3 เซต", w.sd);
    }
    // 6 knee flexion in swing
    {
      const w = worst((sd) => ({ dev: Math.max(0, NF.kneeSw - F[sd].kneeSw) }));
      const lo = NF.kneeSw - Math.min(...SD.map((sd) => F[sd].kneeSw)), hiDev = Math.max(...SD.map((sd) => F[sd].kneeSw)) - NF.kneeSw;
      const s = lo >= 20 ? "bad" : lo >= 11 || hiDev >= 18 ? "warn" : "ok";
      add("kneeSw", 1.3, "งอเข่าพอตอนแกว่งขา (ประมาณ 60°)", both("kneeSw"), `${fmt(NF.kneeSw - 8)}–${fmt(NF.kneeSw + 10)}`, s,
        s === "ok" ? "" : lo >= 11 ? `${sideTxt(w.sd)}งอเข่าน้อยตอนแกว่งขา (stiff-knee) ปลายเท้าเสี่ยงลากพื้นและสะดุด` : "งอเข่าสูงกว่าปกติตอนแกว่งขา (อาจยกขาสูงชดเชยปลายเท้าตก)",
        lo >= 11 ? "ฝึกงอเข่ายกเท้าให้พ้นพื้น ยืดกล้ามเนื้อต้นขาด้านหน้า (rectus femoris)" : "ตรวจดูการกระดกข้อเท้าช่วงแกว่งขา", w.sd);
    }
    // 7 foot clearance (no foot drop)
    {
      const w = worst((sd) => ({ dev: Math.max(0, -6 - F[sd].ankSw) }));
      const s = grade(w.dev, 4, 10);
      add("clear", 1.1, "ปลายเท้าไม่ตกตอนแกว่งขา", both("ankSw"), "−5° ถึง +8°", s,
        s === "ok" ? "" : `${sideTxt(w.sd)}ปลายเท้าตกช่วงแกว่งขา (foot drop) อาจกล้ามเนื้อหน้าแข้ง (tibialis anterior) อ่อนแรง เสี่ยงสะดุดล้ม`,
        "ฝึกกระดกข้อเท้าขึ้น (ankle dorsiflexion) และถ้าเป็นมากควรปรึกษานักกายภาพบำบัด", w.sd);
    }
    // 8 trunk upright
    {
      const v = st.trunk, s = v > 18 || v < -8 ? "bad" : v > 11 || v < -4 ? "warn" : "ok";
      add("trunk", 0.8, "ลำตัวตั้งตรง ไม่โน้มหรือเอนมาก", `เอียงไปข้างหน้าเฉลี่ย ${fmt(v)}`, "0–10°", s,
        s === "ok" ? "" : v > 0 ? "ลำตัวโน้มไปข้างหน้ามาก อาจมาจากกล้ามเนื้อหลัง/สะโพกอ่อนแรง กลัวล้ม หรือ BMI สูง" : "ลำตัวเอนไปด้านหลัง อาจชดเชยกล้ามเนื้อเหยียดสะโพก (gluteus maximus) อ่อนแรง",
        "ฝึกเดินตัวตรง มองไปข้างหน้า เสริมกล้ามเนื้อแกนกลางลำตัวและหลัง");
    }
    // 9 symmetry
    {
      const sy = R.sym, lvl = (v, w, b) => (!ok(v) ? 0 : v >= b ? 2 : v >= w ? 1 : 0);
      // toe-off of a leg seen only from the far side is less precise, so stance symmetry is relaxed then
      const farT = R.farOnly && R.farOnly.length;
      const L2 = Math.max(farT ? lvl(sy.stance, 11, 18) : lvl(sy.stance, 6, 12), lvl(sy.stepLen, 12, 22), lvl(sy.stepT, 10, 20));
      const s = ["ok", "warn", "bad"][L2];
      const shortSide = st.stance.L < st.stance.R ? "L" : "R";
      add("sym", 1.4, "ซ้าย–ขวาสมมาตร ไม่เดินกะเผลก", `ช่วงยืน ซ้าย ${fmt(st.stance.L, 1, "%")} · ขวา ${fmt(st.stance.R, 1, "%")} · ความยาวก้าวต่างกัน ${fmt(sy.stepLen, 0, "%")} · เวลาก้าวต่างกัน ${fmt(sy.stepT, 0, "%")}`, "ช่วงยืนต่างกัน < 6% · ก้าวต่างกัน < 12%", s,
        s === "ok" ? "" : `${sideTxt(shortSide)}ลงน้ำหนักสั้นกว่าอีกข้าง (เดินกะเผลก) มักเกิดจากเจ็บ อ่อนแรง หรือใช้ขาเทียม`,
        "ถ้ามีอาการเจ็บควรให้แพทย์ตรวจ ถ้าไม่เจ็บลองฝึกก้าวให้ยาวเท่ากันตามจังหวะ (นับ 1–2)", shortSide);
    }
    // 10 speed & step length for age
    {
      const v = st.speed, vn = N.speed, sl = st.stepLenH;
      const s = v < 0.8 || sl < 0.27 ? "bad" : v < vn - 0.25 || sl < 0.33 ? "warn" : "ok";
      add("speed", 1.2, "ความเร็วและความยาวก้าวเหมาะกับวัย", `${fmt(v, 2, " m/s")} · ก้าว ${fmt(0.5 * st.strideLen * 100, 0, " cm")} · ${fmt(st.cadence, 0, " ก้าว/นาที")}`, `${fmt(vn, 2, " m/s")} (อายุ ${o.age}) · ก้าว ${fmt(N.stepLenH * o.ht, 0, " cm")}`, s,
        s === "ok" ? "" : v < 0.8 ? "เดินช้ามาก (< 0.8 m/s) สัมพันธ์กับความเสี่ยงหกล้มและภาวะเปราะบาง" : "เดินช้าหรือก้าวสั้นกว่าค่าปกติของวัยเดียวกัน",
        "ค่อย ๆ เพิ่มความเร็วและความยาวก้าว ออกกำลังกายแบบเดินเร็ววันละ 20–30 นาที");
    }
    // 11 arm swing (the far arm is hidden behind the trunk, so only near arms count)
    {
      const a = st.armROM, vals = ["L", "R"].filter((sd) => ok(a[sd])).map((sd) => a[sd]), mn = vals.length ? Math.min(...vals) : NaN;
      const si = vals.length === 2 ? R.sym.arm : 0;
      const s = !ok(mn) ? "ok" : mn < 8 || si > 60 ? "bad" : mn < 14 || si > 35 ? "warn" : "ok";
      add("arm", 0.6, "แกว่งแขนสลับกับขา", `ช่วงแกว่ง ซ้าย ${fmt(a.L)} · ขวา ${fmt(a.R)}`, "20–45° ใกล้เคียงกัน", s,
        s === "ok" ? "" : si > 35 ? "แกว่งแขนสองข้างไม่เท่ากัน (อาจพบในระยะแรกของโรคพาร์กินสัน หรือไหล่เจ็บ)" : "แกว่งแขนน้อย ทำให้ใช้พลังงานในการเดินมากขึ้น",
        "ปล่อยแขนแกว่งตามธรรมชาติ สลับกับขาข้างตรงข้าม");
    }
    // extra findings without a principle row
    if (st.vert > 8) issues.push(`ตัวกระเด้งขึ้นลงมาก (${st.vert.toFixed(1)} cm ต่อรอบ)`);
  } else {
    // front view principles
    const f = st.fppa, wv = Math.max(f.L, f.R), vv = Math.min(f.L, f.R);
    {
      const s = wv > 14 || vv < -14 ? "bad" : wv > 8 || vv < -8 ? "warn" : "ok";
      const sd = f.L > f.R ? "L" : "R";
      add("fppa", 1.3, "เข่าตรงแนว ไม่บิดเข้าใน (valgus) หรือโก่งออก (varus)", `ซ้าย ${fmt(f.L)} · ขวา ${fmt(f.R)} (+ = เข่าเข้าใน)`, "−6° ถึง +6°", s,
        s === "ok" ? "" : wv > 8 ? `${sideTxt(sd)}เข่าบิดเข้าด้านในตอนรับน้ำหนัก (dynamic knee valgus) เพิ่มความเสี่ยงเจ็บเข่าด้านหน้า` : `เข่าโก่งออกด้านนอกตอนรับน้ำหนัก (varus thrust) เพิ่มแรงกดที่ผิวข้อเข่าด้านใน`,
        "เสริมกล้ามเนื้อสะโพกด้านข้าง (gluteus medius) เช่น ท่านอนตะแคงยกขา และท่า clamshell", sd);
    }
    {
      const d = st.pelvicDrop, mx = Math.max(d.L, d.R), sd = d.L > d.R ? "L" : "R";
      const s = mx > 9 ? "bad" : mx > 5.5 ? "warn" : "ok";
      add("pelvis", 1.1, "สะโพกไม่ตกเวลายืนขาเดียว", `ยืนขาซ้าย ${fmt(d.L, 1)} · ขาขวา ${fmt(d.R, 1)}`, "< 5°", s,
        s === "ok" ? "" : `ตอนยืนบน${sideTxt(sd)} สะโพกอีกข้างตก (Trendelenburg) กล้ามเนื้อ gluteus medius ของ${sideTxt(sd)}อาจอ่อนแรง`,
        "ท่าบริหาร: ยืนขาเดียว 30 วินาที, นอนตะแคงยกขา, side-step กับยางยืด", sd);
    }
    {
      const l = st.trunkLat, mx = Math.max(l.L, l.R);
      const s = mx > 10 ? "bad" : mx > 6 ? "warn" : "ok";
      add("trunkLat", 0.9, "ลำตัวไม่เอียงข้างขณะเดิน", `เอียงสูงสุด ซ้าย ${fmt(l.L, 1)} · ขวา ${fmt(l.R, 1)}`, "< 5°", s,
        s === "ok" ? "" : "ลำตัวเอียงไปข้างขาที่ยืน อาจชดเชยสะโพกอ่อนแรงหรืออาการเจ็บ", "ฝึกเดินตัวตรงหน้ากระจก เสริมกล้ามเนื้อสะโพกด้านข้าง");
    }
    {
      const w = st.stepWidth * 100, s = !ok(w) ? "ok" : w > 20 ? "bad" : w > 14 || w < 3 ? "warn" : "ok";
      add("width", 0.9, "ความกว้างฐานก้าวพอดี", ok(w) ? `${w.toFixed(1)} cm` : "–", "5–13 cm", s,
        s === "ok" ? "" : w > 14 ? "ก้าวขากว้าง (wide-based gait) พบได้ใน BMI สูงตาม Ahsan (2022) หรือปัญหาการทรงตัว" : "ฐานก้าวแคบมาก เท้าเกือบไขว้กัน",
        "ฝึกเดินบนเส้นตรงที่มีความกว้างประมาณกำปั้นระหว่างเท้า");
    }
    issues.push("คลิปด้านหน้าใช้ดูแนวเข่า สะโพก และลำตัว ส่วนจังหวะซ้าย–ขวาและมุมงอเข่าให้ถ่ายด้านข้างจะแม่นกว่า");
    {
      const c = st.cadence, s = c < 80 || c > 140 ? "warn" : "ok";
      add("cad", 0.7, "จังหวะก้าวเหมาะสม", `${fmt(c, 0, " ก้าว/นาที")}`, "95–125 ก้าว/นาที", s, s === "ok" ? "" : c < 80 ? "ก้าวช้ากว่าปกติ" : "ก้าวถี่มาก (ก้าวสั้นถี่)", "");
    }
  }
  R.items = items;
  const tw = items.reduce((s, x) => s + x.w, 0);
  R.score = Math.round((items.reduce((s, x) => s + x.w * STAT[x.status], 0) / tw) * 100);
  const nBad = items.filter((x) => x.status === "bad").length;
  R.verdict = R.score >= 85 && !nBad ? { k: "good", th: "เดินถูกตามหลัก", sub: "รูปแบบการเดินใกล้เคียงค่าปกติของคนวัยและรูปร่างเดียวกัน" }
    : R.score >= 65 && nBad < 2 ? { k: "fair", th: "เกือบถูกหลัก มีจุดที่ควรปรับ", sub: "มีบางจังหวะของการเดินที่ต่างจากค่าปกติ ดูรายการด้านล่าง" }
    : { k: "poor", th: "ยังไม่ถูกหลัก ควรปรึกษาผู้เชี่ยวชาญ", sub: "พบความผิดปกติหลายจุด ควรให้นักกายภาพบำบัดหรือแพทย์ประเมินเพิ่มเติม" };
  if (R.reliability < 50) R.verdict.sub += " (ความน่าเชื่อถือของผลต่ำ ควรถ่ายคลิปใหม่ตามคำแนะนำ)";
}

// measured curves in the format the simulator's model accepts (model(o).meas)
export function toMeas(R) {
  if (!R.ok || R.view !== "side") return null;
  const c = (sd) => ({ hip: R.mean[sd].hip.slice(), knee: R.mean[sd].knee.slice(), ank: R.mean[sd].ank.slice() });
  const armROM = 0.5 * (R.st.armROM.L + R.st.armROM.R);
  return {
    T: R.st.strideT, v: R.st.speed, strideLen: R.st.strideLen, sf: { L: R.mean.L.sf, R: R.mean.R.sf }, offL: R.st.offL,
    trunk: clamp(R.st.trunk, -10, 30), arm: ok(armROM) ? clamp(armROM / 70, 0.05, 1.1) : null, curves: { L: c("L"), R: c("R") },
  };
}
