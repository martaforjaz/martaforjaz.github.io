"""Compare the trained model and archived OCR on ten manually checked lines."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image
import torch

from train import Recognizer, decode, edit, pixels

REFERENCES = [
    (212, 236, "The work of building a freight depot for the"),
    (236, 260, "Delaware, Lackawanna and Western Railroad"),
    (260, 282, "at the foot of Clymer street, Williamsburg, has"),
    (282, 306, "been begun. The land purchased by the rail-"),
    (306, 330, "road contained an old factory and a number of"),
    (330, 351, "other buildings. All these are being torn"),
    (351, 370, "down. Connected with the factory is a brick"),
    (370, 388, "chimney 165 feet high, which for thirty years"),
    (388, 404, "has been a landmark and an objective for pilots"),
    (404, 422, "on East River boats. The razing of this chim-"),
]

def archival_lines(filename):
    root = ET.parse(filename).getroot()
    block = next(node for node in root.iter() if node.get("ID") == "ID5")
    for line in list(block)[202:212]:
        tokens = {}
        for word in line:
            if word.tag.rsplit("}",1)[-1] != "String":
                continue
            x = float(word.get("HPOS"))
            candidate = (float(word.get("WC",0)), word.get("CONTENT"))
            if x not in tokens or candidate[0] > tokens[x][0]:
                tokens[x] = candidate
        yield " ".join(tokens[x][1] for x in sorted(tokens))

def main(args):
    checkpoint=torch.load(args.checkpoint,weights_only=True,map_location="cpu")
    alphabet=checkpoint["alphabet"]
    model=Recognizer(len(alphabet)+1)
    model.load_state_dict(checkpoint["state"])
    model.eval()
    rows=[]
    with Image.open(args.image) as scan, torch.inference_mode():
        if scan.size != (700,442):
            raise ValueError("Expected the 700 × 442 screenshot used for these coordinates")
        for (top,bottom,reference),baseline in zip(REFERENCES,archival_lines(args.alto),strict=True):
            row,length=pixels(scan.crop((194,top,677,bottom)))
            scores=model(torch.from_numpy(row)[None,None].float().div(127.5).sub(1))
            prediction=decode(scores.argmax(2)[0,:length].tolist(),alphabet)
            rows.append({"reference":reference,"archived_ocr":baseline,"neural_ocr":prediction})
    letters=sum(len(row["reference"]) for row in rows)
    words=sum(len(row["reference"].split()) for row in rows)
    result={"lines":rows,"reference_characters":letters,"reference_words":words}
    for name in ("archived_ocr","neural_ocr"):
        result[name]={"cer":sum(edit(r["reference"],r[name]) for r in rows)/letters,
                      "wer":sum(edit(r["reference"].split(),r[name].split()) for r in rows)/words}
    Path(args.output).write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2,ensure_ascii=True))

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--alto",default="data/williamsburg-alto.xml")
    parser.add_argument("--checkpoint",default="results/checkpoint.pt")
    parser.add_argument("--output",default="results/williamsburg-pilot.json")
    main(parser.parse_args())
