import { AMP_SPEED, SUBJECTS } from "./data.js";

export const rad = Math.PI / 180;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const frac = (x) => x - Math.floor(x);
const g = (x, c, w) => Math.exp(-0.5 * ((x - c) / w) ** 2);

// Normal-gait keyframes (% gait cycle, toe-off at 60%). Sagittal shapes follow
// textbook adult gait; frontal/transverse shapes are illustrative.
const HIP = [[0, 30], [10, 27], [30, 9], [50, -9], [60, -4], [75, 20], [87, 32], [100, 30]];
const KNEE = [[0, 3], [15, 18], [40, 4], [60, 38], [73, 62], [87, 30], [97, 2], [100, 3]];
const ANK = [[0, 0], [8, -6], [30, 5], [48, 10], [62, -15], [75, -2], [90, 1], [100, 0]];
const VAR = [[0, 2.0], [15, 3.5], [40, 3.0], [60, 1.5], [75, -0.5], [90, 0.8], [100, 2.0]];
const IRK = [[0, 3], [15, 8], [40, 6], [60, 2], [75, -2], [90, 0.5], [100, 3]];
const ADD = [[0, 2], [12, 6], [30, 4], [50, 1], [62, -3], [80, -2], [100, 2]];

function interp(keys, p) {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && p >= keys[i + 1][0]) i++;
  const P = (k) => {
    if (k < 0) return [keys[n - 1 + k][0] - 100, keys[n - 1 + k][1]];
    if (k > n - 1) return [keys[k - n + 1][0] + 100, keys[k - n + 1][1]];
    return keys[k];
  };
  const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  const h = p2[0] - p1[0], t = (p - p1[0]) / h;
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * h, m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}

export const COEF_DEFAULT = { var: -0.33, ir: 1.0, ref: 22, varAge: 0, varSex: 0, irAge: 0, irSex: 0 };

export function subjectById(id) { return SUBJECTS.find((s) => s.id === id) || null; }

export function model(o, C = COEF_DEFAULT) {
  const h = o.ht / 100, bmi = o.wt / (h * h), dB = bmi - C.ref, dBp = Math.max(0, dB);
  const amp = o.mode !== "normal";
  const ampSide = o.mode === "ampL" ? "L" : o.mode === "ampR" ? "R" : null;
  const a60 = Math.max(0, o.age - 60);
  const subj = amp && o.subject ? subjectById(o.subject) : null;
  const meas = o.meas || null;
  let v;
  if (meas) v = meas.v;
  else if (o.v) v = o.v;
  else if (amp) v = subj ? subj.speeds[o.speed] : AMP_SPEED[o.speed];
  else {
    const base = 1.25 * { comf: 1, fast: 1.2, slow: 0.8, self: 1.05 }[o.speed];
    v = base * clamp(1 - 0.008 * dBp, 0.75, 1) * clamp(1 - 0.004 * Math.max(0, o.age - 40), 0.78, 1);
  }
  const strideLen = meas ? meas.strideLen : h * (0.45 + 0.3 * v) * clamp(1 - 0.004 * a60, 0.85, 1);
  const T = meas ? meas.T : strideLen / v;
  const sfBase = clamp(0.62 - 0.05 * (v - 1.0), 0.57, 0.68) + (amp ? 0 : clamp(0.0025 * dBp, 0, 0.05));
  const BW = o.wt * 9.81;
  const varOff = C.var * dB + C.varAge * (o.age - 35) + (o.sex === "F" ? C.varSex : 0);
  const irOff = C.ir * dB + C.irAge * (o.age - 35) + (o.sex === "F" ? C.irSex : 0);
  const vs = v / 1.25;
  const girth = clamp(Math.sqrt(bmi / 22), 0.82, 1.45);
  const stepW = 0.09 + 0.004 * dBp + (amp ? 0.04 : 0) + 0.001 * a60;
  const hipHalf = h * (o.sex === "F" ? 0.052 : 0.048) * (0.85 + 0.15 * girth);
  const legLen = 0.49 * h;
  const addOffset = Math.atan((hipHalf - stepW / 2) / legLen) / rad;
  const pushScale = clamp(1 - 0.01 * a60, 0.6, 1);

  const leg = (side) => {
    const isAmp = side === ampSide, isSou = amp && !isAmp;
    const p = {
      side, isAmp, isSou,
      sf: sfBase + (isAmp ? -0.025 : isSou ? 0.025 : 0),
      kLR: isAmp ? 5 : 12 + 6 * vs - (amp ? 0 : clamp(0.35 * dBp, 0, 6)) - (isSou ? 1 : 0),
      kSw: 58 + 4 * vs - (isAmp ? 6 : 0) - 0.1 * a60,
      ankPO: isAmp ? -3 : (-10 - 5 * vs) * pushScale,
      dorsi: isAmp ? 0.55 : 1,
      mtp: isAmp ? 0 : 28 * pushScale,
      abdSwing: isAmp ? 5 : 0,
      varOff, irOff,
    };
    if (meas) p.sf = meas.sf[side];
    let p1 = 1.0 + 0.18 * (v - 0.6), p2 = 1.0 + 0.15 * (v - 0.6) * pushScale;
    if (isSou) { p1 += 0.08; p2 += 0.03; }
    if (isAmp) { p1 -= 0.03; p2 = 0.93 + 0.05 * (v - 0.6); }
    p.p1 = p1; p.p2 = p2; p.valley = clamp(0.86 - 0.14 * (v - 0.6), 0.6, 0.88);
    return p;
  };

  return {
    o, bmi, dB, dBp, v, T, strideLen, cadence: 120 / T, BW, amp, ampSide, subj, h,
    stepW, hipHalf, addOffset, girth, pushScale,
    hipExtOff: 0.12 * a60,
    trunkFlex: meas ? meas.trunk : 3 + 0.25 * dBp + 0.18 * a60 + (amp ? 2 : 0),
    meas, offL: meas ? meas.offL : 0.5,
    latLean: amp ? 5 : 0,
    sway: 0.02 + 0.15 * (stepW - 0.09) + (amp ? 0.012 : 0),
    pelvisRot: 4 * clamp(v / 1.1, 0.6, 1.2),
    armAbd: 7 + 0.9 * dBp,
    armSwing: meas && meas.arm ? meas.arm : 0.55 * clamp(v / 1.1, 0.5, 1.15) * (amp ? 0.8 : 1),
    fpa: 7 + 0.3 * dBp,
    kamPct: 2.6 + 0.05 * dBp,
    legs: { R: leg("R"), L: leg("L") },
  };
}

