export const C1 = "#e8f4ff", C2 = "#38c6ff";
export const PHASES = [[0, 2, "IC"], [2, 12, "LR"], [12, 31, "MSt"], [31, 50, "TSt"], [50, 60, "PSw"], [60, 73, "ISw"], [73, 87, "MSw"], [87, 100, "TSw"]];

export function fit(c) {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; }
function fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : (+v.toFixed(2)).toString(); }
const MONO = "'JetBrains Mono', ui-monospace, monospace";

// series: [{data(101), color, dash, glow}], toeOff: [{x, color}], cursors: [{x, y, color}]
export function drawCompare(c, { series, toeOff = [], cursors = [], zero = false, diff = null, bands = false, lo: fLo, hi: fHi, pct = false }) {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  const pl = 38, pr = 8, pt = bands ? 22 : 10, pb = 20, W = w - pl - pr, H = h - pt - pb;
  const all = series.flatMap((s) => Array.from(s.data)).concat(diff ? Array.from(diff) : []);
  let lo = fLo ?? Math.min(...all), hi = fHi ?? Math.max(...all);
  if (fHi === undefined) { const pad = (hi - lo) * 0.12 || 1; lo -= fLo === undefined ? pad : 0; hi += pad; }
  if (zero) lo = Math.min(0, lo);
  const X = (i) => pl + (i / 100) * W, Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * H;
  if (bands) {
    ctx.font = `10px ${MONO}`; ctx.textAlign = "center";
    PHASES.forEach(([a, b, n], i) => {
      ctx.fillStyle = i % 2 ? "rgba(120,180,255,0.035)" : "rgba(120,180,255,0.0)"; ctx.fillRect(X(a), pt, X(b) - X(a), H);
      ctx.fillStyle = a < 60 ? "#7fa6cc" : "#4f6b8c"; if (b - a > 4) ctx.fillText(n, (X(a) + X(b)) / 2, 13);
    });
    ctx.fillStyle = "rgba(127,166,204,0.25)"; ctx.fillRect(X(0), 16, X(60) - X(0), 2);
    ctx.fillStyle = "rgba(79,107,140,0.25)"; ctx.fillRect(X(60), 16, X(100) - X(60), 2);
  }
  ctx.font = `10px ${MONO}`;
  const step = niceStep((hi - lo) / 4);
  ctx.textAlign = "right";
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    ctx.strokeStyle = "rgba(140,190,255,0.07)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl, Y(v)); ctx.lineTo(w - pr, Y(v)); ctx.stroke();
    ctx.fillStyle = "#5d7290"; ctx.fillText(pct ? Math.round(v * 100) + "%" : fmt(v), pl - 5, Y(v) + 3);
  }
  ctx.textAlign = "center";
  for (const i of [0, 20, 40, 60, 80, 100]) ctx.fillText(i + "%", X(i), h - 5);
  if (lo < 0 && hi > 0) { ctx.strokeStyle = "rgba(160,200,255,0.2)"; ctx.beginPath(); ctx.moveTo(pl, Y(0)); ctx.lineTo(w - pr, Y(0)); ctx.stroke(); }
  for (const t of toeOff) {
    ctx.strokeStyle = t.color; ctx.globalAlpha = 0.4; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(t.x), pt); ctx.lineTo(X(t.x), pt + H); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if (diff) {
    ctx.fillStyle = "rgba(56,198,255,0.13)"; ctx.beginPath();
    ctx.moveTo(X(0), Y(0)); diff.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(100), Y(0)); ctx.closePath(); ctx.fill();
  }
  for (const s of series) {
    ctx.save();
    if (s.fill) {
      const gr = ctx.createLinearGradient(0, pt, 0, pt + H); gr.addColorStop(0, s.fill); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(X(0), Y(Math.max(lo, 0)));
      s.data.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(100), Y(Math.max(lo, 0))); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.globalAlpha = s.alpha ?? 1;
    ctx.setLineDash(s.dash || []);
    if (s.glow) { ctx.shadowColor = s.color; ctx.shadowBlur = 8; }
    ctx.beginPath(); s.data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
    ctx.restore();
  }
  for (const k of cursors) {
    ctx.save(); ctx.strokeStyle = k.color; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(X(k.x), pt); ctx.lineTo(X(k.x), pt + H); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.fillStyle = k.color; ctx.shadowColor = k.color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(X(k.x), Y(k.y), 3.8, 0, 7); ctx.fill(); ctx.restore();
  }
}

