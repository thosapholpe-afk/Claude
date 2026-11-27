/**
 * Wiring-diagram rendering: every board and part as a clean block with its pin
 * names, plus IEC-style symbols for the common electrical parts.
 */
import { memo } from "react";
import type { PartDef, PartLive } from "../../core/parts";
import type { BoardDef, PartInstance } from "../../core/types";

const STROKE = "var(--dg-stroke)";

function Sym({ type, live, w, h }: { type: string; live?: PartLive; w: number; h: number }) {
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h);
  const k = Math.max(3, Math.min(9, s * 0.28));
  const on = !!live?.on;
  const common = { stroke: STROKE, strokeWidth: 0.45, fill: "none", strokeLinecap: "round" as const };
  switch (type) {
    case "resistor":
      return <path {...common} d={`M ${cx - k} ${cy} l ${k * 0.2} 0 l ${k * 0.15} -${k * 0.35} l ${k * 0.3} ${k * 0.7} l ${k * 0.3} -${k * 0.7} l ${k * 0.3} ${k * 0.7} l ${k * 0.3} -${k * 0.7} l ${k * 0.15} ${k * 0.35} l ${k * 0.25} 0`} />;
    case "led":
    case "rgb-led":
      return (
        <g {...common} fill={live?.brightness ? "var(--accent)" : "none"}>
          <path d={`M ${cx - k * 0.4} ${cy - k * 0.5} L ${cx - k * 0.4} ${cy + k * 0.5} L ${cx + k * 0.4} ${cy} Z M ${cx + k * 0.4} ${cy - k * 0.5} L ${cx + k * 0.4} ${cy + k * 0.5}`} />
          <path d={`M ${cx + k * 0.1} ${cy - k * 0.7} l ${k * 0.35} -${k * 0.35} M ${cx + k * 0.35} ${cy - k * 0.6} l ${k * 0.35} -${k * 0.35}`} fill="none" />
        </g>
      );
    case "pb-no":
    case "pb-nc":
    case "limit-switch":
    case "selector2":
    case "selector3":
    case "estop":
    case "button":
    case "touch": {
      const nc = type === "pb-nc" || type === "estop";
      const closed = nc ? !on : on;
      return (
        <g {...common} stroke={closed ? "var(--dg-live)" : STROKE}>
          <path d={`M ${cx - k} ${cy} h ${k * 0.5} M ${cx + k * 0.5} ${cy} h ${k * 0.5}`} />
          <path d={closed ? `M ${cx - k * 0.5} ${cy} L ${cx + k * 0.5} ${cy}` : `M ${cx - k * 0.5} ${cy} L ${cx + k * 0.45} ${cy - k * 0.45}`} />
          {nc && <path d={`M ${cx + k * 0.5} ${cy} v -${k * 0.55}`} />}
          {type !== "selector2" && type !== "selector3" && <path d={`M ${cx} ${cy - k * 0.25} v -${k * 0.6} m -${k * 0.25} 0 h ${k * 0.5}`} strokeDasharray={type === "limit-switch" ? undefined : "0.6 0.6"} />}
        </g>
      );
    }
    case "contactor":
    case "relay":
    case "timer-relay":
      return (
        <g {...common} stroke={on ? "var(--dg-live)" : STROKE}>
          <rect x={cx - k * 0.6} y={cy - k * 0.35} width={k * 1.2} height={k * 0.7} />
          {type === "timer-relay" && <path d={`M ${cx - k * 0.6} ${cy - k * 0.35} l ${k * 1.2} ${k * 0.7}`} />}
        </g>
      );
    case "pilot-lamp":
    case "buzzer":
      return (
        <g {...common} stroke={on ? "var(--dg-live)" : STROKE} fill={on ? "rgba(255,210,80,.25)" : "none"}>
          <circle cx={cx} cy={cy} r={k * 0.55} />
          {type === "pilot-lamp" ? <path d={`M ${cx - k * 0.39} ${cy - k * 0.39} l ${k * 0.78} ${k * 0.78} M ${cx + k * 0.39} ${cy - k * 0.39} l -${k * 0.78} ${k * 0.78}`} /> : <path d={`M ${cx - k * 0.3} ${cy} h ${k * 0.6}`} />}
        </g>
      );
    case "motor3":
    case "dc-motor":
      return (
        <g {...common} stroke={on || (live?.speed ?? 0) !== 0 ? "var(--dg-live)" : STROKE}>
          <circle cx={cx} cy={cy} r={k * 0.7} />
          <text x={cx} y={cy + k * 0.18} fontSize={k * 0.5} textAnchor="middle" fill={STROKE} stroke="none" fontFamily="Chakra Petch" fontWeight={700}>
            {type === "motor3" ? "M 3~" : "M"}
          </text>
        </g>
      );
    case "mcb3":
    case "overload":
      return (
        <g {...common}>
          <rect x={cx - k * 0.7} y={cy - k * 0.4} width={k * 1.4} height={k * 0.8} strokeDasharray={type === "overload" ? "0.8 0.6" : undefined} />
          <text x={cx} y={cy + k * 0.15} fontSize={k * 0.38} textAnchor="middle" fill={STROKE} stroke="none" fontFamily="Chakra Petch" fontWeight={700}>
            {type === "mcb3" ? "Q" : "F"}
          </text>
        </g>
      );
    case "psu24":
    case "supply3":
      return (
        <g {...common}>
          <circle cx={cx - k * 0.25} cy={cy} r={k * 0.45} />
          <circle cx={cx + k * 0.25} cy={cy} r={k * 0.45} />
        </g>
      );
    case "multimeter":
      return (
        <g {...common}>
          <circle cx={cx} cy={cy} r={k * 0.6} />
          <text x={cx} y={cy + k * 0.2} fontSize={k * 0.55} textAnchor="middle" fill={STROKE} stroke="none" fontFamily="Chakra Petch" fontWeight={700}>
            {(live?.text?.[1] ?? "V").startsWith("Ω") ? "Ω" : (live?.text?.[1] ?? "V").includes("A") ? "A" : "V"}
          </text>
        </g>
      );
    default:
      return null;
  }
}

