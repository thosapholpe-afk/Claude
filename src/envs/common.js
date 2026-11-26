import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const rand = (a, b) => a + Math.random() * (b - a);
export const wrap = (x, a, b) => a + ((((x - a) % (b - a)) + (b - a)) % (b - a));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ procedural noise (tileable)
export function makeNoise(seed = 1) {
  const p = [...Array(256).keys()];
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => { const u = h & 1 ? -x : x, v = h & 2 ? -y : y; return h & 4 ? u + v : (h & 1 ? -1 : 1) * 0.5 * x + v * 0.9; };
  const pn = (x, y, P) => {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
    const xi = ((X % P) + P) % P, yi = ((Y % P) + P) % P, x1 = (xi + 1) % P, y1 = (yi + 1) % P;
    const u = fade(xf), v = fade(yf);
    const a = grad(perm[perm[xi] + yi], xf, yf), b = grad(perm[perm[x1] + yi], xf - 1, yf);
    const c = grad(perm[perm[xi] + y1], xf, yf - 1), d = grad(perm[perm[x1] + y1], xf - 1, yf - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
  return {
    fbm(x, y, P, oct = 4) { let a = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { a += amp * pn(x * f, y * f, P * f); amp *= 0.5; f *= 2; } return a; },
    noise: pn,
  };
}

// fn(u, v, x, y) → [r, g, b] (0..255) and height h (0..1); returns {map, normal}
export function genTextures(size, fn, { normalStrength = 2, repeat = 1, srgb = true } = {}) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d"), img = ctx.createImageData(size, size), H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const out = fn(x / size, y / size, x, y), k = (y * size + x) * 4;
    img.data[k] = out[0]; img.data[k + 1] = out[1]; img.data[k + 2] = out[2]; img.data[k + 3] = 255;
    H[y * size + x] = out[3] ?? 0.5;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.repeat.set(repeat, repeat);
  const nc = document.createElement("canvas"); nc.width = nc.height = size;
  const nctx = nc.getContext("2d"), nimg = nctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
    const u = H[((y - 1 + size) % size) * size + x], d = H[((y + 1) % size) * size + x];
    let nx = (l - r) * normalStrength, ny = (d - u) * normalStrength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const k = (y * size + x) * 4;
    nimg.data[k] = (nx * 0.5 + 0.5) * 255; nimg.data[k + 1] = (ny * 0.5 + 0.5) * 255; nimg.data[k + 2] = (nz * 0.5 + 0.5) * 255; nimg.data[k + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  normal.colorSpace = THREE.NoColorSpace; normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.anisotropy = 8; normal.repeat.set(repeat, repeat);
  return { map, normal };
}

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  return t;
}

export function softDot(inner = "rgba(255,255,255,1)") {
  return canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, inner); g.addColorStop(0.35, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}

// world-space UVs for flat XZ geometry so separate ground pieces tile seamlessly
export function worldUV(geo, scale) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * scale; uv[i * 2 + 1] = -p.getZ(i) * scale; }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}
export function groundPlane(x0, x1, z0, z1, mat, scale, y = 0) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  worldUV(g, scale);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}
// scroll textures of a material with the ground (call each frame)
export function scrollMaps(mats, g, scale) {
  for (const m of mats) for (const k of ["map", "normalMap", "roughnessMap"]) if (m[k]) m[k].offset.x = -g * scale;
}