// oscilloscope: traces [{raw, env, color, label}] covering `win` seconds
export function drawScope(c, traces, { win = 3, now = 0, scale = 1.6, compact = false } = {}) {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  const pl = compact ? 4 : 64, pr = 6, pt = 4, pb = compact ? 4 : 18, W = w - pl - pr, rowH = (h - pt - pb) / traces.length;
  traces.forEach((tr, ti) => {
    const y0 = pt + ti * rowH, cy = y0 + rowH / 2, amp = rowH * 0.46;
    ctx.strokeStyle = "rgba(140,190,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl, cy); ctx.lineTo(w - pr, cy); ctx.stroke();
    if (!compact) {
      ctx.fillStyle = tr.color; ctx.font = "600 12px Kanit, 'IBM Plex Sans Thai', sans-serif"; ctx.textAlign = "left";
      ctx.fillText(tr.label, 4, cy - 2);
      ctx.fillStyle = "#5d7290"; ctx.font = `10px ${MONO}`; ctx.fillText(tr.sub || "", 4, cy + 12);
    }
    if (tr.absent) {
      ctx.fillStyle = "#4f6b8c"; ctx.font = "12px 'IBM Plex Sans Thai', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("ไม่มีสัญญาณ: อยู่ในเบ้าขาเทียม", pl + W / 2, cy + 4);
      return;
    }
    const n = tr.raw.length, per = n / W;
    ctx.fillStyle = tr.color; ctx.globalAlpha = 0.85;
    for (let px = 0; px < W; px++) {
      const a = Math.floor(px * per), b = Math.min(n, Math.floor((px + 1) * per) + 1);
      let mn = 0, mx = 0;
      for (let k = a; k < b; k++) { const v = tr.raw[k]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const yA = cy - (mx / scale) * amp, yB = cy - (mn / scale) * amp;
      ctx.fillRect(pl + px, Math.max(y0, yA), 1, Math.max(1, Math.min(y0 + rowH, yB) - Math.max(y0, yA)));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let px = 0; px < W; px += 2) { const v = tr.env[Math.floor(px * per)]; const y = cy - (v / scale) * amp; px ? ctx.lineTo(pl + px, y) : ctx.moveTo(pl + px, y); }
    ctx.stroke();
  });
  if (!compact) {
    ctx.fillStyle = "#5d7290"; ctx.font = `10px ${MONO}`; ctx.textAlign = "center";
    for (let s = 0; s <= win; s++) { const x = pl + (s / win) * W; ctx.fillText((now - win + s).toFixed(0) + " s", x, h - 4); }
    ctx.textAlign = "right"; ctx.fillText(`±${scale.toFixed(1)} mV`, w - pr, 12);
  }
}

const RAMP = [[0, [8, 20, 44]], [0.25, [14, 64, 160]], [0.55, [30, 160, 255]], [0.8, [120, 230, 255]], [1, [255, 255, 255]]];
export function rampRGB(x) {
  x = Math.max(0, Math.min(1, x));
  for (let i = 1; i < RAMP.length; i++) if (x <= RAMP[i][0]) {
    const [x0, a] = RAMP[i - 1], [x1, b] = RAMP[i], f = (x - x0) / (x1 - x0);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
  }
  return "rgb(255,255,255)";
}

// activation heatmap: rows [{id, label, data(101), absent}]
export function drawMatrix(c, { rows, cursor = null, sel = null, title = "", color = "#fff", norm = 0.5 }) {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  const pl = 46, pr = 6, pt = 20, pb = 16, W = w - pl - pr, rowH = (h - pt - pb) / rows.length;
  ctx.fillStyle = color; ctx.font = "600 12px Kanit, sans-serif"; ctx.textAlign = "left"; ctx.fillText(title, 2, 13);
  const cw = W / 101;
  rows.forEach((r, i) => {
    const y = pt + i * rowH;
    ctx.fillStyle = r.id === sel ? "#ffffff" : "#7fa6cc"; ctx.font = `${r.id === sel ? 700 : 500} 10px ${MONO}`; ctx.textAlign = "right";
    ctx.fillText(r.label, pl - 6, y + rowH / 2 + 3);
    if (r.absent) {
      ctx.fillStyle = "rgba(90,110,140,0.12)"; ctx.fillRect(pl, y + 1, W, rowH - 2);
      ctx.strokeStyle = "rgba(90,110,140,0.35)"; ctx.lineWidth = 1;
      for (let x = pl; x < pl + W; x += 8) { ctx.beginPath(); ctx.moveTo(x, y + rowH - 1); ctx.lineTo(x + rowH - 2, y + 1); ctx.stroke(); }
      return;
    }
    for (let k = 0; k <= 100; k++) { ctx.fillStyle = rampRGB(r.data[k] / norm); ctx.fillRect(pl + k * cw, y + 1, cw + 0.6, rowH - 2); }
    if (r.id === sel) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.strokeRect(pl - 0.5, y + 0.5, W + 1, rowH - 1); }
  });
  ctx.fillStyle = "#5d7290"; ctx.font = `10px ${MONO}`; ctx.textAlign = "center";
  for (const i of [0, 20, 40, 60, 80, 100]) ctx.fillText(i + "%", pl + (i / 100) * W, h - 3);
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(pl + 0.6 * W, pt); ctx.lineTo(pl + 0.6 * W, pt + rows.length * rowH); ctx.stroke(); ctx.setLineDash([]);
  if (cursor !== null) {
    const x = pl + (cursor / 100) * W;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(x, pt - 2); ctx.lineTo(x, pt + rows.length * rowH + 2); ctx.stroke(); ctx.restore();
  }
  c._layout = { pt, rowH, n: rows.length, ids: rows.map((r) => r.id) };
}

