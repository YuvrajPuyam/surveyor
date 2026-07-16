"""Visual proof renders for the Fouriesburg teardown.
A: side elevation (X vs Y)  - splat cloud vs collider: the backdrop gap.
B: top-down (X vs Z) defect map - collider heightmap + defect regions.
"""
import json, struct
from PIL import Image, ImageDraw, ImageFont

BUNDLE = r"D:\worlds-in-action\assets\marble\7f8eb141-3486-4b39-a546-eb98c47ba351"

# ---- load splat points
with open(BUNDLE + r"\visual-points.f32", "rb") as f:
    raw = f.read()
n = len(raw) // 12
pts = struct.unpack(f"<{n*3}f", raw)

# ---- load collider verts from GLB (quick parse: use trimesh? not installed - parse via pygltflib? no)
# Instead: sample collider surface via the certificate floor plane is weak; parse GLB minimally.
# GLB: 12-byte header, then chunks. JSON chunk + BIN chunk. Extract POSITION accessor.
with open(BUNDLE + r"\collider.glb", "rb") as f:
    glb = f.read()
assert glb[:4] == b"glTF"
off = 12
chunks = {}
while off < len(glb):
    clen, ctype = struct.unpack_from("<I4s", glb, off)
    chunks[ctype] = glb[off+8:off+8+clen]
    off += 8 + clen
gltf = json.loads(chunks[b"JSON"])
binbuf = chunks[b"BIN\x00"]
# find first POSITION accessor
prim = gltf["meshes"][0]["primitives"][0]
acc = gltf["accessors"][prim["attributes"]["POSITION"]]
bv = gltf["bufferViews"][acc["bufferView"]]
start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
cn = acc["count"]
cverts = struct.unpack_from(f"<{cn*3}f", binbuf, start)

# ---- certificate defects
cert = json.load(open(BUNDLE + r"\certificate.json", encoding="utf-8"))
defects = cert["defects"]

W, H = 1800, 900
MARGIN = 60

def make_canvas(title):
    img = Image.new("RGB", (W, H), (12, 14, 18))
    d = ImageDraw.Draw(img, "RGBA")
    try:
        font = ImageFont.truetype("arial.ttf", 22)
        small = ImageFont.truetype("arial.ttf", 15)
    except Exception:
        font = small = ImageFont.load_default()
    d.text((MARGIN, 12), title, fill=(230, 230, 235), font=font)
    return img, d, small

# ============ A: SIDE ELEVATION (X horizontal, Y vertical) ============
xs = pts[0::3]; ys = pts[1::3]
cxs = cverts[0::3]; cys = cverts[1::3]
mnx, mxx = min(min(xs), min(cxs)), max(max(xs), max(cxs))
mny, mxy = min(min(ys), min(cys)), max(max(ys), max(cys))
sx = (W - 2*MARGIN) / (mxx - mnx)
sy = (H - 2*MARGIN - 30) / (mxy - mny)
def A_px(x, y):
    return (MARGIN + (x - mnx) * sx, H - MARGIN + -(y - mny) * sy)

imgA, dA, smallA = make_canvas("PHYSICAL vs PHOTOVISUAL - side elevation | splat cloud (blue) vs collider mesh (orange)")
# splat points (subsample for speed)
px = imgA.load()
for i in range(0, n, 2):
    x, y = A_px(pts[i*3], pts[i*3+1])
    xi, yi = int(x), int(y)
    if 0 <= xi < W and 0 <= yi < H:
        r, g, b = px[xi, yi]
        px[xi, yi] = (min(255, r+18), min(255, g+26), min(255, b+40))
# collider verts
for i in range(cn):
    x, y = A_px(cverts[i*3], cverts[i*3+1])
    xi, yi = int(x), int(y)
    for dx in (0,1):
        for dy in (0,1):
            if 0 <= xi+dx < W and 0 <= yi+dy < H:
                px[xi+dx, yi+dy] = (255, 140, 40)
