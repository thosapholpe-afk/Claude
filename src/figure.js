import * as THREE from "three";
import { rad, angles } from "./model.js";
import { IMU_SITES } from "./data.js";

export function makeMaterials(theme) {
  const red = theme === "white";
  const body = new THREE.MeshPhysicalMaterial({
    color: red ? 0xcfd0d5 : 0x9c0d1a, roughness: red ? 0.4 : 0.3, metalness: 0.0,
    clearcoat: 0.9, clearcoatRoughness: 0.22, sheen: 0.3, sheenColor: new THREE.Color(red ? 0xffffff : 0xff6070),
  });
  const joint = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.15 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x121215, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc2c6ce, metalness: 1, roughness: 0.22 });
  const glow = new THREE.MeshBasicMaterial({ color: red ? new THREE.Color(3.2, 0.12, 0.12) : new THREE.Color(2.6, 2.6, 2.6), toneMapped: false });
  return { body, joint, carbon, metal, glow, solid: [body, joint, carbon, metal] };
}

const V = (r, y) => new THREE.Vector2(r, y);
function latheFrom(pts, seg = 36, n = 56) {
  // pts: [r, y] list in any order; output sorted by increasing y for outward normals
  const sorted = [...pts].sort((a, b) => a[1] - b[1]);
  const curve = new THREE.SplineCurve(sorted.map(([r, y]) => V(r, y)));
  const out = curve.getPoints(n).map((v) => V(Math.max(0, v.x), v.y));
  out[0].x = 0; out[out.length - 1].x = 0;
  return new THREE.LatheGeometry(out, seg);
}

export class Mannequin {
  constructor(theme) {
    this.mat = makeMaterials(theme);
    this.root = new THREE.Group();
    this.key = "";
    this.ghost = false;
  }

