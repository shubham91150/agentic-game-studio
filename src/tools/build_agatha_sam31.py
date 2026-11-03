import sys
sys.path.insert(0, '/home/opencode/.local/lib/python3.11/site-packages')
import bpy
import bmesh
import math
import mathutils
import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# 1. Prepare clean 1024x1024 textures in PIL (fast, 0.2s)
# ---------------------------------------------------------------------------
ref_path = "storage/.uploads/ref-stvermilion-nun.webp"
im_ref = Image.open(ref_path).convert("RGBA")
arr = np.array(im_ref).astype(np.float32)
r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
is_teal_bg = (b > r + 10) | (g > r + 12) | (xx < 340) | (xx > 795)
is_2d_lantern = (xx < 420) & (yy > 580) & (yy < 1350) & (r > 65)
is_head_on_robe = (xx > 420) & (xx < 710) & (yy > 200) & (yy < 525)
mask_replace = is_teal_bg | is_2d_lantern | is_head_on_robe
noise = ((np.sin(xx * 0.37) * np.cos(yy * 0.29)) * 6.0)
arr[mask_replace, 0] = np.clip(18 + noise[mask_replace], 10, 28)
arr[mask_replace, 1] = np.clip(19 + noise[mask_replace], 10, 29)
arr[mask_replace, 2] = np.clip(22 + noise[mask_replace], 12, 32)
robe_tex_path = "/tmp/opencode/agatha_robe_tex.png"
Image.fromarray(arr.astype(np.uint8), "RGBA").resize((1024, 1024), Image.Resampling.LANCZOS).save(robe_tex_path)

# Slightly cool/pale the natural human lady skin texture (/tmp/opencode/female_img_1.png) so it looks eerie & gothic in dark corridors
im_skin = Image.open("/tmp/opencode/female_img_1.png").convert("RGBA")
s_arr = np.array(im_skin).astype(np.float32)
sr, sg, sb = s_arr[:,:,0], s_arr[:,:,1], s_arr[:,:,2]
slum = 0.299 * sr + 0.587 * sg + 0.114 * sb
s_arr[:,:,0] = np.clip(sr * 0.62 + slum * 0.32, 0, 255)
s_arr[:,:,1] = np.clip(sg * 0.60 + slum * 0.33, 0, 255)
s_arr[:,:,2] = np.clip(sb * 0.64 + slum * 0.36, 0, 255)
human_skin_path = "/tmp/opencode/agatha_human_lady_skin.png"
Image.fromarray(s_arr.astype(np.uint8), "RGBA").save(human_skin_path)

def project_sam31_uvs(obj, x_center=567.0, y_top=184.0, y_bot=2106.0, z_top=1.72, z_bot=0.00):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv_layer = bm.loops.layers.uv.verify()
    px_per_m = (y_bot - y_top) / (z_top - z_bot)
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            py = y_top + (z_top - co.z) * px_per_m
            u = max(0.35, min(0.67, 0.506 + co.x * 0.58))
            v = 1.0 - max(0.09, min(0.94, py / 2240.0))
            if co.y > 0.04:
                u = 0.50 + max(-0.14, min(0.14, co.x * 0.45))
                v = max(0.18, min(0.55, v))
            loop[uv_layer].uv = (u, v)
    bm.to_mesh(obj.data)
    bm.free()

def recenter_origin(obj, pivot_xyz):
    """Move mesh object's origin to pivot_xyz while keeping world vertex positions unchanged (for clean joint rotation!)."""
    px, py, pz = pivot_xyz
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        v.co.x -= px
        v.co.y -= py
        v.co.z -= pz
    bm.to_mesh(obj.data)
    bm.free()
    obj.location = (px, py, pz)

# Reset Blender scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------------------
# 2. Import 3D Female Body -> Keep REAL Human Lady 3D Head + Eyes + Brows + Hands
# ---------------------------------------------------------------------------
bpy.ops.import_scene.gltf(filepath="/tmp/opencode/female_body_raw.glb")
female_objs = list(bpy.data.objects)

