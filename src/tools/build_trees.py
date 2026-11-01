#!/usr/bin/env python3
"""QF mission: realistic procedural broadleaf + pine trees -> HD .glb files.

Builds BOTH trees with bpy/bmesh (data API, headless-safe, no numpy), using
the shared bark+leaf+needle atlas at storage/.uploads/treetex_atlas.webp as
the single PBR texture per tree (1 mesh + 1 material = 1 draw per sector).

Atlas layout (1024x1024, Blender UV space, v up):
  Bark:      u[0.00, 0.50] v[0.00, 1.00]  (trunks, opaque)
  Leaves:    u[0.50, 1.00] v[0.50, 1.00]  (broadleaf alpha cards)
  Needles:   u[0.50, 1.00] v[0.25, 0.50]  (pine tiers; dense sub-rect below)
  LeafFill:  u[0.50, 0.75] v[0.00, 0.25]  (broadleaf blob cores, opaque)
  PineFill:  u[0.75, 1.00] v[0.00, 0.25]  (fallback, opaque)

Usage (exit-code flag REQUIRED so exceptions fail loudly):
  # REQUIRED pre-step: downscale the 1024 atlas to 512 first. The Blender 3.4
  # glTF exporter bakes webp->PNG, so embedding the 1024 atlas yields ~2.5MB
  # per GLB and FAILS the <=800000-byte budget assert below. Rebuilds MUST
  # use the 512 atlas:
  python3 -c "from PIL import Image; Image.open('storage/.uploads/treetex_atlas.webp').resize((512,512),Image.LANCZOS).save('/tmp/treetex_atlas_512.webp','WEBP',quality=90,method=6)"
  blender -b --factory-startup --python-exit-code 1 -P src/tools/build_trees.py \
    -- --atlas /tmp/treetex_atlas_512.webp

Optional args: --out-broad PATH --out-pine PATH --prev-broad PATH --prev-pine PATH
"""

from __future__ import annotations

import math
import os
import random
import sys

# ---------------------------------------------------------------- tunables ---
P = {
    "seed": 20261101,
    # Broadleaf: 11m tree. Massive gnarled trunk + 5 limbs + 6 blobs + cards.
    "broad_trunk_h": 3.8,
    "broad_trunk_r1": 0.62,
    "broad_trunk_r2": 0.30,
    "broad_trunk_sides": 11,
    "broad_trunk_bend": 0.70,
    "broad_blob_subdiv": 4,  # 3.4 bmesh: N -> classic subdiv N-1 (4 = 1280 tris)
    "broad_card_count": 10,
    "broad_limb_count": 5,
    # Pine: 13m tree. Trunk + 5 drooping tiers of squashed blobs + leader cap.
    "pine_trunk_h": 10.5,  # runs through the separated tiers to the leader
    "pine_trunk_r1": 0.42,
    "pine_trunk_r2": 0.10,
    "pine_trunk_sides": 11,
    "pine_trunk_bend": 0.35,
    "pine_tier_subdiv": 4,  # 3.4 bmesh: N -> classic subdiv N-1 (4 = 1280 tris)
    # Cleanup / budget (mirrors src/tools/blender_cleanup.py steps).
    "tri_budget": 14000,  # decimate only if a tree exceeds this (<15k brief cap)
    "merge_dist": 0.0001,
    "preview_size": 768,
    "preview_samples": 64,
}

# UV rects into the atlas: (u0, v0, u1, v1).
UV_BARK = (0.005, 0.005, 0.495, 0.995)
UV_LEAF = (0.505, 0.505, 0.995, 0.995)
UV_NEEDLE = (0.505, 0.255, 0.995, 0.495)
# Densest needle sub-rect (lower-right of the needle band; measured on atlas).
UV_NEEDLE_DENSE = (0.62, 0.255, 0.995, 0.42)
UV_LEAF_FILL = (0.505, 0.005, 0.745, 0.245)
UV_PINE_FILL = (0.755, 0.005, 0.995, 0.245)


