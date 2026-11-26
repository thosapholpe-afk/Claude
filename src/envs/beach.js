import * as THREE from "three";
import { Env } from "./base.js";
import { blob } from "./garden.js";
import { makeNoise, genTextures, canvasTex, groundPlane, worldUV, scrollMaps, patchWind, Particles, Ambient, gradientEnvironment, Birds, DeformGround, rand, wrap, clamp } from "./common.js";

const N = makeNoise(11);
const SHORE = -6;

function sandTextures() {
  return genTextures(512, (u, v) => {
    const n = N.fbm(u * 8, v * 8, 8, 4), fine = N.fbm(u * 64, v * 64, 64, 2);
    const rip = Math.sin((u * 10 + N.fbm(u * 3, v * 3, 3, 3) * 1.6) * Math.PI * 2 + v * 4) * 0.5 + 0.5;
    const k = 0.5 + 0.5 * n;
    return [214 + 22 * k + 14 * fine, 192 + 20 * k + 12 * fine, 152 + 16 * k + 10 * fine, 0.45 * rip + 0.35 * fine + 0.2 * n];
  }, { normalStrength: 3.2 });
}

export class BeachEnv extends Env {
  build() {
    this.windy = true;
    const sunDir = new THREE.Vector3(-0.3, 0.7, -0.65).normalize();
    const sky = gradientEnvironment(this.stage.pmrem, [0.03, 0.2, 0.75], [0.55, 0.78, 0.98], [0.45, 0.5, 0.55], sunDir, [1.8, 1.6, 1.3], 1.4);
    this.rts.push(sky.rt);
    sky.sun = sunDir;
    const sp = sunDir.clone().multiplyScalar(12);
    this.light = {
      exposure: 0.74, bloom: [0.4, 0.5, 2.8], fog: [0xa6cdf2, 0.009], background: sky.texture, env: sky.texture, envIntensity: 0.9,
      hemi: [0xd7ebff, 0xcdb48a, 0.6], sun: { color: 0xfff4e2, intensity: 3.9, pos: [sp.x, sp.y, sp.z] },
      rimA: { color: 0x9fd0ff, intensity: 0.6, pos: [-5, 3, -4] }, rimB: { color: 0xffffff, intensity: 0.3, pos: [-3, 2, 5] },
    };
    this.sunDir = sky.sun.clone();
    const st = sandTextures();
    const sandMat = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92, color: 0xd9c6a2 });
    const wetMat = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normal, roughness: 0.42, metalness: 0.05, color: 0x8a7964, vertexColors: true });
    const S = 0.3;
    this.add(groundPlane(-80, 80, 0.65, 70, sandMat, S));
    this.add(groundPlane(-80, 80, SHORE, -0.65, sandMat, S));
    this.add(groundPlane(-80, -10, -0.65, 0.65, sandMat, S));
    this.add(groundPlane(4, 80, -0.65, 0.65, sandMat, S));
    // sloping wet beach down to the sea
    const slope = new THREE.PlaneGeometry(160, 14, 1, 28);
    slope.rotateX(-Math.PI / 2); slope.translate(0, 0, SHORE - 7);
    const sp2 = slope.attributes.position, wc = new Float32Array(sp2.count * 3);
    for (let i = 0; i < sp2.count; i++) {
      const z = sp2.getZ(i), y = (z - SHORE) * 0.075; sp2.setY(i, y);
      const w = clamp((SHORE - z) / 2.2, 0, 1), c = 1.35 - 0.35 * w;
      wc[i * 3] = c; wc[i * 3 + 1] = c; wc[i * 3 + 2] = c;
    }
    slope.setAttribute("color", new THREE.BufferAttribute(wc, 3)); slope.computeVertexNormals(); worldUV(slope, S);
    const sl = new THREE.Mesh(slope, wetMat); sl.receiveShadow = true; this.add(sl);
    // deformable strip under the walker
    const dMat = sandMat.clone();
    this.deform = new DeformGround(this.U, dMat, { x0: -10, L: 14, W: 1.3, res: 0.0175, depth: 0.05, rim: 0.012, darken: 0.55, uvScale: S, tint: [0.66, 0.58, 0.5] });
    this.add(this.deform.mesh);
    this.depth0 = 0.03; this.rim0 = 0.008;
    this.sandMats = [sandMat, wetMat, dMat];
    // sea
    this.sea = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uTime: this.U.uTime, uSun: { value: this.sunDir }, uFog: { value: new THREE.Color(0.42, 0.62, 0.86) }, uFogD: { value: 0.011 } },
      vertexShader: `uniform float uTime; varying vec3 vW; varying vec3 vN; varying float vDepth; varying float vFoamN;
        float sandH(float z){ return z > ${SHORE.toFixed(1)} ? 0.0 : (z - (${SHORE.toFixed(1)})) * 0.075; }
        void main(){
          vec3 p = position;
          float lvl = -0.2 + 0.08 * sin(uTime * 0.55) + 0.035 * sin(uTime * 1.13 + 1.3);
          float far = smoothstep(-6.5, -26.0, p.z);
          float k1 = 0.55, k2 = 1.3, k3 = 2.9;
          float w1 = sin(p.z * k1 + uTime * 1.1 + p.x * 0.05), w2 = sin(p.z * k2 - p.x * 0.35 + uTime * 1.9), w3 = sin(p.x * k3 * 0.4 + p.z * k3 + uTime * 2.7);
          float a1 = 0.16 * far + 0.02, a2 = 0.06 * far + 0.012, a3 = 0.02;
          p.y = lvl + a1 * w1 + a2 * w2 + a3 * w3;
          float dz = a1 * k1 * cos(p.z * k1 + uTime * 1.1 + p.x * 0.05) + a2 * k2 * cos(p.z * k2 - p.x * 0.35 + uTime * 1.9) + a3 * k3 * cos(p.x * k3 * 0.4 + p.z * k3 + uTime * 2.7);
          float dx = a1 * 0.05 * cos(p.z * k1 + uTime * 1.1 + p.x * 0.05) - a2 * 0.35 * cos(p.z * k2 - p.x * 0.35 + uTime * 1.9) + a3 * k3 * 0.4 * cos(p.x * k3 * 0.4 + p.z * k3 + uTime * 2.7);
          vN = normalize(vec3(-dx, 1.0, -dz));
          vDepth = p.y - sandH(p.z);
          vFoamN = w2 * 0.5 + w3 * 0.5;
          vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `uniform vec3 uSun, uFog; uniform float uFogD, uTime; varying vec3 vW; varying vec3 vN; varying float vDepth; varying float vFoamN;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          vec2 q = vW.xz * 1.6 + vec2(uTime * 0.25, uTime * 0.4);
          vec3 n = normalize(vN + vec3(vn(q) - 0.5, 0.0, vn(q + 7.3) - 0.5) * 0.18);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 deep = vec3(0.004, 0.06, 0.16), shallow = vec3(0.03, 0.42, 0.5);
          vec3 water = mix(shallow, deep, smoothstep(0.0, 1.6, vDepth));
          vec3 skyC = vec3(0.32, 0.55, 0.95);
          vec3 col = mix(water, skyC, fres);
          vec3 R = reflect(-V, n);
          col += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, normalize(uSun)), 0.0), 180.0) * 6.0;
          float foamEdge = 1.0 - smoothstep(0.0, 0.09, vDepth);
          float crest = smoothstep(0.55, 0.95, vFoamN) * smoothstep(-8.0, -12.0, vW.z) * 0.6;
          float foam = clamp(foamEdge * (0.65 + 0.35 * vn(vW.xz * 6.0 + uTime)) + crest * vn(vW.xz * 3.0 - uTime * 0.3), 0.0, 1.0);
          col = mix(col, vec3(0.95, 0.98, 1.0), foam);
          float alpha = clamp(smoothstep(0.0, 0.22, vDepth) * 0.92 + foam * 0.9, 0.0, 1.0);
          float d = length(vW - cameraPosition);
          col = mix(col, uFog, 1.0 - exp(-d * d * uFogD * uFogD));
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const seaGeo = new THREE.PlaneGeometry(420, 220, 210, 110);
    seaGeo.rotateX(-Math.PI / 2); seaGeo.translate(0, 0, SHORE - 0.6 - 110);
    const sea = new THREE.Mesh(seaGeo, this.sea); sea.frustumCulled = false; this.add(sea);
    // palms
    const ringTex = canvasTex(64, 256, (x, w, h) => {
      x.fillStyle = "#7b5f43"; x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) { x.fillStyle = "#5b4330"; x.fillRect(0, y, w, 4); x.fillStyle = "#9b7b58"; x.fillRect(0, y + 5, w, 2); }
    });
    ringTex.wrapS = ringTex.wrapT = THREE.RepeatWrapping; ringTex.repeat.set(2, 6);
    const trunkMat = patchWind(new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.9 }), this.U, { height: 7, amp: 0.25, key: "palmT" });
    const frondTex = canvasTex(256, 64, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.strokeStyle = "#3d7a2a"; x.lineWidth = 3; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      for (let i = 4; i < w - 6; i += 5) {
        const L = (h / 2) * (1 - (i / w) * 0.75);
        x.strokeStyle = i % 10 ? "#4f9a34" : "#3f8a2c"; x.lineWidth = 3;
        x.beginPath(); x.moveTo(i, h / 2); x.lineTo(i + 10, h / 2 - L); x.moveTo(i, h / 2); x.lineTo(i + 10, h / 2 + L); x.stroke();
      }
    });
    const frondMat = patchWind(new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }), this.U, { height: 7, amp: 0.25, flutter: 0.06, key: "frond" });
    const nutMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 });
    this.props = [];
    const prop = (obj, gx, z, range = [-50, 50], par = 1) => { obj.position.z = z; this.add(obj); this.props.push({ obj, gx, range, par }); return obj; };
    const palm = (s) => {
      const g = new THREE.Group(), lean = rand(0.6, 1.6) * (Math.random() < 0.5 ? 1 : -1);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.15, 2 * s, 0), new THREE.Vector3(lean * 0.55, 4 * s, 0), new THREE.Vector3(lean, 5.8 * s, 0)]);
      const tg = new THREE.TubeGeometry(curve, 24, 0.15 * s, 10, false);
      const pp = tg.attributes.position;
      for (let i = 0; i < pp.count; i++) { const y = pp.getY(i) / (5.8 * s); const t = curve.getPointAt(Math.min(1, Math.max(0, y))); pp.setX(i, t.x + (pp.getX(i) - t.x) * (1 - 0.35 * y)); pp.setZ(i, t.z + (pp.getZ(i) - t.z) * (1 - 0.35 * y)); }
      tg.computeVertexNormals();
      const tr = new THREE.Mesh(tg, trunkMat); tr.castShadow = true; g.add(tr);
      const top = curve.getPoint(1);
      for (let i = 0; i < 9; i++) {
        const fg = new THREE.PlaneGeometry(2.8 * s, 0.75 * s, 12, 1); fg.translate(1.4 * s, 0, 0);
        const fp = fg.attributes.position;
        for (let k = 0; k < fp.count; k++) { const u = fp.getX(k) / (2.8 * s); fp.setY(k, fp.getY(k) * 0.0 + 0.6 * s * u - 1.6 * s * u * u); fp.setZ(k, (fg.attributes.uv.getY(k) - 0.5) * 0.75 * s * (1 - u * 0.6)); }
        fg.computeVertexNormals();
        const f = new THREE.Mesh(fg, frondMat); f.castShadow = true;
        f.position.copy(top); f.rotation.y = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2); f.rotation.z = rand(-0.1, 0.25);
        g.add(f);
      }
      for (let i = 0; i < 4; i++) { const n = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 10, 8), nutMat); n.position.copy(top).add(new THREE.Vector3(rand(-0.15, 0.15), -0.15 * s, rand(-0.15, 0.15))); g.add(n); }
      return g;
    };
    for (let i = 0; i < 16; i++) { const back = i < 11; prop(palm(rand(0.85, 1.25)), rand(-50, 50), back ? rand(-5.5, -3) : rand(10, 20)); }
    // umbrellas, towels, rocks, shells, starfish
    const stripe = (a, b) => canvasTex(256, 32, (x, w, h) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? a : b; x.fillRect((i * w) / 8, 0, w / 8 + 1, h); } });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8).translate(0, 1.1, 0), poleMat); p.castShadow = true; g.add(p);
      const t = stripe(i % 2 ? "#1d4ed8" : "#22b8f0", "#f5f8ff"); t.wrapS = THREE.RepeatWrapping;
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.4, 16, 1, true).translate(0, 2.15, 0), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.65 }));
      c.castShadow = true; g.add(c);
      g.rotation.z = rand(-0.12, 0.12);
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.8).rotateX(-Math.PI / 2).translate(0.2, 0.005, 0.6), new THREE.MeshStandardMaterial({ map: stripe("#2563eb", "#e0f2ff"), roughness: 0.9 }));
      towel.receiveShadow = true; g.add(towel);
      prop(g, i * 21 + 6, i % 2 ? -3.2 : -2.4);
    }
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.85, vertexColors: true });
    for (let i = 0; i < 14; i++) { const s = rand(0.15, 0.6); const r = new THREE.Mesh(blob(s, 2, i * 3.3, 0.6, 0.3), rockMat); r.castShadow = true; r.receiveShadow = true; prop(r, rand(-50, 50), i < 9 ? rand(-5.8, -1.4) : rand(1.4, 6)); }
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.035 : 0.09; i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.01, bevelSegments: 2 }).rotateX(-Math.PI / 2);
    const starMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.7 });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xf3e6dc, roughness: 0.5 });
    for (let i = 0; i < 18; i++) {
      const o = i % 3 === 0 ? new THREE.Mesh(starGeo, starMat) : new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 10).rotateZ(Math.PI / 2), shellMat);
      o.rotation.y = rand(0, 6); o.castShadow = true;
      prop(o, rand(-50, 50), (Math.random() < 0.5 ? -1 : 1) * rand(0.8, 4));
    }
    // fauna & fx
    this.birds = new Birds(this, { kind: "gull", flock: 8, ground: 5, center: [0, 10, -22], radius: [10, 22], area: { x: [12, 26], z: [-3.2, 3.2] } });
    this.sand = new Particles(500, { gravity: -9.8, drag: 0.8 });
    this.spray = new Ambient(this.U, 220, { box: [30, 3, 10], center: [0, 1.2, -9], fall: -0.05, wind: 0.6, swirl: 0.6, size: 0.02, color: [1, 1, 1], additive: true, opacity: 0.35 });
    for (const p of [this.sand, this.spray]) { this.add(p.points); this.fx.push(p); }
    this.floorY = 0.005;
    this.tick.push((dt, t) => {
      scrollMaps(this.sandMats, this.g, S);
      for (const p of this.props) p.obj.position.x = wrap(p.gx + this.g * p.par, p.range[0], p.range[1]);
      this.birds.update(dt, t);
    });
  }
  sink(m) { return this.depth0 * clamp(Math.sqrt(m.BW / 637), 0.75, 1.45) * 0.85; }
  stamp(fig, m, side) {
    const wf = clamp(Math.sqrt(m.BW / 637), 0.75, 1.45);
    this.deform.stampFoot(fig, m, side, this.g, -this.sink(m), this.depth0 * wf, this.rim0 * wf);
  }
  onStep(ev) {
    const c = ev.fig.contacts(ev.side);
    const sandCol = () => { const k = rand(0.8, 1.05); return [0.86 * k, 0.76 * k, 0.58 * k]; };
    if (ev.type === "TO") this.sand.emit(16, c.tip, { v: [-0.5, 1.1, 0], j: [0.45, 0.5, 0.35], life: [0.4, 0.8], size: [0.012, 0.026], color: sandCol, alpha: 0.95 });
    else this.sand.emit(7, c.heel, { v: [0.15, 0.6, 0], j: [0.35, 0.3, 0.35], life: [0.3, 0.6], size: [0.01, 0.02], color: sandCol, alpha: 0.9 });
  }
}
