---
name: visual-qa-and-subagent-rules
description: Mandatory multi-subagent orchestration (subagent_spawn), research-first workflow, PartNet part-by-part modeling, and visual_qa_gate.js enforcement.
type: project
---

# Visual QA, Research-First & Multi-Subagent Rules

1. **Mandatory Multi-Subagent Orchestration (`subagent_spawn` + `subagent_wait`)**:
   - Never build or upgrade a game single-threaded. Spawn parallel subagents:
     - **Subagent A**: Deep Research & System Architecture (`docs/game-system-design/`)
     - **Subagent B**: World, Terrain, Water, 3D Grass & Buildings (`WorldRealism`, `osm_city_3d.py`, `blender_pro_builder.py`)
     - **Subagent C**: Multi-Part Vehicles, Characters, Props & Physics (`partnet_shapenet_blueprint.py`, `search_objaverse.py`, `fetch_polyhaven.py`, `fetch_ambientcg.py`)
     - **Subagent D**: Visual QA Gate (`node src/verifier/visual_qa_gate.js`) & Headless Screenshot Critic

2. **Hard Ban on Box/Cone/Sphere Fakes**:
   - Building cars, trees, buildings, stalls, or grass out of `THREE.BoxGeometry`, `ConeGeometry`, `CylinderGeometry`, `SphereGeometry`, or flat `PlaneGeometry` is STRICTLY BANNED and fails `node src/verifier/visual_qa_gate.js`.
   - Every object must follow the **PartNet Anatomical Part-by-Part Blueprint** or load real `.glb` assets via `GLTFLoader` / `WorldRealism.loadGlbModel`.
