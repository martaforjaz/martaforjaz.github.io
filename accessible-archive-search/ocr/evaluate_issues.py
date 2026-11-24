"""Evaluate two checkpoints on clean line crops from three manually transcribed editions."""
import argparse
import json
from pathlib import Path

from PIL import Image
import torch

from train import Recognizer, decode, edit, normalize, pixels

# Coordinates refer to the published assignment crops. The remaining vertical
# edges of the neighboring column are excluded.
REGIONS = {
    "1900-01-03": (16, 365, [19,46,64,82,101,119,137,154,172,189,208,224]),
    "1900-01-07": (21,362,[0,20,39,57,74,92,109,127,145,163,179,197,215,232]),
    "1900-01-15": (29,374,[5,22,40,60,76,94,113,131,148,166,184,203,220]),
}

def recognize(model, alphabet, image):
    row, length = pixels(image)
    batch = torch.from_numpy(row)[None,None].float().div(127.5).sub(1)
    return decode(model(batch).argmax(2)[0,:length].tolist(), alphabet)

def read_model(path):
    ck=torch.load(path,map_location="cpu",weights_only=True)
    model=Recognizer(len(ck["alphabet"])+1)
    model.load_state_dict(ck["state"])
    return model.eval(),ck["alphabet"]

def stats(rows,key):
    return {
        "cer":sum(edit(r["reference"],r[key]) for r in rows)/sum(len(r["reference"]) for r in rows),
        "wer":sum(edit(r["reference"].split(),r[key].split()) for r in rows)/sum(len(r["reference"].split()) for r in rows),
        "exact":sum(r["reference"]==r[key] for r in rows),
        "lines":len(rows),
    }

@torch.inference_mode()
def main(args):
    torch.set_num_threads(2)
    root=Path(args.samples)
    source=json.loads((root/"ground-truth.json").read_text(encoding="utf-8"))
    models={name:read_model(path) for name,path in (("initial",args.initial),("expanded",args.expanded))}
    cases=[]
    for issue in source:
        x0,x1,edges=REGIONS[issue["issue"]]
        if len(edges)!=len(issue["lines"])+1:
            raise ValueError("Ground truth and crop boundaries disagree")
        with Image.open(root/issue["image"]) as image:
            for i,(text,y0,y1) in enumerate(zip(issue["lines"],edges[:-1],edges[1:],strict=True),1):
                crop=image.crop((x0,y0,x1,y1))
                row={"issue":issue["issue"],"line":i,"reference":normalize(text),"box":[x0,y0,x1,y1]}
                for label,(model,alphabet) in models.items():
                    row[label]=recognize(model,alphabet,crop)
                cases.append(row)
    result={"overall":{key:stats(cases,key) for key in models},"lines":cases}
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(result["overall"])

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--samples",default="para-transcrever")
    parser.add_argument("--initial",default="results/checkpoint.pt")
    parser.add_argument("--expanded",default="results-v2/checkpoint.pt")
    parser.add_argument("--output",default="results-v2/the-sun-evaluation.json")
    main(parser.parse_args())
