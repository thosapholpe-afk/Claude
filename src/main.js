import * as THREE from "three";
import { Stage, GROUND } from "./stage.js";
import { Mannequin } from "./figure.js";
import { model, curves, grf, phaseName, frac, COEF_DEFAULT } from "./model.js";
import { SCENARIOS, SUBJECTS, T6 } from "./data.js";
import { MUSCLES, MUSCLE, emgCurves, actNow, rawWindow } from "./emg.js";
import { drawCompare, drawContact, drawScope, drawMatrix, C1, C2 } from "./charts.js";

const $ = (id) => document.getElementById(id);
const COLORS = [C1, C2];
const coef = { ...COEF_DEFAULT };
const S = {
  env: "lab", view: "lanes", focus: 0, ghostOther: false, playing: true, anim: 1, exag: 1, leg: "L", unit: "N", diff: false,
  emg: true, grf: true, wind: 1, orbit: false, muscle: "VAS", emgSide: "L", selFig: 0, selected: false,
};
const ENV_NAMES = { lab: "ห้องแล็บ · DUAL-BELT TREADMILL", garden: "สวน · GARDEN", beach: "ชายหาด · BEACH", factory: "โรงงาน · FACTORY", snow: "หิมะ · SNOW FIELD" };

const newSim = (phi) => ({ phi, t: 0, hist: [], marks: { R: [], L: [] }, stride: { R: {}, L: {} }, stats: { R: { ic: [], fc: [] }, L: { ic: [], fc: [] } }, lock: null });
const scen = (id) => SCENARIOS.find((s) => s.id === id);
const types = [0, 1].map((i) => {
  const sc = scen(i ? "ampL" : "healthy");
  return { i, scen: sc.id, cfg: { ...sc.cfg }, imuAmp: 6, imuSou: 7, sim: newSim(i ? 0.37 : 0), fig: new Mannequin(i ? "cobalt" : "ice") };
});

const stage = new Stage($("gl"));
types.forEach((T) => stage.lanes[T.i].add(T.fig.root));

// ---------------------------------------------------------------- model
const legLabel = (T, sd) => (T.m.amp ? (sd === T.m.ampSide ? "AMP" : "SOU") : sd === "L" ? "ซ้าย" : "ขวา");
const sideName = (T, sd) => (sd === "L" ? "ขาซ้าย" : "ขาขวา") + (T.m.amp ? (sd === T.m.ampSide ? " (ขาเทียม)" : " (ขาดี)") : "");
const rowFor = (T, sd) => (sd === T.m.ampSide ? T6.AMP[T.imuAmp] : T6.SOU[T.imuSou]);
function recompute(T) {
  T.m = model(T.cfg, coef);
  T.cur = curves(T.m);
  T.emg = emgCurves(T.m);
  T.fig.build(T.m);
  const codes = new Set();
  if (T.m.amp) for (const sd of ["L", "R"]) rowFor(T, sd)[0].split("+").forEach((c) => codes.add(c));
  T.fig.setIMUs(codes);
  updateLayout();
  stage.applyEnvIntensity();
  updateCfgOutputs(T);
  renderMetrics();
  renderEvents();
  renderMuscleInfo();
}
function resetEvents(T) { const { phi, t } = T.sim; T.sim = newSim(phi); T.sim.t = t; }

function updateLayout() {
  const lab = S.env === "lab";
  if (lab) {
    const merged = S.view === "ghost";
    stage.setLayout(merged ? [[0, 0, 0], [0, 0, 0]] : [[-1.3, 0, -0.6], [1.3, 0, 0.6]], merged);
    types[0].fig.root.visible = true; types[1].fig.root.visible = true;
    if (types[0].fig.ghost) types[0].fig.setGhost(false);
    if (types[1].fig.ghost !== merged) types[1].fig.setGhost(merged);
  } else {
    stage.setLayout([[0, 0, 0], [0, 0, 0]], true);
    const f = types[S.focus], o = types[1 - S.focus];
    f.fig.root.visible = true; if (f.fig.ghost) f.fig.setGhost(false);
    o.fig.root.visible = S.ghostOther; if (!o.fig.ghost) o.fig.setGhost(true);
    o.sim.lock = null;
  }
  stage.pickables = types.filter((T) => T.fig.root.visible && !T.fig.ghost && T.fig.pickables).flatMap((T) => T.fig.pickables);
  $("viewSeg").hidden = !lab; $("focusSeg").hidden = lab; $("ghostTog").hidden = lab;
  $("windLbl").classList.toggle("off", !(stage.env && stage.env.windy));
}

