/**
 * Loopy — the studio's mascot: an infinity-loop body with eyes in the loops, little
 * arms gripping the top of a button and feet poking out underneath. It peeks out
 * from behind whatever it wraps, looks left and right, blinks and taps its feet.
 */
import type { ReactNode } from "react";

const BODY = "#00979d";
const DARK = "#0b3d40";

/** Wraps a button: the mascot stands behind it, hands on its top edge. */
export function MascotCta({ children }: { children: ReactNode }) {
  return (
    <div className="np-cta">
      <svg className="lb lb-back" viewBox="0 0 150 160" aria-hidden>
        {/* legs + shoes (the button hides the middle of the legs) */}
        <g className="lb-legs" stroke={BODY} strokeWidth={6} strokeLinecap="round" fill="none">
          <path d="M62 70 V140" />
          <path d="M88 70 V140" />
        </g>
        <g className="lb-feet">
          <ellipse className="lb-foot l" cx={58} cy={146} rx={10} ry={6} fill={DARK} />
          <ellipse className="lb-foot r" cx={92} cy={146} rx={10} ry={6} fill={DARK} />
        </g>
        {/* arms reach down to the button's top edge */}
        <g stroke={BODY} strokeWidth={6} strokeLinecap="round" fill="none">
          <path className="lb-arm l" d="M32 56 C 18 64, 17 76, 26 84" />
          <path className="lb-arm r" d="M118 56 C 132 64, 133 76, 124 84" />
        </g>
        {/* the head: an infinity loop with eyes in its loops */}
        <g className="lb-head">
          <path d="M75 50 C 68 35, 33 31, 32 50 C 31 69, 67 66, 75 50 C 83 34, 118 31, 118 50 C 118 69, 83 66, 75 50 Z" fill="none" stroke={BODY} strokeWidth={11} strokeLinejoin="round" />
          <circle cx={53} cy={50} r={11.5} fill="#fff" />
          <circle cx={97} cy={50} r={11.5} fill="#fff" />
          <g className="lb-pupils">
            <circle cx={53} cy={51} r={5.4} fill={DARK} />
            <circle cx={97} cy={51} r={5.4} fill={DARK} />
            <circle cx={55} cy={48.6} r={1.7} fill="#fff" />
            <circle cx={99} cy={48.6} r={1.7} fill="#fff" />
          </g>
          <g className="lb-lids" fill={BODY}>
            <ellipse cx={53} cy={50} rx={12} ry={12} />
            <ellipse cx={97} cy={50} rx={12} ry={12} />
          </g>
          {/* − and + on the loops */}
          <g stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
            <path d="M48 31.5 H58" />
            <path d="M92 31.5 H102 M97 26.5 V36.5" />
          </g>
          <ellipse cx={42} cy={66} rx={5} ry={2.6} fill="#ff8fa3" opacity={0.75} />
          <ellipse cx={108} cy={66} rx={5} ry={2.6} fill="#ff8fa3" opacity={0.75} />
          <path d="M70 61 Q75 67 80 61" stroke={DARK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
        </g>
      </svg>
      {children}
      <svg className="lb lb-front" viewBox="0 0 150 160" aria-hidden>
        {/* hands gripping the edge, in front of the button */}
        <g fill={BODY} stroke={DARK} strokeWidth={1.2}>
          <circle className="lb-hand l" cx={26} cy={86} r={7} />
          <circle className="lb-hand r" cx={124} cy={86} r={7} />
        </g>
        <g stroke={DARK} strokeWidth={1.1} strokeLinecap="round">
          <path d="M23 88 v3 M26 88.5 v3 M29 88 v3" />
          <path d="M121 88 v3 M124 88.5 v3 M127 88 v3" />
        </g>
      </svg>
    </div>
  );
}
