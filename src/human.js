// Realistic human built from the MakeHuman hm08 base mesh (CC0), driven by the gait model.
import * as THREE from "three";
import humanGz from "./assets/human.gz";
import { gunzipSync } from "fflate";
import { rad, angles, clamp } from "./model.js";
import { IMU_SITES } from "./data.js";

// ------------------------------------------------------------------ asset decoding
let DATA = null;
function data() {
  if (DATA) return DATA;
  const u8 = gunzipSync(humanGz), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hlen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hlen)));
  const base = 4 + hlen, A = {};
  const T = { float32: Float32Array, uint16: Uint16Array, uint8: Uint8Array, int8: Int8Array, int16: Int16Array };
  for (const [name, a] of Object.entries(header.arrays)) A[name] = new T[a.dtype](u8.slice(base + a.offset, base + a.offset + a.bytes).buffer);
  A.basef = new Float32Array(A.base.length);
  for (let i = 0; i < A.base.length; i++) A.basef[i] = A.base[i] * header.pscale;
  A.ruvf = new Float32Array(A.ruv.length);
  for (let i = 0; i < A.ruv.length; i++) A.ruvf[i] = A.ruv[i] / 65535;
  const B = header.bones.map((b) => ({ ...b }));
  const index = Object.fromEntries(B.map((b, i) => [b.name, i]));
  DATA = { header, A, B, index, NB: 13380 };
  return DATA;
}
export const BONE = () => data().index;

// ------------------------------------------------------------------ shared textures
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const D = data();
  const mk = (w, h, draw, srgb = false, rep = 1) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
  };
  // normal map from a height painter
  const nrm = (size, paint, strength, rep) => mk(size, size, (x) => {
    paint(x, size);
    const src = x.getImageData(0, 0, size, size), H = new Float32Array(size * size);
    for (let i = 0; i < H.length; i++) H[i] = src.data[i * 4] / 255;
    const out = x.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) {
      const l = H[y * size + ((k - 1 + size) % size)], r = H[y * size + ((k + 1) % size)], u = H[((y - 1 + size) % size) * size + k], d = H[((y + 1) % size) * size + k];
      let nx = (l - r) * strength, ny = (d - u) * strength; const nz = 1, L = Math.hypot(nx, ny, nz);
      const i = (y * size + k) * 4; out.data[i] = (nx / L * 0.5 + 0.5) * 255; out.data[i + 1] = (ny / L * 0.5 + 0.5) * 255; out.data[i + 2] = (nz / L * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
  }, false, rep);
  const pores = nrm(256, (x, s) => { x.fillStyle = "#808080"; x.fillRect(0, 0, s, s); for (let i = 0; i < 2600; i++) { const g = 100 + Math.random() * 60 | 0; x.fillStyle = `rgb(${g},${g},${g})`; x.beginPath(); x.arc(Math.random() * s, Math.random() * s, Math.random() * 1.3 + 0.3, 0, 7); x.fill(); } }, 3, 6);
  const knit = nrm(128, (x, s) => { x.fillStyle = "#808080"; x.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 4) for (let k = 0; k < s; k += 4) { x.fillStyle = (y / 4 + k / 4) % 2 ? "#a0a0a0" : "#606060"; x.fillRect(k, y, 4, 2); } }, 2.2, 22);
  const strands = nrm(256, (x, s) => { x.fillStyle = "#808080"; x.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++) { const g = 60 + Math.random() * 140 | 0; x.strokeStyle = `rgb(${g},${g},${g})`; x.lineWidth = 0.6 + Math.random(); const px = Math.random() * s; x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + 6, s * 0.3, px - 6, s * 0.6, px + Math.random() * 8 - 4, s); x.stroke(); } }, 4, 3);
  const eyeImg = new Image();
  const eye = new THREE.Texture(eyeImg); eye.colorSpace = THREE.SRGBColorSpace;
  eyeImg.onload = () => { eye.needsUpdate = true; };
  let bin = "";
  for (let i = 0; i < D.A.e_jpg.length; i += 0x8000) bin += String.fromCharCode.apply(null, D.A.e_jpg.subarray(i, i + 0x8000));
  eyeImg.src = "data:image/jpeg;base64," + btoa(bin);
  TEX = { pores, knit, strands, eye };
  return TEX;
}

