import * as THREE from "three";
import { rad, angles, clamp } from "./model.js";
import { IMU_SITES } from "./data.js";

// ------------------------------------------------------------------ textures & materials
let FIBER = null;
function fiberTexture() {
  if (FIBER) return FIBER;
  const w = 128, h = 256, c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = "#8d8d8d"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 240; i++) {
    const px = Math.random() * w, b = (125 + Math.random() * 130) | 0;
    x.strokeStyle = `rgb(${b},${b},${b})`; x.lineWidth = 0.6 + Math.random() * 1.7;
    x.beginPath(); x.moveTo(px, -4);
    for (let k = 1; k <= 10; k++) x.lineTo(px + Math.sin(k * 1.1 + i) * 1.4, (k * h) / 10 + 4);
    x.stroke();
  }
  x.globalAlpha = 0.07;
  for (let y = 0; y < h; y += 3) { x.fillStyle = y % 6 ? "#000" : "#fff"; x.fillRect(0, y, w, 1); }
  x.globalAlpha = 1;
  // wrap seam blend
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  FIBER = t;
  return t;
}

export function makeMaterials(theme) {
  const ice = theme === "ice";
  const fiber = fiberTexture();
  const suit = new THREE.MeshPhysicalMaterial({
    color: ice ? 0x23324a : 0x0b1430, roughness: 0.5, metalness: 0.25, clearcoat: 0.45, clearcoatRoughness: 0.35,
    sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(ice ? 0x86dcff : 0x3b8cff),
  });
  const shell = new THREE.MeshPhysicalMaterial({
    color: ice ? 0xf1f6fc : 0x2457e6, roughness: 0.2, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06,
    iridescence: 0.35, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 420],
  });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x03060c, roughness: 0.28, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.1 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x0c1018, roughness: 0.3, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5ccd8, metalness: 1, roughness: 0.2 });
  const glow = new THREE.MeshBasicMaterial({ color: ice ? new THREE.Color(0.35, 1.7, 2.8) : new THREE.Color(0.3, 1.1, 3.2), toneMapped: false, transparent: true });
  const muscle = new THREE.MeshPhysicalMaterial({
    color: ice ? 0xdbe6f3 : 0x2f63ea, map: fiber, bumpMap: fiber, bumpScale: 0.9, roughness: 0.4, metalness: 0.02,
    clearcoat: 0.6, clearcoatRoughness: 0.28, emissive: new THREE.Color(0, 0, 0), emissiveMap: fiber, emissiveIntensity: 1,
    sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(ice ? 0xc4f0ff : 0x86c8ff),
  });
  const cosm = muscle.clone();
  cosm.color = new THREE.Color(ice ? 0xc9d6e6 : 0x2650c4);
  return { suit, shell, dark, carbon, metal, glow, muscle, cosm, fixed: [suit, shell, dark, carbon, metal, glow] };
}

// ------------------------------------------------------------------ geometry helpers
const V2 = (r, y) => new THREE.Vector2(r, y);
function latheFrom(pts, seg = 40, n = 64) {
  const sorted = [...pts].sort((a, b) => a[1] - b[1]);
  const curve = new THREE.SplineCurve(sorted.map(([r, y]) => V2(r, y)));
  const out = curve.getPoints(n).map((v) => V2(Math.max(0, v.x), v.y));
  out[0].x = 0; out[out.length - 1].x = 0;
  return new THREE.LatheGeometry(out, seg);
}
// piecewise-linear radius along a segment; pts: [[fraction 0..1 down, radius]]
function profile(pts, L, up = false) {
  return (y) => {
    const f = clamp(up ? y / L : -y / L, 0, 1);
    for (let i = 1; i < pts.length; i++) {
      if (f <= pts[i][0]) { const [f0, r0] = pts[i - 1], [f1, r1] = pts[i]; return r0 + ((r1 - r0) * (f - f0)) / (f1 - f0 || 1); }
    }
    return pts[pts.length - 1][1];
  };
}
function limbLathe(rf, L, top, bottom, k = 0.95) {
  const pts = [[0, top]];
  for (let i = 0; i <= 12; i++) { const y = (-i / 12) * L; pts.push([rf(y) * k, y]); }
  pts.push([0, -L - bottom]);
  pts[1][0] *= 0.85;
  return latheFrom(pts, 40, 72);
}
class Ellipse3 extends THREE.Curve {
  constructor(rx, rz, y) { super(); this.rx = rx; this.rz = rz; this.y = y; }
  getPoint(t, target = new THREE.Vector3()) { const a = t * Math.PI * 2; return target.set(this.rx * Math.cos(a), this.y, this.rz * Math.sin(a)); }
}
function ring(rx, rz, y, thick) { return new THREE.TubeGeometry(new Ellipse3(rx, rz, y), 72, thick, 6, true); }

