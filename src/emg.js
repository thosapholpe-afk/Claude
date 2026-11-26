// Surface-EMG envelope model for gait.
// Normative timing follows the classic adult gait EMG patterns (Perry & Burnfield 2010; Winter 1991).
// Pathology modifiers (BMI, ageing, transtibial amputation) are illustrative approximations.
import { remap, clamp, frac } from "./model.js";

// bumps: [centre (% gait cycle, toe-off at 60), width (sd, %), amplitude (fraction of MVC)]
export const MUSCLES = [
  { id: "GMAX", abbr: "GMAX", en: "Gluteus maximus", th: "กล้ามเนื้อก้นมัดใหญ่", region: "สะโพก",
    bumps: [[97, 5, 0.2], [5, 6, 0.3], [15, 6, 0.12]],
    fn: "เหยียดสะโพกและรับแรงกระแทกตอนเท้าแตะพื้น ทำงานตั้งแต่ปลายช่วงแกว่งขาไปจนถึงช่วงรับน้ำหนัก" },
  { id: "GMED", abbr: "GMED", en: "Gluteus medius", th: "กล้ามเนื้อก้นมัดกลาง", region: "สะโพก",
    bumps: [[2, 5, 0.18], [10, 7, 0.32], [25, 8, 0.2], [96, 3, 0.1]],
    fn: "พยุงเชิงกรานไม่ให้ตกไปฝั่งตรงข้ามขณะยืนขาเดียว (LR–MSt) จึงสำคัญต่อการทรงตัวด้านข้าง" },
  { id: "ILIO", abbr: "ILIO", en: "Iliopsoas", th: "กล้ามเนื้องอสะโพก", region: "สะโพก",
    bumps: [[58, 6, 0.18], [66, 7, 0.28]],
    fn: "งอสะโพกเพื่อเหวี่ยงขาไปข้างหน้า ทำงานช่วง pre-swing ถึง initial swing" },
  { id: "ADD", abbr: "ADD", en: "Adductors", th: "กล้ามเนื้อหุบสะโพก", region: "ต้นขา",
    bumps: [[4, 6, 0.15], [55, 6, 0.12], [62, 5, 0.16]],
    fn: "คุมสะโพกในระนาบ frontal ตอนรับน้ำหนัก และช่วยงอสะโพกช่วงต้นของการแกว่งขา" },
  { id: "RF", abbr: "RF", en: "Rectus femoris", th: "กล้ามเนื้อต้นขาหน้า (มัดกลาง)", region: "ต้นขา",
    bumps: [[57, 4, 0.16], [4, 4, 0.1], [96, 3, 0.06]],
    fn: "ข้ามสองข้อต่อ ช่วยงอสะโพกและคุมการงอเข่าช่วงเปลี่ยนจาก stance ไป swing" },
  { id: "VAS", abbr: "VAS", en: "Vasti (VL + VM)", th: "กล้ามเนื้อต้นขาหน้า (vasti)", region: "ต้นขา",
    bumps: [[3, 5, 0.3], [10, 6, 0.28], [96, 4, 0.18]],
    fn: "คุมการงอเข่าแบบ eccentric ช่วงรับน้ำหนัก เพื่อดูดซับแรงกระแทกและกันเข่าทรุด" },
  { id: "HAM", abbr: "HAM", en: "Hamstrings", th: "กล้ามเนื้อต้นขาหลัง", region: "ต้นขา",
    bumps: [[86, 7, 0.3], [95, 5, 0.22], [5, 5, 0.15]],
    fn: "ชะลอขาที่กำลังเหวี่ยงไปข้างหน้า (terminal swing) และช่วยเหยียดสะโพกช่วงต้น stance" },
  { id: "TA", abbr: "TA", en: "Tibialis anterior", th: "กล้ามเนื้อหน้าแข้ง", region: "ขา",
    bumps: [[3, 5, 0.4], [10, 4, 0.15], [64, 6, 0.3], [80, 10, 0.14], [95, 5, 0.18]],
    fn: "ค่อย ๆ วางเท้าลงพื้นหลังส้นแตะ (eccentric) และกระดกข้อเท้าให้เท้าพ้นพื้นช่วง swing" },
  { id: "GAS", abbr: "GAS", en: "Gastrocnemius", th: "กล้ามเนื้อน่อง (มัดนอก)", region: "ขา",
    bumps: [[30, 9, 0.25], [44, 7, 0.45]],
    fn: "ถีบส่ง (push-off) และคุมการเคลื่อนของแข้งไปข้างหน้าช่วง mid ถึง terminal stance" },
  { id: "SOL", abbr: "SOL", en: "Soleus", th: "กล้ามเนื้อน่อง (มัดใน)", region: "ขา",
    bumps: [[22, 10, 0.25], [40, 9, 0.52]],
    fn: "ตัวหลักของแรงถีบส่ง และคุมแข้งไม่ให้ล้มไปข้างหน้าขณะยืน" },
  { id: "PER", abbr: "PER", en: "Peroneus longus", th: "กล้ามเนื้อข้างแข้ง", region: "ขา",
    bumps: [[25, 10, 0.18], [42, 8, 0.25]],
    fn: "พยุงข้อเท้าด้านนอกและอุ้งเท้า ช่วง mid ถึง terminal stance" },
  { id: "ES", abbr: "ES", en: "Erector spinae", th: "กล้ามเนื้อหลัง", region: "ลำตัว", trunk: true,
    bumps: [[2, 5, 0.2], [52, 5, 0.18]],
    fn: "พยุงลำตัวให้ตั้งตรง มี burst ทุกครั้งที่เท้าข้างใดข้างหนึ่งแตะพื้น" },
  { id: "ABD", abbr: "RA", en: "Rectus abdominis", th: "กล้ามเนื้อหน้าท้อง", region: "ลำตัว", trunk: true, base: 0.04,
    bumps: [[12, 8, 0.05], [62, 8, 0.05]],
    fn: "ช่วยคุมความมั่นคงของลำตัว ทำงานในระดับต่ำตลอดรอบการเดิน" },
  { id: "DEL", abbr: "DEL", en: "Posterior deltoid", th: "กล้ามเนื้อไหล่ด้านหลัง", region: "แขน", trunk: true,
    bumps: [[45, 12, 0.12], [95, 8, 0.06]],
    fn: "คุมการแกว่งแขนไปด้านหลัง ซึ่งช่วยสมดุลการหมุนของลำตัว" },
];
export const MUSCLE = Object.fromEntries(MUSCLES.map((m) => [m.id, m]));
export const DISTAL = new Set(["TA", "GAS", "SOL", "PER"]);