base_mesh_obj = None
eye_objs = []
brow_objs = []
jaw_objs = []
for o in female_objs:
    if o.type == "MESH" and o.name == "base":
        base_mesh_obj = o
    elif o.type == "MESH" and o.name in ("eyes.L", "eyes.R"):
        eye_objs.append(o)
    elif o.type == "MESH" and o.name in ("Eyebrow.L", "Eyebrow.R"):
        brow_objs.append(o)
    elif o.type == "MESH" and o.name in ("Lowerjaw", "Upperjaw"):
        jaw_objs.append(o)

kept_female = [base_mesh_obj] + eye_objs + brow_objs + jaw_objs
for o in kept_female:
    if o is not None:
        mw = o.matrix_world.copy()
        o.parent = None
        o.modifiers.clear()
        o.matrix_world = mw
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for o in female_objs:
    if o not in kept_female:
        bpy.data.objects.remove(o, do_unlink=True)

# IMMEDIATELY purge all 22 4096x4096 materials & images from female_body_raw.glb so Blender stays lightning-fast!
for o in kept_female:
    if o is not None:
        o.data.materials.clear()
for mat in list(bpy.data.materials):
    bpy.data.materials.remove(mat, do_unlink=True)
for img in list(bpy.data.images):
    bpy.data.images.remove(img, do_unlink=True)

# (A) Extract Agatha_Head from base_mesh_obj keeping her ORIGINAL UVs!
head_obj = base_mesh_obj.copy()
head_obj.data = base_mesh_obj.data.copy()
head_obj.name = "Agatha_Head"
bpy.context.collection.objects.link(head_obj)

bm = bmesh.new()
bm.from_mesh(head_obj.data)
# Trim below neck (z < 1.36) and trim protruding ear tips (|x| > 0.075 at z > 1.46) so ears stay inside the nun hood!
# Remove body below neck (z < 1.36), protruding ears (|x| > 0.074), and spiky cartoon hair bangs sticking out in front of forehead (z > 1.565 and y < -0.072)
to_del = [
    v for v in bm.verts
    if v.co.z < 1.36 or abs(v.co.x) > 0.115 or (v.co.z > 1.45 and abs(v.co.x) > 0.072) or (v.co.z > 1.572) or (v.co.z > 1.542 and v.co.y < -0.074)
]
bmesh.ops.delete(bm, geom=to_del, context='VERTS')

HEAD_DY = -0.038
HEAD_DZ = 0.005
for v in bm.verts:
    v.co.y += HEAD_DY
    v.co.z += HEAD_DZ
bm.to_mesh(head_obj.data)
bm.free()

for o in eye_objs + brow_objs + jaw_objs:
    bm_o = bmesh.new()
    bm_o.from_mesh(o.data)
    for v in bm_o.verts:
        v.co.y += HEAD_DY
        v.co.z += HEAD_DZ
    bm_o.to_mesh(o.data)
    bm_o.free()

# (B) Extract Left & Right 3D Hands from base_mesh_obj
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
    for v in bm.verts:
        dx = (v.co.x - hcx) * 0.85; dy = (v.co.y - hcy) * 0.85; dz = (v.co.z - hcz) * 0.85
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
    for v in bm.verts:
        dx = (v.co.x - hcx) * 0.85; dy = (v.co.y - hcy) * 0.85; dz = (v.co.z - hcz) * 0.85
        v.co.x = 0.25 + dz * 0.7
        v.co.y = -0.08 + dy
        v.co.z = 0.82 - dx
bm.to_mesh(hand_l.data)
bm.free()

bpy.data.objects.remove(base_mesh_obj, do_unlink=True)

# ---------------------------------------------------------------------------
# 3. Import Black Tattered Gown + Belt + Boots & Split into Articulated Limbs!
# ---------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath="/tmp/opencode/black_gown_raw.glb")
gown_objs = [o for o in bpy.data.objects if o not in before]

clothes_obj = None
skirt_obj = None
belt_obj = None
shoes_obj = None

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
    o.data.materials.clear()
    if o.name == "Clothes": clothes_obj = o
    elif o.name == "Skirt": skirt_obj = o
    elif o.name == "Belt": belt_obj = o
    elif o.name == "Shoes": shoes_obj = o

