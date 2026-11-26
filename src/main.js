import * as THREE from "three";
import { Stage, GROUND } from "./stage.js";
import { Human } from "./human.js";
import { model, curves, grf, phaseName, frac, COEF_DEFAULT } from "./model.js";
import { SCENARIOS, SUBJECTS, T6 } from "./data.js";
import { MUSCLES, MUSCLE, emgCurves, actNow, rawWindow } from "./emg.js";
import { drawCompare, drawContact, drawScope, drawMatrix, attachHover } from "./charts.js";

const $ = (id) => document.getElementById(id);
// categorical palette (validated for the dark navy surface, fixed order, never cycled)
const PALETTE = ["#338ced", "#e76624", "#00a888", "#d28e05", "#e24d8b", "#0aac23"];
const MAX = 6;
const coef = { ...COEF_DEFAULT };
const S = {
  env: "lab", view: "lanes", focus: null, ghostOthers: false, playing: true, anim: 1, exag: 1, leg: "L", unit: "N",
  emg: false, grf: true, wind: 1, orbit: false, muscle: "VAS", emgSide: "L", selUid: null, selected: false, cam: "cine", merged: false,
};
const ENV_NAMES = { lab: "ห้องแล็บ · DUAL-BELT TREADMILL", garden: "สวน · GARDEN", beach: "ชายหาด · BEACH", factory: "โรงงาน · FACTORY", snow: "หิมะ · SNOW FIELD" };
const scen = (id) => SCENARIOS.find((s) => s.id === id);
const newSim = (phi) => ({ phi, t: 0, hist: [], marks: { R: [], L: [] }, stride: { R: {}, L: {} }, stats: { R: { ic: [], fc: [] }, L: { ic: [], fc: [] } }, lock: null });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let stage = null;
let people = [], uidSeq = 1;
const byUid = (u) => people.find((p) => p.uid === u);
const shown = () => people.filter((p) => p.show);
const legLabel = (p, sd) => (p.m.amp ? (sd === p.m.ampSide ? "AMP" : "SOU") : sd === "L" ? "ซ้าย" : "ขวา");
const sideName = (p, sd) => (sd === "L" ? "ขาซ้าย" : "ขาขวา") + (p.m.amp ? (sd === p.m.ampSide ? " (ขาเทียม)" : " (ขาดี)") : "");
const rowFor = (p, sd) => (sd === p.m.ampSide ? T6.AMP[p.imuAmp] : T6.SOU[p.imuSou]);