export function emgProfile(m, side) {
  const L = m.legs[side];
  const vS = clamp(Math.pow(m.v / 1.25, 0.9), 0.35, 1.5);
  const dBp = m.dBp, a60 = Math.max(0, m.o.age - 60);
  const out = {};
  for (const mu of MUSCLES) {
    const id = mu.id;
    let scale = mu.trunk ? Math.sqrt(vS) : vS;
    const wMul = 1 + 0.01 * a60, extra = [], notes = [];
    let absent = false;
    const bmiK = { VAS: 0.03, GMED: 0.025, SOL: 0.015, GMAX: 0.02, TA: 0.01 }[id];
    if (bmiK && dBp > 0) { scale *= 1 + bmiK * dBp; notes.push("BMI สูงทำให้ต้องออกแรงเพิ่ม (ค่าสาธิต)"); }
    if (a60) {
      if (id === "GAS" || id === "SOL") { scale *= clamp(1 - 0.012 * a60, 0.55, 1); notes.push("ผู้สูงอายุ: แรงถีบส่งลดลง"); }
      if (id === "VAS") scale *= 1 + 0.008 * a60;
      if (id === "HAM") scale *= 1 + 0.01 * a60;
      if (id === "TA") { extra.push([30, 10, 0.012 * a60]); notes.push("ผู้สูงอายุ: หดตัวร่วม (co-activation) ช่วง stance"); }
    }
    if (L.isAmp) {
      if (DISTAL.has(id)) { absent = true; notes.push("ขาเทียม: อยู่ในเบ้าขาเทียม และไม่มีหน้าที่ขยับข้อเท้า"); }
      if (id === "HAM") { scale *= 1.2; extra.push([15, 10, 0.25]); notes.push("ขาเทียม: ทำงานนานขึ้นช่วง stance เพื่อให้เข่ามั่นคง"); }
      if (id === "VAS") { extra.push([20, 9, 0.18]); notes.push("ขาเทียม: หดตัวร่วมกับ hamstrings นานขึ้น"); }
      if (id === "GMAX") { scale *= 1.45; extra.push([18, 8, 0.15]); notes.push("ขาเทียม: เหยียดสะโพกมากขึ้นเพื่อชดเชยแรงถีบส่งที่หายไป"); }
      if (id === "GMED") scale *= 1.2;
      if (id === "RF") extra.push([10, 6, 0.08]);
    }
    if (L.isSou) {
      const k = { GAS: 1.3, SOL: 1.25, GMED: 1.15, GMAX: 1.1, VAS: 1.1 }[id];
      if (k) { scale *= k; notes.push("ขาดี: ทำงานมากขึ้นเพื่อชดเชยขาเทียม"); }
    }
    if (m.amp && id === "ES") { scale *= 1.3; notes.push("ลำตัวต้องปรับสมดุลมากขึ้น"); }
    out[id] = {
      bumps: mu.bumps.map(([c, w, A]) => [c, w * wMul, A * scale]).concat(extra.map(([c, w, A]) => [c, w, A * vS])),
      base: (mu.base || 0) * scale, absent, notes,
    };
  }
  return out;
}

