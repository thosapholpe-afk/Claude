#!/usr/bin/env python3
"""Pre-process MakeHuman (CC0) assets into a compact binary used by the web app.

Downloads (once, cached in tools/.cache) the MakeHuman hm08 base mesh, macro targets,
default skeleton + weights and the high-poly eyes, then writes src/assets/human.bin:
  - base vertex positions (all 19158 vertices, metres, app axes: X forward, Y up, Z right)
  - body render mesh (UV-split vertices, triangles)
  - sparse macro targets (asian male/female, young/old; min/max weight)
  - reduced skeleton (~38 bones) with joint vertex lists, top-4 skin weights
  - per-vertex region masks: muscles (EMG overlay), garments, hair, brows, lips
  - eye proxy (mhclo fitting data) + eye texture
MakeHuman assets: CC0 1.0 (https://github.com/makehumancommunity/makehuman).
"""
import io, json, os, struct, sys, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "..", "src", "assets", "human.bin")
BASE_URL = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/"

def fetch(rel):
    path = os.path.join(CACHE, rel)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print("download", rel)
        with urllib.request.urlopen(BASE_URL + rel) as r, open(path, "wb") as f:
            f.write(r.read())
    return path

# ---------------------------------------------------------------- axes: MakeHuman (x left, y up, z front, dm) -> app (x front, y up, z right, m)
def to_app(a):
    a = np.asarray(a, dtype=np.float64)
    return np.stack([a[..., 2], a[..., 1], -a[..., 0]], axis=-1) * 0.1

# ---------------------------------------------------------------- base mesh
V, VT, faces = [], [], []
grp = None
for line in open(fetch("3dobjs/base.obj")):
    if line.startswith("v "): V.append([float(x) for x in line.split()[1:4]])
    elif line.startswith("vt "): VT.append([float(x) for x in line.split()[1:3]])
    elif line.startswith("g "): grp = line.split()[1]
    elif line.startswith("f "):
        corners = []
        for t in line.split()[1:]:
            p = t.split("/")
            corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
        faces.append((grp, corners))
V = to_app(V)
VT = np.array(VT)
NV = len(V)
body_faces = [c for g, c in faces if g == "body"]
body_verts = sorted({i for c in body_faces for i, _ in c})
NB = max(body_verts) + 1  # body vertices are 0..13379
print("vertices", NV, "body faces", len(body_faces), "body verts", NB)

# render vertices (split on uv seams)
rmap, rv, ruv, tris = {}, [], [], []
def rvert(i, t):
    k = (i, t)
    if k not in rmap:
        rmap[k] = len(rv); rv.append(i); ruv.append(VT[t] if t >= 0 else (0, 0))
    return rmap[k]
for c in body_faces:
    ids = [rvert(i, t) for i, t in c]
    tris += [ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]]
