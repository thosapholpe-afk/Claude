import * as THREE from "three";
import { Stage, GROUND } from "./stage.js";
import { Mannequin } from "./figure.js";
import { model, curves, grf, phaseName, frac, COEF_DEFAULT } from "./model.js";
import { SCENARIOS, SUBJECTS, T6 } from "./data.js";
import { drawCompare, drawContact, C1, C2 } from "./charts.js";

const $ = (id) => document.getElementById(id);
const COLORS = [C1, C2];
const coef = { ...COEF_DEFAULT };
const S = { view: "lanes", playing: true, anim: 1, exag: 1, leg: "L", unit: "N", diff: false };

const newSim = (phi) => ({ phi, t: 0, hist: [], marks: { R: [], L: [] }, stride: { R: {}, L: {} }, stats: { R: { ic: [], fc: [] }, L: { ic: [], fc: [] } }, lock: null });
const scen = (id) => SCENARIOS.find((s) => s.id === id);
const types = [0, 1].map((i) => {
  const sc = scen(i ? "ampL" : "healthy");
  return { i, scen: sc.id, cfg: { ...sc.cfg }, imuAmp: 6, imuSou: 7, sim: newSim(i ? 0.37 : 0), fig: new Mannequin(i ? "red" : "white") };
});

const stage = new Stage($("gl"));
types.forEach((T) => stage.lanes[T.i].add(T.fig.root));

// ---------------------------------------------------------------- model
function legLabel(T, sd) { return T.m.amp ? (sd === T.m.ampSide ? "AMP" : "SOU") : sd === "L" ? "ซ้าย" : "ขวา"; }
function rowFor(T, sd) { return sd === T.m.ampSide ? T6.AMP[T.imuAmp] : T6.SOU[T.imuSou]; }
function recompute(T) {
  T.m = model(T.cfg, coef);
  T.cur = curves(T.m);
  T.fig.build(T.m);
  const codes = new Set();
  if (T.m.amp) for (const sd of ["L", "R"]) rowFor(T, sd)[0].split("+").forEach((c) => codes.add(c));
  T.fig.setIMUs(codes);
  T.fig.setGhost(T.i === 1 && S.view === "ghost");
  updateCfgOutputs(T);
  renderMetrics();
  renderEvents();
}
function resetEvents(T) { const phi = T.sim.phi, t = T.sim.t; T.sim = newSim(phi); T.sim.t = t; }