// ------------------------------------------------------------------ body shape
const SKIN = [[0.86, 0.68, 0.55], [0.79, 0.59, 0.45], [0.69, 0.5, 0.37], [0.9, 0.74, 0.62]];
const lin = (c) => c.map((x) => Math.pow(x, 2.2));
// garments are cut along smooth per-vertex distance fields (discard where the field < 0)
function cutPatch(mat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aCut; varying float vCut;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvCut = aCut;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vCut;").replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vCut < 0.0) discard;");
  };
  mat.customProgramCacheKey = () => (mat.isMeshDepthMaterial ? "dcut" : "cut");
  return mat;
}
function bmiToWeight(b) { return b <= 16.5 ? 0 : b < 22 ? ((b - 16.5) / 5.5) * 0.5 : b < 29 ? 0.5 + ((b - 22) / 7) * 0.5 : Math.min(1.75, 1 + (b - 29) / 15); }
function morph(o) {
  const { header, A } = data();
  const P = new Float32Array(A.basef);
  const g = o.sex === "F" ? "female" : "male";
  const old = clamp((o.age - 25) / 65, 0, 1);
  const wv = bmiToWeight(o.wt / (o.ht / 100) ** 2);
  const add = (name, w) => {
    if (Math.abs(w) < 1e-4) return;
    const t = header.targets.find((x) => x.name === name), idx = A["t_idx_" + name], d = A["t_d_" + name], k = w * t.scale;
    for (let i = 0; i < idx.length; i++) { const v = idx[i] * 3; P[v] += d[i * 3] * k; P[v + 1] += d[i * 3 + 1] * k; P[v + 2] += d[i * 3 + 2] * k; }
  };
  for (const [age, aw] of [["young", 1]]) {
    add(`asian-${g}-${age}`, aw);
    if (wv < 0.5) add(`universal-${g}-${age}-averagemuscle-minweight`, (aw * (0.5 - wv)) / 0.5);
    else add(`universal-${g}-${age}-averagemuscle-maxweight`, (aw * (wv - 0.5)) / 0.5);
  }
  return P;
}
function jointPos(P, A, [start, n], out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  for (let k = 0; k < n; k++) { const v = A.jidx[start + k] * 3; out.x += P[v]; out.y += P[v + 1]; out.z += P[v + 2]; }
  return out.multiplyScalar(1 / n);
}
function vertexNormals(P, tris, rv, nBase) {
  const N = new Float32Array(nBase * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < tris.length; i += 3) {
    const i0 = rv[tris[i]], i1 = rv[tris[i + 1]], i2 = rv[tris[i + 2]];
    a.fromArray(P, i0 * 3); b.fromArray(P, i1 * 3).sub(a); c.fromArray(P, i2 * 3).sub(a); b.cross(c);
    for (const v of [i0, i1, i2]) { N[v * 3] += b.x; N[v * 3 + 1] += b.y; N[v * 3 + 2] += b.z; }
  }
  for (let v = 0; v < nBase; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  return N;
}

// ------------------------------------------------------------------ the figure
const RAMP = [[0, [0.01, 0.06, 0.2]], [0.35, [0.0, 0.45, 1.0]], [0.7, [0.3, 0.92, 1.0]], [1, [1.0, 1.0, 1.0]]];
function ramp(x, out) {
  x = clamp(x, 0, 1);
  for (let i = 1; i < RAMP.length; i++) if (x <= RAMP[i][0]) { const [x0, c0] = RAMP[i - 1], [x1, c1] = RAMP[i], f = (x - x0) / (x1 - x0); return out.setRGB(c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f); }
  return out.setRGB(1, 1, 1);
}
const MUSCLE_IDS = () => data().header.muscles;

export class Human {
  constructor(color = "#38c6ff", skinTone = 0) {
    this.root = new THREE.Group();
    this.color = new THREE.Color(color);
    this.skinTone = skinTone;
    this.key = "";
    this.ghost = false;
    this.muscles = [];
    this.pickables = [];
    this.anchors = {};
    this.mats = [];
    this.overlayMats = {};
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.root.clear();
  }

  setColor(c) { this.color.set(c); if (this.shirtMat) { this.shirtMat.color.copy(this.color); this.shoeAccent.color.copy(this.color); } }

  build(m) {
    const o = m.o, key = [o.ht, o.wt, o.sex, o.age, o.mode].join("|");
    if (key === this.key) return;
    this.key = key;
    this.dispose();
    const D = data(), A = D.A, B = D.B, NB = D.NB, tex = textures();
    const F = o.sex === "F";
    const P = morph(o);
    // stature & scale to the subject height
    let minY = Infinity;
    for (let v = 0; v < NB; v++) minY = Math.min(minY, P[v * 3 + 1]);
    const headTop = jointPos(P, A, B[D.index.head].tail).y;
    const s = (o.ht / 100) / (headTop - minY + 0.012);
    for (let i = 0; i < P.length; i += 3) { P[i] *= s; P[i + 1] = (P[i + 1] - minY) * s; P[i + 2] *= s; }
    this.P = P;
    const nb = vertexNormals(P, A.tris, A.rv, A.base.length / 3);

    // ---------- skeleton (identity rest rotations, joints from the morphed mesh)
    const heads = B.map((b) => jointPos(P, A, b.head)), tails = B.map((b) => jointPos(P, A, b.tail));
    const bones = B.map((b) => { const bn = new THREE.Bone(); bn.name = b.name; return bn; });
    B.forEach((b, i) => { if (b.parent >= 0) { bones[b.parent].add(bones[i]); bones[i].position.copy(heads[i]).sub(heads[b.parent]); } else bones[i].position.copy(heads[i]); });
    this.bones = bones; this.boneIdx = D.index; this.heads = heads; this.tails = tails;
    const body = (this.body = new THREE.Group());
    this.root.add(body);
    const skeleton = (this.skeleton = new THREE.Skeleton(bones));
    // neutral-pose fix rotations (A-pose -> anatomical neutral)
    const down = new THREE.Vector3(0, -1, 0);
    this.N = B.map((b, i) => {
      const n = b.name;
      if (/^(upperleg|lowerleg|upperarm|lowerarm|wrist)/.test(n)) {
        const d = tails[i].clone().sub(heads[i]).normalize();
        return new THREE.Quaternion().setFromUnitVectors(d, down);
      }
      return new THREE.Quaternion();
    });

    // ---------- body mesh
    const nR = A.rv.length;
    const pos = new Float32Array(nR * 3), nor = new Float32Array(nR * 3), col = new Float32Array(nR * 3), si = new Uint16Array(nR * 4), sw = new Float32Array(nR * 4);
    const tone = lin(SKIN[this.skinTone % SKIN.length]);
    const hair = lin(F ? [0.16, 0.11, 0.08] : [0.1, 0.08, 0.065]);
    const lip = lin(F ? [0.72, 0.38, 0.38] : [0.68, 0.44, 0.4]);
    const cut = (name) => A["cut_" + name];
    const cv = (name, v) => (v < NB ? cut(name)[v] * 0.002 * s : -1);
    for (let r = 0; r < nR; r++) {
      const v = A.rv[r];
      for (let k = 0; k < 3; k++) { pos[r * 3 + k] = P[v * 3 + k]; nor[r * 3 + k] = nb[v * 3 + k]; }
      for (let k = 0; k < 4; k++) { si[r * 4 + k] = A.skinI[v * 4 + k]; sw[r * 4 + k] = A.skinW[v * 4 + k] / 255; }
      const br = (A.brow[v] || 0) / 255, lp = (A.lips[v] || 0) / 255, nz = 0.96 + 0.04 * Math.sin(v * 12.9898) ;
      for (let k = 0; k < 3; k++) col[r * 3 + k] = (tone[k] * nz * (1 - br * 0.85) + hair[k] * br * 0.85) * (1 - lp * 0.6) + lip[k] * lp * 0.6;
    }
    // hide skin well inside the garments, and the missing limb below the socket
    const topCut = F ? "tank" : "shirt";
    const ampRes = m.ampSide ? "res" + m.ampSide : null;
    const covered = (v) => v < NB && (cv(topCut, v) > 0.006 || cv("shorts", v) > 0.006 || cv("shoe", v) > 0.006 || (ampRes && cv(ampRes, v) > -0.01));
    const idx = [];
    for (let i = 0; i < A.tris.length; i += 3) {
      const a = A.rv[A.tris[i]], b = A.rv[A.tris[i + 1]], c = A.rv[A.tris[i + 2]];
      if (ampRes && (cv(ampRes, a) > -0.01 || cv(ampRes, b) > -0.01 || cv(ampRes, c) > -0.01)) continue;
      if (covered(a) && covered(b) && covered(c)) continue;
      idx.push(A.tris[i], A.tris[i + 1], A.tris[i + 2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(A.ruvf, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    geo.setIndex(idx);
    const skinMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, normalMap: tex.pores, normalScale: new THREE.Vector2(0.12, 0.12), sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.85, 0.42, 0.32) });
    const mesh = new THREE.SkinnedMesh(geo, skinMat);
    mesh.add(bones[0]);
    mesh.bind(skeleton);
    mesh.castShadow = true; mesh.receiveShadow = true;
    body.add(mesh);
    this.mesh = mesh;

    // ---------- shell garments from body regions (share skinning with the body)
    // compact sub-mesh of the body (only the vertices a garment uses)
    const subMesh = (sel, place) => {
      const map = new Int32Array(nR).fill(-1), used = [], ids = [];
      for (let i = 0; i < A.tris.length; i += 3) {
        const a = A.tris[i], b = A.tris[i + 1], c = A.tris[i + 2];
        if (!sel(a, b, c)) continue;
        for (const r of [a, b, c]) { if (map[r] < 0) { map[r] = used.length; used.push(r); } ids.push(map[r]); }
      }
      const n = used.length, p2 = new Float32Array(n * 3), n2 = new Float32Array(n * 3), uv2 = new Float32Array(n * 2), si2 = new Uint16Array(n * 4), sw2 = new Float32Array(n * 4);
      used.forEach((r, j) => {
        const v = A.rv[r];
        place(v, r, j, p2);
        for (let k = 0; k < 3; k++) n2[j * 3 + k] = nor[r * 3 + k];
        uv2[j * 2] = A.ruvf[r * 2]; uv2[j * 2 + 1] = A.ruvf[r * 2 + 1];
        for (let k = 0; k < 4; k++) { si2[j * 4 + k] = si[r * 4 + k]; sw2[j * 4 + k] = sw[r * 4 + k]; }
      });
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.BufferAttribute(p2, 3));
      g2.setAttribute("normal", new THREE.BufferAttribute(n2, 3));
      g2.setAttribute("uv", new THREE.BufferAttribute(uv2, 2));
      g2.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si2, 4));
      g2.setAttribute("skinWeight", new THREE.BufferAttribute(sw2, 4));
      g2.setIndex(ids);
      return { g2, used, map };
    };
    this.subMesh = subMesh;
    const shell = (field, thick, mat) => {
      const ac = new Float32Array(nR);
      for (let r = 0; r < nR; r++) ac[r] = cv(field, A.rv[r]);
      const { g2, used } = subMesh((a, b, c) => Math.max(ac[a], ac[b], ac[c]) > 0, (v, r, j, p2) => {
        const t = typeof thick === "function" ? thick(v) : thick;
        for (let k = 0; k < 3; k++) p2[j * 3 + k] = P[v * 3 + k] + nb[v * 3 + k] * t;
      });
      g2.setAttribute("aCut", new THREE.BufferAttribute(Float32Array.from(used, (r) => ac[r]), 1));
      const sm = new THREE.SkinnedMesh(g2, mat);
      sm.bind(skeleton, mesh.bindMatrix);
      sm.castShadow = true; sm.receiveShadow = true;
      sm.customDepthMaterial = cutPatch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), "d" + field);
      body.add(sm);
      return sm;
    };
    this.shirtMat = cutPatch(new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.8, normalMap: tex.knit, normalScale: new THREE.Vector2(0.35, 0.35) }), "shirt");
    const shortsMat = cutPatch(new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.72, normalMap: tex.knit, normalScale: new THREE.Vector2(0.3, 0.3) }), "shorts");
    const shoeMat = cutPatch(new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.55, normalMap: tex.knit, normalScale: new THREE.Vector2(0.25, 0.25) }), "shoe");
    this.shoeAccent = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.5 });
    const hairMat = cutPatch(new THREE.MeshStandardMaterial({ color: new THREE.Color(...hair).multiplyScalar(1.4), roughness: 0.45, normalMap: tex.strands, normalScale: new THREE.Vector2(0.8, 0.8), side: THREE.DoubleSide }), "hair");
    shell(topCut, F ? 0.0035 : 0.0045, this.shirtMat);
    shell("shorts", 0.0055, shortsMat);
    const isAmp = { L: m.ampSide === "L", R: m.ampSide === "R" };
    shell("shoe", (v) => 0.006 + 0.007 * clamp(P[v * 3 + 1] / 0.07, 0, 1), shoeMat);
    const headY = heads[D.index.head].y;
    shell(F ? "long" : "hair", (v) => 0.005 + (F ? 0.014 : 0.011) * clamp((P[v * 3 + 1] - headY) / 0.14, 0, 1) + 0.002 * Math.sin(v * 7.13), hairMat);
    this.mats = [skinMat, this.shirtMat, shortsMat, shoeMat, this.shoeAccent, hairMat];
    if (F) {
      // ponytail (child of the head bone, swings while walking)
      const hb = bones[D.index.head], eyeC = new THREE.Vector3(...D.header.eyeL).add(new THREE.Vector3(...D.header.eyeR)).multiplyScalar(0.5);
      eyeC.multiplyScalar(s); eyeC.y = (D.header.eyeL[1] - minY) * s;
      const pivot = new THREE.Group(); pivot.position.copy(eyeC).add(new THREE.Vector3(-0.165 * s / 0.1 * 0.1, 0.03, 0)).sub(heads[D.index.head]);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.045, -0.05, 0), new THREE.Vector3(-0.05, -0.13, 0), new THREE.Vector3(-0.03, -0.22, 0)]);
      const tg = new THREE.TubeGeometry(curve, 24, 0.026, 14, false), tp = tg.attributes.position;
      for (let k = 0; k < tp.count; k++) { const u = Math.floor(k / 15) / 24, c = curve.getPoint(u); const f = 1 - 0.65 * u; tp.setXYZ(k, c.x + (tp.getX(k) - c.x) * f, c.y + (tp.getY(k) - c.y) * f, c.z + (tp.getZ(k) - c.z) * f * 0.8); }
      tg.computeVertexNormals();
      const pt = new THREE.Mesh(tg, hairMat.clone()); pt.castShadow = true; pivot.add(pt);
      pt.material.onBeforeCompile = () => {}; pt.material.customProgramCacheKey = () => "pony";
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 20), this.shoeAccent); tie.rotation.y = Math.PI / 2; tie.position.set(-0.012, -0.012, 0); pivot.add(tie);
      hb.add(pivot); this.pony = pivot; this.mats.push(pt.material);
    }
    // prosthesis (carbon socket + titanium pylon) on the amputated side
    if (m.ampSide) {
      const S2 = m.ampSide, k = D.index["lowerleg01." + S2], fo = D.index["foot." + S2];
      const knee = heads[k], ank = heads[fo], axis = ank.clone().sub(knee), Ls = axis.length(); axis.normalize();
      // shank radius profile from the skin
      const prof = new Array(12).fill(0);
      for (let v = 0; v < NB; v++) {
        if (A.skinI[v * 4] !== k && A.skinI[v * 4] !== D.index["lowerleg02." + S2]) continue;
        const d = new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).sub(knee), t = d.dot(axis) / Ls;
        if (t < 0 || t >= 0.6) continue;
        const r = d.clone().addScaledVector(axis, -d.dot(axis)).length(), bi = Math.floor((t / 0.6) * 12);
        prof[bi] = Math.max(prof[bi], r);
      }
      const pts = [[0, 0.02], [prof[0] * 1.05 + 0.004, 0.01]];
      for (let i = 0; i < 9; i++) pts.push([prof[i] * 1.07 + 0.005, -((i + 0.5) / 12) * 0.6 * Ls]);
      pts.push([0.022, -0.5 * Ls], [0.014, -0.53 * Ls], [0, -0.54 * Ls]);
      const lg = new THREE.LatheGeometry(pts.sort((a, b) => a[1] - b[1]).map(([r, y]) => new THREE.Vector2(r, y)), 40);
      const carbon = new THREE.MeshStandardMaterial({ color: 0x111720, roughness: 0.25, metalness: 0.4 });
      const titan = new THREE.MeshStandardMaterial({ color: 0xc8ced8, metalness: 1, roughness: 0.22 });
      const glowRing = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 3.0).multiply(new THREE.Color(1, 1, 1)), toneMapped: false });
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(lg, carbon));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(prof[2] * 1.08 + 0.006, 0.0018, 8, 48), glowRing); ring.rotation.x = Math.PI / 2; ring.position.y = -0.14 * Ls; grp.add(ring);
      const pyl = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.4 * Ls, 20), titan); pyl.position.y = -0.73 * Ls; grp.add(pyl);
      for (const y of [-0.54, -0.93]) { const ad = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.03, 20), titan); ad.position.y = y * Ls; grp.add(ad); }
      grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis);
      grp.traverse((ob) => { if (ob.isMesh) { ob.castShadow = true; ob.receiveShadow = true; } });
      bones[k].add(grp);
      this.mats.push(carbon, titan);
    }

    // ---------- shoe soles (skinned to foot / toes)
    this.markers = {};
    for (const side of ["L", "R"]) {
      const fi = D.index["foot." + side], ti = D.index["toe." + side];
      // footprint outline at the sole
      const pts = [];
      let sMinY = Infinity;
      for (let v = 0; v < NB; v++) if (A.skinI[v * 4] === fi || A.skinI[v * 4] === ti) sMinY = Math.min(sMinY, P[v * 3 + 1]);
      for (let v = 0; v < NB; v++) if (P[v * 3 + 1] < sMinY + 0.03 && (A.skinI[v * 4] === fi || A.skinI[v * 4] === ti)) pts.push([P[v * 3], P[v * 3 + 2]]);
      const hull = convexHull(pts);
      const sole = 0.022;
      const shape = new THREE.Shape(hull.map(([x, z]) => new THREE.Vector2(x, z)));
      const sg = new THREE.ExtrudeGeometry(shape, { depth: sole, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 3, curveSegments: 4 });
      // shape lies in XY with depth +Z → rotate to XZ plane (y up)
      sg.rotateX(Math.PI / 2); sg.translate(0, sMinY + 0.004, 0);
      const sp = sg.attributes.position, sI = new Uint16Array(sp.count * 4), sW = new Float32Array(sp.count * 4);
      const ballX = heads[ti].x - 0.01;
      for (let k = 0; k < sp.count; k++) {
        const x = sp.getX(k), f = clamp((x - (ballX - 0.025)) / 0.05, 0, 1);
        sI[k * 4] = fi; sI[k * 4 + 1] = ti; sW[k * 4] = 1 - f; sW[k * 4 + 1] = f;
        sp.setY(k, Math.min(sp.getY(k), sMinY + 0.004) - (sp.getY(k) < sMinY - 0.001 ? 0 : 0));
      }
      sg.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(sI, 4));
      sg.setAttribute("skinWeight", new THREE.BufferAttribute(sW, 4));
      sg.computeVertexNormals();
      const soleMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.6 });
      const sm = new THREE.SkinnedMesh(sg, [soleMat, soleMat]);
      sm.bind(skeleton, mesh.bindMatrix); sm.castShadow = true; sm.receiveShadow = true; body.add(sm);
      this.mats.push(soleMat);
      // stripe
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.11 * (o.ht / 170), 0.006, 0.004), this.shoeAccent);
      // ground-contact markers (bottom of the sole)
      let heelX = Infinity, tipX = -Infinity;
      for (const [x] of hull) { heelX = Math.min(heelX, x); tipX = Math.max(tipX, x); }
      const yb = sMinY - sole + 0.002;
      const zc = hull.reduce((a, [, z]) => a + z, 0) / hull.length;
      const mk = (bone, x) => { const ob = new THREE.Object3D(); ob.position.set(x, yb, zc).sub(heads[bone]); bones[bone].add(ob); return ob; };
      this.markers[side] = { heel: mk(fi, heelX + 0.01), ball: mk(ti, ballX), tip: mk(ti, tipX - 0.005) };
      strip.position.set((heelX + tipX) / 2 - heads[fi].x, sMinY + 0.012 - heads[fi].y, zc - heads[fi].z + (side === "R" ? 1 : -1) * 0.045);
      bones[fi].add(strip);
      this.footLen = tipX - heelX;
      if (isAmp[side]) this.ampSide = side;
    }

    // ---------- eyes (mhclo-fitted MakeHuman high-poly eyes)
    {
      const sc = D.header.scale, ne = A.e_ref.length / 3;
      const Pm = (v, k) => P[v * 3 + k];
      // scales in metres per MakeHuman unit, in MakeHuman axes (x = -app z, y = y, z = app x)
      const sx = Math.abs(Pm(sc.x[0], 2) - Pm(sc.x[1], 2)) / sc.x[2], sy = Math.abs(Pm(sc.y[0], 1) - Pm(sc.y[1], 1)) / sc.y[2], sz = Math.abs(Pm(sc.z[0], 0) - Pm(sc.z[1], 0)) / sc.z[2];
      const ep = new Float32Array(ne * 3);
      for (let i = 0; i < ne; i++) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) { const v = A.e_ref[i * 3 + k], w = A.e_w[i * 3 + k]; x += Pm(v, 0) * w; y += Pm(v, 1) * w; z += Pm(v, 2) * w; }
        const ox = A.e_off[i * 3], oy = A.e_off[i * 3 + 1], oz = A.e_off[i * 3 + 2];
        ep[i * 3] = x + oz * sz; ep[i * 3 + 1] = y + oy * sy; ep[i * 3 + 2] = z - ox * sx;
      }
      const nr = A.e_rv.length, epos = new Float32Array(nr * 3), esi = new Uint16Array(nr * 4), esw = new Float32Array(nr * 4);
      for (let r = 0; r < nr; r++) { const v = A.e_rv[r]; epos[r * 3] = ep[v * 3]; epos[r * 3 + 1] = ep[v * 3 + 1]; epos[r * 3 + 2] = ep[v * 3 + 2]; esi[r * 4] = D.index.head; esw[r * 4] = 1; }
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.BufferAttribute(epos, 3));
      eg.setAttribute("uv", new THREE.BufferAttribute(A.e_uv, 2));
      eg.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(esi, 4));
      eg.setAttribute("skinWeight", new THREE.BufferAttribute(esw, 4));
      eg.setIndex(Array.from(A.e_tris));
      eg.computeVertexNormals();
      const eyeMat = new THREE.MeshStandardMaterial({ map: tex.eye, roughness: 0.12 });
      const em = new THREE.SkinnedMesh(eg, eyeMat);
      em.bind(skeleton, mesh.bindMatrix); body.add(em);
      this.mats.push(eyeMat);
    }

    // ---------- EMG overlay (soft muscle regions on the skin)
    this.buildOverlay(P, nb, si, sw, mesh);

    // ---------- IMU sensors
    this.sites = {};
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 0.3, metalness: 0.5 });
    const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 3.0), toneMapped: false });
    this.mats.push(dark, led);
    const site = (code, boneName, t, dir) => {
      const bi = D.index[boneName], h0 = heads[bi], t0 = tails[bi];
      const target = h0.clone().lerp(t0, t);
      const d = new THREE.Vector3(...dir).normalize();
      // nearest skin vertex along the direction
      let best = -1, bd = Infinity;
      for (let v = 0; v < NB; v++) {
        if (A.skinI[v * 4] !== bi) continue;
        const px = P[v * 3] - target.x, py = P[v * 3 + 1] - target.y, pz = P[v * 3 + 2] - target.z;
        const along = px * d.x + py * d.y + pz * d.z, perp = Math.hypot(px - along * d.x, py - along * d.y, pz - along * d.z);
        const score = perp * 3 - along;
        if (score < bd) { bd = score; best = v; }
      }
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.012), dark));
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), led); l.position.set(0, 0.012, 0.007); g.add(l);
      const p = new THREE.Vector3(P[best * 3], P[best * 3 + 1], P[best * 3 + 2]).addScaledVector(new THREE.Vector3(nb[best * 3], nb[best * 3 + 1], nb[best * 3 + 2]), 0.012);
      g.position.copy(p).sub(h0);
      g.lookAt(g.position.clone().add(new THREE.Vector3(nb[best * 3], nb[best * 3 + 1], nb[best * 3 + 2])));
      g.visible = false;
      bones[bi].add(g);
      this.sites[code] = g;
    };
    for (const [code, [sd, seg]] of Object.entries(IMU_SITES)) {
      const S = sd === "R" ? "R" : "L", z = sd === "R" ? 1 : sd === "L" ? -1 : 0;
      if (seg === "thigh") site(code, `upperleg02.${S}`, 0.3, [0, 0, z]);
      else if (seg === "shank") site(code, `lowerleg01.${S}`, 0.5, [0.3, 0, z]);
      else if (seg === "foot") site(code, `foot.${S}`, 0.5, [0.2, 1, 0]);
      else if (seg === "upperarm") site(code, `upperarm02.${S}`, 0.2, [0, 0, z]);
      else if (seg === "forearm") site(code, `lowerarm02.${S}`, 0.3, [0, 0, z]);
      else if (seg === "hand") site(code, `wrist.${S}`, 0.5, [0, 0, z]);
      else if (seg === "head") site(code, "head", 0.4, [-1, 0, 0]);
      else if (seg === "chest") site(code, "spine02", 0.6, [-1, 0, 0]);
      else if (seg === "lumbar") site(code, "spine04", 0.5, [-1, 0, 0]);
      else if (seg === "pelvis") site(code, "root", 0.5, [-1, 0.2, 0]);
    }

    // arm clearance from the hips
    const hipW = Math.abs(heads[D.index["upperleg01.R"]].z) + 0.09 * (m.girth || 1);
    const shoW = Math.abs(heads[D.index["upperarm01.R"]].z);
    const armL = heads[D.index["wrist.R"]].distanceTo(heads[D.index["upperarm01.R"]]);
    this.minAbd = Math.atan2(Math.max(0, hipW - shoW), armL) / rad + 2;
    this.dim = { h: o.ht / 100, fl: this.footLen, fw: 0.1 * (o.ht / 170) };
    this.applyMaterialsState();
  }

  buildOverlay(P, nb, si, sw, mesh) {
    const D = data(), A = D.A, NB = D.NB, names = D.header.muscles;
    const nR = A.rv.length, groups = new Map();
    for (let i = 0; i < A.tris.length; i += 3) {
      const r = [A.tris[i], A.tris[i + 1], A.tris[i + 2]], v = r.map((x) => A.rv[x]);
      if (v.some((x) => x >= NB)) continue;
      // face belongs to the muscle with the strongest vertex
      let best = -1, bs = 0;
      for (const x of v) if (A.mid[x] !== 255 && A.mstr[x] > bs) { bs = A.mstr[x]; best = x; }
      if (best < 0 || bs < 40) continue;
      const key = names[A.mid[best]] + (A.mside[best] ? "R" : "L");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(...r);
    }
    const inAny = new Uint8Array(nR);
    for (const ids of groups.values()) for (const r of ids) inAny[r] = 1;
    const { g2: g, map } = this.subMesh((a, b, c) => inAny[a] && inAny[b] && inAny[c], (v, r, j, p2) => { for (let k = 0; k < 3; k++) p2[j * 3 + k] = P[v * 3 + k] + nb[v * 3 + k] * 0.009; });
    const nU = g.attributes.position.count, col = new Float32Array(nU * 4);
    for (let r = 0; r < nR; r++) if (map[r] >= 0) { const j = map[r], v = A.rv[r]; col[j * 4] = col[j * 4 + 1] = col[j * 4 + 2] = 1; col[j * 4 + 3] = v < NB ? Math.pow(A.mstr[v] / 255, 0.8) : 0; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.deleteAttribute("normal"); g.deleteAttribute("uv");
    const index = [], mats = [];
    this.overlayKeys = [];
    g.setIndex(null);
    for (const [key, ids0] of groups) {
      const ids = ids0.map((r) => map[r]);
      g.addGroup(index.length, ids.length, mats.length);
      index.push(...ids);
      let mm = this.overlayMats[key];
      if (!mm) {
        mm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, color: 0x000000, opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -2 });
        mm.userData = { group: key.slice(0, -1), side: key.slice(-1) };
        this.overlayMats[key] = mm;
      }
      mats.push(mm); this.overlayKeys.push(key);
      // anchor = strongest vertex of the group
      let bv = -1, bs = -1;
      for (const r of ids0) { const v = A.rv[r]; if (A.mstr[v] > bs) { bs = A.mstr[v]; bv = r; } }
      this.anchors[key] = map[bv];
    }
    g.setIndex(index);
    const ov = new THREE.SkinnedMesh(g, mats);
    ov.bind(this.skeleton, mesh.bindMatrix);
    ov.renderOrder = 5;
    ov.frustumCulled = false;
    ov.userData = { overlay: true, figure: this };
    this.body.add(ov);
    this.overlay = ov;
    this.pickables = [ov];
  }

  pickInfo(hit) {
    const mi = hit.face?.materialIndex;
    if (mi === undefined || !this.overlayKeys) return null;
    const key = this.overlayKeys[mi];
    return key ? { muscle: key.slice(0, -1), side: key.slice(-1), figure: this } : null;
  }

  setIMUs(codes) {
    const all = codes.has("ALL16");
    for (const [k, g] of Object.entries(this.sites || {})) g.visible = all || codes.has(k);
  }

  applyMaterialsState() {
    const on = this.ghost;
    for (const mt of this.mats) { mt.transparent = on; mt.opacity = on ? 0.28 : 1; mt.depthWrite = !on; mt.needsUpdate = true; }
    this.root.traverse((ob) => { if (ob.isMesh && ob !== this.overlay) ob.castShadow = !on; });
  }
  setGhost(on) { this.ghost = on; this.applyMaterialsState(); }

  applyEMG(acts, on, sel, t) {
    if (!this.overlay) return;
    this.overlay.visible = on && !this.ghost;
    if (!on) return;
    for (const key of this.overlayKeys) {
      const mm = this.overlayMats[key], { group, side } = mm.userData;
      const a = acts[side]?.[group] ?? 0, an = Math.min(1, a / 0.5);
      ramp(0.18 + 0.82 * an, mm.color);
      mm.color.multiplyScalar(0.9 + 1.1 * an);
      let op = 0.16 + 0.7 * Math.sqrt(an);
      if (sel) { const hit = group === sel.group && side === sel.side; op = hit ? Math.min(0.95, op + 0.25 + 0.15 * Math.sin(t * 7)) : op * 0.3; }
      mm.opacity = op;
    }
  }

  anchorWorld(group, side, out) {
    const r = this.anchors[group + side];
    if (r === undefined || !this.overlay) return null;
    this.overlay.getVertexPosition(r, out);
    return this.overlay.localToWorld(out);
  }

  // ---------------------------------------------------------------- posing
  pose(m, pR, pL, exag) {
    const A = { R: angles(m, m.legs.R, pR), L: angles(m, m.legs.L, pL) };
    this.A = A;
    const tw = 2 * Math.PI * pR, I = this.boneIdx, B = this.bones;
    const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "YXZ"));
    const W = new Array(B.length);
    const Dpel = q(-3 * Math.sin(tw) * rad, m.pelvisRot * Math.cos(tw) * rad, -2 * rad);
    let lean = 0;
    if (m.amp) { const sd = m.ampSide, p = sd === "R" ? pR : pL, L = m.legs[sd]; if (p < L.sf) lean = (sd === "R" ? 1 : -1) * m.latLean * Math.sin((Math.PI * p) / L.sf); }
    const pelY = m.pelvisRot * Math.cos(tw) * rad;
    const Rtrunk = q(lean * rad + 3 * Math.sin(tw) * rad, -0.75 * pelY, (-m.trunkFlex + 1.2 * Math.cos(2 * tw)) * rad + 2 * rad);
    const Rhead = q(-0.8 * lean * rad, -0.2 * (-0.75 * pelY), m.trunkFlex * 0.75 * rad);
    const set = (name, D) => { const i = I[name]; W[i] = D.clone().multiply(this.N[i]); };
    set("root", Dpel);
    const sp = ["spine05", "spine04", "spine03", "spine02", "spine01"], idq = new THREE.Quaternion();
    sp.forEach((n, k) => set(n, Dpel.clone().multiply(idq.clone().slerp(Rtrunk, (k + 1) / sp.length))));
    const Dsp = Dpel.clone().multiply(Rtrunk);
    ["neck01", "neck02", "neck03"].forEach((n, k) => set(n, Dsp.clone().multiply(idq.clone().slerp(Rhead, (k + 1) / 4))));
    set("head", Dsp.clone().multiply(Rhead));
    for (const side of ["R", "L"]) {
      const s = side === "R" ? 1 : -1, a = A[side], S = "." + side;
      set("pelvis" + S, Dpel);
      const Dth = Dpel.clone().multiply(q(s * a.add * rad, 0, a.hip * rad));
      set("upperleg01" + S, Dth); set("upperleg02" + S, Dth);
      const Dsh = Dth.clone().multiply(q(s * a.varus * exag * rad, s * a.ir * exag * rad, -a.knee * rad));
      set("lowerleg01" + S, Dsh); set("lowerleg02" + S, Dsh);
      const Dft = Dsh.clone().multiply(q(0, 0, a.ank * rad));
      set("foot" + S, Dft);
      set("toe" + S, Dft.clone().multiply(q(0, 0, a.mtp * rad)));
      // arms
      const opp = A[side === "R" ? "L" : "R"], flex = m.armSwing * (opp.hip - 9);
      set("clavicle" + S, Dsp); set("shoulder01" + S, Dsp);
      const abd = Math.max(m.armAbd, this.minAbd || 0);
      const Dua = Dsp.clone().multiply(q(-s * abd * rad, 0, (flex + m.trunkFlex) * rad));
      set("upperarm01" + S, Dua); set("upperarm02" + S, Dua);
      const Dfa = Dua.clone().multiply(q(0, s * 0.35, (16 + 0.55 * Math.max(0, flex)) * rad));
      set("lowerarm01" + S, Dfa); set("lowerarm02" + S, Dfa);
      set("wrist" + S, Dfa.clone().multiply(q(0, 0, 8 * rad)));
    }
    const inv = new THREE.Quaternion();
    this.skeleton.bones.forEach((bn, i) => {
      const p = data().B[i].parent;
      if (p < 0) bn.quaternion.copy(W[i]);
      else bn.quaternion.copy(inv.copy(W[p]).invert().multiply(W[i]));
    });
    this.body.position.z = m.sway * Math.sin(tw);
    if (this.pony) { this.pony.rotation.z = 0.1 * Math.sin(2 * tw - 0.9) - 0.05; this.pony.rotation.x = 0.08 * Math.sin(tw - 0.6); }
  }

  ground(groundY) {
    this.body.position.y = 0;
    this.root.updateMatrixWorld(true);
    let min = Infinity;
    const v = new THREE.Vector3();
    for (const side of ["R", "L"]) for (const k of ["heel", "ball", "tip"]) { this.markers[side][k].getWorldPosition(v); min = Math.min(min, v.y); }
    this.body.position.y = groundY - min;
    this.root.updateMatrixWorld(true);
  }

  contacts(side) {
    const mk = this.markers[side];
    return { heel: mk.heel.getWorldPosition(new THREE.Vector3()), ball: mk.ball.getWorldPosition(new THREE.Vector3()), tip: mk.tip.getWorldPosition(new THREE.Vector3()) };
  }

  get head() { return this.bones[this.boneIdx.head]; }
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
