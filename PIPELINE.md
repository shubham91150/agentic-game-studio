# 🚀 Agentic Game Studio — End-to-End Pipeline & Storage Blueprint

> **Meta Global AI Developer Hackathon 2026** • Autonomous Multimodal 3D Game Studio  
> _Permanent Blueprint & Master TODO Tracker_

---

## 📐 System Pipeline Architecture

```mermaid
flowchart TD
    User([User Prompt / Game Concept]) --> Brain[Step 1: Meta Muse Wonder / Spark Open on Baseten]
    Brain --> MuseCLI[Muse Code CLI: Local File System & Build Orchestrator]

    subgraph Spatial & Assets Pipeline
        MuseCLI --> WorldGen[Step 2: Hunyuan World 2.0 Spatial Terrain]
        WorldGen --> MeshDecimate[Mesh Optimization & Decimation]

        MuseCLI --> ImgGen[Step 3: Meta Image Concept Art]
        ImgGen --> SAM[Step 4: Meta SAM 3.1 Background Cutout]
        SAM --> SAM3D[Step 5: 3D Reconstruction on Modal A10G GPU]
        SAM3D --> GLBStore[(Watertight .GLB Models)]
    end

    subgraph Dual-Engine Production Compiler
        MeshDecimate --> DualCompiler{Dual-Engine Compiler}
        GLBStore --> DualCompiler
        MuseCLI --> DualCompiler

        DualCompiler -->|Target 1: Web & Mobile| WebGL[Three.js WebGL 60 FPS Browser Player]
        DualCompiler -->|Target 2: Pro Studio| Unity[Unity 2022.3 LTS Native C# Project]
    end

    subgraph Storage & Library
        WebGL --> GameDisk[(Persistent VM Storage: /storage/games/{id}/)]
        Unity --> GameDisk
        GameDisk --> API[/api/games Library Endpoint]
        API --> StudioUI[Studio Workbench: My Games Drawer]
    end
```

---

## 🗄️ Storage & Database Architecture (Kahan Save Hoga? Kahan Dikhega?)

### 1. Storage Location on VM (Persistent Disk):

Har game ek unique timestamped UUID ke sath self-contained folder me save hoga:

```
agentic-game-studio/storage/games/{game_id}/
├── manifest.json              # Game metadata (Title, Prompt, Biome, Model, CreatedAt)
├── index.html                 # Standalone Three.js WebGL playable game
├── assets/                    # Generated 3D models & textures (.glb)
│   ├── terrain.glb            # Hunyuan World 3D elevation landscape
│   ├── player.glb             # Main player avatar mesh
│   └── collectibles.glb       # Interactive 3D items
└── unity/                     # Native Unity 2022.3 LTS Project
    └── Assets/Scripts/
        ├── AgenticPlayerController.cs
        └── AgenticGameManager.cs
```

### 2. Kya External Database (Postgres / MongoDB) Chahiye?

- **NO! External heavy DB ki koi zarurat nahi hai!**
- **Kyun:** Game assets, 3D models aur WebGL HTML files binary/text files hoti hain. Unhe disk par store karke ek central **`storage/games/index.json`** registry me index karna 100x fast, zero-latency, aur $0 cost par chalta hai.
- Ye container restart aur redeploy ke baad bhi persistent volume par 100% safe rehta hai.

### 3. App Me Kahan Dikhega?

- **Studio Workbench me "My Games" Library Tab**:
  - `GET /api/games` endpoint saare saved games list karega.
  - Har card me: Title, Biome badge, creation date, **"▶ Play"** button (instant 3D load), aur **"⬇ Unity C#"** download button!

---

## 🛠️ Step-by-Step Pipeline Blueprint

### Step 1: The Brain (Meta Muse Wonder / Spark Open on Baseten)

- **Model:** `meta-models/muse-spark-open` via Baseten ($100 Hackathon Credits) / Meta Model API.
- **Role:** Decomposes user's natural language into mathematical 3D parameters:
  - World Biome (Cyber-Orbital, Glacier Arena, Desert Canyon, Bioluminescent Canopy).
  - Physics Constants (Gravity, Friction, Player Speed, Jump Velocity).
  - Focal Entity Hierarchy (Player Avatar, Obstacles, Collectible Orbs).
  - Game Objective & Win/Loss State Machine.

### Step 2: 3D World Generation (Hunyuan World 2.0)

- **Engine:** Procedural 3D elevation heightmap synthesis (64x64 to 256x256 resolution).
- **Post-Processing:** Quadric mesh decimation (via Python `trimesh` / headless mesh optimizer) to ensure smooth 60 FPS mobile performance.

### Step 3: 2D Concept Asset Generation (Meta Image / Vertex)

- Generates orthographic, neutral-lit 2D concept art for focal game entities.

### Step 4: Asset Segmentation (Meta SAM 3.1)

- Uses Meta's Segment Anything Model (SAM 3.1) to cut out background clutter.
- Outputs transparent alpha-channel PNGs with zero halo artifacts.

### Step 5: 3D Asset Synthesis (SAM 3D / Modal A10G GPU)

- Converts 2D alpha cutouts into full 3D geometry with UV unwrapping and PBR textures.
- Exports lightweight `.glb` models.

### Step 6: Dual-Engine Assembly & Verification

- **Target 1 (Three.js WebGL):** Self-contained browser game with on-screen virtual touch joystick (mobile) and WASD (desktop).
- **Target 2 (Unity 2022.3 LTS):** Native C# scripts (`AgenticPlayerController.cs`, `AgenticGameManager.cs`) verified via headless batchmode.

---

## 📋 Master TODO Tracker

- [x] **Repository Initialized:** `shubham91150/agentic-game-studio` (Public, MIT License).
- [x] **Live Frontend Deployed:** `https://agentic-game-studio.vercel.app/` (Vercel-native).
- [x] **Meta Muse Spark Open Integration:** Connected via Baseten (`meta-models/muse-spark-open`, $100 Credits active).
- [x] **Muse Code CLI Installed on VM:** `~/.local/bin/muse` (Muse Code 1.4.13).
- [x] **Hunyuan World 2.0 Spatial Terrain Engine:** Procedural elevation grid synthesis.
- [x] **Dual-Engine Export:** Three.js WebGL compiler + Unity C# exporter.
- [ ] **Game Storage & Persistence System:** Implement `storage/games/` directory with `manifest.json` per game.
- [ ] **Games Library API (`GET /api/games`):** Endpoint returning list of all previously generated games.
- [ ] **Studio UI "My Games" Drawer:** Visual list in workbench to load and replay saved games.
- [ ] **Mesh Decimation & Optimization Utility:** Automated triangle budget clamp (<50,000 polys for 60 FPS).
- [ ] **End-to-End One-Click Verification:** Full loop test from prompt to saved game, WebGL play, and Unity export.
