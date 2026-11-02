import sys
sys.path.insert(0, '/home/opencode/.local/lib/python3.11/site-packages')
import bpy
import bmesh
import math
import mathutils
from PIL import Image

# ---------------------------------------------------------------------------
# 1. Prepare clean textures from ref-stvermilion-nun.webp + SAM 3.1 masks
#    Image size: W=1120, H=2240
#    Top of hood: y=184 -> z=1.72m
#    Bottom of boots: y=2106 -> z=0.00m
#    Center X: x=567 -> x=0.00m
# ---------------------------------------------------------------------------
ref_path = "storage/.uploads/ref-stvermilion-nun.webp"
im_ref = Image.open(ref_path).convert("RGBA")

# Clean background & 2D-lantern region out of im_ref before saving robe_tex_path so only pure dark nun cloth + rosary remains!
import numpy as np
arr = np.array(im_ref).astype(np.float32)
r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
# Background teal/blue-green pixels have b > r + 12 or g > r + 12; 2D lantern glow on left (x < 405, y in 600..1120) has high orange r > 110
yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
is_teal_bg = (b > r + 10) | (g > r + 12) | (xx < 340) | (xx > 795)
is_2d_lantern = (xx < 420) & (yy > 580) & (yy < 1350) & (r > 65)
is_head_on_robe = (xx > 420) & (xx < 710) & (yy > 200) & (yy < 525)
mask_replace = is_teal_bg | is_2d_lantern | is_head_on_robe
# Replace background/lantern-bleed with dark charcoal tattered cloth weave
noise = ((np.sin(xx * 0.37) * np.cos(yy * 0.29)) * 6.0)
arr[mask_replace, 0] = np.clip(18 + noise[mask_replace], 10, 28)
arr[mask_replace, 1] = np.clip(19 + noise[mask_replace], 10, 29)
arr[mask_replace, 2] = np.clip(22 + noise[mask_replace], 12, 32)
im_clean_robe = Image.fromarray(arr.astype(np.uint8), "RGBA")
robe_tex_path = "/tmp/opencode/agatha_robe_tex.png"
im_clean_robe.resize((1024, 1024), Image.Resampling.LANCZOS).save(robe_tex_path)

# Save 512x512 high-detail HORROR face texture from SAM 3.1 yellow box (x1=502, y1=262, x2=632, y2=476)
# Grade it to corpse-ash pale with deep blackened eye hollows & bruised stitched cheeks (zero warm yellow/cat tint!)
face_crop_path = "/tmp/opencode/agatha_face_tex.png"
im_face_raw = im_ref.crop((502, 262, 632, 476)).resize((512, 512), Image.Resampling.LANCZOS)
f_arr = np.array(im_face_raw).astype(np.float32)
fr, fg, fb = f_arr[:,:,0], f_arr[:,:,1], f_arr[:,:,2]
lum = 0.299 * fr + 0.587 * fg + 0.114 * fb
# High-contrast S-curve so eye sockets, mouth cavity, and cheek stitches are pitch-dark and bone ridges are ash-pale
norm = np.clip((lum - 28.0) / 185.0, 0.0, 1.0)
curved = np.power(norm, 1.35) * 215.0
# Corpse-grey-blue desaturated palette (no warm yellow/orange!)
f_arr[:,:,0] = np.clip(curved * 0.92 + 8.0, 4, 225)
f_arr[:,:,1] = np.clip(curved * 0.95 + 10.0, 5, 230)
f_arr[:,:,2] = np.clip(curved * 1.02 + 14.0, 8, 240)
im_face = Image.fromarray(f_arr.astype(np.uint8), "RGBA")
im_face.save(face_crop_path)

