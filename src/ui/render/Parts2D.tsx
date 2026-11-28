import { memo, type ReactNode } from "react";
import { LED_HEX, type PartDef, type PartLive } from "../../core/parts";
import { BB_ROWS, layoutBreadboard, layoutPerfboard } from "../../core/parts";
import type { PartInstance } from "../../core/types";

const BAND = ["#111", "#7b4a24", "#d6281f", "#f07b12", "#f4d21b", "#2f9e44", "#1f5fd1", "#7f3fbf", "#8a8a8a", "#f2f2f2"];

function resistorBands(ohms: number) {
  if (!Number.isFinite(ohms) || ohms <= 0) return [BAND[0], BAND[0], BAND[0]];
  const exp = Math.floor(Math.log10(ohms)) - 1;
  const digits = Math.round(ohms / 10 ** exp);
  const d1 = Math.floor(digits / 10) % 10;
  const d2 = digits % 10;
  return [BAND[d1], BAND[d2], BAND[Math.max(0, Math.min(9, exp))]];
}

function Legs({ pins, top }: { pins: { x: number; y: number }[]; top: number }) {
  return (
    <g stroke="#b9c0c7" strokeWidth={0.45} strokeLinecap="round">
      {pins.map((p, i) => (
        <line key={i} x1={p.x} y1={top} x2={p.x} y2={p.y} />
      ))}
    </g>
  );
}

function HeaderPins({ def }: { def: PartDef }) {
  return (
    <g>
      {def.pins.map((p) => (
        <g key={p.id}>
          <rect x={p.x - 1.1} y={p.y - 1.1} width={2.2} height={2.2} fill="#141518" rx={0.2} />
          <rect x={p.x - 0.4} y={p.y - 0.4} width={0.8} height={0.8} fill="url(#tc-gold)" />
        </g>
      ))}
    </g>
  );
}

function PinLabels({ def, side, color = "#f1f5f2" }: { def: PartDef; side: "top" | "left" | "right"; color?: string }) {
  return (
    <g fontSize={1.15} fill={color} fontFamily="Chakra Petch, sans-serif" fontWeight={600} opacity={0.9}>
      {def.pins.map((p) =>
        side === "top" ? (
          <text key={p.id} x={p.x} y={p.y - 1.9} textAnchor="middle">
            {p.label.split(" ")[0]}
          </text>
        ) : (
          <text key={p.id} x={side === "left" ? p.x - 1.9 : p.x + 1.9} y={p.y + 0.4} textAnchor={side === "left" ? "end" : "start"}>
            {p.label.split(" ")[0]}
          </text>
        ),
      )}
    </g>
  );
}

function Pcb({ w, h, color, rx = 1 }: { w: number; h: number; color: string; rx?: number }) {
  return (
    <g>
      <rect x={0.4} y={0.8} width={w} height={h} rx={rx} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
      <rect width={w} height={h} rx={rx} fill={color} stroke="rgba(255,255,255,.18)" strokeWidth={0.25} />
    </g>
  );
}

function IndicatorLed({ x, y, on, color = "#ff3b30" }: { x: number; y: number; on: boolean; color?: string }) {
  return (
    <g>
      {on && <circle cx={x} cy={y} r={2.6} fill={color} opacity={0.55} filter="url(#tc-glow)" />}
      <rect x={x - 0.75} y={y - 0.45} width={1.5} height={0.9} rx={0.2} fill={on ? color : "#4d3b35"} />
    </g>
  );
}

function TrimPot({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 2.4} y={y - 2.4} width={4.8} height={4.8} rx={0.4} fill="#1f5fd1" />
      <circle cx={x} cy={y} r={1.6} fill="#e8ecef" />
      <line x1={x - 1} y1={y} x2={x + 1} y2={y} stroke="#555" strokeWidth={0.4} />
    </g>
  );
}

