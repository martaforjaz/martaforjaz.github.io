"""Draw the portfolio illustration around the reader's page and transcript."""
from pathlib import Path
from PIL import Image, ImageDraw

image = Image.new("RGB", (800, 220), "#142d50")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((230, 31, 373, 192), radius=9, fill="#eef5fc", outline="#8db4d3", width=3)
draw.rounded_rectangle((425, 31, 570, 192), radius=9, fill="#24466b", outline="#8db4d3", width=3)
draw.line((248, 51, 344, 51), fill="#345b85", width=6)
for x in (248, 305):
    for y in range(70, 170, 13):
        draw.line((x,y,x+47,y), fill="#7d98b4", width=3)
draw.rounded_rectangle((302, 97, 357, 129), radius=4, outline="#bf6a1e", width=3)
draw.line([(358,112),(468,112)], fill="#ecb464", width=3)
for y,w in ((53,102),(71,80),(88,94),(112,73),(135,97),(153,73),(172,101)):
    draw.line((447,y,447+w,y), fill="#ecb464" if y==112 else "#a6c4e2", width=4)
image.save(Path(__file__).parent / "examples" / "banner.png")