// conformal muscle patch: a crescent-shaped shell that hugs the body surface.
// surf(a, y, lift) → point on the body at angle a, height y, radius scaled by lift
function patch(surf, rho, { a0, a1, y0, y1, w, thick, skew = 1, kIn = 0.9, kBase = 0.8 }, nT = 26, nS = 12, rep = 1.4) {
  const pos = [], uv = [], idx = [], M = 2 * (nS + 1);
  for (let i = 0; i <= nT; i++) {
    const t = i / nT, ac = a0 + (a1 - a0) * t, yc = y0 + (y1 - y0) * t;
    const R = rho(yc), da = (a1 - a0) * R, dy = y1 - y0, len = Math.hypot(da, dy) || 1;
    const Px = -dy / len, Py = da / len;
    const pr = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, skew))), 0.75);
    const W = w(yc) * (0.08 + 0.92 * Math.pow(pr, 0.55));
    const ring = [];
    for (let j = 0; j <= nS; j++) {
      const sN = -1 + (2 * j) / nS, a = ac + (sN * W * Px) / rho(yc), y = yc + sN * W * Py;
      ring.push([a, y, kIn + thick * pr * Math.sqrt(Math.max(0, 1 - sN * sN)), (j / nS) * rep]);
    }
    for (const [a, y, l, u] of ring) { const p = surf(a, y, l); pos.push(p.x, p.y, p.z); uv.push(u, t); }
    for (let j = nS; j >= 0; j--) { const [a, y] = ring[j]; const p = surf(a, y, kBase); pos.push(p.x, p.y, p.z); uv.push(0, t); }
  }
  for (let i = 0; i < nT; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = a + M, c = i * M + ((j + 1) % M), d = c + M;
    idx.push(a, b, c, b, d, c);
  }
  // orientation: compare a mid outer-surface face with the outward direction
  const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const mi = Math.floor(nT / 2) * M + Math.floor(nS / 2);
  const fn = new THREE.Vector3().crossVectors(P(mi + M).sub(P(mi)), P(mi + 1).sub(P(mi)));
  const tc = 0.5, ac = a0 + (a1 - a0) * tc, yc = y0 + (y1 - y0) * tc;
  const out = surf(ac, yc, 1.3).sub(surf(ac, yc, 1.0));
  if (fn.dot(out) < 0) for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const limbSurf = (rf, s) => (a, y, l) => new THREE.Vector3(rf(y) * l * Math.cos(a), y, s * rf(y) * l * Math.sin(a));
function limbPatch(rf, L, s, [th, y0, y1, wF, thick, skew = 1, th1]) {
  return patch(limbSurf(rf, s), (y) => rf(y), { a0: th * rad, a1: (th1 ?? th) * rad, y0: -y0 * L, y1: -y1 * L, w: (y) => wF * rf(y), thick, skew });
}

// [group, angle°, y0, y1 (fractions down the segment), half-width (× radius), thickness, belly skew, end angle°]
const THIGH = [
  ["RF", 4, 0.04, 0.86, 0.42, 0.17, 1.0],
  ["VAS", 62, 0.1, 0.86, 0.62, 0.19, 1.1],
  ["VAS", -48, 0.42, 0.95, 0.5, 0.21, 2.1],
  ["HAM", 145, 0.08, 0.9, 0.5, 0.16, 1.0],
  ["HAM", -152, 0.08, 0.92, 0.5, 0.15, 1.0],
  ["ADD", -102, 0.02, 0.64, 0.58, 0.16, 0.8],
  [null, 100, 0.03, 0.7, 0.3, 0.06, 1.0],
  [null, 62, 0.02, 0.92, 0.15, 0.08, 1.0, -78],
];
const SHANK = [
  ["TA", 38, 0.06, 0.8, 0.42, 0.17, 0.9],
  ["PER", 102, 0.08, 0.72, 0.32, 0.12, 1.0],
  ["GAS", -150, 0.02, 0.56, 0.55, 0.26, 0.75],
  ["GAS", 150, 0.03, 0.5, 0.5, 0.22, 0.75],
  ["SOL", 180, 0.25, 0.88, 0.85, 0.13, 1.1],
];
const UPPER = [[null, 0, 0.12, 0.88, 0.6, 0.19, 1.1], [null, 180, 0.06, 0.85, 0.75, 0.17, 0.9]];
const FORE = [[null, -55, 0.02, 0.7, 0.75, 0.16, 0.7], [null, 115, 0.02, 0.68, 0.7, 0.15, 0.7]];