/** A part as a labelled block. */
export const DiagramPart = memo(function DiagramPart({ inst, def, fp, live }: { inst: PartInstance; def: PartDef; fp: { w: number; h: number; pins: { id: string; label: string; x: number; y: number }[] }; live?: PartLive }) {
  const w = fp.w;
  const h = fp.h;
  const fs = Math.max(1.1, Math.min(2.4, w / 12));
  if (def.host) return <rect x={0} y={0} width={w} height={h} rx={1} fill="none" stroke="var(--dg-faint)" strokeWidth={0.3} strokeDasharray="1.2 1.2" />;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={1.2} fill="var(--dg-fill)" stroke={STROKE} strokeWidth={0.35} />
      <text x={w / 2} y={fs + 1.2} fontSize={fs} textAnchor="middle" fill="var(--dg-title)" fontFamily="Chakra Petch" fontWeight={700}>
        {inst.label}
      </text>
      {h > 10 && (
        <text x={w / 2} y={fs * 2 + 1.6} fontSize={fs * 0.62} textAnchor="middle" fill="var(--dg-sub)" fontFamily="IBM Plex Sans Thai, sans-serif">
          {def.name.length > 24 ? def.name.slice(0, 23) + "…" : def.name}
        </text>
      )}
      <Sym type={def.type} live={live} w={w} h={h} />
      {live?.reading !== undefined && h > 14 && (
        <text x={w / 2} y={h - 4.2} fontSize={fs * 0.7} textAnchor="middle" fill="var(--dg-live)" fontFamily="IBM Plex Mono, monospace">
          {Number.isFinite(live.reading) ? (Math.abs(live.reading) >= 100 ? Math.round(live.reading) : live.reading.toFixed(2)) : ""} {live.readingUnit}
        </text>
      )}
      {fp.pins.map((p) => {
        const left = p.x < w * 0.25;
        const right = p.x > w * 0.75;
        const top = p.y < h * 0.3;
        return (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={0.55} fill="var(--dg-pin)" />
            <text
              x={left ? p.x + 1.3 : right ? p.x - 1.3 : p.x}
              y={left || right ? p.y + 0.4 : top ? p.y + 2.1 : p.y - 1.3}
              fontSize={Math.min(1.15, fs * 0.7)}
              textAnchor={left ? "start" : right ? "end" : "middle"}
              fill="var(--dg-pinlabel)"
              fontFamily="IBM Plex Mono, monospace"
            >
              {p.label.split(" ")[0]}
            </text>
          </g>
        );
      })}
    </g>
  );
});

/** The board / PLC as a block with every pin named. */
export const DiagramBoard = memo(function DiagramBoard({ board, pinV, running }: { board: BoardDef; pinV?: Record<string, number>; running: boolean }) {
  const W = board.width;
  const H = board.height;
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} rx={2} fill="var(--dg-board)" stroke={STROKE} strokeWidth={0.5} />
      <text x={W / 2} y={H / 2} fontSize={Math.min(5, W / 14)} textAnchor="middle" fill="var(--dg-title)" fontFamily="Chakra Petch" fontWeight={700}>
        {board.short}
      </text>
      <text x={W / 2} y={H / 2 + Math.min(5, W / 14)} fontSize={Math.min(2.2, W / 30)} textAnchor="middle" fill="var(--dg-sub)" fontFamily="IBM Plex Sans Thai, sans-serif">
        {board.name}
      </text>
      {board.pins.map((p) => {
        const top = p.y < H / 2;
        const v = pinV?.[p.id];
        const hot = running && v !== undefined && Math.abs(v) > board.logicV / 2;
        return (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={0.7} fill={hot ? "var(--dg-live)" : p.kind === "gnd" ? "#8a8f96" : p.kind === "power" ? "#e0675c" : "var(--dg-pin)"} />
            <text x={p.x} y={top ? p.y + 2.6 : p.y - 1.6} fontSize={1.2} textAnchor="middle" fill="var(--dg-pinlabel)" fontFamily="IBM Plex Mono, monospace">
              {p.label.replace("~", "")}
            </text>
          </g>
        );
      })}
    </g>
  );
});
