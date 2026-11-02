# 3D Asset & World Generation Tools (Full Potential Reference)

## 1. First-Class MCP Server (`studio-3d-tools`)

Registered in `~/.config/muse/settings.json` (`src/tools/studio_3d_mcp_server.py`), exposing 7 native MCP tools:

- `partnet_shapenet_build`: Inspect or synthesize multi-part CAD-accurate `.glb` assets from PartNet part-hierarchies & ShapeNet metric dimensions (`bazaar_stall`, `sports_car`, `commercial_building`, `streetlamp`).
- `blender_pro_generate`: Run Blender 3.4 built-in generators (`sapling_tree` oak/pine/willow, `arch_building` multi-floor Archimesh building, `landscape` canyon/mountain/hills).
- `osm_real_world_city_3d`: Extrude a real-world 3D city/bazaar district `.glb` from OpenStreetMap building footprints, heights, roads, parks, and waterways (`lucknow_hazratganj`, `monaco_harbor`, `tokyo_shibuya`, `nyc_times_square`).
- `objaverse_inspect_3d`: Search Objaverse-XL / LVIS 10M+ 3D models and inspect real artist mesh/node/material hierarchies.
- `blenderkit_search_free`: Search BlenderKit's free 3D models, PBR materials, and HDRIs with exact metric dimensions and face counts.
- `fetch_cc0_pbr_or_model`: Download 100% free CC0 photogrammetry 3D models or 1K PBR texture sets from Poly Haven (`fetch_polyhaven.py`) or ambientCG (`fetch_ambientcg.py`).
- `run_visual_qa_gate`: Run `node src/verifier/visual_qa_gate.js` on `public/live-preview`.

## 2. Direct CLI Commands (Equivalents)

- **PartNet + ShapeNet Blueprint & Builder**:
  `python3 src/tools/partnet_shapenet_blueprint.py --query "bazaar stall" --generate-bpy --out public/assets/custom/bazaar_stall.glb`
- **Blender Pro Generators (Sapling Tree / Archimesh Building / A.N.T. Landscape)**:
  `python3 src/tools/blender_pro_builder.py --type sapling_tree --preset oak --out public/assets/custom/tree_oak.glb`
  `python3 src/tools/blender_pro_builder.py --type arch_building --floors 3 --width 10 --depth 8 --out public/assets/custom/building_3f.glb`
  `python3 src/tools/blender_pro_builder.py --type landscape --preset canyon --out public/assets/custom/terrain_canyon.glb`
- **OpenStreetMap Real-World 3D City/Bazaar Extruder**:
  `python3 src/tools/osm_city_3d.py --preset lucknow_hazratganj --radius 200 --out public/assets/custom/lucknow_bazaar.glb`
- **Objaverse Structure Inspector**:
  `python3 src/tools/search_objaverse.py --query "car" --limit 3`
- **BlenderKit Free Search**:
  `python3 src/tools/fetch_blenderkit.py --query "sports car" --type model --limit 3`
- **Poly Haven & ambientCG CC0 Fetchers**:
  `python3 src/tools/fetch_polyhaven.py boulder_01 --type model --res 1k`
  `python3 src/tools/fetch_ambientcg.py --query Bricks075 --limit 1`

## 3. Auto-Enabled Blender 3.4 Precision & Hard-Surface Addons

Configured in `/home/opencode/.config/blender/3.4/scripts/startup/enable_pro_addons.py`:

- `add_curve_sapling` (Sapling Tree Generator), `archimesh` (Architectural rooms/doors/windows/columns/roofs), `ant_landscape` (A.N.T. Landscape), `add_mesh_BoltFactory` (exact metric screws/bolts), `mesh_tiny_cad` (CAD vertex intersection/circle/bisect), `object_boolean_tools` (BoolTool non-destructive booleans), `mesh_looptools`, `mesh_f2`, `measureit`, `node_wrangler`.