// ---------------------------------------------------------------- config UI
const bmiCat = (b) => (b < 18.5 ? "น้ำหนักน้อย" : b < 25 ? "ปกติ" : b < 30 ? "น้ำหนักเกิน" : "อ้วน");
function renderCfg(T) {
  const c = T.cfg, el = $("cfg" + T.i), amp = c.mode !== "normal", sc = scen(T.scen);
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
  const w = el.querySelector('[data-o="warn"]'), msgs = [];
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
    pending.add(T);
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

// ---------------------------------------------------------------- global controls
function segGroup(id, fn) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    fn(b.dataset.v);
  });
}
function setEnv(id) {
  S.env = id;
  $("envSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === id));
  $("ldName").textContent = ENV_NAMES[id];
  $("loader").classList.add("show");
  setTimeout(() => {
    stage.setEnv(id);
    types.forEach((T) => { T.sim.lock = null; });
    updateLayout();
    stage.applyEnvIntensity();
    if (id !== "lab") stage.view(document.querySelector("#camSeg .on")?.dataset.v || "cine");
    setTimeout(() => $("loader").classList.remove("show"), 120);
  }, 60);
}
$("envSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.v !== S.env) setEnv(b.dataset.v); });
segGroup("viewSeg", (v) => { S.view = v; updateLayout(); });
segGroup("focusSeg", (v) => { S.focus = +v; types.forEach((T) => (T.sim.lock = null)); updateLayout(); });
segGroup("camSeg", (v) => stage.view(v));
segGroup("legSeg", (v) => { S.leg = v; });
segGroup("unitSeg", (v) => { S.unit = v; });
segGroup("diffSeg", (v) => { S.diff = v === "1"; });
segGroup("emgSideSeg", (v) => { S.emgSide = v; renderMuscleInfo(); });
const toggle = (id, key, after) => $(id).addEventListener("click", () => { S[key] = !S[key]; $(id).classList.toggle("on", S[key]); after && after(); });
toggle("ghostTog", "ghostOther", () => updateLayout());
toggle("orbitTog", "orbit", () => { stage.controls.autoRotate = S.orbit; });
toggle("emgTog", "emg", () => updateHint());
toggle("grfTog", "grf");
$("anim").addEventListener("input", (e) => { S.anim = +e.target.value; $("animOut").textContent = S.anim.toFixed(2) + "×"; });
$("exag").addEventListener("input", (e) => { S.exag = +e.target.value; $("exagOut").textContent = S.exag + "×"; });
$("wind").addEventListener("input", (e) => { S.wind = +e.target.value; $("windOut").textContent = S.wind.toFixed(1); });
const setPlay = (p) => { S.playing = p; $("playBtn").firstElementChild.className = S.playing ? "i-pause" : "i-play"; };
$("playBtn").addEventListener("click", () => setPlay(!S.playing));
window.addEventListener("keydown", (e) => {
  if (e.target.closest("input,select,textarea")) return;
  if (e.code === "Space") { e.preventDefault(); setPlay(!S.playing); }
  const envKeys = { Digit1: "lab", Digit2: "garden", Digit3: "beach", Digit4: "factory", Digit5: "snow" };
  if (envKeys[e.code] && envKeys[e.code] !== S.env) setEnv(envKeys[e.code]);
});

const COEF_FIELDS = [["var", "Varus ตอน IC ต่อ BMI +1 (°)", 0.01], ["ir", "Internal rotation ต่อ BMI +1 (°)", 0.05], ["ref", "BMI อ้างอิง (kg/m²)", 0.1], ["varAge", "Varus ต่ออายุ +1 ปี (°)", 0.01], ["varSex", "Varus ส่วนต่างเพศหญิง (°)", 0.1], ["irAge", "IR ต่ออายุ +1 ปี (°)", 0.01], ["irSex", "IR ส่วนต่างเพศหญิง (°)", 0.1]];
$("coef").innerHTML = COEF_FIELDS.map(([k, l, s]) => `<span>${l}</span><input type="number" step="${s}" data-c="${k}" value="${coef[k]}">`).join("");
$("coef").addEventListener("input", (e) => { const k = e.target.dataset.c; if (!k) return; const v = parseFloat(e.target.value); coef[k] = isNaN(v) ? COEF_DEFAULT[k] : v; types.forEach(recompute); });

// ---------------------------------------------------------------- muscles / EMG UI
function buildMuscleList() {
  const groups = [...new Set(MUSCLES.map((m) => m.region))];
  $("mlist").innerHTML = groups.map((g) => `<div class="mgrp">${g}</div>` + MUSCLES.filter((m) => m.region === g).map((m) => `<button class="mb" data-m="${m.id}"><span class="ab">${m.abbr}</span><span class="nm">${m.en}</span><span class="bb"><span><i></i></span><span><i></i></span></span></button>`).join("")).join("");
  $("mlist").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) selectMuscle(b.dataset.m, null); });
  for (const i of [0, 1]) $("mat" + i).addEventListener("click", (e) => {
    const c = e.currentTarget, L = c._layout; if (!L) return;
    const y = e.clientY - c.getBoundingClientRect().top, k = Math.floor((y - L.pt) / L.rowH);
    if (k >= 0 && k < L.n) selectMuscle(L.ids[k], null);
  });
}
function selectMuscle(id, side, fig = null) {
  S.muscle = id; if (side) S.emgSide = side;
  if (fig !== null) S.selFig = fig;
  S.selected = true;
  if (!S.emg) { S.emg = true; $("emgTog").classList.add("on"); }
  renderMuscleInfo(); updateHint();
}
function renderMuscleInfo() {
  if (!types.every((T) => T.emg)) return;
  const mu = MUSCLE[S.muscle], sd = S.emgSide;
  $("mAb").textContent = `${mu.abbr} · ${mu.region}`; $("mN").textContent = mu.en; $("mTh").textContent = mu.th; $("mFn").textContent = mu.fn;
  const notes = [];
  for (const T of types) {
    const pr = T.emg.prof[sd][mu.id];
    for (const n of pr.notes) notes.push(`<span><b style="color:${COLORS[T.i]}">T${T.i + 1}</b>${n}</span>`);
  }
  $("mNotes").innerHTML = notes.length ? notes.join("") : `<span>ทั้งสองคนใช้รูปแบบการทำงานปกติ (ปรับตามความเร็วการเดิน)</span>`;
  $("mlist").querySelectorAll(".mb").forEach((b) => b.classList.toggle("on", b.dataset.m === mu.id));
  $("emgSideSeg").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.v === sd);
    const tags = types.filter((T) => T.m.amp).map((T) => `T${T.i + 1} ${legLabel(T, b.dataset.v)}`);
    b.textContent = (b.dataset.v === "L" ? "ขาซ้าย" : "ขาขวา") + (tags.length ? ` · ${tags.join(", ")}` : "");
  });
  $("mhud").hidden = !S.selected;
  $("mhK").textContent = `${mu.abbr} · ${sd === "L" ? "LEFT" : "RIGHT"} · LIVE EMG`;
  $("mhN").textContent = mu.en; $("mhTh").textContent = mu.th; $("mhFn").textContent = mu.fn;
}
$("mhX").addEventListener("click", () => { S.selected = false; renderMuscleInfo(); updateHint(); });
function updateHint() { $("hint").classList.toggle("off", S.selected || !S.emg); }
stage.onPick = (ud) => {
  if (!ud || !ud.muscle) { if (S.selected) { S.selected = false; renderMuscleInfo(); updateHint(); } return; }
  selectMuscle(ud.muscle, ud.side, types.findIndex((T) => T.fig === ud.figure));
};
stage.onHover = (ud, e) => {
  const tip = $("htip");
  if (!ud || !ud.muscle) { tip.classList.remove("show"); return; }
  const T = types.find((X) => X.fig === ud.figure), mu = MUSCLE[ud.muscle], hr = $("hero").getBoundingClientRect();
  tip.textContent = `${mu.abbr} · ${mu.en} · T${T.i + 1} ${sideName(T, ud.side)}`;
  tip.style.left = e.clientX - hr.left + "px"; tip.style.top = e.clientY - hr.top + "px";
  tip.classList.add("show");
};