# Bend sleeves in Clothes downward naturally FIRST
bm = bmesh.new()
bm.from_mesh(clothes_obj.data)
for v in bm.verts:
    ax = abs(v.co.x)
    if ax > 0.15:
        dist = ax - 0.15
        t = min(1.0, dist / 0.55)
        sleeve_r_z = v.co.z - 1.38
        sleeve_r_y = v.co.y
        flare = 1.0 + 0.45 * t
        if v.co.x < 0:
            cx_arm = -0.17 - 0.08 * t
            cy_arm = -0.02 - 0.19 * (t ** 1.1)
            cz_arm = 1.38 - 0.22 * math.sin(t * math.pi * 0.75)
            v.co.x = cx_arm + sleeve_r_z * 0.35 * flare
            v.co.y = cy_arm + sleeve_r_y * flare
            v.co.z = cz_arm + sleeve_r_z * 0.85 * flare
        else:
            cx_arm = 0.17 + 0.08 * t
            cy_arm = -0.01 - 0.07 * t
            cz_arm = 1.38 - 0.52 * t
            v.co.x = cx_arm + sleeve_r_z * 0.55 * flare
            v.co.y = cy_arm + sleeve_r_y * flare
            v.co.z = cz_arm + sleeve_r_z * 0.45 * flare
bm.to_mesh(clothes_obj.data)
bm.free()

# Widen Skirt slightly
bm = bmesh.new()
bm.from_mesh(skirt_obj.data)
for v in bm.verts:
    v.co.x *= 1.14
    v.co.y *= 1.14
bm.to_mesh(skirt_obj.data)
bm.free()

# Project SAM 3.1 UVs onto Clothes, Skirt, Belt, Shoes, Hands BEFORE splitting into articulated limb groups!
for o in (clothes_obj, skirt_obj, belt_obj, shoes_obj, hand_l, hand_r):
    project_sam31_uvs(o)

# Split Shoes + Lower Skirt (z < 0.78) into Left Leg (Agatha_Leg_L, x >= 0) and Right Leg (Agatha_Leg_R, x < 0)
# so when she walks, her left & right boots and lower gown stride forward/backward like a real human!
leg_l_parts = []
leg_r_parts = []

for src in (shoes_obj, skirt_obj):
    # Left leg slice (x >= -0.01 and z < 0.82)
    ll = src.copy(); ll.data = src.data.copy(); bpy.context.collection.objects.link(ll)
    bm = bmesh.new(); bm.from_mesh(ll.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < -0.005 or v.co.z > 0.82], context='VERTS')
    bm.to_mesh(ll.data); bm.free()
    leg_l_parts.append(ll)

    # Right leg slice (x <= 0.01 and z < 0.82)
    lr = src.copy(); lr.data = src.data.copy(); bpy.context.collection.objects.link(lr)
    bm = bmesh.new(); bm.from_mesh(lr.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > 0.005 or v.co.z > 0.82], context='VERTS')
    bm.to_mesh(lr.data); bm.free()
    leg_r_parts.append(lr)

# Trim skirt_obj to upper skirt/hips (z >= 0.72) so it overlaps smoothly with the striding lower skirt panels!
bm = bmesh.new(); bm.from_mesh(skirt_obj.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.72], context='VERTS')
bm.to_mesh(skirt_obj.data); bm.free()
bpy.data.objects.remove(shoes_obj, do_unlink=True)

# Join leg_l_parts -> Agatha_Leg_L (origin at Left Hip: +0.085, 0.0, 0.80)
bpy.ops.object.select_all(action='DESELECT')
for p in leg_l_parts: p.select_set(True)
bpy.context.view_layer.objects.active = leg_l_parts[0]
bpy.ops.object.join()
leg_l_obj = bpy.context.view_layer.objects.active
leg_l_obj.name = "Agatha_Leg_L"
recenter_origin(leg_l_obj, (0.085, 0.0, 0.80))

# Join leg_r_parts -> Agatha_Leg_R (origin at Right Hip: -0.085, 0.0, 0.80)
bpy.ops.object.select_all(action='DESELECT')
for p in leg_r_parts: p.select_set(True)
bpy.context.view_layer.objects.active = leg_r_parts[0]
bpy.ops.object.join()
leg_r_obj = bpy.context.view_layer.objects.active
leg_r_obj.name = "Agatha_Leg_R"
recenter_origin(leg_r_obj, (-0.085, 0.0, 0.80))