def project_sam31_uvs(obj, x_center=567.0, y_top=184.0, y_bot=2106.0, z_top=1.72, z_bot=0.00):
    """Map 3D vertex (x, y, z) in meters directly to ref-stvermilion-nun.webp (u, v) via SAM 3.1 calibration!"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv_layer = bm.loops.layers.uv.verify()
    px_per_m = (y_bot - y_top) / (z_top - z_bot)  # ~1117.4 px/m
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            # In Blender, -x is character's right side (left side of image!), +x is character's left side (right side of image)
            px = x_center + co.x * px_per_m
            py = y_top + (z_top - co.z) * px_per_m
            u = max(0.35, min(0.67, 0.506 + co.x * 0.58))
            v = 1.0 - max(0.09, min(0.94, py / 2240.0))
            # Back side (co.y > 0.04): sample dark black fabric area of the robe (avoid background teal!)
            if co.y > 0.04:
                u = 0.50 + max(-0.14, min(0.14, co.x * 0.45))
                v = max(0.18, min(0.55, v))
            loop[uv_layer].uv = (u, v)
    bm.to_mesh(obj.data)
    bm.free()

# Reset Blender scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------------------
# 2. Import 3D Female Body (for real sculpted 3D head + real 3D hands)
# ---------------------------------------------------------------------------
bpy.ops.import_scene.gltf(filepath="/tmp/opencode/female_body_raw.glb")
female_objs = list(bpy.data.objects)

base_mesh_obj = None
for o in female_objs:
    if o.type == "MESH" and o.name == "base":
        base_mesh_obj = o
    else:
        bpy.data.objects.remove(o, do_unlink=True)

base_mesh_obj.parent = None
base_mesh_obj.modifiers.clear()
bpy.context.view_layer.objects.active = base_mesh_obj
base_mesh_obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# (A) Sculpt Anatomical 3D Horror Nun Head + Sunken Eye Sockets + 3D Eyeballs (ZERO ears sticking out!)
head_mesh = bpy.data.meshes.new("Agatha_Head")
head_obj = bpy.data.objects.new("Agatha_Head", head_mesh)
bpy.context.collection.objects.link(head_obj)

# Sample luminance of im_face for micro-relief (wrinkles, stitches, brow furrows, lips)
lum_grid = (0.299 * f_arr[:,:,0] + 0.587 * f_arr[:,:,1] + 0.114 * f_arr[:,:,2]) / 255.0

bm = bmesh.new()
uv_layer = bm.loops.layers.uv.verify()
H_ROWS = 72
W_COLS = 64
h_grid = []

for r in range(H_ROWS):
    v_frac = r / (H_ROWS - 1)  # 0.0 = neck/chin bottom (z=1.415m), 1.0 = forehead wimple top (z=1.645m)
    z = 1.415 + v_frac * 0.230
    row = []
    for c in range(W_COLS):
        u_frac = c / (W_COLS - 1)  # 0.0 = right side (-x), 0.5 = center (x=0), 1.0 = left side (+x)
        # Half-cylinder + back cranium angle: theta in [-0.88*pi, +0.88*pi], where 0 is dead-front (-Y)
        theta = (u_frac - 0.5) * 1.76 * math.pi
        sin_t = math.sin(theta)
        cos_t = math.cos(theta)

        # Narrow gaunt horror face silhouette (NO ears! Tapered hollow jaw, prominent cheekbones, narrow temples)
        if v_frac < 0.18:
            # Neck & sharp narrow chin point
            t_chin = v_frac / 0.18
            rx = 0.036 + 0.022 * (t_chin ** 0.7)
            ry = 0.048 + 0.024 * t_chin
        elif v_frac < 0.48:
            # Gaunt hollow lower cheeks expanding to sharp zygomatic cheekbones at v_frac=0.52
            t_jaw = (v_frac - 0.18) / 0.30
            hollow = -0.007 * math.sin(t_jaw * math.pi) * (1.0 - abs(abs(sin_t) - 0.65))
            rx = 0.058 + 0.011 * t_jaw + hollow
            ry = 0.072 + 0.010 * t_jaw
        elif v_frac < 0.76:
            # Cheekbones (0.48) -> Eye sockets (0.60) -> Brow ridge (0.70)
            t_mid = (v_frac - 0.48) / 0.28
            rx = 0.069 - 0.005 * t_mid
            ry = 0.082
        else:
            # Forehead wimple band tapering smoothly into hood
            t_top = (v_frac - 0.76) / 0.24
            rx = 0.064 * (1.0 - 0.22 * (t_top ** 1.4))
            ry = 0.080 * (1.0 - 0.18 * (t_top ** 1.4))

        x = rx * sin_t
        y = -ry * cos_t - 0.032  # Front of face is towards -Y

        # 3D Anatomical Horror Features on the front face (cos_t > 0.15):
        if cos_t > 0.15:
            fw = cos_t
            # 1. Sharp protruding hooked nose bridge & tip (x near 0, v_frac in [0.36, 0.66])
            if 0.35 <= v_frac <= 0.68:
                nx = abs(x) / 0.014
                if nx < 1.0:
                    nt_v = (v_frac - 0.35) / 0.33  # 0 at tip/nostrils, 1 at brow bridge
                    nose_prof = math.sin(nt_v * math.pi) ** 0.75
                    # Hooked bridge + sharp tip at v_frac=0.42
                    tip_boost = 0.009 * math.exp(-((v_frac - 0.43) / 0.06) ** 2)
                    y -= (0.022 * nose_prof + tip_boost) * ((1.0 - nx * nx) ** 1.3) * fw

            # 2. Deeply sunken hollow eye sockets (centers at x = +-0.024, v_frac = 0.60)
            for ex_c in (-0.024, 0.024):
                edx = (x - ex_c) / 0.018
                edz = (v_frac - 0.60) / 0.075
                ed2 = edx * edx + edz * edz
                if ed2 < 1.0:
                    y += 0.016 * ((1.0 - ed2) ** 1.4) * fw

            # 3. Heavy menacing furrowed brow ridge above eyes (v_frac around 0.69)
            brow_d = abs(v_frac - 0.69) / 0.045
            if brow_d < 1.0 and abs(x) < 0.048:
                y -= 0.010 * (1.0 - brow_d * brow_d) * fw

            # 4. Gaunt sunken cheek hollows below cheekbones (x = +-0.036, v_frac = 0.38)
            for cx_c in (-0.036, 0.036):
                cdx = (x - cx_c) / 0.020
                cdz = (v_frac - 0.38) / 0.11
                cd2 = cdx * cdx + cdz * cdz
                if cd2 < 1.0:
                    y += 0.012 * ((1.0 - cd2) ** 1.2) * fw

            # 5. Open screaming/gasping dark horror mouth cavity (x in [-0.016, +0.016], v_frac in [0.20, 0.31])
            mdx = x / 0.015
            mdz = (v_frac - 0.255) / 0.052
            md2 = mdx * mdx + mdz * mdz
            if md2 < 1.0:
                y += 0.018 * ((1.0 - md2) ** 1.5) * fw

            # 6. Micro-displacement from SAM 3.1 face texture luminance (wrinkles, stitches, nasolabial folds)
            u_img = max(0.04, min(0.96, 0.5 + x / 0.118))
            v_img = max(0.04, min(0.96, v_frac))
            px_i = int(u_img * 511)
            py_i = int((1.0 - v_img) * 511)
            l_val = float(lum_grid[py_i, px_i])
            y -= (l_val - 0.45) * 0.008 * fw

        vtx = bm.verts.new((x, y, z))
        row.append(vtx)
    h_grid.append(row)

for r in range(H_ROWS - 1):
    v_f0 = r / (H_ROWS - 1)
    v_f1 = (r + 1) / (H_ROWS - 1)
    for c in range(W_COLS - 1):
        v1 = h_grid[r][c]
        v2 = h_grid[r][c + 1]
        v3 = h_grid[r + 1][c + 1]
        v4 = h_grid[r + 1][c]
        fc = bm.faces.new((v1, v2, v3, v4))
        for loop, vf in zip(fc.loops, (v_f0, v_f0, v_f1, v_f1)):
            co = loop.vert.co
            if co.y < -0.045:
                u = max(0.04, min(0.96, 0.5 + co.x / 0.118))
                v = max(0.04, min(0.96, vf))
            else:
                u = 0.08
                v = 0.12
            loop[uv_layer].uv = (u, v)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(head_mesh)
bm.free()

# (B) Extract Left & Right 3D Sculpted Hands from base_mesh_obj!
# Right hand in T-pose is x in [-0.69, -0.50], Left hand is x in [0.50, 0.69]
hand_r = base_mesh_obj.copy()
hand_r.data = base_mesh_obj.data.copy()
hand_r.name = "Agatha_Hand_R"
bpy.context.collection.objects.link(hand_r)
bm = bmesh.new()
bm.from_mesh(hand_r.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > -0.51 or v.co.z < 1.15], context='VERTS')
if len(bm.verts) > 0:
    hxs = [v.co.x for v in bm.verts]; hys = [v.co.y for v in bm.verts]; hzs = [v.co.z for v in bm.verts]
    hcx, hcy, hcz = 0.5*(min(hxs)+max(hxs)), 0.5*(min(hys)+max(hys)), 0.5*(min(hzs)+max(hzs))
    # Place Right Hand at SAM 3.1 lantern grip: x = -0.25m, y = -0.22m, z = 1.21m
    for v in bm.verts:
        dx = (v.co.x - hcx) * 0.85
        dy = (v.co.y - hcy) * 0.85
        dz = (v.co.z - hcz) * 0.85
        # Curl slightly around handle
        v.co.x = -0.25 + dx * 0.7
        v.co.y = -0.22 + dy - abs(dx) * 0.3
        v.co.z = 1.21 + dz
bm.to_mesh(hand_r.data)
bm.free()

hand_l = base_mesh_obj.copy()
hand_l.data = base_mesh_obj.data.copy()
hand_l.name = "Agatha_Hand_L"
bpy.context.collection.objects.link(hand_l)
bm = bmesh.new()
bm.from_mesh(hand_l.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < 0.51 or v.co.z < 1.15], context='VERTS')
if len(bm.verts) > 0:
    hxs = [v.co.x for v in bm.verts]; hys = [v.co.y for v in bm.verts]; hzs = [v.co.z for v in bm.verts]
    hcx, hcy, hcz = 0.5*(min(hxs)+max(hxs)), 0.5*(min(hys)+max(hys)), 0.5*(min(hzs)+max(hzs))
    # Place Left Hand at SAM 3.1 left cuff: x = +0.25m, y = -0.08m, z = 0.82m (pointing down)
    for v in bm.verts:
        dx = (v.co.x - hcx) * 0.85
        dy = (v.co.y - hcy) * 0.85
        dz = (v.co.z - hcz) * 0.85
        # Rotate 90 deg so fingers point down (-Z)
        v.co.x = 0.25 + dz * 0.7
        v.co.y = -0.08 + dy
        v.co.z = 0.82 - dx
bm.to_mesh(hand_l.data)
bm.free()

bpy.data.objects.remove(base_mesh_obj, do_unlink=True)

# ---------------------------------------------------------------------------
# 3. Import Black Tattered Gown + Cape + Belt + Boots (/tmp/opencode/black_gown_raw.glb)
# ---------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath="/tmp/opencode/black_gown_raw.glb")
gown_objs = [o for o in bpy.data.objects if o not in before]

kept_gown = []
for o in list(gown_objs):
    if o.type != "MESH" or o.name in ("Hat", "Emerald", "Cape"):
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    o.parent = None
    o.modifiers.clear()
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.select_set(False)
    kept_gown.append(o)

    if o.name == "Clothes":
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for v in bm.verts:
            ax = abs(v.co.x)
            if ax > 0.15:
                dist = ax - 0.15  # 0 .. 0.57m along arm
                t = min(1.0, dist / 0.55)
                # Keep wide bell-sleeve cuff thickness (don't collapse dz!)
                sleeve_r_z = v.co.z - 1.38
                sleeve_r_y = v.co.y
                flare = 1.0 + 0.45 * t  # wide nun bell sleeve at cuff!
                if v.co.x < 0:
                    # Right sleeve: goes from shoulder (-0.17, 0.0, 1.38) DOWN & FORWARD to wrist (-0.25, -0.20, 1.21)
                    cx_arm = -0.17 - 0.08 * t
                    cy_arm = -0.02 - 0.19 * (t ** 1.1)
                    cz_arm = 1.38 - 0.22 * math.sin(t * math.pi * 0.75)
                    v.co.x = cx_arm + sleeve_r_z * 0.35 * flare
                    v.co.y = cy_arm + sleeve_r_y * flare
                    v.co.z = cz_arm + sleeve_r_z * 0.85 * flare
                else:
                    # Left sleeve: goes from shoulder (+0.17, 0.0, 1.38) DOWN along side to wrist (+0.25, -0.07, 0.86)
                    cx_arm = 0.17 + 0.08 * t
                    cy_arm = -0.01 - 0.07 * t
                    cz_arm = 1.38 - 0.52 * t
                    v.co.x = cx_arm + sleeve_r_z * 0.55 * flare
                    v.co.y = cy_arm + sleeve_r_y * flare
                    v.co.z = cz_arm + sleeve_r_z * 0.45 * flare
        bm.to_mesh(o.data)
        bm.free()

    if o.name == "Skirt":
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for v in bm.verts:
            v.co.x *= 1.15
            v.co.y *= 1.15
        bm.to_mesh(o.data)
        bm.free()

# ---------------------------------------------------------------------------
# 4. Sculpt Authentic Draped Nun Hood & Flowing Veil around SAM 3.1 Green Box!
#    Green box: z in [0.55m, 1.72m], framing the face at z in [1.43m, 1.65m]
# ---------------------------------------------------------------------------
hood_mesh = bpy.data.meshes.new("Agatha_Nun_Hood")
hood_obj = bpy.data.objects.new("Agatha_Nun_Hood", hood_mesh)
bpy.context.collection.objects.link(hood_obj)

bm = bmesh.new()
# Create an organic multi-layered draped cathedral nun veil & cowl (36 radial x 28 vertical rings)
rings = 28
segs = 36
grid = []
for r in range(rings):
    v_frac = r / (rings - 1)  # 0.0 (bottom drape z=0.82m) -> 1.0 (top crown z=1.72m)
    z = 0.82 + v_frac * 0.90
    row = []
    for s in range(segs):
        theta = (s / segs) * 2.0 * math.pi  # theta = -pi/2 is front (-Y), +pi/2 is back (+Y)
        # Profile width & depth matching SAM 3.1 green mask:
        # Crown (z=1.72): rounded arch; Face level (z=1.52): frames cheeks; Shoulders (z=1.35): drapes wide; Lower veil (z=0.82): tattered points
        if z > 1.64:
            t_top = (z - 1.64) / 0.08
            rx = 0.13 * math.sqrt(max(0.02, 1.0 - t_top * 0.85))
            ry = 0.14 * math.sqrt(max(0.02, 1.0 - t_top * 0.85))
        elif z > 1.38:
            t_head = (1.64 - z) / 0.26
            rx = 0.115 + 0.075 * t_head
            ry = 0.125 + 0.045 * t_head
        else:
            t_drape = (1.38 - z) / 0.56
            flare_w = 0.19 + 0.14 * math.sin(t_drape * math.pi * 0.65)
            # Tattered uneven hem waves at the bottom of the veil
            tatter = 0.04 * math.sin(theta * 7.0) + 0.025 * math.cos(theta * 11.0) if t_drape > 0.6 else 0.0
            rx = flare_w
            ry = 0.15 + 0.06 * t_drape
            z += tatter * ((t_drape - 0.6) / 0.4 if t_drape > 0.6 else 0.0)

        x = rx * math.cos(theta)
        y = ry * math.sin(theta) - 0.02

        # Open the front face window (sin(theta) < -0.35 and z in [0.82, 1.62]) so her face & chest cross are visible!
        if y < -0.055 and z < 1.635:
            # Pull front edges neatly to left/right side of face & shoulders (x = +-0.085 at face, +-0.16 at chest)
            min_abs_x = 0.078 if z > 1.40 else (0.078 + (1.40 - z) * 0.22)
            if abs(x) < min_abs_x:
                x = -min_abs_x if x < 0 else min_abs_x
                y = -0.055 + 0.02 * (1.0 - abs(x) / 0.28)

        # Cloth fold ripples
        x += 0.008 * math.sin(theta * 9.0 + z * 6.0)
        vtx = bm.verts.new((x, y, z))
        row.append(vtx)
    grid.append(row)

for r in range(rings - 1):
    for s in range(segs):
        s_next = (s + 1) % segs
        v1 = grid[r][s]
        v2 = grid[r][s_next]
        v3 = grid[r + 1][s_next]
        v4 = grid[r + 1][s]
        # Skip faces that span across the front face opening (from -x to +x on the front -Y side)
        if v1.co.y < -0.03 and v2.co.y < -0.03 and (v1.co.x * v2.co.x < 0) and v1.co.z < 1.62:
            continue
        bm.faces.new((v1, v2, v3, v4))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(hood_mesh)
bm.free()

# ---------------------------------------------------------------------------
# 5. Import Real Polyhaven Brass Lantern (Uniform Scale across all sub-meshes!)
# ---------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath="public/assets/polyhaven/Lantern_01/Lantern_01_1k.glb")
lantern_objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
for o in [x for x in bpy.data.objects if x not in before and x.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)

# Apply transforms and JOIN all lantern sub-meshes into ONE unified Agatha_Lantern mesh FIRST!
bpy.ops.object.select_all(action='DESELECT')
for o in lantern_objs:
    o.parent = None
    o.select_set(True)
bpy.context.view_layer.objects.active = lantern_objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(lantern_objs) > 1:
    bpy.ops.object.join()
lantern_obj = bpy.context.view_layer.objects.active
lantern_obj.name = "Agatha_Lantern"

# Now scale the unified lantern uniformly so its height is 0.36m and top ring sits in Agatha's right hand (-0.25, -0.22, 1.21)!
bm = bmesh.new()
bm.from_mesh(lantern_obj.data)
lxs = [v.co.x for v in bm.verts]; lys = [v.co.y for v in bm.verts]; lzs = [v.co.z for v in bm.verts]
lcx = 0.5 * (min(lxs) + max(lxs))
lcy = 0.5 * (min(lys) + max(lys))
lz_min, lz_max = min(lzs), max(lzs)
l_scale = 0.36 / max(0.01, lz_max - lz_min)
for v in bm.verts:
    v.co.x = (v.co.x - lcx) * l_scale - 0.25
    v.co.y = (v.co.y - lcy) * l_scale - 0.22
    v.co.z = (v.co.z - lz_min) * l_scale + 0.85
bm.to_mesh(lantern_obj.data)
bm.free()

# Add glowing ember core inside lantern + LanternAnchor Empty
anchor = bpy.data.objects.new("LanternAnchor", None)
anchor.location = (-0.25, -0.22, 1.00)
bpy.context.collection.objects.link(anchor)

# ---------------------------------------------------------------------------
# 6. Apply Authentic SAM 3.1 UV-Projected Textures & Materials
# ---------------------------------------------------------------------------
# (A) Face Material
mat_face = bpy.data.materials.new("Agatha_Face_Mat")
mat_face.use_nodes = True
nt = mat_face.node_tree
bsdf = nt.nodes.get("Principled BSDF")
tex_face = nt.nodes.new("ShaderNodeTexImage")
tex_face.image = bpy.data.images.load(face_crop_path)
nt.links.new(bsdf.inputs["Base Color"], tex_face.outputs["Color"])
bsdf.inputs["Roughness"].default_value = 0.75
head_obj.data.materials.clear()
head_obj.data.materials.append(mat_face)

# (B) Habit Robe + Veil + Rosary Cross Projected Material (from ref-stvermilion-nun.webp)
mat_robe = bpy.data.materials.new("Agatha_Habit_Mat")
mat_robe.use_nodes = True
mat_robe.use_backface_culling = False
nt_r = mat_robe.node_tree
bsdf_r = nt_r.nodes.get("Principled BSDF")
tex_robe = nt_r.nodes.new("ShaderNodeTexImage")
tex_robe.image = bpy.data.images.load(robe_tex_path)
nt_r.links.new(bsdf_r.inputs["Base Color"], tex_robe.outputs["Color"])
bsdf_r.inputs["Roughness"].default_value = 0.88

for o in kept_gown + [hood_obj, hand_l, hand_r]:
    project_sam31_uvs(o)
    o.data.materials.clear()
    o.data.materials.append(mat_robe)

# Downscale any remaining textures > 1024
for img in bpy.data.images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        img.scale(1024, 1024)

# ---------------------------------------------------------------------------
# 7. Export fast-loading standard GLB (no Draco needed!) & Render Preview
# ---------------------------------------------------------------------------
for o in bpy.data.objects:
    if o.type == "MESH":
        for p in o.data.polygons:
            p.use_smooth = True
out_glb = "public/live-preview/assets/agatha.glb"
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_draco_mesh_compression_enable=False,
    export_apply=True,
)
print("EXPORTED:", out_glb)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 800
scene.render.resolution_y = 1000
world = bpy.data.worlds.new("StudioWorld")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.04, 0.05, 0.06, 1.0)

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
cam.location = (0.0, -2.55, 0.90)
cam.rotation_euler = (math.radians(88), 0, 0)

key_light = bpy.data.lights.new("Key", type='AREA')
key_light.energy = 110
key_light.color = (0.82, 0.90, 1.0)
kl_obj = bpy.data.objects.new("Key", key_light)
kl_obj.location = (1.2, -2.0, 1.8)
kl_obj.rotation_euler = (math.radians(60), 0, math.radians(30))
bpy.context.collection.objects.link(kl_obj)

lantern_light = bpy.data.lights.new("LanternPt", type='POINT')
lantern_light.energy = 55
lantern_light.color = (1.0, 0.62, 0.20)
ll_obj = bpy.data.objects.new("LanternPt", lantern_light)
ll_obj.location = (-0.25, -0.32, 1.00)
bpy.context.collection.objects.link(ll_obj)

scene.render.filepath = "/tmp/opencode/agatha_front.png"
bpy.ops.render.render(write_still=True)

# 3/4 View (35 deg)
cam.location = (-1.45, -2.10, 0.92)
cam.rotation_euler = (math.radians(88), 0, math.radians(-34))
scene.render.filepath = "/tmp/opencode/agatha_angle.png"
bpy.ops.render.render(write_still=True)

# Side View (75 deg)
cam.location = (-2.35, -0.75, 0.92)
cam.rotation_euler = (math.radians(88), 0, math.radians(-72))
scene.render.filepath = "/tmp/opencode/agatha_side.png"
bpy.ops.render.render(write_still=True)

# Combine into a 3-panel turnaround sheet
im1 = Image.open("/tmp/opencode/agatha_front.png")
im2 = Image.open("/tmp/opencode/agatha_angle.png")
im3 = Image.open("/tmp/opencode/agatha_side.png")
sheet = Image.new("RGB", (im1.width * 3, im1.height), (10, 12, 15))
sheet.paste(im1, (0, 0))
sheet.paste(im2, (im1.width, 0))
sheet.paste(im3, (im1.width * 2, 0))
sheet.save("/tmp/opencode/agatha_sam31_preview.png")
# Also render a close-up face portrait
cam.location = (0.0, -0.62, 1.53)
cam.rotation_euler = (math.radians(89), 0, 0)
scene.render.resolution_x = 700
scene.render.resolution_y = 700
scene.render.filepath = "/tmp/opencode/agatha_face_closeup.png"
bpy.ops.render.render(write_still=True)
print("RENDERED 3-VIEW TURNAROUND: /tmp/opencode/agatha_sam31_preview.png")