let acts = [null, null];
function updateMuscleLive() {
  const id = S.muscle, sd = S.emgSide;
  $("mhBars").innerHTML = types.map((T) => {
    const pr = T.emg.prof[sd][id], a = acts[T.i][sd][id];
    return `<div class="mh-bar"><span style="color:${COLORS[T.i]}">T${T.i + 1}</span><span class="tr"><i style="width:${pr.absent ? 0 : Math.min(100, (a / 0.6) * 100)}%;background:${COLORS[T.i]}"></i></span><b style="color:${COLORS[T.i]}">${pr.absent ? "ไม่มี" : Math.round(a * 100) + "%"}</b></div>`;
  }).join("");
  $("mlist").querySelectorAll(".mb").forEach((b) => {
    const is = b.querySelectorAll(".bb i");
    types.forEach((T, k) => { is[k].style.width = Math.min(100, (acts[T.i][sd][b.dataset.m] / 0.6) * 100) + "%"; });
  });
}
function scopeTraces(win, sd, id) {
  return types.map((T) => {
    const w = rawWindow(T.m, T.emg.prof, sd, id, T.sim.phi, T.sim.t, win, 17 + T.i * 101);
    return { raw: w.raw, env: w.env, color: COLORS[T.i], label: `TYPE ${T.i + 1}`, sub: sideName(T, sd), absent: T.emg.prof[sd][id].absent };
  });
}
function renderEMG() {
  const sd = S.emgSide, id = S.muscle;
  const series = types.map((T) => ({ data: T.emg.curves[sd][id], color: COLORS[T.i], glow: T.i === 1, width: 2.2, fill: T.i === 1 ? "rgba(56,198,255,0.20)" : "rgba(232,244,255,0.10)" }));
  let mx = 0.25;
  for (const s of series) for (const v of s.data) mx = Math.max(mx, v);
  const ph = (T) => frac(T.sim.phi + (sd === "L" ? 0.5 : 0)) * 100;
  drawCompare($("envChart"), {
    series, bands: true, lo: 0, hi: mx * 1.15, pct: true,
    cursors: types.map((T) => ({ x: ph(T), y: T.emg.curves[sd][id][Math.round(ph(T))], color: COLORS[T.i] })),
    toeOff: types.map((T) => ({ x: T.m.legs[sd].sf * 100, color: COLORS[T.i] })),
  });
  drawScope($("scope"), scopeTraces(3, sd, id), { win: 3, now: types[0].sim.t, scale: 1.6 });
  types.forEach((T) => drawMatrix($("mat" + T.i), {
    rows: MUSCLES.map((mu) => ({ id: mu.id, label: mu.abbr, data: T.emg.curves[sd][mu.id], absent: T.emg.prof[sd][mu.id].absent })),
    cursor: ph(T), sel: id, title: `TYPE ${T.i + 1} · ${sideName(T, sd)}`, color: COLORS[T.i],
  }));
}

