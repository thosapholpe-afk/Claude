import { memo, type ReactNode } from "react";
import { LED_HEX, type PartDef, type PartLive } from "../../core/parts";
import { BB_ROWS } from "../../core/parts";
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
          <rect x={p.x - 0.4} y={p.y - 0.4} width={0.8} height={0.8} fill="url(#xt-gold)" />
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
      <rect x={0.4} y={0.8} width={w} height={h} rx={rx} fill="#000" opacity={0.3} filter="url(#xt-soft)" />
      <rect width={w} height={h} rx={rx} fill={color} stroke="rgba(255,255,255,.18)" strokeWidth={0.25} />
    </g>
  );
}

function IndicatorLed({ x, y, on, color = "#ff3b30" }: { x: number; y: number; on: boolean; color?: string }) {
  return (
    <g>
      {on && <circle cx={x} cy={y} r={2.6} fill={color} opacity={0.55} filter="url(#xt-glow)" />}
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
              <circle cx={2.54} cy={3.3} r={8 + b * 5} fill={color} opacity={Math.min(0.55, b * 0.45)} filter="url(#xt-glow-lg)" />
              <circle cx={2.54} cy={3.3} r={4.2} fill={color} opacity={Math.min(0.9, b * 0.8)} filter="url(#xt-glow)" />
            </>
          )}
          <rect x={0.04} y={6.4} width={5} height={1.1} rx={0.3} fill={L.burnt ? "#3a2a20" : color} opacity={0.85} />
          <path d="M0.3 6.6 V3.2 A2.24 2.24 0 0 1 4.78 3.2 V6.6 Z" fill={L.burnt ? "#3b2b22" : color} opacity={L.burnt ? 1 : 0.55 + Math.min(0.45, b * 0.45)} />
          <path d="M0.3 6.6 V3.2 A2.24 2.24 0 0 1 4.78 3.2 V6.6 Z" fill="url(#xt-dome)" />
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
          {b > 0.02 && <circle cx={5.08} cy={3.6} r={9} fill={c} opacity={Math.min(0.6, b * 0.5)} filter="url(#xt-glow-lg)" />}
          <path d="M2.3 7.2 V3.7 A2.78 2.78 0 0 1 7.86 3.7 V7.2 Z" fill={b > 0.02 ? c : "#eef0f2"} opacity={0.9} />
          <path d="M2.3 7.2 V3.7 A2.78 2.78 0 0 1 7.86 3.7 V7.2 Z" fill="url(#xt-dome)" />
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
          <rect x={0.9} y={0.9} width={5.8} height={5.8} rx={0.5} fill="url(#xt-metal)" opacity={0.6} />
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
              <circle cx={cx} cy={9} r={8} fill="url(#xt-metal)" stroke="#7d8790" strokeWidth={0.3} />
              <circle cx={cx} cy={9} r={6.2} fill="url(#xt-mesh)" />
              <text x={cx} y={18.6} fontSize={1.4} fill="#fff" textAnchor="middle" fontFamily="Chakra Petch">
                {i ? "R" : "T"}
              </text>
            </g>
          ))}
          <rect x={20.5} y={2} width={4} height={2} rx={0.6} fill="url(#xt-metal)" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="top" />
        </g>
      );
    case "dht22":
      return (
        <g>
          <Legs pins={def.pins} top={20} />
          <rect x={0.1} y={0} width={15.1} height={20} rx={1.2} fill="#f3f3ef" stroke="#c8c8bf" strokeWidth={0.25} />
          <rect x={1.2} y={1.2} width={12.9} height={12.6} fill="url(#xt-vents)" />
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
          <circle cx={16} cy={9.5} r={8.6} fill="url(#xt-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <circle cx={16} cy={9.5} r={6.8} fill="url(#xt-mesh)" />
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
          <rect x={2} y={3.5} width={11} height={7} rx={3.5} fill="url(#xt-metal)" stroke="#7d8790" strokeWidth={0.3} />
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
          <circle cx={-0.5} cy={7.5} r={4.8} fill="url(#xt-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <circle cx={-0.5} cy={7.5} r={3.6} fill="#1c1d20" />
          <TrimPot x={11} y={7.5} />
          <rect x={17} y={4.8} width={5} height={5.4} rx={0.3} fill="#1b1d20" />
          <IndicatorLed x={26} y={3.6} on={!!L.powered} />
          <IndicatorLed x={26} y={11.4} on={!!L.indicator} color="#33ff88" />
          <HeaderPins def={def} />
          <PinLabels def={def} side="left" />
        </g>
      );
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
            <circle key={y} cx={45} cy={y} r={1.6} fill="url(#xt-metal)" />
          ))}
          <g stroke={on ? "#3dffa8" : "#f4f4f4"} strokeWidth={0.5} fill="none" opacity={0.8}>
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
          <circle cx={19.5} cy={10} r={9.5} fill="url(#xt-metal)" stroke="#7d8790" strokeWidth={0.3} />
          <g transform={`rotate(${rot} 19.5 10)`} opacity={0.9}>
            {[0, 120, 240].map((a) => (
              <path key={a} transform={`rotate(${a} 19.5 10)`} d="M19.5 10 C 21 6, 24 3.5, 22.5 1.5 C 20 2, 18.6 6, 19.5 10 Z" fill="#3dffa8" opacity={0.55} />
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
          {lit && <rect x={7.5} y={9} width={65} height={18} fill="#c8ff7a" opacity={0.15} filter="url(#xt-glow)" />}
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
                {on && <circle cx={x} cy={y} r={4.5} fill={col} opacity={0.6} filter="url(#xt-glow)" />}
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
      return <Breadboard def={def} />;
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

const Breadboard = memo(function Breadboard({ def }: { def: PartDef }) {
  const W = def.w;
  const H = def.h;
  return (
    <g>
      <rect x={0.5} y={1} width={W} height={H} rx={1.5} fill="#000" opacity={0.25} filter="url(#xt-soft)" />
      <rect width={W} height={H} rx={1.5} fill="#f1efe6" stroke="#d6d2c2" strokeWidth={0.3} />
      <rect x={1} y={2.54 * 9.2} width={W - 2} height={2.54 * 0.6 + 2.6} fill="#dcd8ca" />
      {[
        [2.54 * 0.55, "#2f6fe0"],
        [2.54 * 2.45, "#e5322d"],
        [2.54 * 16.55, "#e5322d"],
        [2.54 * 18.45, "#2f6fe0"],
      ].map(([y, c], i) => (
        <line key={i} x1={3} x2={W - 3} y1={Number(y)} y2={Number(y)} stroke={String(c)} strokeWidth={0.35} opacity={0.75} />
      ))}
      {def.pins.map((p) => (
        <rect key={p.id} x={p.x - 0.55} y={p.y - 0.55} width={1.1} height={1.1} rx={0.15} fill="#3a3a36" />
      ))}
      <g fontSize={1.1} fill="#8d8a7e" fontFamily="Chakra Petch" textAnchor="middle">
        {Array.from({ length: 30 }, (_, i) => i + 1)
          .filter((c) => c === 1 || c % 5 === 0)
          .map((c) => (
            <text key={c} x={2.54 * (c + 1)} y={2.54 * 3.35}>
              {c}
            </text>
          ))}
        {BB_ROWS.map((r, i) => (
          <text key={r} x={2.54 * 0.85} y={2.54 * (i < 5 ? 4 + i : 6 + i) + 0.4}>
            {r}
          </text>
        ))}
      </g>
    </g>
  );
});
