import argparse
import gzip
import json
import os
from pathlib import Path
import re
import sqlite3
import tarfile
import xml.etree.ElementTree as ET

PATH = re.compile(r"(sn\d+)/(\d{4})/(\d\d)/(\d\d)/(ed-\d+)/(seq-\d+)/ocr\.xml$")
TITLES = {"sn83030272": "The Sun", "sn83030214": "New-York Tribune"}

def parse(xml):
    root = ET.fromstring(xml)
    ns = {"a": root.tag.split("}")[0][1:]}
    page = root.find(".//a:Page", ns)
    width, height = (float(page.attrib[key]) for key in ("WIDTH", "HEIGHT"))
    for block in page.findall(".//a:TextBlock", ns):
        attrs = block.attrib
        if any(k not in attrs for k in ("HPOS", "VPOS", "WIDTH", "HEIGHT")):
            continue
        lines = []
        for line in block.findall("a:TextLine", ns):
            positions = {}
            for word in line.findall("a:String", ns):
                x = float(word.get("HPOS", 0))
                candidate = (float(word.get("WC", 0)), word.get("CONTENT", ""))
                if x not in positions or candidate[0] > positions[x][0]:
                    positions[x] = candidate
            geometry = tuple(float(line.attrib[k]) for k in ("HPOS", "VPOS", "WIDTH", "HEIGHT"))
            lines.append((" ".join(positions[x][1] for x in sorted(positions)), geometry))
        for first in range(0, len(lines), 14):
            chunk = lines[first:first + 14]
            text = re.sub(r"-\s*\n\s*(?=[a-z])", "", "\n".join(line[0] for line in chunk))
            text = " ".join(text.split())
            if len(text.split()) < 12:
                continue
            left = min(g[0] for _, g in chunk)
            top = min(g[1] for _, g in chunk)
            right = max(g[0] + g[2] for _, g in chunk)
            bottom = max(g[1] + g[3] for _, g in chunk)
            box = [round(left/width, 5), round(top/height, 5),
                   round((right-left)/width, 5), round((bottom-top)/height, 5)]
            yield [f'{attrs["ID"]}-{first//14+1}', text, box]

def ingest(args):
    db = sqlite3.connect(args.database, timeout=20)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
    db.execute("PRAGMA synchronous=NORMAL")
    committed = 0
    seen = 0
    with tarfile.open(args.source, "r|bz2") as archive:
        for member in archive:
            match = PATH.search(member.name)
            if not match:
                continue
            lccn, year, month, day, edition, seq = match.groups()
            if args.title and lccn not in args.title:
                continue
            seen += 1
            if args.max_source_pages is not None and seen > args.max_source_pages:
                break
            date = f"{year}-{month}-{day}"
            page_id = f"{lccn}/{date}/{edition}/{seq}"
            if db.execute("SELECT 1 FROM pages WHERE id=?", (page_id,)).fetchone():
                continue
            rows = list(parse(archive.extractfile(member).read()))
            record = [page_id, TITLES.get(lccn, lccn), rows]
            with db:
                db.execute("INSERT INTO pages VALUES (?,?)", (page_id,json.dumps(record, ensure_ascii=False)))
            committed += 1
            if args.simulate_crash == committed:
                os._exit(86)
            if args.limit == committed:
                break
    print(f"{committed} newly committed pages. {db.execute('SELECT COUNT(*) FROM pages').fetchone()[0]} total.")
    db.close()

def export(args):
    with sqlite3.connect(args.database) as db:
        rows = [json.loads(row[0]) for row in db.execute("SELECT data FROM pages ORDER BY id")]
    for page in rows:
        blocks = page[2]
        selected = sorted(range(len(blocks)), key=lambda i: -min(len(blocks[i][1]), 750))[:40]
        page[2] = [[blocks[i][0], blocks[i][1][:900].rsplit(" ", 1)[0] if len(blocks[i][1]) > 900 else blocks[i][1],
                    blocks[i][2]] for i in sorted(selected)]
    target = Path(args.output)
    temp = target.with_suffix(".tmp")
    with gzip.open(temp, "wt", encoding="utf-8", compresslevel=5) as stream:
        json.dump(rows, stream, ensure_ascii=False, separators=(",", ":"))
    temp.replace(target)
    print(f"Exported {len(rows)} pages and {sum(len(page[2]) for page in rows)} passages.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    imp = commands.add_parser("ingest")
    imp.add_argument("source")
    imp.add_argument("--database",default="archive.sqlite")
    imp.add_argument("--title",action="append")
    imp.add_argument("--limit",type=int)
    imp.add_argument("--max-source-pages",type=int)
    imp.add_argument("--simulate-crash",type=int)
    imp.set_defaults(run=ingest)
    out = commands.add_parser("export")
    out.add_argument("--database",default="archive.sqlite")
    out.add_argument("--output",default="corpus.json.gz")
    out.set_defaults(run=export)
    options = parser.parse_args()
    options.run(options)