# annotate collider Y band
_, ytop = A_px(0, max(cys)); _, ybot = A_px(0, min(cys))
dA.line([(MARGIN, ytop), (W-MARGIN, ytop)], fill=(255, 140, 40, 120), width=1)
dA.text((W-MARGIN-560, ytop-26), "top of PHYSICAL world (collider +16.9 m)", fill=(255, 160, 70), font=smallA)
_, ysplat = A_px(0, max(ys))
dA.text((W-MARGIN-620, ysplat+8), "top of PHOTOVISUAL world (splats +100.7 m) - 84 m of visuals with NO physics", fill=(140, 170, 255), font=smallA)
imgA.save(BUNDLE + r"\proof-side-elevation.png")

# ============ B: TOP-DOWN DEFECT MAP (X horizontal, Z vertical) ============
zs = pts[2::3]; czs = cverts[2::3]
mnz, mxz = min(min(zs), min(czs)), max(max(zs), max(czs))
sx2 = (W - 2*MARGIN) / (mxx - mnx)
sz2 = (H - 2*MARGIN - 30) / (mxz - mnz)
def B_px(x, z):
    return (MARGIN + (x - mnx) * sx2, MARGIN + 30 + (z - mnz) * sz2)

imgB, dB, smallB = make_canvas("WHERE IT IS BROKEN - top-down | ground (gray by height), phantom colliders (red), ghost geometry (magenta), sills (yellow)")
pxB = imgB.load()
# collider ground, height-shaded
ymin_c, ymax_c = min(cys), max(cys)
for i in range(cn):
    x, z = B_px(cverts[i*3], cverts[i*3+2])
    xi, yi = int(x), int(z)
    if 0 <= xi < W and 0 <= yi < H:
        h = (cverts[i*3+1] - ymin_c) / (ymax_c - ymin_c)
        v = int(60 + 130 * h)
        pxB[xi, yi] = (v, v, v)
# defect regions
COLORS = {"phantom_collider": (255, 60, 60, 110), "visual_only_surface": (255, 60, 255, 200),
          "raised_sill": (255, 220, 40, 255), "collider_hole": (80, 220, 80, 255)}
counts = {}
for de in defects:
    c = COLORS.get(de["type"])
    if not c:
        continue
    counts[de["type"]] = counts.get(de["type"], 0) + 1
    (x0, _, z0) = de["region"]["min"]; (x1, _, z1) = de["region"]["max"]
    p0 = B_px(x0, z0); p1 = B_px(x1, z1)
    box = [min(p0[0],p1[0]), min(p0[1],p1[1]), max(p0[0],p1[0])+1, max(p0[1],p1[1])+1]
    # regions bigger than ~15 m on a side drown the map as fills - outline them
    if (x1-x0) > 15 or (z1-z0) > 15:
        dB.rectangle(box, outline=c[:3] + (255,), width=2)
    else:
        dB.rectangle(box, fill=c)
# floaters from extended checks
ext = cert.get("extendedChecks", {})
for fl in ext.get("floaters", {}).get("examples", []):
    x0, _, z0 = fl["min"]; x1, _, z1 = fl["max"]
    p0 = B_px(x0, z0); p1 = B_px(x1, z1)
    dB.ellipse([min(p0[0],p1[0])-4, min(p0[1],p1[1])-4, max(p0[0],p1[0])+4, max(p0[1],p1[1])+4], outline=(60, 255, 255, 255), width=2)
legend = "  |  ".join(f"{k}: {v:,}" for k, v in sorted(counts.items(), key=lambda e: -e[1]))
dB.text((MARGIN, H-32), legend + "  |  cyan circles: largest floaters", fill=(200, 200, 210), font=smallB)
imgB.save(BUNDLE + r"\proof-defect-map.png")
print("saved proof-side-elevation.png and proof-defect-map.png")