# Split Clothes into Left Arm (x > 0.15), Right Arm (x < -0.15), and Central Torso (|x| <= 0.17)
arm_l_sleeve = clothes_obj.copy(); arm_l_sleeve.data = clothes_obj.data.copy(); bpy.context.collection.objects.link(arm_l_sleeve)
bm = bmesh.new(); bm.from_mesh(arm_l_sleeve.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < 0.14], context='VERTS')
bm.to_mesh(arm_l_sleeve.data); bm.free()

arm_r_sleeve = clothes_obj.copy(); arm_r_sleeve.data = clothes_obj.data.copy(); bpy.context.collection.objects.link(arm_r_sleeve)
bm = bmesh.new(); bm.from_mesh(arm_r_sleeve.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > -0.14], context='VERTS')
bm.to_mesh(arm_r_sleeve.data); bm.free()

bm = bmesh.new(); bm.from_mesh(clothes_obj.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if abs(v.co.x) > 0.175], context='VERTS')
bm.to_mesh(clothes_obj.data); bm.free()

# Join Torso (clothes_obj + skirt_obj + belt_obj) -> Agatha_Torso (origin at Waist: 0, 0, 0.88)
bpy.ops.object.select_all(action='DESELECT')
for p in (clothes_obj, skirt_obj, belt_obj): p.select_set(True)
bpy.context.view_layer.objects.active = clothes_obj
bpy.ops.object.join()
torso_obj = bpy.context.view_layer.objects.active
torso_obj.name = "Agatha_Torso"
recenter_origin(torso_obj, (0.0, 0.0, 0.88))

# Join Left Arm (arm_l_sleeve + hand_l) -> Agatha_Arm_L (origin at Left Shoulder: +0.16, 0.0, 1.36)
bpy.ops.object.select_all(action='DESELECT')
for p in (arm_l_sleeve, hand_l): p.select_set(True)
bpy.context.view_layer.objects.active = arm_l_sleeve
bpy.ops.object.join()
arm_l_obj = bpy.context.view_layer.objects.active
arm_l_obj.name = "Agatha_Arm_L"
recenter_origin(arm_l_obj, (0.16, 0.0, 1.36))

# Join Right Arm (arm_r_sleeve + hand_r) -> Agatha_Arm_R (origin at Right Shoulder: -0.16, 0.0, 1.36)
bpy.ops.object.select_all(action='DESELECT')
for p in (arm_r_sleeve, hand_r): p.select_set(True)
bpy.context.view_layer.objects.active = arm_r_sleeve
bpy.ops.object.join()
arm_r_obj = bpy.context.view_layer.objects.active
arm_r_obj.name = "Agatha_Arm_R"
recenter_origin(arm_r_obj, (-0.16, 0.0, 1.36))

# ---------------------------------------------------------------------------
# 4. Sculpt Draped Nun Hood & Flowing Veil (Agatha_Nun_Hood)
# ---------------------------------------------------------------------------
hood_mesh = bpy.data.meshes.new("Agatha_Nun_Hood")
hood_obj = bpy.data.objects.new("Agatha_Nun_Hood", hood_mesh)
bpy.context.collection.objects.link(hood_obj)

bm = bmesh.new()
rings = 28; segs = 36; grid = []
for r in range(rings):
    v_frac = r / (rings - 1)
    z = 0.82 + v_frac * 0.90
    row = []
    for s in range(segs):
        theta = (s / segs) * 2.0 * math.pi
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
            tatter = 0.04 * math.sin(theta * 7.0) + 0.025 * math.cos(theta * 11.0) if t_drape > 0.6 else 0.0
            rx = flare_w
            ry = 0.15 + 0.06 * t_drape
            z += tatter * ((t_drape - 0.6) / 0.4 if t_drape > 0.6 else 0.0)
        x = rx * math.cos(theta)
        y = ry * math.sin(theta) - 0.02
        if y < -0.055 and z < 1.635:
            min_abs_x = 0.076 if z > 1.40 else (0.076 + (1.40 - z) * 0.22)
            if abs(x) < min_abs_x:
                x = -min_abs_x if x < 0 else min_abs_x
                y = -0.055 + 0.02 * (1.0 - abs(x) / 0.28)
        x += 0.008 * math.sin(theta * 9.0 + z * 6.0)
        row.append(bm.verts.new((x, y, z)))
    grid.append(row)

