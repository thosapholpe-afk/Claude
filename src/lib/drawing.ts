import { boardLook } from "../core/boards";
import type { BoardDef } from "../core/types";
import type { PartDef } from "../core/parts";

/** A neutral description of a footprint used for both SVG and DXF drawings. */
export interface DrawingSpec {
  title: string;
  subtitle: string;
  width: number;
  height: number;
  thickness: number;
  maxZ: number;
  corner: number;
  holes: { x: number; y: number; d: number }[];
  rects: { x: number; y: number; w: number; h: number; label: string; z?: number }[];
  pins: { x: number; y: number; label: string }[];
}

export function specFromBoard(b: BoardDef): DrawingSpec {
  return {
    title: b.name,
    subtitle: `${b.mcu} · ${b.logicV} V logic`,
    width: b.width,
    height: b.height,
    thickness: b.thickness,
    maxZ: b.maxComponentZ,
    corner: boardLook(b).radius ?? 1.6,
    holes: b.holes,
    rects: b.connectors.filter((c) => c.kind !== "antenna").map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, label: c.label, z: c.z })),
    pins: b.pins.map((p) => ({ x: p.x, y: p.y, label: p.label })),
  };
}

export function specFromPart(def: PartDef): DrawingSpec {
  return {
    title: def.name,
    subtitle: def.description,
    width: def.w,
    height: def.h,
    thickness: 1.6,
    maxZ: def.h3,
    corner: 1,
    holes: [],
    rects: [],
    pins: def.pins.filter(() => !def.host).map((p) => ({ x: p.x, y: p.y, label: p.label })),
  };
}

const f1 = (n: number) => (Math.round(n * 100) / 100).toString();

