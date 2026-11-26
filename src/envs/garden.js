import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Env } from "./base.js";
import { makeNoise, genTextures, canvasTex, groundPlane, scrollMaps, patchWind, Particles, Ambient, gradientEnvironment, Birds, Butterflies, rand, wrap, clamp } from "./common.js";

const N = makeNoise(7);

export function blob(radius, detail, seed, squash = 1, rough = 0.18) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position, v = new THREE.Vector3(), col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const d = 1 + rough * N.noise(n.x * 2.3 + seed, n.y * 2.3 + n.z * 1.7 + seed * 0.37, 64) + rough * 0.5 * N.noise(n.x * 6 + seed, n.z * 6 - seed, 64);
    v.multiplyScalar(d); v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
    const ao = clamp(0.55 + 0.45 * (n.y * 0.5 + 0.5), 0, 1);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function voronoiTex(size, cells, { stone, mortar, seed = 3, normal = 3 }) {
  const pts = [];
  let s = seed * 999;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + 0.15 + r() * 0.7) / cells, (j + 0.15 + r() * 0.7) / cells, r()]);
  return genTextures(size, (u, v) => {
    const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
    let d1 = 9, d2 = 9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells, P = pts[jj * cells + ii];
      let dx = P[0] - u, dy = P[1] - v;
      dx -= Math.round(dx); dy -= Math.round(dy);
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; id = P[2]; } else if (d < d2) d2 = d;
    }
    const edge = (d2 - d1) * cells;
    const st = clamp((edge - 0.08) / 0.12, 0, 1);
    const n = N.fbm(u * 8, v * 8, 8, 3);
    const c = st > 0 ? stone(id, n) : mortar(n);
    const k = st * (0.85 + 0.15 * id);
    return [c[0] * (0.75 + 0.25 * k), c[1] * (0.75 + 0.25 * k), c[2] * (0.75 + 0.25 * k), 0.4 * st + 0.08 * n + 0.2 * Math.sqrt(st) * (1 - d1 * cells * 0.6)];
  }, { normalStrength: normal });
}

