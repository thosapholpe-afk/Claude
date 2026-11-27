import { memo } from "react";
import type { BoardDef, BoardPin, Connector } from "../../core/types";

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

/** Group pins into straight header strips for drawing the black plastic housing. */
function headerStrips(pins: BoardPin[]) {
  const strips: { x: number; y: number; w: number; h: number }[] = [];
  const byRow = new Map<string, BoardPin[]>();
  for (const p of pins) {
    const k = p.y.toFixed(2);
    byRow.set(k, [...(byRow.get(k) ?? []), p]);
  }
  for (const row of byRow.values()) {
    row.sort((a, b) => a.x - b.x);
    let start = row[0];
    let prev = row[0];
    for (let i = 1; i <= row.length; i++) {
      const p = row[i];
      if (!p || Math.abs(p.x - prev.x - 2.54) > 0.05) {
        strips.push({ x: start.x - 1.27, y: start.y - 1.27, w: prev.x - start.x + 2.54, h: 2.54 });
        if (p) start = p;
      }
      if (p) prev = p;
    }
  }
  return strips;
}

function ConnectorShape({ c }: { c: Connector }) {
  const metal = "url(#tc-metal)";
  switch (c.kind) {
    case "usb-b":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.6} fill={metal} stroke="#7d8790" strokeWidth={0.25} />
          <rect x={c.x + 1.5} y={c.y + 2.2} width={4.5} height={c.h - 4.4} rx={0.4} fill="#2a2e33" />
          <rect x={c.x + 2.4} y={c.y + 4} width={2.6} height={c.h - 8} fill="#e8ebee" />
        </g>
      );
    case "usb-micro":
    case "usb-c":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={c.kind === "usb-c" ? 1.6 : 0.6} fill={metal} stroke="#7d8790" strokeWidth={0.2} />
          <rect x={c.x + 0.5} y={c.y + 1.4} width={1.4} height={c.h - 2.8} rx={0.5} fill="#22262a" />
        </g>
      );
    case "barrel":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.8} fill="#1b1d20" stroke="#000" strokeWidth={0.2} />
          <circle cx={c.x + 2.2} cy={c.y + c.h / 2} r={3.1} fill="#0b0c0d" />
          <circle cx={c.x + 2.2} cy={c.y + c.h / 2} r={0.9} fill="#c9ced3" />
        </g>
      );
    case "rj45":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.5} fill={metal} stroke="#7d8790" strokeWidth={0.25} />
          <rect x={c.x + c.w - 6} y={c.y + 3} width={5} height={c.h - 6} fill="#26292d" />
          <circle cx={c.x + 3} cy={c.y + 3} r={1} fill="#d6ff6a" opacity={0.85} />
          <circle cx={c.x + 3} cy={c.y + c.h - 3} r={1} fill="#ffb347" opacity={0.85} />
        </g>
      );
    case "usb-a":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.5} fill={metal} stroke="#7d8790" strokeWidth={0.25} />
          <rect x={c.x + c.w - 7} y={c.y + 2.2} width={6} height={4} fill={c.label.includes("3.0") ? "#1f6fe0" : "#202326"} />
          <rect x={c.x + c.w - 7} y={c.y + c.h - 6.2} width={6} height={4} fill={c.label.includes("3.0") ? "#1f6fe0" : "#202326"} />
        </g>
      );
    case "hdmi-micro":
      return <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.5} fill={metal} stroke="#7d8790" strokeWidth={0.2} />;
    case "audio":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h - 3} rx={0.6} fill="#17191b" />
          <circle cx={c.x + c.w / 2} cy={c.y + c.h - 4} r={2.6} fill="#0a0a0a" stroke="#333" strokeWidth={0.3} />
        </g>
      );
    case "button":
      return (
        <g>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.4} fill={metal} stroke="#6f7880" strokeWidth={0.2} />
          <circle cx={c.x + c.w / 2} cy={c.y + c.h / 2} r={Math.min(c.w, c.h) * 0.3} fill="#1a1c1f" />
        </g>
      );
    case "header":
      return <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#151719" />;
    case "sd":
      return <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.6} fill={metal} opacity={0.55} stroke="#7d8790" strokeWidth={0.2} strokeDasharray="0.8 0.6" />;
    case "antenna": {
      const pts: string[] = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const y = c.y + 1.5 + (i * (c.h - 3)) / steps;
        pts.push(`${c.x + (i % 2 ? c.w - 1 : 1)},${y}`);
      }
      return <polyline points={pts.join(" ")} fill="none" stroke="#d8b25a" strokeWidth={0.55} strokeLinejoin="round" opacity={0.9} />;
    }
    default:
      return null;
  }
}

