"""Train and evaluate a CNN and bidirectional GRU with CTC on newspaper lines."""
import argparse
import io
import json
from pathlib import Path
import random
import time
import unicodedata

import numpy as np
from PIL import Image
import pyarrow.parquet as pq
import torch
from torch import nn
import torch.nn.functional as F
from torch.utils.data import DataLoader

HEIGHT, WIDTH = 32, 640

def normalize(text):
    return " ".join(unicodedata.normalize("NFKC", text).split())

def pixels(image):
    gray = image.convert("L")
    width = min(WIDTH, max(4, round(gray.width * HEIGHT / gray.height)))
    canvas = np.full((HEIGHT, WIDTH), 255, np.uint8)
    canvas[:, :width] = np.asarray(gray.resize((width, HEIGHT), Image.Resampling.BILINEAR))
    return canvas, width // 4

def load(path, limit, seed):
    table = pq.read_table(path, columns=["image", "transcription", "page_id"])
    order = list(range(len(table)))
    random.Random(seed).shuffle(order)
    samples = []
    for i in order:
        raw = table["image"][i].as_py()["bytes"]
        text = normalize(table["transcription"][i].as_py())
        if not raw or not 4 <= len(text) <= 115:
            continue
        with Image.open(io.BytesIO(raw)) as image:
            sample, length = pixels(image)
        if length < len(text) + sum(a == b for a, b in zip(text, text[1:])):
            continue
        samples.append((sample, length, text, table["page_id"][i].as_py()))
        if len(samples) == limit:
            break
    return samples

class Recognizer(nn.Module):
    def __init__(self, classes):
        super().__init__()
        stages = []
        channels = 1
        for out, pool in [(16, 2), (32, 2), (64, (2, 1)), (96, (2, 1))]:
            stages.extend((nn.Conv2d(channels, out, 3, padding=1),
                           nn.BatchNorm2d(out), nn.ReLU(), nn.MaxPool2d(pool)))
            channels = out
        self.features = nn.Sequential(*stages)
        self.sequence = nn.GRU(192, 96, batch_first=True, bidirectional=True)
        self.output = nn.Linear(192, classes)

    def forward(self, batch):
        sequence = self.features(batch).permute(0, 3, 1, 2).flatten(2)
        return self.output(self.sequence(sequence)[0])

def collate(rows):
    images, lengths, labels, pages = zip(*rows)
    return torch.from_numpy(np.stack(images))[:, None], torch.tensor(lengths), labels, pages

def edit(a, b):
    costs = list(range(len(b)+1))
    for i, char in enumerate(a, 1):
        row = [i]
        for j, other in enumerate(b, 1):
            row.append(min(costs[j]+1, row[-1]+1, costs[j-1]+(char != other)))
        costs = row
    return costs[-1]

def decode(seq, alphabet):
    return normalize("".join(alphabet[v-1] for i,v in enumerate(seq) if v and (i==0 or seq[i-1]!=v)))

@torch.inference_mode()
def score(model, batches, alphabet, device):
    model.eval()
    character_errors = word_errors = characters = words = exact = 0
    predictions = []
    for image, lengths, labels, pages in batches:
        sequences = model(image.to(device).float().div(127.5).sub(1)).argmax(2).cpu().tolist()
        for seq, length, ref, page in zip(sequences, lengths.tolist(), labels, pages):
            predicted = decode(seq[:length], alphabet)
            character_errors += edit(ref, predicted)
            word_errors += edit(ref.split(), predicted.split())
            characters += len(ref)
            words += len(ref.split())
            exact += ref == predicted
            predictions.append({"page":page,"reference":ref,"prediction":predicted})
    return {"lines":len(predictions),"cer":character_errors/characters,"wer":word_errors/words,"exact":exact}, predictions

def main(args):
    torch.manual_seed(17)
    torch.backends.cudnn.allow_tf32 = True
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    data=Path(args.data)
    train, val, test = [load(data/f"{split}.parquet", n, seed) for split,n,seed in
                        [("train",args.lines,17),("val",200,18),("test",240,19)]]
    extra = data / "train-extra.parquet"
    if args.extra_lines:
        train.extend(load(extra,args.extra_lines,23))
    pages = [set(row[3] for row in rows) for rows in (train,val,test)]
    if any(pages[i]&pages[j] for i,j in ((0,1),(0,2),(1,2))):
        raise ValueError("Page identifiers overlap across splits")
    alphabet="".join(sorted({char for row in train for char in row[2]}))+"\ufffd"
    label_ids={char:i+1 for i,char in enumerate(alphabet)}
    batches=lambda samples,shuffle=False:DataLoader(samples,batch_size=32,shuffle=shuffle,collate_fn=collate)
    model=Recognizer(len(alphabet)+1).to(device)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.003)
    schedule=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=args.epochs,eta_min=.00015)
    ctc=nn.CTCLoss(blank=0,zero_infinity=True)
    out=Path(args.output)
    out.mkdir(parents=True,exist_ok=True)
    history=[]
    result={"device":str(device),"train_lines":len(train),"validation_lines":len(val),
            "test_lines":len(test),"distinct_pages":[len(p) for p in pages],"history":history}
    best=float("inf")
    start=time.perf_counter()
    for epoch in range(1,args.epochs+1):
        model.train()
        losses=[]
        for images,lengths,labels,_ in batches(train,True):
            targets=torch.tensor([label_ids.get(char,len(alphabet)) for label in labels for char in label])
            sizes=torch.tensor([len(label) for label in labels])
            optimizer.zero_grad(set_to_none=True)
            inputs=images.to(device).float().div(127.5).sub(1)
            if args.augment:
                count=len(images)
                affine=torch.zeros((count,2,3),device=device)
                affine[:,0,0]=1
                affine[:,1,1]=1
                affine[:,1,0]=torch.rand(count,device=device)*.07-.035
                affine[:,1,2]=torch.rand(count,device=device)*.10-.05
                grid=F.affine_grid(affine,inputs.shape,align_corners=False)
                inputs=F.grid_sample(inputs,grid,align_corners=False,padding_mode="border")
                inputs=(inputs*(.72+.28*torch.rand((count,1,1,1),device=device))
                        +.025*torch.randn_like(inputs)).clamp(-1,1)
            logits=model(inputs)
            loss=ctc(logits.log_softmax(2).transpose(0,1),targets,lengths,sizes)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),5)
            optimizer.step()
            losses.append(loss.item())
        schedule.step()
        validation,_=score(model,batches(val),alphabet,device)
        row={"epoch":epoch,"ctc_loss":sum(losses)/len(losses),"validation":validation}
        history.append(row)
        print(json.dumps(row),flush=True)
        if validation["cer"]<best:
            best=validation["cer"]
            result["best_epoch"]=epoch
            torch.save({"state":model.state_dict(),"alphabet":alphabet},out/"checkpoint.pt")
    model.load_state_dict(torch.load(out/"checkpoint.pt",weights_only=True,map_location=device)["state"])
    result["test"],predictions=score(model,batches(test),alphabet,device)
    result["seconds"]=round(time.perf_counter()-start,2)
    for name,doc in [("metrics",result),("test-predictions",predictions)]:
        (out/f"{name}.json").write_text(json.dumps(doc,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(result["test"]),flush=True)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--data",default="data")
    parser.add_argument("--output",default="results")
    parser.add_argument("--lines",type=int,default=3000)
    parser.add_argument("--epochs",type=int,default=12)
    parser.add_argument("--extra-lines",type=int,default=0)
    parser.add_argument("--augment",action="store_true")
    main(parser.parse_args())
