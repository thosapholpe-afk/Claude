import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION } from "three-bvh-csg";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { getPart } from "../core/parts";
import type { BoardDef, CaseParams } from "../core/types";

export interface CaseResult {
  base: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  outer: { w: number; d: number; h: number; lid: number };
  inner: { w: number; d: number; h: number };
  notes: string[];
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const cyl = (r: number, h: number, x: number, y: number, z: number, axis: "y" | "x" | "z" = "y") => {
  const g = new THREE.CylinderGeometry(r, r, h, 32);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};
const clean = (g: THREE.BufferGeometry) => {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (k !== "position" && k !== "normal") out.deleteAttribute(k);
  return out;
};
const merge = (gs: THREE.BufferGeometry[]) => (gs.length ? mergeGeometries(gs.map(clean), false) : null);

export function generateCase(board: BoardDef, p: CaseParams): CaseResult {
  const notes: string[] = [];
  const ev = new Evaluator();
  ev.attributes = ["position", "normal"];
  ev.useGroups = false;
  const pcbT = board.thickness;
  // cavity covers the PCB and any connector that overhangs it
  let minX = 0;
  let minZ = 0;
  let maxX = board.width;
  let maxZ = board.height;
  for (const c of board.connectors) {
    if (!c.edge) continue;
    minX = Math.min(minX, c.x);
    minZ = Math.min(minZ, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxZ = Math.max(maxZ, c.y + c.h);
  }
  let extraW = 0;
  let extraH = 0;
  if (p.includeBreadboard) {
    const bb = getPart("breadboard")!;
    extraW = bb.w + 6;
    extraH = 8.5;
    maxZ = Math.max(maxZ, bb.h);
    notes.push("Cavity extended to the right for a half-size breadboard.");
  }
  const iw = maxX - minX + extraW + p.clearance * 2;
  const id = maxZ - minZ + p.clearance * 2;
  const autoH = p.standoffHeight + pcbT + Math.max(board.maxComponentZ, extraH) + 3;
  const ih = p.innerHeight > 0 ? p.innerHeight : autoH;
  const ow = iw + p.wall * 2;
  const od = id + p.wall * 2;
  const oh = ih + p.floor;
  // PCB origin (board 0,0 top-left) in case coordinates; case centred on X/Z, floor at y=0
  const ox = -iw / 2 + p.clearance - minX;
  const oz = -id / 2 + p.clearance - minZ;
  const pcbY = p.floor + p.standoffHeight;
  const toCase = (bx: number, bz: number) => ({ x: ox + bx, z: oz + bz });

  // ---- base shell
  const r = Math.min(p.cornerRadius, Math.min(ow, od) / 2 - 0.5);
  const outerG = new RoundedBoxGeometry(ow, oh, od, 4, Math.max(0.01, r));
  outerG.translate(0, oh / 2, 0);
  let base = new Brush(clean(outerG));
  const innerG = new RoundedBoxGeometry(iw, ih + 2, id, 4, Math.max(0.01, r - p.wall));
  innerG.translate(0, p.floor + (ih + 2) / 2, 0);
  base = ev.evaluate(base, new Brush(clean(innerG)), SUBTRACTION);

  // ---- supports: standoffs on mounting holes, otherwise edge rails
  const adds: THREE.BufferGeometry[] = [];
  const holes: THREE.BufferGeometry[] = [];
  if (board.holes.length) {
    for (const h of board.holes) {
      const c = toCase(h.x, h.y);
      adds.push(cyl(Math.max(2.6, h.d / 2 + 1.6), p.standoffHeight + 0.5, c.x, p.floor + p.standoffHeight / 2 - 0.25, c.z));
      holes.push(cyl(p.screwHole / 2, p.standoffHeight + p.floor, c.x, p.floor + p.standoffHeight / 2 + 0.6, c.z));
    }
    notes.push(`${board.holes.length} standoffs for M${Math.round(board.holes[0].d - 0.4)} screws (pilot ${p.screwHole} mm).`);
  } else {
    const len = board.width * 0.7;
    for (const z of [2.2, board.height - 2.2]) {
      const c = toCase(board.width / 2, z);
      adds.push(box(len, p.standoffHeight, 2.4, c.x, p.floor + p.standoffHeight / 2, c.z));
    }
    notes.push("No mounting holes on this board — the PCB rests on two side rails; a lid lip holds it down.");
  }
  if (p.mountingEars) {
    for (const s of [-1, 1]) {
      adds.push(box(12, 3, 16, s * (ow / 2 + 5), 1.5, 0));
      holes.push(cyl(2.2, 8, s * (ow / 2 + 6.5), 1.5, 0));
    }
  }
  const addG = merge(adds);
  if (addG) base = ev.evaluate(base, new Brush(addG), ADDITION);

  // ---- subtractive features on the base
  const cuts: THREE.BufferGeometry[] = [...holes];
  if (p.connectorCutouts) {
    for (const c of board.connectors) {
      if (!c.edge || c.z <= 0) continue;
      const m = 1.0;
      const y0 = pcbY + pcbT - 0.6;
      const hh = c.z + 1.6;
      if (c.edge === "left" || c.edge === "right") {
        const cc = toCase(0, c.y + c.h / 2);
        const x = c.edge === "left" ? -ow / 2 + p.wall / 2 : ow / 2 - p.wall / 2;
        cuts.push(box(p.wall * 3, hh, c.h + m * 2, x, y0 + hh / 2, cc.z));
      } else {
        const cc = toCase(c.x + c.w / 2, 0);
        const z = c.edge === "top" ? -od / 2 + p.wall / 2 : od / 2 - p.wall / 2;
        cuts.push(box(c.w + m * 2, hh, p.wall * 3, cc.x, y0 + hh / 2, z));
      }
    }
  }
  const vents = p.waterproof ? "none" : p.vents;
  if (vents === "side-slots") {
    const n = Math.max(3, Math.floor((od - 16) / 4));
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) cuts.push(box(p.wall * 3, Math.max(3, ih * 0.35), 1.8, s * (ow / 2 - p.wall / 2), p.floor + ih * 0.55, -((n - 1) * 4) / 2 + i * 4));
  }
  if (p.waterproof) {
    // gasket groove around the rim + cable gland hole
    const gw = 1.4;
    const ring = [
      box(iw + p.wall, 1.4, gw, 0, oh - 0.7, -(id / 2 + p.wall / 2)),
      box(iw + p.wall, 1.4, gw, 0, oh - 0.7, id / 2 + p.wall / 2),
      box(gw, 1.4, id + p.wall, -(iw / 2 + p.wall / 2), oh - 0.7, 0),
      box(gw, 1.4, id + p.wall, iw / 2 + p.wall / 2, oh - 0.7, 0),
    ];
    cuts.push(...ring);
    cuts.push(cyl(6.25, p.wall * 3, 0, p.floor + ih * 0.45, -od / 2 + p.wall / 2, "z"));
    notes.push("Waterproof: 1.4 mm gasket groove in the rim and a PG7 cable-gland hole (12.5 mm) in the back wall. Vents disabled.");
  }
  for (const f of p.features) {
    if (f.face === "lid") continue;
    const depth = p.wall * 3;
    const shape = (w: number, h: number, x: number, y: number, z: number, axis: "x" | "z") =>
      f.shape === "circle" ? cyl(w / 2, depth, x, y, z, axis) : axis === "x" ? box(depth, h, w, x, y, z) : box(w, h, depth, x, y, z);
    const y = f.v;
    if (f.face === "front") cuts.push(shape(f.w, f.h, -ow / 2 + f.u, y, od / 2 - p.wall / 2, "z"));
    if (f.face === "back") cuts.push(shape(f.w, f.h, ow / 2 - f.u, y, -od / 2 + p.wall / 2, "z"));
    if (f.face === "left") cuts.push(shape(f.w, f.h, -ow / 2 + p.wall / 2, y, -od / 2 + f.u, "x"));
    if (f.face === "right") cuts.push(shape(f.w, f.h, ow / 2 - p.wall / 2, y, od / 2 - f.u, "x"));
  }
  const cutG = merge(cuts);
  if (cutG) base = ev.evaluate(base, new Brush(cutG), SUBTRACTION);

  // ---- lid with locating lip
  const lt = p.lidThickness;
  const lidOuter = new RoundedBoxGeometry(ow, lt, od, 4, Math.max(0.01, Math.min(r, lt / 2 - 0.01)));
  lidOuter.translate(0, lt / 2, 0);
  let lid = new Brush(clean(lidOuter));
  const lipH = 2.6;
  const lipT = 1.4;
  const tol = 0.25;
  const lipOuter = box(iw - tol * 2, lipH, id - tol * 2, 0, -lipH / 2 + 0.01, 0);
  const lipInner = box(iw - tol * 2 - lipT * 2, lipH + 1, id - tol * 2 - lipT * 2, 0, -lipH / 2, 0);
  let lip = new Brush(clean(lipOuter));
  lip = ev.evaluate(lip, new Brush(clean(lipInner)), SUBTRACTION);
  lid = ev.evaluate(lid, lip, ADDITION);
  const lidCuts: THREE.BufferGeometry[] = [];
  if (vents === "lid-slots") {
    const n = Math.max(3, Math.floor((iw - 20) / 4.5));
    for (let i = 0; i < n; i++) lidCuts.push(box(2, lt * 4, Math.min(28, id * 0.5), -((n - 1) * 4.5) / 2 + i * 4.5, lt / 2, 0));
  }
  if (vents === "honeycomb") {
    const step = 5.2;
    for (let gx = -iw / 2 + 8; gx < iw / 2 - 8; gx += step)
      for (let gz = -id / 2 + 8, row = 0; gz < id / 2 - 8; gz += step * 0.866, row++) lidCuts.push(cyl(1.8, lt * 4, gx + (row % 2) * step * 0.5, lt / 2, gz));
  }
  for (const f of p.features) {
    if (f.face !== "lid") continue;
    const x = -ow / 2 + f.u;
    const z = od / 2 - f.v;
    lidCuts.push(f.shape === "circle" ? cyl(f.w / 2, lt * 4, x, lt / 2, z) : box(f.w, lt * 4, f.h, x, lt / 2, z));
  }
  if (board.holes.length && !p.waterproof) {
    // screw access holes through the lid are not needed; keep the lid solid over standoffs
  }
  const lidCutG = merge(lidCuts);
  if (lidCutG) lid = ev.evaluate(lid, new Brush(lidCutG), SUBTRACTION);

  notes.unshift(`Outer ${ow.toFixed(1)} × ${od.toFixed(1)} × ${(oh + lt).toFixed(1)} mm (base ${oh.toFixed(1)} + lid ${lt}). Inner ${iw.toFixed(1)} × ${id.toFixed(1)} × ${ih.toFixed(1)} mm.`);
  return {
    base: base.geometry,
    lid: lid.geometry,
    outer: { w: ow, d: od, h: oh, lid: lt },
    inner: { w: iw, d: id, h: ih },
    notes,
  };
}

export function toStl(geo: THREE.BufferGeometry, flipLid = false): DataView {
  const g = geo.clone();
  if (flipLid) g.rotateX(Math.PI); // print the lid face-down
  // STL convention: Z up
  g.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(g);
  return new STLExporter().parse(mesh, { binary: true }) as DataView;
}