export const Board2D = memo(function Board2D({
  board,
  powered,
  ledOn,
  showLabels = true,
}: {
  board: BoardDef;
  powered: boolean;
  ledOn: boolean;
  showLabels?: boolean;
}) {
  const W = board.width;
  const H = board.height;
  const strips = headerStrips(board.pins);
  const edgeY = (p: BoardPin) => (p.y < H / 2 ? "top" : "bottom");
  return (
    <g>
      <defs>
        <linearGradient id={`pcb-${board.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(board.pcbColor, 18)} />
          <stop offset="1" stopColor={shade(board.pcbColor, -14)} />
        </linearGradient>
      </defs>
      <rect x={0.6} y={1.4} width={W} height={H} rx={2.2} fill="#000" opacity={0.35} filter="url(#tc-soft)" />
      <rect x={0} y={0} width={W} height={H} rx={board.family === "bcm2711" ? 3 : 1.6} fill={`url(#pcb-${board.id})`} stroke={shade(board.pcbColor, 35)} strokeWidth={0.3} />
      {/* fine traces for texture */}
      <g opacity={0.16} stroke={shade(board.pcbColor, 60)} strokeWidth={0.25} fill="none">
        {Array.from({ length: 7 }, (_, i) => (
          <path key={i} d={`M ${W * 0.18 + i * 3.2} ${H * 0.25} v ${H * 0.18} l 3 3 h ${W * 0.12}`} />
        ))}
      </g>
      {board.holes.map((h, i) => (
        <g key={i}>
          <circle cx={h.x} cy={h.y} r={h.d / 2 + 0.9} fill="#c8a044" />
          <circle cx={h.x} cy={h.y} r={h.d / 2} fill="#0b0f0d" />
        </g>
      ))}
      {board.chips.map((c, i) => (
        <g key={i}>
          <rect x={c.x + 0.3} y={c.y + 0.5} width={c.w} height={c.h} rx={0.5} fill="#000" opacity={0.3} />
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={c.metal ? 0.6 : 0.4} fill={c.metal ? "url(#tc-metal)" : c.color} stroke={c.metal ? "#8c959d" : "#000"} strokeWidth={0.2} />
          {board.id === "esp32-devkit-v1" && i === 0 && (
            <g>
              <rect x={c.x + 0.6} y={c.y + 0.6} width={c.w - 6.5} height={c.h - 1.2} rx={0.4} fill="#c3c7cc" stroke="#9aa1a8" strokeWidth={0.15} />
              <text x={c.x + (c.w - 6.5) / 2 + 0.6} y={c.y + c.h / 2 + 0.6} fontSize={1.5} textAnchor="middle" fill="#4b5157" fontFamily="IBM Plex Mono, monospace">
                ESP-WROOM-32
              </text>
            </g>
          )}
          {!(board.id === "esp32-devkit-v1" && i === 0) && (
            <text x={c.x + c.w / 2} y={c.y + c.h / 2 + 0.55} fontSize={Math.min(1.6, c.h * 0.32)} textAnchor="middle" fill={c.metal ? "#4b5157" : "#8d939a"} fontFamily="IBM Plex Mono, monospace">
              {c.label}
            </text>
          )}
          {!c.metal && c.w > 20 && (
            <circle cx={c.x + 1.6} cy={c.y + c.h / 2} r={0.7} fill="#2c2f33" />
          )}
        </g>
      ))}
      {board.connectors.map((c) => (
        <ConnectorShape key={c.id} c={c} />
      ))}
      {strips.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={0.3} fill="#131416" stroke="#050505" strokeWidth={0.15} />
      ))}
      {board.pins.map((p) => (
        <rect key={p.id} x={p.x - 0.42} y={p.y - 0.42} width={0.84} height={0.84} fill="url(#tc-gold)" />
      ))}
      {showLabels &&
        board.pins.map((p) => {
          const top = edgeY(p) === "top";
          const y = top ? p.y + 1.9 : p.y - 1.9;
          return (
            <text
              key={`l${p.id}`}
              x={p.x}
              y={y}
              fontSize={1.05}
              fill={board.silkColor}
              fontFamily="Chakra Petch, sans-serif"
              fontWeight={600}
              textAnchor={top ? "end" : "start"}
              transform={`rotate(-90 ${p.x} ${y})`}
              dominantBaseline="middle"
              opacity={0.92}
            >
              {p.label}
            </text>
          );
        })}
      {/* name & status LEDs */}
      <text
        x={board.family === "avr" ? W * 0.52 : board.family === "bcm2711" ? W * 0.12 : W * 0.32}
        y={board.family === "avr" ? H * 0.52 : board.family === "bcm2711" ? H * 0.82 : H * 0.62}
        fontSize={board.family === "avr" ? 5.5 : board.family === "bcm2711" ? 2.8 : 1.9}
        fill={board.silkColor}
        fontFamily="Chakra Petch, sans-serif"
        fontWeight={700}
        opacity={0.95}
        letterSpacing={board.family === "avr" ? 0.6 : 0.1}
      >
        {board.family === "avr" ? "UNO R3" : board.family === "bcm2711" ? "Raspberry Pi 4 Model B" : board.family === "rp2040" ? "Pico" : "ESP32 DEVKIT V1"}
      </text>
      <StatusLed x={board.family === "avr" ? 52 : board.family === "rp2040" ? 6.2 : board.family === "bcm2711" ? 2.6 : 10.8} y={board.family === "avr" ? 20 : board.family === "rp2040" ? 4.3 : board.family === "bcm2711" ? 47 : 5.2} color="#ff3b30" on={powered} label="PWR" />
      {board.family !== "bcm2711" && (
        <StatusLed x={board.family === "avr" ? 52 : board.family === "rp2040" ? 6.2 : 10.8} y={board.family === "avr" ? 23.6 : board.family === "rp2040" ? 16.6 : 22.6} color={board.family === "esp32" ? "#2f8bff" : "#7cff5b"} on={ledOn} label={board.family === "avr" ? "L" : "LED"} />
      )}
      {board.family === "bcm2711" && <StatusLed x={2.6} y={51} color="#7cff5b" on={powered && ledOn} label="ACT" />}
    </g>
  );
});

