import * as THREE from "three";
import { Env } from "./base.js";
import { makeNoise, genTextures, canvasTex, groundPlane, scrollMaps, Particles, Ambient, rand, wrap } from "./common.js";

const N = makeNoise(23);

function concrete() {
  return genTextures(512, (u, v) => {
    const n = N.fbm(u * 6, v * 6, 6, 5), f = N.fbm(u * 48, v * 48, 48, 2), st = N.fbm(u * 2 + 3, v * 2, 2, 3);
    const joint = (Math.abs(((u * 2) % 1) - 0.5) > 0.497 || Math.abs(((v * 2) % 1) - 0.5) > 0.497) ? 0.55 : 1;
    const k = (0.58 + 0.18 * n + 0.06 * f - Math.max(0, st) * 0.18) * joint;
    return [118 * k + 8, 124 * k + 10, 132 * k + 14, 0.5 + 0.3 * f + 0.2 * n - (joint < 1 ? 0.4 : 0)];
  }, { normalStrength: 2 });
}

export class FactoryEnv extends Env {
  build() {
    this.light = {
      exposure: 0.95, bloom: [0.7, 0.5, 1.15], fog: [0x0b111b, 0.032], background: new THREE.Color(0x070b12), env: "room", envIntensity: 0.55,
      hemi: [0x9cc0ec, 0x0c1016, 0.5], sun: { color: 0xe6f0ff, intensity: 2.5, pos: [2.5, 9, 3] },
      rimA: { color: 0x2f9bff, intensity: 2.2, pos: [-5, 3.5, -4] }, rimB: { color: 0xffa24a, intensity: 0.55, pos: [4, 2, 6] },
    };
    const S = 0.2;
    const ct = concrete();
    const floorMat = new THREE.MeshPhysicalMaterial({ map: ct.map, normalMap: ct.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.42, metalness: 0.12, clearcoat: 0.25, clearcoatRoughness: 0.3 });
    const walkTex = canvasTex(512, 256, (x, w, h) => {
      x.fillStyle = "#16407e"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      const hz = (y0) => { for (let i = -2; i < 22; i++) { x.fillStyle = i % 2 ? "#111" : "#f5c518"; x.beginPath(); x.moveTo(i * 26, y0); x.lineTo(i * 26 + 26, y0); x.lineTo(i * 26 + 10, y0 + 22); x.lineTo(i * 26 - 16, y0 + 22); x.fill(); } };
      hz(0); hz(h - 22);
      x.fillStyle = "#eaf3ff"; x.fillRect(0, 26, w, 5); x.fillRect(0, h - 31, w, 5);
      x.fillStyle = "rgba(234,243,255,0.75)";
      for (const ax of [120, 376]) { x.beginPath(); x.moveTo(ax, h / 2 - 34); x.lineTo(ax + 46, h / 2); x.lineTo(ax, h / 2 + 34); x.lineTo(ax + 14, h / 2); x.fill(); }
    });
    walkTex.wrapS = walkTex.wrapT = THREE.RepeatWrapping;
    const walkMat = new THREE.MeshPhysicalMaterial({ map: walkTex, roughness: 0.45, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    this.add(groundPlane(-80, 80, -80, -1.1, floorMat, S));
    this.add(groundPlane(-80, 80, 1.1, 80, floorMat, S));
    const walk = new THREE.PlaneGeometry(160, 2.2); walk.rotateX(-Math.PI / 2);
    const wp = walk.attributes.position, wuv = new Float32Array(wp.count * 2);
    for (let i = 0; i < wp.count; i++) { wuv[i * 2] = wp.getX(i) / 4; wuv[i * 2 + 1] = (wp.getZ(i) + 1.1) / 2.2; }
    walk.setAttribute("uv", new THREE.BufferAttribute(wuv, 2));
    const wm = new THREE.Mesh(walk, walkMat); wm.receiveShadow = true; wm.position.y = 0.0; this.add(wm);
    this.add(groundPlane(-80, 80, -1.1, 1.1, floorMat, S, -0.004));
    this.walkMat = walkMat; this.floorMat = floorMat;
    // structure
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x2a3a52, metalness: 0.85, roughness: 0.38, clearcoat: 0.3 });
    const steelDark = new THREE.MeshStandardMaterial({ color: 0x151c28, metalness: 0.8, roughness: 0.5 });
    const glowW = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.7, 3.0), toneMapped: false });
    const glowO = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.2, 0.2), toneMapped: false });
    this.props = [];
    const prop = (obj, gx, z, range = [-42, 42]) => { obj.position.z = z; this.add(obj); this.props.push({ obj, gx, range }); return obj; };
    const ibeam = (h) => {
      const g = new THREE.Group();
      for (const [sx, sz, x] of [[0.03, 0.34, 0.15], [0.03, 0.34, -0.15], [0.3, 0.03, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz).translate(x, h / 2, 0), steel); b.castShadow = true; b.receiveShadow = true; g.add(b); }
      return g;
    };
    const beamGeo = new THREE.BoxGeometry(0.26, 0.42, 26);
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(abs(dot(vN,vV)),1.5); float a=0.05*f*smoothstep(0.,1.,vUv.y); gl_FragColor=vec4(vec3(0.75,0.88,1.0)*a,a); }",
    });
    this.beacons = [];
    for (let i = 0; i < 12; i++) {
      const gx = i * 7;
      const c1 = ibeam(8); prop(c1, gx, -4.6);
      const beacon = new THREE.Group(); beacon.position.set(0.22, 2.6, 0); c1.add(beacon);
      beacon.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), glowO));
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 16, 1, true).translate(0, 1.1, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.45, 0.08), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beacon.add(beam); this.beacons.push(beacon);
      prop(ibeam(8), gx, 9.5);
      const bm = new THREE.Mesh(beamGeo, steelDark); bm.position.y = 7.6; prop(bm, gx, 0);
      for (const z of [-1.6, 2.2]) {
        const lamp = new THREE.Group();
        lamp.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.3), steelDark));
        const gl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.22), glowW); gl.position.y = -0.045; lamp.add(gl);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.0, 6.2, 24, 1, true).translate(0, -3.1, 0), coneMat); lamp.add(cone);
        lamp.position.y = 6.5; prop(lamp, gx + 3.5, z);
      }
    }
    for (const z of [-8, -3, 3, 8]) { const p = new THREE.Mesh(new THREE.BoxGeometry(160, 0.2, 0.16), steelDark); p.position.set(0, 7.9, z); this.add(p); }
    const wallTex = canvasTex(512, 512, (x, w, h) => {
      x.fillStyle = "#121a26"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 12) { x.fillStyle = i % 24 ? "#18222f" : "#0e151f"; x.fillRect(i, 0, 6, h); }
      x.fillStyle = "rgba(120,190,255,0.85)";
      for (let i = 0; i < 4; i++) x.fillRect(i * 128 + 14, 30, 100, 60);
      x.fillStyle = "#2a3646"; x.fillRect(0, h - 70, w, 70);
      x.fillStyle = "#f5c518"; x.fillRect(0, h - 74, w, 4);
    });
    wallTex.wrapS = THREE.RepeatWrapping;
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.4, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.25 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(160, 9), wallMat);
    wall.geometry.attributes.uv.array.forEach((_, i, a) => { if (i % 2 === 0) a[i] *= 40; });
    wall.position.set(0, 4.5, -12); this.add(wall); this.wallMat = wallMat;
    // conveyor
    const beltTex = canvasTex(256, 64, (x, w, h) => { x.fillStyle = "#1b1f26"; x.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 16) { x.fillStyle = "#2c323c"; x.fillRect(i, 0, 4, h); } });
    beltTex.wrapS = THREE.RepeatWrapping;
    const beltMat = new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.8 });
    const belt = new THREE.Mesh(new THREE.PlaneGeometry(160, 0.7), beltMat);
    belt.geometry.attributes.uv.array.forEach((_, i, a) => { if (i % 2 === 0) a[i] *= 160; });
    belt.rotation.x = -Math.PI / 2; belt.position.set(0, 0.86, -2.75); belt.receiveShadow = true; this.add(belt);
    for (const z of [-2.35, -3.15]) { const r = new THREE.Mesh(new THREE.BoxGeometry(160, 0.12, 0.08), steel); r.position.set(0, 0.86, z); r.castShadow = true; this.add(r); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(160, 0.008, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.7, 1.3), toneMapped: false })); rail.position.set(0, 0.93, -2.33); this.add(rail);
    for (let i = 0; i < 20; i++) { const leg = new THREE.Group(); for (const z of [0.36, -0.36]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08).translate(0, 0.43, z), steelDark); leg.add(l); } prop(leg, i * 4.2, -2.75); }
    this.beltMat = beltMat;
    const boxMats = [0xb08a5a, 0x2563eb, 0x9aa7b8, 0xc29a68].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }));
    this.boxes = [];
    for (let i = 0; i < 16; i++) {
      const s = rand(0.35, 0.55), b = new THREE.Mesh(new THREE.BoxGeometry(s, s * rand(0.6, 1), s * 0.9).translate(0, (s * 0.8) / 2, 0), boxMats[i % 4]);
      b.castShadow = true; b.receiveShadow = true; b.position.set(0, 0.86, -2.75); b.rotation.y = rand(-0.2, 0.2);
      this.add(b); this.boxes.push({ b, gx: i * 3.1 });
    }
    // robot arms (white/blue)
    const white = new THREE.MeshPhysicalMaterial({ color: 0xe8eef6, roughness: 0.3, metalness: 0.1, clearcoat: 0.8 });
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1d4ed8, roughness: 0.35, metalness: 0.2, clearcoat: 0.6 });
    this.robots = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.3, 24).translate(0, 0.15, 0), blue); base.castShadow = true; g.add(base);
      const turret = new THREE.Group(); turret.position.y = 0.3; g.add(turret);
      turret.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.4, 20).translate(0, 0.2, 0), white));
      const sh = new THREE.Group(); sh.position.y = 0.45; turret.add(sh);
      sh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 20).rotateX(Math.PI / 2), blue));
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.24).translate(0, 0.6, 0), white); up.castShadow = true; sh.add(up);
      const el = new THREE.Group(); el.position.y = 1.2; sh.add(el);
      el.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.32, 18).rotateX(Math.PI / 2), blue));
      const fo = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.18).translate(0, 0.47, 0), white); fo.castShadow = true; el.add(fo);
      const wr = new THREE.Group(); wr.position.y = 0.95; el.add(wr);
      wr.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), blue));
      const tool = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 12).translate(0, 0.16, 0), steelDark); wr.add(tool);
      const tip = new THREE.Object3D(); tip.position.y = 0.32; wr.add(tip);
      const wb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.85, 0.7).translate(0, 0.425, 0), steelDark); wb.position.set(0, 0, 1.0); wb.castShadow = true; g.add(wb);
      g.rotation.y = Math.PI;
      prop(g, i * 14 + 3, -4.1);
      this.robots.push({ g, turret, sh, el, wr, tip, ph: i * 2.1 });
    }
    this.weldLight = new THREE.PointLight(0x66ccff, 0, 6, 2); this.add(this.weldLight);
    // crane
    this.crane = new THREE.Group();
    const gird = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 22), new THREE.MeshPhysicalMaterial({ color: 0xf5c518, metalness: 0.4, roughness: 0.45, clearcoat: 0.4 }));
    gird.position.set(0, 7.0, -1.5); gird.castShadow = true; this.crane.add(gird);
    this.trolley = new THREE.Group(); this.trolley.position.set(0, 6.6, 0); this.crane.add(this.trolley);
    this.trolley.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.8), steelDark));
    this.pend = new THREE.Group(); this.trolley.add(this.pend);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 6).translate(0, -1.6, 0), steelDark); this.pend.add(cable);
    const load = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.9).translate(0, -3.6, 0), boxMats[1]); load.castShadow = true; this.pend.add(load);
    this.add(this.crane);
    // racks and crates
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      for (const x of [-1.2, 1.2]) for (const z of [-0.45, 0.45]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.6, 0.07).translate(x, 1.8, z), blue); g.add(p); }
      for (const y of [0.15, 1.3, 2.45]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 1.0).translate(0, y, 0), steelDark); g.add(sh);
        for (let k2 = 0; k2 < 3; k2++) if (Math.random() < 0.8) { const s = rand(0.45, 0.7); const c = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.9, 0.8).translate(-0.8 + k2 * 0.8, y + 0.03 + (s * 0.9) / 2, 0), boxMats[(i + k2) % 4]); c.castShadow = true; g.add(c); }
      }
      prop(g, i * 2.7, i % 2 ? -9.2 : -7.6, [-24, 24]);
    }
    // vents + pallets near the walkway
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x0f141c, metalness: 0.7, roughness: 0.4 });
    this.vents = [];
    for (let i = 0; i < 6; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.5), ventMat); v.position.y = 0.01; prop(v, i * 12 + 4, 1.75, [-36, 36]); this.vents.push(v); }
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const pal = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 1.0).translate(0, 0.07, 0), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 })); pal.castShadow = true; g.add(pal);
      for (let k2 = 0; k2 < 4; k2++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.45).translate((k2 % 2) * 0.52 - 0.26, 0.37 + Math.floor(k2 / 2) * 0.46, 0), boxMats[(i + k2) % 4]); c.castShadow = true; g.add(c); }
      prop(g, i * 10.5 + 7, i % 2 ? 3.0 : 4.2, [-42, 42]);
    }
    // fx
    this.sparks = new Particles(700, { additive: true, gravity: -9.8, drag: 0.6 });
    this.steam = new Particles(260, { gravity: 0.6, drag: 1.2 });
    this.dust = new Particles(200, { gravity: -0.5, drag: 3 });
    this.motes = new Ambient(this.U, 500, { box: [24, 7, 16], center: [0, 3.5, -1], fall: -0.02, wind: 0.05, swirl: 0.25, size: 0.014, color: [0.75, 0.88, 1.0], additive: true, opacity: 0.55 });
    for (const p of [this.sparks, this.steam, this.dust, this.motes]) { this.add(p.points); this.fx.push(p); }
    this.floorY = 0.0;
    const v3 = new THREE.Vector3();
    this.tick.push((dt, t) => {
      const g = this.g;
      scrollMaps([floorMat], g, S);
      walkTex.offset.x = -g / 4;
      wallTex.offset.x = -g / 4;
      beltTex.offset.x = -(g + 0.6 * t);
      for (const p of this.props) p.obj.position.x = wrap(p.gx + g, p.range[0], p.range[1]);
      for (const b of this.boxes) b.b.position.x = wrap(b.gx + 0.6 * t + g, -25, 25);
      for (const bc of this.beacons) bc.rotation.y = t * 3.2;
      let best = null;
      for (const r of this.robots) {
        const k = t * 0.9 + r.ph;
        r.turret.rotation.y = Math.sin(t * 0.45 + r.ph) * 0.9;
        r.sh.rotation.z = -0.55 + Math.sin(k) * 0.35;
        r.el.rotation.z = 1.35 + Math.sin(k * 1.2 + 0.4) * 0.35;
        r.wr.rotation.z = 0.6 + Math.sin(k * 1.7) * 0.4;
        const welding = Math.sin(k * 1.3) > 0.35;
        if (welding) {
          r.tip.getWorldPosition(v3);
          if (Math.abs(v3.x) < 14) {
            if (Math.random() < 0.9) this.sparks.emit(4, v3, { v: [0, 1.2, 0], j: [2.2, 1.6, 2.2], life: [0.25, 0.7], size: [0.012, 0.03], color: () => (Math.random() < 0.6 ? [1.4, 1.9, 2.6] : [2.4, 1.2, 0.3]), alpha: 0.9 });
            if (!best || Math.abs(v3.x) < Math.abs(best.x)) best = v3.clone();
          }
        }
      }
      if (best) { this.weldLight.position.copy(best); this.weldLight.intensity = 1.5 + Math.random() * 3; } else this.weldLight.intensity *= 0.8;
      this.crane.position.x = wrap(Math.sin(t * 0.12) * 6 + g, -30, 30);
      this.trolley.position.z = Math.sin(t * 0.27) * 3.5;
      this.pend.rotation.x = Math.sin(t * 1.35) * 0.06; this.pend.rotation.z = Math.sin(t * 1.1 + 1) * 0.08;
      for (const [i, v] of this.vents.entries()) {
        if (Math.abs(v.position.x) < 16 && (Math.sin(t * 0.8 + i * 1.7) > 0.7) && Math.random() < 0.6) {
          this.steam.emit(1, v.position, { v: [0.1, 1.0, 0], j: [0.2, 0.3, 0.2], life: [1.4, 2.4], size: [0.12, 0.22], color: [0.85, 0.9, 1.0], alpha: 0.16, grow: 0.5, spread: 0.2 });
        }
      }
    });
  }
  onStep(ev) {
    const c = ev.fig.contacts(ev.side), p = ev.type === "IC" ? c.heel : c.tip;
    this.dust.emit(3, p, { v: [0, 0.2, 0], j: [0.2, 0.1, 0.2], life: [0.4, 0.9], size: [0.025, 0.05], color: [0.6, 0.65, 0.72], alpha: 0.25, grow: 0.1 });
  }
}
