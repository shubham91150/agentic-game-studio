#!/usr/bin/env python3
"""
osm_city_3d.py — OpenStreetMap Real-World 3D City & Bazaar Extruder
Powered by trimesh, manifold3d, shapely, and scipy.

CLI Usage:
  python3 src/tools/osm_city_3d.py --preset lucknow_hazratganj --radius 200 --out storage/cache/pro_builder/lucknow_bazaar_city.glb
  python3 src/tools/osm_city_3d.py --lat 26.8500 --lon 80.9462 --radius 250 --out city.glb

Features:
1. Built-in presets (`lucknow_hazratganj`, `monaco_harbor`, `tokyo_shibuya`, `nyc_times_square`)
   plus arbitrary `--lat` / `--lon` coordinates.
2. Queries OpenStreetMap Overpass API for `building`, `highway`, `waterway`/`natural=water`,
   and `landuse=grass|park|retail|commercial` within `--radius` meters.
3. Includes a rich, deterministic offline procedural fallback if Overpass API is rate-limited
   or unreachable, ensuring 100% reliable builds in any environment.
4. Projects lat/lon to local meters `(x, z)` centered at `(0, 0)` (with Y-up for Three.js / glTF).
5. Extrudes every building polygon by `building:levels * 3.5m` (or `height` tag) with separate
   PBR facade, recessed window-band strips, parapet roof, and cornice geometry.
6. Builds 3D road ribbons along streets (buffered via Shapely + triangulated), park greens,
   and water bodies, exporting a single multi-mesh `.glb` via `trimesh`.
"""

import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

import numpy as np
import shapely.geometry as sg
import shapely.ops as sops
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

PRESETS: Dict[str, Dict[str, object]] = {
    "lucknow_hazratganj": {
        "lat": 26.8500,
        "lon": 80.9462,
        "description": "Lucknow Hazratganj Heritage Bazaar & Colonial Arcades",
        "facade_palette": [
            (218, 178, 132, 255),  # Nawabi sandstone ochre
            (205, 140, 110, 255),  # Lakhori terracotta brick
            (235, 215, 185, 255),  # Warm lime stucco
            (188, 152, 118, 255),  # Heritage sandstone
        ],
    },
    "monaco_harbor": {
        "lat": 43.7347,
        "lon": 7.4206,
        "description": "Monaco Port Hercule Grand Prix Harbor & Hillside Terraces",
        "facade_palette": [
            (232, 222, 205, 255),
            (220, 195, 170, 255),
            (240, 235, 225, 255),
            (195, 175, 155, 255),
        ],
    },
    "tokyo_shibuya": {
        "lat": 35.6595,
        "lon": 139.7004,
        "description": "Tokyo Shibuya Scramble Commercial Towers & Crossings",
        "facade_palette": [
            (165, 175, 190, 255),
            (140, 150, 168, 255),
            (190, 198, 210, 255),
            (120, 130, 145, 255),
        ],
    },
    "nyc_times_square": {
        "lat": 40.7580,
        "lon": -73.9855,
        "description": "NYC Times Square & Midtown Manhattan Grid",
        "facade_palette": [
            (155, 148, 142, 255),
            (130, 138, 150, 255),
            (175, 160, 145, 255),
            (118, 124, 135, 255),
        ],
    },
}

HIGHWAY_WIDTHS: Dict[str, float] = {
    "motorway": 14.0,
    "trunk": 12.5,
    "primary": 11.0,
    "secondary": 9.5,
    "tertiary": 8.0,
    "residential": 6.5,
    "living_street": 5.5,
    "pedestrian": 6.0,
    "service": 4.2,
    "footway": 2.6,
    "path": 2.2,
}


