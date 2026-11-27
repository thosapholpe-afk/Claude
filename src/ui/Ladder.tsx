import { ArrowDownToLine, ArrowUpToLine, Eraser, Minus, MousePointer2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ADDRESS_GROUPS, type Cell, emptyRung, LADDER_COLS, type LadderProgram, type Out, type OutKind, parseLadder, type Rung, serialiseLadder } from "../core/plc";
import { useStudio } from "../store";

const CW = 76; // cell width
const RH = 58; // row height
const X0 = 16; // first column
const OUT_W = 112;
const WIDTH = X0 + LADDER_COLS * CW + OUT_W + 12;
const colX = (b: number) => X0 + b * CW;
const midY = (r: number) => r * RH + RH / 2 + 4;

type Tool = "select" | "no" | "nc" | "rise" | "fall" | "wire" | "link" | "erase" | OutKind;
const TOOLS: { id: Tool; label: string; glyph: string; hint: string }[] = [
  { id: "select", label: "Select", glyph: "", hint: "Pick an element to edit its address" },
  { id: "no", label: "NO", glyph: "┤ ├", hint: "Normally-open contact (examine if ON)" },
  { id: "nc", label: "NC", glyph: "┤/├", hint: "Normally-closed contact (examine if OFF)" },
  { id: "rise", label: "P", glyph: "┤P├", hint: "Rising-edge contact (one scan)" },
  { id: "fall", label: "N", glyph: "┤N├", hint: "Falling-edge contact (one scan)" },
  { id: "wire", label: "Wire", glyph: "──", hint: "Horizontal wire" },
  { id: "link", label: "Branch", glyph: "┬", hint: "Tap between two rows to join / split a parallel branch" },
  { id: "coil", label: "Coil", glyph: "( )", hint: "Output coil" },
  { id: "set", label: "Set", glyph: "(S)", hint: "Set (latch) coil" },
  { id: "reset", label: "Reset", glyph: "(R)", hint: "Reset (unlatch) coil" },
  { id: "ton", label: "TON", glyph: "TON", hint: "On-delay timer (T)" },
  { id: "tof", label: "TOF", glyph: "TOF", hint: "Off-delay timer (T)" },
  { id: "ctu", label: "CTU", glyph: "CTU", hint: "Up counter (C)" },
  { id: "rst", label: "RST", glyph: "RST", hint: "Reset a timer / counter" },
  { id: "erase", label: "Erase", glyph: "", hint: "Remove an element or branch" },
];
const OUT_TOOLS = new Set<Tool>(["coil", "set", "reset", "ton", "tof", "ctu", "rst"]);

/** Fill the gap between a row's last element and its output with wire. */
function autowire(r: Rung) {
  r.cells.forEach((row, ri) => {
    if (!r.outs[ri]) return;
    let last = -1;
    row.forEach((c, ci) => c && (last = ci));
    for (let c = last + 1; c < LADDER_COLS; c++) row[c] = { t: "wire" };
  });
}

function defaultAddr(tool: Tool, addr: string) {
  if (tool === "ton" || tool === "tof") return addr.startsWith("T") ? addr : "T0";
  if (tool === "ctu") return addr.startsWith("C") ? addr : "C0";
  if (tool === "rst") return addr.startsWith("T") || addr.startsWith("C") ? addr : "C0";
  if (OUT_TOOLS.has(tool)) return addr.startsWith("Y") || addr.startsWith("M") ? addr : "Y0";
  return addr;
}