// ------------------------------------------------------------------ shader injection
// wind sway (+ optional instanced scrolling). U = shared uniforms {uTime, uWind, uG}
export function patchWind(mat, U, { height = 6, amp = 0.15, flutter = 0.0, instScroll = null, key = "w" } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind; sh.uniforms.uG = U.uG;
    sh.uniforms.uWH = { value: height }; sh.uniforms.uWA = { value: amp }; sh.uniforms.uWF = { value: flutter };
    sh.uniforms.uXMin = { value: instScroll ? instScroll[0] : 0 }; sh.uniforms.uXRange = { value: instScroll ? instScroll[1] - instScroll[0] : 1 };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
      uniform float uTime, uWind, uG, uWH, uWA, uWF, uXMin, uXRange;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
      {
        mat4 wm = modelMatrix;
        vec3 shift = vec3(0.0);
        #ifdef USE_INSTANCING
          wm = modelMatrix * instanceMatrix;
          ${instScroll ? `float ix = instanceMatrix[3].x; shift.x = uXMin + mod(ix + uG - uXMin, uXRange) - ix;` : ""}
        #endif
        vec4 wp0 = wm * vec4(position, 1.0);
        wp0.xyz += shift;
        float hh = clamp((wp0.y + 0.05) / uWH, 0.0, 1.6);
        float ph = uTime * 1.3 + wp0.x * 0.23 + wp0.z * 0.17;
        vec3 sway = vec3(sin(ph) + 0.35 * sin(2.7 * ph + wp0.y), 0.0, 0.55 * cos(0.8 * ph + 1.3)) * uWind * uWA * hh * hh;
        sway += vec3(sin(uTime * 7.0 + wp0.y * 5.0 + wp0.x * 3.1), 0.6 * sin(uTime * 6.1 + wp0.x * 4.3), cos(uTime * 7.7 + wp0.z * 5.3)) * uWF * uWind * hh;
        transformed += inverse(mat3(wm)) * (sway + shift);
      }`);
  };
  mat.customProgramCacheKey = () => "wind-" + key + (instScroll ? "-s" : "");
  return mat;
}

// ------------------------------------------------------------------ deformable ground (footprints)
export class DeformGround {
  constructor(U, mat, { x0 = -10, L = 14, W = 1.3, res = 0.0175, depth = 0.03, rim = 0.008, darken = 0.3, uvScale = 0.3, tint = [0.75, 0.75, 0.75] } = {}) {
    const N = Math.round(L / res), M = Math.round(W / res);
    Object.assign(this, { N, M, L, W, x0, rx: L / N, rz: W / M, depth, rim, U });
    this.data = new Uint8Array(N * M * 2);
    const tex = (this.tex = new THREE.DataTexture(this.data, N, M, THREE.RGFormat, THREE.UnsignedByteType));
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(L, W, N, M);
    geo.rotateX(-Math.PI / 2); geo.translate(x0 + L / 2, 0, 0);
    worldUV(geo, uvScale);
    const uni = { uH: { value: tex }, uG: U.uG, uL: { value: L }, uX0: { value: x0 }, uW: { value: W }, uDepth: { value: depth }, uRim: { value: rim }, uDark: { value: darken }, uTint: { value: new THREE.Vector3(...tint) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
        uniform sampler2D uH; uniform float uG, uL, uX0, uW, uDepth, uRim; varying float vDef;
        vec2 dUV(vec2 p){ return vec2(fract((p.x - uG) / uL), (p.y + uW * 0.5) / uW); }
        float dWin(vec2 p){ return smoothstep(uX0, uX0 + 1.5, p.x) * (1.0 - smoothstep(uX0 + uL - 1.5, uX0 + uL, p.x)) * (1.0 - smoothstep(uW * 0.5 - 0.14, uW * 0.5, abs(p.y))); }
        vec2 dS(vec2 p){ return texture2D(uH, dUV(p)).rg * dWin(p); }
        float dHt(vec2 p){ vec2 t = dS(p); return t.g * uRim * (1.0 - t.r) - t.r * uDepth; }`)
        .replace("#include <beginnormal_vertex>", `
        float dE = 0.016;
        float dhx = dHt(position.xz + vec2(dE, 0.0)) - dHt(position.xz - vec2(dE, 0.0));
        float dhz = dHt(position.xz + vec2(0.0, dE)) - dHt(position.xz - vec2(0.0, dE));
        vec3 objectNormal = normalize(vec3(-dhx / (2.0 * dE), 1.0, -dhz / (2.0 * dE)));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
        .replace("#include <begin_vertex>", `vec3 transformed = vec3(position);
        vec2 dT = dS(position.xz);
        transformed.y += dT.g * uRim * (1.0 - dT.r) - dT.r * uDepth;
        vDef = dT.r;`);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
        varying float vDef; uniform float uDark; uniform vec3 uTint;`)
        .replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.rgb *= mix(vec3(1.0), uTint, clamp(vDef * uDark * 2.0, 0.0, 1.0));`);
    };
    mat.customProgramCacheKey = () => "deform";
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.cleared = null; this.dirty = false;
  }
  col(gx) { return (gx / this.L) * this.N; }
  stampEllipse(cx, cz, dx, dz, ra, rb, depth, rim, g) {
    const ic = this.col(cx - g), jc = ((cz + this.W / 2) / this.W) * this.M;
    const rr = Math.max(ra, rb) * 1.8, ri = Math.ceil(rr / this.rx), rj = Math.ceil(rr / this.rz);
    const D = clamp(depth / this.depth, 0, 1), Rm = clamp(rim / this.rim, 0, 1), N = this.N;
    for (let dj = -rj; dj <= rj; dj++) {
      const j = Math.floor(jc) + dj;
      if (j < 0 || j >= this.M) continue;
      const z = (j + 0.5 - jc) * this.rz;
      for (let di = -ri; di <= ri; di++) {
        const i0 = Math.floor(ic) + di, x = (i0 + 0.5 - ic) * this.rx, i = ((i0 % N) + N) % N;
        const al = x * dx + z * dz, ac = -x * dz + z * dx, r = Math.sqrt((al / ra) ** 2 + (ac / rb) ** 2), k = (j * N + i) * 2;
        if (r < 1) { const v = Math.round(D * smooth(1.0, 0.7, r) * 255); if (v > this.data[k]) this.data[k] = v; }
        else if (r < 1.8) { const kr = Math.sin((Math.PI * (r - 1)) / 0.8), v = Math.round(Rm * kr * kr * 255); if (v > this.data[k + 1]) this.data[k + 1] = v; }
      }
    }
    this.dirty = true;
  }
  // stamp the sole of a planted foot (called every frame during stance)
  stampFoot(fig, m, side, g, groundY, depth, rim) {
    const c = fig.contacts(side), d = fig.dim, isAmp = m.legs[side].isAmp, s = side === "R" ? 1 : -1;
    let dx = c.tip.x - c.heel.x, dz = c.tip.z - c.heel.z;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const lx = -dz * s, lz = dx * s, fl = d.fl, thr = groundY + 0.014;
    const P = (b, a, l) => [b.x + dx * a + lx * l, b.z + dz * a + lz * l];
    const st = (pt, ra, rb) => this.stampEllipse(pt[0], pt[1], dx, dz, ra, rb, depth, rim, g);
    if (c.heel.y < thr) st(P(c.heel, 0.13 * fl, 0), 0.13 * fl, 0.12 * fl);
    if (c.heel.y < thr && c.ball.y < thr) st(P(c.heel, 0.42 * fl, isAmp ? 0 : 0.055 * fl), 0.19 * fl, isAmp ? 0.12 * fl : 0.075 * fl);
    if (c.ball.y < thr) st(P(c.ball, -0.05 * fl, 0), 0.13 * fl, 0.19 * fl);
    if (c.tip.y < thr + 0.006) {
      if (isAmp) st(P(c.ball, 0.08 * fl, 0), 0.13 * fl, 0.16 * fl);
      else { st(P(c.ball, 0.14 * fl, -0.06 * fl), 0.07 * fl, 0.075 * fl); st(P(c.ball, 0.11 * fl, 0.06 * fl), 0.06 * fl, 0.1 * fl); }
    }
  }
  update(g) {
    const back = this.x0 - g + 0.06;
    if (this.cleared === null || back < this.cleared - 1) this.cleared = back;
    if (back > this.cleared) {
      const from = Math.floor(this.col(this.cleared)), to = Math.floor(this.col(Math.min(back, this.cleared + this.L)));
      for (let i0 = from; i0 <= to; i0++) {
        const i = ((i0 % this.N) + this.N) % this.N;
        for (let j = 0; j < this.M; j++) { const k = (j * this.N + i) * 2; this.data[k] = 0; this.data[k + 1] = 0; }
      }
      this.cleared = back; this.dirty = true;
    }
    if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; }
  }
  dispose() { this.tex.dispose(); }
}

// ------------------------------------------------------------------ particles
const PVERT = `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale;
  varying vec3 vC; varying float vA;
  void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.1, -mv.z); }`;
const PFRAG = `uniform sampler2D uTex; varying vec3 vC; varying float vA;
  void main(){ vec4 t = texture2D(uTex, gl_PointCoord); float a = t.a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * t.rgb, a); }`;
export class Particles {
  constructor(max, { additive = false, texture = null, gravity = -9.8, drag = 2.0 } = {}) {
    this.max = max; this.gravity = gravity; this.drag = drag;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1); this.a0 = new Float32Array(max); this.grow = new Float32Array(max);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.tex = texture || softDot();
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: this.tex }, uScale: { value: 400 } }, vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    this.i = 0;
  }
  emit(n, p, { v = [0, 1, 0], j = [0.5, 0.5, 0.5], life = [0.6, 1.2], size = [0.02, 0.05], color = [1, 1, 1], alpha = 0.8, grow = 0, spread = 0.02 } = {}) {
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (this.i + 1) % this.max;
      this.pos[i * 3] = p.x + rand(-spread, spread); this.pos[i * 3 + 1] = p.y + rand(0, spread); this.pos[i * 3 + 2] = p.z + rand(-spread, spread);
      this.vel[i * 3] = v[0] + rand(-j[0], j[0]); this.vel[i * 3 + 1] = v[1] + rand(-j[1], j[1]); this.vel[i * 3 + 2] = v[2] + rand(-j[2], j[2]);
      this.life[i] = this.maxLife[i] = rand(life[0], life[1]);
      this.size[i] = rand(size[0], size[1]); this.grow[i] = grow;
      const c = typeof color === "function" ? color() : color;
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      this.a0[i] = alpha;
    }
  }
  update(dt, scale, floorY = -Infinity) {
    this.mat.uniforms.uScale.value = scale;
    const dr = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += this.gravity * dt;
      for (let a = 0; a < 3; a++) { this.vel[i * 3 + a] *= dr; this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt; }
      if (this.pos[i * 3 + 1] < floorY) { this.pos[i * 3 + 1] = floorY; this.vel[i * 3 + 1] *= -0.2; }
      const f = clamp(this.life[i] / this.maxLife[i], 0, 1);
      this.alpha[i] = this.a0[i] * Math.min(1, f * 3) * Math.min(1, (1 - f) * 12 + 0.2);
      this.size[i] += this.grow[i] * dt;
    }
    const at = this.points.geometry.attributes;
    at.position.needsUpdate = at.aAlpha.needsUpdate = at.aSize.needsUpdate = at.aColor.needsUpdate = true;
  }
}

// GPU-animated ambient particles (snow, leaves, dust, petals) living in a box around the subject
export class Ambient {
  constructor(U, count, { box = [24, 10, 20], center = [0, 5, 0], fall = 0.6, wind = 0.6, swirl = 0.5, size = 0.05, color = [1, 1, 1], texture = null, additive = false, scroll = 1, opacity = 0.9, spin = 0 } = {}) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); seed[i] = Math.random(); }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTime: U.uTime, uG: U.uG, uWind: U.uWind, uScale: { value: 400 }, uBox: { value: new THREE.Vector3(...box) }, uCenter: { value: new THREE.Vector3(...center) },
        uFall: { value: fall }, uWindK: { value: wind }, uSwirl: { value: swirl }, uSize: { value: size }, uScroll: { value: scroll }, uColor: { value: new THREE.Color(...color) }, uTex: { value: texture || softDot() }, uOp: { value: opacity }, uSpin: { value: spin } },
      vertexShader: `attribute float aSeed; uniform float uTime, uG, uWind, uScale, uFall, uWindK, uSwirl, uSize, uScroll, uSpin; uniform vec3 uBox, uCenter;
        varying float vA; varying float vR;
        void main(){
          vec3 q = position; float t = uTime;
          q.y = fract(q.y - t * uFall * (0.6 + aSeed * 0.8) / uBox.y);
          q.x = fract(q.x + (uG * uScroll + uWind * uWindK * t + sin(t * 0.8 + aSeed * 40.0) * uSwirl) / uBox.x);
          q.z = fract(q.z + sin(t * 0.6 + aSeed * 23.0) * uSwirl * 0.4 / uBox.z);
          vec3 wp = uCenter + (q - 0.5) * uBox;
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.55 + aSeed * 0.9) * uScale / max(0.1, -mv.z);
          vA = smoothstep(0.0, 0.06, q.y) * smoothstep(1.0, 0.9, q.y) * smoothstep(0.0, 0.08, q.x) * smoothstep(1.0, 0.92, q.x) * smoothstep(0.0, 0.08, q.z) * smoothstep(1.0, 0.92, q.z);
          vR = t * uSpin * (aSeed - 0.5) * 6.0 + aSeed * 6.28;
        }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; uniform float uOp; varying float vA; varying float vR;
        void main(){ vec2 c = gl_PointCoord - 0.5; float s = sin(vR), co = cos(vR); c = mat2(co, -s, s, co) * c; vec4 t = texture2D(uTex, c + 0.5);
          float a = t.a * vA * uOp; if (a < 0.004) discard; gl_FragColor = vec4(uColor * t.rgb, a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
  }
  update(dt, scale) { this.mat.uniforms.uScale.value = scale; }
}