print("render verts", len(rv), "tris", len(tris) // 3)

# ---------------------------------------------------------------- targets
def read_target(rel):
    idx, d = [], []
    for line in open(fetch(rel)):
        if not line.strip() or line.startswith("#"): continue
        p = line.split()
        idx.append(int(p[0])); d.append([float(x) for x in p[1:4]])
    return np.array(idx, dtype=np.int64), to_app(np.array(d)) if d else np.zeros((0, 3))

TARGETS = []
for g in ("male", "female"):
    for a in ("young", "old"):
        TARGETS.append(f"asian-{g}-{a}")
        for w in ("minweight", "maxweight"):
            TARGETS.append(f"universal-{g}-{a}-averagemuscle-{w}")
targets = {}
for name in TARGETS:
    idx, d = read_target(f"targets/macrodetails/{name}.target")
    keep = np.abs(d).max(axis=1) > 2e-5
    targets[name] = (idx[keep], d[keep])
    print("target", name, keep.sum())

# ---------------------------------------------------------------- skeleton (reduced)
skel = json.load(open(fetch("rigs/default.mhskel")))
SB, SJ = skel["bones"], skel["joints"]
REDUCED = ["root", "spine05", "spine04", "spine03", "spine02", "spine01", "neck01", "neck02", "neck03", "head"]
for s in ("L", "R"):
    REDUCED += [f"clavicle.{s}", f"shoulder01.{s}", f"upperarm01.{s}", f"upperarm02.{s}", f"lowerarm01.{s}", f"lowerarm02.{s}", f"wrist.{s}",
                f"pelvis.{s}", f"upperleg01.{s}", f"upperleg02.{s}", f"lowerleg01.{s}", f"lowerleg02.{s}", f"foot.{s}", f"toe.{s}"]
bone_index = {n: i for i, n in enumerate(REDUCED)}

def reduce_bone(n):
    if n.startswith("toe") and n[-2:] in (".L", ".R"): return "toe" + n[-2:]
    while n not in bone_index:
        n = SB[n]["parent"]
    return n

def joint_list(name):
    return SJ[name]

bones = []
for n in REDUCED:
    if n.startswith("toe."):
        s = n[-1]
        head = sorted({v for k in range(1, 6) for v in SJ[f"toe{k}-1.{s}____head"]})
        tail = sorted({v for k in range(1, 6) for v in SJ[f"toe{k}-{2 if k == 1 else 3}.{s}____tail"]})
        parent = f"foot.{s}"
    else:
        head, tail, parent = SJ[SB[n]["head"]], SJ[SB[n]["tail"]], SB[n]["parent"]
    bones.append({"name": n, "parent": bone_index[parent] if parent else -1, "head": head, "tail": tail})

def jpos(lst, P=V):
    return P[lst].mean(axis=0)

# weights -> reduced, top 4
W = json.load(open(fetch("rigs/default_weights.mhw")))["weights"]
acc = [dict() for _ in range(NV)]
for bn, lst in W.items():
    rb = bone_index[reduce_bone(bn)]
    for vi, w in lst:
        acc[vi][rb] = acc[vi].get(rb, 0) + w
skin_i = np.zeros((NV, 4), np.uint8); skin_w = np.zeros((NV, 4), np.uint8)
dominant = np.full(NV, -1)
head_i = bone_index["head"]
for vi in range(NV):
    items = sorted(acc[vi].items(), key=lambda kv: -kv[1])[:4]
    if not items: items = [(head_i, 1.0)]
    tot = sum(w for _, w in items)
    ws = [w / tot for _, w in items]
    q = [int(round(w * 255)) for w in ws]
    q[0] += 255 - sum(q)
    for k, (b, _) in enumerate(items):
        skin_i[vi, k] = b; skin_w[vi, k] = q[k]
    dominant[vi] = items[0][0]
print("unweighted verts", sum(1 for a in acc if not a))

# ---------------------------------------------------------------- region masks (computed on the neutral mesh)
def J(name): return jpos(SJ[name])
P = V[:NB]
H = J("head____tail")[1] - min(P[:, 1])  # approx stature
print("stature (m)", round(H, 3))
def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def band(x, a, b, f):
    return ss(a - f, a + f, x) * (1 - ss(b - f, b + f, x))

def seg_coords(p, a, b, side):
    """axial fraction t along a->b and angle (deg) around the axis: 0 = anterior (+X), +90 = lateral."""
    ax = b - a; L = np.linalg.norm(ax); ax = ax / L
    rel = p - a
    t = rel @ ax / L
    radial = rel - np.outer(rel @ ax, ax)
    fwd = np.array([1.0, 0, 0]); fwd = fwd - (fwd @ ax) * ax; fwd /= np.linalg.norm(fwd)
    lat = np.cross(ax, fwd) * (1 if side == "R" else -1)
    # ensure lateral points away from the midline
    if lat[2] * (1 if side == "R" else -1) < 0: lat = -lat
    ang = np.degrees(np.arctan2(radial @ lat, radial @ fwd))
    return t, ang

MUSCLES = ["GMAX", "GMED", "ILIO", "ADD", "RF", "VAS", "HAM", "TA", "GAS", "SOL", "PER", "ES", "ABD", "DEL"]
mid = np.zeros(NB, np.uint8) + 255
mstr = np.zeros(NB)
mside = np.zeros(NB, np.uint8)
def put(name, side, strength):
    k = MUSCLES.index(name)
    better = strength > mstr
    mid[better] = k; mstr[better] = strength[better]; mside[better] = 0 if side == "L" else 1

dom = dominant[:NB]
names = {i: n for n, i in bone_index.items()}
dn = np.array([names[i] for i in dom])
def bones_in(*ns): return np.isin(dn, list(ns))
sp_lo, sp_hi = J("spine05____head"), J("spine01____tail")
shoulderY = J("upperarm01.L____head")[1]
eyes = {}
for s, g in (("L", "helper-l-eye"), ("R", "helper-r-eye")):
    eyes[s] = V[sorted({i for gg, c in faces if gg == g for i, _ in c})].mean(axis=0)
eye_c = (eyes["L"] + eyes["R"]) / 2
for s in ("L", "R"):
    sg = 1 if s == "R" else -1
    side = (P[:, 2] * sg) > 0.006
    hip, knee, ankle = J(f"upperleg01.{s}____head"), J(f"lowerleg01.{s}____head"), J(f"foot.{s}____head")
    t, a = seg_coords(P, hip, knee, s)
    th = side & bones_in(f"upperleg01.{s}", f"upperleg02.{s}", f"lowerleg01.{s}", "root", f"pelvis.{s}") & (t > -0.05) & (t < 1.0)
    put("RF", s, th * band(a, -30, 30, 10) * band(t, 0.1, 0.86, 0.08))
    put("VAS", s, th * np.maximum(band(a, 22, 112, 12) * band(t, 0.14, 0.92, 0.08), band(a, -88, -24, 12) * band(t, 0.48, 0.98, 0.07)))
    put("HAM", s, th * ss(108, 132, np.abs(a)) * band(t, 0.12, 0.92, 0.08))
    put("ADD", s, th * band(a, -132, -72, 10) * band(t, 0.0, 0.7, 0.08))
    t2, a2 = seg_coords(P, knee, ankle, s)
    sh = side & bones_in(f"lowerleg01.{s}", f"lowerleg02.{s}", f"upperleg02.{s}") & (t2 > -0.02) & (t2 < 0.95)
    put("TA", s, sh * band(a2, 4, 66, 10) * band(t2, 0.08, 0.82, 0.07))
    put("PER", s, sh * band(a2, 68, 122, 10) * band(t2, 0.08, 0.76, 0.07))
    put("GAS", s, sh * ss(112, 132, np.abs(a2)) * band(t2, 0.0, 0.58, 0.07))
    put("SOL", s, sh * ss(96, 118, np.abs(a2)) * band(t2, 0.48, 0.9, 0.06) * 0.95)
    rel = P - hip
    pel = side & bones_in("root", f"pelvis.{s}", f"upperleg01.{s}", f"upperleg02.{s}", "spine05", "spine04")
    put("GMAX", s, pel * ss(-0.02, -0.05, rel[:, 0]) * band(rel[:, 1], -0.1, 0.075, 0.025) * ss(0.008, 0.02, np.abs(P[:, 2])))
    put("GMED", s, pel * band(rel[:, 1], 0.035, 0.125, 0.02) * ss(0.0, 0.03, sg * rel[:, 2]) * band(rel[:, 0], -0.075, 0.035, 0.02))
    put("ILIO", s, pel * ss(0.015, 0.04, rel[:, 0]) * band(rel[:, 1], -0.03, 0.065, 0.02) * band(sg * rel[:, 2], -0.07, 0.03, 0.015))
    trunk = bones_in("spine05", "spine04", "spine03", "spine02", "spine01", "root")
    ty = (P[:, 1] - sp_lo[1]) / (sp_hi[1] - sp_lo[1])
    put("ES", s, trunk * ss(-0.0, -0.03, P[:, 0] - sp_lo[0]) * band(sg * P[:, 2], 0.006, 0.058, 0.012) * band(ty, 0.04, 0.7, 0.08))
    put("ABD", s, trunk * ss(0.02, 0.05, P[:, 0] - sp_lo[0]) * band(sg * P[:, 2], 0.0, 0.065, 0.012) * band(ty, 0.1, 0.55, 0.06))
    shj = J(f"upperarm01.{s}____head"); el = J(f"lowerarm01.{s}____head")
    t3, _ = seg_coords(P, shj, el, s)
    arm = side & bones_in(f"shoulder01.{s}", f"upperarm01.{s}", f"upperarm02.{s}", f"clavicle.{s}") & (np.abs(P[:, 2]) > abs(shj[2]) - 0.05)
    put("DEL", s, arm * band(t3, -0.2, 0.42, 0.08))
mstr = np.clip(mstr, 0, 1)
for k, n in enumerate(MUSCLES):
    print(n, int(((mid == k) & (mstr > 0.3)).sum()))

# ---------------------------------------------------------------- garment cut fields (metres; >0 inside the garment)
NEG = -1.0
neck_base = J("neck01____head"); hipL = J("upperleg01.L____head")
waist_y = hipL[1] + 0.09
torso = bones_in("spine05", "spine04", "spine03", "spine02", "spine01", "clavicle.L", "clavicle.R", "shoulder01.L", "shoulder01.R", "root", "pelvis.L", "pelvis.R", "neck01", "breast.L", "breast.R")
neckline = neck_base[1] - 0.015 - 0.035 * ss(0.0, 0.07, P[:, 0] - neck_base[0]) - 0.012 * ss(0.0, 0.06, neck_base[0] - P[:, 0])
shirt = np.where(torso, np.minimum(P[:, 1] - (waist_y - 0.035), neckline - P[:, 1]), NEG)
tank = np.where(torso, np.minimum(P[:, 1] - (waist_y + 0.005), neckline - 0.03 - P[:, 1]), NEG)
for s in ("L", "R"):
    sg = 1 if s == "R" else -1
    shj = J(f"upperarm01.{s}____head"); el = J(f"lowerarm01.{s}____head")
    t3, _ = seg_coords(P, shj, el, s)
    armv = bones_in(f"upperarm01.{s}", f"upperarm02.{s}", f"shoulder01.{s}") & ((P[:, 2] * sg) > 0)
    L3 = np.linalg.norm(el - shj)
    shirt = np.where(armv, np.maximum(np.where(torso, shirt, NEG), (0.4 - t3) * L3), shirt)
    # tank top: armhole (cut away the shoulder cap / armpit)
    strap = np.abs(np.abs(P[:, 2]) - 0.075) - 0.022
    arm_cut = np.minimum(np.abs(P[:, 2]) - (abs(shj[2]) - 0.035), (shj[1] - 0.06) - P[:, 1])
    tank = np.where((P[:, 2] * sg > 0) & torso, np.minimum(tank, np.maximum(-arm_cut, np.where(P[:, 1] > shj[1] - 0.06, -strap, NEG))), tank)
shorts = np.full(NB, NEG)
for s in ("L", "R"):
    sg = 1 if s == "R" else -1
    hip, knee = J(f"upperleg01.{s}____head"), J(f"lowerleg01.{s}____head")
    t, _ = seg_coords(P, hip, knee, s)
    L = np.linalg.norm(knee - hip)
    th = bones_in(f"upperleg01.{s}", f"upperleg02.{s}", f"lowerleg01.{s}", f"pelvis.{s}") & ((P[:, 2] * sg) > -0.02)
    shorts = np.where(th, np.maximum(shorts, (0.47 - t) * L), shorts)
pel = bones_in("root", "pelvis.L", "pelvis.R", "spine05", "spine04")
shorts = np.where(pel, np.maximum(shorts, waist_y + 0.012 - P[:, 1]), shorts)
shorts = np.minimum(shorts, waist_y + 0.012 - P[:, 1])
shoe = np.full(NB, NEG)
res = {s: np.full(NB, NEG) for s in ("L", "R")}
for s in ("L", "R"):
    sg = 1 if s == "R" else -1
    ankle = J(f"foot.{s}____head"); knee = J(f"lowerleg01.{s}____head")
    foot = bones_in(f"foot.{s}", f"toe.{s}", f"lowerleg02.{s}", f"lowerleg01.{s}") & ((P[:, 2] * sg) > 0)
    shoe = np.where(foot, np.maximum(shoe, ankle[1] + 0.045 - P[:, 1]), shoe)
    t2, _ = seg_coords(P, knee, ankle, s)
    Ls = np.linalg.norm(ankle - knee)
    leg = bones_in(f"foot.{s}", f"toe.{s}", f"lowerleg02.{s}", f"lowerleg01.{s}", f"upperleg02.{s}") & ((P[:, 2] * sg) > 0)
    res[s] = np.where(leg, (t2 - 0.44) * Ls, NEG)
# hair (relative to the eyeball centre): forehead ~6 cm, above ears ~3 cm, nape ~-7 cm
headv = bones_in("head", "neck03", "neck02")
rel = P - eye_c
rx, ry, rz = rel[:, 0], rel[:, 1], rel[:, 2]
hl = np.interp(rx, [-0.21, -0.15, -0.115, -0.08, -0.045, -0.02, 0.0, 0.05], [-0.085, -0.075, -0.03, 0.03, 0.04, 0.058, 0.064, 0.066]) + 0.9 * rz ** 2
hair = np.where(headv, ry - hl, NEG)
hl2 = np.interp(rx, [-0.21, -0.12, -0.08, -0.04, -0.015, 0.0, 0.05], [-0.16, -0.15, -0.09, 0.01, 0.05, 0.058, 0.062]) + 0.6 * rz ** 2
long_hair = np.where(headv, ry - hl2, NEG)
# brows & lips (strengths)
brow = np.zeros(NB)
for s, sg in (("L", -1), ("R", 1)):
    e = eyes[s]
    r = P - e
    lat = sg * r[:, 2]
    arc = 0.0215 - 2.2 * (lat - 0.008) ** 2
    front = ss(-0.002, 0.004, r[:, 0])
    brow = np.maximum(brow, headv * front * band(lat, -0.014, 0.03, 0.005) * band(r[:, 1] - arc, -0.0042, 0.0042, 0.002))
teeth = [i for g, c in faces if g in ("helper-upper-teeth", "helper-lower-teeth") for i, _ in c]
mouth = V[teeth].mean(axis=0)
r = P - mouth
lips = headv * ss(0.006, 0.011, r[:, 0]) * band(r[:, 2] / 0.025, -1, 1, 0.28) * band(r[:, 1], -0.0115, 0.0085, 0.0032)
print("brow", int((brow > 0.3).sum()), "lips", int((lips > 0.3).sum()), "hair", int((hair > 0).sum()), "long", int((long_hair > 0).sum()), "shirt", int((shirt > 0).sum()), "tank", int((tank > 0).sum()), "shorts", int((shorts > 0).sum()), "shoe", int((shoe > 0).sum()), "resL", int((res['L'] > 0).sum()))
def q8(x): return np.clip(np.round(x / 0.002), -127, 127).astype(np.int8)
CUTS = {"shirt": shirt, "tank": tank, "shorts": shorts, "shoe": shoe, "hair": hair, "long": long_hair, "resL": res["L"], "resR": res["R"]}

# ---------------------------------------------------------------- eyes proxy
def read_obj(path):
    v, vt, f = [], [], []
    for line in open(path):
        if line.startswith("v "): v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "): vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("f "):
            f.append([(int(t.split("/")[0]) - 1, int(t.split("/")[1]) - 1 if len(t.split("/")) > 1 and t.split("/")[1] else -1) for t in line.split()[1:]])
    return np.array(v), np.array(vt), f
ev, evt, ef = read_obj(fetch("eyes/high-poly/high-poly.obj"))
refs, wts, offs, scale = [], [], [], {}
reading = False
for line in open(fetch("eyes/high-poly/high-poly.mhclo")):
    p = line.split()
    if not p or p[0].startswith("#"): continue
    if p[0] in ("x_scale", "y_scale", "z_scale"): scale[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
    elif p[0] == "verts": reading = True
    elif reading and len(p) >= 9 and all(c.lstrip("-").replace(".", "").isdigit() for c in p[:9]):
        refs.append([int(p[0]), int(p[1]), int(p[2])]); wts.append([float(x) for x in p[3:6]]); offs.append([float(x) for x in p[6:9]])
    elif reading and len(p) == 1 and p[0].isdigit():
        refs.append([int(p[0])] * 3); wts.append([1, 0, 0]); offs.append([0, 0, 0])
    elif reading and p[0] in ("delete_verts", "material", "z_depth"): reading = False
assert len(refs) == len(ev), (len(refs), len(ev))
emap, erv, eruv, etris = {}, [], [], []
for face in ef:
    ids = []
    for i, t in face:
        k = (i, t)
        if k not in emap: emap[k] = len(erv); erv.append(i); eruv.append(evt[t] if t >= 0 else (0, 0))
        ids.append(emap[k])
    for k in range(1, len(ids) - 1): etris += [ids[0], ids[k], ids[k + 1]]
img = Image.open(fetch("eyes/materials/brown_eye.png")).convert("RGB").resize((256, 256), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, "JPEG", quality=88); eye_jpg = np.frombuffer(buf.getvalue(), np.uint8)
print("eye verts", len(ev), "render", len(erv), "tris", len(etris) // 3, "jpg", len(eye_jpg))

# ---------------------------------------------------------------- write binary
arrays, header = [], {"bones": [], "targets": [], "muscles": MUSCLES, "scale": {k: list(v) for k, v in scale.items()}, "license": "MakeHuman assets CC0 1.0"}
def add(name, arr):
    arr = np.ascontiguousarray(arr)
    arrays.append((name, arr))
add("base", V.astype(np.float32))
add("rv", np.array(rv, np.uint16)); add("ruv", np.array(ruv, np.float32)); add("tris", np.array(tris, np.uint16))
add("skinI", skin_i); add("skinW", skin_w)
add("mid", mid); add("mstr", (mstr * 255).astype(np.uint8)); add("mside", mside)
for k, v in CUTS.items(): add("cut_" + k, q8(v))
add("brow", (np.clip(brow, 0, 1) * 255).astype(np.uint8)); add("lips", (np.clip(lips, 0, 1) * 255).astype(np.uint8))
for name in TARGETS:
    idx, d = targets[name]
    sc = float(np.abs(d).max()) / 127 if len(d) else 1
    add("t_idx_" + name, idx.astype(np.uint16)); add("t_d_" + name, np.round(d / sc).astype(np.int8))
    header["targets"].append({"name": name, "scale": sc})
jidx = []
for b in bones:
    header["bones"].append({"name": b["name"], "parent": b["parent"], "head": [len(jidx), len(b["head"])], "tail": [len(jidx) + len(b["head"]), len(b["tail"])]})
    jidx += list(b["head"]) + list(b["tail"])
add("jidx", np.array(jidx, np.uint16))
add("e_ref", np.array(refs, np.uint16)); add("e_w", np.array(wts, np.float32)); add("e_off", np.array(offs, np.float32))
add("e_rv", np.array(erv, np.uint16)); add("e_uv", np.array(eruv, np.float32)); add("e_tris", np.array(etris, np.uint16)); add("e_jpg", eye_jpg)
# extra landmarks used at runtime
header["mouth"] = mouth.tolist(); header["eyeL"] = eyes["L"].tolist(); header["eyeR"] = eyes["R"].tolist()

blobs, off = [], 0
for name, arr in arrays:
    raw = arr.tobytes()
    header.setdefault("arrays", {})[name] = {"dtype": str(arr.dtype), "shape": list(arr.shape), "offset": off, "bytes": len(raw)}
    blobs.append(raw + b"\0" * ((-len(raw)) % 8)); off += len(raw) + ((-len(raw)) % 8)
hjson = json.dumps(header).encode()
hjson += b" " * ((-len(hjson) - 4) % 8)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "wb") as f:
    f.write(struct.pack("<I", len(hjson))); f.write(hjson); f.write(b"".join(blobs))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
