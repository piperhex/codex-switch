from pathlib import Path
import json
import re

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "integrate-sci-fi-dream-skins.mjs"
PRESETS = ROOT / "apps" / "desktop" / "src-tauri" / "resources" / "dream-skin" / "presets"
OUTPUT = ROOT / "docs" / "assets" / "dream-skin-sci-fi-contact-sheet.jpg"

slugs = re.findall(r'^  \["([^"]+)",', MANIFEST.read_text(encoding="utf-8"), re.MULTILINE)
if len(slugs) != 100:
    raise RuntimeError(f"Expected 100 science-fiction themes, found {len(slugs)}")

columns = 10
rows = 10
thumb_width = 300
thumb_height = 169
label_height = 31
sheet = Image.new("RGB", (columns * thumb_width, rows * (thumb_height + label_height)), "#10141c")
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=14)

for index, slug in enumerate(slugs):
    theme_dir = PRESETS / f"preset-{slug}"
    metadata = json.loads((theme_dir / "theme.json").read_text(encoding="utf-8"))
    with Image.open(theme_dir / "background.jpg") as source:
        thumb = source.convert("RGB")
        thumb.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
    x = (index % columns) * thumb_width
    y = (index // columns) * (thumb_height + label_height)
    sheet.paste(thumb, (x, y))
    label = f"{index + 1:03d}  {metadata['id'].removeprefix('preset-')}"
    draw.text((x + 8, y + thumb_height + 7), label, fill="#e9eef8", font=font)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUTPUT, "JPEG", quality=91, optimize=True)
print(OUTPUT)