export class GardenEnv extends Env {
  build() {
    this.windy = true;
    const sunDir = new THREE.Vector3(0.45, 0.62, 0.64).normalize();
    const sky = gradientEnvironment(this.stage.pmrem, [0.05, 0.22, 0.78], [0.6, 0.8, 0.98], [0.32, 0.42, 0.3], sunDir, [1.6, 1.45, 1.2], 1.2);
    this.rts.push(sky.rt);
    const sunPos = sunDir.clone().multiplyScalar(12);
    this.light = {
      exposure: 0.78, bloom: [0.35, 0.5, 2.6], fog: [0xa9c8ec, 0.011], background: sky.texture, env: sky.texture, envIntensity: 0.85,
      hemi: [0xcfe4ff, 0x40602c, 0.55], sun: { color: 0xfff0dc, intensity: 3.6, pos: [sunPos.x, sunPos.y, sunPos.z] },
      rimA: { color: 0x8fc0ff, intensity: 0.7, pos: [-5, 3, -4] }, rimB: { color: 0xbfe6ff, intensity: 0.35, pos: [-3, 2, 5] },
    };
    // ground
    const grassT = genTextures(512, (u, v) => {
      const a = N.fbm(u * 6, v * 6, 6, 4), b = N.fbm(u * 40, v * 40, 40, 2), c = N.fbm(u * 2, v * 2, 2, 3);
      const k = 0.5 + 0.5 * a;
      return [60 + 40 * k + 25 * c + 18 * b, 95 + 55 * k + 20 * b, 38 + 20 * k, 0.5 + 0.5 * b];
    }, { normalStrength: 2.5 });
    grassT.map.repeat.set(1, 1); grassT.normal.repeat.set(1, 1);
    const grassMat = new THREE.MeshStandardMaterial({ map: grassT.map, normalMap: grassT.normal, roughness: 0.95, color: 0xb8d39a });
    const pathT = voronoiTex(512, 7, {
      stone: (id, n) => [172 + 40 * id + 20 * n, 168 + 34 * id + 18 * n, 156 + 28 * id + 14 * n],
      mortar: (n) => [92 + 20 * n, 96 + 20 * n, 78 + 16 * n], seed: 5, normal: 4,
    });
    const pathMat = new THREE.MeshStandardMaterial({ map: pathT.map, normalMap: pathT.normal, roughness: 0.82 });
    this.groundMats = [grassMat];
    this.add(groundPlane(-80, 80, -80, -0.82, grassMat, 0.25, -0.012));
    this.add(groundPlane(-80, 80, 0.82, 80, grassMat, 0.25, -0.012));
    this.add(groundPlane(-80, 80, -0.82, 0.82, pathMat, 0.5, 0));
    this.pathMat = pathMat;
    // path border stones
    const stoneMat = patchWind(new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.75 }), this.U, { amp: 0, instScroll: [-24, 24], key: "st" });
    const stoneGeo = new THREE.DodecahedronGeometry(1, 1).scale(0.09, 0.05, 0.07);
    const nSt = 2 * Math.floor(48 / 0.26), stones = new THREE.InstancedMesh(stoneGeo, stoneMat, nSt);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), po = new THREE.Vector3(), eu = new THREE.Euler();
    let k = 0;
    for (const zs of [-0.86, 0.86]) for (let x = -24; x < 24 && k < nSt; x += 0.26) {
      po.set(x + rand(-0.03, 0.03), 0.0, zs + rand(-0.025, 0.025)); q.setFromEuler(eu.set(0, rand(0, 6), 0)); sc.setScalar(rand(0.8, 1.2));
      stones.setMatrixAt(k++, m4.compose(po, q, sc));
    }
    stones.receiveShadow = true; stones.castShadow = true; stones.frustumCulled = false; this.add(stones);
    // grass blades
    const blade = new THREE.PlaneGeometry(0.035, 1, 1, 4);
    blade.translate(0, 0.5, 0);
    const bp = blade.attributes.position, bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i); bp.setX(i, bp.getX(i) * (1 - y * 0.92)); bp.setZ(i, y * y * 0.12);
      const c = 0.35 + 0.65 * y; bc[i * 3] = c * 0.75; bc[i * 3 + 1] = c; bc[i * 3 + 2] = c * 0.6;
    }
    blade.setAttribute("color", new THREE.BufferAttribute(bc, 3)); blade.computeVertexNormals();
    const bladeMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, color: 0x8fbf5a }), this.U, { height: 0.42, amp: 0.05, flutter: 0.012, instScroll: [-22, 22], key: "grass" });
    const nB = 9000, blades = new THREE.InstancedMesh(blade, bladeMat, nB), col = new THREE.Color();
    for (let i = 0; i < nB; i++) {
      let z; do { z = rand(-12, 12) * Math.pow(Math.random(), 0.35); } while (Math.abs(z) < 0.95);
      po.set(rand(-22, 22), -0.012, z); q.setFromEuler(eu.set(0, rand(0, 6.28), 0));
      const hgt = rand(0.12, 0.34) * (1 + 0.4 * Math.max(0, N.noise(po.x * 0.3, z * 0.3, 64))); sc.set(rand(0.7, 1.3), hgt, 1);
      blades.setMatrixAt(i, m4.compose(po, q, sc));
      blades.setColorAt(i, col.setHSL(0.24 + rand(-0.04, 0.05), 0.55, rand(0.32, 0.5)));
    }
    blades.frustumCulled = false; blades.receiveShadow = true; this.add(blades);
    // flowers
    const petals = [];
    for (let i = 0; i < 5; i++) { const pg = new THREE.SphereGeometry(1, 8, 6).scale(0.022, 0.006, 0.011).translate(0.022, 0, 0).rotateY((i / 5) * Math.PI * 2); petals.push(pg); }
    petals.push(new THREE.SphereGeometry(0.009, 8, 6).translate(0, 0.004, 0));
    const headGeo = mergeGeometries(petals);
    const nF = 520, stemGeo = new THREE.CylinderGeometry(0.0025, 0.003, 1, 4).translate(0, 0.5, 0);
    const stemMat = patchWind(new THREE.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 0.8 }), this.U, { height: 0.5, amp: 0.05, flutter: 0.01, instScroll: [-22, 22], key: "stem" });
    const headMat = patchWind(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, emissive: 0x0a1a33 }), this.U, { height: 0.5, amp: 0.05, flutter: 0.01, instScroll: [-22, 22], key: "fhead" });
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, nF), heads = new THREE.InstancedMesh(headGeo, headMat, nF);
    const pal = [0xffffff, 0x9fd2ff, 0x5c7cff, 0x8fb4ff, 0xffe066, 0xd7b8ff, 0x3fa0ff];
    for (let i = 0; i < nF; i++) {
      const z = (Math.random() < 0.5 ? -1 : 1) * rand(1.0, i < 350 ? 3.4 : 10);
      const x = rand(-22, 22), hgt = rand(0.16, 0.42);
      po.set(x, -0.012, z); q.identity(); sc.set(1, hgt, 1); stems.setMatrixAt(i, m4.compose(po, q, sc));
      po.set(x, hgt - 0.012, z); q.setFromEuler(eu.set(rand(-0.3, 0.3), rand(0, 6), rand(-0.3, 0.3))); sc.setScalar(rand(0.8, 1.5)); heads.setMatrixAt(i, m4.compose(po, q, sc));
      heads.setColorAt(i, col.setHex(pal[i % pal.length]));
    }
    for (const im of [stems, heads]) { im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; this.add(im); }
    // trees, bushes, lamps, benches (scroll on CPU)
    const leafT = genTextures(256, (u, v) => { const n = N.fbm(u * 16, v * 16, 16, 3); return [70 + 60 * n, 120 + 70 * n, 50 + 30 * n, 0.5 + 0.5 * n]; }, { normalStrength: 6 });
    leafT.map.repeat.set(3, 3); leafT.normal.repeat.set(3, 3);
    const leafMats = [0x4f8f3a, 0x3d7a34, 0x6a9a3c, 0x2f6a46].map((c, i) => patchWind(new THREE.MeshStandardMaterial({ color: c, map: leafT.map, normalMap: leafT.normal, vertexColors: true, roughness: 0.85, emissive: 0x0b1f08 }), this.U, { height: 7, amp: 0.22, flutter: 0.02, key: "leaf" + i }));
    const barkT = genTextures(256, (u, v) => { const n = N.fbm(u * 4, v * 24, 4, 4); return [70 + 40 * n, 55 + 30 * n, 42 + 22 * n, 0.5 + 0.5 * n]; }, { normalStrength: 5 });
    const barkMat = patchWind(new THREE.MeshStandardMaterial({ map: barkT.map, normalMap: barkT.normal, roughness: 0.9 }), this.U, { height: 7, amp: 0.22, key: "bark" });
    const pineMat = patchWind(new THREE.MeshStandardMaterial({ color: 0x24533a, roughness: 0.85, map: leafT.map, normalMap: leafT.normal }), this.U, { height: 9, amp: 0.15, flutter: 0.01, key: "pine" });
    this.props = [];
    const prop = (obj, gx, z, range = [-45, 45], par = 1) => { obj.position.z = z; this.add(obj); this.props.push({ obj, gx, range, par }); return obj; };
    const tree = (s, seed) => {
      const g = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * s, 0.24 * s, 3.2 * s, 10, 6).translate(0, 1.6 * s, 0), barkMat);
      tr.castShadow = true; g.add(tr);
      for (let b = 0; b < 3; b++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.08 * s, 1.4 * s, 6).translate(0, 0.7 * s, 0), barkMat);
        br.position.y = (2.2 + b * 0.35) * s; br.rotation.set(rand(-0.9, 0.9), rand(0, 6), rand(-0.9, 0.9)); br.castShadow = true; g.add(br);
      }
      const parts = [];
      const nb = 6 + Math.floor(rand(0, 4));
      for (let i = 0; i < nb; i++) {
        const r = rand(0.9, 1.5) * s, a = (i / nb) * 6.28 + rand(-0.3, 0.3), d = i === 0 ? 0 : rand(0.6, 1.3) * s;
        parts.push(blob(r, 3, seed + i * 3.1, 0.85).translate(Math.cos(a) * d, (3.6 + rand(-0.3, 1.0)) * s + (i === 0 ? 0.6 * s : 0), Math.sin(a) * d));
      }
      const fol = new THREE.Mesh(mergeGeometries(parts), leafMats[seed % leafMats.length]);
      fol.castShadow = true; fol.receiveShadow = true; g.add(fol);
      return g;
    };
    const pine = (s) => {
      const g = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.16 * s, 2 * s, 8).translate(0, 1 * s, 0), barkMat); g.add(tr);
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry((1.5 - i * 0.3) * s, 1.8 * s, 14, 3).translate(0, (1.6 + i * 1.05) * s, 0), pineMat);
        c.castShadow = true; g.add(c);
      }
      return g;
    };
    for (let i = 0; i < 30; i++) {
      const back = i < 20, z = back ? rand(-26, -5) : rand(9.5, 24), gx = rand(-45, 45), s = rand(0.75, 1.35);
      prop(i % 5 === 4 ? pine(s) : tree(s, i), gx, z);
    }
    for (let i = 0; i < 46; i++) {
      const back = i < 26, z = back ? rand(-6, -1.5) : rand(1.6, 7.5), s = back ? rand(0.35, 0.8) : rand(0.25, 0.5);
      const b = new THREE.Mesh(blob(1, 2, i * 1.7, 0.7, 0.25).scale(s, s, s).translate(0, s * 0.45, 0), leafMats[i % leafMats.length]);
      b.castShadow = true; b.receiveShadow = true;
      prop(b, rand(-45, 45), z);
    }
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.8, roughness: 0.35 });
    const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 3.0), toneMapped: false });
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3, 10).translate(0, 1.5, 0), poleMat); p.castShadow = true; g.add(p);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04).translate(0.22, 2.95, 0), poleMat); g.add(arm);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.14, 16).translate(0.42, 2.86, 0), poleMat); g.add(head);
      const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16).translate(0.42, 2.78, 0), lampGlow); g.add(bulb);
      g.rotation.y = Math.PI / 2;
      prop(g, i * 9, -1.3);
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      for (let k2 = 0; k2 < 3; k2++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.11), wood); sl.position.set(0, 0.45, -0.13 + k2 * 0.13); sl.castShadow = true; g.add(sl); }
      for (let k2 = 0; k2 < 2; k2++) { const bk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.11, 0.035), wood); bk.position.set(0, 0.62 + k2 * 0.15, -0.22); bk.rotation.x = -0.12; bk.castShadow = true; g.add(bk); }
      for (const sx of [-0.65, 0.65]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.32), poleMat); lg.position.set(sx, 0.22, -0.05); g.add(lg); }
      prop(g, i * 22 + 5, -1.9);
    }
    // far hills (parallax) and clouds
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x4f7d5a, roughness: 1, vertexColors: true });
    for (let i = 0; i < 9; i++) {
      const h = new THREE.Mesh(blob(1, 3, i * 5.5, 1, 0.12), hillMat);
      h.scale.set(rand(22, 40), rand(8, 16), rand(14, 22)); h.position.y = -4;
      prop(h, rand(-130, 130), rand(-95, -60), [-130, 130], 0.12);
    }
    const cloudTex = canvasTex(256, 128, (x, w, h) => {
      for (let i = 0; i < 26; i++) {
        const cx = rand(40, w - 40), cy = rand(h * 0.35, h * 0.7), r = rand(18, 42);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
      }
    });
    const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85, fog: false });
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(cloudMat); sp.scale.set(rand(28, 46), rand(10, 16), 1);
      sp.position.set(rand(-120, 120), rand(26, 44), rand(-110, -50)); this.add(sp); this.clouds.push({ sp, x0: sp.position.x });
    }
    // fauna & particles
    this.birds = new Birds(this, { kind: "sparrow", flock: 11, ground: 8, center: [3, 12, -16], radius: [8, 17], area: { x: [12, 26], z: [-3, 3] } });
    this.butterflies = new Butterflies(this, 8);
    const leafTex = canvasTex(64, 64, (x) => {
      x.translate(32, 32); x.rotate(0.6);
      const g = x.createLinearGradient(-20, 0, 20, 0); g.addColorStop(0, "#9bd35a"); g.addColorStop(1, "#4f8f2c");
      x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, 24, 11, 0, 0, 7); x.fill();
      x.strokeStyle = "rgba(30,60,20,0.6)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-22, 0); x.lineTo(22, 0); x.stroke();
    });
    this.leaves = new Ambient(this.U, 160, { box: [28, 9, 20], center: [0, 4.5, -2], fall: 0.45, wind: 0.9, swirl: 1.1, size: 0.07, texture: leafTex, spin: 1.2, opacity: 0.95 });
    this.motes = new Ambient(this.U, 260, { box: [16, 4, 12], center: [0, 2, 0], fall: -0.04, wind: 0.2, swirl: 0.3, size: 0.012, color: [1.0, 0.96, 0.8], additive: true, opacity: 0.5 });
    this.dust = new Particles(400, { gravity: -0.6, drag: 3 });
    for (const p of [this.leaves, this.motes, this.dust]) { this.add(p.points); this.fx.push(p); }
    this.floorY = -0.01;
    this.tick.push((dt, t) => {
      scrollMaps([grassMat], this.g, 0.25);
      scrollMaps([pathMat], this.g, 0.5);
      for (const p of this.props) p.obj.position.x = wrap(p.gx + this.g * p.par, p.range[0], p.range[1]);
      for (const c of this.clouds) c.sp.position.x = wrap(c.x0 + t * 0.6 + this.g * 0.05, -130, 130);
      this.birds.update(dt, t);
      this.butterflies.update(dt, t);
    });
  }
  onStep(ev) {
    const c = ev.fig.contacts(ev.side), p = ev.type === "IC" ? c.heel : c.tip;
    this.dust.emit(ev.type === "IC" ? 5 : 4, p, { v: [ev.type === "IC" ? 0.1 : -0.25, 0.25, 0], j: [0.25, 0.12, 0.25], life: [0.5, 1.1], size: [0.03, 0.07], color: [0.78, 0.72, 0.6], alpha: 0.35, grow: 0.12 });
  }
}
