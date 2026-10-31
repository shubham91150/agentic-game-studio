#!/usr/bin/env python3
"""Horizon Sprint — Blender beveled hard-surface models (VISUAL UPGRADE Step 2).

Builds: car_body, car_cabin (glasshouse), barrier, wing.
Every mesh: shaped -> bevel (angle-limit, 2 seg) -> weighted normals -> smooth shade.
Exports ONE .glb (Y-up glTF = three.js coords; car nose modeled toward Blender -Y
so it lands on three.js +Z, the game's forward).

Usage:
  blender -b --factory-startup --python-exit-code 1 -P src/tools/build_track_models.py \
    -- storage/cache/vup_models.obj storage/cache/vup_car_preview.png

NOTE: OBJ (not GLB) because distro Blender lacks numpy for the glTF exporter.
Converted with src/tools/obj_to_modeljs.js.
"""
import bmesh
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_OBJ = os.path.abspath(argv[0])
OUT_PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None
OUT_BLEND = OUT_OBJ.replace(".obj", ".blend")


def wipe():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.meshes, bpy.data.materials):
        for x in list(col):
            col.remove(x)


def cube(name, sx, sy, sz):
    # primitive size=1.0 => 1m edge, so scale == full dims in metres
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name + "_mesh"
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return o


def subdivide(o, cuts):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    for _ in range(cuts):
        bpy.ops.mesh.subdivide()
    bpy.ops.object.mode_set(mode="OBJECT")
    o.select_set(False)


def shape_body(o):
    m = o.data
    for v in m.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        # nose toward -Y: taper + droop
        if y < -1.0:
            t = min(1.0, (-1.0 - y) / 1.2)
            x *= 1.0 - 0.20 * t
            z -= 0.10 * t
        # rear haunches
        if y > 1.2:
            t = min(1.0, (y - 1.2) / 1.0)
            x *= 1.0 + 0.05 * t
        # hood dip
        if z > 0.18 and -2.1 < y < -0.3:
            z -= 0.05
        # side-skirt tuck
        if z < -0.15:
            x *= 0.96
        # tail kick-up
        if y > 1.8 and z > 0.1:
            z += 0.03
        v.co.x, v.co.y, v.co.z = x, y, z
    m.update()


def shape_cabin(o):
    m = o.data
    for v in m.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        if z > 0.05:
            k = min(1.0, (z - 0.05) / 0.20)
            x *= 1.0 - 0.30 * k
            y *= 1.0 - 0.20 * k
            if y < 0:  # windshield rake
                y += 0.30 * k
            else:  # rear glass slope
                y -= 0.20 * k
        v.co.x, v.co.y, v.co.z = x, y, z
    m.update()


def weighted_normals(o):
    # Area-weighted vertex normals baked as custom loop normals.
    # (Same math as the Weighted Normal modifier, which errors on distro
    # Blender 3.4.1 even with auto-smooth on — this is version-proof.)
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    acc = {}
    for f in bm.faces:
        w = f.calc_area()
        for v in f.verts:
            acc[v.index] = acc.get(v.index, Vector((0.0, 0.0, 0.0))) + f.normal * w
    for k in acc:
        if acc[k].length > 1e-9:
            acc[k].normalize()
    loop_no = [Vector((0.0, 0.0, 1.0))] * len(me.loops)
    for poly in me.polygons:
        for li in poly.loop_indices:
            loop_no[li] = acc[me.loops[li].vertex_index]
    me.normals_split_custom_set(loop_no)
    bm.free()
    me.update()


def finish(o, bevel_width):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    o.data.use_auto_smooth = True
    o.data.auto_smooth_angle = math.radians(45)
    bpy.ops.object.shade_smooth()
    bv = o.modifiers.new("EdgeBevel", "BEVEL")
    bv.width = bevel_width
    bv.segments = 2
    bv.limit_method = "ANGLE"
    bv.angle_limit = math.radians(30)
    bpy.ops.object.modifier_apply(modifier=bv.name)
    weighted_normals(o)
    o.data.update()
    o.select_set(False)
    print("CUSTOM_NORMALS %s: %s" % (o.name, o.data.has_custom_normals))


def tris(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    mesh = ev.to_mesh()
    n = sum(len(p.loop_indices) - 2 for p in mesh.polygons)
    ev.to_mesh_clear()
    return n


def main():
    wipe()

    body = cube("car_body", 2.0, 4.4, 0.55)
    subdivide(body, 3)
    shape_body(body)
    finish(body, 0.05)

    cabin = cube("car_cabin", 1.6, 2.0, 0.5)
    subdivide(cabin, 2)
    shape_cabin(cabin)
    finish(cabin, 0.07)

    barrier = cube("barrier", 0.5, 5.4, 0.9)
    finish(barrier, 0.04)

    wing = cube("wing", 1.9, 0.5, 0.08)
    finish(wing, 0.025)

    for o in (body, cabin, barrier, wing):
        print("TRIS %s: %d" % (o.name, tris(o)))

    bpy.ops.object.select_all(action="DESELECT")
    for o in (body, cabin, barrier, wing):
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.obj(
        filepath=OUT_OBJ, use_selection=True, use_materials=False,
        use_triangles=True, use_normals=True, use_uvs=True,
    )
    print("EXPORTED " + OUT_OBJ)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

    if OUT_PREVIEW:
        preview(body, cabin)


def preview(body, cabin):
    # assemble for beauty shot (Blender coords: game +Z fwd => -Y; game +Y up => +Z)
    for extra in ("barrier", "wing"):
        o = bpy.data.objects.get(extra)
        if o is not None:
            o.hide_viewport = True
            o.hide_render = True
    cabin.location = (0.0, 0.3, 0.44)
    paint = bpy.data.materials.new("Paint")
    paint.use_nodes = True
    bsdf = paint.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.75, 0.08, 0.08, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.85
    bsdf.inputs["Roughness"].default_value = 0.32
    body.data.materials.append(paint)
    glass = bpy.data.materials.new("Glass")
    glass.use_nodes = True
    g = glass.node_tree.nodes["Principled BSDF"]
    g.inputs["Base Color"].default_value = (0.05, 0.08, 0.11, 1.0)
    g.inputs["Metallic"].default_value = 0.9
    g.inputs["Roughness"].default_value = 0.12
    cabin.data.materials.append(glass)

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 900
    sc.render.resolution_y = 500
    sc.render.resolution_percentage = 100
    sc.eevee.taa_render_samples = 32
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.72, 1.0)

    bpy.ops.object.light_add(type="SUN", location=(4, -3, 6))
    sun = bpy.context.active_object
    sun.data.energy = 4.0
    bpy.ops.object.camera_add(location=(-4.6, -5.6, 2.4))
    cam = bpy.context.active_object
    cam.data.lens = 50
    d = cam.constraints.new(type="TRACK_TO")
    d.target = body
    d.track_axis = "TRACK_NEGATIVE_Z"
    d.up_axis = "UP_Y"
    sc.camera = cam
    sc.render.filepath = OUT_PREVIEW
    bpy.ops.render.render(write_still=True)
    print("PREVIEW " + OUT_PREVIEW)


main()
