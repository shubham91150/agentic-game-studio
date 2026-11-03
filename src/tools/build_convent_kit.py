#!/usr/bin/env python3
"""Ashes of St. Vermilion — Gothic convent asset kit builder (Blender 3.4 headless).

Generates 5 real multi-part, multi-material PBR .glb models into
public/live-preview/assets/ using data-API modeling only (no bpy.ops except
the glTF exporter, so it runs cleanly with `blender -b`).

Run:
  blender -b --factory-startup --python-exit-code 1 \\
      -P src/tools/build_convent_kit.py

Art direction (locked): moonlit blue-greys + amber lantern light, aged dark
stone/wood/iron. One consistent gothic-horror lane, no bright colors.

PBR sources (CC0, ambientCG, local 1K + aged 512px embed variants):
  public/assets/ambientcg/{Plaster001,Wood096,Bricks075A,Metal032}/
License: CC0 1.0 Universal (ambientCG).

Constraints honored: meter scale, origin at base (min z = 0), NO Draco, NO
KTX2 (Three.js r128 GLTFLoader has no decoders), each file < ~2MB.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Euler, Matrix, Vector

# ---------------------------------------------------------------- paths ---
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS_DIR = os.path.join(ROOT, "public", "live-preview", "assets")
ACG = os.path.join(ROOT, "public", "assets", "ambientcg")

os.makedirs(ASSETS_DIR, exist_ok=True)

RNG = random.Random(7)

# ------------------------------------------------------------ helpers ---


def clear_scene():
    """Remove everything (objects, meshes, materials, images). Idempotent."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.curves, bpy.data.armatures):
        for x in list(coll):
            coll.remove(x)
    # Purge orphan datablocks (Blender 3.1+ API).
    try:
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True,
                               do_recursive=True)
    except TypeError:  # older signature fallback
        bpy.data.orphans_purge()


def set_principled(bsdf, name, value):
    """Set a Principled input by name, tolerating Blender version renames."""
    inp = bsdf.inputs.get(name)
    if inp is not None:
        inp.default_value = value