for r in range(rings - 1):
    for s in range(segs):
        s_next = (s + 1) % segs
        v1, v2, v3, v4 = grid[r][s], grid[r][s_next], grid[r + 1][s_next], grid[r + 1][s]
        if v1.co.y < -0.03 and v2.co.y < -0.03 and (v1.co.x * v2.co.x < 0) and v1.co.z < 1.62:
            continue
        bm.faces.new((v1, v2, v3, v4))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(hood_mesh)
bm.free()
project_sam31_uvs(hood_obj)

# ---------------------------------------------------------------------------
# 5. Import Real Polyhaven Brass Lantern & Parent to Agatha_Arm_R!
# ---------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath="public/assets/polyhaven/Lantern_01/Lantern_01_1k.glb")
lantern_objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
for o in [x for x in bpy.data.objects if x not in before and x.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)

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

bm = bmesh.new()
bm.from_mesh(lantern_obj.data)
lxs = [v.co.x for v in bm.verts]; lys = [v.co.y for v in bm.verts]; lzs = [v.co.z for v in bm.verts]
lcx = 0.5 * (min(lxs) + max(lxs)); lcy = 0.5 * (min(lys) + max(lys))
lz_min, lz_max = min(lzs), max(lzs)
l_scale = 0.36 / max(0.01, lz_max - lz_min)
for v in bm.verts:
    v.co.x = (v.co.x - lcx) * l_scale - 0.25
    v.co.y = (v.co.y - lcy) * l_scale - 0.22
    v.co.z = (v.co.z - lz_min) * l_scale + 0.85
bm.to_mesh(lantern_obj.data)
bm.free()
recenter_origin(lantern_obj, (-0.25, -0.22, 1.20))

anchor = bpy.data.objects.new("LanternAnchor", None)
anchor.location = (0.0, 0.0, -0.20)
bpy.context.collection.objects.link(anchor)
anchor.parent = lantern_obj
lantern_obj.parent = arm_r_obj
lantern_obj.matrix_parent_inverse = arm_r_obj.matrix_world.inverted()

# Assign materials BEFORE joining into the 6 articulated top-level limb objects!
# (A) Human Lady Skin Material (76 KB 1K texture)
mat_human = bpy.data.materials.new("Agatha_Human_Lady_Mat")
mat_human.use_nodes = True
nt_h = mat_human.node_tree
bsdf_h = nt_h.nodes.get("Principled BSDF")
bsdf_h.inputs["Roughness"].default_value = 0.58
tex_skin = nt_h.nodes.new("ShaderNodeTexImage")
tex_skin.image = bpy.data.images.load(human_skin_path)
nt_h.links.new(bsdf_h.inputs["Base Color"], tex_skin.outputs["Color"])
head_obj.data.materials.clear()
head_obj.data.materials.append(mat_human)
for jo in jaw_objs:
    jo.data.materials.clear()
    jo.data.materials.append(mat_human)

# (B) Dark Eyebrows
mat_brow = bpy.data.materials.new("Agatha_Brow_Mat")
mat_brow.use_nodes = True
mat_brow.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.04, 0.03, 0.03, 1.0)
for bo in brow_objs:
    bo.data.materials.clear()
    bo.data.materials.append(mat_brow)

# (C) Intense Red Glowing Eyes!
mat_red_eyes = bpy.data.materials.new("Agatha_Red_Glowing_Eyes")
mat_red_eyes.use_nodes = True
nt_re = mat_red_eyes.node_tree
bsdf_re = nt_re.nodes.get("Principled BSDF")
bsdf_re.inputs["Base Color"].default_value = (0.85, 0.0, 0.0, 1.0)
bsdf_re.inputs["Roughness"].default_value = 0.04
if "Emission" in bsdf_re.inputs:
    bsdf_re.inputs["Emission"].default_value = (0.95, 0.0, 0.01, 1.0)
if "Emission Strength" in bsdf_re.inputs:
    bsdf_re.inputs["Emission Strength"].default_value = 2.4
for eo in eye_objs:
    eo.data.materials.clear()
    eo.data.materials.append(mat_red_eyes)