// ---------------------------------------------------------------- compare charts
const CHARTS = [
  ["hip", "สะโพก · Hip flexion", "องศา · sagittal", (a) => ["ROM", Math.max(...a) - Math.min(...a), "°"]],
  ["knee", "เข่า · Knee flexion", "องศา · sagittal", (a) => ["งอสูงสุด", Math.max(...a), "°"]],
  ["ank", "ข้อเท้า · Dorsi(+)/Plantar(−)", "องศา · sagittal", (a) => ["plantar สูงสุด", Math.min(...a), "°"]],
  ["varus", "เข่าโก่ง · Knee varus (+)", "องศา · frontal", (a) => ["ตอน IC", a[0], "°"]],
  ["ir", "เข่าบิดเข้าใน · Internal rotation", "องศา · transverse", (a) => ["สูงสุด", Math.max(...a), "°"]],
  ["grf", "แรงปฏิกิริยาพื้น · vGRF", "ช่วง stance", (a) => ["สูงสุด", Math.max(...a), ""]],
];
$("charts").innerHTML = CHARTS.map(([k, t, s]) => `<div class="ch"><div class="t">${t}</div><div class="s">${s}</div><div class="v" id="v_${k}"></div><canvas id="ch_${k}"></canvas></div>`).join("");
const chartData = (T, sd, key) => { const d = T.cur[sd][key]; return key === "grf" && S.unit === "BW" ? d.map((x) => x / T.m.BW) : d; };
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
    const sd0 = legs[0], a = chartData(types[0], sd0, key), b = chartData(types[1], sd0, key);
    drawCompare($("ch_" + key), { series, toeOff, cursors, zero: key === "grf", diff: S.diff ? b.map((v, i) => v - a[i]) : null });
    const [lab, va, u] = stat(a), [, vb] = stat(b);
    const unit = key === "grf" ? (S.unit === "BW" ? "×BW" : " N") : u;
    const f = (x) => (key === "grf" && S.unit === "N" ? x.toFixed(0) : x.toFixed(key === "grf" ? 2 : 1));
    $("v_" + key).innerHTML = `<span class="d">${lab} (${legLabel(types[0], sd0)}/${legLabel(types[1], sd0)})</span><span class="a">T1 ${f(va)}${unit}</span><span class="b">T2 ${f(vb)}${unit}</span><span class="d">Δ ${vb - va >= 0 ? "+" : ""}${f(vb - va)}${unit}</span>`;
  }
}