export function remap(p, sf) { return p < sf ? (p / sf) * 60 : 60 + ((p - sf) / (1 - sf)) * 40; }

// periodic linear sample of a 101-point cycle curve at cycle fraction p
export function sample(a, p) {
  const x = frac(p) * 100, i = Math.floor(x), f = x - i;
  return a[i] + (a[Math.min(100, i + 1)] - a[i]) * f;
}

export function angles(m, L, p) {
  const q = remap(p, L.sf);
  let hip, knee, ank;
  const mc = m.meas && m.meas.curves[L.side];
  if (mc) { hip = sample(mc.hip, p); knee = sample(mc.knee, p); ank = sample(mc.ank, p); }
  else {
    hip = interp(HIP, q) + m.hipExtOff * g(q, 50, 12);
    knee = interp(KNEE, q) + (L.kLR - 18) * g(q, 15, 7) + (L.kSw - 62) * g(q, 73, 9);
    ank = interp(ANK, q) + (L.ankPO + 15) * g(q, 62, 6);
    if (ank > 0) ank *= L.dorsi;
  }
  return {
    hip, knee: mc ? knee : Math.max(0, knee), ank,
    varus: interp(VAR, q) + L.varOff,
    ir: interp(IRK, q) + L.irOff,
    add: interp(ADD, q) + m.addOffset - L.abdSwing * g(q, 80, 11),
    mtp: L.mtp * g(q, 56, 5),
  };
}

export function grf(L, p, BW) {
  if (p >= L.sf) return 0;
  const s = p / L.sf, base = (x) => L.valley * Math.pow(Math.sin(Math.PI * x), 0.5);
  return BW * Math.max(0, base(s) + (L.p1 - base(0.23)) * g(s, 0.23, 0.09) + (L.p2 - base(0.77)) * g(s, 0.77, 0.09));
}

const PHASES = [[2, "Initial contact"], [12, "Loading response"], [31, "Mid stance"], [50, "Terminal stance"], [60, "Pre-swing"], [73, "Initial swing"], [87, "Mid swing"], [101, "Terminal swing"]];
export function phaseName(L, p) { const q = remap(p, L.sf); return PHASES.find(([e]) => q < e)[1]; }

export function curves(m) {
  const out = {};
  for (const sd of ["R", "L"]) {
    const L = m.legs[sd], a = { hip: [], knee: [], ank: [], varus: [], ir: [], grf: [] };
    for (let i = 0; i <= 100; i++) {
      const p = Math.min(i / 100, 0.9999), A = angles(m, L, p);
      a.hip.push(A.hip); a.knee.push(A.knee); a.ank.push(A.ank); a.varus.push(A.varus); a.ir.push(A.ir); a.grf.push(grf(L, p, m.BW));
    }
    out[sd] = a;
  }
  return out;
}