// lanes: [{label, color, hist:[{t, ref, pre}], marks:[{t,e,type}], pred:boolean}]
export function drawContact(c, lanes, now) {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  const pl = 118, pr = 10, pt = 6, pb = 22, W = w - pl - pr, laneH = (h - pt - pb) / lanes.length;
  const t0 = now - 4, X = (t) => pl + ((t - t0) / 4) * W;
  lanes.forEach((L, li) => {
    const y0 = pt + li * laneH, top = y0 + 11, bot = y0 + laneH - 11;
    ctx.fillStyle = L.color; ctx.font = "600 12px Kanit, 'IBM Plex Sans Thai', sans-serif"; ctx.textAlign = "left";
    ctx.fillText(L.label, 4, (top + bot) / 2 + 4);
    ctx.strokeStyle = "rgba(140,190,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl, bot); ctx.lineTo(w - pr, bot); ctx.stroke();
    ctx.fillStyle = "rgba(140,190,255,0.12)";
    let st = null;
    for (let i = 0; i <= L.hist.length; i++) {
      const a = L.hist[i], on = a && a.ref;
      if (on && st === null) st = Math.max(a.t, t0);
      if (!on && st !== null) { const end = a ? a.t : now; ctx.fillRect(X(st), top, X(end) - X(st), bot - top); st = null; }
    }
    if (L.pred) {
      ctx.save(); ctx.strokeStyle = L.color; ctx.lineWidth = 1.8; ctx.shadowColor = L.color; ctx.shadowBlur = 6; ctx.beginPath();
      let first = true;
      for (const s of L.hist) { if (s.t < t0) continue; const y = s.pre ? top + 2 : bot - 1; if (first) { ctx.moveTo(X(s.t), y); first = false; } else ctx.lineTo(X(s.t), y); }
      ctx.stroke(); ctx.restore();
      ctx.font = `10px ${MONO}`; ctx.textAlign = "center";
      for (const e of L.marks) {
        if (e.t < t0) continue;
        const x = X(e.t + e.e);
        ctx.fillStyle = L.color; ctx.beginPath();
        if (e.type === "IC") { ctx.moveTo(x, bot + 1); ctx.lineTo(x - 4, bot + 8); ctx.lineTo(x + 4, bot + 8); }
        else { ctx.moveTo(x, top - 1); ctx.lineTo(x - 4, top - 8); ctx.lineTo(x + 4, top - 8); }
        ctx.fill();
        ctx.fillStyle = "#7f93ad";
        ctx.fillText(`${e.e >= 0 ? "+" : ""}${(e.e * 1000).toFixed(0)}`, x + 16, e.type === "IC" ? bot + 9 : top - 2);
      }
    } else {
      ctx.fillStyle = "#4f6b8c"; ctx.font = "11px 'IBM Plex Sans Thai', sans-serif"; ctx.textAlign = "right";
      ctx.fillText("ไม่ใช่โหมดขาเทียม จึงแสดงเฉพาะค่าจริง", w - pr, (top + bot) / 2 + 4);
    }
  });
  ctx.fillStyle = "#5d7290"; ctx.font = `10px ${MONO}`; ctx.textAlign = "center";
  for (let t = Math.ceil(t0); t <= now; t++) ctx.fillText(t.toFixed(0) + " s", X(t), h - 5);
}