  mesh(geo, mat, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.root.clear();
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
    const pm = this.mesh(new THREE.SphereGeometry(1, 48, 32), M.body, pelvis);
    pm.scale.set(0.074 * h * gt, 0.072 * h, (F ? 0.112 : 0.1) * h * (0.9 + 0.1 * gt));
    pm.position.y = 0.035 * h;

    this.sites = {};
    const sensor = (parent, pos, normal) => {
      const g = new THREE.Group();
      const d = [0.022 * h, 0.03 * h, 0.022 * h];
      d["xyz".indexOf(normal)] = 0.008 * h;
      this.mesh(new THREE.BoxGeometry(...d), M.joint, g);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.0032 * h, 12, 8), M.glow);
      const lp = [0, 0.008 * h, 0]; lp["xyz".indexOf(normal)] = (pos["xyz".indexOf(normal)] >= 0 ? 1 : -1) * 0.005 * h;
      led.position.set(...lp);
      g.add(led);
      g.position.set(...pos);
      g.visible = false;
      parent.add(g);
      return g;
    };

    // ---- legs
    this.legs = {};
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1;
      const isAmp = m.ampSide === side;
      const hip = new THREE.Group(); hip.rotation.order = "YXZ";
      hip.position.set(0, 0, s * m.hipHalf);
      pelvis.add(hip);
      const rt = 0.048 * h * gl, rk = 0.03 * h * Math.sqrt(gl);
      this.mesh(latheFrom([[0, 0.035 * h], [rt * 0.8, 0.024 * h], [rt, 0], [rt * 0.97, -0.25 * Lt], [rt * 0.84, -0.55 * Lt], [rk * 1.1, -0.86 * Lt], [rk, -Lt], [0, -Lt - 0.014 * h]]), M.body, hip);
      const knee = new THREE.Group(); knee.rotation.order = "YXZ";
      knee.position.y = -Lt; hip.add(knee);
      this.mesh(new THREE.SphereGeometry(rk * 1.04, 28, 20), M.joint, knee);
      if (!isAmp) {
        this.mesh(latheFrom([[0, 0.006 * h], [0.028 * h * Math.sqrt(gl), -0.01 * h], [0.035 * h * gl, -0.27 * Ls], [0.026 * h * gl, -0.6 * Ls], [0.017 * h, -0.88 * Ls], [0.016 * h, -Ls], [0, -Ls - 0.01 * h]]), M.body, knee);
      } else {
        const sr = 0.034 * h * Math.sqrt(gl);
        this.mesh(latheFrom([[0, 0.012 * h], [sr * 0.95, 0.002 * h], [sr * 1.05, -0.14 * Ls], [sr * 0.85, -0.36 * Ls], [0.017 * h, -0.47 * Ls], [0, -0.5 * Ls]]), M.carbon, knee);
        const band = new THREE.Mesh(new THREE.TorusGeometry(sr * 1.03, 0.0016 * h, 8, 48), M.glow);
        band.rotation.x = Math.PI / 2; band.position.y = -0.08 * Ls; knee.add(band);
        const pyl = this.mesh(new THREE.CylinderGeometry(0.008 * h, 0.008 * h, 0.46 * Ls, 20), M.metal, knee);
        pyl.position.y = -0.71 * Ls;
        for (const y of [-0.48, -0.95]) { const a = this.mesh(new THREE.CylinderGeometry(0.014 * h, 0.013 * h, 0.028 * h, 20), M.metal, knee); a.position.y = y * Ls; }
      }
      const ankle = new THREE.Group(); ankle.position.y = -Ls; knee.add(ankle);
      this.mesh(new THREE.SphereGeometry(0.0165 * h, 20, 14), isAmp ? M.metal : M.joint, ankle);
      const foot = new THREE.Group(); ankle.add(foot);
      foot.rotation.y = -s * m.fpa * rad;
      const bev = 0.006 * h, depth = fw - 2 * bev, mx = 0.53 * fl, hx = -0.22 * fl, sole = -ah, top = 0.012 * h;
      const sh = new THREE.Shape();
      sh.moveTo(hx + 0.04 * fl, sole + bev);
      sh.lineTo(mx, sole + bev);
      sh.lineTo(mx, sole + 0.022 * h);
      sh.quadraticCurveTo(0.26 * fl, sole + 0.046 * h, 0.08 * fl, top);
      sh.lineTo(-0.07 * fl, top);
      sh.quadraticCurveTo(hx - 0.02 * fl, sole + 0.03 * h, hx + 0.04 * fl, sole + bev);
      const ex = { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 16 };
      const fg = new THREE.ExtrudeGeometry(sh, ex); fg.translate(0, 0, -depth / 2);
      this.mesh(fg, isAmp ? M.carbon : M.body, foot);
      const mtp = new THREE.Group(); mtp.position.set(mx, sole, 0); foot.add(mtp);
      const ts = new THREE.Shape();
      ts.moveTo(0, bev); ts.lineTo(0.19 * fl, bev);
      ts.quadraticCurveTo(0.27 * fl, bev, 0.25 * fl, 0.013 * h);
      ts.quadraticCurveTo(0.2 * fl, 0.022 * h, 0, 0.022 * h);
      const tg = new THREE.ExtrudeGeometry(ts, { ...ex, depth: depth * 0.92 }); tg.translate(0, 0, -depth * 0.46);
      this.mesh(tg, isAmp ? M.carbon : M.body, mtp);
      const heel = new THREE.Object3D(); heel.position.set(hx, sole, 0); foot.add(heel);
      const tip = new THREE.Object3D(); tip.position.set(0.25 * fl, 0, 0); mtp.add(tip);
      this.legs[side] = { hip, knee, ankle, foot, mtp, heel, tip, isAmp, s };
      const code = (seg) => Object.keys(IMU_SITES).find((k) => IMU_SITES[k][0] === side && IMU_SITES[k][1] === seg);
      this.sites[code("thigh")] = sensor(hip, [0, -0.5 * Lt, s * rt * 0.98], "z");
      this.sites[code("shank")] = sensor(knee, [0, -0.38 * Ls, s * 0.034 * h * gl], "z");
      this.sites[code("foot")] = sensor(foot, [0.22 * fl, sole + 0.042 * h, 0], "y");
    }

    // ---- trunk
    const spine = (this.spine = new THREE.Group()); spine.rotation.order = "YXZ";
    spine.position.y = 0.02 * h; pelvis.add(spine);
    const tor = this.mesh(latheFrom([[0, 0], [0.07 * h, 0.012 * h], [0.074 * h * gt, 0.06 * h], [0.071 * h * gt, 0.11 * h], [0.08 * h * (0.6 + 0.4 * gt), 0.17 * h], [0.088 * h, 0.215 * h], [0.081 * h, 0.25 * h], [0.056 * h, 0.274 * h], [0.03 * h, 0.285 * h], [0, 0.29 * h]], 48, 64), M.body, spine);
    tor.scale.set(0.7, 1, F ? 1.02 : 1.12);
    if (m.dBp > 1.5) {
      const b = this.mesh(new THREE.SphereGeometry(1, 40, 28), M.body, spine);
      b.scale.set(0.05 * h * (1 + 0.035 * m.dBp), 0.06 * h * (1 + 0.02 * m.dBp), 0.068 * h * (1 + 0.02 * m.dBp));
      b.position.set(0.02 * h + 0.0028 * h * m.dBp, 0.09 * h, 0);
    }
    const neck = this.mesh(new THREE.CylinderGeometry(0.024 * h, 0.027 * h, 0.07 * h, 24), M.joint, spine);
    neck.position.y = 0.3 * h;
    const head = (this.head = new THREE.Group()); head.rotation.order = "YXZ";
    head.position.y = 0.33 * h; spine.add(head);
    const hm = this.mesh(new THREE.SphereGeometry(1, 48, 36), M.body, head);
    hm.scale.set(0.058 * h, 0.068 * h, 0.047 * h); hm.position.y = 0.06 * h;
    const visor = new THREE.Group(); visor.position.y = 0.068 * h; visor.scale.set(1, 1, 0.047 / 0.058); head.add(visor);
    this.mesh(new THREE.CylinderGeometry(0.0592 * h, 0.0585 * h, 0.022 * h, 48, 1, true, Math.PI / 2 - 1.0, 2.0), M.joint, visor);
    const vl = new THREE.Mesh(new THREE.CylinderGeometry(0.0598 * h, 0.0598 * h, 0.0035 * h, 48, 1, true, Math.PI / 2 - 0.8, 1.6), M.glow);
    visor.add(vl);
    this.sites.H1 = sensor(head, [-0.058 * h, 0.06 * h, 0], "x");
    this.sites.B1 = sensor(spine, [-0.064 * h, 0.22 * h, 0], "x");
    this.sites.B2 = sensor(spine, [-0.053 * h * gt, 0.09 * h, 0], "x");
    this.sites.B3 = sensor(pelvis, [-0.074 * h * gt, 0.04 * h, 0], "x");

    // ---- arms
    this.arms = {};
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1;
      const sho = new THREE.Group(); sho.rotation.order = "YXZ";
      sho.position.set(0, 0.268 * h, s * (F ? 0.1 : 0.112) * h * (0.92 + 0.08 * gt));
      spine.add(sho);
      this.mesh(new THREE.SphereGeometry(0.027 * h * gl, 28, 20), M.joint, sho);
      this.mesh(latheFrom([[0, 0.022 * h], [0.025 * h * gl, 0], [0.023 * h * gl, -0.3 * Lu], [0.019 * h * gl, -0.7 * Lu], [0.017 * h, -Lu], [0, -Lu - 0.01 * h]]), M.body, sho);
      const elb = new THREE.Group(); elb.position.y = -Lu; sho.add(elb);
      this.mesh(new THREE.SphereGeometry(0.0175 * h, 20, 14), M.joint, elb);
      this.mesh(latheFrom([[0, 0.008 * h], [0.019 * h * gl, -0.05 * Lf], [0.02 * h * gl, -0.25 * Lf], [0.014 * h, -0.8 * Lf], [0.012 * h, -Lf], [0, -Lf - 0.006 * h]]), M.body, elb);
      const wr = new THREE.Group(); wr.position.y = -Lf; elb.add(wr);
      const hand = this.mesh(new THREE.SphereGeometry(1, 28, 20), M.body, wr);
      hand.scale.set(0.024 * h, 0.05 * h, 0.011 * h); hand.position.y = -0.046 * h;
      this.arms[side] = { sho, elb, s };
      const code = (seg) => Object.keys(IMU_SITES).find((k) => IMU_SITES[k][0] === side && IMU_SITES[k][1] === seg);
      this.sites[code("upperarm")] = sensor(sho, [0, -0.5 * Lu, s * 0.024 * h * gl], "z");
      this.sites[code("forearm")] = sensor(elb, [0, -0.6 * Lf, s * 0.017 * h * gl], "z");
      this.sites[code("hand")] = sensor(wr, [0, -0.04 * h, s * 0.013 * h], "z");
    }
    this.setGhost(this.ghost);
  }

  setIMUs(codes) {
    const all = codes.has("ALL16");
    for (const [k, g] of Object.entries(this.sites || {})) g.visible = all || codes.has(k);
  }

  setGhost(on) {
    this.ghost = on;
    for (const mt of this.mat.solid) {
      mt.transparent = on; mt.opacity = on ? 0.3 : 1; mt.depthWrite = !on; mt.needsUpdate = true;
    }
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = !on; });
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
    this.head.rotation.set(-0.8 * lean * rad, -0.2 * this.spine.rotation.y, (m.trunkFlex * 0.75) * rad);
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