# (D) Dark Nun Habit Robe Material
mat_robe = bpy.data.materials.new("Agatha_Habit_Mat")
mat_robe.use_nodes = True
mat_robe.use_backface_culling = False
nt_r = mat_robe.node_tree
bsdf_r = nt_r.nodes.get("Principled BSDF")
tex_robe = nt_r.nodes.new("ShaderNodeTexImage")
tex_robe.image = bpy.data.images.load(robe_tex_path)
nt_r.links.new(bsdf_r.inputs["Base Color"], tex_robe.outputs["Color"])
bsdf_r.inputs["Roughness"].default_value = 0.88

for o in (torso_obj, leg_l_obj, leg_r_obj, arm_l_obj, arm_r_obj, hood_obj):
    o.data.materials.clear()
    o.data.materials.append(mat_robe)

# Reset origins of lantern_obj, arm_r_obj, etc. to world (0,0,0) before joining so vertices stay in exact world coords!
for o in [head_obj, hood_obj, arm_l_obj, arm_r_obj, lantern_obj, torso_obj, leg_l_obj, leg_r_obj] + eye_objs + brow_objs + jaw_objs:
    o.parent = None
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Join Head + Eyes + Brows + Jaws + Hood into ONE multi-material Agatha_Head_Group mesh with origin at Neck (0.0, -0.02, 1.40)
bpy.ops.object.select_all(action='DESELECT')
for ho in [head_obj, hood_obj] + eye_objs + brow_objs + jaw_objs:
    ho.select_set(True)
bpy.context.view_layer.objects.active = head_obj
bpy.ops.object.join()
head_grp = bpy.context.view_layer.objects.active
head_grp.name = "Agatha_Head_Group"
recenter_origin(head_grp, (0.0, -0.02, 1.40))

# Join Right Arm + Lantern into Agatha_Arm_R with origin at Right Shoulder (-0.16, 0.0, 1.36)
bpy.ops.object.select_all(action='DESELECT')
arm_r_obj.select_set(True)
lantern_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_r_obj
bpy.ops.object.join()
arm_r_obj = bpy.context.view_layer.objects.active
arm_r_obj.name = "Agatha_Arm_R"
recenter_origin(arm_r_obj, (-0.16, 0.0, 1.36))

# Set clean joint origins on Left Arm, Torso, Left Leg, Right Leg
recenter_origin(arm_l_obj, (0.16, 0.0, 1.36))
recenter_origin(torso_obj, (0.0, 0.0, 0.88))
recenter_origin(leg_l_obj, (0.085, 0.0, 0.80))
recenter_origin(leg_r_obj, (-0.085, 0.0, 0.80))

# Place LanternAnchor at (-0.25, -0.22, 1.00)
anchor.parent = None
anchor.location = (-0.25, -0.22, 1.00)

for o in bpy.data.objects:
    if o.type == "MESH":
        for p in o.data.polygons:
            p.use_smooth = True

# ---------------------------------------------------------------------------
# 7. Bake a 30-FPS Looping Human Walk Cycle Animation inside agatha.glb!
# ---------------------------------------------------------------------------
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 31
scene.render.fps = 30

for o in (leg_l_obj, leg_r_obj, arm_l_obj, arm_r_obj, torso_obj, head_grp):
    o.rotation_mode = 'XYZ'

