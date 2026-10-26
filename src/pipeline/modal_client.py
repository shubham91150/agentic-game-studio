"""
Modal Serverless GPU Client for 3D Mesh & PBR Synthesis
"""
import os
import modal

def request_3d_asset(image_bytes: bytes, app_name="spurcode-microsoft-trellis-pipeline"):
    """
    Submits image to Modal serverless GPU and returns compiled .glb bytes
    """
    try:
        AI3D = modal.Cls.from_name(app_name, "MicrosoftTrellisGenerator")
        generator = AI3D()
        glb_data = generator.generate_3d_glb.remote(image_bytes)
        return glb_data
    except Exception as e:
        print(f"[Modal Client Error]: {e}")
        return None
