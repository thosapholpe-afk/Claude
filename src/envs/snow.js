import * as THREE from "three";
import { Env } from "./base.js";
import { blob } from "./garden.js";
import { makeNoise, genTextures, canvasTex, groundPlane, scrollMaps, patchWind, Particles, Ambient, gradientEnvironment, DeformGround, rand, wrap, clamp } from "./common.js";

const N = makeNoise(31);

export class SnowEnv extends Env {
  build() {
    this.windy = true;
    const sunDir = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();
    const sky = gradientEnvironment(this.stage.pmrem, [0.36, 0.5, 0.74], [0.8, 0.87, 0.95], [0.72, 0.78, 0.86], sunDir, [1, 0.95, 0.85], 0.6);
    this.rts.push(sky.rt);
    this.light = {
      exposure: 0.78, bloom: [0.35, 0.5, 2.2], fog: [0xcfdbe8, 0.028], background: sky.texture, env: sky.texture, envIntensity: 1.0,
      hemi: [0xe4eefa, 0x8ea2b8, 0.85], sun: { color: 0xfff6ea, intensity: 2.0, pos: [sunDir.x * 12, sunDir.y * 12, sunDir.z * 12] },
      rimA: { color: 0x9cc8ff, intensity: 0.8, pos: [-5, 3, -4] }, rimB: { color: 0xffffff, intensity: 0.3, pos: [-3, 2, 5] },
    };
    const st = genTextures(512, (u, v) => {
      const n = N.fbm(u * 6, v * 6, 6, 4), f = N.fbm(u * 50, v * 50, 50, 2);
      const sp = Math.random() < 0.004 ? 40 : 0;
      return [232 + 14 * n + sp, 238 + 12 * n + sp, 248 + 6 * n, 0.5 + 0.35 * n + 0.15 * f];
    }, { normalStrength: 1.6 });
    const snowMat = new THREE.MeshPhysicalMaterial({ map: st.map, normalMap: st.normal, roughness: 0.72, color: 0xf4f8ff, sheen: 0.6, sheenColor: new THREE.Color(0xbfd8ff), sheenRoughness: 0.6 });
    const S = 0.3;
    this.add(groundPlane(-80, 80, 0.65, 80, snowMat, S));
    this.add(groundPlane(-80, 80, -80, -0.65, snowMat, S));
    this.add(groundPlane(-80, -10, -0.65, 0.65, snowMat, S));
    this.add(groundPlane(4, 80, -0.65, 0.65, snowMat, S));
    const dMat = snowMat.clone();
    this.deform = new DeformGround(this.U, dMat, { x0: -10, L: 14, W: 1.3, res: 0.0175, depth: 0.085, rim: 0.02, darken: 0.6, uvScale: S, tint: [0.62, 0.74, 1.0] });
    this.add(this.deform.mesh);
    this.depth0 = 0.05; this.rim0 = 0.014;
    this.mats = [snowMat, dMat];
    // pines with snow, rocks, fence, cabin
    const pineMat = patchWind(new THREE.MeshStandardMaterial({ color: 0x1f4a3a, roughness: 0.85 }), this.U, { height: 9, amp: 0.1, flutter: 0.008, key: "spine" });
    const capMat = patchWind(new THREE.MeshPhysicalMaterial({ color: 0xf2f7ff, roughness: 0.65, sheen: 0.5, sheenColor: new THREE.Color(0xcfe2ff) }), this.U, { height: 9, amp: 0.1, flutter: 0.008, key: "scap" });
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3627, roughness: 0.9 });
    this.props = [];
    const prop = (obj, gx, z, range = [-45, 45]) => { obj.position.z = z; this.add(obj); this.props.push({ obj, gx, range }); return obj; };
    const pine = (s) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.17 * s, 1.6 * s, 8).translate(0, 0.8 * s, 0), bark));
      for (let i = 0; i < 5; i++) {
        const r = (1.6 - i * 0.28) * s, y = (1.2 + i * 0.95) * s;
        const c = new THREE.Mesh(new THREE.ConeGeometry(r, 1.7 * s, 16, 3).translate(0, y, 0), pineMat); c.castShadow = true; g.add(c);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.82, 0.9 * s, 16, 2).translate(0, y + 0.42 * s, 0), capMat); cap.castShadow = true; g.add(cap);
      }
      return g;
    };
    for (let i = 0; i < 34; i++) { const back = i < 24; prop(pine(rand(0.8, 1.5)), rand(-45, 45), back ? rand(-28, -3.5) : rand(9.5, 26)); }
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x59606b, roughness: 0.9, vertexColors: true });
    for (let i = 0; i < 16; i++) {
      const s = rand(0.2, 0.8), g = new THREE.Group();
      const r = new THREE.Mesh(blob(s, 2, i * 2.7, 0.65, 0.3), rockMat); r.castShadow = true; g.add(r);
      const cap = new THREE.Mesh(blob(s * 0.92, 2, i * 2.7 + 1, 0.35, 0.18).translate(0, s * 0.32, 0), snowMat); g.add(cap);
      prop(g, rand(-45, 45), i < 10 ? rand(-7, -1.8) : rand(1.8, 7));
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4c34, roughness: 0.85 });
    for (let i = 0; i < 34; i++) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.0, 8).translate(0, 0.5, 0), wood); p.castShadow = true; g.add(p);
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.5, 1).translate(0, 1.0, 0), snowMat); g.add(c);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 0.04).translate(1.25, 0.75, 0), wood); rail.castShadow = true; g.add(rail);
      prop(g, i * 2.5, -1.45, [-42.5, 42.5]);
    }
    const cabin = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(5, 2.8, 4).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ color: 0x5a3d2a, roughness: 0.85 })); walls.castShadow = true; cabin.add(walls);
    const roofG = new THREE.CylinderGeometry(2.9, 2.9, 5.6, 3, 1, false).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 3.35, 0);
    cabin.add(new THREE.Mesh(roofG, snowMat));
    const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.7, 0.6), toneMapped: false });
    for (const x of [-1.3, 1.3]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), win); w.position.set(x, 1.5, 2.01); cabin.add(w); }
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5).translate(1.4, 4.0, -0.6), new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.9 })); cabin.add(chim);
    cabin.rotation.y = 0.3;
    prop(cabin, 8, -16, [-45, 45]);
    this.cabin = cabin;
    // fx
    this.snowfall = new Ambient(this.U, 2600, { box: [30, 12, 24], center: [0, 5.5, 0], fall: 0.9, wind: 0.9, swirl: 0.9, size: 0.03, color: [1, 1, 1], opacity: 0.95 });
    this.spray = new Particles(500, { gravity: -6, drag: 1.2 });
    this.smoke = new Particles(160, { gravity: 0.25, drag: 0.6 });
    this.breath = new Particles(120, { gravity: 0.15, drag: 1.4 });
    for (const p of [this.snowfall, this.spray, this.smoke, this.breath]) { this.add(p.points); this.fx.push(p); }
    this.floorY = 0.0;
    const v3 = new THREE.Vector3();
    let breathT = 0;
    this.tick.push((dt, t, ctx) => {
      scrollMaps(this.mats, this.g, S);
      for (const p of this.props) p.obj.position.x = wrap(p.gx + this.g, p.range[0], p.range[1]);
      if (Math.random() < 0.5) { v3.set(1.4, 4.7, -0.6).applyMatrix4(this.cabin.matrixWorld); this.smoke.emit(1, v3, { v: [0.25, 0.6, 0], j: [0.1, 0.1, 0.1], life: [3, 5], size: [0.3, 0.5], color: [0.75, 0.78, 0.82], alpha: 0.22, grow: 0.5 }); }
      breathT -= dt;
      const f = ctx.focusFig;
      if (f && breathT < 0) {
        breathT = 2.2;
        f.head.updateMatrixWorld(); v3.set(0.07 * f.dim.h, 0.03 * f.dim.h, 0).applyMatrix4(f.head.matrixWorld);
        this.breath.emit(7, v3, { v: [0.45, 0.05, 0], j: [0.12, 0.06, 0.08], life: [0.9, 1.5], size: [0.05, 0.09], color: [0.95, 0.97, 1], alpha: 0.18, grow: 0.25 });
      }
    });
  }
  sink(m) { return this.depth0 * clamp(Math.sqrt(m.BW / 637), 0.75, 1.45) * 0.85; }
  stamp(fig, m, side) {
    const wf = clamp(Math.sqrt(m.BW / 637), 0.75, 1.45);
    this.deform.stampFoot(fig, m, side, this.g, -this.sink(m), this.depth0 * wf, this.rim0 * wf);
  }
  onStep(ev) {
    const c = ev.fig.contacts(ev.side);
    if (ev.type === "TO") this.spray.emit(18, c.tip, { v: [-0.45, 0.9, 0], j: [0.4, 0.45, 0.35], life: [0.4, 0.9], size: [0.012, 0.03], color: [0.96, 0.98, 1], alpha: 0.95 });
    else this.spray.emit(10, c.heel, { v: [0.1, 0.4, 0], j: [0.45, 0.2, 0.45], life: [0.3, 0.7], size: [0.015, 0.035], color: [0.96, 0.98, 1], alpha: 0.8 });
  }
}
