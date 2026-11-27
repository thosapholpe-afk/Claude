import { Download, FolderOpen, GitCompareArrows, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { download } from "../lib/persist";
import { csvToSeries, deleteRun, listRuns, recorder, saveRun, seriesToCsv, spectrum, stats, type HistorianRun, type Series } from "../lib/recorder";
import { useStudio } from "../store";

// categorical slots (validated reference palette), dark + light steps
const SERIES_DARK = ["#338ced", "#e76624", "#00a888", "#d28e05", "#e24d8b", "#0aac23", "#9887ef", "#eb6263"];
const SERIES_LIGHT = ["#257de0", "#f47230", "#00b894", "#f2a600", "#ee7fac", "#008a17", "#6a4ce2", "#ec4647"];
const colorSlots = new Map<string, number>();
function slotFor(id: string) {
  if (!colorSlots.has(id)) {
    const used = new Set(colorSlots.values());
    let s = 0;
    while (used.has(s) && s < 7) s++;
    colorSlots.set(id, s);
  }
  return colorSlots.get(id)!;
}

function useRecorder() {
  const [, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let pending = false;
    const off = recorder.subscribe(() => {
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(() => {
        pending = false;
        setV((x) => x + 1);
      });
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  return recorder;
}

const GROUPS: { id: Series["group"]; label: string }[] = [
  { id: "serial", label: "From serial output" },
  { id: "sensor", label: "Sensors & parts" },
  { id: "vibration", label: "Vibration (1 kHz model)" },
  { id: "pin", label: "Pin voltages" },
  { id: "env", label: "Environment" },
];

interface ChartProps {
  series: Series[];
  baseline: Map<string, Series>;
  window: number;
  mode: "time" | "fft";
  theme: "dark" | "light";
  unit: string;
}

function Chart({ series, baseline, window: win, mode, theme, unit }: ChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; rows: { label: string; v: string; color: string }[]; head: string } | null>(null);
  const pal = theme === "dark" ? SERIES_DARK : SERIES_LIGHT;
  const tipKey = useRef("");
  const putTip = (v: typeof tip) => {
    const k = JSON.stringify(v);
    if (k !== tipKey.current) {
      tipKey.current = k;
      setTip(v);
    }
  };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    const css = getComputedStyle(cv);
    const ink2 = css.getPropertyValue("--text-2").trim() || "#999";
    const gridC = css.getPropertyValue("--chart-grid").trim() || "rgba(128,128,128,.15)";
    const padL = 52;
    const padR = 12;
    const padT = 10;
    const padB = 24;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    g.clearRect(0, 0, W, H);
    // data prep
    type Line = { pts: [number, number][]; color: string; dashed: boolean; label: string };
    const lines: Line[] = [];
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    if (mode === "time") {
      const tEnd = Math.max(0, ...series.map((s) => s.t[s.t.length - 1] ?? 0));
      x0 = win > 0 ? Math.max(0, tEnd - win) : 0;
      x1 = Math.max(x0 + 1, tEnd);
      const add = (s: Series, color: string, dashed: boolean, shift = 0) => {
        const pts: [number, number][] = [];
        const step = Math.max(1, Math.floor(s.t.length / (pw * 2)));
        for (let i = 0; i < s.t.length; i += 1) {
          const tt = s.t[i] + shift;
          if (tt < x0 || tt > x1) continue;
          if (step > 1 && i % step) continue;
          pts.push([tt, s.v[i]]);
          if (s.v[i] < y0) y0 = s.v[i];
          if (s.v[i] > y1) y1 = s.v[i];
        }
        lines.push({ pts, color, dashed, label: s.label });
      };
      for (const s of series) {
        const c = pal[slotFor(s.id)];
        const b = baseline.get(s.label);
        if (b) add(b, c, true, 0);
        add(s, c, false);
      }
    } else {
      x0 = 0;
      for (const s of series) {
        const c = pal[slotFor(s.id)];
        const sp = spectrum(s.t, s.v, 2);
        const b = baseline.get(s.label);
        if (b) {
          const bs = spectrum(b.t, b.v, 2);
          lines.push({ pts: bs.f.map((f, i) => [f, bs.a[i]] as [number, number]), color: c, dashed: true, label: `${s.label} (baseline)` });
        }
        lines.push({ pts: sp.f.map((f, i) => [f, sp.a[i]] as [number, number]), color: c, dashed: false, label: s.label });
        x1 = Math.max(x1, sp.fs / 2 || 1);
      }
      x1 = Math.min(x1 === -Infinity ? 100 : x1, 500);
      for (const l of lines)
        for (const [x, y] of l.pts)
          if (x <= x1) {
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
      y0 = 0;
    }
    if (!Number.isFinite(y0)) {
      y0 = 0;
      y1 = 1;
    }
    if (y1 - y0 < 1e-9) {
      y0 -= 0.5;
      y1 += 0.5;
    }
    const padY = (y1 - y0) * 0.08;
    y0 -= mode === "fft" ? 0 : padY;
    y1 += padY;
    const X = (x: number) => padL + ((x - x0) / (x1 - x0)) * pw;
    const Y = (y: number) => padT + ph - ((y - y0) / (y1 - y0)) * ph;
    // grid + axes (recessive)
    g.font = "11px IBM Plex Mono, monospace";
    g.fillStyle = ink2;
    g.strokeStyle = gridC;
    g.lineWidth = 1;
    const ticks = (a: number, b: number, n: number) => {
      const raw = (b - a) / n;
      const mag = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
      const out: number[] = [];
      for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(v);
      return out;
    };
    for (const v of ticks(y0, y1, 4)) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(W - padR, y);
      g.stroke();
      g.textAlign = "right";
      g.fillText(Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2), padL - 6, y + 4);
    }
    g.textAlign = "center";
    for (const v of ticks(x0, x1, Math.max(3, Math.floor(pw / 90)))) g.fillText(mode === "fft" ? `${v.toFixed(0)} Hz` : `${v.toFixed(v < 10 ? 1 : 0)} s`, X(v), H - 6);
    g.textAlign = "left";
    g.fillText(mode === "fft" ? `amplitude${unit ? ` (${unit})` : ""}` : unit || "value", padL + 4, padT + 10);
    // lines (2px, round)
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      g.strokeStyle = l.color;
      g.lineWidth = l.dashed ? 1.5 : 2;
      g.globalAlpha = l.dashed ? 0.7 : 1;
      g.setLineDash(l.dashed ? [5, 4] : []);
      g.lineJoin = "round";
      g.lineCap = "round";
      g.beginPath();
      l.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    // crosshair
    if (hover && hover.x >= padL && hover.x <= W - padR) {
      const xv = x0 + ((hover.x - padL) / pw) * (x1 - x0);
      g.strokeStyle = ink2;
      g.globalAlpha = 0.5;
      g.beginPath();
      g.moveTo(hover.x + 0.5, padT);
      g.lineTo(hover.x + 0.5, padT + ph);
      g.stroke();
      g.globalAlpha = 1;
      const rows: { label: string; v: string; color: string }[] = [];
      for (const l of lines) {
        if (!l.pts.length) continue;
        let best = l.pts[0];
        for (const p of l.pts) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
        g.fillStyle = l.color;
        g.beginPath();
        g.arc(X(best[0]), Y(best[1]), 4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = css.getPropertyValue("--panel").trim() || "#000";
        g.lineWidth = 2;
        g.stroke();
        rows.push({ label: l.dashed ? `${l.label} · baseline` : l.label, v: best[1].toFixed(3), color: l.color });
      }
      putTip({ x: hover.x, y: hover.y, rows, head: mode === "fft" ? `${xv.toFixed(1)} Hz` : `t = ${xv.toFixed(3)} s` });
    } else putTip(null);
  });

  return (
    <div className="chart">
      <canvas
        ref={ref}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${mode === "fft" ? "Spectrum" : "Time series"} of ${series.map((s) => s.label).join(", ")}`}
      />
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x + 14, 9999), top: tip.y + 10 }}>
          <strong>{tip.head}</strong>
          {tip.rows.map((r, i) => (
            <span key={i}>
              <i style={{ background: r.color }} />
              {r.label} <b>{r.v}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Plotter() {
  const rec = useRecorder();
  const theme = useStudio((s) => s.theme);
  const project = useStudio((s) => s.project);
  const toast = useStudio((s) => s.toast);
  const [sel, setSel] = useState<string[]>([]);
  const [win, setWin] = useState(10);
  const [mode, setMode] = useState<"time" | "fft">("time");
  const [runs, setRuns] = useState<HistorianRun[]>([]);
  const [baseline, setBaseline] = useState<HistorianRun | null>(null);
  const [table, setTable] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const all = [...rec.series.values()];
  const pal = theme === "dark" ? SERIES_DARK : SERIES_LIGHT;

  useEffect(() => {
    void listRuns().then(setRuns);
  }, []);
  // auto-select serial series first, then sensors
  useEffect(() => {
    if (sel.length || !all.length) return;
    const pick = [...all.filter((s) => s.group === "serial"), ...all.filter((s) => s.group === "vibration"), ...all.filter((s) => s.group === "sensor" && !s.id.startsWith("out:"))].slice(0, 3).map((s) => s.id);
    if (pick.length) setSel(pick);
  }, [all.length, sel.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = sel.map((id) => rec.series.get(id)).filter((s): s is Series => !!s);
  const byUnit = useMemo(() => {
    const m = new Map<string, Series[]>();
    for (const s of chosen) {
      const k = s.unit || s.group;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [chosen.map((c) => c.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseMap = useMemo(() => new Map((baseline?.series ?? []).map((s) => [s.label, s])), [baseline]);

  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 8 ? x : [...x, id]));

  const save = async () => {
    const series = chosen.length ? chosen : all;
    if (!series.length) {
      toast("Run the simulation first — there is nothing recorded yet", "warn");
      return;
    }
    const name = prompt("Name this run for the historian", `${project.name} · ${new Date().toLocaleString()}`);
    if (!name) return;
    await saveRun({ id: `run-${Date.now()}`, name, createdAt: Date.now(), boardId: project.boardId, scenario: project.scenario.id, series: series.map((s) => ({ ...s, t: [...s.t], v: [...s.v] })) });
    setRuns(await listRuns());
    toast("Saved to the historian", "ok");
  };

  return (
    <div className="plotter">
      <aside className="sig-list">
        {!all.length && <p className="muted small">Start the simulation. Readings from sensors, pins, the environment and serial lines like <code>temp:24.5,hum:60</code> are recorded automatically.</p>}
        {GROUPS.map((g) => {
          const items = all.filter((s) => s.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id}>
              <h4>{g.label}</h4>
              {items.map((s) => (
                <label key={s.id} className="sig">
                  <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} />
                  <i style={{ background: sel.includes(s.id) ? pal[slotFor(s.id)] : "transparent" }} />
                  <span>{s.label}</span>
                  <em>{s.unit}</em>
                </label>
              ))}
            </div>
          );
        })}
      </aside>
      <div className="plot-main">
        <div className="pane-bar">
          <div className="seg">
            <button className={mode === "time" ? "on" : ""} onClick={() => setMode("time")}>
              Time
            </button>
            <button className={mode === "fft" ? "on" : ""} onClick={() => setMode("fft")}>
              Spectrum (FFT)
            </button>
          </div>
          {mode === "time" && (
            <div className="seg">
              {[5, 10, 30, 0].map((w) => (
                <button key={w} className={win === w ? "on" : ""} onClick={() => setWin(w)}>
                  {w ? `${w}s` : "All"}
                </button>
              ))}
            </div>
          )}
          <span className="spacer" />
          <button className="btn sm" onClick={() => setTable((x) => !x)}>
            {table ? "Charts" : "Table"}
          </button>
          <button className="btn sm" onClick={save}>
            <Save size={14} /> Save run
          </button>
          <button className="btn sm" onClick={() => download(`${project.name.replace(/\W+/g, "_")}.csv`, seriesToCsv(chosen.length ? chosen : all), "text/csv")}>
            <Download size={14} /> CSV
          </button>
        </div>
        {!chosen.length ? (
          <p className="muted empty">Pick up to eight signals on the left. Signals with different units get their own chart so every axis means one thing.</p>
        ) : table ? (
          <div className="stat-table">
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Latest</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Mean</th>
                  <th>RMS (AC)</th>
                  <th>Crest</th>
                  {baseline && <th>Δ RMS vs baseline</th>}
                </tr>
              </thead>
              <tbody>
                {chosen.map((s) => {
                  const lastN = s.v.slice(-2000);
                  const st = stats(lastN);
                  const b = baseMap.get(s.label);
                  const bs = b ? stats(b.v.slice(-2000)) : null;
                  return (
                    <tr key={s.id}>
                      <td>
                        <i style={{ background: pal[slotFor(s.id)] }} /> {s.label} <em>{s.unit}</em>
                      </td>
                      <td>{(s.v[s.v.length - 1] ?? 0).toFixed(3)}</td>
                      <td>{st.min.toFixed(3)}</td>
                      <td>{st.max.toFixed(3)}</td>
                      <td>{st.mean.toFixed(3)}</td>
                      <td>{st.rms.toFixed(4)}</td>
                      <td>{st.crest.toFixed(2)}</td>
                      {baseline && <td className={bs && st.rms > bs.rms * 1.25 ? "bad" : "ok"}>{bs ? `${(((st.rms - bs.rms) / (bs.rms || 1e-9)) * 100).toFixed(0)}%` : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="charts">
            {byUnit.map(([unit, ss]) => (
              <div key={unit} className="chart-block">
                <div className="legend">
                  {ss.map((s) => {
                    const st = stats(s.v.slice(-1000));
                    return (
                      <span key={s.id}>
                        <i style={{ background: pal[slotFor(s.id)] }} />
                        {s.label}
                        <em>
                          {(s.v[s.v.length - 1] ?? 0).toFixed(2)} {s.unit} · rms {st.rms.toFixed(3)}
                        </em>
                      </span>
                    );
                  })}
                  {baseline && <span className="muted small">dashed = {baseline.name}</span>}
                </div>
                <Chart series={ss} baseline={baseMap} window={win} mode={mode} theme={theme} unit={unit} />
              </div>
            ))}
          </div>
        )}
      </div>
      <aside className="historian">
        <h4>
          <GitCompareArrows size={14} /> Historian
        </h4>
        <p className="muted small">Saved runs live in this browser. Pick one to overlay it as a dashed baseline.</p>
        <button className="btn sm wide" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Import CSV baseline
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const series = csvToSeries(await f.text());
            const run: HistorianRun = { id: `csv-${Date.now()}`, name: f.name, createdAt: Date.now(), boardId: project.boardId, scenario: "imported", series };
            await saveRun(run);
            setRuns(await listRuns());
            setBaseline(run);
            e.target.value = "";
          }}
        />
        <ul className="runs">
          {baseline && (
            <li className="on">
              <button className="link" onClick={() => setBaseline(null)}>
                Clear baseline
              </button>
            </li>
          )}
          {runs.map((r) => (
            <li key={r.id} className={baseline?.id === r.id ? "on" : ""}>
              <button className="link" onClick={() => setBaseline(baseline?.id === r.id ? null : r)} title="Use as baseline">
                <FolderOpen size={13} /> {r.name}
              </button>
              <small>
                {new Date(r.createdAt).toLocaleDateString()} · {r.series.length} signals
              </small>
              <button
                className="btn icon sm"
                aria-label="Delete run"
                onClick={async () => {
                  await deleteRun(r.id);
                  if (baseline?.id === r.id) setBaseline(null);
                  setRuns(await listRuns());
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