// ---------------------------------------------------------------- people
function addPerson(scId, extra = {}) {
  if (people.length >= MAX) return null;
  const used = new Set(people.map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const sc = scen(scId);
  const ref = people[0];
  const p = {
    uid: uidSeq++, slot, color: PALETTE[slot], name: extra.name || sc.name, scen: sc.id, cfg: { ...sc.cfg }, imuAmp: 6, imuSou: 7, show: true,
    sim: newSim(ref ? (ref.sim.phi + 0.27 * people.length) : 0.13 * slot), fig: new Human(PALETTE[slot], slot % 4), lane: new THREE.Group(), laneTarget: new THREE.Vector3(),
  };
  if (ref) p.sim.t = ref.sim.t;
  p.lane.add(p.fig.root);
  stage.scene.add(p.lane);
  people.push(p);
  if (S.focus === null) S.focus = p.uid;
  if (S.selUid === null) S.selUid = p.uid;
  recompute(p);
  return p;
}
function removePerson(uid) {
  const p = byUid(uid);
  if (!p || people.length <= 1) return;
  p.fig.dispose(); p.lane.removeFromParent(); stage.removeArrows(uid);
  people = people.filter((x) => x !== p);
  if (S.focus === uid) S.focus = people[0].uid;
  if (S.selUid === uid) S.selUid = people[0].uid;
  layout(); renderPeople(); renderStatic();
}
function recompute(p) {
  p.m = model(p.cfg, coef);
  p.cur = curves(p.m);
  p.emg = emgCurves(p.m);
  p.fig.build(p.m);
  const codes = new Set();
  if (p.m.amp) for (const sd of ["L", "R"]) rowFor(p, sd)[0].split("+").forEach((c) => codes.add(c));
  p.fig.setIMUs(codes);
  stage.applyEnvIntensity();
  layout();
  updateCardOutputs(p);
  renderStatic();
}
function resetEvents(p) { const { phi, t } = p.sim; p.sim = newSim(phi); p.sim.t = t; }

function layout() {
  const lab = S.env === "lab", n = people.length;
  if (lab) {
    const merged = S.view === "ghost" && n > 1;
    people.forEach((p, i) => {
      p.laneTarget.set(merged ? 0 : (i - (n - 1) / 2) * 1.5, 0, merged ? 0 : -(i - (n - 1) / 2) * 1.15);
      p.fig.root.visible = true;
      const g = merged && i > 0;
      if (p.fig.ghost !== g) p.fig.setGhost(g);
    });
    S.merged = merged;
  } else {
    const f = byUid(S.focus) || people[0];
    people.forEach((p) => {
      p.laneTarget.set(0, 0, 0);
      const isF = p === f;
      p.fig.root.visible = isF || S.ghostOthers;
      if (p.fig.ghost !== !isF) p.fig.setGhost(!isF);
      if (!isF) p.sim.lock = null;
    });
    S.merged = true;
  }
  stage.pickables = people.filter((p) => p.fig.root.visible && !p.fig.ghost && p.fig.pickables).flatMap((p) => p.fig.pickables);
  $("viewSeg").hidden = !lab; $("focusSeg").hidden = lab; $("ghostTog").hidden = lab;
  $("windLbl").classList.toggle("off", !(stage.env && stage.env.windy));
  $("focusSeg").innerHTML = people.map((p) => `<button data-v="${p.uid}" class="${p.uid === S.focus ? "on" : ""}" style="${p.uid === S.focus ? `background:${p.color};color:#02101c` : ""}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${esc(p.name.slice(0, 14))}</button>`).join("");
}
const camScale = () => (S.env === "lab" ? 1 + 0.2 * Math.max(0, people.length - 2) : 1);

// ---------------------------------------------------------------- people cards
const bmiCat = (b) => (b < 18.5 ? "น้ำหนักน้อย" : b < 25 ? "ปกติ" : b < 30 ? "น้ำหนักเกิน" : "อ้วน");
function cardHTML(p) {
  const c = p.cfg, amp = c.mode !== "normal", sc = scen(p.scen);
  const opt = (rows, sel) => rows.map((r, k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${r[8]} · ${r[0]} — MAE IC ${(r[3] * 1000).toFixed(0)} / FC ${(r[6] * 1000).toFixed(0)} ms${r[7] ? " · F1 " + r[7].toFixed(2) : ""}</option>`).join("");
  const seg = (key, items) => `<div class="seg" data-key="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${String(c[key]) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  return `<div class="pc" data-uid="${p.uid}" style="--pc:${p.color}">
    <div class="pc-h"><span class="sw"></span><input data-name value="${esc(p.name)}" aria-label="ชื่อ" maxlength="28">
      <button class="ib ${p.show ? "" : "off"}" data-act="show" title="แสดง/ซ่อนในกราฟ">${p.show ? "◉" : "○"}</button>
      <button class="ib" data-act="remove" title="ลบคนนี้" ${people.length <= 1 ? "disabled" : ""}>×</button></div>
    <div class="bmi">BMI<b data-o="bmi"></b><span data-o="cat"></span> · <span data-o="v"></span></div>
    <select class="scen" data-sel="scen">${SCENARIOS.map((s) => `<option value="${s.id}" ${s.id === p.scen ? "selected" : ""}>${s.tag} · ${s.name}</option>`).join("")}<option value="" ${p.scen ? "" : "selected"}>กำหนดเอง</option></select>
    <div class="desc">${sc ? sc.desc : "ปรับค่าเองจากแถบด้านล่าง"}</div>
    <div class="frm">
      <div class="fld full"><div class="lab">รูปแบบการเดิน</div>${seg("mode", [["normal", "ปกติ"], ["ampL", "ขาเทียมซ้าย"], ["ampR", "ขาเทียมขวา"]])}</div>
      <div class="fld full"><div class="lab">ความเร็ว</div>${seg("speed", [["slow", "ช้า"], ["comf", "สบาย"], ["self", "เลือกเอง"], ["fast", "เร็ว"]])}</div>
      <div class="fld"><div class="lab">อายุ<output data-o="age"></output></div><input type="range" data-k="age" min="18" max="85" step="1" value="${c.age}"></div>
      <div class="fld"><div class="lab">เพศ</div>${seg("sex", [["M", "ชาย"], ["F", "หญิง"]])}</div>
      <div class="fld"><div class="lab">ส่วนสูง<output data-o="ht"></output></div><input type="range" data-k="ht" min="140" max="200" step="0.5" value="${c.ht}"></div>
      <div class="fld"><div class="lab">น้ำหนัก<output data-o="wt"></output></div><input type="range" data-k="wt" min="35" max="150" step="0.5" value="${c.wt}"></div>
    </div>
    <details><summary>ขั้นสูง · ผู้เข้าร่วม S01–S12 · ชุด IMU</summary>
      <div class="fld full"><div class="lab">ผู้เข้าร่วมงานวิจัย (Table 1–2)</div>
        <select data-sel="subject" ${amp ? "" : "disabled"}><option value="">ค่าเฉลี่ยกลุ่ม (n = 12)</option>${SUBJECTS.map((s) => `<option value="${s.id}" ${c.subject === s.id ? "selected" : ""}>${s.id} · ${s.age} ปี · ${s.wt} kg · ${s.ht} cm · ขาเทียม${s.side === "L" ? "ซ้าย" : "ขวา"}</option>`).join("")}</select></div>
      <div class="fld full"><div class="lab">IMU ฝั่งขาเทียม (AMP)</div><select data-sel="imuAmp" ${amp ? "" : "disabled"}>${opt(T6.AMP, p.imuAmp)}</select></div>
      <div class="fld full"><div class="lab">IMU ฝั่งขาดี (SOU)</div><select data-sel="imuSou" ${amp ? "" : "disabled"}>${opt(T6.SOU, p.imuSou)}</select></div>
    </details>
    <div class="warnline" data-o="warn"></div>
  </div>`;
}
function renderPeople() {
  const full = people.length >= MAX;
  $("people").innerHTML = people.map(cardHTML).join("") +
    `<div class="pc addp ${full ? "full" : ""}"><button class="big" data-add="healthy">+ เพิ่มคน</button>
      <div class="quick">${SCENARIOS.map((s) => `<button data-add="${s.id}">${s.name}</button>`).join("")}</div>
      <div class="muted">${full ? "ครบ 6 คนแล้ว" : `อีก ${MAX - people.length} คน`}</div></div>`;
  people.forEach(updateCardOutputs);
  renderLegend();
}
function updateCardOutputs(p) {
  const el = document.querySelector(`.pc[data-uid="${p.uid}"]`), m = p.m, c = p.cfg;
  if (!el || !m) return;
  const set = (k, v) => { const o = el.querySelector(`[data-o="${k}"]`); if (o) o.textContent = v; };
  set("bmi", m.bmi.toFixed(1)); set("cat", bmiCat(m.bmi));
  set("age", c.age + " ปี"); set("ht", c.ht.toFixed(1) + " cm"); set("wt", c.wt.toFixed(1) + " kg");
  set("v", m.v.toFixed(2) + " m/s" + (m.amp ? (m.subj ? " · " + m.subj.id : " · Table 2") : ""));
  const w = el.querySelector('[data-o="warn"]'), msgs = [];
  if (m.bmi < 18.5 || m.bmi >= 25) msgs.push("BMI อยู่นอกช่วงที่งานวิจัยรามาฯ ศึกษา (ช่วงปกติ) ค่า varus และ IR จึงได้จากการยืดเส้นตรงออกไป");
  if (m.amp && !m.subj && (Math.abs(c.age - 51) > 15 || m.bmi > 26)) msgs.push("อยู่นอกลักษณะของกลุ่มตัวอย่างขาเทียม (ชาย อายุ 51 ± 10 ปี BMI ประมาณ 23)");
  w.textContent = msgs.join(" · "); w.classList.toggle("show", msgs.length > 0);
}
const pending = new Set();
const cardOf = (e) => { const el = e.target.closest(".pc[data-uid]"); return el ? byUid(+el.dataset.uid) : null; };
$("people").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) { const p = addPerson(add.dataset.add); if (p) { renderPeople(); layout(); if (S.env === "lab") stage.view(S.cam, camScale()); } return; }
  const p = cardOf(e); if (!p) return;
  const act = e.target.closest("[data-act]");
  if (act) {
    if (act.dataset.act === "remove") { removePerson(p.uid); if (S.env === "lab") stage.view(S.cam, camScale()); }
    else { p.show = !p.show; renderPeople(); }
    return;
  }
  const b = e.target.closest(".seg[data-key] button");
  if (b) {
    const key = b.parentElement.dataset.key;
    p.cfg[key] = b.dataset.v; p.scen = null;
    if (key === "mode") { p.cfg.subject = null; resetEvents(p); }
    recompute(p);
    const el = document.querySelector(`.pc[data-uid="${p.uid}"]`); if (el) el.outerHTML = cardHTML(p);
    updateCardOutputs(p);
  }
});
$("people").addEventListener("input", (e) => {
  const p = cardOf(e); if (!p) return;
  if (e.target.hasAttribute("data-name")) { p.name = e.target.value || `P${p.slot + 1}`; renderLegend(); layout(); return; }
  const k = e.target.dataset.k;
  if (!k) return;
  p.cfg[k] = +e.target.value; p.cfg.subject = null;
  if (p.scen) { p.scen = null; const el = e.target.closest(".pc"); el.querySelector("select.scen").value = ""; el.querySelector(".desc").textContent = "ปรับค่าเองจากแถบด้านล่าง"; }
  pending.add(p);
});
$("people").addEventListener("change", (e) => {
  const p = cardOf(e); if (!p) return;
  const k = e.target.dataset.sel;
  if (!k) return;
  if (k === "scen") {
    const sc = scen(e.target.value); if (!sc) return;
    p.scen = sc.id; p.cfg = { ...sc.cfg }; if (!p.nameEdited) p.name = sc.name;
    resetEvents(p); recompute(p); renderPeople();
  } else if (k === "subject") {
    const sub = SUBJECTS.find((s) => s.id === e.target.value);
    p.cfg.subject = sub ? sub.id : null; p.scen = null;
    if (sub) Object.assign(p.cfg, { age: sub.age, wt: sub.wt, ht: sub.ht, sex: "M", mode: sub.side === "L" ? "ampL" : "ampR" });
    resetEvents(p); recompute(p); renderPeople();
  } else { p[k] = +e.target.value; resetEvents(p); recompute(p); }
});
$("people").addEventListener("keydown", (e) => { if (e.target.hasAttribute("data-name")) { const p = cardOf(e); if (p) p.nameEdited = true; } });

function renderLegend() {
  $("legend").innerHTML = people.map((p) => `<button class="chip ${p.show ? "" : "off"}" data-uid="${p.uid}"><i style="background:${p.color}"></i>${esc(p.name)}</button>`).join("");
}
$("legend").addEventListener("click", (e) => { const b = e.target.closest("[data-uid]"); if (!b) return; const p = byUid(+b.dataset.uid); p.show = !p.show; renderPeople(); });

// ---------------------------------------------------------------- global controls
function segGroup(id, fn) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (id !== "focusSeg") $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
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
    people.forEach((p) => { p.sim.lock = null; });
    layout();
    stage.applyEnvIntensity();
    stage.view(S.cam, camScale());
    setTimeout(() => $("loader").classList.remove("show"), 120);
  }, 60);
}
$("envSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.v !== S.env) setEnv(b.dataset.v); });
segGroup("viewSeg", (v) => { S.view = v; layout(); });
segGroup("focusSeg", (v) => { S.focus = +v; people.forEach((p) => (p.sim.lock = null)); layout(); });
segGroup("camSeg", (v) => { S.cam = v; stage.view(v, camScale()); });
segGroup("legSeg", (v) => { S.leg = v; });
segGroup("unitSeg", (v) => { S.unit = v; });
segGroup("emgSideSeg", (v) => { S.emgSide = v; renderMuscleInfo(); });
const toggle = (id, key, after) => $(id).addEventListener("click", () => { S[key] = !S[key]; $(id).classList.toggle("on", S[key]); after && after(); });
toggle("ghostTog", "ghostOthers", () => layout());
toggle("orbitTog", "orbit", () => { stage.controls.autoRotate = S.orbit; });
toggle("emgTog", "emg", () => updateHint());
toggle("grfTog", "grf");
$("anim").addEventListener("input", (e) => { S.anim = +e.target.value; $("animOut").textContent = S.anim.toFixed(2) + "×"; });
$("exag").addEventListener("input", (e) => { S.exag = +e.target.value; $("exagOut").textContent = S.exag + "×"; });
$("wind").addEventListener("input", (e) => { S.wind = +e.target.value; $("windOut").textContent = S.wind.toFixed(1); });
const setPlay = (on) => { S.playing = on; $("playBtn").firstElementChild.className = S.playing ? "i-pause" : "i-play"; };
$("playBtn").addEventListener("click", () => setPlay(!S.playing));
window.addEventListener("keydown", (e) => {
  if (e.target.closest("input,select,textarea")) return;
  if (e.code === "Space") { e.preventDefault(); setPlay(!S.playing); }
  const envKeys = { Digit1: "lab", Digit2: "garden", Digit3: "beach", Digit4: "factory", Digit5: "snow" };
  if (envKeys[e.code] && envKeys[e.code] !== S.env) setEnv(envKeys[e.code]);
});
$("roster").addEventListener("click", (e) => {
  const r = e.target.closest("[data-uid]"); if (!r) return;
  if (S.env !== "lab") { S.focus = +r.dataset.uid; people.forEach((p) => (p.sim.lock = null)); layout(); }
});
const COEF_FIELDS = [["var", "Varus ตอน IC ต่อ BMI +1 (°)", 0.01], ["ir", "Internal rotation ต่อ BMI +1 (°)", 0.05], ["ref", "BMI อ้างอิง (kg/m²)", 0.1], ["varAge", "Varus ต่ออายุ +1 ปี (°)", 0.01], ["varSex", "Varus ส่วนต่างเพศหญิง (°)", 0.1], ["irAge", "IR ต่ออายุ +1 ปี (°)", 0.01], ["irSex", "IR ส่วนต่างเพศหญิง (°)", 0.1]];
$("coef").innerHTML = COEF_FIELDS.map(([k, l, s]) => `<span>${l}</span><input type="number" step="${s}" data-c="${k}" value="${coef[k]}">`).join("");
$("coef").addEventListener("input", (e) => { const k = e.target.dataset.c; if (!k) return; const v = parseFloat(e.target.value); coef[k] = isNaN(v) ? COEF_DEFAULT[k] : v; people.forEach(recompute); });

// ---------------------------------------------------------------- muscles / EMG
function buildMuscleList() {
  const groups = [...new Set(MUSCLES.map((m) => m.region))];
  $("mlist").innerHTML = groups.map((g) => `<div class="mgrp">${g}</div>` + MUSCLES.filter((m) => m.region === g).map((m) => `<button class="mb" data-m="${m.id}"><span class="ab">${m.abbr}</span><span class="nm">${m.en}</span><span class="bb"></span></button>`).join("")).join("");
  $("mlist").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) selectMuscle(b.dataset.m, null); });
  $("mats").addEventListener("click", (e) => {
    const c = e.target.closest("canvas"), L = c && c._layout; if (!L) return;
    const y = e.clientY - c.getBoundingClientRect().top, k = Math.floor((y - L.pt) / L.rowH);
    if (k >= 0 && k < L.n) selectMuscle(L.ids[k], null);
  });
}
function selectMuscle(id, side, uid = null) {
  S.muscle = id; if (side) S.emgSide = side;
  if (uid !== null) S.selUid = uid;
  S.selected = true;
  if (!S.emg) { S.emg = true; $("emgTog").classList.add("on"); }
  renderMuscleInfo(); updateHint();
}
function renderMuscleInfo() {
  if (!people.every((p) => p.emg)) return;
  const mu = MUSCLE[S.muscle], sd = S.emgSide;
  $("mAb").textContent = `${mu.abbr} · ${mu.region}`; $("mN").textContent = mu.en; $("mTh").textContent = mu.th; $("mFn").textContent = mu.fn;
  const notes = [];
  for (const p of people) for (const n of p.emg.prof[sd][mu.id].notes) notes.push(`<span><b style="color:${p.color}">●</b>${esc(p.name)}: ${n}</span>`);
  $("mNotes").innerHTML = notes.length ? notes.join("") : `<span>ทุกคนใช้รูปแบบการทำงานปกติ (ปรับตามความเร็วการเดิน)</span>`;
  $("mlist").querySelectorAll(".mb").forEach((b) => b.classList.toggle("on", b.dataset.m === mu.id));
  $("emgSideSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === sd));
  $("mhud").hidden = !S.selected;
  $("mhK").textContent = `${mu.abbr} · ${sd === "L" ? "LEFT" : "RIGHT"} · LIVE EMG`;
  $("mhN").textContent = mu.en; $("mhTh").textContent = mu.th; $("mhFn").textContent = mu.fn;
}
$("mhX").addEventListener("click", () => { S.selected = false; renderMuscleInfo(); updateHint(); });
function updateHint() { $("hint").classList.toggle("off", S.selected); $("hint").textContent = S.emg ? "คลิกที่กล้ามเนื้อบนตัวคนเพื่อดูคลื่น EMG · ลากเพื่อหมุนกล้อง" : "คลิกที่ขา สะโพก หรือหลังของคนเพื่อดูกล้ามเนื้อและคลื่น EMG · ลากเพื่อหมุนกล้อง"; }
const pickInfo = (hit) => (hit && hit.object.userData.figure ? hit.object.userData.figure.pickInfo(hit) : null);
const onPick = (hit) => {
  const ud = pickInfo(hit);
  if (!ud || !ud.muscle) { if (S.selected) { S.selected = false; renderMuscleInfo(); updateHint(); } return; }
  const p = people.find((x) => x.fig === ud.figure);
  selectMuscle(ud.muscle, ud.side, p ? p.uid : null);
};
const onHover = (hit, e) => {
  const ud = pickInfo(hit), tip = $("htip");
  if (!ud || !ud.muscle) { tip.classList.remove("show"); return; }
  const p = people.find((x) => x.fig === ud.figure), mu = MUSCLE[ud.muscle], hr = $("hero").getBoundingClientRect();
  tip.textContent = `${mu.abbr} · ${mu.en} · ${p ? p.name : ""} ${p ? sideName(p, ud.side) : ""}`;
  tip.style.left = e.clientX - hr.left + "px"; tip.style.top = e.clientY - hr.top + "px";
  tip.classList.add("show");
};
function updateMuscleLive() {
  const id = S.muscle, sd = S.emgSide;
  $("mhBars").innerHTML = people.map((p) => {
    const pr = p.emg.prof[sd][id], a = p.acts ? p.acts[sd][id] : 0;
    return `<div class="mh-bar"><span style="display:flex;align-items:center;gap:5px"><i style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block"></i></span><span class="tr"><i style="width:${pr.absent ? 0 : Math.min(100, (a / 0.6) * 100)}%;background:${p.color}"></i></span><b>${pr.absent ? "ไม่มี" : Math.round(a * 100) + "%"}</b></div>`;
  }).join("");
  $("mlist").querySelectorAll(".mb").forEach((b) => {
    const bb = b.querySelector(".bb");
    if (bb.childElementCount !== people.length) bb.innerHTML = people.map(() => "<span><i></i></span>").join("");
    const is = bb.querySelectorAll("i");
    people.forEach((p, k) => { is[k].style.width = Math.min(100, ((p.acts ? p.acts[sd][b.dataset.m] : 0) / 0.6) * 100) + "%"; is[k].style.background = p.color; });
  });
}
const scopeTrace = (p, win, sd, id) => {
  const w = rawWindow(p.m, p.emg.prof, sd, id, p.sim.phi, p.sim.t, win, 17 + p.slot * 101);
  return { raw: w.raw, env: w.env, color: p.color, label: p.name.slice(0, 12), sub: sideName(p, sd), absent: p.emg.prof[sd][id].absent };
};
function renderEMG() {
  const sd = S.emgSide, id = S.muscle, ps = shown();
  if (!ps.length) return;
  const ph = (p) => frac(p.sim.phi + (sd === "L" ? 0.5 : 0)) * 100;
  let mx = 0.25;
  for (const p of ps) for (const v of p.emg.curves[sd][id]) mx = Math.max(mx, v);
  drawCompare($("envChart"), {
    series: ps.map((p) => ({ data: p.emg.curves[sd][id], color: p.color, width: 2.2, label: p.name.slice(0, 14) })),
    bands: true, lo: 0, hi: mx * 1.15, pct: true,
    cursors: ps.map((p) => ({ x: ph(p), y: p.emg.curves[sd][id][Math.round(ph(p))], color: p.color })),
    toeOff: ps.map((p) => ({ x: p.m.legs[sd].sf * 100, color: p.color })),
  });
  const sc = $("scope"), want = 34 + 58 * ps.length + "px";
  if (sc.style.height !== want) sc.style.height = want;
  drawScope(sc, ps.map((p) => scopeTrace(p, 3, sd, id)), { win: 3, now: ps[0].sim.t, scale: 1.6 });
  const mats = $("mats");
  const keys = ps.map((p) => p.uid).join(",");
  if (mats.dataset.keys !== keys) { mats.innerHTML = ps.map((p) => `<canvas data-uid="${p.uid}"></canvas>`).join(""); mats.dataset.keys = keys; }
  ps.forEach((p) => drawMatrix(mats.querySelector(`canvas[data-uid="${p.uid}"]`), {
    rows: MUSCLES.map((mu) => ({ id: mu.id, label: mu.abbr, data: p.emg.curves[sd][mu.id], absent: p.emg.prof[sd][mu.id].absent })),
    cursor: ph(p), sel: id, title: `${p.name} · ${sideName(p, sd)}`, color: p.color,
  }));
}

// ---------------------------------------------------------------- compare charts
const CHARTS = [
  ["hip", "สะโพก · Hip flexion", "องศา · sagittal", (a) => ["ROM", Math.max(...a) - Math.min(...a)], "°"],
  ["knee", "เข่า · Knee flexion", "องศา · sagittal", (a) => ["งอสูงสุด", Math.max(...a)], "°"],
  ["ank", "ข้อเท้า · Dorsi(+)/Plantar(−)", "องศา · sagittal", (a) => ["plantar สูงสุด", Math.min(...a)], "°"],
  ["varus", "เข่าโก่ง · Knee varus (+)", "องศา · frontal", (a) => ["ตอน IC", a[0]], "°"],
  ["ir", "เข่าบิดเข้าใน · Internal rotation", "องศา · transverse", (a) => ["สูงสุด", Math.max(...a)], "°"],
  ["grf", "แรงปฏิกิริยาพื้น · vGRF", "ช่วง stance", (a) => ["สูงสุด", Math.max(...a)], ""],
];
$("charts").innerHTML = CHARTS.map(([k, t, s]) => `<div class="ch"><div class="t">${t}</div><div class="s">${s}</div><div class="v" id="v_${k}"></div><canvas id="ch_${k}"></canvas></div>`).join("");
CHARTS.forEach(([k]) => attachHover($("ch_" + k)));
attachHover($("envChart"));
const chartData = (p, sd, key) => { const d = p.cur[sd][key]; return key === "grf" && S.unit === "BW" ? d.map((x) => x / p.m.BW) : d; };
function renderCharts() {
  const legs = S.leg === "B" ? ["L", "R"] : [S.leg], ps = shown();
  $("legLegend").innerHTML = S.leg === "B" ? `<i></i>เส้นประ = ขาขวา` : "";
  for (const [key, , , stat, u] of CHARTS) {
    const series = [], toeOff = [], cursors = [];
    for (const p of ps) for (const sd of legs) {
      const data = chartData(p, sd, key);
      series.push({ data, color: p.color, dash: S.leg === "B" && sd === "R" ? [5, 4] : null, width: 2, label: `${p.name.slice(0, 10)}${S.leg === "B" ? " " + sd : ""}` });
      toeOff.push({ x: p.m.legs[sd].sf * 100, color: p.color });
      const ph = frac(p.sim.phi + (sd === "L" ? 0.5 : 0)) * 100;
      cursors.push({ x: ph, y: data[Math.round(ph)], color: p.color });
    }
    const unit = key === "grf" ? (S.unit === "BW" ? "×BW" : " N") : u, dp = key === "grf" ? (S.unit === "N" ? 0 : 2) : 1;
    drawCompare($("ch_" + key), { series, toeOff, cursors, zero: key === "grf", unit, dp });
    const sd0 = legs[0];
    $("v_" + key).innerHTML = `<span class="lab">${ps.length ? stat(chartData(ps[0], sd0, key))[0] : ""} (${S.leg === "B" ? "ขาซ้าย" : sd0 === "L" ? "ขาซ้าย" : "ขาขวา"})</span>` +
      ps.map((p) => `<span><i style="background:${p.color}"></i>${stat(chartData(p, sd0, key))[1].toFixed(dp)}${unit}</span>`).join("");
  }
}

// ---------------------------------------------------------------- metrics
function metricsOf(p) {
  const m = p.m, L = m.legs.L, R = m.legs.R, pk = (sd) => Math.max(...p.cur[sd].grf);
  return [
    ["BMI (kg/m²)", m.bmi, 1], ["ความเร็ว (m/s)", m.v, 2], ["Cadence (ก้าว/นาที)", m.cadence, 0], ["ความยาวรอบก้าว (m)", m.strideLen, 2], ["เวลาต่อรอบ (s)", m.T, 2],
    ["Stance ซ้าย (%)", L.sf * 100, 1], ["Stance ขวา (%)", R.sf * 100, 1], ["ความไม่สมมาตรของ stance (%)", (Math.abs(L.sf - R.sf) / (0.5 * (L.sf + R.sf))) * 100, 1],
    ["Varus ตอน IC (°)", p.cur.R.varus[0], 2], ["Internal rotation สูงสุด (°)", Math.max(...p.cur.R.ir), 1],
    ["vGRF สูงสุด (N)", Math.max(pk("L"), pk("R")), 0], ["vGRF สูงสุด (×BW)", Math.max(pk("L"), pk("R")) / m.BW, 2],
    ["EMG สูงสุด GMAX ขาซ้าย (%MVC)", Math.max(...p.emg.curves.L.GMAX) * 100, 0], ["EMG สูงสุด VAS ขาซ้าย (%MVC)", Math.max(...p.emg.curves.L.VAS) * 100, 0],
    ["โมเมนต์หุบเข่า KAM (N·m)*", (m.kamPct / 100) * m.BW * m.h, 0], ["ความกว้างฐานก้าว (cm)*", m.stepW * 100, 1],
  ];
}
function renderMetrics() {
  if (!people.every((p) => p.m && p.emg)) return;
  const all = people.map(metricsOf);
  $("metrics").innerHTML = `<thead><tr><th>ตัวชี้วัด</th>${people.map((p) => `<th><span class="sw" style="background:${p.color}"></span>${esc(p.name.slice(0, 10))}</th>`).join("")}</tr></thead><tbody>` +
    all[0].map((row, r) => `<tr><td>${row[0]}</td>${all.map((m) => `<td>${m[r][1].toFixed(m[r][2])}</td>`).join("")}</tr>`).join("") +
    `<tr><td colspan="${people.length + 1}" class="sub">* ค่าประมาณเชิงสาธิตตามแนวโน้มของ Ahsan (2022) · EMG เป็นค่าจำลอง</td></tr></tbody>`;
}

// ---------------------------------------------------------------- TCN event simulation
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function errs(p, sd, k) {
  const st = p.sim.stride[sd];
  if (!st[k]) {
    const r = rowFor(p, sd), q = (x) => Math.round(x / 0.005) * 0.005;
    st[k] = { ic: q(r[1] + (randn() * r[2]) / 1.349), fc: q(r[4] + (randn() * r[5]) / 1.349) };
    const keys = Object.keys(st); if (keys.length > 12) delete st[keys[0]];
  }
  return st[k];
}
const legPhase = (p, sd) => { const x = p.sim.phi + (sd === "L" ? 0.5 : 0); return { k: Math.floor(x), p: frac(x) }; };
function predContact(p, sd) {
  const { k, p: ph } = legPhase(p, sd), L = p.m.legs[sd], P = p.m.T, tau = ph * P, e = errs(p, sd, k), en = errs(p, sd, k + 1);
  return (tau >= e.ic && tau < L.sf * P + e.fc) || tau >= P + en.ic ? 1 : 0;
}
function step(p, dt) {
  const sim = p.sim, m = p.m, prev = { R: legPhase(p, "R"), L: legPhase(p, "L") };
  sim.phi += dt / m.T; sim.t += dt;
  const s = { t: sim.t };
  for (const sd of ["R", "L"]) {
    const cur = legPhase(p, sd), L = m.legs[sd];
    if (m.amp) {
      if (cur.k !== prev[sd].k) { const e = errs(p, sd, cur.k); sim.stats[sd].ic.push(e.ic); sim.marks[sd].push({ t: sim.t, type: "IC", e: e.ic }); }
      if (prev[sd].p < L.sf && cur.p >= L.sf && cur.k === prev[sd].k) { const e = errs(p, sd, cur.k); sim.stats[sd].fc.push(e.fc); sim.marks[sd].push({ t: sim.t, type: "FC", e: e.fc }); }
      for (const a of ["ic", "fc"]) if (sim.stats[sd][a].length > 400) sim.stats[sd][a].shift();
      while (sim.marks[sd].length && sim.marks[sd][0].t < sim.t - 4.5) sim.marks[sd].shift();
    }
    s["ref" + sd] = cur.p < L.sf ? 1 : 0;
    s["pre" + sd] = m.amp ? predContact(p, sd) : 0;
  }
  sim.hist.push(s);
  while (sim.hist.length && sim.hist[0].t < sim.t - 4.5) sim.hist.shift();
}
function renderEvents() {
  if (!people.every((p) => p.m)) return;
  const mae = (a) => (a.length ? a.reduce((s, x) => s + Math.abs(x), 0) / a.length : NaN);
  const med = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
  const f = (x) => (isNaN(x) ? "–" : (x * 1000).toFixed(1));
  let rows = "";
  const amps = people.filter((p) => p.m.amp);
  if (!amps.length) rows = `<tr><td colspan="5" class="sub">ยังไม่มีคนที่ใช้ขาเทียม: เพิ่มคนแบบ "ขาเทียมใต้เข่า" เพื่อดูการจำลอง TCN</td></tr>`;
  for (const p of amps) for (const sd of [p.m.ampSide, p.m.ampSide === "L" ? "R" : "L"]) {
    const r = rowFor(p, sd), st = p.sim.stats[sd];
    rows += `<tr><td><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${esc(p.name.slice(0, 12))} ${legLabel(p, sd)} · ${r[0]} <span class="sub">n=${st.ic.length}</span></td><td>${f(med(st.ic))}</td><td>${f(mae(st.ic))} <span class="sub">/ ${(r[3] * 1000).toFixed(0)}</span></td><td>${f(med(st.fc))}</td><td>${f(mae(st.fc))} <span class="sub">/ ${(r[6] * 1000).toFixed(0)}</span></td></tr>`;
  }
  $("events").innerHTML = `<thead><tr><th>คน · ขา · ชุด IMU</th><th>IC median</th><th>IC MAE / paper</th><th>FC median</th><th>FC MAE / paper</th></tr></thead><tbody>${rows}<tr><td colspan="5" class="sub">หน่วย ms · error = t<sub>pred</sub> − t<sub>ref</sub> · ค่าจำลองควรเข้าใกล้ค่าในงานวิจัยเมื่อจำนวน n มากขึ้น</td></tr></tbody>`;
}
function renderContact() {
  const lanes = [];
  for (const p of people.filter((x) => x.show)) for (const sd of ["L", "R"]) {
    if (!p.m.amp && lanes.length >= 4) continue;
    lanes.push({ label: `${p.name.slice(0, 9)} · ${legLabel(p, sd)}`, color: p.color, pred: p.m.amp, hist: p.sim.hist.map((h) => ({ t: h.t, ref: h["ref" + sd], pre: h["pre" + sd] })), marks: p.sim.marks[sd] });
  }
  const c = $("contact"), want = 30 + 52 * Math.max(1, lanes.length) + "px";
  if (c.style.height !== want) c.style.height = want;
  if (lanes.length) drawContact(c, lanes, people[0].sim.t);
}
function renderStatic() { renderMetrics(); renderEvents(); renderMuscleInfo(); }

// ---------------------------------------------------------------- roster (HUD)
function renderRoster() {
  const el = $("roster");
  el.innerHTML = people.map((p) => {
    const m = p.m, leg = (sd) => { const ph = frac(p.sim.phi + (sd === "L" ? 0.5 : 0)), st = ph < m.legs[sd].sf; return `<span>${legLabel(p, sd)}</span><div class="bar ${st ? "st" : ""}"><i style="width:${(ph * 100).toFixed(0)}%"></i><u style="left:${(m.legs[sd].sf * 100).toFixed(0)}%"></u></div>`; };
    let top = null;
    if (p.acts) for (const sd of ["L", "R"]) for (const [id, a] of Object.entries(p.acts[sd])) if (!top || a > top[0]) top = [a, `${MUSCLE[id].abbr}·${sd}`];
    const vis = p.fig.root.visible && !p.fig.ghost;
    return `<div class="rp ${vis || S.env === "lab" ? "" : "dim"}" data-uid="${p.uid}"><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}</span><span class="st"><b>${m.v.toFixed(2)}</b> m/s · <b>${m.cadence.toFixed(0)}</b> spm</span>
      <div class="legs">${leg("L")}${leg("R")}</div>${top && people.length <= 3 ? `<div class="emg">EMG ▸ ${top[1]} <b>${Math.round(top[0] * 100)}%</b> · ${phaseName(m.legs.L, frac(p.sim.phi + 0.5))}</div>` : ""}</div>`;
  }).join("");
}

// ---------------------------------------------------------------- callout
const cv = new THREE.Vector3();
function updateCallout() {
  const svg = $("callout");
  if (!S.selected || window.innerWidth <= 900 || $("mhud").hidden) { svg.style.display = "none"; return; }
  let p = byUid(S.selUid);
  if (!p || !p.fig.root.visible || p.fig.ghost) p = people.find((x) => x.fig.root.visible && !x.fig.ghost);
  const pt = p && p.fig.anchorWorld(S.muscle, S.emgSide, cv);
  if (!pt) { svg.style.display = "none"; return; }
  pt.project(stage.camera);
  if (pt.z > 1 || Math.abs(pt.x) > 1.2 || Math.abs(pt.y) > 1.2) { svg.style.display = "none"; return; }
  const hr = $("hero").getBoundingClientRect(), cr = $("gl").getBoundingClientRect(), mr = $("mhud").getBoundingClientRect();
  const x = (pt.x * 0.5 + 0.5) * cr.width + (cr.left - hr.left), y = (-pt.y * 0.5 + 0.5) * cr.height + (cr.top - hr.top);
  const ax = mr.left - hr.left, ay = mr.top - hr.top + 34;
  $("cLine").setAttribute("points", `${x.toFixed(1)},${y.toFixed(1)} ${(ax - 36).toFixed(1)},${ay.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`);
  for (const id of ["cDot", "cRing"]) { $(id).setAttribute("cx", x.toFixed(1)); $(id).setAttribute("cy", y.toFixed(1)); }
  svg.style.display = "";
}

// ---------------------------------------------------------------- animation
const tmp = new THREE.Vector3();
function animateFigure(p, dt, i) {
  const m = p.m, fig = p.fig, sim = p.sim, env = stage.env;
  const prev = { R: legPhase(p, "R"), L: legPhase(p, "L") };
  if (dt > 0) { const n = 4; for (let k = 0; k < n; k++) step(p, dt / n); }
  const arrows = stage.arrowsFor(p.uid, p.color);
  if (!fig.root.visible || !env) { arrows.R.visible = arrows.L.visible = false; return; }
  const pR = frac(sim.phi), pL = frac(sim.phi + 0.5), ph = { R: pR, L: pL };
  fig.pose(m, pR, pL, S.exag);
  const lab = env.treadmill, focus = !lab && p.uid === S.focus;
  const fp = byUid(S.focus) || people[0];
  const sink = lab ? 0 : env.sink(fp.m);
  fig.ground(GROUND - sink);
  if (lab || focus) {
    const stance = ["R", "L"].filter((sd) => ph[sd] < m.legs[sd].sf);
    let lock = null;
    if (stance.length) {
      const sd = stance.sort((a, b) => (m.legs[b].sf - ph[b]) - (m.legs[a].sf - ph[a]))[0];
      const c = fig.contacts(sd), key = ["heel", "ball", "tip"].reduce((a, k) => (c[k].y < c[a].y ? k : a), "heel");
      lock = { sd, key, x: c[key].x - p.lane.position.x };
    }
    if (lock && sim.lock && sim.lock.sd === lock.sd && sim.lock.key === lock.key && dt > 0) {
      const dx = lock.x - sim.lock.x;
      if (Math.abs(dx) < 0.2) { if (lab) { if (env.mills[i]) env.mills[i].move(dx); } else env.scroll(dx); }
    }
    sim.lock = lock;
  }
  if (focus && dt > 0) {
    for (const sd of ["R", "L"]) {
      const cur = legPhase(p, sd), L = m.legs[sd];
      if (cur.k !== prev[sd].k) env.onStep({ type: "IC", side: sd, fig, m });
      else if (prev[sd].p < L.sf && cur.p >= L.sf) env.onStep({ type: "TO", side: sd, fig, m });
      if (cur.p < L.sf) env.stamp(fig, m, sd);
    }
  }
  for (const sd of ["R", "L"]) {
    const L = m.legs[sd], ph2 = ph[sd], a = arrows[sd];
    if (S.grf && (lab || focus) && ph2 < L.sf && !fig.ghost) {
      const s = ph2 / L.sf, c = fig.contacts(sd);
      tmp.copy(c.heel).lerp(c.ball, Math.min(1, s * 1.15)); tmp.y = GROUND - sink + 0.004;
      stage.setArrow(a, true, tmp, grf(L, ph2, m.BW), m.BW, s);
    } else stage.setArrow(a, false);
  }
}

const vis = { hero: true, cmp: false, emg: false, tcn: false };
const io = new IntersectionObserver((ents) => { for (const e of ents) vis[e.target.dataset.vis] = e.isIntersecting; }, { rootMargin: "100px" });
[["hero", "hero"], ["cmpSec", "cmp"], ["emgSec", "emg"], ["tcnSec", "tcn"]].forEach(([id, k]) => { $(id).dataset.vis = k; io.observe($(id)); });

let last = performance.now(), frameN = 0, envT = 0;
function tick(dt, sdt) {
  envT += sdt;
  stage.U.uWind.value = S.wind * (0.8 + 0.25 * Math.sin(envT * 0.37) + 0.35 * Math.max(0, Math.sin(envT * 1.3) * Math.sin(envT * 0.21)));
  people.forEach((p, i) => { p.lane.position.lerp(p.laneTarget, Math.min(1, Math.max(dt, sdt) * 5)); animateFigure(p, sdt, i); });
  const sel = S.selected ? { group: S.muscle, side: S.emgSide } : null;
  for (const p of people) {
    p.acts = { L: actNow(p.m, p.emg.prof, "L", frac(p.sim.phi + 0.5)), R: actNow(p.m, p.emg.prof, "R", frac(p.sim.phi)) };
    p.fig.applyEMG(p.acts, S.emg, sel, envT);
  }
  stage.update(dt, envT, { lanes: people.map((p) => p.lane), colors: people.map((p) => p.color), figVisible: people.map((p) => p.fig.root.visible), merged: S.merged ? 1 : 0, focusFig: S.env !== "lab" ? (byUid(S.focus) || people[0]).fig : null, envDt: sdt });
}
const perf = { n: 0, acc: 0, level: 0 };
function frame(now) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
  if (vis.hero && raw < 1) {
    perf.n++; perf.acc += raw;
    if (perf.n >= 90) {
      const avg = perf.acc / perf.n;
      if (avg > 1 / 26 && perf.level < 2) { perf.level++; stage.setQuality(perf.level); }
      perf.n = 0; perf.acc = 0;
    }
  }
  for (const p of pending) recompute(p);
  pending.clear();
  tick(dt, S.playing ? dt * S.anim : 0);
  if (vis.hero) stage.render();
  updateCallout();
  frameN++;
  if (frameN % 2 === 0) {
    if (vis.cmp) renderCharts();
    if (vis.tcn) renderContact();
    if (vis.emg) renderEMG();
    if (S.selected && !$("mhud").hidden) { const p = byUid(S.selUid) || people[0]; drawScope($("mhScope"), [scopeTrace(p, 2, S.emgSide, S.muscle)], { win: 2, now: p.sim.t, scale: 1.6, compact: true }); }
  }
  if (frameN % 4 === 0) updateMuscleLive();
  if (frameN % 6 === 0) renderRoster();
  if (frameN % 30 === 0) renderEvents();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot (staged, with progress + visible errors)
const bootLog = (window.__bootLog = []);
const bootMsg = (t, pct) => { bootLog.push([Math.round(performance.now()), t]); $("bootMsg").textContent = t; $("bootBar").style.width = pct + "%"; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
let booted = false;
function bootError(e) {
  if (booted) return;
  const el = $("bootErr");
  el.hidden = false;
  el.textContent = "เปิดไม่สำเร็จ: " + (e && e.message ? e.message : String(e)) + (e && e.stack ? "\n\n" + String(e.stack).split("\n").slice(0, 4).join("\n") : "");
  $("bootMsg").textContent = "เกิดข้อผิดพลาด ลองเปิดด้วย Chrome, Edge หรือ Safari รุ่นใหม่";
}
window.addEventListener("error", (e) => bootError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => bootError(e.reason));
function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
}
async function boot() {
  bootMsg("เตรียมกราฟิก 3 มิติ…", 8);
  await nextFrame();
  if (!hasWebGL()) throw new Error("เบราว์เซอร์หรืออุปกรณ์นี้เปิด WebGL ไม่ได้ (ต้องใช้กราฟิก 3 มิติ)");
  stage = new Stage($("gl"));
  stage.onPick = onPick; stage.onHover = onHover;
  bootMsg("สร้างห้องแล็บ…", 18);
  await nextFrame();
  stage.setEnv("lab");
  stage.onLost = () => { $("boot").classList.remove("done"); $("bootMsg").textContent = "การ์ดจอรีเซ็ต กรุณารีเฟรชหน้า (F5)"; };
  buildMuscleList();
  const defaults = ["healthy", "obese", "ampL"];
  for (let i = 0; i < defaults.length; i++) {
    bootMsg(`สร้างผู้เดินคนที่ ${i + 1} จาก ${defaults.length}…`, 28 + i * 18);
    await nextFrame();
    addPerson(defaults[i]);
  }
  renderPeople(); layout(); renderStatic(); renderCharts(); updateHint(); renderRoster();
  stage.view("cine", camScale());
  bootMsg("เตรียม shader…", 86);
  await nextFrame();
  try {
    if (stage.renderer.compileAsync) await Promise.race([stage.renderer.compileAsync(stage.scene, stage.camera), new Promise((r) => setTimeout(r, 5000))]);
  } catch (e) { /* compile lazily instead */ }
  bootMsg("พร้อมแล้ว", 100);
  booted = true;
  requestAnimationFrame(frame);
  setTimeout(() => $("boot").classList.add("done"), 200);
}
boot().catch(bootError);
window.__gait = {
  people: () => people, get stage() { return stage; }, S, setEnv, selectMuscle, addPerson: (id) => { const p = addPerson(id); renderPeople(); layout(); return p; },
  update(uid, patch) { const p = byUid(uid); Object.assign(p.cfg, patch); p.scen = null; recompute(p); renderPeople(); },
  advance(sec, fps = 60) { for (let k = 0, n = Math.round(sec * fps); k < n; k++) tick(0, (1 / fps) * S.anim); },
  get booted() { return booted; },
};