// ---------------------------------------------------------------- metrics
function metricsOf(T) {
  const m = T.m, L = m.legs.L, R = m.legs.R, pk = (sd) => Math.max(...T.cur[sd].grf);
  return {
    "BMI (kg/m²)": [m.bmi, 1], "ความเร็ว (m/s)": [m.v, 2], "Cadence (ก้าว/นาที)": [m.cadence, 0], "ความยาวรอบก้าว (m)": [m.strideLen, 2], "เวลาต่อรอบ (s)": [m.T, 2],
    "Stance ซ้าย (%)": [L.sf * 100, 1], "Stance ขวา (%)": [R.sf * 100, 1], "ความไม่สมมาตรของ stance (%)": [(Math.abs(L.sf - R.sf) / (0.5 * (L.sf + R.sf))) * 100, 1],
    "Varus ตอน IC (°)": [T.cur.R.varus[0], 2], "Internal rotation สูงสุด (°)": [Math.max(...T.cur.R.ir), 1],
    "vGRF สูงสุด (N)": [Math.max(pk("L"), pk("R")), 0], "vGRF สูงสุด (×BW)": [Math.max(pk("L"), pk("R")) / m.BW, 2],
    "EMG สูงสุด GMAX ขาซ้าย (%MVC)": [Math.max(...T.emg.curves.L.GMAX) * 100, 0], "EMG สูงสุด VAS ขาซ้าย (%MVC)": [Math.max(...T.emg.curves.L.VAS) * 100, 0],
    "โมเมนต์หุบเข่า KAM (N·m)*": [(m.kamPct / 100) * m.BW * m.h, 0], "ความกว้างฐานก้าว (cm)*": [m.stepW * 100, 1],
  };
}
function renderMetrics() {
  if (!types.every((T) => T.m && T.emg)) return;
  const a = metricsOf(types[0]), b = metricsOf(types[1]);
  $("metrics").innerHTML = `<thead><tr><th>ตัวชี้วัด</th><th class="a">TYPE 1</th><th class="b">TYPE 2</th><th>Δ</th></tr></thead><tbody>` +
    Object.keys(a).map((k) => {
      const [va, d] = a[k], [vb] = b[k], dv = vb - va, cls = Math.abs(dv) < Math.pow(10, -d) ? "d" : dv > 0 ? "up" : "dn";
      return `<tr><td>${k}</td><td>${va.toFixed(d)}</td><td class="b">${vb.toFixed(d)}</td><td class="${cls}">${dv >= 0 ? "+" : ""}${dv.toFixed(d)}</td></tr>`;
    }).join("") + `<tr><td colspan="4" class="sub">* ค่าประมาณเชิงสาธิตตามแนวโน้มของ Ahsan (2022) · EMG เป็นค่าจำลอง</td></tr></tbody>`;
}