export function act(prof, q) {
  if (!prof || prof.absent) return 0;
  let a = prof.base;
  for (const [c, w, A] of prof.bumps) {
    const d = ((((q - c) % 100) + 150) % 100) - 50;
    a += A * Math.exp(-0.5 * (d / w) ** 2);
  }
  return Math.min(1, a);
}

export function emgCurves(m) {
  const curves = {}, prof = {};
  for (const sd of ["L", "R"]) {
    const P = emgProfile(m, sd);
    prof[sd] = P; curves[sd] = {};
    for (const mu of MUSCLES) {
      const arr = new Float32Array(101);
      for (let i = 0; i <= 100; i++) arr[i] = act(P[mu.id], remap(Math.min(i / 100, 0.9999), m.legs[sd].sf));
      curves[sd][mu.id] = arr;
    }
  }
  return { curves, prof };
}

export function actNow(m, prof, side, p) {
  const q = remap(p, m.legs[side].sf), out = {};
  for (const mu of MUSCLES) out[mu.id] = act(prof[side][mu.id], q);
  return out;
}

// ---- deterministic raw sEMG synthesis (1 kHz) for oscilloscope display
function h32(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function gnoise(n, seed) { return (h32(n * 3 + seed) + h32(n * 7 + seed * 131 + 1) + h32(n * 13 + seed * 977 + 2) - 1.5) * 2; }

export const FS = 1000;
// Returns {raw, env} arrays covering the last `win` seconds, ending at simulation time tNow.
export function rawWindow(m, prof, side, id, phiNow, tNow, win, seed) {
  const N = Math.round(win * FS), raw = new Float32Array(N), env = new Float32Array(N);
  const off = side === "L" ? 0.5 : 0, sf = m.legs[side].sf, P = prof[side][id];
  const n0 = Math.floor(tNow * FS) - N + 1;
  for (let k = 0; k < N; k++) {
    const n = n0 + k, dt = (Math.floor(tNow * FS) - n) / FS;
    const p = frac(phiNow + off - dt / m.T);
    const e = act(P, remap(p, sf));
    const w = 0.25 * gnoise(n - 1, seed) + 0.5 * gnoise(n, seed) + 0.25 * gnoise(n + 1, seed);
    env[k] = e * 1.5;
    raw[k] = (e * 1.5 + 0.02) * w * 1.6;
  }
  return { raw, env };
}