def load_image(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def mat_textured(name, color_path=None, normal_path=None, roughness_path=None,
                 metalness_path=None, base_color=(1, 1, 1, 1), metallic=0.0,
                 roughness=1.0):
    """Principled PBR material from ambientCG maps (glTF-safe node setup)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    set_principled(bsdf, "Base Color", base_color)
    set_principled(bsdf, "Metallic", metallic)
    set_principled(bsdf, "Roughness", roughness)
    set_principled(bsdf, "Specular", 0.5)
    if color_path:
        t = nodes.new("ShaderNodeTexImage")
        t.image = load_image(color_path)
        links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if roughness_path:
        t = nodes.new("ShaderNodeTexImage")
        t.image = load_image(roughness_path, non_color=True)
        links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    if metalness_path:
        t = nodes.new("ShaderNodeTexImage")
        t.image = load_image(metalness_path, non_color=True)
        links.new(t.outputs["Color"], bsdf.inputs["Metallic"])
    if normal_path:
        t = nodes.new("ShaderNodeTexImage")
        t.image = load_image(normal_path, non_color=True)
        nm = nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 1.0
        links.new(t.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def mat_plain(name, color, roughness=0.8, metallic=0.0, alpha=1.0,
              emission=None, emission_strength=0.0):
    """Flat Principled material (exports as factors; r128-safe)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    r, g, b = color
    set_principled(bsdf, "Base Color", (r, g, b, alpha))
    set_principled(bsdf, "Metallic", metallic)
    set_principled(bsdf, "Roughness", roughness)
    set_principled(bsdf, "Specular", 0.5)
    if emission is not None:
        set_principled(bsdf, "Emission", (*emission, 1.0))
        set_principled(bsdf, "Emission Strength", emission_strength)
    if alpha < 1.0:
        mat.blend_method = "BLEND"
    return mat


kit_mats = {}


def build_kit_materials():
    """Shared aged-gothic palette. Called fresh per asset (scene is cleared)."""
    kit_mats.clear()
    P = os.path.join(ACG, "Plaster001", "Plaster001_1K-JPG")
    W = os.path.join(ACG, "Wood096", "Wood096_1K-JPG")
    B = os.path.join(ACG, "Bricks075A", "Bricks075A_1K-JPG")
    M = os.path.join(ACG, "Metal032", "Metal032_1K-JPG")
    kit_mats["stone"] = mat_textured(
        "ConventStone", P + "_Color_512.jpg", P + "_NormalGL_512.jpg",
        P + "_Roughness_512.jpg")
    kit_mats["wood"] = mat_textured(
        "ConventWood", W + "_Color_512.jpg", W + "_NormalGL_512.jpg",
        W + "_Roughness_512.jpg")
    kit_mats["brick"] = mat_textured(
        "ConventBrick", B + "_Color_512.jpg", B + "_NormalGL_512.jpg",
        B + "_Roughness_512.jpg")
    # Wrought iron: dark base factor + real metal scan data maps.
    kit_mats["iron"] = mat_textured(
        "ConventIron", None, M + "_NormalGL_512.jpg",
        M + "_Roughness_512.jpg", M + "_Metalness_512.jpg",
        base_color=(0.055, 0.058, 0.065, 1.0), metallic=1.0, roughness=1.0)
    # Moonlit glass + volumetric-look shaft (alpha blend, r128-safe).
    kit_mats["glass"] = mat_plain(
        "ConventGlass", (0.62, 0.72, 0.80), roughness=0.15, alpha=0.38,
        emission=(0.10, 0.16, 0.24), emission_strength=0.7)
    kit_mats["moonshaft"] = mat_plain(
        "ConventMoonShaft", (0.55, 0.66, 0.80), roughness=1.0, alpha=0.13,
        emission=(0.35, 0.46, 0.60), emission_strength=0.9)
    kit_mats["slate"] = mat_plain("ConventSlate", (0.13, 0.16, 0.17),
                                  roughness=0.95)
    kit_mats["chalk"] = mat_plain("ConventChalk", (0.82, 0.83, 0.80),
                                  roughness=0.9)
    kit_mats["paper"] = mat_plain("ConventPaper", (0.72, 0.66, 0.55),
                                  roughness=0.9)
    kit_mats["brass"] = mat_plain("ConventBrass", (0.42, 0.30, 0.13),
                                  roughness=0.35, metallic=1.0)
    kit_mats["wax"] = mat_plain("ConventWax", (0.78, 0.70, 0.55),
                                roughness=0.6)
    kit_mats["flame"] = mat_plain(
        "ConventFlame", (1.0, 0.55, 0.16), roughness=1.0,
        emission=(1.0, 0.45, 0.12), emission_strength=1.0)
    kit_mats["cloth"] = mat_plain("ConventCloth", (0.60, 0.57, 0.50),
                                  roughness=0.95)
    kit_mats["wooddark"] = mat_plain("ConventWoodDark", (0.16, 0.11, 0.08),
                                     roughness=0.8)
    kit_mats["leather"] = mat_plain("ConventLeather", (0.23, 0.08, 0.07),
                                    roughness=0.7)
    # Muted book-cloth palette (no saturated colors).
    kit_mats["book0"] = mat_plain("ConventBook0", (0.25, 0.10, 0.09),
                                  roughness=0.85)
    kit_mats["book1"] = mat_plain("ConventBook1", (0.10, 0.13, 0.20),
                                  roughness=0.85)
    kit_mats["book2"] = mat_plain("ConventBook2", (0.20, 0.19, 0.12),
                                  roughness=0.85)
    kit_mats["book3"] = mat_plain("ConventBook3", (0.16, 0.16, 0.17),
                                  roughness=0.85)
    kit_mats["book4"] = mat_plain("ConventBook4", (0.28, 0.17, 0.10),
                                  roughness=0.85)
    return kit_mats


# ------------------------------------------------- mesh construction ---

def box_project_uv(mesh, scale=0.5):
    """Per-polygon dominant-axis planar UVs (no bpy.ops needed)."""
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uvs = uv_layer.data
    for poly in mesh.polygons:
        nx, ny, nz = (abs(poly.normal.x), abs(poly.normal.y),
                      abs(poly.normal.z))
        for li in poly.loop_indices:
            x, y, z = mesh.vertices[mesh.loops[li].vertex_index].co
            if nx >= ny and nx >= nz:
                uvs[li].uv = (y * scale, z * scale)
            elif ny >= nx and ny >= nz:
                uvs[li].uv = (x * scale, z * scale)
            else:
                uvs[li].uv = (x * scale, y * scale)


def part(name, verts, faces, mat, uv_scale=0.5, smooth=False):
    """Create one named multi-part object (coords baked, origin at asset)."""
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.update()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    box_project_uv(mesh, scale=uv_scale)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def xf_matrix(loc=(0, 0, 0), euler=(0, 0, 0)):
    return (Matrix.Translation(Vector(loc))
            @ Euler(euler, "XYZ").to_matrix().to_4x4())


def box_verts(center, size, euler=(0, 0, 0)):
    sx, sy, sz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
               (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    m = xf_matrix(center, euler)
    return [m @ Vector(c) for c in corners]


BOX_FACES = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]


def box_part(name, center, size, mat, euler=(0, 0, 0), uv_scale=0.5):
    return part(name, box_verts(center, size, euler), BOX_FACES, mat,
                uv_scale=uv_scale)


def frustum_box_part(name, center, bot_size, top_size, height, mat,
                     euler=(0, 0, 0), uv_scale=0.5):
    """Tapered square column (capitals, bases)."""
    bx, by = bot_size[0] / 2.0, bot_size[1] / 2.0
    tx, ty = top_size[0] / 2.0, top_size[1] / 2.0
    h = height / 2.0
    corners = [(-bx, -by, -h), (bx, -by, -h), (bx, by, -h), (-bx, by, -h),
               (-tx, -ty, h), (tx, -ty, h), (tx, ty, h), (-tx, ty, h)]
    m = xf_matrix(center, euler)
    return part(name, [m @ Vector(c) for c in corners], BOX_FACES, mat,
                uv_scale=uv_scale)


def cylinder_verts(center, r_bot, r_top, height, sides=16, euler=(0, 0, 0)):
    h = height / 2.0
    ring_b = [(r_bot * math.cos(2 * math.pi * i / sides),
               r_bot * math.sin(2 * math.pi * i / sides), -h)
              for i in range(sides)]
    ring_t = [(r_top * math.cos(2 * math.pi * i / sides),
               r_top * math.sin(2 * math.pi * i / sides), h)
              for i in range(sides)]
    m = xf_matrix(center, euler)
    return [m @ Vector(v) for v in (ring_b + ring_t)]


def cylinder_faces(sides, cap_bot=True, cap_top=True):
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    if cap_bot:
        faces.append(tuple(reversed(range(sides))))
    if cap_top:
        faces.append(tuple(range(sides, 2 * sides)))
    return faces


def cyl_part(name, center, r_bot, r_top, height, mat, sides=16,
             euler=(0, 0, 0), uv_scale=0.5, cap_bot=True, cap_top=True):
    return part(name, cylinder_verts(center, r_bot, r_top, height, sides,
                                     euler),
                cylinder_faces(sides, cap_bot, cap_top), mat,
                uv_scale=uv_scale, smooth=(sides > 4))


def sphere_part(name, center, radius, mat, seg=12, rings=8,
                scale=(1, 1, 1), uv_scale=0.5):
    verts, faces = [], []
    sx, sy, sz = scale
    for j in range(rings + 1):
        phi = math.pi * j / rings
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append((center[0] + radius * sx * math.sin(phi)
                          * math.cos(th),
                          center[1] + radius * sy * math.sin(phi)
                          * math.sin(th),
                          center[2] + radius * sz * math.cos(phi)))
    for j in range(rings):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            c = (j + 1) * seg + (i + 1) % seg
            d = (j + 1) * seg + i
            faces.append((a, b, c, d))
    return part(name, verts, faces, mat, uv_scale=uv_scale, smooth=True)


def tube_part(name, points, radius, mat, sides=8, uv_scale=0.8, ref=(0, 0, 1),
              cap_ends=True):
    """Sweep a circle along a path (arch ribs, rails). Planar-path frames."""
    pts = [Vector(p) for p in points]
    ref_v = Vector(ref)
    verts, faces = [], []
    for k, p in enumerate(pts):
        if k == 0:
            tangent = (pts[1] - pts[0]).normalized()
        elif k == len(pts) - 1:
            tangent = (pts[-1] - pts[-2]).normalized()
        else:
            tangent = (pts[k + 1] - pts[k - 1]).normalized()
        bino = tangent.cross(ref_v)
        if bino.length < 1e-6:
            bino = Vector((0, 1, 0))
        bino.normalize()
        nrm = bino.cross(tangent).normalized()
        for i in range(sides):
            a = 2 * math.pi * i / sides
            verts.append(p + (nrm * math.cos(a) + bino * math.sin(a))
                         * radius)
    for k in range(len(pts) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((k * sides + i, k * sides + j,
                          (k + 1) * sides + j, (k + 1) * sides + i))
    if cap_ends:
        faces.append(tuple(reversed(range(sides))))
        base = (len(pts) - 1) * sides
        faces.append(tuple(range(base, base + sides)))
    return part(name, verts, faces, mat, uv_scale=uv_scale, smooth=True)


def gothic_arch_points(half_w, spring_z, ratio=1.35, n=8):
    """Two-centered pointed arch: left springing -> apex -> right springing.

    Returns list of (x, z) tuples in the arch plane.
    """
    a = half_w
    R = a * ratio
    cx = R - a
    rise = math.sqrt(max(R * R - cx * cx, 1e-8))
    apex_z = spring_z + rise
    ang_spring = math.pi
    ang_apex = math.atan2(rise, -cx)
    left = []
    for i in range(n + 1):
        ang = ang_spring + (ang_apex - ang_spring) * i / n
        left.append((cx + R * math.cos(ang), spring_z + R * math.sin(ang)))
    # Mirror (excluding duplicated apex) for the right side.
    right = [(-x, z) for (x, z) in reversed(left[:-1])]
    return left + right, apex_z


def export_glb(filename):
    path = os.path.join(ASSETS_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
    kwargs = dict(filepath=path, export_format="GLB", export_yup=True,
                  export_apply=False, export_texcoords=True,
                  export_normals=True, export_tangents=False,
                  export_draco_mesh_compression_enable=False,
                  export_materials="EXPORT", export_colors=False,
                  export_cameras=False, export_lights=False,
                  use_selection=False)
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:  # older exporter signature fallback
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    size = os.path.getsize(path)
    print("EXPORTED %s (%d bytes)" % (filename, size))
    return path, size


# ------------------------------------------------------ asset builds ---

def build_pillar_arch(M):
    """Stone column + base plinth + capital + ceiling arch ribs (~5m)."""
    stone, brick = M["stone"], M["brick"]
    box_part("Plinth", (0, 0, 0.15), (1.10, 1.10, 0.30), brick)
    box_part("PlinthStep", (0, 0, 0.39), (0.90, 0.90, 0.18), brick)
    cyl_part("BaseMould", (0, 0, 0.59), 0.42, 0.34, 0.22, stone, sides=16)
    cyl_part("Shaft", (0, 0, 2.00), 0.34, 0.30, 2.60, stone, sides=16)
    cyl_part("ShaftCollar", (0, 0, 3.36), 0.37, 0.37, 0.12, stone, sides=16)
    frustum_box_part("Capital", (0, 0, 3.60), (0.52, 0.52), (0.86, 0.86),
                     0.36, stone, euler=(0, 0, math.radians(45)))
    box_part("Abacus", (0, 0, 3.87), (0.95, 0.95, 0.18), stone)
    # Four vault ribs springing from the abacus (quarter-circle arcs).
    for name, dx, dz in (("RibPX", 1, 0), ("RibNX", -1, 0),
                         ("RibPY", 0, 1), ("RibNY", 0, -1)):
        pts = []
        for i in range(9):
            t = (math.pi / 2.0) * i / 8.0
            r = 1.25
            pts.append((dx * r * math.sin(t),
                        dz * r * math.sin(t) if dz else 0.0,
                        3.96 + r * (1 - math.cos(t)) * 1.15))
        # pts for X ribs: (x, 0, z); for Y ribs remap below.
        if dz:
            pts = [(0.0, x, z) for (x, _, z) in pts]
        else:
            pts = [(x, 0.0, z) for (x, _, z) in pts]
        tube_part(name, pts, 0.11, stone, sides=8)


def build_window_frame(M):
    """Pointed-arch stone window + iron mullions + moonlit glass + MoonShaft."""
    stone, iron, glass = M["stone"], M["iron"], M["glass"]
    half_w, sill_z, spring_z = 0.70, 0.90, 2.60
    arch, apex_z = gothic_arch_points(half_w, spring_z)
    # Sill + jambs.
    box_part("Sill", (0, 0, sill_z - 0.09), (2.00, 0.42, 0.18), stone)
    box_part("JambL", (-0.85, 0, (sill_z + spring_z) / 2.0),
             (0.30, 0.34, spring_z - sill_z), stone)
    box_part("JambR", (0.85, 0, (sill_z + spring_z) / 2.0),
             (0.30, 0.34, spring_z - sill_z), stone)
    # Arch voussoir stones straddling the opening edge.
    centroid = (0.0, (sill_z + apex_z) / 2.0)
    for i in range(len(arch) - 1):
        (x0, z0), (x1, z1) = arch[i], arch[i + 1]
        mx, mz = (x0 + x1) / 2.0, (z0 + z1) / 2.0
        dx, dz = x1 - x0, z1 - z0
        seg = math.hypot(dx, dz)
        # Outward normal (away from opening centroid).
        nx, nz = dz, -dx
        if (mx + nx * 0.1 - centroid[0]) * nx + \
           (mz + nz * 0.1 - centroid[1]) * nz < 0:
            nx, nz = -nx, -nz
        nl = math.hypot(nx, nz) or 1.0
        cx, cz = mx + nx / nl * 0.10, mz + nz / nl * 0.10
        ang = math.atan2(-dz, dx)
        box_part("Voussoir%02d" % i, (cx, 0, cz), (seg * 1.18, 0.36, 0.36),
                 stone, euler=(0, ang, 0))
    # Keystone at the apex.
    box_part("Keystone", (0, 0, apex_z + 0.10), (0.30, 0.38, 0.42), stone)
    # Moonlit glass: triangle fan over the opening + flipped duplicate so
    # it reads from both sides (single-sided glTF-safe).
    loop = [(-half_w, sill_z), (half_w, sill_z)] + list(reversed(arch))
    cx = sum(p[0] for p in loop) / len(loop)
    cz = sum(p[1] for p in loop) / len(loop)
    verts = [(cx, 0.0, cz)] + [(x, 0.0, z) for (x, z) in loop]
    faces = []
    for i in range(1, len(verts) - 1):
        faces.append((0, i, i + 1))
    faces.append((0, len(verts) - 1, 1))
    faces += [tuple(reversed(f)) for f in faces]
    part("GlassPane", verts, faces, glass, uv_scale=0.5)
    # Iron mullions: center bar (into the arch head) + transoms.
    box_part("MullionV", (0, 0, (sill_z + apex_z) / 2.0 - 0.05),
             (0.06, 0.06, apex_z - sill_z - 0.10), iron)
    for j, tz in enumerate((1.60, 2.30)):
        box_part("Transom%d" % j, (0, 0, tz), (2 * half_w, 0.06, 0.06), iron)
    # Volumetric-look moonlight shaft: closed tapered solid slanting from
    # the window down into the room. MUST stay named "MoonShaft".
    ax, az, ay = 0.62, 0.34, -0.10      # top quad half extents at window
    bx, bz, by = 0.95, 0.30, -2.40      # bottom quad half extents at floor
    tzw, tfz = 2.30, 0.35                # top / floor center heights
    v = [(-ax, ay, tzw - az), (ax, ay, tzw - az),
         (ax, ay, tzw + az), (-ax, ay, tzw + az),
         (-bx, by, tfz - bz), (bx, by, tfz - bz),
         (bx, by, tfz + bz), (-bx, by, tfz + bz)]
    shaft_faces = list(BOX_FACES) + [tuple(reversed(f)) for f in BOX_FACES]
    part("MoonShaft", v, shaft_faces, M["moonshaft"], uv_scale=0.3)


def build_desk_chair(M):
    """Wooden student desk + iron legs + wooden chair + book + inkwell."""
    wood, iron = M["wood"], M["iron"]
    # Desk top with a slight sloped lid + apron + iron legs.
    box_part("DeskTop", (0, 0, 0.74), (0.95, 0.52, 0.05), wood,
             euler=(math.radians(-4), 0, 0))
    box_part("DeskApron", (0, 0.10, 0.64), (0.80, 0.30, 0.12), wood)
    box_part("DeskShelf", (0, 0.10, 0.30), (0.72, 0.28, 0.04), wood)
    for i, (lx, ly) in enumerate(((-0.40, -0.18), (0.40, -0.18),
                                  (-0.40, 0.18), (0.40, 0.18))):
        box_part("DeskLeg%d" % i, (lx, ly, 0.35), (0.06, 0.06, 0.70), iron)
    box_part("Footrest", (0, -0.18, 0.12), (0.80, 0.05, 0.05), wood)
    # Inkwell + pupil's primer book on the desk.
    cyl_part("Inkwell", (0.32, 0.10, 0.79), 0.035, 0.030, 0.06,
             M["wooddark"], sides=10)
    box_part("BookCover", (-0.12, -0.02, 0.785), (0.26, 0.19, 0.015),
             M["leather"])
    box_part("BookPages", (-0.12, -0.02, 0.80), (0.24, 0.17, 0.035),
             M["paper"])
    box_part("BookCoverTop", (-0.12, -0.02, 0.822), (0.26, 0.19, 0.012),
             M["leather"])
    # Chair facing the desk (seat front edge toward +Y).
    cy = -0.78
    box_part("ChairSeat", (0, cy, 0.45), (0.42, 0.40, 0.05), wood)
    for i, (lx, ly) in enumerate(((-0.17, cy - 0.16), (0.17, cy - 0.16),
                                  (-0.17, cy + 0.16), (0.17, cy + 0.16))):
        box_part("ChairLeg%d" % i, (lx, ly, 0.225), (0.05, 0.05, 0.45),
                 M["wooddark"])
    box_part("ChairStretcher", (0, cy - 0.16, 0.15), (0.34, 0.04, 0.04),
             M["wooddark"])
    for i, lx in enumerate((-0.17, 0.17)):
        box_part("ChairPost%d" % i, (lx, cy - 0.185, 0.70),
                 (0.05, 0.05, 0.55), M["wooddark"])
    box_part("ChairSlatTop", (0, cy - 0.185, 0.92), (0.39, 0.04, 0.09),
             wood)
    box_part("ChairSlatMid", (0, cy - 0.185, 0.72), (0.39, 0.04, 0.07),
             wood)


def build_classroom_furniture(M):
    """Wall chalkboard with frame + tray + tall bookshelf with 3D book rows."""
    wood, slate = M["wood"], M["slate"]
    bx = -0.85  # chalkboard center x
    # Slate + wooden frame + chalk tray + chalk + eraser.
    box_part("Slate", (bx, 0, 1.60), (1.80, 0.06, 1.10), slate)
    box_part("FrameTop", (bx, 0, 2.19), (1.96, 0.09, 0.10), wood)
    box_part("FrameBottom", (bx, 0, 1.01), (1.96, 0.09, 0.10), wood)
    box_part("FrameL", (bx - 0.93, 0, 1.60), (0.10, 0.09, 1.28), wood)
    box_part("FrameR", (bx + 0.93, 0, 1.60), (0.10, 0.09, 1.28), wood)
    box_part("ChalkTray", (bx, -0.10, 0.93), (1.80, 0.16, 0.04), wood)
    cyl_part("Chalk0", (bx - 0.30, -0.10, 0.965), 0.009, 0.009, 0.075,
             M["chalk"], sides=8, euler=(0, math.radians(90), 0))
    cyl_part("Chalk1", (bx - 0.18, -0.12, 0.965), 0.009, 0.009, 0.060,
             M["chalk"], sides=8, euler=(0, math.radians(90), 0))
    box_part("Eraser", (bx + 0.45, -0.10, 0.975), (0.13, 0.06, 0.035),
             M["wooddark"])
    # Tall bookshelf with back panel, plinth, cornice, 4 shelves.
    sx = 1.55
    box_part("ShelfPlinth", (sx, 0, 0.09), (1.20, 0.40, 0.18), wood)
    box_part("ShelfSideL", (sx - 0.575, 0, 1.14), (0.05, 0.36, 2.10), wood)
    box_part("ShelfSideR", (sx + 0.575, 0, 1.14), (0.05, 0.36, 2.10), wood)
    box_part("ShelfBack", (sx, 0.155, 1.14), (1.10, 0.03, 2.10),
             M["wooddark"])
    box_part("ShelfCornice", (sx, 0, 2.24), (1.24, 0.40, 0.10), wood)
    shelf_z = (0.24, 0.78, 1.32, 1.86)
    for j, sz in enumerate(shelf_z):
        box_part("Shelf%d" % j, (sx, 0, sz), (1.10, 0.34, 0.04), wood)
    # 3D book rows: varied widths/heights/muted cloth colors + one leaner.
    book_mats = [M["book%d" % k] for k in range(5)]
    for row, sz in enumerate(shelf_z[:3]):
        x = sx - 0.50
        bi = 0
        while x < sx + 0.42:
            w = RNG.uniform(0.035, 0.065)
            h = RNG.uniform(0.22, 0.30)
            lean = (row == 1 and x > sx + 0.18 and x < sx + 0.26)
            mat = book_mats[(row * 3 + bi) % len(book_mats)]
            if lean:
                box_part("BookR%d_%d" % (row, bi),
                         (x + w / 2.0 + 0.03, 0, sz + 0.02 + h / 2.0 - 0.02),
                         (w, 0.22, h), mat, euler=(0, 0, math.radians(-12)))
                x += w + 0.10
            else:
                box_part("BookR%d_%d" % (row, bi),
                         (x + w / 2.0, 0, sz + 0.02 + h / 2.0),
                         (w, 0.22, h), mat)
                x += w + RNG.uniform(0.002, 0.012)
            bi += 1
    # Horizontal stacked pair on the top shelf.
    box_part("BookStack0", (sx - 0.25, 0, 2.00), (0.30, 0.22, 0.05),
             M["book1"])
    box_part("BookStack1", (sx - 0.24, 0, 2.035), (0.28, 0.20, 0.045),
             M["book4"])


def build_pew_altar(M):
    """Carved wooden pew + gothic altar table with candlesticks + cross."""
    wood, dark = M["wood"], M["wooddark"]
    # Pew bench facing the altar (+Y).
    box_part("PewSeat", (0, 0, 0.45), (1.80, 0.45, 0.06), wood)
    box_part("PewBack", (0, -0.26, 0.80), (1.80, 0.06, 0.58), wood,
             euler=(math.radians(-8), 0, 0))
    box_part("PewBackRail", (0, -0.30, 1.10), (1.86, 0.09, 0.07), wood)
    for i, ex in enumerate((-0.90, 0.90)):
        box_part("PewEnd%d" % i, (ex, -0.02, 0.50), (0.07, 0.52, 1.00),
                 wood)
        box_part("PewEndCap%d" % i, (ex, -0.02, 1.03), (0.10, 0.56, 0.06),
                 dark)
        sphere_part("PewFinial%d" % i, (ex, -0.02, 1.12), 0.05, dark,
                    seg=10, rings=6)
    box_part("PewKneeler", (0, 0.55, 0.12), (1.60, 0.25, 0.08), dark)
    box_part("PewBookBox", (0.30, -0.10, 0.32), (0.50, 0.22, 0.12), dark)
    # Gothic altar table behind the pew.
    ay = 2.20
    box_part("AltarTop", (0, ay, 0.95), (1.60, 0.70, 0.08), wood)
    box_part("AltarLegL", (-0.68, ay, 0.455), (0.10, 0.58, 0.91), wood)
    box_part("AltarLegR", (0.68, ay, 0.455), (0.10, 0.58, 0.91), wood)
    box_part("AltarFrontPanel", (0, ay - 0.26, 0.50), (1.26, 0.06, 0.80),
             dark)
    # Gilt cross relief on the altar front.
    box_part("AltarCrossV", (0, ay - 0.30, 0.52), (0.07, 0.03, 0.42),
             M["brass"])
    box_part("AltarCrossH", (0, ay - 0.30, 0.60), (0.26, 0.03, 0.07),
             M["brass"])
    box_part("AltarCloth", (0, ay, 1.00), (1.70, 0.45, 0.025), M["cloth"])
    # Pair of brass candlesticks with candles + amber flames.
    for i, cxx in enumerate((-0.55, 0.55)):
        cyl_part("CandleBase%d" % i, (cxx, ay, 1.03), 0.075, 0.045, 0.03,
                 M["brass"], sides=12)
        cyl_part("CandleStem%d" % i, (cxx, ay, 1.17), 0.022, 0.022, 0.25,
                 M["brass"], sides=10)
        cyl_part("CandleCup%d" % i, (cxx, ay, 1.31), 0.028, 0.048, 0.05,
                 M["brass"], sides=12)
        cyl_part("Candle%d" % i, (cxx, ay, 1.43), 0.021, 0.021, 0.20,
                 M["wax"], sides=10)
        sphere_part("Flame%d" % i, (cxx, ay, 1.56), 0.016, M["flame"],
                    seg=8, rings=6, scale=(1, 1, 2.2))
    # Standing altar cross on a stepped base.
    box_part("CrossStep0", (0, ay + 0.15, 1.03), (0.30, 0.24, 0.05), dark)
    box_part("CrossStep1", (0, ay + 0.15, 1.075), (0.22, 0.18, 0.05), dark)
    box_part("CrossV", (0, ay + 0.15, 1.35), (0.06, 0.06, 0.50), dark)
    box_part("CrossH", (0, ay + 0.15, 1.45), (0.30, 0.05, 0.06), dark)


KIT = (
    ("gothic_pillar_arch.glb", build_pillar_arch),
    ("gothic_window_frame.glb", build_window_frame),
    ("school_desk_chair.glb", build_desk_chair),
    ("classroom_furniture.glb", build_classroom_furniture),
    ("chapel_pew_altar.glb", build_pew_altar),
)


def main():
    print("Convent kit root: %s" % ROOT)
    for filename, builder in KIT:
        RNG.seed(7)  # deterministic kit
        clear_scene()
        M = build_kit_materials()
        builder(M)
        nobjs = len(bpy.context.scene.objects)
        ntris = sum(len(p.loop_indices) - 2
                    for o in bpy.context.scene.objects
                    for p in o.data.polygons) if nobjs else 0
        print("%s: %d parts, ~%d tris" % (filename, nobjs, ntris))
        export_glb(filename)
    print("KIT_DONE")


main()