export function LadderEditor() {
  const code = useStudio((s) => s.project.code.ladder);
  const setCode = useStudio((s) => s.setCode);
  const plc = useStudio((s) => s.snap?.plc);
  const running = useStudio((s) => s.sim.running);
  const prog = useMemo(() => parseLadder(code), [code]);
  const [tool, setTool] = useState<Tool>("select");
  const [addr, setAddr] = useState("X0");
  const [pre, setPre] = useState(3);
  const [sel, setSel] = useState<{ rung: string; row: number; col: number | "out" } | null>(null);

  const save = (fn: (p: LadderProgram) => void) => {
    const next = structuredClone(prog);
    fn(next);
    next.rungs.forEach(autowire);
    setCode("ladder", serialiseLadder(next));
  };

  const selected = sel ? prog.rungs.find((r) => r.id === sel.rung) : undefined;
  const selEl = selected && sel ? (sel.col === "out" ? selected.outs[sel.row] : selected.cells[sel.row]?.[sel.col]) : undefined;
  const selAddr = selEl && "a" in selEl ? selEl.a : undefined;

  const clickCell = (r: Rung, row: number, col: number) => {
    if (tool === "select") {
      setSel({ rung: r.id, row, col });
      const c = r.cells[row][col];
      if (c && "a" in c) setAddr(c.a);
      return;
    }
    if (OUT_TOOLS.has(tool) || tool === "link") return;
    save((p) => {
      const rr = p.rungs.find((x) => x.id === r.id)!;
      const cell: Cell = tool === "erase" ? null : tool === "wire" ? { t: "wire" } : { t: tool as "no", a: addr };
      rr.cells[row][col] = cell;
    });
    setSel({ rung: r.id, row, col });
  };

  const clickOut = (r: Rung, row: number) => {
    if (tool === "select") {
      setSel({ rung: r.id, row, col: "out" });
      const o = r.outs[row];
      if (o) {
        setAddr(o.a);
        if (o.pre !== undefined) setPre(o.pre);
      }
      return;
    }
    if (!OUT_TOOLS.has(tool) && tool !== "erase") return;
    const a = defaultAddr(tool, addr);
    if (tool !== "erase") setAddr(a);
    save((p) => {
      const rr = p.rungs.find((x) => x.id === r.id)!;
      rr.outs[row] = tool === "erase" ? null : ({ t: tool as OutKind, a, ...(tool === "ton" || tool === "tof" || tool === "ctu" ? { pre } : {}) } as Out);
    });
    setSel({ rung: r.id, row, col: "out" });
  };

  const clickLink = (r: Rung, row: number, b: number) => {
    if (tool !== "link" && tool !== "erase") return;
    save((p) => {
      const rr = p.rungs.find((x) => x.id === r.id)!;
      rr.links[row][b] = tool === "erase" ? false : !rr.links[row][b];
    });
  };

  const editSelected = (patch: { a?: string; pre?: number }) => {
    if (!sel) return;
    save((p) => {
      const rr = p.rungs.find((x) => x.id === sel.rung);
      if (!rr) return;
      if (sel.col === "out") {
        const o = rr.outs[sel.row];
        if (o) rr.outs[sel.row] = { ...o, ...patch };
      } else {
        const c = rr.cells[sel.row][sel.col];
        if (c && "a" in c && patch.a) rr.cells[sel.row][sel.col] = { ...c, a: patch.a };
      }
    });
  };

  const rungOp = (op: "addRung" | "addRow" | "delRow" | "delRung" | "up" | "down") => {
    save((p) => {
      const i = sel ? p.rungs.findIndex((x) => x.id === sel.rung) : p.rungs.length - 1;
      const r = p.rungs[i];
      if (op === "addRung") p.rungs.splice(i + 1, 0, emptyRung());
      if (!r) return;
      if (op === "addRow") {
        r.cells.push(Array<Cell>(LADDER_COLS).fill(null));
        r.outs.push(null);
        r.links.push(Array<boolean>(LADDER_COLS + 1).fill(false));
      }
      if (op === "delRow" && r.cells.length > 1) {
        r.cells.pop();
        r.outs.pop();
        r.links.pop();
      }
      if (op === "delRung") {
        p.rungs.splice(i, 1);
        if (!p.rungs.length) p.rungs.push(emptyRung());
      }
      if (op === "up" && i > 0) [p.rungs[i - 1], p.rungs[i]] = [p.rungs[i], p.rungs[i - 1]];
      if (op === "down" && i < p.rungs.length - 1) [p.rungs[i + 1], p.rungs[i]] = [p.rungs[i], p.rungs[i + 1]];
    });
  };

  const symbol = (a: string) => prog.symbols[a];
  const bit = (a: string) => !!plc?.bits[a];

  return (
    <div className="ladder">
      <div className="ladder-tools" role="toolbar" aria-label="Ladder tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`lt ${tool === t.id ? "on" : ""} ${OUT_TOOLS.has(t.id) ? "out" : ""}`} onClick={() => setTool(t.id)} title={t.hint} aria-pressed={tool === t.id}>
            {t.id === "select" ? <MousePointer2 size={14} /> : t.id === "erase" ? <Eraser size={14} /> : <span className="glyph">{t.glyph}</span>}
            <span className="lbl">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="ladder-bar">
        <label className="addr">
          <span>Address</span>
          <select
            value={selAddr ?? addr}
            onChange={(e) => {
              setAddr(e.target.value);
              if (selAddr) editSelected({ a: e.target.value });
            }}
          >
            {ADDRESS_GROUPS.map((g) => (
              <optgroup key={g.prefix} label={g.label}>
                {Array.from({ length: g.n }, (_, i) => `${g.prefix}${i}`).map((a) => (
                  <option key={a} value={a}>
                    {a}
                    {symbol(a) ? ` · ${symbol(a)}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="sym">
          <span>Name</span>
          <input
            value={symbol(selAddr ?? addr) ?? ""}
            placeholder="e.g. START"
            onChange={(e) => {
              const a = selAddr ?? addr;
              save((p) => {
                if (e.target.value) p.symbols[a] = e.target.value.toUpperCase().slice(0, 14);
                else delete p.symbols[a];
              });
            }}
          />
        </label>
        <label className="pre">
          <span>Preset</span>
          <input
            type="number"
            step={0.1}
            min={0}
            value={selEl && "pre" in selEl && selEl.pre !== undefined ? selEl.pre : pre}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPre(v);
              if (selEl && "pre" in selEl) editSelected({ pre: v });
            }}
          />
        </label>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => rungOp("addRung")} title="Add a rung below">
          <Plus size={14} /> Rung
        </button>
        <button className="btn ghost sm" onClick={() => rungOp("addRow")} title="Add a parallel branch row to the selected rung">
          <Plus size={14} /> Row
        </button>
        <button className="btn ghost sm icon" onClick={() => rungOp("delRow")} title="Remove the last row" aria-label="Remove row">
          <Minus size={14} />
        </button>
        <button className="btn ghost sm icon" onClick={() => rungOp("up")} title="Move rung up" aria-label="Move rung up">
          <ArrowUpToLine size={14} />
        </button>
        <button className="btn ghost sm icon" onClick={() => rungOp("down")} title="Move rung down" aria-label="Move rung down">
          <ArrowDownToLine size={14} />
        </button>
        <button className="btn ghost sm icon danger" onClick={() => rungOp("delRung")} title="Delete the selected rung" aria-label="Delete rung">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="ladder-io">
        <span className={`run-badge ${running ? "on" : ""}`}>{running ? `RUN · ${plc?.scans ?? 0} scans` : "STOP"}</span>
        {["X", "Y"].map((g) => (
          <span key={g} className="io-row">
            {Array.from({ length: 8 }, (_, i) => {
              const a = `${g}${i}`;
              return (
                <span key={a} className={`io ${bit(a) ? "on" : ""} ${g === "Y" ? "y" : ""}`} title={symbol(a) ?? a}>
                  {a}
                </span>
              );
            })}
          </span>
        ))}
      </div>
      <div className="rungs">
        {prog.rungs.map((r, ri) => (
          <RungView key={r.id} r={r} index={ri} power={running ? plc?.power[r.id] : undefined} bit={bit} acc={plc?.acc ?? {}} symbol={symbol} sel={sel?.rung === r.id ? sel : null} tool={tool} onCell={clickCell} onOut={clickOut} onLink={clickLink} onComment={(text) => save((p) => (p.rungs[ri].comment = text))} onSelectRung={() => setSel({ rung: r.id, row: 0, col: 0 })} />
        ))}
        <button className="add-rung" onClick={() => rungOp("addRung")}>
          <Plus size={14} /> Add rung
        </button>
      </div>
    </div>
  );
}

function RungView({
  r,
  index,
  power,
  bit,
  acc,
  symbol,
  sel,
  tool,
  onCell,
  onOut,
  onLink,
  onComment,
  onSelectRung,
}: {
  r: Rung;
  index: number;
  power?: { cells: boolean[][]; outs: boolean[]; links: boolean[][] };
  bit: (a: string) => boolean;
  acc: Record<string, number>;
  symbol: (a: string) => string | undefined;
  sel: { row: number; col: number | "out" } | null;
  tool: Tool;
  onCell: (r: Rung, row: number, col: number) => void;
  onOut: (r: Rung, row: number) => void;
  onLink: (r: Rung, row: number, b: number) => void;
  onComment: (t: string) => void;
  onSelectRung: () => void;
}) {
  const rows = r.cells.length;
  const H = rows * RH + 8;
  const live = !!power;
  const outX = colX(LADDER_COLS);
  return (
    <div className={`rung ${sel ? "sel" : ""}`}>
      <div className="rung-head" onClick={onSelectRung}>
        <span className="rung-no">{String(index + 1).padStart(3, "0")}</span>
        <input className="rung-comment" value={r.comment ?? ""} placeholder="Comment…" onChange={(e) => onComment(e.target.value)} />
      </div>
      <div className="rung-scroll">
        <svg width={WIDTH} height={H} viewBox={`0 0 ${WIDTH} ${H}`} className={`rung-svg tool-${tool}`}>
          <line x1={X0} y1={2} x2={X0} y2={H - 2} className={`rail ${live ? "pow" : ""}`} />
          <line x1={WIDTH - 10} y1={2} x2={WIDTH - 10} y2={H - 2} className="rail" />
          {r.cells.map((row, ri) =>
            row.map((cell, ci) => {
              const x = colX(ci);
              const y = midY(ri);
              const on = !!power?.cells[ri]?.[ci];
              const isSel = sel && sel.row === ri && sel.col === ci;
              return (
                <g key={`${ri}-${ci}`} className={`cell ${isSel ? "sel" : ""}`} onClick={() => onCell(r, ri, ci)}>
                  <rect x={x + 1} y={y - RH / 2 + 2} width={CW - 2} height={RH - 4} rx={6} className="hit" />
                  {cell?.t === "wire" && <line x1={x} y1={y} x2={x + CW} y2={y} className={`w ${on ? "pow" : ""}`} />}
                  {cell && cell.t !== "wire" && <Contact x={x} y={y} cell={cell} on={on} closed={live && (cell.t === "nc" ? !bit(cell.a) : bit(cell.a))} sym={symbol(cell.a)} />}
                  {!cell && <circle cx={x + CW / 2} cy={y} r={2} className="dot" />}
                </g>
              );
            }),
          )}
          {r.links.map((row, ri) =>
            row.map((l, b) => (
              <g key={`l${ri}-${b}`} onClick={() => onLink(r, ri, b)} className="link-hit">
                <rect x={colX(b) - 7} y={midY(ri)} width={14} height={RH} className="hit" />
                {l && <line x1={colX(b)} y1={midY(ri)} x2={colX(b)} y2={midY(ri + 1)} className={`w ${power?.links[ri]?.[b] ? "pow" : ""}`} />}
              </g>
            )),
          )}
          {r.outs.map((o, ri) => {
            const y = midY(ri);
            const on = !!power?.outs[ri];
            const isSel = sel && sel.row === ri && sel.col === "out";
            return (
              <g key={`o${ri}`} className={`cell out ${isSel ? "sel" : ""}`} onClick={() => onOut(r, ri)}>
                <rect x={outX + 1} y={y - RH / 2 + 2} width={OUT_W - 2} height={RH - 4} rx={6} className="hit" />
                {o ? <Output x={outX} y={y} o={o} on={on} active={live && bit(o.a)} acc={acc[o.a]} sym={symbol(o.a)} /> : <circle cx={outX + OUT_W / 2} cy={y} r={2} className="dot" />}
                {o && <line x1={outX + OUT_W - 14} y1={y} x2={WIDTH - 10} y2={y} className={`w ${on ? "pow" : ""}`} />}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Contact({ x, y, cell, on, closed, sym }: { x: number; y: number; cell: Exclude<Cell, null | { t: "wire" }>; on: boolean; closed: boolean; sym?: string }) {
  const a = x + CW * 0.36;
  const b = x + CW * 0.64;
  return (
    <g>
      <line x1={x} y1={y} x2={a} y2={y} className={`w ${on ? "pow" : ""}`} />
      <line x1={b} y1={y} x2={x + CW} y2={y} className={`w ${on ? "pow" : ""}`} />
      {closed && <rect x={a} y={y - 9} width={b - a} height={18} className="closed" />}
      <line x1={a} y1={y - 10} x2={a} y2={y + 10} className={`plate ${on ? "pow" : ""}`} />
      <line x1={b} y1={y - 10} x2={b} y2={y + 10} className={`plate ${on ? "pow" : ""}`} />
      {cell.t === "nc" && <line x1={a - 3} y1={y + 10} x2={b + 3} y2={y - 10} className={`plate ${on ? "pow" : ""}`} />}
      {(cell.t === "rise" || cell.t === "fall") && (
        <text x={(a + b) / 2} y={y + 4} className="mid">
          {cell.t === "rise" ? "P" : "N"}
        </text>
      )}
      <text x={x + CW / 2} y={y - 15} className="addr">
        {cell.a}
      </text>
      {sym && (
        <text x={x + CW / 2} y={y + 22} className="sym">
          {sym}
        </text>
      )}
    </g>
  );
}

function Output({ x, y, o, on, active, acc, sym }: { x: number; y: number; o: Exclude<Out, null>; on: boolean; active: boolean; acc?: number; sym?: string }) {
  const cx = x + OUT_W / 2 - 4;
  const box = o.t === "ton" || o.t === "tof" || o.t === "ctu" || o.t === "rst";
  return (
    <g>
      <line x1={x} y1={y} x2={box ? cx - 26 : cx - 11} y2={y} className={`w ${on ? "pow" : ""}`} />
      {box ? (
        <g>
          <rect x={cx - 26} y={y - 14} width={52} height={28} rx={4} className={`fb ${active ? "act" : ""} ${on ? "pow" : ""}`} />
          <text x={cx} y={y - 1} className="fbt">
            {o.t.toUpperCase()}
          </text>
          <text x={cx} y={y + 10} className="fbv">
            {o.t === "rst" ? o.a : o.t === "ctu" ? `${acc ?? 0}/${o.pre ?? 1}` : `${((acc ?? 0) / 1000).toFixed(1)}/${(o.pre ?? 1).toFixed(1)}s`}
          </text>
          <line x1={cx + 26} y1={y} x2={x + OUT_W - 14} y2={y} className={`w ${on ? "pow" : ""}`} />
        </g>
      ) : (
        <g>
          {active && <circle cx={cx} cy={y} r={11} className="coil-on" />}
          <path d={`M ${cx - 6} ${y - 11} A 11 11 0 0 0 ${cx - 6} ${y + 11} M ${cx + 6} ${y - 11} A 11 11 0 0 1 ${cx + 6} ${y + 11}`} className={`plate ${on ? "pow" : ""}`} fill="none" />
          {(o.t === "set" || o.t === "reset") && (
            <text x={cx} y={y + 4} className="mid">
              {o.t === "set" ? "S" : "R"}
            </text>
          )}
          <line x1={cx + 11} y1={y} x2={x + OUT_W - 14} y2={y} className={`w ${on ? "pow" : ""}`} />
        </g>
      )}
      <text x={cx} y={y - 17} className="addr">
        {o.a}
      </text>
      {sym && (
        <text x={cx} y={y + 25} className="sym">
          {sym}
        </text>
      )}
    </g>
  );
}