function StatusLed({ x, y, color, on, label }: { x: number; y: number; color: string; on: boolean; label: string }) {
  return (
    <g>
      {on && <circle cx={x} cy={y} r={3.2} fill={color} opacity={0.35} filter="url(#tc-glow)" />}
      <rect x={x - 0.8} y={y - 0.5} width={1.6} height={1} rx={0.2} fill={on ? color : "#5b4a3e"} />
      <text x={x + 1.4} y={y + 0.45} fontSize={0.9} fill="#e9efe9" opacity={0.75} fontFamily="Chakra Petch, sans-serif">
        {label}
      </text>
    </g>
  );
}

/** Shared SVG defs (gradients, glows). Render once inside every canvas <svg>. */
export function SvgDefs() {
  return (
    <defs>
      <linearGradient id="tc-metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#eef1f4" />
        <stop offset="0.45" stopColor="#b7bec5" />
        <stop offset="0.7" stopColor="#dfe3e7" />
        <stop offset="1" stopColor="#8f979f" />
      </linearGradient>
      <linearGradient id="tc-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffe9a6" />
        <stop offset="0.5" stopColor="#d6a93c" />
        <stop offset="1" stopColor="#a57a1f" />
      </linearGradient>
      <radialGradient id="tc-dome" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#fff" stopOpacity={0.75} />
        <stop offset="0.35" stopColor="#fff" stopOpacity={0.12} />
        <stop offset="1" stopColor="#000" stopOpacity={0.15} />
      </radialGradient>
      <filter id="tc-glow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
      <filter id="tc-glow-lg" x="-300%" y="-300%" width="700%" height="700%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id="tc-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
      <pattern id="tc-mesh" width="0.9" height="0.9" patternUnits="userSpaceOnUse">
        <rect width="0.9" height="0.9" fill="#c4cad0" />
        <circle cx="0.45" cy="0.45" r="0.28" fill="#6d757c" />
      </pattern>
      <pattern id="tc-vents" width="1.6" height="1.6" patternUnits="userSpaceOnUse">
        <rect width="1.6" height="1.6" fill="#f3f3ef" />
        <rect x="0.35" y="0.35" width="0.9" height="0.9" rx="0.15" fill="#c9cbc4" />
      </pattern>
    </defs>
  );
}