for f in range(1, 32):
    scene.frame_set(f)
    phase = ((f - 1) / 30.0) * 2.0 * math.pi
    s = math.sin(phase)
    c = math.cos(phase)

    # Left & Right Legs swing opposite (forward/back human stride!)
    leg_l_obj.rotation_euler = (0.38 * s, 0.0, 0.0)
    leg_r_obj.rotation_euler = (-0.38 * s, 0.0, 0.0)
    leg_l_obj.location = (0.085, 0.0, 0.80 + max(0.0, c) * 0.038)
    leg_r_obj.location = (-0.085, 0.0, 0.80 + max(0.0, -c) * 0.038)
    leg_l_obj.keyframe_insert(data_path="rotation_euler", frame=f)
    leg_r_obj.keyframe_insert(data_path="rotation_euler", frame=f)
    leg_l_obj.keyframe_insert(data_path="location", frame=f)
    leg_r_obj.keyframe_insert(data_path="location", frame=f)

    # Left Arm swings opposite to Left Leg; Right Arm holds lantern steady forward with subtle sway
    arm_l_obj.rotation_euler = (-0.30 * s, 0.0, 0.0)
    arm_r_obj.rotation_euler = (0.10 * s, 0.0, 0.0)
    arm_l_obj.keyframe_insert(data_path="rotation_euler", frame=f)
    arm_r_obj.keyframe_insert(data_path="rotation_euler", frame=f)

    # Natural human torso double-step vertical bob + contrapposto hip/shoulder sway
    bob_z = abs(s) * 0.025
    torso_obj.location = (0.0, 0.0, 0.88 + bob_z)
    torso_obj.rotation_euler = (0.04, 0.025 * s, 0.045 * s)
    torso_obj.keyframe_insert(data_path="location", frame=f)
    torso_obj.keyframe_insert(data_path="rotation_euler", frame=f)

    # Head tracks with torso bob + subtle eerie scan
    head_grp.location = (0.0, -0.02, 1.40 + bob_z)
    head_grp.rotation_euler = (-0.02, -0.015 * s, -0.04 * s)
    head_grp.keyframe_insert(data_path="location", frame=f)
    head_grp.keyframe_insert(data_path="rotation_euler", frame=f)

scene.frame_set(1)

out_glb = "public/live-preview/assets/agatha.glb"
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_draco_mesh_compression_enable=False,
    export_animations=True,
    export_apply=False,
)
print("EXPORTED ARTICULATED HUMAN WALK GLB:", out_glb)

# ---------------------------------------------------------------------------
# 8. Render Close-Up Portrait + 3-View Turnaround (NO use_bloom so Xvfb is fast!)
# ---------------------------------------------------------------------------
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 800
scene.render.resolution_y = 1000
world = bpy.data.worlds.new("StudioWorld")
scene.world = world
world.use_nodes = True
world.node_tree.nodes.get("Background").inputs[0].default_value = (0.04, 0.05, 0.06, 1.0)

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam

key_light = bpy.data.lights.new("Key", type='AREA')
key_light.energy = 110
key_light.color = (0.85, 0.90, 1.0)
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

# Small red point light right in front of her eyes so her red glowing eyes illuminate her brow/nose bridge!
eye_glow_lt = bpy.data.lights.new("EyeGlow", type='POINT')
eye_glow_lt.energy = 1.8
eye_glow_lt.color = (1.0, 0.0, 0.0)
eg_obj = bpy.data.objects.new("EyeGlow", eye_glow_lt)
eg_obj.location = (0.0, -0.14, 1.545)
bpy.context.collection.objects.link(eg_obj)

cam.location = (0.0, -2.55, 0.90)
cam.rotation_euler = (math.radians(88), 0, 0)
scene.render.filepath = "/tmp/opencode/agatha_front.png"
bpy.ops.render.render(write_still=True)

cam.location = (-1.45, -2.10, 0.92)
cam.rotation_euler = (math.radians(88), 0, math.radians(-34))
scene.render.filepath = "/tmp/opencode/agatha_angle.png"
bpy.ops.render.render(write_still=True)

cam.location = (-2.35, -0.75, 0.92)
cam.rotation_euler = (math.radians(88), 0, math.radians(-72))
scene.render.filepath = "/tmp/opencode/agatha_side.png"
bpy.ops.render.render(write_still=True)

im1 = Image.open("/tmp/opencode/agatha_front.png")
im2 = Image.open("/tmp/opencode/agatha_angle.png")
im3 = Image.open("/tmp/opencode/agatha_side.png")
sheet = Image.new("RGB", (im1.width * 3, im1.height), (10, 12, 15))
sheet.paste(im1, (0, 0))
sheet.paste(im2, (im1.width, 0))
sheet.paste(im3, (im1.width * 2, 0))
sheet.save("/tmp/opencode/agatha_sam31_preview.png")

cam.location = (0.0, -0.62, 1.53)
cam.rotation_euler = (math.radians(89), 0, 0)
scene.render.resolution_x = 700
scene.render.resolution_y = 700
scene.render.filepath = "/tmp/opencode/agatha_face_closeup.png"
bpy.ops.render.render(write_still=True)
print("ALL RENDERS COMPLETE!")