/** Screw terminals with their IEC numbers. */
function Terminals({ def }: { def: PartDef }) {
  return (
    <g>
      {def.pins.map((p) => (
        <g key={p.id}>
          <circle cx={p.x} cy={p.y} r={1.25} fill="url(#tc-metal)" stroke="#5b636b" strokeWidth={0.2} />
          <line x1={p.x - 0.8} y1={p.y} x2={p.x + 0.8} y2={p.y} stroke="#4b5157" strokeWidth={0.3} />
          <text x={p.x} y={p.y < def.h / 2 ? p.y + 2.8 : p.y - 1.8} fontSize={1.15} textAnchor="middle" fill={def.category === "control" && !["supply3", "motor3"].includes(def.type) ? "#3a3d42" : "#e9ecef"} fontFamily="Chakra Petch" fontWeight={600}>
            {p.label.split(" ")[0]}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Push-in air fittings (blue collet) for air ports, screw terminals for the rest. */
function Ports({ def, dark }: { def: PartDef; dark?: boolean }) {
  return (
    <g>
      {def.pins.map((p) => {
        const top = p.y < def.h / 2;
        const lbl = p.label.split(" ")[0];
        return p.role === "air" ? (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={1.7} fill="#c9a24a" stroke="#7d6427" strokeWidth={0.2} />
            <circle cx={p.x} cy={p.y} r={1.15} fill="#2f7fc0" />
            <circle cx={p.x} cy={p.y} r={0.55} fill="#0d2a40" />
            <text x={p.x + 2.3} y={p.y + (top ? 0.9 : 0.5)} fontSize={1.5} fill={dark ? "#e9ecef" : "var(--text-2)"} fontFamily="Chakra Petch" fontWeight={700}>
              {lbl}
            </text>
          </g>
        ) : (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={1.2} fill="url(#tc-metal)" stroke="#5b636b" strokeWidth={0.2} />
            <line x1={p.x - 0.75} y1={p.y} x2={p.x + 0.75} y2={p.y} stroke="#4b5157" strokeWidth={0.3} />
            <text x={p.x + (top ? 0 : 0)} y={top ? p.y - 1.7 : p.y + 2.6} fontSize={1.1} textAnchor="middle" fill={dark ? "#e9ecef" : "var(--text-2)"} fontFamily="Chakra Petch" fontWeight={600}>
              {lbl}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function shadeHex(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export const Part2D = memo(function Part2D({ inst, def, live, t }: { inst: PartInstance; def: PartDef; live?: PartLive; t: number }): ReactNode {
  const L = live ?? {};
  switch (def.type) {
    case "led": {
      const color = LED_HEX[String(inst.props.color)] ?? "#ff2a2a";
      const b = L.brightness ?? 0;
      return (
        <g>
          <Legs pins={def.pins} top={7} />
          {b > 0.02 && (
            <>
              <circle cx={2.54} cy={3.3} r={8 + b * 5} fill={color} opacity={Math.min(0.55, b * 0.45)} filter="url(#tc-glow-lg)" />
              <circle cx={2.54} cy={3.3} r={4.2} fill={color} opacity={Math.min(0.9, b * 0.8)} filter="url(#tc-glow)" />
            </>
          )}
          <rect x={0.04} y={6.4} width={5} height={1.1} rx={0.3} fill={L.burnt ? "#3a2a20" : color} opacity={0.85} />
          <path d="M0.3 6.6 V3.2 A2.24 2.24 0 0 1 4.78 3.2 V6.6 Z" fill={L.burnt ? "#3b2b22" : color} opacity={L.burnt ? 1 : 0.55 + Math.min(0.45, b * 0.45)} />
          <path d="M0.3 6.6 V3.2 A2.24 2.24 0 0 1 4.78 3.2 V6.6 Z" fill="url(#tc-dome)" />
          {b > 0.05 && <circle cx={2.54} cy={3.6} r={1 + b * 0.6} fill="#fff" opacity={Math.min(0.95, b * 0.8)} />}
          {L.burnt && <Smoke x={2.54} y={1} t={t} />}
          <text x={4.4} y={10.2} fontSize={1.3} fill="#9fb0a7" fontFamily="Chakra Petch">
            +
          </text>
        </g>
      );
    }
    case "rgb-led": {
      const [r, g, bl] = L.rgb ?? [0, 0, 0];
      const c = `rgb(${Math.round(Math.min(1, r) * 255)},${Math.round(Math.min(1, g) * 255)},${Math.round(Math.min(1, bl) * 255)})`;
      const b = L.brightness ?? 0;
      return (
        <g>
          <Legs pins={def.pins} top={7.5} />
          {b > 0.02 && <circle cx={5.08} cy={3.6} r={9} fill={c} opacity={Math.min(0.6, b * 0.5)} filter="url(#tc-glow-lg)" />}
          <path d="M2.3 7.2 V3.7 A2.78 2.78 0 0 1 7.86 3.7 V7.2 Z" fill={b > 0.02 ? c : "#eef0f2"} opacity={0.9} />
          <path d="M2.3 7.2 V3.7 A2.78 2.78 0 0 1 7.86 3.7 V7.2 Z" fill="url(#tc-dome)" />
          <g fontSize={1.1} fill="#9fb0a7" fontFamily="Chakra Petch" textAnchor="middle">
            {def.pins.map((p) => (
              <text key={p.id} x={p.x} y={p.y + 2.4}>
                {p.id}
              </text>
            ))}
          </g>
        </g>
      );
    }
    case "resistor": {
      const bands = resistorBands(Number(inst.props.ohms));
      return (
        <g>
          <line x1={1.27} y1={1.27} x2={8.89} y2={1.27} stroke="#b9c0c7" strokeWidth={0.45} />
          <rect x={2.6} y={0.15} width={4.96} height={2.24} rx={1.05} fill="#d8c08f" stroke="#b59b6a" strokeWidth={0.15} />
          {bands.map((c, i) => (
            <rect key={i} x={3.35 + i * 0.95} y={0.18} width={0.55} height={2.18} fill={c} />
          ))}
          <rect x={6.6} y={0.18} width={0.55} height={2.18} fill="#c7a046" />
        </g>
      );
    }
    case "button": {
      const pressed = !!L.on;
      const cap = { red: "#e5322d", blue: "#2f6fe0", green: "#2fae4f", yellow: "#f0c419", black: "#222" }[String(inst.props.cap)] ?? "#e5322d";
      return (
        <g>
          <rect x={0.3} y={0.3} width={7} height={7} rx={0.8} fill="#1d1f22" stroke="#000" strokeWidth={0.2} />
          <rect x={0.9} y={0.9} width={5.8} height={5.8} rx={0.5} fill="url(#tc-metal)" opacity={0.6} />
          <circle cx={3.81} cy={3.81} r={pressed ? 2.1 : 2.4} fill={cap} stroke="rgba(0,0,0,.4)" strokeWidth={0.25} />
          {!pressed && <circle cx={3.2} cy={3.1} r={0.8} fill="#fff" opacity={0.3} />}
        </g>
      );
    }
    case "pot": {
      const pos = Number(inst.props.position ?? 0.5);
      const ang = -135 + pos * 270;
      return (
        <g>
          <Legs pins={def.pins} top={8} />
          <rect x={0.3} y={1} width={9.6} height={7.4} rx={1} fill="#1f5fd1" stroke="#16469e" strokeWidth={0.2} />
          <circle cx={5.08} cy={4.7} r={3.6} fill="#d9dde1" stroke="#9aa1a8" strokeWidth={0.2} />
          <g transform={`rotate(${ang} 5.08 4.7)`}>
            <rect x={4.68} y={1.4} width={0.8} height={3.1} rx={0.3} fill="#333" />
          </g>
        </g>
      );
    }
    case "ldr":
      return (
        <g>
          <Legs pins={def.pins} top={5} />
          <circle cx={2.54} cy={2.9} r={2.6} fill="#d9692b" stroke="#a94c1b" strokeWidth={0.2} />
          <path d="M1 2.2 h3 M1 3.2 h3 M1.4 1.4 v3.4 M3.7 1.4 v3.4" stroke="#f1c27d" strokeWidth={0.3} fill="none" />
        </g>
      );
    case "lm35":
      return (
        <g>
          <Legs pins={def.pins} top={4.5} />
          <path d="M0.4 4.6 V1.6 A3.41 3.41 0 0 1 7.22 1.6 V4.6 Z" fill="#1c1d20" />
          <text x={3.81} y={3.6} fontSize={1.1} fill="#9aa1a8" textAnchor="middle" fontFamily="IBM Plex Mono">
            LM35
          </text>
        </g>
      );
    case "buzzer": {
      const on = !!L.on;
      return (
        <g>
          <circle cx={6.35} cy={6.35} r={6.2} fill="#141518" stroke="#000" strokeWidth={0.3} />
          <circle cx={6.35} cy={6.35} r={4.6} fill="#1c1e21" />
          <circle cx={6.35} cy={6.35} r={1} fill="#000" />
          <text x={3.4} y={3.6} fontSize={1.6} fill="#e5e5e5" fontFamily="Chakra Petch">
            +
          </text>
          {on && (
            <g fill="none" stroke="var(--accent)" strokeWidth={0.45} opacity={0.9}>
              {[0, 1, 2].map((i) => {
                const k = ((t * 2.5 + i / 3) % 1) * 7;
                return <circle key={i} cx={6.35} cy={6.35} r={6.5 + k} opacity={1 - k / 7} />;
              })}
            </g>
          )}
        </g>
      );
    }
    case "servo-sg90":
    case "servo-mg996r": {
      const big = def.type === "servo-mg996r";
      const bx = big ? 12 : 13;
      const bw = big ? 40.7 : 23;
      const bh = big ? 19.7 : 12.2;
      const by = (def.h - bh) / 2;
      const hubX = bx + (big ? 10 : 6);
      const hubY = def.h / 2;
      const angle = L.angle ?? 90;
      const body = big ? "#1b1c1f" : "#2a6fd6";
      return (
        <g>
          {/* cable */}
          {[
            ["#6b3f1e", def.pins[0].y],
            ["#d8302a", def.pins[1].y],
            ["#f39a1d", def.pins[2].y],
          ].map(([c, y], i) => (
            <path key={i} d={`M1.27 ${y} C ${bx * 0.5} ${y}, ${bx * 0.6} ${hubY - 1 + i}, ${bx} ${hubY - 1 + i}`} stroke={String(c)} strokeWidth={0.8} fill="none" />
          ))}
          <HeaderPins def={def} />
          <rect x={bx - (big ? 6 : 4.6)} y={hubY - 1.2} width={bw + (big ? 12 : 9.2)} height={2.4} rx={0.6} fill={body} opacity={0.95} />
          <rect x={bx} y={by} width={bw} height={bh} rx={1.2} fill={body} stroke="rgba(255,255,255,.2)" strokeWidth={0.25} />
          <rect x={bx + 1} y={by + 1} width={bw - 2} height={bh * 0.35} rx={0.8} fill="#fff" opacity={0.08} />
          <text x={bx + bw - 1.5} y={by + bh - 1.4} fontSize={big ? 2.2 : 1.6} textAnchor="end" fill="#e7eef7" fontFamily="Chakra Petch" fontWeight={700} opacity={0.85}>
            {big ? "MG996R" : "SG90"}
          </text>
          <circle cx={hubX} cy={hubY} r={big ? 4.5 : 3} fill={big ? "#2b2d31" : "#1d5bb7"} />
          <g transform={`rotate(${angle - 90} ${hubX} ${hubY})`}>
            <path d={`M ${hubX - 1.3} ${hubY} L ${hubX - 0.7} ${hubY - (big ? 15 : 11)} Q ${hubX} ${hubY - (big ? 16.4 : 12.2)} ${hubX + 0.7} ${hubY - (big ? 15 : 11)} L ${hubX + 1.3} ${hubY} Z`} fill="#f2f2f0" stroke="#c9c9c4" strokeWidth={0.2} />
            <circle cx={hubX} cy={hubY} r={1.9} fill="#f2f2f0" stroke="#c9c9c4" strokeWidth={0.2} />
            {[0.35, 0.55, 0.75].map((k) => (
              <circle key={k} cx={hubX} cy={hubY - (big ? 15 : 11) * k} r={0.35} fill="#aaa" />
            ))}
          </g>
        </g>
      );
    }
    case "hc-sr04":
      return (
        <g>
          <Pcb w={45} h={20.5} color="#1d5fa8" />
          {[11.2, 33.8].map((cx, i) => (
            <g key={i}>
              <circle cx={cx} cy={9} r={8} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
              <circle cx={cx} cy={9} r={6.2} fill="url(#tc-mesh)" />
              <text x={cx} y={18.6} fontSize={1.4} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch">
                {i ? "R" : "T"}
              </text>
            </g>
          ))}
          <rect x={20.5} y={2} width={4} height={2} rx={0.6} fill="url(#tc-metal)" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "dht22":
      return (
        <g>
          <Legs pins={def.pins} top={20} />
          <rect x={0.1} y={0} width={15.1} height={20} rx={1.2} fill="#f3f3ef" stroke="#c8c8bf" strokeWidth={0.25} />
          <rect x={1.2} y={1.2} width={12.9} height={12.6} fill="url(#tc-vents)" />
          <text x={7.6} y={17.4} fontSize={1.8} textAnchor="middle" fill="#5a5a55" fontFamily="Chakra Petch" fontWeight={700}>
            {String(inst.props.model ?? "DHT22")}
          </text>
        </g>
      );
    case "flame":
      return (
        <g>
          <Pcb w={32} h={14} color="#16181b" />
          <path d="M-3.5 7 a3 3 0 0 1 3 -3 h2 v6 h-2 a3 3 0 0 1 -3 -3z" fill="#0b0b0d" stroke="#2c2c30" strokeWidth={0.3} />
          <line x1={1.5} y1={5.8} x2={5} y2={5.8} stroke="#b9c0c7" strokeWidth={0.4} />
          <line x1={1.5} y1={8.2} x2={5} y2={8.2} stroke="#b9c0c7" strokeWidth={0.4} />
          <TrimPot x={11} y={7} />
          <rect x={17} y={4.4} width={5} height={5.2} rx={0.3} fill="#1b1d20" stroke="#333" strokeWidth={0.2} />
          <IndicatorLed x={25.3} y={3.6} on={!!L.powered} />
          <IndicatorLed x={25.3} y={10.4} on={!!L.indicator} color="#33ff88" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
    case "water": {
      const level = Math.max(0, Math.min(1, ((L.reading ?? 0) as number) / 40));
      return (
        <g>
          <Pcb w={20} h={62} color="#c62828" rx={1.5} />
          <g fill="#d9b25a">
            {Array.from({ length: 10 }, (_, i) => (
              <rect key={i} x={2 + i * 1.65} y={2} width={0.8} height={i % 2 ? 40 : 38} rx={0.2} />
            ))}
          </g>
          <rect x={1.6} y={44} width={16.8} height={1.4} fill="#d9b25a" />
          {level > 0.01 && (
            <g>
              <rect x={0} y={44 - 42 * level} width={20} height={42 * level} fill="#2c8bff" opacity={0.38} />
              <path d={`M0 ${44 - 42 * level} q 2.5 ${Math.sin(t * 4) * 0.8} 5 0 t 5 0 t 5 0 t 5 0`} stroke="#9fd0ff" strokeWidth={0.4} fill="none" />
            </g>
          )}
          <IndicatorLed x={16} y={50} on={!!L.powered} />
          <text x={10} y={55} fontSize={1.6} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={700}>
            WATER
          </text>
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    }
    case "soil":
      return (
        <g>
          <path d="M0 0 H23 V62 L16 80 H7 L0 62 Z" fill="#141518" stroke="rgba(255,255,255,.18)" strokeWidth={0.25} />
          <rect x={3} y={6} width={17} height={10} rx={0.6} fill="#1d1f22" stroke="#333" strokeWidth={0.2} />
          <text x={11.5} y={30} fontSize={1.7} fill="#e8e8e8" textAnchor="middle" fontFamily="Chakra Petch" transform="rotate(-90 11.5 30)">
            Capacitive Soil Moisture v1.2
          </text>
          <line x1={11.5} y1={64} x2={11.5} y2={76} stroke="#b88a3a" strokeWidth={0.6} opacity={0.6} />
          <HeaderPins def={def} />
          <g fontSize={1.1} fill="#fff" fontFamily="Chakra Petch" textAnchor="middle">
            {def.pins.map((p) => (
              <text key={p.id} x={p.x} y={p.y + 2.8}>
                {p.label}
              </text>
            ))}
          </g>
        </g>
      );
    case "mq2":
      return (
        <g>
          <Pcb w={32} h={22} color="#1d5fa8" />
          <circle cx={16} cy={9.5} r={8.6} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <circle cx={16} cy={9.5} r={6.8} fill="url(#tc-mesh)" />
          <circle cx={16} cy={9.5} r={6.8} fill="#ff6a00" opacity={L.powered ? 0.12 + 0.08 * Math.sin(t * 3) : 0} />
          <IndicatorLed x={3} y={4} on={!!L.powered} />
          <IndicatorLed x={3} y={8} on={!!L.indicator} color="#33ff88" />
          <TrimPot x={28.5} y={5} />
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "pir":
      return (
        <g>
          <Pcb w={32.3} h={24.3} color="#2f7d3b" />
          <circle cx={16.15} cy={10.4} r={9.6} fill="#f4f4f1" stroke="#d5d5ce" strokeWidth={0.3} />
          <g stroke="#dcdcd5" strokeWidth={0.3} fill="none">
            <circle cx={16.15} cy={10.4} r={6.2} />
            <circle cx={16.15} cy={10.4} r={3} />
            <path d="M6.55 10.4 H25.75 M16.15 0.8 V20" />
          </g>
          {L.on && <circle cx={16.15} cy={10.4} r={10} fill="#ff4d4d" opacity={0.18} />}
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "sw420":
      return (
        <g>
          <Pcb w={32} h={14} color="#1d5fa8" />
          <rect x={2} y={3.5} width={11} height={7} rx={3.5} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <TrimPot x={17.5} y={7} />
          <IndicatorLed x={24} y={3.6} on={!!L.powered} />
          <IndicatorLed x={24} y={10.4} on={!!L.indicator} color="#33ff88" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
    case "adxl335":
      return (
        <g>
          <Pcb w={21} h={16} color="#5b2f8f" />
          <rect x={7.5} y={3} width={6} height={6} rx={0.4} fill="#18191b" />
          <text x={10.5} y={11.6} fontSize={1.3} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={700}>
            GY-61 ADXL335
          </text>
          <g stroke="#fff" strokeWidth={0.25} fill="none" opacity={0.8}>
            <path d="M2 9 h3.5 l-0.8 -0.6 M5.5 9 l-0.8 0.6" />
            <path d="M2 9 v-3.5 l-0.6 0.8 M2 5.5 l0.6 0.8" />
          </g>
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "sound":
      return (
        <g>
          <Pcb w={34} h={15} color="#1d5fa8" />
          <circle cx={-0.5} cy={7.5} r={4.8} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <circle cx={-0.5} cy={7.5} r={3.6} fill="#1c1d20" />
          <TrimPot x={11} y={7.5} />
          <rect x={17} y={4.8} width={5} height={5.4} rx={0.3} fill="#1b1d20" />
          <IndicatorLed x={26} y={3.6} on={!!L.powered} />
          <IndicatorLed x={26} y={11.4} on={!!L.indicator} color="#33ff88" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
    case "bme280":
      return (
        <g>
          <Pcb w={12.7} h={15.24} color="#6b2fa3" rx={0.8} />
          <circle cx={2.2} cy={2.2} r={1.1} fill="#0b0b0d" stroke="#d9b25a" strokeWidth={0.4} />
          <circle cx={10.5} cy={2.2} r={1.1} fill="#0b0b0d" stroke="#d9b25a" strokeWidth={0.4} />
          <rect x={4.85} y={3.6} width={3} height={3} rx={0.3} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.15} />
          <circle cx={7.2} cy={4.2} r={0.28} fill="#222" />
          <g fill="#c8a372">
            <rect x={2.0} y={7.4} width={1.4} height={0.8} rx={0.1} />
            <rect x={9.3} y={7.4} width={1.4} height={0.8} rx={0.1} />
          </g>
          <rect x={4.4} y={7.2} width={3.9} height={1.3} rx={0.2} fill="#1b1d20" />
          <text x={6.35} y={10.0} fontSize={1.0} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={700}>
            GY-{String(inst.props.model ?? "BME280")}
          </text>
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "bh1750":
      return (
        <g>
          <Pcb w={15.24} h={18.5} color="#1d5fa8" rx={0.8} />
          <circle cx={7.62} cy={2.6} r={1.5} fill="#0b0b0d" stroke="#d9b25a" strokeWidth={0.45} />
          <rect x={5.6} y={6.0} width={4.0} height={3.2} rx={0.3} fill="#1b1d20" />
          <rect x={6.5} y={6.8} width={2.2} height={1.6} rx={0.2} fill="#b7c3cf" opacity={0.85} />
          <rect x={1.8} y={6.6} width={1.4} height={0.8} fill="#c8a372" />
          <rect x={12.0} y={6.6} width={1.4} height={0.8} fill="#c8a372" />
          <text x={7.62} y={12.4} fontSize={1.25} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={700}>
            GY-30 BH1750
          </text>
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "ds18b20":
      return (
        <g>
          <path d="M2.4 2.6 a2.6 2.6 0 0 1 5.2 0 V20 H2.4 Z" fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.25} />
          <rect x={2.0} y={19.6} width={6.0} height={4.4} rx={0.6} fill="#121315" />
          <path d="M5 24 C5 28, 5 29, 5 30" stroke="#121315" strokeWidth={3.2} fill="none" strokeLinecap="round" />
          <g fill="none" strokeWidth={0.9} strokeLinecap="round">
            <path d="M4.2 30 C3.6 33, 2.54 34, 2.54 38.6" stroke="#2a2a2a" />
            <path d="M5 30 C5 33, 5.08 34, 5.08 38.6" stroke="#f2c230" />
            <path d="M5.8 30 C6.6 33, 7.62 34, 7.62 38.6" stroke="#d6302a" />
          </g>
          <text x={5} y={12} fontSize={1.2} fill="#4b5157" textAnchor="middle" fontFamily="IBM Plex Mono" transform="rotate(-90 5 12)">
            DS18B20
          </text>
          <HeaderPins def={def} />
        </g>
      );
    case "ir-obstacle":
      return (
        <g>
          <Pcb w={32} h={14} color="#1d5fa8" />
          <rect x={-3.2} y={2.0} width={4.6} height={3.6} rx={1.8} fill="#cfe3ff" stroke="#7aa6d9" strokeWidth={0.25} opacity={0.95} />
          <rect x={-3.2} y={8.4} width={4.6} height={3.6} rx={1.8} fill="#141518" stroke="#3a3d42" strokeWidth={0.25} />
          {L.powered && <rect x={-3.2} y={2.0} width={4.6} height={3.6} rx={1.8} fill="#c25cff" opacity={0.25} />}
          <TrimPot x={9.5} y={7} />
          <rect x={14.5} y={4.4} width={5} height={5.2} rx={0.3} fill="#1b1d20" stroke="#333" strokeWidth={0.2} />
          <IndicatorLed x={23.5} y={3.6} on={!!L.powered} />
          <IndicatorLed x={23.5} y={10.4} on={!!L.indicator} color="#33ff88" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
    case "hall":
      return (
        <g>
          <Pcb w={20} h={12} color="#16181b" />
          <path d="M-2.2 3.6 h3.4 v4.8 h-3.4 l-0.8 -0.8 v-3.2 z" fill="#1d1e21" stroke="#3a3d42" strokeWidth={0.2} />
          <line x1={1.2} y1={4.6} x2={3.6} y2={4.6} stroke="#b9c0c7" strokeWidth={0.35} />
          <line x1={1.2} y1={6} x2={3.6} y2={6} stroke="#b9c0c7" strokeWidth={0.35} />
          <line x1={1.2} y1={7.4} x2={3.6} y2={7.4} stroke="#b9c0c7" strokeWidth={0.35} />
          <rect x={6.2} y={4.8} width={3.4} height={1.4} rx={0.3} fill="#c8a372" />
          <IndicatorLed x={12.2} y={6} on={!!L.indicator} />
          <text x={8} y={10.4} fontSize={1.1} fill="#e9e9e9" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={600}>
            KY-003
          </text>
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
    case "touch": {
      const on = !!L.on;
      return (
        <g>
          <Pcb w={15.24} h={12.7} color="#c8202a" rx={1} />
          <circle cx={7.62} cy={4.5} r={3.6} fill="#d9b25a" opacity={0.85} />
          <circle cx={7.62} cy={4.5} r={2.9} fill="#c8202a" />
          <circle cx={7.62} cy={4.5} r={2.3} fill="none" stroke="#f4e3b0" strokeWidth={0.25} opacity={0.6} />
          {on && <circle cx={7.62} cy={4.5} r={2.9 + 1.4 * ((t * 1.6) % 1)} fill="none" stroke="#fff" strokeWidth={0.35} opacity={1 - ((t * 1.6) % 1)} />}
          <rect x={11.6} y={2} width={2.2} height={1.6} rx={0.2} fill="#1b1d20" />
          <IndicatorLed x={2.2} y={2.2} on={on} color="#ff3b30" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    }
    case "joystick": {
      const x = (Number(inst.props.x ?? 0.5) - 0.5) * 8;
      const y = (Number(inst.props.y ?? 0.5) - 0.5) * 8;
      const pressed = !!L.on;
      return (
        <g>
          <Pcb w={34} h={26} color="#16181b" rx={1.2} />
          <rect x={4} y={1.5} width={23} height={23} rx={2} fill="#202226" stroke="#3a3d42" strokeWidth={0.3} />
          <circle cx={15.5} cy={13} r={9.6} fill="#2a2c31" stroke="#45484f" strokeWidth={0.3} />
          <g transform={`translate(${15.5 + x} ${13 + y})`}>
            <circle r={7.4} fill="#000" opacity={0.35} transform="translate(0.5 0.8)" />
            <circle r={7.2} fill={pressed ? "#3a3d44" : "#26282c"} stroke="#55585f" strokeWidth={0.35} />
            {[5.6, 4.0, 2.4].map((r) => (
              <circle key={r} r={r} fill="none" stroke="#3c3f46" strokeWidth={0.45} />
            ))}
          </g>
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" color="#d7dbe0" />
        </g>
      );
    }
    case "pulse": {
      const beat = !!L.indicator;
      return (
        <g>
          <g fill="none" strokeWidth={0.9} strokeLinecap="round">
            <path d="M6.6 14.4 C6.4 18, 5.46 19, 5.46 22.4" stroke="#7b3fd0" />
            <path d="M8 15 C8 18, 8 19, 8 22.4" stroke="#d6302a" />
            <path d="M9.4 14.4 C9.6 18, 10.54 19, 10.54 22.4" stroke="#2a2a2a" />
          </g>
          <circle cx={8} cy={8} r={8} fill="#000" opacity={0.3} filter="url(#tc-soft)" transform="translate(0.4 0.8)" />
          <circle cx={8} cy={8} r={8} fill="#1f8a4c" stroke="rgba(255,255,255,.2)" strokeWidth={0.25} />
          <path d="M8 12.6 C3 9, 3.2 4.6, 5.8 4.6 C7 4.6, 7.6 5.4, 8 6.2 C8.4 5.4, 9 4.6, 10.2 4.6 C12.8 4.6, 13 9, 8 12.6 Z" fill="#f2f2f2" opacity={0.92} />
          <rect x={7.1} y={6.8} width={1.8} height={1.8} rx={0.3} fill={beat ? "#5cff8f" : "#1b4d2c"} />
          {beat && <circle cx={8} cy={7.7} r={3.6} fill="#5cff8f" opacity={0.45} filter="url(#tc-glow)" />}
          <HeaderPins def={def} />
        </g>
      );
    }
    case "mq135":
      return (
        <g>
          <Pcb w={32} h={22} color="#1d5fa8" />
          <circle cx={16} cy={9.5} r={8.6} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <circle cx={16} cy={9.5} r={6.8} fill="url(#tc-mesh)" />
          <circle cx={16} cy={9.5} r={6.8} fill="#ff6a00" opacity={L.powered ? 0.12 + 0.08 * Math.sin(t * 3) : 0} />
          <text x={28.5} y={11.6} fontSize={1.2} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={700} opacity={0.8}>
            MQ-135
          </text>
          <IndicatorLed x={3} y={4} on={!!L.powered} />
          <IndicatorLed x={3} y={8} on={!!L.indicator} color="#33ff88" />
          <TrimPot x={28.5} y={5} />
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "rain": {
      const wet = Math.max(0, Math.min(1, ((L.reading ?? 0) as number) / 100));
      const drops = Math.round(wet * 22);
      return (
        <g>
          <rect x={0.4} y={1.8} width={26} height={20} rx={0.8} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect x={0} y={1} width={26} height={20} rx={0.8} fill="#1d2a3a" stroke="rgba(255,255,255,.18)" strokeWidth={0.25} />
          <g fill="none" stroke="#c9d2da" strokeWidth={0.55}>
            <path d="M2 3 H24 M2 3 V19" />
            {Array.from({ length: 7 }, (_, i) => (
              <path key={i} d={`M2 ${5.2 + i * 2.2} H22`} transform={i % 2 ? "translate(2 0)" : undefined} />
            ))}
            <path d="M24 3 V19 H4" />
          </g>
          {Array.from({ length: drops }, (_, i) => {
            const rx = 3 + ((i * 37.7) % 20);
            const ry = 3 + ((i * 53.3 + t * 2) % 16);
            return <ellipse key={i} cx={rx} cy={ry} rx={0.7} ry={0.9} fill="#8fd0ff" opacity={0.75} />;
          })}
          <g fill="none" strokeWidth={0.7} strokeLinecap="round">
            <path d="M26 9 C27.5 9, 27.5 10, 29 10" stroke="#e8e8e8" />
            <path d="M26 13 C27.5 13, 27.5 12, 29 12" stroke="#2a2a2a" />
          </g>
          <g transform="translate(28 4)">
            <rect x={0.3} y={0.7} width={32} height={14} rx={1} fill="#000" opacity={0.3} />
            <rect width={32} height={14} rx={1} fill="#1d5fa8" stroke="rgba(255,255,255,.18)" strokeWidth={0.25} />
            <TrimPot x={7} y={7} />
            <rect x={12.5} y={4.4} width={5} height={5.2} rx={0.3} fill="#1b1d20" />
            <IndicatorLed x={22} y={3.6} on={!!L.powered} />
            <IndicatorLed x={22} y={10.4} on={!!L.indicator} color="#33ff88" />
          </g>
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
    }
    case "pb-no":
    case "pb-nc":
    case "pilot-lamp": {
      const lamp = def.type === "pilot-lamp";
      const COL: Record<string, string> = { green: "#22b35a", red: "#e0352d", black: "#222", yellow: "#f2c419", blue: "#2c6fe0", white: "#f1f1ee", amber: "#ff9d1c" };
      const col = COL[String(inst.props.color ?? (def.type === "pb-nc" ? "red" : "green"))] ?? "#22b35a";
      const pressed = !!L.on && !lamp;
      const lit = lamp && (L.brightness ?? 0) > 0.05;
      return (
        <g>
          <rect x={0.4} y={0.9} width={22.86} height={21} rx={2.2} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect width={22.86} height={21} rx={2.2} fill="#24262a" stroke="#3b3e44" strokeWidth={0.3} />
          <circle cx={11.43} cy={10.5} r={9.4} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          {lit && <circle cx={11.43} cy={10.5} r={11} fill={col} opacity={0.6 * Math.min(1, L.brightness ?? 0)} filter="url(#tc-glow-lg)" />}
          <circle cx={11.43} cy={10.5} r={pressed ? 6.9 : 7.6} fill={lamp && !lit ? shadeHex(col, -45) : col} stroke="rgba(0,0,0,.35)" strokeWidth={0.4} />
          {lamp ? (
            <g opacity={0.5} stroke="#fff" strokeWidth={0.25}>
              {[-3, -1, 1, 3].map((d) => (
                <line key={d} x1={11.43 + d} y1={5.2} x2={11.43 + d} y2={15.8} />
              ))}
            </g>
          ) : (
            <circle cx={9.6} cy={8.6} r={2.4} fill="#fff" opacity={pressed ? 0.08 : 0.22} />
          )}
          {!lamp && (
            <text x={11.43} y={11.3} fontSize={2.2} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700} opacity={0.9}>
              {String(inst.props.legend ?? "")}
            </text>
          )}
          <text x={11.43} y={20.2} fontSize={1.3} textAnchor="middle" fill="#cfd3d8" fontFamily="Chakra Petch">
            {lamp ? "24V" : def.type === "pb-no" ? "NO 3-4" : "NC 1-2"}
          </text>
          <Terminals def={def} />
        </g>
      );
    }
    case "estop": {
      const latched = !!L.on;
      return (
        <g>
          <rect x={0.4} y={0.9} width={27.94} height={26} rx={2} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect width={27.94} height={26} rx={2} fill="#f2c419" stroke="#c9a10f" strokeWidth={0.3} />
          <circle cx={13.97} cy={13} r={11.4} fill="#e8b80e" stroke="#b8920a" strokeWidth={0.3} />
          <path id={`es-${inst.id}`} d="M 4.4 13 a 9.6 9.6 0 1 1 19.2 0" fill="none" />
          <text fontSize={1.7} fill="#1b1b1b" fontFamily="Chakra Petch" fontWeight={700}>
            <textPath href={`#es-${inst.id}`} startOffset="50%" textAnchor="middle">
              EMERGENCY STOP
            </textPath>
          </text>
          <circle cx={13.97} cy={13.6} r={latched ? 7.4 : 8.2} fill={latched ? "#a9201a" : "#e0352d"} stroke="#7d140f" strokeWidth={0.4} />
          <circle cx={11.8} cy={11.4} r={2.8} fill="#fff" opacity={latched ? 0.06 : 0.2} />
          {latched && (
            <text x={13.97} y={14.4} fontSize={1.8} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700}>
              LATCHED
            </text>
          )}
          <Terminals def={def} />
        </g>
      );
    }
    case "selector2":
    case "selector3": {
      const three = def.type === "selector3";
      const pos = Number(L.reading ?? 0);
      const ang = three ? (pos === 1 ? -45 : pos === 2 ? 45 : 0) : pos ? 45 : -45;
      const labels = three ? [[-45, String(inst.props.label1 ?? "MAN")], [0, String(inst.props.label0 ?? "OFF")], [45, String(inst.props.label2 ?? "AUTO")]] : [[-45, String(inst.props.label0 ?? "OFF")], [45, String(inst.props.label1 ?? "ON")]];
      return (
        <g>
          <rect x={0.4} y={0.9} width={22.86} height={25} rx={2.2} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect width={22.86} height={25} rx={2.2} fill="#24262a" stroke="#3b3e44" strokeWidth={0.3} />
          {labels.map(([a, l]) => {
            const r = ((Number(a) - 90) * Math.PI) / 180;
            return (
              <text key={String(a)} x={11.43 + Math.cos(r) * 9.4} y={13 + Math.sin(r) * 9.4 + 0.5} fontSize={1.5} textAnchor="middle" fill="#e9ecef" fontFamily="Chakra Petch" fontWeight={600}>
                {l}
              </text>
            );
          })}
          <circle cx={11.43} cy={13} r={6.8} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <circle cx={11.43} cy={13} r={5.6} fill="#141518" />
          <g transform={`rotate(${ang} 11.43 13)`}>
            <rect x={10.03} y={7.6} width={2.8} height={10.8} rx={1.2} fill="#2e3035" stroke="#55585f" strokeWidth={0.25} />
            <path d="M11.43 8.2 l-0.8 1.6 h1.6 z" fill="#f2f2f0" />
          </g>
          <Terminals def={def} />
        </g>
      );
    }
    case "limit-switch": {
      const act = !!L.on;
      return (
        <g>
          <rect x={4.4} y={12.9} width={22} height={18} rx={1.4} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect x={4} y={12} width={22} height={18} rx={1.4} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <rect x={8} y={15} width={14} height={8} rx={0.8} fill="#d0a32a" />
          <text x={15} y={20.2} fontSize={1.6} textAnchor="middle" fill="#1b1b1b" fontFamily="Chakra Petch" fontWeight={700}>
            LIMIT
          </text>
          <g transform={`rotate(${act ? -28 : 0} 15 12)`}>
            <rect x={14} y={2.6} width={2} height={10} rx={0.8} fill="#2b2d31" />
            <circle cx={15} cy={2.6} r={2.4} fill="#1b1c1f" stroke="#55585f" strokeWidth={0.3} />
          </g>
          <circle cx={15} cy={12} r={1.6} fill="#55585f" />
          <Terminals def={def} />
        </g>
      );
    }
    case "contactor":
    case "overload":
    case "timer-relay":
    case "mcb3":
    case "psu24": {
      const on = !!L.on;
      const W = def.w;
      const H = def.h;
      const body = def.type === "psu24" ? "#c9ced3" : def.type === "mcb3" ? "#f2f1ec" : "#e6e5e1";
      return (
        <g>
          <rect x={0.4} y={0.9} width={W} height={H} rx={1.6} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect width={W} height={H} rx={1.6} fill={def.type === "psu24" ? "url(#tc-metal)" : body} stroke="#a8a6a0" strokeWidth={0.3} />
          {def.type === "contactor" && (
            <g>
              <rect x={6} y={14} width={W - 12} height={H - 28} rx={1.2} fill="#d3d1cb" />
              <rect x={W / 2 - 7} y={24} width={14} height={18} rx={1} fill="#2a2c30" />
              <rect x={W / 2 - 5} y={on ? 33 : 26} width={10} height={7} rx={0.6} fill={on ? "#22b35a" : "#8b8f96"} />
              <text x={W / 2} y={50} fontSize={2.6} textAnchor="middle" fill="#2b2d31" fontFamily="Chakra Petch" fontWeight={700}>
                {inst.label}
              </text>
              <text x={W / 2} y={54} fontSize={1.5} textAnchor="middle" fill="#55585f" fontFamily="Chakra Petch">
                LC1D09 · 24VDC
              </text>
              <text x={W / 2} y={59} fontSize={1.5} textAnchor="middle" fill={on ? "#178a43" : "#8b8f96"} fontFamily="Chakra Petch" fontWeight={700}>
                {on ? "▶ ENERGISED" : "○ released"}
              </text>
            </g>
          )}
          {def.type === "overload" && (
            <g>
              <circle cx={10} cy={20.32} r={4.2} fill="#2c6fe0" stroke="#1d4fa8" strokeWidth={0.3} />
              <text x={10} y={21} fontSize={1.6} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700}>
                {String(inst.props.setting ?? 8)}A
              </text>
              <rect x={20} y={15} width={9} height={4.4} rx={0.8} fill={on ? "#e0352d" : "#8b8f96"} />
              <text x={24.5} y={18.2} fontSize={1.6} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700}>
                {on ? "TRIP" : "OK"}
              </text>
              <rect x={32} y={15} width={9} height={4.4} rx={0.8} fill="#2a2c30" />
              <text x={36.5} y={18.2} fontSize={1.3} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch">
                TEST
              </text>
              <text x={W / 2} y={28} fontSize={2.2} textAnchor="middle" fill="#2b2d31" fontFamily="Chakra Petch" fontWeight={700}>
                {inst.label} · OL
              </text>
            </g>
          )}
          {def.type === "timer-relay" && (
            <g>
              <IndicatorLed x={W / 2 - 4} y={12} on={!!L.indicator} color="#33ff88" />
              <IndicatorLed x={W / 2 + 4} y={12} on={on} color="#ffb020" />
              <circle cx={W / 2} cy={30} r={7} fill="#2a2c30" stroke="#55585f" strokeWidth={0.3} />
              <circle cx={W / 2} cy={30} r={7} fill="none" stroke="#22b35a" strokeWidth={1.2} strokeDasharray={`${Math.min(1, Number(L.reading ?? 0) / Number(inst.props.delay ?? 3)) * 44} 44`} transform={`rotate(-90 ${W / 2} 30)`} />
              <text x={W / 2} y={31} fontSize={2.2} textAnchor="middle" fill="#fff" fontFamily="IBM Plex Mono" fontWeight={600}>
                {Number(inst.props.delay ?? 3)}s
              </text>
              <text x={W / 2} y={44} fontSize={1.8} textAnchor="middle" fill="#2b2d31" fontFamily="Chakra Petch" fontWeight={700}>
                {inst.label}
              </text>
              <text x={W / 2} y={48} fontSize={1.3} textAnchor="middle" fill="#55585f" fontFamily="Chakra Petch">
                ON-DELAY
              </text>
            </g>
          )}
          {def.type === "mcb3" && (
            <g>
              {[5.08, 15.24, 25.4].map((x) => (
                <g key={x}>
                  <rect x={x - 3.6} y={16} width={7.2} height={16} rx={0.8} fill="#d7d5cf" />
                  <rect x={x - 2.4} y={on ? 17.5 : 24} width={4.8} height={7} rx={0.8} fill={on ? "#2b2d31" : "#55585f"} />
                </g>
              ))}
              <text x={15.24} y={38} fontSize={2.2} textAnchor="middle" fill="#2b2d31" fontFamily="Chakra Petch" fontWeight={700}>
                C16 · {on ? "ON  I" : "OFF O"}
              </text>
              <rect x={11} y={40} width={8.5} height={2.8} rx={0.5} fill={on ? "#e0352d" : "#22b35a"} />
            </g>
          )}
          {def.type === "psu24" && (
            <g>
              <rect x={4} y={9} width={W - 8} height={30} rx={1} fill="url(#tc-mesh)" opacity={0.55} />
              <rect x={6} y={41} width={W - 12} height={9} rx={0.8} fill="#2a2c30" />
              <text x={W / 2} y={46.6} fontSize={2.6} textAnchor="middle" fill="#f2f2f0" fontFamily="Chakra Petch" fontWeight={700}>
                24V DC 2.5A
              </text>
              <IndicatorLed x={W - 6} y={6} on={on} color="#33ff88" />
            </g>
          )}
          <Terminals def={def} />
        </g>
      );
    }
    case "supply3": {
      const COL: Record<string, string> = { L1: "#7b4a24", L2: "#1b1b1b", L3: "#8a8a8a", N: "#2c6fe0", PE: "#22b35a" };
      return (
        <g>
          <rect x={0.4} y={0.9} width={45.72} height={15} rx={1.4} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          <rect width={45.72} height={15} rx={1.4} fill="#2a2c30" stroke="#45484f" strokeWidth={0.3} />
          <text x={22.86} y={4.4} fontSize={2} textAnchor="middle" fill="#ffd23f" fontFamily="Chakra Petch" fontWeight={700}>
            ⚡ 3~ 400/230 V 50 Hz
          </text>
          {def.pins.map((p) => (
            <g key={p.id}>
              <rect x={p.x - 3} y={7} width={6} height={7} rx={0.6} fill={COL[p.id]} stroke={p.id === "PE" ? "#f2c419" : "rgba(255,255,255,.2)"} strokeWidth={p.id === "PE" ? 0.6 : 0.2} strokeDasharray={p.id === "PE" ? "1 1" : undefined} />
              <text x={p.x} y={11.6} fontSize={1.6} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700}>
                {p.id}
              </text>
            </g>
          ))}
          <Terminals def={def} />
        </g>
      );
    }
    case "motor3": {
      const sp = L.speed ?? 0;
      const rot = (t * 360 * 3 * sp) % 360;
      return (
        <g>
          <circle cx={25.4} cy={22} r={21} fill="#000" opacity={0.3} filter="url(#tc-soft)" transform="translate(0.5 0.9)" />
          <circle cx={25.4} cy={22} r={21} fill="#4f6b8a" stroke="#34495f" strokeWidth={0.4} />
          {Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2;
            return <line key={i} x1={25.4 + Math.cos(a) * 15} y1={22 + Math.sin(a) * 15} x2={25.4 + Math.cos(a) * 20.4} y2={22 + Math.sin(a) * 20.4} stroke="#3c5470" strokeWidth={1} />;
          })}
          <circle cx={25.4} cy={22} r={14.4} fill="#5b7899" />
          <g transform={`rotate(${rot} 25.4 22)`}>
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <path key={a} transform={`rotate(${a} 25.4 22)`} d="M25.4 22 L 24.2 9.5 Q 25.4 8.4 26.6 9.5 Z" fill="#c9d4e0" opacity={0.9} />
            ))}
            <circle cx={25.4} cy={22} r={3} fill="#2a2c30" />
          </g>
          <text x={25.4} y={38.6} fontSize={3} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700}>
            M 3~
          </text>
          {L.on && (
            <text x={25.4} y={5.4} fontSize={2} textAnchor="middle" fill="#7af0b4" fontFamily="IBM Plex Mono" fontWeight={600}>
              {sp > 0 ? "⟳ FWD" : "⟲ REV"} {Math.abs(Math.round(Number(L.reading ?? 0)))} rpm
            </text>
          )}
          {L.warn && (
            <text x={25.4} y={5.4} fontSize={2} textAnchor="middle" fill="#ff8a7a" fontFamily="Chakra Petch" fontWeight={700}>
              ⚠ MISSING PHASE
            </text>
          )}
          <rect x={11} y={44} width={28.8} height={6.6} rx={0.8} fill="#2a2c30" />
          <Terminals def={def} />
        </g>
      );
    }
    case "air-supply": {
      const bar = Number(L.reading ?? 0);
      const open = L.on !== false;
      const ang = -120 + Math.max(0, Math.min(10, bar)) * 24;
      const r = (ang * Math.PI) / 180;
      return (
        <g>
          <rect x={4.6} y={4.6} width={22} height={40} rx={2} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          {/* manifold pipe to P */}
          <rect x={13.9} y={2.4} width={2.7} height={5} fill="url(#tc-metal)" />
          <rect x={4} y={6} width={22.5} height={7.5} rx={1.4} fill="#3f6fa0" stroke="#2c5078" strokeWidth={0.3} />
          {/* ball valve lever: along the pipe = open */}
          <g transform={`rotate(${open ? 0 : 90} 23 9.75)`}>
            <rect x={17} y={8.9} width={11} height={1.7} rx={0.8} fill={open ? "#e0352d" : "#f2c419"} stroke="rgba(0,0,0,.4)" strokeWidth={0.2} />
          </g>
          <circle cx={23} cy={9.75} r={1.1} fill="#d8dde2" />
          {/* gauge */}
          <circle cx={11.5} cy={20.5} r={6.8} fill="url(#tc-metal)" stroke="#55606a" strokeWidth={0.3} />
          <circle cx={11.5} cy={20.5} r={5.9} fill="#f4f2ec" />
          {[0, 2, 4, 6, 8, 10].map((v) => {
            const a = ((-120 + v * 24 - 90) * Math.PI) / 180;
            return <line key={v} x1={11.5 + Math.cos(a) * 4.6} y1={20.5 + Math.sin(a) * 4.6} x2={11.5 + Math.cos(a) * 5.6} y2={20.5 + Math.sin(a) * 5.6} stroke="#2b2d31" strokeWidth={0.25} />;
          })}
          <path d={`M 11.5 20.5 L ${11.5 + Math.cos(r - Math.PI / 2) * 4.8} ${20.5 + Math.sin(r - Math.PI / 2) * 4.8}`} stroke="#d1262c" strokeWidth={0.45} strokeLinecap="round" style={{ transition: "d .2s" }} />
          <circle cx={11.5} cy={20.5} r={0.7} fill="#2b2d31" />
          <text x={11.5} y={24.6} fontSize={1.2} textAnchor="middle" fill="#2b2d31" fontFamily="IBM Plex Mono">
            bar
          </text>
          {/* regulator knob */}
          <rect x={20} y={15} width={6} height={9} rx={1.2} fill="#2a2c30" />
          {[16.5, 18.5, 20.5, 22.5].map((y) => (
            <line key={y} x1={20.6} y1={y} x2={25.4} y2={y} stroke="#55585f" strokeWidth={0.3} />
          ))}
          {/* filter bowl */}
          <path d="M 6.5 28 H 24 V 36 Q 24 42.5 15.25 42.5 Q 6.5 42.5 6.5 36 Z" fill="rgba(200,225,245,.35)" stroke="#8fb3cf" strokeWidth={0.35} />
          <rect x={9} y={36.5} width={12.5} height={3.6} rx={1.6} fill="rgba(120,170,210,.35)" />
          <rect x={6} y={26.6} width={18.5} height={2} rx={0.6} fill="#2c5078" />
          <text x={15.25} y={33.2} fontSize={2} textAnchor="middle" fill={open ? "#eaf6ff" : "#ffd23f"} fontFamily="IBM Plex Mono" fontWeight={600}>
            {open ? `${bar.toFixed(1)} bar` : "CLOSED"}
          </text>
          <Ports def={def} />
        </g>
      );
    }
    case "valve52":
    case "valve52d": {
      const dbl = def.type === "valve52d";
      const W = def.w;
      const shifted = !!L.on;
      const coilA = dbl ? !!L.leds?.[0] : !!L.indicator;
      const coilB = dbl ? !!L.leds?.[1] : false;
      const bx0 = 13;
      const bx1 = dbl ? W - 13 : W - 4.5;
      return (
        <g>
          <rect x={0.8} y={1.6} width={W - 0.4} height={22.5} rx={1.4} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          {/* valve body */}
          <rect x={bx0} y={6.2} width={bx1 - bx0} height={15.5} rx={1.2} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <rect x={bx0 + 1.5} y={11.4} width={bx1 - bx0 - 3} height={5} rx={0.8} fill="#2a2c30" />
          {/* spool in its window: slides toward the energised side */}
          <rect x={bx0 + 2.2 + (shifted ? 0 : 6)} y={12.2} width={bx1 - bx0 - 10.4} height={3.4} rx={0.6} fill={shifted ? "#3fb6ff" : "#8b98a5"} style={{ transition: "x .12s" }} />
          <text x={(bx0 + bx1) / 2} y={9.9} fontSize={1.9} textAnchor="middle" fill="#2b2d31" fontFamily="Chakra Petch" fontWeight={700}>
            {inst.label} · 5/2
          </text>
          <text x={(bx0 + bx1) / 2} y={20.4} fontSize={1.35} textAnchor="middle" fill={shifted ? "#1d6fa8" : "#55585f"} fontFamily="Chakra Petch" fontWeight={700}>
            {shifted ? "1→4  2→3" : "1→2  4→5"}
          </text>
          {/* solenoid Y14 (left) */}
          <rect x={0.6} y={0.6} width={12.2} height={22} rx={1.2} fill="#1d1f23" stroke="#3b3e44" strokeWidth={0.3} />
          <rect x={2} y={8} width={9.4} height={10} rx={0.8} fill="#2c2e33" />
          <text x={6.7} y={12.2} fontSize={1.5} textAnchor="middle" fill="#e9ecef" fontFamily="Chakra Petch" fontWeight={700}>
            Y14
          </text>
          <text x={6.7} y={14.4} fontSize={1.1} textAnchor="middle" fill="#9aa0a8" fontFamily="Chakra Petch">
            24VDC
          </text>
          <IndicatorLed x={6.7} y={20} on={coilA} color="#ffb020" />
          {/* manual override button */}
          <circle cx={6.7} cy={16.6} r={1.2} fill={shifted && !coilA && !coilB ? "#2c6fe0" : "#3d6fb8"} stroke="#1d4fa8" strokeWidth={0.2} />
          {dbl ? (
            <g>
              <rect x={W - 12.8} y={0.6} width={12.2} height={22} rx={1.2} fill="#1d1f23" stroke="#3b3e44" strokeWidth={0.3} />
              <rect x={W - 11.4} y={8} width={9.4} height={10} rx={0.8} fill="#2c2e33" />
              <text x={W - 6.7} y={12.2} fontSize={1.5} textAnchor="middle" fill="#e9ecef" fontFamily="Chakra Petch" fontWeight={700}>
                Y12
              </text>
              <text x={W - 6.7} y={14.4} fontSize={1.1} textAnchor="middle" fill="#9aa0a8" fontFamily="Chakra Petch">
                24VDC
              </text>
              <IndicatorLed x={W - 6.7} y={20} on={coilB} color="#ffb020" />
            </g>
          ) : (
            <path d={`M ${W - 4.5} 14 l 0.9 -2.2 l 0.9 4.4 l 0.9 -4.4 l 0.9 4.4 l 0.6 -2.2`} fill="none" stroke="#9aa0a8" strokeWidth={0.4} />
          )}
          {/* exhaust silencers 5 and 3 */}
          {[
            [23.37 - 3.05, "5"],
            [33.02 + 2.54, "3"],
          ].map(([x, l]) => (
            <g key={String(l)}>
              <rect x={Number(x) - 1.1} y={21.7} width={2.2} height={4} rx={0.8} fill="#a8875a" />
              <text x={Number(x)} y={27.4} fontSize={1.2} textAnchor="middle" fill="#9aa0a8" fontFamily="Chakra Petch">
                {l}
              </text>
            </g>
          ))}
          <Ports def={def} />
        </g>
      );
    }
    case "cylinder": {
      const pos = Math.max(0, Math.min(1, L.pos ?? 0));
      const pistonX = 7.2 + pos * 50;
      const rodEnd = 66 + pos * 21.5;
      const s0 = !!L.leds?.[0];
      const s1 = !!L.leds?.[1];
      return (
        <g>
          <rect x={2.4} y={5.6} width={64} height={11} rx={1.2} fill="#000" opacity={0.3} filter="url(#tc-soft)" />
          {/* rod + rod-end nut */}
          <rect x={60} y={9.1} width={rodEnd - 60} height={2.3} fill="url(#tc-metal)" stroke="#8b949c" strokeWidth={0.15} />
          <rect x={rodEnd - 0.2} y={7.9} width={3.4} height={4.7} rx={0.5} fill="#9aa3ab" stroke="#5b636b" strokeWidth={0.2} />
          {/* barrel (aluminium profile) with end caps */}
          <rect x={2} y={4.6} width={64} height={11.2} rx={0.8} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <rect x={2} y={7.4} width={64} height={0.5} fill="rgba(0,0,0,.12)" />
          <rect x={2} y={12.5} width={64} height={0.5} fill="rgba(0,0,0,.12)" />
          {/* magnetic piston seen through the profile */}
          <rect x={pistonX} y={5.3} width={4.6} height={9.8} rx={0.6} fill="#3fb6ff" opacity={0.35} />
          <rect x={2} y={3.8} width={6.6} height={12.8} rx={0.8} fill="#4a4f56" stroke="#2e3237" strokeWidth={0.3} />
          <rect x={59.4} y={3.8} width={6.6} height={12.8} rx={0.8} fill="#4a4f56" stroke="#2e3237" strokeWidth={0.3} />
          <text x={34} y={11.2} fontSize={2} textAnchor="middle" fill="#2b2d31" fontFamily="Chakra Petch" fontWeight={700}>
            {inst.label} · Ø32×{Number(inst.props.stroke ?? 100)}
          </text>
          {/* reed switches a0 / a1 clamped on the profile */}
          {[
            [15.24, s0, "a0"],
            [50.8, s1, "a1"],
          ].map(([x, on, l]) => (
            <g key={String(l)}>
              <rect x={Number(x) - 4.6} y={13.8} width={9.2} height={2.6} rx={0.8} fill="#1f5fa8" stroke="#123d70" strokeWidth={0.2} />
              <IndicatorLed x={Number(x) + 3} y={15.1} on={Boolean(on)} color="#ff3b30" />
              <text x={Number(x) - 1.6} y={15.6} fontSize={1.3} textAnchor="middle" fill="#fff" fontFamily="Chakra Petch" fontWeight={700}>
                {String(l)}
              </text>
            </g>
          ))}
          <Ports def={def} />
        </g>
      );
    }
    case "multimeter": {
      const text = L.text ?? ["0.000", "V DC"];
      const mode = ["V DC", "mA DC", "A DC", "Ω", "•)))"].indexOf(text[1] ?? "");
      const ang = [-60, -20, -20, 20, 60][Math.max(0, mode)];
      return (
        <g>
          <rect x={0.4} y={1} width={40.64} height={76.2} rx={4} fill="#000" opacity={0.35} filter="url(#tc-soft)" />
          <rect width={40.64} height={76.2} rx={4} fill="#f2c419" stroke="#c9a10f" strokeWidth={0.4} />
          <rect x={3} y={3} width={34.64} height={70.2} rx={3} fill="#2a2c30" />
          <rect x={6} y={6} width={28.64} height={16} rx={1.2} fill="#b8c9a5" />
          <text x={32.6} y={17.6} fontSize={8} textAnchor="end" fill="#1d2a14" fontFamily="IBM Plex Mono" fontWeight={600}>
            {text[0]}
          </text>
          <text x={8} y={10.4} fontSize={2.2} fill="#1d2a14" fontFamily="IBM Plex Mono" fontWeight={600}>
            {text[1]}
          </text>
          {L.indicator && <circle cx={31.6} cy={9} r={1.2} fill="#e0352d" />}
          {["V", "A", "Ω", "•)))"].map((l, i) => {
            const a = ((-60 + i * 40 - 90) * Math.PI) / 180;
            return (
              <text key={l} x={20.32 + Math.cos(a) * 13} y={42 + Math.sin(a) * 13 + 0.6} fontSize={2} textAnchor="middle" fill="#f2f2f0" fontFamily="Chakra Petch" fontWeight={700}>
                {l}
              </text>
            );
          })}
          <circle cx={20.32} cy={42} r={9.4} fill="#141518" stroke="#55585f" strokeWidth={0.4} />
          <g transform={`rotate(${ang} 20.32 42)`}>
            <rect x={18.8} y={33.2} width={3} height={17.6} rx={1.4} fill="#3a3d44" />
            <path d="M20.32 33.8 l-1 2 h2 z" fill="#f2c419" />
          </g>
          <circle cx={12.7} cy={64} r={3.2} fill="#141518" stroke="#55585f" strokeWidth={0.3} />
          <circle cx={27.94} cy={64} r={3.2} fill="#141518" stroke="#e0352d" strokeWidth={0.6} />
          <text x={12.7} y={59.4} fontSize={1.6} textAnchor="middle" fill="#cfd3d8" fontFamily="Chakra Petch">
            COM
          </text>
          <text x={27.94} y={59.4} fontSize={1.6} textAnchor="middle" fill="#cfd3d8" fontFamily="Chakra Petch">
            VΩmA
          </text>
          <line x1={12.7} y1={64} x2={12.7} y2={71.12} stroke="#1b1b1b" strokeWidth={1.2} />
          <line x1={27.94} y1={64} x2={27.94} y2={71.12} stroke="#d6302a" strokeWidth={1.2} />
          <HeaderPins def={def} />
        </g>
      );
    }
    case "relay": {
      const on = !!L.on;
      return (
        <g>
          <Pcb w={50} h={26} color="#1d5fa8" />
          <rect x={14} y={3.2} width={19} height={15.6} rx={0.6} fill="#2b67d0" stroke="#174ca8" strokeWidth={0.3} />
          <text x={23.5} y={9} fontSize={1.6} textAnchor="middle" fill="#e8f0ff" fontFamily="Chakra Petch" fontWeight={700}>
            SRD-05VDC
          </text>
          <text x={23.5} y={12} fontSize={1.1} textAnchor="middle" fill="#cfe0ff" fontFamily="Chakra Petch">
            10A 250VAC
          </text>
          <rect x={41} y={4.5} width={8} height={17} rx={0.5} fill="#1e5bd6" stroke="#0f3a92" strokeWidth={0.3} />
          {[7.92, 13, 18.08].map((y) => (
            <circle key={y} cx={45} cy={y} r={1.6} fill="url(#tc-metal)" />
          ))}
          <g stroke={on ? "#7af0b4" : "#8b93a1"} strokeWidth={0.5} fill="none" opacity={0.8}>
            <path d={on ? "M37 13 L40 8.2" : "M37 13 L40 17.8"} />
          </g>
          <IndicatorLed x={8} y={6} on={!!L.powered} />
          <IndicatorLed x={8} y={20} on={on} color="#33ff88" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="right" />
        </g>
      );
    }
    case "dc-motor": {
      const sp = L.speed ?? 0;
      const rot = (t * 360 * 6 * sp) % 360;
      return (
        <g>
          <HeaderPins def={def} />
          <line x1={1.27} y1={7.46} x2={9} y2={8.5} stroke="#d8302a" strokeWidth={0.7} />
          <line x1={1.27} y1={12.54} x2={9} y2={11.5} stroke="#222" strokeWidth={0.7} />
          <circle cx={19.5} cy={10} r={9.5} fill="url(#tc-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <g transform={`rotate(${rot} 19.5 10)`} opacity={0.9}>
            {[0, 120, 240].map((a) => (
              <path key={a} transform={`rotate(${a} 19.5 10)`} d="M19.5 10 C 21 6, 24 3.5, 22.5 1.5 C 20 2, 18.6 6, 19.5 10 Z" fill="#fbbf24" opacity={0.55} />
            ))}
            <circle cx={19.5} cy={10} r={1.5} fill="#333" />
          </g>
        </g>
      );
    }
    case "lcd1602": {
      const lines = L.text ?? ["", ""];
      const lit = !!L.backlight && !!L.powered;
      return (
        <g>
          <Pcb w={80} h={36} color="#1f6b3a" />
          {[2.5, 77.5].flatMap((x) => [2.5, 33.5].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.4} fill="#0b0f0d" stroke="#c8a044" strokeWidth={0.5} />))}
          <rect x={4.5} y={5.5} width={71} height={25} rx={1} fill="#0b0d0e" />
          <rect x={7.5} y={9} width={65} height={18} fill={lit ? "#8fd14f" : "#3b4a2c"} />
          {lit && <rect x={7.5} y={9} width={65} height={18} fill="#c8ff7a" opacity={0.15} filter="url(#tc-glow)" />}
          <g fontFamily="IBM Plex Mono, monospace" fontSize={5.2} fill={lit ? "#10240a" : "#1c2a14"}>
            {[0, 1].map((r) => (
              <g key={r}>
                {Array.from({ length: 16 }, (_, c) => (
                  <g key={c}>
                    <rect x={8.6 + c * 3.95} y={10.2 + r * 8.3} width={3.5} height={7.3} fill="#000" opacity={0.05} />
                    <text x={8.6 + c * 3.95 + 1.75} y={16.2 + r * 8.3} textAnchor="middle">
                      {(lines[r] ?? "")[c] === "ß" ? "°" : (lines[r] ?? "")[c] === String.fromCharCode(223) ? "°" : (lines[r] ?? "")[c] ?? ""}
                    </text>
                  </g>
                ))}
              </g>
            ))}
          </g>
          <rect x={-3.5} y={11.5} width={6} height={13} fill="#14161a" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="right" color="#e8f5ea" />
        </g>
      );
    }
    case "neopixel-ring": {
      const n = Number(inst.props.count ?? 12);
      const px = L.pixels ?? [];
      return (
        <g>
          <circle cx={18.5} cy={18.5} r={18.3} fill="#141518" stroke="rgba(255,255,255,.18)" strokeWidth={0.25} />
          <circle cx={18.5} cy={18.5} r={11.5} fill="var(--canvas-bg)" />
          <rect x={12.5} y={35} width={12} height={7} rx={1} fill="#141518" />
          {Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = 18.5 + Math.cos(a) * 15;
            const y = 18.5 + Math.sin(a) * 15;
            const c = px[i] ?? 0;
            const r = (c >> 16) & 255;
            const g = (c >> 8) & 255;
            const b = c & 255;
            const on = r + g + b > 10;
            const col = `rgb(${r},${g},${b})`;
            return (
              <g key={i}>
                {on && <circle cx={x} cy={y} r={4.5} fill={col} opacity={0.6} filter="url(#tc-glow)" />}
                <rect x={x - 2.5} y={y - 2.5} width={5} height={5} rx={0.5} fill={on ? col : "#efefe9"} transform={`rotate(${(a * 180) / Math.PI} ${x} ${y})`} />
              </g>
            );
          })}
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    }
    case "breadboard":
      return <Breadboard cols={Number(inst.props.cols ?? 30)} rails={inst.props.rails !== false} />;
    case "perfboard":
      return <Perfboard cols={Number(inst.props.cols ?? 24)} rows={Number(inst.props.rows ?? 18)} kind={String(inst.props.kind ?? "perfboard")} finish={String(inst.props.finish ?? "fr4")} />;
    default:
      if (def.custom) {
        const c = def.custom;
        return (
          <g>
            <Pcb w={def.w} h={def.h} color={c.color || "#1d5fa8"} />
            <rect x={def.w / 2 - 4} y={2.5} width={8} height={Math.max(4, def.h - 10)} rx={0.6} fill="#151618" />
            <text x={def.w / 2} y={def.h - 4.6} fontSize={1.6} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch" fontWeight={700}>
              {c.model || c.name}
            </text>
            <IndicatorLed x={3} y={3} on={!!L.powered} />
            <IndicatorLed x={3} y={6} on={!!L.indicator} color="#33ff88" />
            <HeaderPins def={def} />
            <PinLabels def={def} side="top" />
          </g>
        );
      }
      return <rect width={def.w} height={def.h} fill="#333" />;
  }
});

function Smoke({ x, y, t }: { x: number; y: number; t: number }) {
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const k = (t * 0.6 + i / 3) % 1;
        return <circle key={i} cx={x + Math.sin(k * 6 + i) * 1.5} cy={y - k * 10} r={1 + k * 2.5} fill="#8a8f94" opacity={(1 - k) * 0.5} />;
      })}
    </g>
  );
}

const Breadboard = memo(function Breadboard({ cols, rails }: { cols: number; rails: boolean }) {
  const L = layoutBreadboard({ cols, rails });
  const W = L.w;
  const H = L.h;
  const P = 2.54;
  const top = rails ? 4 : 1;
  const holeRows = L.pins.filter((p) => !/^(t|b)[np]/.test(p.id));
  const railPins = L.pins.filter((p) => /^(t|b)[np]/.test(p.id));
  return (
    <g>
      <rect x={0.5} y={1} width={W} height={H} rx={1.5} fill="#000" opacity={0.25} filter="url(#tc-soft)" />
      <rect width={W} height={H} rx={1.5} fill="#f1efe6" stroke="#d6d2c2" strokeWidth={0.3} />
      <rect x={1} y={P * (top + 4.6)} width={W - 2} height={P * 1.8} fill="#dcd8ca" />
      {["tn", "tp", "bp", "bn"].map((id) => {
        const first = railPins.find((p) => p.id === `${id}1`);
        if (!first) return null;
        const y = first.y + (id === "tn" || id === "bp" ? -1.15 : 1.15);
        return <line key={id} x1={3} x2={W - 3} y1={y} y2={y} stroke={id.endsWith("n") ? "#2f6fe0" : "#e5322d"} strokeWidth={0.35} opacity={0.75} />;
      })}
      {[...holeRows, ...railPins].map((p) => (
        <rect key={p.id} x={p.x - 0.55} y={p.y - 0.55} width={1.1} height={1.1} rx={0.15} fill="#3a3a36" />
      ))}
      <g fontSize={1.1} fill="#8d8a7e" fontFamily="Chakra Petch" textAnchor="middle">
        {Array.from({ length: cols }, (_, i) => i + 1)
          .filter((c) => c === 1 || c % 5 === 0)
          .map((c) => (
            <text key={c} x={P * (c + 1)} y={P * (top - 0.65)}>
              {c}
            </text>
          ))}
        {BB_ROWS.map((r, i) => (
          <text key={r} x={P * 0.85} y={P * (i < 5 ? top + i : top + 2 + i) + 0.4}>
            {r}
          </text>
        ))}
      </g>
    </g>
  );
});

const PERF_FINISH: Record<string, { board: string; edge: string; pad: string; text: string }> = {
  fr4: { board: "#1f6e43", edge: "#2c8a57", pad: "#d9dcde", text: "#cfe6d8" },
  phenolic: { board: "#b98a4b", edge: "#a77a3e", pad: "#d89a5b", text: "#5b3d17" },
  "fr4-white": { board: "#eceae4", edge: "#d6d3ca", pad: "#c9cdd1", text: "#6b6a65" },
};

const Perfboard = memo(function Perfboard({ cols, rows, kind, finish }: { cols: number; rows: number; kind: string; finish: string }) {
  const L = layoutPerfboard({ cols, rows, kind });
  const f = PERF_FINISH[finish] ?? PERF_FINISH.fr4;
  const P = 2.54;
  const pid = `pf-${finish}`;
  return (
    <g>
      <defs>
        <pattern id={pid} width={P} height={P} patternUnits="userSpaceOnUse" x={P / 2} y={P / 2}>
          <circle cx={P / 2} cy={P / 2} r={0.88} fill={f.pad} />
          <circle cx={P / 2} cy={P / 2} r={0.42} fill="#151515" />
        </pattern>
      </defs>
      <rect x={0.5} y={1} width={L.w} height={L.h} rx={1} fill="#000" opacity={0.25} filter="url(#tc-soft)" />
      <rect width={L.w} height={L.h} rx={1} fill={f.board} stroke={f.edge} strokeWidth={0.3} />
      {kind === "stripboard" &&
        Array.from({ length: rows }, (_, r) => <rect key={r} x={P * 0.55} y={P * (r + 1) - 0.95} width={L.w - P * 1.1} height={1.9} rx={0.3} fill={f.pad} opacity={0.38} />)}
      <rect x={P / 2} y={P / 2} width={P * cols} height={P * rows} fill={`url(#${pid})`} />
      <g fontSize={0.95} fill={f.text} fontFamily="Chakra Petch" textAnchor="middle" opacity={0.85}>
        {Array.from({ length: cols }, (_, i) => i + 1)
          .filter((c) => c === 1 || c % 5 === 0)
          .map((c) => (
            <text key={`c${c}`} x={P * c} y={1.6}>
              {c}
            </text>
          ))}
        {Array.from({ length: rows }, (_, i) => i + 1)
          .filter((r) => r === 1 || r % 5 === 0)
          .map((r) => (
            <text key={`r${r}`} x={1.1} y={P * r + 0.35}>
              {r}
            </text>
          ))}
      </g>
    </g>
  );
});
