// Real World mode: video in, pose extraction, gait analysis, results out.
import { createLandmarker, extractPoses, ensureDuration } from "./pose.js";
import { analyze, mean } from "./analyze.js";
import { LM, BONES } from "./landmarks.js";
import { drawCompare, attachHover, drawTimeline, fit } from "../charts.js";
import { loadDemo } from "./demo.js";

export const RW_COL = { L: "#338ced", R: "#e76624", N: "#d7e3f4" };
const SIDE = { L: "ขาซ้าย", R: "ขาขวา" };
const STAT = { ok: ["✓", "ผ่าน"], warn: ["!", "ควรปรับ"], bad: ["✕", "ผิดปกติ"] };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ok = (v) => v === v && v !== Infinity && v !== -Infinity;
const f = (v, d = 0, u = "") => (ok(v) ? (+v).toFixed(d) + u : "–");
const LEFT_IDS = new Set([LM.shL, LM.elL, LM.wrL, LM.hipL, LM.kneeL, LM.ankL, LM.heelL, LM.toeL, LM.earL, LM.eyeL]);
const RIGHT_IDS = new Set([LM.shR, LM.elR, LM.wrR, LM.hipR, LM.kneeR, LM.ankR, LM.heelR, LM.toeR, LM.earR, LM.eyeR]);

