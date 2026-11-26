export const C1 = "#f4f4f5", C2 = "#ff2a2a";

export function fit(c) {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; }
function fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : (+v.toFixed(1)).toString(); }

// series: [{data(101), color, dash, alpha}], toeOff: [{x, color}], cursors: [{x, y, color}]
export function drawCompare(c, { series, toeOff = [], cursors = [], zero = false, diff = null }) {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  const pl = 36, pr = 8, pt = 10, pb = 20, W = w - pl - pr, H = h - pt - pb;
  const all = series.flatMap((s) => s.data).concat(diff || []);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  if (zero) lo = Math.min(0, lo);
  const X = (i) => pl + (i / 100) * W, Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * H;
  ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
  const step = niceStep((hi - lo) / 4);
  ctx.textAlign = "right";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl, Y(v)); ctx.lineTo(w - pr, Y(v)); ctx.stroke();
    ctx.fillStyle = "#6b6b73"; ctx.fillText(fmt(v), pl - 5, Y(v) + 3);
  }
  ctx.textAlign = "center";
  for (const i of [0, 20, 40, 60, 80, 100]) ctx.fillText(i + "%", X(i), h - 5);
  if (lo < 0 && hi > 0) { ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.moveTo(pl, Y(0)); ctx.lineTo(w - pr, Y(0)); ctx.stroke(); }
  for (const t of toeOff) {
    ctx.strokeStyle = t.color; ctx.globalAlpha = 0.35; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(t.x), pt); ctx.lineTo(X(t.x), pt + H); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if (diff) {
    ctx.fillStyle = "rgba(255,42,42,0.10)"; ctx.beginPath();
    ctx.moveTo(X(0), Y(0)); diff.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(100), Y(0)); ctx.closePath(); ctx.fill();
  }
  for (const s of series) {
    ctx.save();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.globalAlpha = s.alpha ?? 1;
    ctx.setLineDash(s.dash || []);
    if (s.glow) { ctx.shadowColor = s.color; ctx.shadowBlur = 8; }
    ctx.beginPath(); s.data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
    ctx.restore();
  }
  for (const k of cursors) {
    ctx.save(); ctx.fillStyle = k.color; ctx.shadowColor = k.color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(X(k.x), Y(k.y), 3.8, 0, 7); ctx.fill(); ctx.restore();
  }
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
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl, bot); ctx.lineTo(w - pr, bot); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
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
      ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      for (const e of L.marks) {
        if (e.t < t0) continue;
        const x = X(e.t + e.e);
        ctx.fillStyle = L.color; ctx.beginPath();
        if (e.type === "IC") { ctx.moveTo(x, bot + 1); ctx.lineTo(x - 4, bot + 8); ctx.lineTo(x + 4, bot + 8); }
        else { ctx.moveTo(x, top - 1); ctx.lineTo(x - 4, top - 8); ctx.lineTo(x + 4, top - 8); }
        ctx.fill();
        ctx.fillStyle = "#8a8a93";
        ctx.fillText(`${e.e >= 0 ? "+" : ""}${(e.e * 1000).toFixed(0)}`, x + 16, e.type === "IC" ? bot + 9 : top - 2);
      }
    } else {
      ctx.fillStyle = "#55555c"; ctx.font = "11px 'IBM Plex Sans Thai', sans-serif"; ctx.textAlign = "right";
      ctx.fillText("ไม่ใช่โหมดขาเทียม · แสดงเฉพาะค่าจริง", w - pr, (top + bot) / 2 + 4);
    }
  });
  ctx.fillStyle = "#6b6b73"; ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
  for (let t = Math.ceil(t0); t <= now; t++) ctx.fillText(t.toFixed(0) + " s", X(t), h - 5);
}