// ------------------------------------------------------------------ skies
export function skyEnvironment(pmrem, { elevation = 30, azimuth = 140, turbidity = 4, rayleigh = 1.6, mie = 0.004, mieG = 0.8 } = {}) {
  const sc = new THREE.Scene(), sky = new Sky();
  sky.scale.setScalar(1000); sc.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity; u.rayleigh.value = rayleigh; u.mieCoefficient.value = mie; u.mieDirectionalG.value = mieG;
  const phi = THREE.MathUtils.degToRad(90 - elevation), th = THREE.MathUtils.degToRad(azimuth);
  const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, th);
  u.sunPosition.value.copy(sun);
  const rt = pmrem.fromScene(sc, 0, 0.1, 3000);
  sky.geometry.dispose(); sky.material.dispose();
  return { texture: rt.texture, sun, rt };
}
export function gradientEnvironment(pmrem, top, mid, bottom, sunDir = null, sunCol = [1, 1, 1], sunPow = 0) {
  const sc = new THREE.Scene();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(...top) }, uMid: { value: new THREE.Color(...mid) }, uBot: { value: new THREE.Color(...bottom) }, uSun: { value: sunDir || new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color(...sunCol) }, uPow: { value: sunPow } },
    vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 uTop, uMid, uBot, uSunC; uniform vec3 uSun; uniform float uPow; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(uMid, uTop, pow(clamp(y, 0.0, 1.0), 0.6)) : mix(uMid, uBot, pow(clamp(-y, 0.0, 1.0), 0.4));
        c += uSunC * pow(max(0.0, dot(normalize(vD), normalize(uSun))), 64.0) * uPow; gl_FragColor = vec4(c, 1.0); }`,
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), m));
  const rt = pmrem.fromScene(sc, 0, 0.1, 2000);
  return { texture: rt.texture, rt };
}

// ------------------------------------------------------------------ birds
function wingGeo(span, chord, sweep, side) {
  const s = side;
  const v = new Float32Array([0.02, 0, 0, -chord, 0, 0, -chord - sweep, 0.0, s * span, -sweep * 0.4 + 0.01, 0, s * span * 1.02]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(v, 3));
  g.setIndex(s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  return g;
}
export class Birds {
  constructor(env, { kind = "sparrow", flock = 10, ground = 6, center = [0, 11, -12], radius = [9, 18], area = { x: [10, 26], z: [-3.5, 3.5] } } = {}) {
    this.env = env; this.kind = kind; this.area = area; this.birds = [];
    const gull = kind === "gull", sc = gull ? 2.4 : 1;
    const mBody = new THREE.MeshStandardMaterial({ color: gull ? 0xf4f6f8 : 0x2f68c8, roughness: 0.6 });
    const mHead = new THREE.MeshStandardMaterial({ color: gull ? 0xffffff : 0x163a7a, roughness: 0.5 });
    const mWing = new THREE.MeshStandardMaterial({ color: gull ? 0xa9b4c0 : 0x24508f, roughness: 0.7, side: THREE.DoubleSide });
    const mBeak = new THREE.MeshStandardMaterial({ color: gull ? 0xf2c23a : 0xf09a2e, roughness: 0.5 });
    const mBelly = new THREE.MeshStandardMaterial({ color: gull ? 0xffffff : 0xf2d35b, roughness: 0.6 });
    const gBody = new THREE.SphereGeometry(1, 14, 10).scale(0.07, 0.034, 0.036);
    const gBelly = new THREE.SphereGeometry(1, 12, 8).scale(0.05, 0.026, 0.03).translate(0.01, -0.01, 0);
    const gHead = new THREE.SphereGeometry(0.023, 12, 10);
    const gBeak = new THREE.ConeGeometry(0.007, 0.024, 8).rotateZ(-Math.PI / 2);
    const gTail = new THREE.BufferGeometry();
    gTail.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.05, 0.006, 0, -0.13, 0.014, 0.028, -0.13, 0.014, -0.028]), 3));
    gTail.computeVertexNormals();
    const gW = [wingGeo(gull ? 0.2 : 0.11, 0.06, gull ? 0.05 : 0.03, 1), wingGeo(gull ? 0.2 : 0.11, 0.06, gull ? 0.05 : 0.03, -1)];
    const make = () => {
      const g = new THREE.Group(); g.rotation.order = "YXZ";
      const inner = new THREE.Group(); g.add(inner);
      inner.add(new THREE.Mesh(gBody, mBody)); inner.add(new THREE.Mesh(gBelly, mBelly));
      const head = new THREE.Mesh(gHead, mHead); head.position.set(0.062, 0.026, 0); inner.add(head);
      const beak = new THREE.Mesh(gBeak, mBeak); beak.position.set(0.09, 0.022, 0); inner.add(beak);
      inner.add(new THREE.Mesh(gTail, mWing));
      const wings = [1, -1].map((s, k) => { const p = new THREE.Group(); p.position.set(0.012, 0.022, s * 0.02); p.add(new THREE.Mesh(gW[k], mWing)); inner.add(p); return p; });
      g.scale.setScalar(sc);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      env.add(g);
      return { g, inner, wings, head };
    };
    for (let i = 0; i < flock; i++) {
      const b = make();
      Object.assign(b, { state: "flock", cx: center[0] + rand(-6, 6), cy: center[1] + rand(-2, 3), cz: center[2] + rand(-4, 4), R: rand(radius[0], radius[1]), w: rand(0.18, 0.3) * (Math.random() < 0.5 ? 1 : -1) * (gull ? 0.6 : 1), ph: rand(0, 6.28), fl: rand(0, 6.28) });
      this.birds.push(b);
    }
    for (let i = 0; i < ground; i++) { const b = make(); this.respawn(b, true); this.birds.push(b); }
  }
  respawn(b, initial = false) {
    const g = this.env.g;
    b.state = "ground"; b.gx = rand(initial ? 3 : this.area.x[0], this.area.x[1]) - g; b.z = rand(this.area.z[0], this.area.z[1]);
    b.yaw = rand(0, 6.28); b.hop = 0; b.timer = rand(0.5, 2); b.trig = rand(1.6, 2.8); b.vel = new THREE.Vector3();
  }
  update(dt, t) {
    const g = this.env.g, gull = this.kind === "gull";
    for (const b of this.birds) {
      if (b.state === "flock") {
        const th = b.w * t + b.ph;
        const x = b.cx + b.R * Math.cos(th), z = b.cz + b.R * 0.55 * Math.sin(th), y = b.cy + Math.sin(th * 2 + b.ph) * 0.8;
        const vx = -b.R * Math.sin(th) * b.w, vz = b.R * 0.55 * Math.cos(th) * b.w;
        b.g.position.set(x, y, z);
        b.g.rotation.set(-Math.sign(b.w) * 0.35, Math.atan2(-vz, vx), 0);
        const flapOn = gull ? Math.sin(t * 0.7 + b.ph) > 0.6 : Math.sin(t * 1.9 + b.ph) > -0.3;
        const f = flapOn ? Math.sin(t * (gull ? 6 : 15) + b.fl) * (gull ? 0.7 : 1.0) : gull ? 0.12 : 0.05;
        b.wings[0].rotation.x = -f - 0.1; b.wings[1].rotation.x = f + 0.1;
        continue;
      }
      if (b.state === "ground") {
        const x = b.gx + g;
        b.timer -= dt;
        if (b.timer < 0) { b.hop = 0.3; b.yaw += rand(-1.2, 1.2); b.timer = rand(0.6, 2.2); }
        if (b.hop > 0) { b.hop -= dt; b.gx += Math.cos(b.yaw) * dt * 0.35; b.z -= Math.sin(b.yaw) * dt * 0.35; }
        const hopY = b.hop > 0 ? Math.abs(Math.sin(b.hop * 20)) * 0.035 * (gull ? 1.6 : 1) : 0;
        const peck = b.hop <= 0 && Math.sin(t * 5 + b.gx) > 0.3 ? -0.45 : 0;
        b.g.position.set(x, 0.035 * (gull ? 2.4 : 1) + hopY, b.z);
        b.g.rotation.set(0, b.yaw, peck);
        b.wings[0].rotation.x = -0.05; b.wings[1].rotation.x = 0.05;
        const near = x < b.trig && x > -1.5 && Math.abs(b.z) < 2.4;
        if (near) {
          b.state = "fly"; b.flyT = 0;
          const side = b.z === 0 ? 1 : Math.sign(b.z);
          b.vel.set(rand(0.4, 2.2), rand(1.8, 2.8), side * rand(1.4, 2.8));
          b.g.position.x = x;
        } else if (x < -16) this.respawn(b);
        continue;
      }
      // flying away
      b.flyT += dt;
      b.vel.y += 1.2 * dt; b.vel.x += 0.6 * dt;
      b.g.position.addScaledVector(b.vel, dt);
      b.g.rotation.set(0, Math.atan2(-b.vel.z, b.vel.x), 0.45 - Math.min(0.35, b.flyT * 0.25));
      const f = Math.sin(t * (gull ? 9 : 22) + b.fl) * 1.05;
      b.wings[0].rotation.x = -f - 0.15; b.wings[1].rotation.x = f + 0.15;
      if (b.flyT > 7 || b.g.position.y > 22) this.respawn(b);
    }
  }
}

// ------------------------------------------------------------------ butterflies
export class Butterflies {
  constructor(env, n = 7) {
    this.env = env; this.list = [];
    const tex = canvasTex(128, 128, (x) => {
      x.clearRect(0, 0, 128, 128);
      const wing = (cx, cy, rx, ry, rot) => { x.save(); x.translate(cx, cy); x.rotate(rot); x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); x.restore(); };
      const gr = x.createRadialGradient(20, 64, 4, 30, 64, 70);
      gr.addColorStop(0, "#7ff3ff"); gr.addColorStop(0.45, "#1f7bff"); gr.addColorStop(0.85, "#0a1f5c"); gr.addColorStop(1, "#02060f");
      x.fillStyle = gr;
      wing(62, 40, 58, 34, -0.35); x.fill();
      wing(56, 92, 42, 28, 0.45); x.fill();
      x.fillStyle = "rgba(255,255,255,0.9)";
      for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(96 + Math.random() * 14, 22 + i * 10, 2.2, 0, 7); x.fill(); }
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.4, transparent: false, roughness: 0.5, emissive: new THREE.Color(0x0a3a80), emissiveMap: tex, emissiveIntensity: 0.6 });
    const geo = new THREE.PlaneGeometry(0.06, 0.06).translate(0.03, 0, 0).rotateX(-Math.PI / 2);
    const body = new THREE.CylinderGeometry(0.003, 0.002, 0.04, 6).rotateZ(Math.PI / 2);
    const bmat = new THREE.MeshStandardMaterial({ color: 0x050810 });
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group(); g.rotation.order = "YXZ";
      g.add(new THREE.Mesh(body, bmat));
      const wL = new THREE.Group(), wR = new THREE.Group();
      const mL = new THREE.Mesh(geo, mat); mL.rotation.y = Math.PI / 2; wL.add(mL);
      const mR = new THREE.Mesh(geo, mat); mR.rotation.y = -Math.PI / 2; mR.scale.x = 1; wR.add(mR);
      g.add(wL); g.add(wR);
      env.add(g);
      const b = { g, wL, wR, ph: rand(0, 6.28) };
      this.reset(b, true);
      this.list.push(b);
    }
  }
  reset(b, initial) { b.gx = rand(initial ? -4 : 8, 16) - this.env.g; b.z = rand(-3, 3); b.y = rand(0.3, 1.3); }
  update(dt, t) {
    for (const b of this.list) {
      const x = b.gx + this.env.g + Math.sin(t * 0.9 + b.ph) * 0.6;
      const z = b.z + Math.sin(t * 0.7 + b.ph * 2) * 0.7, y = b.y + Math.sin(t * 2.1 + b.ph) * 0.18;
      const vx = Math.cos(t * 0.9 + b.ph) * 0.54, vz = Math.cos(t * 0.7 + b.ph * 2) * 0.49;
      b.g.position.set(x, y, z);
      b.g.rotation.set(0, Math.atan2(-vz, vx), 0);
      const f = Math.sin(t * 18 + b.ph) * 1.1;
      b.wL.rotation.x = f; b.wR.rotation.x = -f;
      if (x < -9) this.reset(b, false);
    }
  }
}