// ---------------------------------------------------------------- TCN event simulation
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
  const { k, p } = legPhase(T, sd), L = T.m.legs[sd], P = T.m.T, tau = p * P, e = errs(T, sd, k), en = errs(T, sd, k + 1);
  return (tau >= e.ic && tau < L.sf * P + e.fc) || tau >= P + en.ic ? 1 : 0;
}
function step(T, dt) {
  const sim = T.sim, m = T.m, prev = { R: legPhase(T, "R"), L: legPhase(T, "L") };
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
  for (const T of types) for (const sd of ["L", "R"]) lanes.push({ label: `T${T.i + 1} · ${legLabel(T, sd)}`, color: COLORS[T.i], pred: T.m.amp, hist: T.sim.hist.map((h) => ({ t: h.t, ref: h["ref" + sd], pre: h["pre" + sd] })), marks: T.sim.marks[sd] });
  drawContact($("contact"), lanes, types[0].sim.t);
}

// ---------------------------------------------------------------- HUD readouts
function renderReadout(T) {
  const m = T.m, sc = scen(T.scen);
  const leg = (sd) => {
    const p = frac(T.sim.phi + (sd === "L" ? 0.5 : 0)), L = m.legs[sd], st = p < L.sf;
    return `<div class="ro-leg"><span class="lb">${legLabel(T, sd)}</span><div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i><u style="left:${(L.sf * 100).toFixed(1)}%"></u></div><span class="ph ${st ? "st" : ""}">${st ? "STANCE" : "SWING"} · ${phaseName(L, p)}</span></div>`;
  };
  const top = [];
  if (acts[T.i]) for (const sd of ["L", "R"]) for (const [id, a] of Object.entries(acts[T.i][sd])) top.push([a, `${MUSCLE[id].abbr}·${sd}`]);
  top.sort((a, b) => b[0] - a[0]);
  const el = $("ro" + T.i);
  el.classList.toggle("dim", !T.fig.root.visible);
  el.innerHTML = `<div class="ro-h"><span class="ro-k"><b>TYPE ${T.i + 1}</b> · ${sc ? sc.tag : "CUSTOM"}</span><span class="ro-k">BMI ${m.bmi.toFixed(1)}</span></div>
    <div class="ro-n">${sc ? sc.name : m.subj ? "ผู้เข้าร่วม " + m.subj.id : "กำหนดเอง"}</div>
    <div class="ro-stats"><span><b>${m.v.toFixed(2)}</b> m/s</span><span><b>${m.cadence.toFixed(0)}</b> spm</span><span><b>${(m.legs.L.sf * 100).toFixed(0)}/${(m.legs.R.sf * 100).toFixed(0)}</b> %st</span></div>
    ${leg("L")}${leg("R")}
    <div class="ro-emg">EMG ▸ ${top.slice(0, 3).map(([a, n]) => `<span>${n} <b>${Math.round(a * 100)}%</b></span>`).join("")}</div>`;
}