/** Dimensioned drawing in true millimetres (prints 1:1 at 100 %). */
export function drawingSvg(s: DrawingSpec, opts: { showPins?: boolean } = {}): string {
  const M = 22; // margin for dimensions
  const sideGap = 18;
  const sideH = Math.max(s.thickness + s.maxZ, 4);
  const W = s.width + M * 2 + 60;
  const H = s.height + M * 2 + sideGap + sideH + 34;
  const x0 = M + 8;
  const y0 = M;
  const ink = "#111";
  const dim = "#0a6cff";
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  out.push(`<defs><marker id="a" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 z" fill="${dim}"/></marker></defs>`);
  // outline
  out.push(`<rect x="${x0}" y="${y0}" width="${s.width}" height="${s.height}" rx="${s.corner}" fill="none" stroke="${ink}" stroke-width="0.35"/>`);
  // connectors (dashed where they overhang)
  for (const r of s.rects) out.push(`<rect x="${x0 + r.x}" y="${y0 + r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#555" stroke-width="0.2" stroke-dasharray="1 0.6"/><text x="${x0 + r.x + r.w / 2}" y="${y0 + r.y + r.h / 2 + 0.8}" font-size="1.8" text-anchor="middle" fill="#555">${esc(r.label)}</text>`);
  if (opts.showPins !== false) for (const p of s.pins) out.push(`<circle cx="${x0 + p.x}" cy="${y0 + p.y}" r="0.5" fill="none" stroke="#777" stroke-width="0.15"/>`);
  // holes with centre marks
  for (const h of s.holes) {
    out.push(`<circle cx="${x0 + h.x}" cy="${y0 + h.y}" r="${h.d / 2}" fill="none" stroke="${ink}" stroke-width="0.3"/>`);
    out.push(`<path d="M${x0 + h.x - h.d} ${y0 + h.y} h${h.d * 2} M${x0 + h.x} ${y0 + h.y - h.d} v${h.d * 2}" stroke="${ink}" stroke-width="0.12" stroke-dasharray="0.8 0.4"/>`);
  }
  const hline = (xa: number, xb: number, y: number, label: string) =>
    `<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="${dim}" stroke-width="0.2" marker-start="url(#a)" marker-end="url(#a)"/><text x="${(xa + xb) / 2}" y="${y - 1}" font-size="2.4" text-anchor="middle" fill="${dim}">${label}</text>`;
  const vline = (x: number, ya: number, yb: number, label: string) =>
    `<line x1="${x}" y1="${ya}" x2="${x}" y2="${yb}" stroke="${dim}" stroke-width="0.2" marker-start="url(#a)" marker-end="url(#a)"/><text x="${x - 1}" y="${(ya + yb) / 2}" font-size="2.4" text-anchor="middle" fill="${dim}" transform="rotate(-90 ${x - 1} ${(ya + yb) / 2})">${label}</text>`;
  const ext = (xa: number, ya: number, xb: number, yb: number) => `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${dim}" stroke-width="0.12"/>`;
  // overall
  out.push(ext(x0, y0 + s.height + 1, x0, y0 + s.height + 13), ext(x0 + s.width, y0 + s.height + 1, x0 + s.width, y0 + s.height + 13));
  out.push(hline(x0, x0 + s.width, y0 + s.height + 11, `${f1(s.width)}`));
  out.push(ext(x0 - 1, y0, x0 - 13, y0), ext(x0 - 1, y0 + s.height, x0 - 13, y0 + s.height));
  out.push(vline(x0 - 11, y0, y0 + s.height, `${f1(s.height)}`));
  // ordinate dimensions for holes (from bottom-left datum)
  const hx = [...new Set(s.holes.map((h) => f1(h.x)))].map(Number).sort((a, b) => a - b);
  const hy = [...new Set(s.holes.map((h) => f1(s.height - h.y)))].map(Number).sort((a, b) => a - b);
  hx.forEach((x, i) => {
    out.push(ext(x0 + x, y0 + s.height + 1, x0 + x, y0 + s.height + 5 + (i % 2) * 2.5));
    out.push(`<text x="${x0 + x}" y="${y0 + s.height + 7.4 + (i % 2) * 2.5}" font-size="2" text-anchor="middle" fill="${dim}">${f1(x)}</text>`);
  });
  hy.forEach((y, i) => {
    const yy = y0 + s.height - y;
    out.push(ext(x0 + s.width + 1, yy, x0 + s.width + 5 + (i % 2) * 6, yy));
    out.push(`<text x="${x0 + s.width + 6 + (i % 2) * 6}" y="${yy + 0.8}" font-size="2" fill="${dim}">${f1(y)}</text>`);
  });
  if (s.holes.length) {
    const h = s.holes[0];
    out.push(`<line x1="${x0 + h.x + h.d / 2 * 0.7}" y1="${y0 + h.y - h.d / 2 * 0.7}" x2="${x0 + h.x + 8}" y2="${y0 + h.y - 8}" stroke="${dim}" stroke-width="0.15"/><text x="${x0 + h.x + 8.5}" y="${y0 + h.y - 8.5}" font-size="2.2" fill="${dim}">${s.holes.length}× ⌀${f1(h.d)}</text>`);
  }
  // side view
  const sy = y0 + s.height + sideGap + 6;
  out.push(`<rect x="${x0}" y="${sy + s.maxZ}" width="${s.width}" height="${s.thickness}" fill="#e9eef0" stroke="${ink}" stroke-width="0.3"/>`);
  for (const r of s.rects) if (r.z && r.z > 0) out.push(`<rect x="${x0 + r.x}" y="${sy + s.maxZ - r.z}" width="${r.w}" height="${r.z}" fill="none" stroke="#555" stroke-width="0.2"/>`);
  out.push(vline(x0 + s.width + 9, sy, sy + s.maxZ + s.thickness, `${f1(s.maxZ + s.thickness)}`));
  out.push(`<text x="${x0}" y="${sy - 2}" font-size="2.2" fill="#555">Side view · PCB ${f1(s.thickness)} mm · tallest part ${f1(s.maxZ)} mm</text>`);
  // title block
  const ty = H - 12;
  out.push(`<rect x="${W - 92}" y="${ty - 8}" width="86" height="16" fill="none" stroke="${ink}" stroke-width="0.3"/>`);
  out.push(`<text x="${W - 89}" y="${ty - 2.5}" font-size="3" font-weight="700">${esc(s.title)}</text>`);
  out.push(`<text x="${W - 89}" y="${ty + 2}" font-size="1.9" fill="#444">${esc(s.subtitle).slice(0, 70)}</text>`);
  out.push(`<text x="${W - 89}" y="${ty + 5.8}" font-size="1.9" fill="#444">Units mm · scale 1:1 · datum bottom-left · Thosaphol Connect ${new Date().toISOString().slice(0, 10)}</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** ASCII DXF (R12) with OUTLINE, HOLES, CONNECTORS and DIMS layers. Y axis up, origin bottom-left. */
export function drawingDxf(s: DrawingSpec): string {
  const L: string[] = [];
  const add = (...a: (string | number)[]) => L.push(...a.map(String));
  const Y = (y: number) => s.height - y;
  add(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC");
  add(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 4);
  for (const [name, color] of [
    ["OUTLINE", 7],
    ["HOLES", 1],
    ["CONNECTORS", 8],
    ["PINS", 9],
    ["DIMS", 5],
  ] as const)
    add(0, "LAYER", 2, name, 70, 0, 62, color, 6, "CONTINUOUS");
  add(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => add(0, "LINE", 8, layer, 10, x1.toFixed(4), 20, y1.toFixed(4), 30, 0, 11, x2.toFixed(4), 21, y2.toFixed(4), 31, 0);
  const circle = (layer: string, x: number, y: number, r: number) => add(0, "CIRCLE", 8, layer, 10, x.toFixed(4), 20, y.toFixed(4), 30, 0, 40, r.toFixed(4));
  const text = (layer: string, x: number, y: number, h: number, t: string) => add(0, "TEXT", 8, layer, 10, x.toFixed(4), 20, y.toFixed(4), 30, 0, 40, h, 1, t);
  const rect = (layer: string, x: number, y: number, w: number, h: number) => {
    line(layer, x, y, x + w, y);
    line(layer, x + w, y, x + w, y + h);
    line(layer, x + w, y + h, x, y + h);
    line(layer, x, y + h, x, y);
  };
  rect("OUTLINE", 0, 0, s.width, s.height);
  for (const h of s.holes) circle("HOLES", h.x, Y(h.y), h.d / 2);
  for (const r of s.rects) {
    rect("CONNECTORS", r.x, Y(r.y + r.h), r.w, r.h);
    text("CONNECTORS", r.x + 0.5, Y(r.y + r.h / 2), 1.2, r.label);
  }
  for (const p of s.pins) circle("PINS", p.x, Y(p.y), 0.5);
  line("DIMS", 0, -8, s.width, -8);
  text("DIMS", s.width / 2 - 4, -11, 2.5, `${f1(s.width)} mm`);
  line("DIMS", -8, 0, -8, s.height);
  text("DIMS", -18, s.height / 2, 2.5, `${f1(s.height)} mm`);
  for (const h of s.holes) text("DIMS", h.x + h.d, Y(h.y) + h.d, 1.5, `(${f1(h.x)}, ${f1(Y(h.y))}) d${f1(h.d)}`);
  text("DIMS", 0, s.height + 6, 3, s.title);
  add(0, "ENDSEC", 0, "EOF");
  return L.join("\n");
}
