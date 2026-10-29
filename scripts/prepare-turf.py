"""Prepare licensed source texture maps for the mobile/web renderer (Pillow required)."""
from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1])
destination = Path(__file__).resolve().parents[1] / "src" / "assets" / "turf"
destination.mkdir(parents=True, exist_ok=True)
for source_name, output_name, size, quality in [
    ("Color", "green-color", 1024, 87),
    ("NormalGL", "green-normal", 1024, 91),
    ("Roughness", "green-roughness", 256, 82),
]:
    with Image.open(source / f"Grass004_1K-JPG_{source_name}.jpg") as texture:
        texture = texture.convert("RGB")
        texture.thumbnail((size, size), Image.Resampling.LANCZOS)
        target = destination / f"{output_name}.webp"
        texture.save(target, "WEBP", quality=quality, method=6)
        print(f"{target.name}: {target.stat().st_size:,} bytes")
