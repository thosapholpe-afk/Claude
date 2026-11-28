import { useId } from "react";

/** Stacked-diamond mark: a lit board (dot grid) over its layered twin. */
export function LogoMark({ size = 30, animated = true }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, "");
  const dots: [number, number][] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) dots.push([20 + (c - r) * 3.1, 9.2 + (c + r) * 3.1]);
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden className={`logo-mark ${animated ? "anim" : ""}`}>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3d8bff" />
          <stop offset="0.5" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#a5b4fc" />
        </linearGradient>
      </defs>
      <path d="M20 3.5 L32.5 16 L20 28.5 L7.5 16 Z" fill="none" stroke={`url(#lg${id})`} strokeWidth="1.9" strokeLinejoin="round" />
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y + 0.5} r="0.95" fill={`url(#lg${id})`} style={{ animationDelay: `${(i % 3) * 0.18 + Math.floor(i / 3) * 0.18}s` }} />
      ))}
      <path d="M7.5 22 L20 34.5 L32.5 22" fill="none" stroke={`url(#lg${id})`} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      <path d="M8.5 28.6 L20 39 L31.5 28.6" fill="none" stroke={`url(#lg${id})`} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.01 2.6" opacity="0.8" />
    </svg>
  );
}

export function Brand({ size = 30 }: { size?: number }) {
  return (
    <div className="brand">
      <LogoMark size={size} />
      <span className="wordmark">Thosaphol Connect</span>
    </div>
  );
}