# ------------------------------------------------------------- arg parsing ---
def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))

    def val(name, default):
        if name in argv:
            i = argv.index(name)
            if i + 1 < len(argv):
                return argv[i + 1]
        return default

    return {
        "atlas": os.path.join(root, val("--atlas",
                                        os.path.join("storage", ".uploads",
                                                     "treetex_atlas.webp"))),
        "out_broad": os.path.join(root, val("--out-broad",
                                            os.path.join("public", "assets",
                                                         "custom",
                                                         "tree_broadleaf_hd.glb"))),
        "out_pine": os.path.join(root, val("--out-pine",
                                           os.path.join("public", "assets",
                                                        "custom",
                                                        "tree_pine_hd.glb"))),
        "prev_broad": val("--prev-broad", "/tmp/qf_preview_broadleaf.png"),
        "prev_pine": val("--prev-pine", "/tmp/qf_preview_pine.png"),
    }


# ---------------------------------------------------------- deterministic ----
def _hash3(ix, iy, iz):
    s = math.sin(ix * 12.9898 + iy * 78.233 + iz * 37.719) * 43758.5453
    return s - math.floor(s)


def _smoother(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def vnoise(x, y, z):
    """Trilinear value noise in [0,1]; deterministic, no numpy."""
    ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    ux, uy, uz = _smoother(fx), _smoother(fy), _smoother(fz)
    c000 = _hash3(ix, iy, iz)
    c100 = _hash3(ix + 1, iy, iz)
    c010 = _hash3(ix, iy + 1, iz)
    c110 = _hash3(ix + 1, iy + 1, iz)
    c001 = _hash3(ix, iy, iz + 1)
    c101 = _hash3(ix + 1, iy, iz + 1)
    c011 = _hash3(ix, iy + 1, iz + 1)
    c111 = _hash3(ix + 1, iy + 1, iz + 1)
    x00 = c000 + (c100 - c000) * ux
    x10 = c010 + (c110 - c010) * ux
    x01 = c001 + (c101 - c001) * ux
    x11 = c011 + (c111 - c011) * ux
    y0 = x00 + (x10 - x00) * uy
    y1 = x01 + (x11 - x01) * uy
    return y0 + (y1 - y0) * uz


def fbm(x, y, z, octaves=3):
    total, amp, freq = 0.0, 0.5, 1.0
    norm = 0.0
    for _ in range(octaves):
        total += amp * vnoise(x * freq, y * freq, z * freq)
        norm += amp
        amp *= 0.5
        freq *= 2.03
    return total / norm if norm else 0.5


# ------------------------------------------------------------------ scene ---
def reset_scene():
    import bpy
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        if block.users == 0:
            bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        if block.users == 0:
            bpy.data.images.remove(block)
    print("scene cleared")


def make_tree_material(name, atlas_path, tint=(1.0, 1.0, 1.0, 1.0)):
    """Single PBR material: atlas albedo + alpha-clip + double-sided."""
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "CLIP"  # glTF MASK, alphaTest 0.5 equivalent
    mat.alpha_threshold = 0.5
    # 3.4 exporter: doubleSided=true iff use_backface_culling is False.
    mat.use_backface_culling = False  # glTF doubleSided (leaf cards)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular"].default_value = 0.35
    img = bpy.data.images.load(os.path.abspath(atlas_path))
    img.colorspace_settings.name = "sRGB"  # albedo map
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.location = (-400, 300)
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    print("material %s uses %s" % (name, os.path.basename(atlas_path)))
    return mat


# ------------------------------------------------------------------ build ---
def _new_bmesh_with_uv():
    import bmesh
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    return bm, uv_layer


def build_trunk_into(bm, uv_layer, trunk_h, r1, r2, sides, bend, seed_tag):
    """Tapered bent cylinder trunk (bmesh); returns (top_x, top_y, verts)."""
    import bmesh
    from mathutils import Matrix, Vector
    before = len(bm.verts)
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=sides, radius1=r1, radius2=r2,
        depth=trunk_h, matrix=Matrix.Translation((0.0, 0.0, trunk_h / 2.0)),
        calc_uvs=False,
    )
    trunk_new = list(bm.verts)[before:]
    trunk_set = set(trunk_new)
    # Subdivide the SIDE edges only (vertical quads) for a smooth bend.
    side_edges = [e for e in bm.edges
                  if e.verts[0] in trunk_set and e.verts[1] in trunk_set
                  and abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
    if side_edges:
        bmesh.ops.subdivide_edges(bm, edges=side_edges, cuts=5)
    # Trunk is always built first: every vert so far belongs to it.
    trunk_verts = list(bm.verts)[:]
    for v in trunk_verts:
        t = max(0.0, min(1.0, v.co.z / trunk_h))
        # Slight bend: quadratic x offset with height.
        v.co.x += bend * t * t
        # Root flare near the ground (v6: stronger, ancient-oak flare).
        if t < 0.20:
            flare = 1.0 + (0.20 - t) * 4.5
            v.co.x *= flare
            v.co.y *= flare
        # Gnarled trunk: radial noise + vertical ridge ripple (v6: deeper).
        ang = math.atan2(v.co.y, v.co.x)
        n = fbm(math.cos(ang) * 1.6 + seed_tag, v.co.z * 0.9,
                math.sin(ang) * 1.6, 3) - 0.5
        ridge = math.sin(ang * 9.0 + seed_tag * 3.0) * 0.5 + \
            math.sin(ang * 17.0 + 1.7) * 0.5
        radial = 1.0 + n * 0.22 + ridge * 0.05
        v.co.x *= radial
        v.co.y *= radial
    # Cylindrical UVs into the bark rect.
    u0, v0, u1, v1 = UV_BARK
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            ang = math.atan2(co.y, co.x)
            u = u0 + (ang / (2.0 * math.pi) + 0.5) * (u1 - u0)
            vv = v0 + max(0.0, min(1.0, co.z / trunk_h)) * (v1 - v0)
            loop[uv_layer].uv = (u, vv)
    top_x = bend  # bend at t=1
    return top_x, 0.0, trunk_h


def build_blob_into(bm, uv_layer, center, radius, subdiv, squash, seed_tag,
                    uv_rect, droop=0.0, uv_repeat=(1, 1)):
    """Displaced icosphere blob (NOT a cone); returns new verts."""
    import bmesh
    from mathutils import Matrix
    before = len(bm.verts)
    bmesh.ops.create_icosphere(
        bm, subdivisions=subdiv, radius=radius,
        matrix=Matrix.Translation(center), calc_uvs=False,
    )
    new_verts = list(bm.verts)[before:]
    cx, cy, cz = center
    sx, sy, sz = squash
    for v in new_verts:
        dx, dy, dz = v.co.x - cx, v.co.y - cy, v.co.z - cz
        dist = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
        nx, ny, nz = dx / dist, dy / dist, dz / dist
        # Two-lobe displacement: fine detail + large canopy lobes.
        n = fbm(v.co.x * 1.15 + seed_tag, v.co.y * 1.15,
                v.co.z * 1.15, 3) - 0.5
        m = fbm(v.co.x * 0.45 + seed_tag * 2.0, v.co.y * 0.45,
                v.co.z * 0.45, 2) - 0.5
        d = (n * 0.75 + m * 1.10) * 0.46 * radius
        v.co.x += nx * d
        v.co.y += ny * d
        v.co.z += nz * d
        # Non-uniform squash (flattened tiers for pine).
        v.co.x = cx + (v.co.x - cx) * sx
        v.co.y = cy + (v.co.y - cy) * sy
        v.co.z = cz + (v.co.z - cz) * sz
        # Drooping rim for lower pine tiers.
        if droop:
            rad = math.sqrt((v.co.x - cx) ** 2 + (v.co.y - cy) ** 2)
            frac = min(1.0, rad / max(radius, 1e-6))
            v.co.z -= droop * frac * frac
    # Spherical UVs into the foliage rect (with optional tiling so pine
    # needles read at ~25cm instead of ~0.5m).
    u0, v0, u1, v1 = uv_rect
    ru, rv = uv_repeat
    new_set = set(new_verts)
    for f in bm.faces:
        if not all(lp.vert in new_set for lp in f.loops):
            continue
        for loop in f.loops:
            dx = loop.vert.co.x - cx
            dy = loop.vert.co.y - cy
            dz = loop.vert.co.z - cz
            dist = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
            fu = (math.atan2(dy, dx) / (2.0 * math.pi) + 0.5) * ru % 1.0
            fv = (math.asin(max(-1.0, min(1.0, dz / dist))) / math.pi
                  + 0.5) * rv % 1.0
            loop[uv_layer].uv = (u0 + fu * (u1 - u0), v0 + fv * (v1 - v0))
    return new_verts


def build_card_into(bm, uv_layer, rng, center, size, uv_rect, normal):
    """Alpha-tested leaf card facing `normal` (outward) + seeded roll/UV flip.

    v2 used random yaw/tilt: cards caught no light and read as dark slabs.
    Facing outward + sitting slightly proud of the blob surface fixes both.
    """
    import bmesh
    from mathutils import Matrix, Vector
    before_faces = len(bm.faces)
    n = Vector(normal).normalized()
    helper = Vector((0.0, 0.0, 1.0)) if abs(n.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    x_ax = (helper.cross(n)).normalized()
    y_ax = (n.cross(x_ax)).normalized()
    basis = Matrix((x_ax, y_ax, n)).transposed().to_4x4()
    roll = Matrix.Rotation(rng.uniform(0.0, 2.0 * math.pi), 4, n)
    rot = roll @ basis
    scl = Matrix.Scale(size / 2.0, 4)
    loc = Matrix.Translation(center)
    bmesh.ops.create_grid(
        bm, x_segments=1, y_segments=1, size=1.0,
        matrix=loc @ rot @ scl, calc_uvs=False,
    )
    new_faces = list(bm.faces)[before_faces:]
    # Per-card UV variation: 90-degree rotations + optional flip.
    flip = rng.random() < 0.5
    rot_steps = rng.randint(0, 3)
    u0, v0, u1, v1 = uv_rect
    corners = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    if flip:
        corners = [(c[0], v0 + v1 - c[1]) for c in corners]
    corners = corners[rot_steps:] + corners[:rot_steps]
    for f in new_faces:
        for loop, c in zip(f.loops, corners):
            loop[uv_layer].uv = c
    return new_faces


def build_limb_into(bm, uv_layer, base, direction, length, r1, r2, seed_tag):
    """Tapered branch limb along `direction` (bark UVs); returns new verts."""
    import bmesh
    from mathutils import Matrix, Vector
    D = Vector(direction).normalized()
    helper = Vector((0.0, 0.0, 1.0)) if abs(D.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    x_ax = (helper.cross(D)).normalized()
    y_ax = (D.cross(x_ax)).normalized()
    rot = Matrix((x_ax, y_ax, D)).transposed().to_4x4()
    B = Vector(base)
    mid = B + D * (length / 2.0)
    # NOTE: 3.4 subdivide_edges REMOVES original verts/faces (proven by probe),
    # so collect limb faces only AFTER subdividing; never hold refs across it.
    faces_before = len(bm.faces)
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=8, radius1=r1, radius2=r2,
        depth=length, matrix=Matrix.Translation(mid) @ rot, calc_uvs=False,
    )
    fresh_verts = set()
    for f in list(bm.faces)[faces_before:]:
        fresh_verts.update(f.verts)
    # Subdivide axis-parallel edges for a slight downward swoop.
    axis_edges = [e for e in bm.edges
                  if e.verts[0] in fresh_verts and e.verts[1] in fresh_verts
                  and abs((e.verts[1].co - e.verts[0].co).normalized().dot(D)) > 0.9]
    if axis_edges:
        bmesh.ops.subdivide_edges(bm, edges=axis_edges, cuts=3)
    limb_faces = list(bm.faces)[faces_before:]
    limb_set = set()
    for f in limb_faces:
        limb_set.update(f.verts)
    for v in limb_set:
        rel = v.co - B
        t = max(0.0, min(1.0, rel.dot(D) / length))
        v.co.z -= 0.35 * t * t * length * 0.3  # gentle swoop
        n = fbm(v.co.x * 2.0 + seed_tag, v.co.y * 2.0,
                v.co.z * 2.0, 2) - 0.5
        v.co += (v.co - (B + D * (t * length))).normalized() * n * 0.06
    # Cylindrical bark UVs around the limb axis.
    u0, v0, u1, v1 = UV_BARK
    for f in limb_faces:
        for loop in f.loops:
            rel = loop.vert.co - B
            t = max(0.0, min(1.0, rel.dot(D) / length))
            axis_pt = B + D * (t * length)
            off = loop.vert.co - axis_pt
            ang = math.atan2(off.dot(y_ax), off.dot(x_ax))
            u = u0 + (ang / (2.0 * math.pi) + 0.5) * (u1 - u0)
            vv = v0 + t * (length / 4.0) * (v1 - v0)
            loop[uv_layer].uv = (u, vv)
    return limb_set


def assemble_broadleaf(rng):
    """9-13m broadleaf: gnarled trunk + limbs + 6 blobs + 10 cards."""
    import bmesh
    bm, uv_layer = _new_bmesh_with_uv()
    th = P["broad_trunk_h"]
    bend = P["broad_trunk_bend"]
    top_x, _, _ = build_trunk_into(
        bm, uv_layer, th, P["broad_trunk_r1"], P["broad_trunk_r2"],
        P["broad_trunk_sides"], bend, 11.0,
    )
    # Spreading limbs from the upper trunk into the canopy (v6: ref oak has
    # thick visible branches; bases derived from the trunk bend curve).
    for i in range(P["broad_limb_count"]):
        bz = th * rng.uniform(0.72, 0.98)
        bx = bend * (bz / th) ** 2
        yaw = i * 2.4 + rng.uniform(-0.3, 0.3)
        elev = rng.uniform(0.42, 0.75)  # 25-45 deg up
        direction = (math.cos(yaw) * math.cos(elev),
                     math.sin(yaw) * math.cos(elev), math.sin(elev))
        length = rng.uniform(2.6, 3.4)
        build_limb_into(bm, uv_layer, (bx, 0.0, bz), direction, length,
                        rng.uniform(0.16, 0.20), 0.07, 601.0 + i * 13.0)
    # Broken canopy: separated blob clusters with sky gaps (v7: v6 still read
    # as one mass; ref oak has distinct clusters + light gaps). Per-blob
    # subdiv keeps the tri budget flat after adding limbs.
    sub = P["broad_blob_subdiv"]
    blobs = [
        # (center, radius, squash, subdiv)
        ((top_x + 0.1, 0.0, th + 4.9), 2.40, (1.0, 1.0, 0.95), sub),
        ((top_x + 3.0, 0.7, th + 3.2), 2.00, (1.0, 1.0, 0.85), sub),
        ((top_x - 2.9, 0.9, th + 3.3), 2.10, (1.0, 1.0, 0.85), sub),
        ((top_x + 0.6, -3.0, th + 3.1), 1.90, (1.0, 1.0, 0.85), sub),
        ((top_x - 0.7, 3.0, th + 3.0), 1.85, (1.0, 1.0, 0.85), 3),
        ((top_x + 0.7, 0.5, th + 1.2), 1.90, (1.05, 1.05, 0.80), 3),
    ]
    for i, (c, r, sq, sb) in enumerate(blobs):
        build_blob_into(bm, uv_layer, c, r, sb, sq, 101.0 + i * 17.0,
                        UV_LEAF_FILL)
    # Leaf cards sit slightly proud of the blob surfaces, facing outward
    # so they catch light (v1 buried them; v2 random tilt read as dark
    # slabs). Positions + normals derived from blob data.
    for i in range(P["broad_card_count"]):
        bc, br, _bsq, _bsub = blobs[i % len(blobs)]
        ang = rng.uniform(0.0, 2.0 * math.pi)
        elev = rng.uniform(-0.35, 0.35)
        dx = math.cos(ang) * math.cos(elev)
        dy = math.sin(ang) * math.cos(elev)
        dz = math.sin(elev)
        size = rng.uniform(1.5, 2.0)
        # Slight normal jitter so cards are not perfectly radial.
        jx, jy, jz = (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3),
                      rng.uniform(-0.2, 0.2))
        build_card_into(bm, uv_layer, rng,
                        (bc[0] + dx * br * 0.78,
                         bc[1] + dy * br * 0.78,
                         bc[2] + dz * br * 0.72),
                        size, UV_LEAF, (dx + jx, dy + jy, dz + jz))
    print("broadleaf: trunk + %d limbs + %d blobs + %d cards" % (
        P["broad_limb_count"], len(blobs), P["broad_card_count"]))
    return bm


def assemble_pine(rng):
    """10-15m pine: trunk + 5 squashed drooping tiers + leader. No cones."""
    import bmesh
    bm, uv_layer = _new_bmesh_with_uv()
    th = P["pine_trunk_h"]
    top_x, _, _ = build_trunk_into(
        bm, uv_layer, th, P["pine_trunk_r1"], P["pine_trunk_r2"],
        P["pine_trunk_sides"], P["pine_trunk_bend"], 77.0,
    )
    # Separated weeping tier stack (v6: ref spruce shows 6-8 tiers with sky
    # between them; brief binds 4-5, so 5 tiers with rim gaps + trunk visible
    # in the gaps). Flat feathered tiers, long lower limbs, strong droop.
    sub = P["pine_tier_subdiv"]
    tiers = [
        # (center_z, radius, squash-z, droop)
        (2.60, 2.90, 0.26, 0.75),
        (4.30, 2.40, 0.26, 0.60),
        (6.00, 1.90, 0.26, 0.45),
        (7.70, 1.40, 0.28, 0.30),
        (9.20, 0.95, 0.30, 0.15),
    ]
    for i, (tz, r, sz, droop) in enumerate(tiers):
        jx = rng.uniform(-0.15, 0.15)
        jy = rng.uniform(-0.15, 0.15)
        rj = r + rng.uniform(-0.12, 0.12)
        build_blob_into(bm, uv_layer,
                        (top_x * (tz / th) + jx, jy, tz), rj, sub,
                        (1.0, 1.0, sz), 301.0 + i * 23.0,
                        UV_NEEDLE_DENSE, droop=droop, uv_repeat=(3, 3))
    # Leader cap above the top tier, at the trunk line.
    build_blob_into(bm, uv_layer, (top_x * (10.2 / th), 0.0, 10.2), 0.55, 3,
                    (1.0, 1.0, 1.25), 499.0, UV_NEEDLE_DENSE,
                    uv_repeat=(3, 3))
    print("pine: trunk + %d tiers + leader" % len(tiers))
    return bm


# -------------------------------------------------------- finalize/export ---
def tri_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def finalize_tree(bm, name, mat):
    """Cleanup (decimate-if-over-budget, merge, de-loose, apply) -> object."""
    import bmesh
    import bpy
    # Merge doubles + delete loose (bmesh, context-free).
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=P["merge_dist"])
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    mesh = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    # Decimate ONLY if over budget (mirrors blender_cleanup.py pattern).
    tris = tri_count(mesh)
    if tris > P["tri_budget"]:
        ratio = P["tri_budget"] / tris
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="OBJECT")
        mod = obj.modifiers.new("QFDecimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            print("%s decimated ratio %.3f" % (name, ratio))
        except RuntimeError:
            obj.modifiers.remove(mod)
            print("%s decimate failed, kept full mesh" % name)
    # Apply rotation + scale (mirrors blender_cleanup.py pattern).
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.transform_apply(rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")
    return obj


def report_tree(obj, label):
    import bpy
    from mathutils import Vector
    mesh = obj.data
    tris = tri_count(mesh)
    obj.update_tag()
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    print("REPORT %s: verts=%d tris=%d height=%.2fm width=%.2fm "
          "depth=%.2fm minZ=%.3f" % (
              label, len(mesh.vertices), tris, max(zs) - min(zs),
              max(xs) - min(xs), max(ys) - min(ys), min(zs)))
    return {"tris": tris, "height": max(zs) - min(zs), "minZ": min(zs)}


def setup_preview_scene(target_obj):
    """EEVEE preview stage: ground disc, sun + fill, camera on target."""
    import bpy
    import bmesh
    from mathutils import Matrix, Vector
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = P["preview_size"]
    scene.render.resolution_y = P["preview_size"]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.eevee.taa_render_samples = P["preview_samples"]
    # Neutral world for soft ambient.
    world = bpy.data.worlds.new("QFWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = \
        (0.60, 0.58, 0.55, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.85
    scene.world = world
    # Ground disc at z=0 for the contact shadow.
    gm = bpy.data.meshes.new("QFGroundMesh")
    gb = bmesh.new()
    bmesh.ops.create_circle(gb, cap_ends=True, radius=9.0, segments=48,
                            matrix=Matrix.Translation((0, 0, 0)))
    gb.to_mesh(gm)
    gb.free()
    ground = bpy.data.objects.new("QFGround", gm)
    scene.collection.objects.link(ground)
    gmat = bpy.data.materials.new("QFGroundMat")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs[
        "Base Color"].default_value = (0.32, 0.34, 0.30, 1.0)
    gmat.node_tree.nodes["Principled BSDF"].inputs[
        "Roughness"].default_value = 0.95
    gm.materials.append(gmat)
    # Sun key + dim fill.
    sun = bpy.data.objects.new("QFSun", bpy.data.lights.new("QFSun", "SUN"))
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.88, 0.75)  # warm golden-hour key (ref mood)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("QFFill", bpy.data.lights.new("QFFill", "SUN"))
    fill.data.energy = 0.5
    fill.rotation_euler = (math.radians(30), 0, math.radians(140))
    scene.collection.objects.link(fill)
    # Camera: frame the tree bbox from a 3/4 view.
    bpy.context.view_layer.update()
    corners = [target_obj.matrix_world @ c
               for c in [Vector(b) for b in target_obj.bound_box]]
    centroid = sum(corners, Vector()) / len(corners)
    max_dim = max((max(c.x for c in corners) - min(c.x for c in corners)),
                  (max(c.y for c in corners) - min(c.y for c in corners)),
                  (max(c.z for c in corners) - min(c.z for c in corners)))
    cam_data = bpy.data.cameras.new("QFCam")
    cam_data.lens = 50.0
    cam = bpy.data.objects.new("QFCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    az, el = math.radians(35), math.radians(10)
    fov = 2.0 * math.atan(18.0 / cam_data.lens)  # 36mm sensor, portrait fit
    dist = (max_dim / 2.0) / math.tan(fov / 2.0) * 1.18
    pos = centroid + Vector((math.sin(az) * math.cos(el),
                             -math.cos(az) * math.cos(el),
                             math.sin(el))) * dist
    cam.location = pos
    # Track-to via constraint (data API, headless-safe).
    empty = bpy.data.objects.new("QFTarget", None)
    empty.location = centroid
    scene.collection.objects.link(empty)
    track = cam.constraints.new("TRACK_TO")
    track.target = empty
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    bpy.context.view_layer.update()
    return cam


def render_preview(path):
    import bpy
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("preview rendered: %s" % path)


def export_glb(obj, path):
    import bpy
    for o in bpy.data.objects:
        o.select_set(o == obj)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path),
                              export_format="GLB", use_selection=True)
    size = os.path.getsize(os.path.abspath(path))
    print("exported %s (%d bytes)" % (path, size))
    return size


def main():
    import bpy
    args = parse_args()
    assert os.path.exists(args["atlas"]), "atlas missing: " + args["atlas"]

    # --- Broadleaf ---
    reset_scene()
    rng = random.Random(P["seed"])
    bm = assemble_broadleaf(rng)
    mat = make_tree_material("TreeAtlasBroad", args["atlas"])
    obj = finalize_tree(bm, "BroadleafHD", mat)
    rep_b = report_tree(obj, "broadleaf")
    setup_preview_scene(obj)
    render_preview(args["prev_broad"])
    size_b = export_glb(obj, args["out_broad"])

    # --- Pine ---
    reset_scene()
    rng = random.Random(P["seed"] + 7)
    bm = assemble_pine(rng)
    mat = make_tree_material("TreeAtlasPine", args["atlas"],
                             tint=(0.82, 0.92, 0.82, 1.0))
    obj = finalize_tree(bm, "PineHD", mat)
    rep_p = report_tree(obj, "pine")
    setup_preview_scene(obj)
    render_preview(args["prev_pine"])
    size_p = export_glb(obj, args["out_pine"])

    print("SUMMARY broadleaf tris=%d height=%.2f size=%d" % (
        rep_b["tris"], rep_b["height"], size_b))
    print("SUMMARY pine tris=%d height=%.2f size=%d" % (
        rep_p["tris"], rep_p["height"], size_p))
    assert size_b <= 800000 and size_p <= 800000, "GLB SIZE CHECK FAILED"
    ok = (rep_b["tris"] < 15000 and 9.0 <= rep_b["height"] <= 13.0
          and rep_p["tris"] < 15000 and 10.0 <= rep_p["height"] <= 15.0)
    if not ok:
        raise SystemExit("BUDGET CHECK FAILED: see SUMMARY lines above")
    print("BUDGET CHECK PASSED")


main()