// ---------------------------------------------------------------- config UI
const bmiCat = (b) => (b < 18.5 ? "น้ำหนักน้อย" : b < 25 ? "ปกติ" : b < 30 ? "น้ำหนักเกิน" : "อ้วน");
function renderCfg(T) {
  const c = T.cfg, el = $("cfg" + T.i), amp = c.mode !== "normal";
  const sc = scen(T.scen);
  const opt = (rows, sel) => rows.map((r, k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${r[8]} · ${r[0]} — MAE IC ${(r[3] * 1000).toFixed(0)} / FC ${(r[6] * 1000).toFixed(0)} ms${r[7] ? " · F1 " + r[7].toFixed(2) : ""}</option>`).join("");
  const seg = (key, items) => `<div class="seg" data-key="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${String(c[key]) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  el.innerHTML = `
    <div class="cfg-h"><div class="tt">TYPE ${T.i + 1}</div><div class="bmi">BMI<b data-o="bmi"></b><div data-o="cat"></div></div></div>
    <div class="scen">${SCENARIOS.map((s) => `<button data-scen="${s.id}" class="${s.id === T.scen ? "on" : ""}"><span class="tg">${s.tag}</span><span class="nm">${s.name}</span></button>`).join("")}</div>
    <div class="desc">${sc ? sc.desc : "กำหนดเอง: ปรับค่าเองจากแถบด้านล่าง"}</div>
    <div class="frm">
      <div class="fld full"><div class="lab">รูปแบบการเดิน</div>${seg("mode", [["normal", "ปกติ"], ["ampL", "ขาเทียมซ้าย"], ["ampR", "ขาเทียมขวา"]])}</div>
      <div class="fld full"><div class="lab">ความเร็ว (ตามโปรโตคอลงานวิจัย)<output data-o="v"></output></div>${seg("speed", [["slow", "ช้า"], ["comf", "สบาย"], ["self", "เลือกเอง"], ["fast", "เร็ว"]])}</div>
      <div class="fld"><div class="lab">อายุ<output data-o="age"></output></div><input type="range" data-k="age" min="18" max="85" step="1" value="${c.age}"></div>
      <div class="fld"><div class="lab">เพศ</div>${seg("sex", [["M", "ชาย"], ["F", "หญิง"]])}</div>
      <div class="fld"><div class="lab">ส่วนสูง<output data-o="ht"></output></div><input type="range" data-k="ht" min="140" max="200" step="0.5" value="${c.ht}"></div>
      <div class="fld"><div class="lab">น้ำหนัก<output data-o="wt"></output></div><input type="range" data-k="wt" min="35" max="150" step="0.5" value="${c.wt}"></div>
      <div class="fld full"><div class="lab">ผู้เข้าร่วมงานวิจัย (Table 1–2)</div>
        <select data-sel="subject" ${amp ? "" : "disabled"}><option value="">ค่าเฉลี่ยกลุ่ม (n = 12)</option>${SUBJECTS.map((s) => `<option value="${s.id}" ${c.subject === s.id ? "selected" : ""}>${s.id} · ${s.age} ปี · ${s.wt} kg · ${s.ht} cm · ขาเทียม${s.side === "L" ? "ซ้าย" : "ขวา"}</option>`).join("")}</select></div>
      <div class="fld"><div class="lab">IMU ฝั่งขาเทียม (AMP)</div><select data-sel="imuAmp" ${amp ? "" : "disabled"}>${opt(T6.AMP, T.imuAmp)}</select></div>
      <div class="fld"><div class="lab">IMU ฝั่งขาดี (SOU)</div><select data-sel="imuSou" ${amp ? "" : "disabled"}>${opt(T6.SOU, T.imuSou)}</select></div>
    </div>
    <div class="warnline" data-o="warn"></div>`;
  updateCfgOutputs(T);
}
function updateCfgOutputs(T) {
  const el = $("cfg" + T.i), m = T.m, c = T.cfg;
  if (!m || !el.querySelector("[data-o]")) return;
  const set = (k, v) => { const o = el.querySelector(`[data-o="${k}"]`); if (o) o.textContent = v; };
  set("bmi", m.bmi.toFixed(1)); set("cat", bmiCat(m.bmi) + " (WHO)");
  set("age", c.age + " ปี"); set("ht", c.ht.toFixed(1) + " cm"); set("wt", c.wt.toFixed(1) + " kg");
  set("v", m.v.toFixed(2) + " m/s" + (m.amp ? (m.subj ? " · " + m.subj.id : " · Table 2") : ""));
  const w = el.querySelector('[data-o="warn"]');
  const msgs = [];
  if (m.bmi < 18.5 || m.bmi >= 25) msgs.push("BMI อยู่นอกช่วงที่งานวิจัยรามาฯ ศึกษา (ช่วงปกติ) ค่า varus และ IR จึงได้จากการยืดเส้นตรงออกไป");
  if (m.amp && !m.subj && (Math.abs(c.age - 51) > 15 || m.bmi > 26)) msgs.push("ค่าที่ตั้งอยู่นอกลักษณะของกลุ่มตัวอย่างขาเทียม (ชาย อายุ 51 ± 10 ปี BMI ประมาณ 23)");
  w.textContent = msgs.join(" · "); w.classList.toggle("show", msgs.length > 0);
}
function wireCfg(T) {
  const el = $("cfg" + T.i);
  el.addEventListener("click", (e) => {
    const sb = e.target.closest("[data-scen]");
    if (sb) { const sc = scen(sb.dataset.scen); T.scen = sc.id; T.cfg = { ...sc.cfg }; resetEvents(T); recompute(T); renderCfg(T); return; }
    const b = e.target.closest(".seg[data-key] button");
    if (b) {
      const key = b.parentElement.dataset.key;
      T.cfg[key] = b.dataset.v; T.scen = null;
      if (key === "mode") { T.cfg.subject = null; resetEvents(T); }
      recompute(T); renderCfg(T);
    }
  });
  el.addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    T.cfg[k] = +e.target.value; T.cfg.subject = null;
    if (T.scen) { T.scen = null; el.querySelectorAll("[data-scen]").forEach((x) => x.classList.remove("on")); el.querySelector(".desc").textContent = "กำหนดเอง: ปรับค่าเองจากแถบด้านล่าง"; const s = el.querySelector('[data-sel="subject"]'); if (s) s.value = ""; }
    scheduleRecompute(T);
  });
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.sel;
    if (!k) return;
    if (k === "subject") {
      const sub = SUBJECTS.find((s) => s.id === e.target.value);
      T.cfg.subject = sub ? sub.id : null; T.scen = null;
      if (sub) Object.assign(T.cfg, { age: sub.age, wt: sub.wt, ht: sub.ht, sex: "M", mode: sub.side === "L" ? "ampL" : "ampR" });
      resetEvents(T); recompute(T); renderCfg(T);
    } else { T[k] = +e.target.value; resetEvents(T); recompute(T); }
  });
}
const pending = new Set();
function scheduleRecompute(T) { pending.add(T); }

// ---------------------------------------------------------------- global controls
function segGroup(id, fn) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    fn(b.dataset.v);
  });
}
segGroup("viewSeg", (v) => { S.view = v; stage.setMode(v); types[1].fig.setGhost(v === "ghost"); });
segGroup("camSeg", (v) => stage.view(v));
segGroup("legSeg", (v) => { S.leg = v; });
segGroup("unitSeg", (v) => { S.unit = v; });
segGroup("diffSeg", (v) => { S.diff = v === "1"; });
$("anim").addEventListener("input", (e) => { S.anim = +e.target.value; $("animOut").textContent = S.anim.toFixed(2) + "×"; });
$("exag").addEventListener("input", (e) => { S.exag = +e.target.value; $("exagOut").textContent = S.exag + "×"; });
$("playBtn").addEventListener("click", () => { S.playing = !S.playing; $("playBtn").firstElementChild.className = S.playing ? "i-pause" : "i-play"; });

const COEF_FIELDS = [["var", "Varus ตอน IC ต่อ BMI +1 (°)", 0.01], ["ir", "Internal rotation ต่อ BMI +1 (°)", 0.05], ["ref", "BMI อ้างอิง (kg/m²)", 0.1], ["varAge", "Varus ต่ออายุ +1 ปี (°)", 0.01], ["varSex", "Varus ส่วนต่างเพศหญิง (°)", 0.1], ["irAge", "IR ต่ออายุ +1 ปี (°)", 0.01], ["irSex", "IR ส่วนต่างเพศหญิง (°)", 0.1]];
$("coef").innerHTML = COEF_FIELDS.map(([k, l, s]) => `<span>${l}</span><input type="number" step="${s}" data-c="${k}" value="${coef[k]}">`).join("");
$("coef").addEventListener("input", (e) => { const k = e.target.dataset.c; if (!k) return; const v = parseFloat(e.target.value); coef[k] = isNaN(v) ? COEF_DEFAULT[k] : v; types.forEach(recompute); });

// ---------------------------------------------------------------- charts
const CHARTS = [
  ["hip", "สะโพก · Hip flexion", "องศา · sagittal", (a) => ["ROM", Math.max(...a) - Math.min(...a), "°"]],
  ["knee", "เข่า · Knee flexion", "องศา · sagittal", (a) => ["งอสูงสุด", Math.max(...a), "°"]],
  ["ank", "ข้อเท้า · Dorsi(+)/Plantar(−)", "องศา · sagittal", (a) => ["plantar สูงสุด", Math.min(...a), "°"]],
  ["varus", "เข่าโก่ง · Knee varus (+)", "องศา · frontal", (a) => ["ตอน IC", a[0], "°"]],
  ["ir", "เข่าบิดเข้าใน · Internal rotation", "องศา · transverse", (a) => ["สูงสุด", Math.max(...a), "°"]],
  ["grf", "แรงปฏิกิริยาพื้น · vGRF", "ช่วง stance", (a) => ["สูงสุด", Math.max(...a), ""]],
];
$("charts").innerHTML = CHARTS.map(([k, t, s]) => `<div class="ch"><div class="t">${t}</div><div class="s">${s}</div><div class="v" id="v_${k}"></div><canvas id="ch_${k}"></canvas></div>`).join("");
function chartData(T, sd, key) {
  const d = T.cur[sd][key];
  if (key !== "grf") return d;
  return S.unit === "BW" ? d.map((x) => x / T.m.BW) : d;
}
function renderCharts() {
  const legs = S.leg === "B" ? ["L", "R"] : [S.leg];
  $("legLegend").innerHTML = S.leg === "B" ? `<i class="dash"></i>เส้นประ = ขาขวา` : "";
  for (const [key, , , stat] of CHARTS) {
    const series = [], toeOff = [], cursors = [];
    for (const T of types) for (const sd of legs) {
      const data = chartData(T, sd, key);
      series.push({ data, color: COLORS[T.i], dash: S.leg === "B" && sd === "R" ? [5, 4] : null, glow: T.i === 1, width: 2 });
      toeOff.push({ x: T.m.legs[sd].sf * 100, color: COLORS[T.i] });
      const p = frac(T.sim.phi + (sd === "L" ? 0.5 : 0)) * 100;
      cursors.push({ x: p, y: data[Math.round(p)], color: COLORS[T.i] });
    }
    const sd0 = legs[0];
    const a = chartData(types[0], sd0, key), b = chartData(types[1], sd0, key);
    const diff = S.diff ? b.map((v, i) => v - a[i]) : null;
    drawCompare($("ch_" + key), { series, toeOff, cursors, zero: key === "grf", diff });
    const [lab, va, u] = stat(a), [, vb] = stat(b);
    const unit = key === "grf" ? (S.unit === "BW" ? "×BW" : " N") : u;
    const f = (x) => (key === "grf" && S.unit === "N" ? x.toFixed(0) : x.toFixed(key === "grf" ? 2 : 1));
    $("v_" + key).innerHTML = `<span class="d">${lab} (${legLabel(types[0], sd0)}/${legLabel(types[1], sd0)})</span><span class="a">T1 ${f(va)}${unit}</span><span class="b">T2 ${f(vb)}${unit}</span><span class="d">Δ ${vb - va >= 0 ? "+" : ""}${f(vb - va)}${unit}</span>`;
  }
}

// ---------------------------------------------------------------- metrics
function metricsOf(T) {
  const m = T.m, L = m.legs.L, R = m.legs.R;
  const pk = (sd) => Math.max(...T.cur[sd].grf);
  return {
    "BMI (kg/m²)": [m.bmi, 1],
    "ความเร็ว (m/s)": [m.v, 2],
    "Cadence (ก้าว/นาที)": [m.cadence, 0],
    "ความยาวรอบก้าว (m)": [m.strideLen, 2],
    "เวลาต่อรอบ (s)": [m.T, 2],
    "Stance ซ้าย (%)": [L.sf * 100, 1],
    "Stance ขวา (%)": [R.sf * 100, 1],
    "ความไม่สมมาตรของ stance (%)": [(Math.abs(L.sf - R.sf) / (0.5 * (L.sf + R.sf))) * 100, 1],
    "Varus ตอน IC (°)": [T.cur.R.varus[0], 2],
    "Internal rotation สูงสุด (°)": [Math.max(...T.cur.R.ir), 1],
    "vGRF สูงสุด (N)": [Math.max(pk("L"), pk("R")), 0],
    "vGRF สูงสุด (×BW)": [Math.max(pk("L"), pk("R")) / m.BW, 2],
    "โมเมนต์หุบเข่า KAM (N·m)*": [(m.kamPct / 100) * m.BW * m.h, 0],
    "ความกว้างฐานก้าว (cm)*": [m.stepW * 100, 1],
  };
}
function renderMetrics() {
  if (!types.every((T) => T.m)) return;
  const a = metricsOf(types[0]), b = metricsOf(types[1]);
  $("metrics").innerHTML = `<thead><tr><th>ตัวชี้วัด</th><th class="a">TYPE 1</th><th class="b">TYPE 2</th><th>Δ</th></tr></thead><tbody>` +
    Object.keys(a).map((k) => {
      const [va, d] = a[k], [vb] = b[k], dv = vb - va;
      const cls = Math.abs(dv) < Math.pow(10, -d) ? "d" : dv > 0 ? "up" : "dn";
      return `<tr><td>${k}</td><td>${va.toFixed(d)}</td><td class="b">${vb.toFixed(d)}</td><td class="${cls}">${dv >= 0 ? "+" : ""}${dv.toFixed(d)}</td></tr>`;
    }).join("") + `<tr><td colspan="4" class="sub">* ค่าประมาณเชิงสาธิตตามแนวโน้มของ Ahsan (2022)</td></tr></tbody>`;
}

// ---------------------------------------------------------------- event simulation (TCN)
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function errs(T, sd, k) {
  const st = T.sim.stride[sd];
  if (!st[k]) {
    const r = rowFor(T, sd), q = (x) => Math.round(x / 0.005) * 0.005;
    st[k] = { ic: q(r[1] + (randn() * r[2]) / 1.349), fc: q(r[4] + (randn() * r[5]) / 1.349) };
    const keys = Object.keys(st); if (keys.length > 12) delete st[keys[0]];
  }
  return st[k];
}
const legPhase = (T, sd) => { const x = T.sim.phi + (sd === "L" ? 0.5 : 0); return { k: Math.floor(x), p: frac(x) }; };
function predContact(T, sd) {
  const { k, p } = legPhase(T, sd), L = T.m.legs[sd], P = T.m.T, tau = p * P;
  const e = errs(T, sd, k), en = errs(T, sd, k + 1);
  return (tau >= e.ic && tau < L.sf * P + e.fc) || tau >= P + en.ic ? 1 : 0;
}
function step(T, dt) {
  const sim = T.sim, m = T.m;
  const prev = { R: legPhase(T, "R"), L: legPhase(T, "L") };
  sim.phi += dt / m.T; sim.t += dt;
  const s = { t: sim.t };
  for (const sd of ["R", "L"]) {
    const cur = legPhase(T, sd), L = m.legs[sd];
    if (m.amp) {
      if (cur.k !== prev[sd].k) { const e = errs(T, sd, cur.k); sim.stats[sd].ic.push(e.ic); sim.marks[sd].push({ t: sim.t, type: "IC", e: e.ic }); }
      if (prev[sd].p < L.sf && cur.p >= L.sf && cur.k === prev[sd].k) { const e = errs(T, sd, cur.k); sim.stats[sd].fc.push(e.fc); sim.marks[sd].push({ t: sim.t, type: "FC", e: e.fc }); }
      for (const a of ["ic", "fc"]) if (sim.stats[sd][a].length > 400) sim.stats[sd][a].shift();
      while (sim.marks[sd].length && sim.marks[sd][0].t < sim.t - 4.5) sim.marks[sd].shift();
    }
    s["ref" + sd] = cur.p < L.sf ? 1 : 0;
    s["pre" + sd] = m.amp ? predContact(T, sd) : 0;
  }
  sim.hist.push(s);
  while (sim.hist.length && sim.hist[0].t < sim.t - 4.5) sim.hist.shift();
}
function renderEvents() {
  if (!types.every((T) => T.m)) return;
  const mae = (a) => (a.length ? a.reduce((s, x) => s + Math.abs(x), 0) / a.length : NaN);
  const med = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
  const f = (x) => (isNaN(x) ? "–" : (x * 1000).toFixed(1));
  let rows = "";
  for (const T of types) {
    if (!T.m.amp) { rows += `<tr><td colspan="5"><span style="color:${COLORS[T.i]}">TYPE ${T.i + 1}</span> <span class="sub">· ไม่ใช่โหมดขาเทียม จึงไม่มีการจำลอง TCN</span></td></tr>`; continue; }
    for (const sd of [T.m.ampSide, T.m.ampSide === "L" ? "R" : "L"]) {
      const r = rowFor(T, sd), st = T.sim.stats[sd];
      rows += `<tr><td><span style="color:${COLORS[T.i]}">T${T.i + 1}</span> ${legLabel(T, sd)} · ${r[0]} <span class="sub">n=${st.ic.length}</span></td><td>${f(med(st.ic))}</td><td>${f(mae(st.ic))} <span class="sub">/ ${(r[3] * 1000).toFixed(0)}</span></td><td>${f(med(st.fc))}</td><td>${f(mae(st.fc))} <span class="sub">/ ${(r[6] * 1000).toFixed(0)}</span></td></tr>`;
    }
  }
  $("events").innerHTML = `<thead><tr><th>ขา · ชุด IMU</th><th>IC median</th><th>IC MAE / paper</th><th>FC median</th><th>FC MAE / paper</th></tr></thead><tbody>${rows}<tr><td colspan="5" class="sub">หน่วย ms · error = t<sub>pred</sub> − t<sub>ref</sub> · ค่าจำลองควรเข้าใกล้ค่าในงานวิจัยเมื่อจำนวน n มากขึ้น</td></tr></tbody>`;
}
function renderContact() {
  const lanes = [];
  for (const T of types) for (const sd of ["L", "R"]) {
    lanes.push({ label: `T${T.i + 1} · ${legLabel(T, sd)}`, color: COLORS[T.i], pred: T.m.amp,
      hist: T.sim.hist.map((h) => ({ t: h.t, ref: h["ref" + sd], pre: h["pre" + sd] })), marks: T.sim.marks[sd] });
  }
  // align both types on the same time base
  const now = Math.max(types[0].sim.t, types[1].sim.t);
  const off = types.map((T) => now - T.sim.t);
  lanes.forEach((L, k) => { const o = off[k >> 1]; if (o) { L.hist = L.hist.map((h) => ({ ...h, t: h.t + o })); L.marks = L.marks.map((e) => ({ ...e, t: e.t + o })); } });
  drawContact($("contact"), lanes, now);
}

// ---------------------------------------------------------------- HUD readouts
function renderReadout(T) {
  const m = T.m, sc = scen(T.scen);
  const leg = (sd) => {
    const p = frac(T.sim.phi + (sd === "L" ? 0.5 : 0)), L = m.legs[sd], st = p < L.sf;
    return `<div class="ro-leg"><span class="lb">${legLabel(T, sd)}</span><div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i><u style="left:${(L.sf * 100).toFixed(1)}%"></u></div><span class="ph ${st ? "st" : ""}">${st ? "STANCE" : "SWING"} · ${phaseName(L, p)}</span></div>`;
  };
  $("ro" + T.i).innerHTML = `<div class="ro-h"><span class="ro-k"><b>TYPE ${T.i + 1}</b> · ${sc ? sc.tag : "CUSTOM"}</span><span class="ro-k">BMI ${m.bmi.toFixed(1)}</span></div>
    <div class="ro-n">${sc ? sc.name : m.subj ? "ผู้เข้าร่วม " + m.subj.id : "กำหนดเอง"}</div>
    <div class="ro-stats"><span><b>${m.v.toFixed(2)}</b> m/s</span><span><b>${m.cadence.toFixed(0)}</b> spm</span><span><b>${(m.legs.L.sf * 100).toFixed(0)}/${(m.legs.R.sf * 100).toFixed(0)}</b> %st</span></div>
    ${leg("L")}${leg("R")}`;
}

// ---------------------------------------------------------------- loop
const tmp = new THREE.Vector3();
function animateFigure(T, dt) {
  const m = T.m, fig = T.fig, sim = T.sim;
  if (dt > 0) { const n = 4; for (let k = 0; k < n; k++) step(T, dt / n); }
  const pR = frac(sim.phi), pL = frac(sim.phi + 0.5);
  fig.pose(m, pR, pL, S.exag);
  fig.ground(GROUND);
  // foot lock: belt follows the planted contact point
  const ph = { R: pR, L: pL };
  const stance = ["R", "L"].filter((sd) => ph[sd] < m.legs[sd].sf);
  let lock = null;
  if (stance.length) {
    const sd = stance.sort((a, b) => (m.legs[b].sf - ph[b]) - (m.legs[a].sf - ph[a]))[0];
    const c = fig.contacts(sd);
    const key = ["heel", "ball", "tip"].reduce((a, k) => (c[k].y < c[a].y ? k : a), "heel");
    lock = { sd, key, x: c[key].x };
  }
  const mill = stage.mills[T.i];
  if (lock && sim.lock && sim.lock.sd === lock.sd && sim.lock.key === lock.key && dt > 0) {
    const dx = lock.x - sim.lock.x;
    if (Math.abs(dx) < 0.2) { mill.move(dx); if (S.view === "ghost" && T.i === 0) stage.mills[1].move(dx); }
  } else if (dt > 0 && !lock) mill.move(-m.v * dt);
  sim.lock = lock;
  // GRF arrows
  for (const sd of ["R", "L"]) {
    const L = m.legs[sd], p = ph[sd];
    if (p < L.sf) {
      const s = p / L.sf, c = fig.contacts(sd);
      tmp.copy(c.heel).lerp(c.ball, Math.min(1, s * 1.15));
      stage.setArrow(T.i, sd, true, tmp, grf(L, p, m.BW), m.BW, s);
    } else stage.setArrow(T.i, sd, false);
  }
}

let last = performance.now(), frameN = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const T of pending) recompute(T);
  pending.clear();
  const sdt = S.playing ? dt * S.anim : 0;
  for (const T of types) animateFigure(T, sdt);
  stage.update(dt, types, now / 1000);
  stage.render();
  frameN++;
  if (frameN % 2 === 0) { renderCharts(); renderContact(); }
  if (frameN % 6 === 0) types.forEach(renderReadout);
  if (frameN % 30 === 0) renderEvents();
  requestAnimationFrame(frame);
}

types.forEach((T) => { wireCfg(T); recompute(T); renderCfg(T); });
renderMetrics(); renderEvents(); renderCharts(); types.forEach(renderReadout);
requestAnimationFrame(frame);
window.__gait = { types, stage, S };
