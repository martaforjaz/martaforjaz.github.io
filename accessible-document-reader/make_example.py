"""Generate a controlled scan and its independent reading-order reference."""
import json
from pathlib import Path

import pymupdf

ROOT = Path(__file__).parent / "examples"
PASSAGES = [
    ("A guide to the water cycle", 42, 45, 500, 24),
    ("Evaporation", 42, 115, 222, 17),
    ("Sunlight warms oceans and lakes. Some liquid water becomes water vapor and rises into the atmosphere.", 42, 148, 222, 13),
    ("Condensation", 42, 235, 222, 17),
    ("As air cools, water vapor can form small droplets. Many of these droplets together make a cloud.", 42, 268, 222, 13),
    ("Precipitation", 312, 115, 222, 17),
    ("When droplets grow large enough, they fall. Precipitation can reach the ground as rain or snow.", 312, 148, 222, 13),
    ("Collection", 312, 235, 222, 17),
    ("Rivers carry runoff toward lakes and oceans. Some water soaks into the soil and moves underground.", 312, 268, 222, 13),
    ("The cycle continues as water moves between the land, oceans and atmosphere.", 42, 380, 500, 14),
]

ROOT.mkdir(exist_ok=True)
doc = pymupdf.open()
page = doc.new_page(width=576, height=460)
for text, x, y, width, size in PASSAGES:
    box = pymupdf.Rect(x, y, x + width, y + 75)
    assert page.insert_textbox(box, text, fontsize=size, fontname="hebo" if size > 16 else "helv") >= 0
pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), colorspace=pymupdf.csGRAY)
scan = pymupdf.open()
scan.new_page(width=576, height=460).insert_image(page.rect, pixmap=pixmap)
scan.save(ROOT / "water-cycle.pdf", deflate=True)
(ROOT / "reference.json").write_text(json.dumps([row[0] for row in PASSAGES], indent=2) + "\n", encoding="utf-8")