// ---------------------------------------------------------------- callout
const cv = new THREE.Vector3();
function updateCallout() {
  const svg = $("callout");
  if (!S.selected || window.innerWidth <= 900 || $("mhud").hidden) { svg.style.display = "none"; return; }
  let T = types[S.selFig];
  if (!T || !T.fig.root.visible || T.fig.ghost) T = types.find((X) => X.fig.root.visible && !X.fig.ghost);
  const p = T && T.fig.anchorWorld(S.muscle, S.emgSide, cv);
  if (!p) { svg.style.display = "none"; return; }
  p.project(stage.camera);
  if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) { svg.style.display = "none"; return; }
  const hr = $("hero").getBoundingClientRect(), cr = $("gl").getBoundingClientRect(), mr = $("mhud").getBoundingClientRect();
  const x = (p.x * 0.5 + 0.5) * cr.width + (cr.left - hr.left), y = (-p.y * 0.5 + 0.5) * cr.height + (cr.top - hr.top);
  const ax = mr.left - hr.left, ay = mr.top - hr.top + 34;
  $("cLine").setAttribute("points", `${x.toFixed(1)},${y.toFixed(1)} ${(ax - 36).toFixed(1)},${ay.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`);
  for (const id of ["cDot", "cRing"]) { $(id).setAttribute("cx", x.toFixed(1)); $(id).setAttribute("cy", y.toFixed(1)); }
  svg.style.display = "";
}

// ---------------------------------------------------------------- figure animation
const tmp = new THREE.Vector3();
function animateFigure(T, dt) {
  const m = T.m, fig = T.fig, sim = T.sim, env = stage.env;
  const prev = { R: legPhase(T, "R"), L: legPhase(T, "L") };
  if (dt > 0) { const n = 4; for (let k = 0; k < n; k++) step(T, dt / n); }
  if (!fig.root.visible || !env) { stage.setArrow(T.i, "R", false); stage.setArrow(T.i, "L", false); return; }
  const pR = frac(sim.phi), pL = frac(sim.phi + 0.5), ph = { R: pR, L: pL };
  fig.pose(m, pR, pL, S.exag);
  const lab = env.treadmill, focus = !lab && T.i === S.focus;
  const sink = lab ? 0 : env.sink(types[S.focus].m);
  fig.ground(GROUND - sink);
  if (lab || focus) {
    const stance = ["R", "L"].filter((sd) => ph[sd] < m.legs[sd].sf);
    let lock = null;
    if (stance.length) {
      const sd = stance.sort((a, b) => (m.legs[b].sf - ph[b]) - (m.legs[a].sf - ph[a]))[0];
      const c = fig.contacts(sd), key = ["heel", "ball", "tip"].reduce((a, k) => (c[k].y < c[a].y ? k : a), "heel");
      lock = { sd, key, x: c[key].x - stage.lanes[T.i].position.x };
    }
    if (lock && sim.lock && sim.lock.sd === lock.sd && sim.lock.key === lock.key && dt > 0) {
      const dx = lock.x - sim.lock.x;
      if (Math.abs(dx) < 0.2) {
        if (lab) { env.mills[T.i].move(dx); if (S.view === "ghost" && T.i === 0) env.mills[1].move(dx); }
        else env.scroll(dx);
      }
    }
    sim.lock = lock;
  }
  if (focus && dt > 0) {
    for (const sd of ["R", "L"]) {
      const cur = legPhase(T, sd), L = m.legs[sd];
      if (cur.k !== prev[sd].k) env.onStep({ type: "IC", side: sd, fig, m });
      else if (prev[sd].p < L.sf && cur.p >= L.sf) env.onStep({ type: "TO", side: sd, fig, m });
      if (cur.p < L.sf) env.stamp(fig, m, sd);
    }
  }
  for (const sd of ["R", "L"]) {
    const L = m.legs[sd], p = ph[sd];
    if (S.grf && (lab || focus) && p < L.sf) {
      const s = p / L.sf, c = fig.contacts(sd);
      tmp.copy(c.heel).lerp(c.ball, Math.min(1, s * 1.15)); tmp.y = GROUND - sink + 0.004;
      stage.setArrow(T.i, sd, true, tmp, grf(L, p, m.BW), m.BW, s);
    } else stage.setArrow(T.i, sd, false);
  }
}