export function initRW(api) {
  const $ = (id) => document.getElementById(id);
  const v = $("rwVideo"), ov = $("rwOverlay");
  const st = { url: null, rec: null, R: null, o: null, swap: false, busy: false, ctrl: null, demo: false, demoT: 0, demoPlay: false, liveLm: null, name: "" };

  // ---------------------------------------------------------------- input
  const msg = (t, err = false) => { const m = $("rwMsg"); m.textContent = t; m.classList.toggle("err", err); };
  for (const id of ["rwCam", "rwFile"]) $(id).addEventListener("change", (e) => { const file = e.target.files && e.target.files[0]; if (file) loadFile(file); e.target.value = ""; });
  const panel = $("rwp");
  panel.addEventListener("dragover", (e) => { e.preventDefault(); $("rwDrop").classList.add("over"); });
  panel.addEventListener("dragleave", (e) => { if (!panel.contains(e.relatedTarget)) $("rwDrop").classList.remove("over"); });
  panel.addEventListener("drop", (e) => { e.preventDefault(); $("rwDrop").classList.remove("over"); const file = e.dataTransfer.files && e.dataTransfer.files[0]; if (file) loadFile(file); });
  $("rwNew").addEventListener("click", () => { if (st.busy) return; $("rwFile").click(); });
  for (const id of ["rwDemo", "rwDemo2"]) $(id).addEventListener("click", (e) => startDemo(e.currentTarget.dataset.demo));

  function showWork() { $("rwEmpty").hidden = true; $("rwWork").hidden = false; }
  async function loadFile(file) {
    if (st.busy) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(file.name)) { showWork(); msg("ไฟล์นี้ไม่ใช่วิดีโอ", true); return; }
    clearResult();
    st.demo = false; st.rec = null; st.liveLm = null; st.name = file.name;
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(file);
    showWork();
    v.hidden = false; $("rwVideoBox").style.aspectRatio = "";
    v.src = st.url;
    msg("กำลังเปิดวิดีโอ…");
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("decode")); setTimeout(() => rej(new Error("timeout")), 20000); });
      const dur = await ensureDuration(v);
      v.playbackRate = rate;
      msg(`${file.name} · ${dur.toFixed(1)} วินาที · ${v.videoWidth}×${v.videoHeight}${dur > 30 ? " · จะวิเคราะห์ 30 วินาทีแรก" : ""} · กรอกข้อมูลแล้วกด "วิเคราะห์การเดิน"`);
      $("rwGo").disabled = false;
    } catch (e) {
      msg("เปิดวิดีโอนี้ไม่ได้ (รูปแบบไฟล์ไม่รองรับ) · ลองแปลงเป็น MP4 (H.264) หรือถ่ายใหม่ด้วยกล้องมือถือในโหมดมาตรฐาน", true);
      $("rwGo").disabled = true;
    }
  }

  const readForm = () => ({
    ht: clampNum($("rwHt").value, 100, 220, 168), wt: clampNum($("rwWt").value, 25, 200, 62), age: Math.round(clampNum($("rwAge").value, 5, 100, 25)),
    sex: $("rwSex").value, view: $("rwView").value, swapLR: st.swap,
  });
  function clampNum(x, a, b, d) { const n = parseFloat(x); return isNaN(n) ? d : Math.max(a, Math.min(b, n)); }

  // ---------------------------------------------------------------- analysis
  $("rwGo").addEventListener("click", run);
  $("rwCancel").addEventListener("click", () => { if (st.ctrl) st.ctrl.abort(); });
  const busy = (on, t = "", frac = 0) => {
    $("rwBusy").hidden = !on;
    if (t) $("rwBusyT").textContent = t;
    $("rwBusyBar").style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  };
  async function run() {
    if (st.busy) return;
    if (st.demo) { reanalyze(); return; }
    if (!v.src) { msg("ยังไม่ได้เลือกวิดีโอ", true); return; }
    st.o = readForm();
    st.busy = true; api.onBusy && api.onBusy(true);
    st.ctrl = new AbortController();
    $("rwGo").disabled = true; msg("");
    busy(true, "กำลังโหลดโมเดล AI…", 0);
    let lmk = null;
    try {
      lmk = await createLandmarker($("rwQ").value, (t, fr) => busy(true, t, fr || 0));
      if (st.ctrl.signal.aborted) throw new DOMException("ยกเลิก", "AbortError");
      const t1 = Math.min(v.duration, 30);
      st.liveLm = null;
      const rec = await extractPoses(v, lmk, {
        fps: 30, t0: 0, t1, signal: st.ctrl.signal,
        onFrame: ({ k, n, lm, eta }) => {
          st.liveLm = lm;
          busy(true, `AI กำลังหาโครงร่างกาย เฟรม ${k + 1}/${n + 1}${k > 5 ? ` · เหลืออีกประมาณ ${Math.max(1, Math.round(eta))} วินาที` : ""}`, (k + 1) / (n + 1));
        },
      });
      st.rec = rec; st.liveLm = null;
      busy(true, "กำลังคำนวณมุมข้อต่อและจังหวะก้าว…", 1);
      await new Promise((r) => setTimeout(r, 30));
      reanalyze();
      v.currentTime = 0;
    } catch (e) {
      if (e && e.name === "AbortError") msg("ยกเลิกการวิเคราะห์แล้ว");
      else msg((e && e.message) || String(e), true);
    } finally {
      try { if (lmk) lmk.close(); } catch (e) { /* ignore */ }
      st.busy = false; api.onBusy && api.onBusy(false);
      busy(false); $("rwGo").disabled = false; st.liveLm = null;
    }
  }
  function reanalyze() {
    if (!st.rec) return;
    st.o = readForm();
    const R = analyze(st.rec, st.o);
    st.R = R;
    if (!R.ok) {
      msg(R.error, true);
      clearResult(R.error);
      return;
    }
    msg(st.demo ? st.demoLabel : `วิเคราะห์เสร็จ · ${R.cycles.L.length + R.cycles.R.length} รอบการเดิน · ดูผลด้านล่าง`);
    renderResult();
    api.onResult && api.onResult(R, st.o);
  }
  for (const id of ["rwHt", "rwWt", "rwAge", "rwSex", "rwView"]) $(id).addEventListener("change", () => { if (st.rec && !st.busy) reanalyze(); });
  $("rwSwap").addEventListener("click", () => { st.swap = !st.swap; reanalyze(); });

  // ---------------------------------------------------------------- demo (no video needed)
  async function startDemo(key) {
    if (st.busy) return;
    const d = loadDemo(key);
    clearResult();
    st.demo = true; st.rec = d.rec; st.name = "demo"; st.demoLabel = d.label || "ตัวอย่างผลวิเคราะห์";
    showWork();
    v.removeAttribute("src"); v.load(); v.hidden = true;
    $("rwVideoBox").style.aspectRatio = `${d.rec.W} / ${d.rec.H}`;
    $("rwHt").value = d.o.ht; $("rwWt").value = d.o.wt; $("rwAge").value = d.o.age; $("rwSex").value = d.o.sex; $("rwView").value = "auto";
    st.demoT = 0; st.demoPlay = true;
    reanalyze();
  }

  // ---------------------------------------------------------------- playback
  let rate = 0.5;
  const dur = () => (st.demo && st.rec ? st.rec.t1 : v.duration || 0);
  const curT = () => (st.demo ? st.demoT : v.currentTime || 0);
  const isPlaying = () => (st.demo ? st.demoPlay : !v.paused && !v.ended);
  $("rwPlay").addEventListener("click", () => {
    if (st.busy) return;
    if (st.demo) st.demoPlay = !st.demoPlay;
    else if (v.paused || v.ended) v.play().catch(() => {}); else v.pause();
  });
  $("rwSeek").addEventListener("input", (e) => { const t = (+e.target.value / 1000) * dur(); if (st.demo) st.demoT = t; else if (!st.busy) v.currentTime = t; });
  $("rwRate").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    rate = +b.dataset.v; v.playbackRate = rate;
    $("rwRate").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  });

  // ---------------------------------------------------------------- overlay
  function frameAt(t) {
    const rec = st.rec;
    if (!rec) return -1;
    return Math.max(0, Math.min(rec.frames.length - 1, Math.round((t - rec.t0) * rec.fps)));
  }
  function stanceAt(sd, t) {
    const R = st.R;
    if (!R || !R.ok) return null;
    const ic = R.events[sd].ic, to = R.events[sd].to;
    const last = ic.filter((x) => x <= t).pop();
    if (last === undefined) return null;
    const nextTo = to.find((x) => x > last), nextIc = ic.find((x) => x > last);
    if (nextTo === undefined && nextIc === undefined) return null;
    return nextTo !== undefined && t < nextTo && (nextIc === undefined || nextTo < nextIc);
  }
  function drawOverlay() {
    const box = $("rwVideoBox"), { ctx, w, h } = fit(ov);
    ctx.clearRect(0, 0, w, h);
    const rec = st.rec;
    let W, H;
    if (st.demo && rec) { W = rec.W; H = rec.H; ctx.fillStyle = "#070d18"; ctx.fillRect(0, 0, w, h); }
    else { W = v.videoWidth; H = v.videoHeight; }
    if (!W || !H) return;
    const vr = st.demo ? box.getBoundingClientRect() : v.getBoundingClientRect(), br = box.getBoundingClientRect();
    const sc = Math.min(vr.width / W, vr.height / H), dw = W * sc, dh = H * sc;
    const ox = vr.left - br.left + (vr.width - dw) / 2, oy = vr.top - br.top + (vr.height - dh) / 2;
    if (st.demo) { // floor line + grid for the stick-figure demo
      ctx.strokeStyle = "rgba(140,190,255,0.08)"; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += W / 12) { ctx.beginPath(); ctx.moveTo(ox + x * sc, oy); ctx.lineTo(ox + x * sc, oy + dh); ctx.stroke(); }
    }
    if (!$("rwSkel").checked && !st.demo) return;
    const t = curT();
    let pts = null;
    const R = st.R;
    if (st.liveLm) pts = (id) => [st.liveLm[id * 4] * W, st.liveLm[id * 4 + 1] * H, st.liveLm[id * 4 + 3]];
    else if (R && R.ok && R.track && rec) { const k = frameAt(t); if (rec.frames[k] && rec.frames[k].lm) pts = (id) => [R.track[id].x[k], R.track[id].y[k], 1]; }
    else if (rec) { const k = frameAt(t), lm = rec.frames[k] && rec.frames[k].lm; if (lm) pts = (id) => [lm[id * 4] * W, lm[id * 4 + 1] * H, lm[id * 4 + 3]]; }
    if (!pts) return;
    const P = (id) => { const p = pts(id); return [ox + p[0] * sc, oy + p[1] * sc, p[2]]; };
    const lw = Math.max(2, Math.min(5, dh / 160));
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const [a, b] of BONES) {
      const A = P(a), B = P(b);
      if (!ok(A[0]) || !ok(B[0])) continue;
      const col = LEFT_IDS.has(a) && LEFT_IDS.has(b) ? RW_COL.L : RIGHT_IDS.has(a) && RIGHT_IDS.has(b) ? RW_COL.R : "rgba(235,242,255,0.9)";
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = lw + 2.5; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
    if (st.demo) { // head for the stick figure (no video behind it)
      const e1 = P(LM.earL), e2 = P(LM.earR), nz = P(LM.nose);
      if (ok(e1[0]) && ok(nz[0])) { const cx = (e1[0] + e2[0] + nz[0]) / 3, cy = (e1[1] + e2[1] + nz[1]) / 3; ctx.strokeStyle = "rgba(235,242,255,0.9)"; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, dh * 0.045, 0, 7); ctx.stroke(); }
    }
    for (const id of [LM.hipL, LM.hipR, LM.kneeL, LM.kneeR, LM.ankL, LM.ankR, LM.shL, LM.shR]) {
      const A = P(id); if (!ok(A[0])) continue;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(A[0], A[1], lw * 0.9, 0, 7); ctx.fill();
    }
    // stance markers under the feet
    if (R && R.ok && !st.liveLm) for (const sd of ["L", "R"]) {
      const s = stanceAt(sd, t);
      if (s === null) continue;
      const he = P(sd === "L" ? LM.heelL : LM.heelR), to = P(sd === "L" ? LM.toeL : LM.toeR);
      if (!ok(he[0]) || !ok(to[0])) continue;
      ctx.strokeStyle = RW_COL[sd]; ctx.lineWidth = s ? lw * 1.6 : 1.2; ctx.globalAlpha = s ? 1 : 0.5;
      ctx.beginPath(); ctx.ellipse((he[0] + to[0]) / 2, Math.max(he[1], to[1]) + lw * 2, Math.abs(to[0] - he[0]) / 2 + lw * 3, lw * 1.6, 0, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (R && R.ok && R.view === "side" && !st.liveLm) {
      const k = frameAt(t), sd = ["R", "L"].find((x) => R.mean[x].near) || "R", kn = R.ser.knee[sd][k];
      if (ok(kn)) {
        const A = P(sd === "L" ? LM.kneeL : LM.kneeR);
        ctx.font = `600 ${Math.max(12, lw * 4)}px Kanit, sans-serif`; ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 3;
        const txt = `เข่า${sd === "L" ? "ซ้าย" : "ขวา"} ${kn.toFixed(0)}°`;
        ctx.strokeText(txt, A[0] + lw * 4, A[1]); ctx.fillText(txt, A[0] + lw * 4, A[1]);
      }
    }
  }

  // ---------------------------------------------------------------- results
  function clearResult(err) {
    st.R = null;
    $("rwSum").hidden = true; $("rwNone").hidden = false;
    $("rwNone").textContent = err ? "วิเคราะห์ไม่สำเร็จ: " + err : "ยังไม่มีผลวิเคราะห์ · ถ่ายหรือเลือกคลิปการเดินด้านบน แล้วกด \"วิเคราะห์การเดิน\" หรือกดดูตัวอย่าง";
    $("rwCharts").innerHTML = ""; $("rwTbl").innerHTML = ""; $("rwRel").innerHTML = "";
    api.onClear && api.onClear();
  }
  function renderResult() {
    const R = st.R, o = st.o;
    $("rwNone").hidden = true; $("rwSum").hidden = false;
    // score card
    const vk = R.verdict.k, col = { good: "var(--ok)", fair: "var(--warn)", poor: "var(--bad)" }[vk], C = 2 * Math.PI * 52;
    const kpi = (l, val, u, nrm) => `<div class="kpi"><div class="l">${l}</div><div class="v">${val}<small>${u}</small></div><div class="nrm">${nrm}</div></div>`;
    const relCol = R.reliability >= 75 ? "var(--ok)" : R.reliability >= 50 ? "var(--warn)" : "var(--bad)";
    $("rwScore").innerHTML = `
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(140,190,255,.12)" stroke-width="10"/><circle cx="60" cy="60" r="52" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${((C * R.score) / 100).toFixed(1)} ${C.toFixed(1)}"/></svg><div class="n"><b>${R.score}</b><span>คะแนน / 100</span></div></div>
      <div class="verdict"><div class="k">ผลการวิเคราะห์ · ถ่ายจาก${R.view === "side" ? "ด้านข้าง" : R.toward ? "ด้านหน้า" : "ด้านหลัง"}</div><h3 class="${vk}">${R.verdict.th}</h3><p>${R.verdict.sub}</p>
        <div class="pills"><span class="pill">รอบการเดิน <b>${R.cycles.L.length + R.cycles.R.length}</b></span><span class="pill">ความน่าเชื่อถือ <b style="color:${relCol}">${R.reliability}%</b></span><span class="pill">BMI <b>${(o.wt / (o.ht / 100) ** 2).toFixed(1)}</b></span>${R.items.filter((x) => x.status !== "ok").length ? `<span class="pill">ควรดู <b>${R.items.filter((x) => x.status !== "ok").length}</b> ข้อ</span>` : ""}</div></div>
      <div class="kpis">${kpi("จังหวะก้าว", f(R.st.cadence, 0), " ก้าว/นาที", "ปกติ 95–125")}${R.view === "side" ? kpi("ความเร็ว", f(R.st.speed, 2), " m/s", `ปกติวัยนี้ ${f(R.norm.speed, 2)}`) + kpi("ความยาวก้าว", f(R.st.strideLen * 50, 0), " cm", `ปกติ ~${f(R.norm.stepLenH * o.ht, 0)}`) : kpi("ฐานก้าวกว้าง", f(R.st.stepWidth * 100, 1), " cm", "ปกติ 5–13")}${R.view === "side" ? kpi("ช่วงยืน ซ้าย/ขวา", `${f(R.st.stance.L, 0)}/${f(R.st.stance.R, 0)}`, " %", "ปกติ ~60/60") : kpi("เข่าเข้าใน ซ้าย/ขวา", `${f(R.st.fppa.L, 0)}/${f(R.st.fppa.R, 0)}`, "°", "ปกติ −6 ถึง +6")}</div>`;
    // principle checks
    $("rwChecks").innerHTML = R.items.map((it, k) => `<div class="chk-i" data-s="${it.status}" data-k="${k}"><div class="top"><span class="ic">${STAT[it.status][0]}</span><span class="tt">${esc(it.title)}</span><span class="stl">${STAT[it.status][1]}</span></div>
      <div class="val">${esc(it.value)}</div><div class="nrm">ค่าปกติ: ${esc(it.normal)}</div>
      <div class="more">${it.why ? `<p>${esc(it.why)}</p>` : "<p>อยู่ในช่วงของการเดินปกติ</p>"}${it.tip && it.status !== "ok" ? `<p class="tip">${esc(it.tip)}</p>` : ""}</div></div>`).join("");
    renderCharts(); renderTable(); renderRel();
  }
  $("rwChecks").addEventListener("click", (e) => { const c = e.target.closest(".chk-i"); if (c) c.classList.toggle("open"); });

  function renderCharts() {
    const R = st.R, box = $("rwCharts");
    if (!R || !R.ok) return;
    if (R.view === "side") {
      const J = [["hip", "สะโพก · Hip (ต้นขาเทียบแนวดิ่ง)", "งอ + / เหยียด −"], ["knee", "เข่า · Knee flexion", "งอ +"], ["ank", "ข้อเท้า · Ankle", "กระดกขึ้น + / ถีบลง −"]];
      box.innerHTML = J.map(([k, t, s]) => `<div class="ch"><div class="t">${t}</div><div class="s">${s}</div><canvas id="rwc_${k}"></canvas></div>`).join("");
      J.forEach(([k]) => attachHover($("rwc_" + k)));
      $("rwChLegend").innerHTML = ["L", "R"].map((sd) => `<span><i style="background:${RW_COL[sd]}"></i>${SIDE[sd]}${R.mean[sd].near ? "" : " (ฝั่งไกลกล้อง · ไม่ชัด)"}</span>`).join("") + `<span><i style="background:${RW_COL.N}"></i>ค่าปกติ</span><span><i class="band"></i>ช่วงปกติ</span>`;
    } else {
      const J = [["fppa", "เข่าเข้าใน (+) / โก่งออก (−) · FPPA", "องศา · ตลอดคลิป"], ["pelvis", "สะโพกเอียง · Pelvic obliquity", "+ = สะโพกซ้ายต่ำ"], ["trunkLat", "ลำตัวเอียงข้าง", "องศา"]];
      box.innerHTML = J.map(([k, t, s]) => `<div class="ch"><div class="t">${t}</div><div class="s">${s}</div><canvas id="rwc_${k}"></canvas></div>`).join("");
      J.forEach(([k]) => attachHover($("rwc_" + k)));
      $("rwChLegend").innerHTML = ["L", "R"].map((sd) => `<span><i style="background:${RW_COL[sd]}"></i>${SIDE[sd]}</span>`).join("") + `<span><i class="band"></i>ช่วงปกติ</span>`;
    }
    drawRwCharts();
  }
  function drawRwCharts() {
    const R = st.R;
    if (!R || !R.ok || !$("rwCharts").firstElementChild) return;
    if (R.view === "side") {
      const N = R.norm;
      for (const k of ["hip", "knee", "ank"]) {
        const c = $("rwc_" + k); if (!c) continue;
        const series = [];
        for (const sd of ["L", "R"]) for (const cy of R.cycles[sd]) if (cy.near || !R.mean[sd].near) series.push({ data: cy.curves[k], color: RW_COL[sd], width: 1, alpha: 0.22 });
        series.push({ data: N.curves[k], color: RW_COL.N, width: 1.6, dash: [5, 4], label: "ค่าปกติ" });
        for (const sd of ["L", "R"]) { const m = R.mean[sd]; if (m && m[k] && !m.borrowed) series.push({ data: m[k], color: RW_COL[sd], width: m.near ? 2.6 : 1.6, dash: m.near ? null : [2, 3], label: SIDE[sd] + (m.near ? "" : " (ไม่ชัด)") }); }
        const b = N.band[k];
        drawCompare(c, { series, ranges: [{ lo: N.curves[k].map((x) => x - b), hi: N.curves[k].map((x) => x + b) }], toeOff: [{ x: R.mean.L.sf * 100, color: RW_COL.L }, { x: R.mean.R.sf * 100, color: RW_COL.R }, { x: N.sf * 100, color: "#d7e3f4" }], bands: true, unit: "°", dp: 0 });
      }
    } else {
      const n = R.n, dur = (n - 1) / R.fps, rs = (a) => { const out = []; for (let q = 0; q <= 100; q++) out.push(a[Math.min(n - 1, Math.round((q / 100) * (n - 1)))]); return out; };
      const xfmt = (i) => ((i / 100) * dur).toFixed(1) + "s", hoverTitle = (i) => `เวลา ${((i / 100) * dur).toFixed(2)} วินาที`;
      const band = (w) => [{ lo: new Array(101).fill(-w), hi: new Array(101).fill(w) }];
      const ch = (id, series, w) => { const c = $(id); if (c) drawCompare(c, { series, ranges: band(w), xfmt, hoverTitle, unit: "°", dp: 1 }); };
      ch("rwc_fppa", ["L", "R"].map((sd) => ({ data: rs(R.ser.fppa[sd]), color: RW_COL[sd], width: 2, label: SIDE[sd] })), 6);
      ch("rwc_pelvis", [{ data: rs(R.ser.pelvis), color: "#d7e3f4", width: 2, label: "สะโพก" }], 5);
      ch("rwc_trunkLat", [{ data: rs(R.ser.trunkLat), color: "#d7e3f4", width: 2, label: "ลำตัว" }], 5);
    }
  }
  function drawTl() {
    const R = st.R, c = $("rwTimeline");
    if (!R || !R.ok || !c) return;
    const rows = ["L", "R"].map((sd) => {
      const ic = R.events[sd].ic, to = R.events[sd].to, spans = [];
      for (const a of ic) { const b = to.find((x) => x > a); const nx = ic.find((x) => x > a); if (b !== undefined && (nx === undefined || b < nx)) spans.push([a, b]); }
      return { label: SIDE[sd], color: RW_COL[sd], spans, ic, to };
    });
    const t0 = st.rec.t0, t1 = st.rec.t0 + (st.rec.frames.length - 1) / st.rec.fps;
    drawTimeline(c, rows, { t0, t1, cursor: curT(), passes: (R.passes || []).map((p) => [t0 + p.a / R.fps, t0 + (p.b - 1) / R.fps]) });
  }
  $("rwTimeline").addEventListener("click", (e) => {
    const c = $("rwTimeline"), L = c._tl; if (!L) return;
    const x = e.clientX - c.getBoundingClientRect().left, t = L.t0 + ((x - L.pl) / L.W) * (L.t1 - L.t0);
    if (t < L.t0 || t > L.t1) return;
    if (st.demo) st.demoT = t; else { v.pause(); v.currentTime = t; }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function renderTable() {
    const R = st.R, o = st.o, s = R.st, N = R.norm;
    const sIcon = (stt) => `<span class="st" style="background:var(--${stt})"></span>`;
    const judge = (v, lo, hi) => (!ok(v) ? "" : v < lo || v > hi ? (v < lo - (hi - lo) * 0.5 || v > hi + (hi - lo) * 0.5 ? sIcon("bad") : sIcon("warn")) : sIcon("ok"));
    const rows = [];
    const row = (label, L, Rv, nrm, j = "") => rows.push(`<tr><td>${j}${label}</td><td>${L}</td><td>${Rv}</td><td>${nrm}</td></tr>`);
    row("จังหวะก้าว (ก้าว/นาที)", f(s.cadence, 0), "", "95–125", judge(s.cadence, 95, 125));
    row("เวลาต่อรอบการเดิน (s)", f(s.strideT, 2), "", "0.96–1.26");
    if (Math.min(R.cycles.L.length, R.cycles.R.length) >= 4) row("ความแปรปรวนของจังหวะ (CV %)", f(s.cv, 1), "", "< 5", judge(s.cv, 0, 5));
    if (R.view === "side") {
      row("ช่วงยืนบนขา (stance %)", f(s.stance.L, 1), f(s.stance.R, 1), "58–64", judge(Math.max(Math.abs(s.stance.L - 61), Math.abs(s.stance.R - 61)), 0, 3.5));
      row("เวลาก้าว (s)", f(s.stepT.L, 2), f(s.stepT.R, 2), "ใกล้เคียงกัน");
      row("ความเร็ว (m/s)", f(s.speed, 2), "", `≥ ${f(N.speed - 0.25, 2)} (อายุ ${o.age})`, judge(s.speed, N.speed - 0.25, 2.2));
      row("ความยาวก้าว (cm)", f(s.stepLen.L * 100, 0), f(s.stepLen.R * 100, 0), `${f(o.ht * (N.stepLenH - 0.05), 0)}–${f(o.ht * (N.stepLenH + 0.05), 0)}`, judge(s.stepLenH, N.stepLenH - 0.05, N.stepLenH + 0.06));
      row("ช่วงสองเท้าแตะพื้น (%)", f(s.ds, 1), "", "18–28", judge(s.ds, 18, 28));
      row("ลำตัวโน้มเฉลี่ย (°)", f(s.trunk, 1), "", "0–10", judge(s.trunk, -3, 10));
      row("ตัวขึ้นลงต่อรอบ (cm)", f(s.vert, 1), "", "2–6", judge(s.vert, 1.5, 6.5));
      row("แกว่งแขน (°)", f(s.armROM.L, 0), f(s.armROM.R, 0), "20–45");
      const F = { L: R.mean.L.feat, R: R.mean.R.feat }, NF = N.feat, t2 = (sd) => (R.mean[sd].near ? "" : " *");
      const fr = (lab, k, d = 0) => row(lab, f(F.L[k], d) + t2("L"), f(F.R[k], d) + t2("R"), f(NF[k], d));
      fr("เข่างอตอนรับน้ำหนัก (°)", "kneeLR"); fr("เข่าตอนกลางการยืน (°)", "kneeSt"); fr("เข่างอสูงสุดตอนแกว่ง (°)", "kneeSw");
      fr("สะโพกเหยียดสุด (°)", "hipExt"); fr("ช่วงเคลื่อนไหวสะโพก (°)", "hipROM"); fr("ข้อเท้าถีบลงตอนออกตัว (°)", "ankPF"); fr("ข้อเท้ากระดกสุดช่วงยืน (°)", "ankDF");
    } else {
      row("มุมเข่าเข้าใน/โก่ง FPPA (°)", f(s.fppa.L, 1), f(s.fppa.R, 1), "−6 ถึง +6", judge(Math.max(Math.abs(s.fppa.L), Math.abs(s.fppa.R)), 0, 6));
      row("สะโพกตกขณะยืนขาเดียว (°)", f(s.pelvicDrop.L, 1), f(s.pelvicDrop.R, 1), "< 5", judge(Math.max(s.pelvicDrop.L, s.pelvicDrop.R), 0, 5));
      row("ลำตัวเอียงข้าง (°)", f(s.trunkLat.L, 1), f(s.trunkLat.R, 1), "< 5", judge(Math.max(s.trunkLat.L, s.trunkLat.R), 0, 5));
      row("ฐานก้าวกว้าง (cm)", f(s.stepWidth * 100, 1), "", "5–13", judge(s.stepWidth * 100, 5, 13));
    }
    rows.push(`<tr><td colspan="4" class="sub">ค่าตามงานวิจัยรามาฯ ที่คาดจาก BMI ${f(N.bmi, 1)}: เข่าโก่ง (varus) ตอนส้นเท้าแตะพื้น ${f(N.varusIC, 1)}° · เข่าบิดเข้าในสูงสุด ${f(N.irMax, 1)}° (มุมสองค่านี้ต้องใช้กล้อง 3 มิติ วัดจากวิดีโอมือถือโดยตรงไม่ได้)</td></tr>`);
    if (R.view === "side" && R.farOnly && R.farOnly.length) rows.push(`<tr><td colspan="4" class="sub">* ขาฝั่งไกลกล้อง มุมข้อต่อมักต่ำกว่าความจริงเพราะถูกขาอีกข้างบัง</td></tr>`);
    $("rwTbl").innerHTML = `<thead><tr><th>ค่า</th><th>ซ้าย / รวม</th><th>ขวา</th><th>ค่าปกติ</th></tr></thead><tbody>${rows.join("")}</tbody>`;
  }
  function renderRel() {
    const R = st.R, col = R.reliability >= 75 ? "var(--ok)" : R.reliability >= 50 ? "var(--warn)" : "var(--bad)";
    const notes = [...R.issues];
    notes.push("มุมข้อเท้าวัดจากวิดีโอได้แม่นยำน้อยที่สุด (คลาดเคลื่อนได้ 5–10°) ให้ดูแนวโน้มมากกว่าตัวเลข");
    if (R.view === "side") notes.push(`ใช้ ${R.cycles.L.length} รอบของขาซ้าย และ ${R.cycles.R.length} รอบของขาขวา · ตรวจเจอคน ${Math.round(R.detRate * 100)}% ของเฟรม`);
    $("rwRel").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-family:var(--f-head);font-size:18px">${R.reliability}%</b><span class="muted">${R.reliability >= 75 ? "เชื่อถือได้ดี" : R.reliability >= 50 ? "พอใช้" : "ต่ำ ควรถ่ายใหม่"}</span></div><div class="relbar"><i style="width:${R.reliability}%;background:${col}"></i></div><ul>${notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  }
  $("rwExport").addEventListener("click", () => {
    const R = st.R; if (!R || !R.ok) return;
    const lines = [];
    if (R.view === "side") {
      lines.push("time_s,hipL,hipR,kneeL,kneeR,ankleL,ankleR,trunk,stanceL,stanceR");
      for (let i = 0; i < R.n; i++) {
        const t = R.t[i], g = (a) => (ok(a[i]) ? a[i].toFixed(2) : "");
        const sL = stanceAt("L", t), sR = stanceAt("R", t);
        lines.push([t.toFixed(3), g(R.ser.hip.L), g(R.ser.hip.R), g(R.ser.knee.L), g(R.ser.knee.R), g(R.ser.ank.L), g(R.ser.ank.R), g(R.ser.trunk), sL === null ? "" : +sL, sR === null ? "" : +sR].join(","));
      }
    } else {
      lines.push("time_s,fppaL,fppaR,pelvis,trunkLat");
      for (let i = 0; i < R.n; i++) { const g = (a) => (ok(a[i]) ? a[i].toFixed(2) : ""); lines.push([R.t[i].toFixed(3), g(R.ser.fppa.L), g(R.ser.fppa.R), g(R.ser.pelvis), g(R.ser.trunkLat)].join(",")); }
    }
    lines.push("", "summary,value");
    lines.push(`score,${R.score}`, `verdict,${R.verdict.th}`, `reliability,${R.reliability}`, `cadence_spm,${f(R.st.cadence, 1)}`, `stance_L_pct,${f(R.st.stance.L, 1)}`, `stance_R_pct,${f(R.st.stance.R, 1)}`);
    if (R.view === "side") lines.push(`speed_mps,${f(R.st.speed, 3)}`, `step_L_m,${f(R.st.stepLen.L, 3)}`, `step_R_m,${f(R.st.stepLen.R, 3)}`);
    for (const it of R.items) lines.push(`"${it.title}",${it.status}`);
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "gait-analysis.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("rwToSim").addEventListener("click", () => { if (st.R && st.R.ok) api.onToSim && api.onToSim(st.R, st.o); });

  // ---------------------------------------------------------------- per-frame hook
  function tick(dt) {
    if (st.demo && st.demoPlay && st.rec) { st.demoT += dt * rate; const d = dur(); if (st.demoT > d) st.demoT = 0; }
    const d = dur(), t = curT();
    if (d > 0 && document.activeElement !== $("rwSeek")) $("rwSeek").value = Math.round((t / d) * 1000);
    $("rwTime").textContent = t.toFixed(1) + " s";
    $("rwPlay").firstElementChild.className = isPlaying() && !st.busy ? "i-pause" : "i-play";
    if (!$("rwWork").hidden) drawOverlay();
  }
  // gait phase of the right leg at video time t (cycle index + fraction), for the 3D replay
  function phaseAt(t) {
    const R = st.R;
    if (!R || !R.ok) return null;
    const sd = R.events.R.ic.length >= 2 ? "R" : "L", ic = R.events[sd].ic;
    for (let k = 0; k + 1 < ic.length; k++) if (t >= ic[k] && t < ic[k + 1]) return k + (t - ic[k]) / (ic[k + 1] - ic[k]) - (sd === "L" ? R.st.offL ?? 0.5 : 0);
    return null;
  }
  return {
    tick, phaseAt, drawCharts: drawRwCharts, drawTimeline: drawTl,
    get time() { return curT(); }, get playing() { return isPlaying(); }, get busy() { return st.busy; }, get result() { return st.R; },
    _state: st, _reanalyze: reanalyze,
  };
}
