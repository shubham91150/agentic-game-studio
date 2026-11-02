#!/usr/bin/env python3
"""
Alias wrapper for src/tools/blender_pro_builder.py (Archimesh + Sapling + A.N.T. Landscape + PartNet Builder).
"""
import runpy
from pathlib import Path

if __name__ == "__main__":
    target = Path(__file__).resolve().parent / "blender_pro_builder.py"
    runpy.run_path(str(target), run_name="__main__")