// ---------------------------------------------------------------- loop
const vis = { hero: true, cmp: false, emg: false, tcn: false };
const io = new IntersectionObserver((ents) => { for (const e of ents) vis[e.target.dataset.vis] = e.isIntersecting; }, { rootMargin: "100px" });
[["hero", "hero"], ["cmpSec", "cmp"], ["emgSec", "emg"], ["tcnSec", "tcn"]].forEach(([id, k]) => { $(id).dataset.vis = k; io.observe($(id)); });

let last = performance.now(), frameN = 0, envT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const T of pending) recompute(T);
  pending.clear();
  const sdt = S.playing ? dt * S.anim : 0;
  envT += sdt;
  stage.U.uWind.value = S.wind * (0.8 + 0.25 * Math.sin(envT * 0.37) + 0.35 * Math.max(0, Math.sin(envT * 1.3) * Math.sin(envT * 0.21)));
  for (const T of types) animateFigure(T, sdt);
  acts = types.map((T) => ({ L: actNow(T.m, T.emg.prof, "L", frac(T.sim.phi + 0.5)), R: actNow(T.m, T.emg.prof, "R", frac(T.sim.phi)) }));
  types.forEach((T, i) => T.fig.applyEMG(acts[i], S.emg, S.selected ? { group: S.muscle, side: S.emgSide } : null, envT));
  stage.update(dt, envT, { figVisible: types.map((T) => T.fig.root.visible), focusFig: S.env !== "lab" ? types[S.focus].fig : null, envDt: sdt });
  if (vis.hero) stage.render();
  updateCallout();
  frameN++;
  if (frameN % 2 === 0) {
    if (vis.cmp) renderCharts();
    if (vis.tcn) renderContact();
    if (vis.emg) renderEMG();
    if (S.selected && !$("mhud").hidden) drawScope($("mhScope"), scopeTraces(2, S.emgSide, S.muscle), { win: 2, now: types[0].sim.t, scale: 1.6, compact: true });
  }
  if (frameN % 4 === 0) updateMuscleLive();
  if (frameN % 6 === 0) types.forEach(renderReadout);
  if (frameN % 30 === 0) renderEvents();
  requestAnimationFrame(frame);
}

buildMuscleList();
stage.setEnv("lab");
types.forEach((T) => { wireCfg(T); recompute(T); renderCfg(T); });
acts = types.map((T) => ({ L: actNow(T.m, T.emg.prof, "L", 0.5), R: actNow(T.m, T.emg.prof, "R", 0) }));
renderMetrics(); renderEvents(); renderCharts(); renderMuscleInfo(); updateHint(); updateMuscleLive();
types.forEach(renderReadout);
requestAnimationFrame(frame);
window.__gait = {
  types, stage, S, setEnv, selectMuscle,
  advance(sec, fps = 60) {
    for (let k = 0, n = Math.round(sec * fps); k < n; k++) {
      const d = (1 / fps) * S.anim; envT += d;
      for (const T of types) animateFigure(T, d);
      stage.update(0, envT, { figVisible: types.map((T) => T.fig.root.visible), focusFig: S.env !== "lab" ? types[S.focus].fig : null, envDt: d });
    }
  },
};