// ------------------------------------------------------------------ mannequin
const RAMP = [[0, [0.01, 0.05, 0.16]], [0.35, [0.0, 0.42, 1.0]], [0.7, [0.3, 0.92, 1.0]], [1, [1.0, 1.0, 1.0]]];
function ramp(x, out) {
  x = clamp(x, 0, 1);
  for (let i = 1; i < RAMP.length; i++) if (x <= RAMP[i][0]) {
    const [x0, c0] = RAMP[i - 1], [x1, c1] = RAMP[i], f = (x - x0) / (x1 - x0);
    return out.setRGB(c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f);
  }
  return out.setRGB(1, 1, 1);
}

export class Mannequin {
  constructor(theme) {
    this.theme = theme;
    this.mat = makeMaterials(theme);
    this.root = new THREE.Group();
    this.key = "";
    this.ghost = false;
    this.muscleMats = {};
    this.muscles = [];
    this.anchors = {};
  }

  mesh(geo, mat, parent, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast && !this.ghost; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  mMat(group, side) {
    const k = (group || "COS") + side;
    if (!this.muscleMats[k]) { const mm = (group ? this.mat.muscle : this.mat.cosm).clone(); mm.userData = { group, side }; this.muscleMats[k] = mm; }
    return this.muscleMats[k];
  }
  addMuscle(geo, group, side, parent) {
    const m = this.mesh(geo, this.mMat(group, side), parent);
    m.userData = { muscle: group, side, figure: this };
    this.muscles.push(m);
    if (group && !this.anchors[group + side]) { geo.computeBoundingSphere(); this.anchors[group + side] = { mesh: m, center: geo.boundingSphere.center.clone() }; }
    return m;
  }
  ellipsoid(group, side, parent, pos, scl, rot = [0, 0, 0]) {
    const g = new THREE.SphereGeometry(1, 36, 24);
    g.scale(...scl); g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]); g.translate(...pos);
    return this.addMuscle(g, group, side, parent);
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.root.clear();
    this.muscles = []; this.anchors = {};
  }

  build(m) {
    const o = m.o;
    const key = [o.ht, o.wt, o.sex, o.mode].join("|");
    if (key === this.key) return;
    this.key = key;
    this.dispose();
    const h = m.h, M = this.mat, F = o.sex === "F";
    const gl = 1 + 0.7 * (m.girth - 1), gt = 1 + 1.1 * (m.girth - 1);
    const Lt = 0.245 * h, Ls = 0.246 * h, fl = 0.152 * h, ah = 0.039 * h, fw = 0.056 * h * (0.9 + 0.1 * m.girth);
    const Lu = 0.186 * h, Lf = 0.146 * h;
    this.dim = { h, Lt, Ls, fl, ah, fw, hipY: 0.53 * h };

    const body = (this.body = new THREE.Group());
    body.position.y = 0.53 * h;
    this.root.add(body);
    const pelvis = (this.pelvis = new THREE.Group());
    pelvis.rotation.order = "YXZ";
    body.add(pelvis);
    const pm = this.mesh(new THREE.SphereGeometry(1, 48, 32), M.suit, pelvis);
    pm.scale.set(0.072 * h * gt, 0.07 * h, (F ? 0.11 : 0.098) * h * (0.9 + 0.1 * gt));
    pm.position.y = 0.035 * h;

    this.sites = {};
    const sensor = (parent, pos, normal) => {
      const g = new THREE.Group(), d = [0.022 * h, 0.03 * h, 0.022 * h], ni = "xyz".indexOf(normal);
      d[ni] = 0.008 * h;
      this.mesh(new THREE.BoxGeometry(...d), M.dark, g);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.0034 * h, 12, 8), M.glow);
      const lp = [0, 0.008 * h, 0]; lp[ni] = (pos[ni] >= 0 ? 1 : -1) * 0.005 * h;
      led.position.set(...lp); g.add(led);
      g.position.set(...pos); g.visible = false; parent.add(g);
      return g;
    };
    const code = (side, seg) => Object.keys(IMU_SITES).find((k) => IMU_SITES[k][0] === side && IMU_SITES[k][1] === seg);

    // ---------------------------------------------------------- pelvis muscles
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1;
      this.ellipsoid("GMAX", side, pelvis, [-0.05 * h * gt, 0.004 * h, s * 0.05 * h], [0.034 * h * gt, 0.06 * h, 0.047 * h * gt], [s * 0.12, 0, 0.22]);
      this.ellipsoid("GMED", side, pelvis, [-0.008 * h, 0.05 * h, s * 0.08 * h * (0.9 + 0.1 * gt)], [0.04 * h, 0.027 * h, 0.018 * h], [-s * 0.35, 0, 0]);
      this.ellipsoid("ILIO", side, pelvis, [0.047 * h * gt, 0.006 * h, s * 0.042 * h], [0.017 * h, 0.036 * h, 0.02 * h], [0, 0, -0.4]);
    }

    // ---------------------------------------------------------- legs
    this.legs = {};
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1, isAmp = m.ampSide === side;
      const hip = new THREE.Group(); hip.rotation.order = "YXZ";
      hip.position.set(0, 0, s * m.hipHalf); pelvis.add(hip);
      const rTh = profile([[0, 0.046 * gl], [0.25, 0.045 * gl], [0.55, 0.039 * gl], [0.86, 0.031 * Math.sqrt(gl)], [1, 0.029 * Math.sqrt(gl)]].map(([f, r]) => [f, r * h]), Lt);
      this.mesh(limbLathe(rTh, Lt, 0.035 * h, 0.014 * h, 0.95), M.suit, hip);
      for (const d of THIGH) this.addMuscle(limbPatch(rTh, Lt, s, d.slice(1)), d[0], side, hip);
      const knee = new THREE.Group(); knee.rotation.order = "YXZ";
      knee.position.y = -Lt; hip.add(knee);
      const rk = 0.03 * h * Math.sqrt(gl);
      const kj = this.mesh(new THREE.SphereGeometry(rk * 0.98, 28, 20), M.suit, knee);
      kj.scale.set(1, 1.05, 1);
      const pat = this.mesh(new THREE.SphereGeometry(1, 24, 16), M.shell, knee);
      pat.scale.set(0.011 * h, 0.019 * h, 0.016 * h); pat.position.set(rk * 0.86, 0.004 * h, 0);
      if (!isAmp) {
        const rSh = profile([[0, 0.029 * Math.sqrt(gl)], [0.27, 0.034 * gl], [0.6, 0.025 * gl], [0.88, 0.017], [1, 0.016]].map(([f, r]) => [f, r * h]), Ls);
        this.mesh(limbLathe(rSh, Ls, 0.006 * h, 0.01 * h, 0.95), M.suit, knee);
        for (const d of SHANK) this.addMuscle(limbPatch(rSh, Ls, s, d.slice(1)), d[0], side, knee);
        this.mesh(ring(rSh(-0.035 * Ls) * 1.02, rSh(-0.035 * Ls) * 1.02, -0.035 * Ls, 0.0012 * h), M.glow, knee, false);
      } else {
        const sr = 0.034 * h * Math.sqrt(gl);
        this.mesh(latheFrom([[0, 0.012 * h], [sr * 0.95, 0.002 * h], [sr * 1.05, -0.14 * Ls], [sr * 0.85, -0.36 * Ls], [0.017 * h, -0.47 * Ls], [0, -0.5 * Ls]]), M.carbon, knee);
        for (const y of [-0.08, -0.3]) this.mesh(ring(sr * (y < -0.1 ? 0.92 : 1.04), sr * (y < -0.1 ? 0.92 : 1.04), y * Ls, 0.0013 * h), M.glow, knee, false);
        const pyl = this.mesh(new THREE.CylinderGeometry(0.008 * h, 0.008 * h, 0.46 * Ls, 20), M.metal, knee);
        pyl.position.y = -0.71 * Ls;
        for (const y of [-0.48, -0.95]) { const a = this.mesh(new THREE.CylinderGeometry(0.014 * h, 0.013 * h, 0.028 * h, 20), M.metal, knee); a.position.y = y * Ls; }
      }
      const ankle = new THREE.Group(); ankle.position.y = -Ls; knee.add(ankle);
      this.mesh(new THREE.SphereGeometry(0.0165 * h, 20, 14), isAmp ? M.metal : M.suit, ankle);
      const foot = new THREE.Group(); ankle.add(foot);
      foot.rotation.y = -s * m.fpa * rad;

      // shoe: sole + glowing midsole line + upper
      const bev = 0.005 * h, depth = fw - 2 * bev, mx = 0.53 * fl, hx = -0.22 * fl, sole = -ah, top = 0.012 * h, sh = 0.011 * h;
      const ex = (d) => ({ depth: d, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 18 });
      const solidUpper = new THREE.Shape();
      solidUpper.moveTo(hx + 0.05 * fl, sole + sh);
      solidUpper.lineTo(mx, sole + sh);
      solidUpper.lineTo(mx, sole + 0.024 * h);
      solidUpper.quadraticCurveTo(0.26 * fl, sole + 0.047 * h, 0.08 * fl, top);
      solidUpper.lineTo(-0.07 * fl, top + 0.004 * h);
      solidUpper.quadraticCurveTo(hx - 0.02 * fl, sole + 0.032 * h, hx + 0.05 * fl, sole + sh);
      const solShape = new THREE.Shape();
      solShape.moveTo(hx + 0.04 * fl, sole + bev);
      solShape.lineTo(mx, sole + bev);
      solShape.lineTo(mx, sole + sh + 0.002 * h);
      solShape.lineTo(hx + 0.02 * fl, sole + sh + 0.002 * h);
      solShape.quadraticCurveTo(hx - 0.035 * fl, sole + sh * 0.6, hx + 0.04 * fl, sole + bev);
      const lineShape = new THREE.Shape();
      lineShape.moveTo(hx + 0.0 * fl, sole + sh - 0.0005 * h); lineShape.lineTo(mx, sole + sh - 0.0005 * h);
      lineShape.lineTo(mx, sole + sh + 0.0018 * h); lineShape.lineTo(hx + 0.0 * fl, sole + sh + 0.0018 * h);
      const add = (shape, d, mat, parent) => { const g = new THREE.ExtrudeGeometry(shape, ex(d)); g.translate(0, 0, -d / 2); return this.mesh(g, mat, parent); };
      if (!isAmp) {
        add(solidUpper, depth, M.shell, foot);
        add(solShape, depth * 1.04, M.dark, foot);
        const gl2 = new THREE.ExtrudeGeometry(lineShape, { depth: depth * 1.07, bevelEnabled: false }); gl2.translate(0, 0, -depth * 0.535);
        this.mesh(gl2, M.glow, foot, false);
      } else {
        const blade = new THREE.Shape();
        blade.moveTo(hx + 0.04 * fl, sole + bev); blade.lineTo(mx, sole + bev); blade.lineTo(mx, sole + 0.02 * h);
        blade.quadraticCurveTo(0.2 * fl, sole + 0.03 * h, 0.04 * fl, top);
        blade.lineTo(-0.06 * fl, top);
        blade.quadraticCurveTo(hx - 0.02 * fl, sole + 0.03 * h, hx + 0.04 * fl, sole + bev);
        add(blade, depth, M.carbon, foot);
        const gl2 = new THREE.ExtrudeGeometry(lineShape, { depth: depth * 1.07, bevelEnabled: false }); gl2.translate(0, 0, -depth * 0.535);
        this.mesh(gl2, M.glow, foot, false);
      }
      const mtp = new THREE.Group(); mtp.position.set(mx, sole, 0); foot.add(mtp);
      const toeUp = new THREE.Shape();
      toeUp.moveTo(0, sh); toeUp.lineTo(0.18 * fl, sh);
      toeUp.quadraticCurveTo(0.26 * fl, sh, 0.24 * fl, 0.016 * h);
      toeUp.quadraticCurveTo(0.19 * fl, 0.025 * h, 0, 0.024 * h);
      const toeSole = new THREE.Shape();
      toeSole.moveTo(0, bev); toeSole.lineTo(0.2 * fl, bev);
      toeSole.quadraticCurveTo(0.28 * fl, bev, 0.255 * fl, sh + 0.002 * h); toeSole.lineTo(0, sh + 0.002 * h);
      add(toeUp, depth * 0.92, isAmp ? M.carbon : M.shell, mtp);
      add(toeSole, depth * 0.96, M.dark, mtp);
      const heel = new THREE.Object3D(); heel.position.set(hx, sole, 0); foot.add(heel);
      const tip = new THREE.Object3D(); tip.position.set(0.25 * fl, 0, 0); mtp.add(tip);
      this.legs[side] = { hip, knee, ankle, foot, mtp, heel, tip, isAmp, s };
      this.sites[code(side, "thigh")] = sensor(hip, [0, -0.5 * Lt, s * rTh(-0.5 * Lt) * 1.06], "z");
      this.sites[code(side, "shank")] = sensor(knee, [0, -0.38 * Ls, s * 0.036 * h * gl], "z");
      this.sites[code(side, "foot")] = sensor(foot, [0.22 * fl, sole + 0.045 * h, 0], "y");
    }

    // ---------------------------------------------------------- trunk
    const spine = (this.spine = new THREE.Group()); spine.rotation.order = "YXZ";
    spine.position.y = 0.02 * h; pelvis.add(spine);
    const ax = 0.7, az = F ? 1.02 : 1.12;
    const rT = profile([[0, 0.07], [0.04, 0.071], [0.2, 0.074 * gt], [0.38, 0.071 * gt], [0.59, 0.08 * (0.6 + 0.4 * gt)], [0.74, 0.088], [0.86, 0.081], [0.945, 0.056], [0.98, 0.03], [1, 0.0]].map(([f, r]) => [f, r * h]), 0.29 * h, true);
    const tpts = [];
    for (let i = 0; i <= 24; i++) { const y = (i / 24) * 0.29 * h; tpts.push([rT(y) * 0.97, y]); }
    const tor = this.mesh(latheFrom(tpts, 56, 80), M.suit, spine);
    tor.scale.set(ax, 1, az);
    if (m.dBp > 1.5) {
      const b = this.mesh(new THREE.SphereGeometry(1, 40, 28), M.suit, spine);
      b.scale.set(0.05 * h * (1 + 0.035 * m.dBp), 0.06 * h * (1 + 0.02 * m.dBp), 0.068 * h * (1 + 0.02 * m.dBp));
      b.position.set(0.02 * h + 0.0028 * h * m.dBp, 0.09 * h, 0);
    }
    this.mesh(ring(ax * rT(0.035 * h) * 1.0, az * rT(0.035 * h) * 1.0, 0.035 * h, 0.0014 * h), M.glow, spine, false);
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1;
      const tS = (a, y, l) => new THREE.Vector3(ax * rT(y) * l * Math.cos(a), y, s * az * rT(y) * l * Math.sin(a));
      const tR = (y) => rT(y) * (ax + az) * 0.5;
      const TP = (group, o) => this.addMuscle(patch(tS, tR, { ...o, a0: o.a0 * rad, a1: o.a1 * rad, w: typeof o.w === "function" ? o.w : () => o.w }), group, side, spine);
      TP("ES", { a0: 168, a1: 166, y0: 0.012 * h, y1: 0.238 * h, w: 0.017 * h, thick: 0.09, kIn: 0.94 });
      TP(null, { a0: 110, a1: 148, y0: 0.238 * h, y1: 0.07 * h, w: 0.045 * h, thick: 0.07, skew: 0.8, kIn: 0.93 });
      TP(null, { a0: 74, a1: 60, y0: 0.17 * h, y1: 0.035 * h, w: 0.03 * h, thick: 0.07, kIn: 0.93 });
      TP(null, { a0: 6, a1: 64, y0: 0.204 * h, y1: 0.238 * h, w: 0.033 * h, thick: 0.11, skew: 0.7, kIn: 0.93 });
      TP(null, { a0: 172, a1: 112, y0: 0.272 * h, y1: 0.258 * h, w: 0.026 * h, thick: 0.1, kIn: 0.92 });
      [[0.03, 0.07], [0.075, 0.11], [0.115, 0.15], [0.155, 0.195]].forEach(([a, b]) => TP("ABD", { a0: 9, a1: 9, y0: a * h, y1: b * h, w: 0.019 * h, thick: 0.08, kIn: 0.95 }));
    }
    const neck = this.mesh(new THREE.CylinderGeometry(0.024 * h, 0.028 * h, 0.07 * h, 28), M.suit, spine);
    neck.position.y = 0.3 * h;
    this.mesh(ring(0.0295 * h, 0.0295 * h, 0.279 * h, 0.0011 * h), M.glow, spine, false);
    const head = (this.head = new THREE.Group()); head.rotation.order = "YXZ";
    head.position.y = 0.33 * h; spine.add(head);
    const hm = this.mesh(new THREE.SphereGeometry(1, 56, 40), M.shell, head);
    hm.scale.set(0.058 * h, 0.068 * h, 0.047 * h); hm.position.y = 0.062 * h;
    const jaw = this.mesh(new THREE.SphereGeometry(1, 40, 28), M.shell, head);
    jaw.scale.set(0.042 * h, 0.032 * h, 0.04 * h); jaw.position.set(0.016 * h, 0.022 * h, 0);
    const visor = new THREE.Group(); visor.position.y = 0.07 * h; visor.scale.set(1, 1, 0.047 / 0.058); head.add(visor);
    this.mesh(new THREE.CylinderGeometry(0.0595 * h, 0.0585 * h, 0.026 * h, 56, 1, true, Math.PI / 2 - 1.05, 2.1), M.dark, visor);
    const vl = new THREE.Mesh(new THREE.CylinderGeometry(0.0601 * h, 0.0601 * h, 0.0032 * h, 56, 1, true, Math.PI / 2 - 0.85, 1.7), M.glow);
    visor.add(vl);
    for (const s of [1, -1]) {
      const ear = this.mesh(new THREE.CylinderGeometry(0.013 * h, 0.014 * h, 0.009 * h, 28), M.dark, head);
      ear.rotation.x = Math.PI / 2; ear.position.set(-0.004 * h, 0.064 * h, s * 0.047 * h);
      const er = new THREE.Mesh(new THREE.TorusGeometry(0.0095 * h, 0.0011 * h, 6, 32), M.glow);
      er.position.set(-0.004 * h, 0.064 * h, s * 0.0518 * h); head.add(er);
    }
    this.sites.H1 = sensor(head, [-0.058 * h, 0.06 * h, 0], "x");
    this.sites.B1 = sensor(spine, [-0.066 * h, 0.22 * h, 0], "x");
    this.sites.B2 = sensor(spine, [-0.055 * h * gt, 0.09 * h, 0], "x");
    this.sites.B3 = sensor(pelvis, [-0.074 * h * gt, 0.04 * h, 0], "x");

    // ---------------------------------------------------------- arms
    this.arms = {};
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1;
      const sho = new THREE.Group(); sho.rotation.order = "YXZ";
      sho.position.set(0, 0.268 * h, s * (F ? 0.1 : 0.112) * h * (0.92 + 0.08 * gt));
      spine.add(sho);
      this.ellipsoid("DEL", side, sho, [0, -0.03 * h, s * 0.009 * h], [0.033 * h * gl, 0.052 * h, 0.029 * h * gl]);
      const rU = profile([[0, 0.024 * gl], [0.3, 0.022 * gl], [0.7, 0.019 * gl], [1, 0.017]].map(([f, r]) => [f, r * h]), Lu);
      this.mesh(limbLathe(rU, Lu, 0.022 * h, 0.01 * h, 0.95), M.suit, sho);
      for (const d of UPPER) this.addMuscle(limbPatch(rU, Lu, s, d.slice(1)), d[0], side, sho);
      const elb = new THREE.Group(); elb.position.y = -Lu; sho.add(elb);
      this.mesh(new THREE.SphereGeometry(0.0172 * h, 20, 14), M.suit, elb);
      this.mesh(ring(0.0185 * h, 0.0185 * h, -0.02 * h, 0.001 * h), M.glow, elb, false);
      const rF = profile([[0, 0.019 * gl], [0.25, 0.02 * gl], [0.8, 0.014], [1, 0.012]].map(([f, r]) => [f, r * h]), Lf);
      this.mesh(limbLathe(rF, Lf, 0.008 * h, 0.006 * h, 0.95), M.suit, elb);
      for (const d of FORE) this.addMuscle(limbPatch(rF, Lf, s, d.slice(1)), d[0], side, elb);
      const wr = new THREE.Group(); wr.position.y = -Lf; elb.add(wr);
      this.mesh(ring(0.0128 * h, 0.0128 * h, 0.004 * h, 0.0009 * h), M.glow, wr, false);
      const palm = this.mesh(new THREE.SphereGeometry(1, 28, 20), M.suit, wr);
      palm.scale.set(0.022 * h, 0.032 * h, 0.011 * h); palm.position.y = -0.028 * h;
      const fing = this.mesh(new THREE.SphereGeometry(1, 28, 20), M.suit, wr);
      fing.scale.set(0.019 * h, 0.03 * h, 0.0095 * h); fing.position.set(0.004 * h, -0.066 * h, 0); fing.rotation.z = 0.25;
      const th = this.mesh(new THREE.SphereGeometry(1, 20, 14), M.suit, wr);
      th.scale.set(0.007 * h, 0.021 * h, 0.0075 * h); th.position.set(0.02 * h, -0.034 * h, -s * 0.004 * h); th.rotation.z = 0.5;
      this.arms[side] = { sho, elb, s };
      this.sites[code(side, "upperarm")] = sensor(sho, [0, -0.5 * Lu, s * 0.026 * h * gl], "z");
      this.sites[code(side, "forearm")] = sensor(elb, [0, -0.6 * Lf, s * 0.019 * h * gl], "z");
      this.sites[code(side, "hand")] = sensor(wr, [0, -0.03 * h, s * 0.013 * h], "z");
    }
    this.pickables = this.muscles.filter((mm) => mm.userData.muscle);
    this.setGhost(this.ghost);
  }

  setIMUs(codes) {
    const all = codes.has("ALL16");
    for (const [k, g] of Object.entries(this.sites || {})) g.visible = all || codes.has(k);
  }

  allMats() { return [...this.mat.fixed, ...Object.values(this.muscleMats)]; }
  setGhost(on) {
    this.ghost = on;
    for (const mt of this.allMats()) {
      mt.transparent = on || mt === this.mat.glow; mt.opacity = on ? (mt === this.mat.glow ? 0.5 : 0.22) : 1; mt.depthWrite = !on; mt.needsUpdate = true;
    }
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = !on && o.material !== this.mat.glow; });
  }

  applyEMG(acts, on, sel, t) {
    for (const k in this.muscleMats) {
      const mm = this.muscleMats[k], { group, side } = mm.userData;
      if (!group) { mm.emissive.setRGB(0.0, 0.012, 0.035); continue; }
      const a = on ? acts[side]?.[group] ?? 0 : 0, an = Math.min(1, a / 0.5);
      let I = on ? 0.18 + 2.8 * an * an + 0.5 * an : 0.05;
      ramp(on ? an : 0.15, mm.emissive);
      if (on && sel) { const hit = group === sel.group && side === sel.side; I *= hit ? 1.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 7)) : 0.32; }
      mm.emissive.multiplyScalar(I);
    }
  }

  anchorWorld(group, side, out) {
    const a = this.anchors[group + side];
    if (!a) return null;
    return a.mesh.localToWorld(out.copy(a.center));
  }

  pose(m, pR, pL, exag) {
    const A = { R: angles(m, m.legs.R, pR), L: angles(m, m.legs.L, pL) };
    this.A = A;
    const tw = 2 * Math.PI * pR;
    for (const side of ["R", "L"]) {
      const lg = this.legs[side], a = A[side], s = lg.s;
      lg.hip.rotation.set(s * a.add * rad, 0, a.hip * rad);
      lg.knee.rotation.set(s * a.varus * exag * rad, s * a.ir * exag * rad, -a.knee * rad);
      lg.ankle.rotation.set(0, 0, a.ank * rad);
      lg.mtp.rotation.z = a.mtp * rad;
    }
    this.pelvis.rotation.set(-3 * Math.sin(tw) * rad, m.pelvisRot * Math.cos(tw) * rad, -2 * rad);
    let lean = 0;
    if (m.amp) {
      const sd = m.ampSide, p = sd === "R" ? pR : pL, L = m.legs[sd];
      if (p < L.sf) lean = (sd === "R" ? 1 : -1) * m.latLean * Math.sin((Math.PI * p) / L.sf);
    }
    this.spine.rotation.set(lean * rad + 3 * Math.sin(tw) * rad, -0.75 * this.pelvis.rotation.y, (-m.trunkFlex + 1.2 * Math.cos(2 * tw)) * rad + 2 * rad);
    this.head.rotation.set(-0.8 * lean * rad, -0.2 * this.spine.rotation.y, m.trunkFlex * 0.75 * rad);
    for (const side of ["R", "L"]) {
      const ar = this.arms[side], opp = A[side === "R" ? "L" : "R"];
      const flex = m.armSwing * (opp.hip - 9);
      ar.sho.rotation.set(-ar.s * m.armAbd * rad, 0, (flex + m.trunkFlex) * rad);
      ar.elb.rotation.z = (16 + 0.55 * Math.max(0, flex)) * rad;
    }
    this.body.position.z = m.sway * Math.sin(tw);
  }

  ground(groundY) {
    this.body.position.y = this.dim.hipY;
    this.root.updateMatrixWorld(true);
    let min = Infinity;
    const v = new THREE.Vector3();
    for (const side of ["R", "L"]) {
      const lg = this.legs[side];
      for (const o of [lg.heel, lg.mtp, lg.tip]) { o.getWorldPosition(v); min = Math.min(min, v.y); }
    }
    this.body.position.y += groundY - min;
    this.root.updateMatrixWorld(true);
  }

  contacts(side) {
    const lg = this.legs[side];
    return { heel: lg.heel.getWorldPosition(new THREE.Vector3()), ball: lg.mtp.getWorldPosition(new THREE.Vector3()), tip: lg.tip.getWorldPosition(new THREE.Vector3()) };
  }
}