def latlon_to_local_xz(
    lat: float, lon: float, center_lat: float, center_lon: float
) -> Tuple[float, float]:
    """Projects (lat, lon) to local metric (x=East, z=South) around (center_lat, center_lon)."""
    meters_per_deg_lat = 111132.92
    meters_per_deg_lon = 111412.84 * math.cos(math.radians(center_lat))
    x = (lon - center_lon) * meters_per_deg_lon
    # In Three.js Y-up right-handed coords, +X is East and -Z is North (+Z is South)
    z = -(lat - center_lat) * meters_per_deg_lat
    return float(x), float(z)


def fetch_overpass_osm(
    lat: float, lon: float, radius: float, timeout_sec: int = 12
) -> Optional[Dict]:
    """Queries OpenStreetMap Overpass API for buildings, highways, water, and parks."""
    query = f"""
    [out:json][timeout:{timeout_sec}];
    (
      way["building"](around:{radius},{lat},{lon});
      way["highway"](around:{radius},{lat},{lon});
      way["waterway"](around:{radius},{lat},{lon});
      way["natural"="water"](around:{radius},{lat},{lon});
      way["landuse"~"grass|park|recreation_ground|plaza"](around:{radius},{lat},{lon});
      way["leisure"="park"](around:{radius},{lat},{lon});
    );
    out body;
    >;
    out skel qt;
    """
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
    ]
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    for url in endpoints:
        try:
            req = urllib.request.Request(
                url,
                data=data,
                headers={"User-Agent": "AgenticGameStudio-OSMCity3D/1.0"},
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    if payload.get("elements"):
                        return payload
        except Exception:
            continue
    return None


def parse_height_and_levels(tags: Dict[str, str], rng: np.random.Generator) -> Tuple[float, int]:
    """Extracts building height in meters and floor count from OSM tags."""
    levels = 0
    if "building:levels" in tags:
        try:
            levels = max(1, int(float(str(tags["building:levels"]).split(";")[0])))
        except ValueError:
            levels = 0

    height = 0.0
    if "height" in tags:
        raw_h = str(tags["height"]).lower().replace("m", "").strip().split(";")[0]
        try:
            height = max(3.5, float(raw_h))
        except ValueError:
            height = 0.0

    if height > 0 and levels == 0:
        levels = max(1, int(round(height / 3.5)))
    elif levels > 0 and height == 0:
        height = levels * 3.5
    else:
        levels = int(rng.choice([2, 3, 3, 4, 4, 5, 6]))
        height = levels * 3.5

    return float(height), int(levels)


def polygon_2d_to_y_up_extrusion(
    poly: sg.Polygon, height: float, y_base: float = 0.0
) -> Optional[trimesh.Trimesh]:
    """
    Extrudes a 2D Shapely polygon (whose coordinates are (x, z)) along the +Y axis
    from y_base to y_base + height, returning a valid Y-up trimesh.Trimesh.
    """
    if poly.is_empty or poly.area < 1.5:
        return None
    try:
        # trimesh.creation.extrude_polygon extrudes along +Z from z=0..height
        mesh_z = trimesh.creation.extrude_polygon(poly, height=height)
        verts = np.asarray(mesh_z.vertices, dtype=np.float64)
        # Map (x_2d, z_2d, z_extrude) -> (x, y_base + z_extrude, z_2d)
        new_verts = np.zeros_like(verts)
        new_verts[:, 0] = verts[:, 0]
        new_verts[:, 1] = verts[:, 2] + y_base
        new_verts[:, 2] = verts[:, 1]
        # Flip face winding because swapping Y and Z inverts handedness
        faces = np.asarray(mesh_z.faces, dtype=np.int64)[:, ::-1]
        out = trimesh.Trimesh(vertices=new_verts, faces=faces, process=True)
        return out
    except Exception:
        return None


def make_pbr_material(
    name: str,
    rgba: Tuple[int, int, int, int],
    roughness: float = 0.8,
    metallic: float = 0.05,
    emissive: Optional[Tuple[float, float, float]] = None,
) -> PBRMaterial:
    kwargs = {
        "name": name,
        "baseColorFactor": list(rgba),
        "roughnessFactor": float(roughness),
        "metallicFactor": float(metallic),
    }
    if emissive is not None:
        kwargs["emissiveFactor"] = list(emissive)
    return PBRMaterial(**kwargs)


def build_procedural_fallback_features(
    preset_name: str, radius: float, rng: np.random.Generator
) -> Tuple[List[Tuple[sg.Polygon, float, int]], List[Tuple[sg.LineString, float]], List[sg.Polygon], List[sg.Polygon]]:
    """
    Deterministic, rich architectural district generator used when Overpass API is offline
    or rate-limited. Produces authentic boulevard/bazaar blocks, courtyard buildings,
    connecting side streets, central park plaza, and canal/harbor water.
    """
    buildings: List[Tuple[sg.Polygon, float, int]] = []
    roads: List[Tuple[sg.LineString, float]] = []
    parks: List[sg.Polygon] = []
    waters: List[sg.Polygon] = []

    r = float(radius)
    # 1. Primary boulevards & bazaar spines
    roads.append((sg.LineString([(-r * 0.95, 0.0), (r * 0.95, 0.0)]), 12.0))
    roads.append((sg.LineString([(0.0, -r * 0.95), (0.0, r * 0.95)]), 11.0))

    # Diagonal & ring avenues
    ring_r = r * 0.56
    ring_pts = [
        (
            ring_r * math.cos(a),
            ring_r * math.sin(a),
        )
        for a in np.linspace(0, 2 * math.pi, 25)
    ]
    roads.append((sg.LineString(ring_pts), 8.5))

    # Secondary cross streets
    for offset in [-r * 0.65, -r * 0.32, r * 0.32, r * 0.65]:
        roads.append((sg.LineString([(-r * 0.88, offset), (r * 0.88, offset)]), 6.5))
        roads.append((sg.LineString([(offset, -r * 0.88), (offset, r * 0.88)]), 6.5))

    # Build union of road corridors to avoid placing buildings on streets
    road_corridors = sops.unary_union([line.buffer(w * 0.65) for line, w in roads])

    # 2. Central heritage park / green square & water feature
    park_poly = sg.box(-r * 0.24, r * 0.06, -r * 0.06, r * 0.24).difference(road_corridors)
    if isinstance(park_poly, sg.Polygon) and not park_poly.is_empty:
        parks.append(park_poly)

    if preset_name == "monaco_harbor":
        water_poly = sg.box(-r * 0.9, r * 0.42, r * 0.9, r * 0.92)
        waters.append(water_poly)
    else:
        canal = sg.LineString([(-r * 0.85, -r * 0.48), (0.0, -r * 0.52), (r * 0.85, -r * 0.46)]).buffer(6.0)
        waters.append(canal)

    exclusion = sops.unary_union([road_corridors] + parks + waters)

    # 3. Populate city blocks with architectural footprints (L-shapes, courtyard blocks, colonnades)
    step = 26.0
    xs = np.arange(-r * 0.82, r * 0.82, step)
    zs = np.arange(-r * 0.82, r * 0.82, step)

    for gx in xs:
        for gz in zs:
            if math.hypot(gx, gz) > r * 0.88:
                continue
            bw = float(rng.uniform(12.0, 20.0))
            bd = float(rng.uniform(11.0, 19.0))
            cx = gx + float(rng.uniform(-2.5, 2.5))
            cz = gz + float(rng.uniform(-2.5, 2.5))

            base_box = sg.box(cx - bw * 0.5, cz - bd * 0.5, cx + bw * 0.5, cz + bd * 0.5)
            # Carve L-notch or courtyard on larger footprints for architectural realism
            shape_kind = int(rng.integers(0, 3))
            if shape_kind == 1 and bw > 15.0:
                notch = sg.box(cx, cz, cx + bw * 0.52, cz + bd * 0.52)
                footprint = base_box.difference(notch)
            elif shape_kind == 2 and bw > 16.0 and bd > 15.0:
                court = sg.box(cx - bw * 0.2, cz - bd * 0.2, cx + bw * 0.2, cz + bd * 0.2)
                footprint = base_box.difference(court)
            else:
                footprint = base_box

            footprint = footprint.difference(exclusion.buffer(1.8))
            if footprint.is_empty:
                continue

            geoms = (
                list(footprint.geoms)
                if isinstance(footprint, sg.MultiPolygon)
                else [footprint]
            )
            for poly in geoms:
                if not isinstance(poly, sg.Polygon) or poly.area < 28.0:
                    continue
                if preset_name in ("tokyo_shibuya", "nyc_times_square"):
                    levels = int(rng.choice([4, 5, 6, 8, 10, 12]))
                elif preset_name == "monaco_harbor":
                    levels = int(rng.choice([3, 4, 5, 6, 7]))
                else:
                    levels = int(rng.choice([2, 3, 3, 4, 4, 5]))
                height = levels * 3.5
                buildings.append((poly, height, levels))

    return buildings, roads, parks, waters


def parse_osm_elements_to_features(
    osm_data: Dict,
    center_lat: float,
    center_lon: float,
    radius: float,
    rng: np.random.Generator,
) -> Tuple[List[Tuple[sg.Polygon, float, int]], List[Tuple[sg.LineString, float]], List[sg.Polygon], List[sg.Polygon]]:
    """Converts raw Overpass JSON elements into projected local-meter Shapely geometries."""
    elements = osm_data.get("elements", [])
    nodes: Dict[int, Tuple[float, float]] = {}
    for el in elements:
        if el.get("type") == "node" and "lat" in el and "lon" in el:
            nodes[el["id"]] = latlon_to_local_xz(
                el["lat"], el["lon"], center_lat, center_lon
            )

    buildings: List[Tuple[sg.Polygon, float, int]] = []
    roads: List[Tuple[sg.LineString, float]] = []
    parks: List[sg.Polygon] = []
    waters: List[sg.Polygon] = []
    clip_circle = sg.Point(0.0, 0.0).buffer(radius * 1.05)

    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        nds = el.get("nodes", [])
        coords = [nodes[nid] for nid in nds if nid in nodes]
        if len(coords) < 2:
            continue

        # 1. Buildings
        if "building" in tags and len(coords) >= 3:
            if coords[0] != coords[-1]:
                coords = coords + [coords[0]]
            if len(coords) >= 4:
                poly = sg.Polygon(coords).buffer(0)
                poly = poly.intersection(clip_circle)
                geoms = (
                    list(poly.geoms)
                    if isinstance(poly, sg.MultiPolygon)
                    else [poly]
                )
                for g in geoms:
                    if isinstance(g, sg.Polygon) and g.area >= 12.0:
                        h, lv = parse_height_and_levels(tags, rng)
                        buildings.append((g, h, lv))

        # 2. Highways / Streets
        elif "highway" in tags:
            hw_type = str(tags["highway"])
            width = HIGHWAY_WIDTHS.get(hw_type, 6.0)
            if "lanes" in tags:
                try:
                    lanes = max(1, int(float(str(tags["lanes"]).split(";")[0])))
                    width = max(width, lanes * 3.25)
                except ValueError:
                    pass
            line = sg.LineString(coords).intersection(clip_circle)
            if not line.is_empty:
                lines = (
                    list(line.geoms)
                    if isinstance(line, sg.MultiLineString)
                    else [line]
                )
                for ln in lines:
                    if isinstance(ln, sg.LineString) and ln.length >= 3.0:
                        roads.append((ln, width))

        # 3. Waterways & Natural Water
        elif "waterway" in tags or tags.get("natural") == "water":
            if len(coords) >= 4 and coords[0] == coords[-1]:
                wpoly = sg.Polygon(coords).buffer(0).intersection(clip_circle)
            else:
                wpoly = sg.LineString(coords).buffer(5.0).intersection(clip_circle)
            geoms = (
                list(wpoly.geoms)
                if isinstance(wpoly, sg.MultiPolygon)
                else [wpoly]
            )
            for g in geoms:
                if isinstance(g, sg.Polygon) and g.area >= 10.0:
                    waters.append(g)

        # 4. Parks & Grass
        elif tags.get("landuse") in ("grass", "park", "recreation_ground", "plaza") or tags.get("leisure") == "park":
            if len(coords) >= 3:
                if coords[0] != coords[-1]:
                    coords = coords + [coords[0]]
                if len(coords) >= 4:
                    ppoly = sg.Polygon(coords).buffer(0).intersection(clip_circle)
                    geoms = (
                        list(ppoly.geoms)
                        if isinstance(ppoly, sg.MultiPolygon)
                        else [ppoly]
                    )
                    for g in geoms:
                        if isinstance(g, sg.Polygon) and g.area >= 15.0:
                            parks.append(g)

    return buildings, roads, parks, waters


def build_city_scene(
    buildings: List[Tuple[sg.Polygon, float, int]],
    roads: List[Tuple[sg.LineString, float]],
    parks: List[sg.Polygon],
    waters: List[sg.Polygon],
    radius: float,
    facade_palette: List[Tuple[int, int, int, int]],
) -> Tuple[trimesh.Scene, Dict[str, int]]:
    """
    Constructs a multi-mesh trimesh.Scene with separate PBR materials for:
    - Ground Plaza Base
    - Road Asphalt Ribbons + Raised Sidewalk Kerbs
    - Park Grass Zones + Water Basins
    - Multi-Palette Building Facades
    - Recessed Reflective Glass Window Bands (per floor)
    - Roof Parapets & Rooftop Slabs
    """
    scene = trimesh.Scene()

    # 1. Ground plaza disk / base slab
    ground_poly = sg.Point(0.0, 0.0).buffer(radius * 1.06, resolution=32)
    ground_mesh = polygon_2d_to_y_up_extrusion(ground_poly, height=0.25, y_base=-0.25)
    if ground_mesh is not None:
        ground_mesh.visual = TextureVisuals(
            material=make_pbr_material("city_ground_paving", (68, 66, 62, 255), roughness=0.92, metallic=0.02)
        )
        scene.add_geometry(ground_mesh, node_name="ground_plaza_base")

    # 2. Road ribbons & sidewalks
    if roads:
        road_polys = [ln.buffer(w * 0.5, cap_style=2, join_style=2) for ln, w in roads]
        sidewalk_polys = [ln.buffer(w * 0.5 + 1.6, cap_style=2, join_style=2) for ln, w in roads]
        merged_roads = sops.unary_union(road_polys)
        merged_sidewalks = sops.unary_union(sidewalk_polys).difference(merged_roads)

        road_geoms = (
            list(merged_roads.geoms)
            if isinstance(merged_roads, sg.MultiPolygon)
            else [merged_roads]
        )
        road_meshes = []
        for rp in road_geoms:
            if isinstance(rp, sg.Polygon):
                m = polygon_2d_to_y_up_extrusion(rp, height=0.08, y_base=0.0)
                if m is not None:
                    road_meshes.append(m)
        if road_meshes:
            combined_roads = trimesh.util.concatenate(road_meshes)
            combined_roads.visual = TextureVisuals(
                material=make_pbr_material("road_asphalt_pbr", (38, 40, 44, 255), roughness=0.86, metallic=0.04)
            )
            scene.add_geometry(combined_roads, node_name="road_network_asphalt")

        sw_geoms = (
            list(merged_sidewalks.geoms)
            if isinstance(merged_sidewalks, sg.MultiPolygon)
            else [merged_sidewalks]
        )
        sw_meshes = []
        for sp in sw_geoms:
            if isinstance(sp, sg.Polygon):
                m = polygon_2d_to_y_up_extrusion(sp, height=0.18, y_base=0.0)
                if m is not None:
                    sw_meshes.append(m)
        if sw_meshes:
            combined_sw = trimesh.util.concatenate(sw_meshes)
            combined_sw.visual = TextureVisuals(
                material=make_pbr_material("sidewalk_stone_pbr", (152, 146, 138, 255), roughness=0.84, metallic=0.03)
            )
            scene.add_geometry(combined_sw, node_name="sidewalk_kerbs")

    # 3. Parks / Green Plazas
    if parks:
        merged_parks = sops.unary_union(parks)
        p_geoms = (
            list(merged_parks.geoms)
            if isinstance(merged_parks, sg.MultiPolygon)
            else [merged_parks]
        )
        park_meshes = []
        for pp in p_geoms:
            if isinstance(pp, sg.Polygon):
                m = polygon_2d_to_y_up_extrusion(pp, height=0.12, y_base=0.0)
                if m is not None:
                    park_meshes.append(m)
        if park_meshes:
            combined_parks = trimesh.util.concatenate(park_meshes)
            combined_parks.visual = TextureVisuals(
                material=make_pbr_material("park_turf_pbr", (58, 108, 48, 255), roughness=0.90, metallic=0.02)
            )
            scene.add_geometry(combined_parks, node_name="park_green_zones")

    # 4. Water bodies / Canals / Harbors
    if waters:
        merged_water = sops.unary_union(waters)
        w_geoms = (
            list(merged_water.geoms)
            if isinstance(merged_water, sg.MultiPolygon)
            else [merged_water]
        )
        water_meshes = []
        for wp in w_geoms:
            if isinstance(wp, sg.Polygon):
                m = polygon_2d_to_y_up_extrusion(wp, height=0.06, y_base=0.0)
                if m is not None:
                    water_meshes.append(m)
        if water_meshes:
            combined_water = trimesh.util.concatenate(water_meshes)
            combined_water.visual = TextureVisuals(
                material=make_pbr_material("water_surface_pbr", (24, 92, 128, 255), roughness=0.12, metallic=0.82)
            )
            scene.add_geometry(combined_water, node_name="waterways_harbor")

    # 5. Buildings: Facades, Window Bands, and Roof Parapets
    facade_buckets: List[List[trimesh.Trimesh]] = [[] for _ in facade_palette]
    window_band_meshes: List[trimesh.Trimesh] = []
    roof_meshes: List[trimesh.Trimesh] = []

    built_count = 0
    for idx, (poly, height, levels) in enumerate(buildings):
        facade_mesh = polygon_2d_to_y_up_extrusion(poly, height=height, y_base=0.0)
        if facade_mesh is None:
            continue
        built_count += 1
        bucket_idx = idx % len(facade_palette)
        facade_buckets[bucket_idx].append(facade_mesh)

        # Add horizontal window bands per floor (slightly outset ring so windows read clearly)
        window_ring = poly.exterior.buffer(0.14, join_style=2)
        for lv in range(1, max(2, levels)):
            band_y = lv * 3.5 - 1.55
            if band_y + 1.2 < height - 0.4:
                w_mesh = polygon_2d_to_y_up_extrusion(window_ring, height=1.15, y_base=band_y)
                if w_mesh is not None:
                    window_band_meshes.append(w_mesh)

        # Roof slab + parapet cornice rim
        roof_slab = polygon_2d_to_y_up_extrusion(poly.buffer(0.22, join_style=2), height=0.38, y_base=height)
        if roof_slab is not None:
            roof_meshes.append(roof_slab)

    for b_idx, bucket in enumerate(facade_buckets):
        if not bucket:
            continue
        merged_facade = trimesh.util.concatenate(bucket)
        merged_facade.visual = TextureVisuals(
            material=make_pbr_material(
                f"building_facade_pbr_{b_idx}",
                facade_palette[b_idx],
                roughness=0.82,
                metallic=0.05,
            )
        )
        scene.add_geometry(merged_facade, node_name=f"buildings_facade_group_{b_idx}")

    if window_band_meshes:
        merged_windows = trimesh.util.concatenate(window_band_meshes)
        merged_windows.visual = TextureVisuals(
            material=make_pbr_material(
                "building_window_glass_pbr",
                (34, 62, 88, 255),
                roughness=0.14,
                metallic=0.88,
                emissive=(0.06, 0.09, 0.12),
            )
        )
        scene.add_geometry(merged_windows, node_name="buildings_window_bands")

    if roof_meshes:
        merged_roofs = trimesh.util.concatenate(roof_meshes)
        merged_roofs.visual = TextureVisuals(
            material=make_pbr_material(
                "building_roof_slate_pbr",
                (72, 74, 78, 255),
                roughness=0.85,
                metallic=0.08,
            )
        )
        scene.add_geometry(merged_roofs, node_name="buildings_roof_parapets")

    total_verts = sum(len(g.vertices) for g in scene.geometry.values())
    total_faces = sum(len(g.faces) for g in scene.geometry.values())

    stats = {
        "buildings": built_count,
        "roads": len(roads),
        "parks": len(parks),
        "waters": len(waters),
        "meshes": len(scene.geometry),
        "vertices": int(total_verts),
        "faces": int(total_faces),
    }
    return scene, stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrude real-world OpenStreetMap buildings, roads, parks, and water into a multi-mesh 3D .glb"
    )
    parser.add_argument(
        "--preset",
        choices=list(PRESETS.keys()),
        default=None,
        help="Built-in city/bazaar preset name",
    )
    parser.add_argument("--lat", type=float, default=None, help="Center latitude")
    parser.add_argument("--lon", type=float, default=None, help="Center longitude")
    parser.add_argument(
        "--radius",
        type=float,
        default=250.0,
        help="Radius in meters around center (default: 250)",
    )
    parser.add_argument(
        "--out",
        type=str,
        required=True,
        help="Output .glb path (e.g. city.glb)",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Force deterministic offline procedural city layout without querying Overpass API",
    )
    args = parser.parse_args()

    preset_key = args.preset or "lucknow_hazratganj"
    preset_info = PRESETS[preset_key]
    lat = args.lat if args.lat is not None else float(preset_info["lat"])
    lon = args.lon if args.lon is not None else float(preset_info["lon"])
    radius = max(50.0, float(args.radius))
    facade_palette = list(preset_info["facade_palette"])

    rng = np.random.default_rng(seed=abs(int(lat * 10000) ^ int(lon * 10000)) % (2**31 - 1) or 42)

    osm_payload = None
    source_mode = "overpass_live"
    if not args.offline:
        osm_payload = fetch_overpass_osm(lat, lon, radius)

    buildings: List[Tuple[sg.Polygon, float, int]] = []
    roads: List[Tuple[sg.LineString, float]] = []
    parks: List[sg.Polygon] = []
    waters: List[sg.Polygon] = []

    if osm_payload is not None:
        buildings, roads, parks, waters = parse_osm_elements_to_features(
            osm_payload, lat, lon, radius, rng
        )

    # If Overpass returned too few buildings (rate-limited or sparse tile), supplement/fallback cleanly
    if len(buildings) < 5:
        source_mode = "procedural_fallback" if osm_payload is None else "overpass_hybrid_fallback"
        fb_b, fb_r, fb_p, fb_w = build_procedural_fallback_features(preset_key, radius, rng)
        if len(buildings) < 5:
            buildings.extend(fb_b)
        if len(roads) < 2:
            roads.extend(fb_r)
        if not parks:
            parks.extend(fb_p)
        if not waters:
            waters.extend(fb_w)

    scene, stats = build_city_scene(
        buildings, roads, parks, waters, radius, facade_palette
    )

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    glb_bytes = scene.export(file_type="glb")
    with open(out_path, "wb") as f:
        f.write(glb_bytes)

    summary = {
        "status": "ok",
        "preset": args.preset or "custom",
        "source": source_mode,
        "center": {"lat": lat, "lon": lon, "radius_m": radius},
        "stats": stats,
        "output_glb": out_path,
        "size_bytes": len(glb_bytes),
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
