"""Export the selected newspaper recognizer and its CTC alphabet for the browser."""
import argparse
import json
from pathlib import Path

import onnx
import torch

from train import HEIGHT, WIDTH, Recognizer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("checkpoint", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
checkpoint = torch.load(args.checkpoint, weights_only=True, map_location="cpu")
alphabet = checkpoint["alphabet"]
model = Recognizer(len(alphabet) + 1)
model.load_state_dict(checkpoint["state"])
model.eval()
args.output.mkdir(parents=True, exist_ok=True)
path = args.output / "recognizer.onnx"
torch.onnx.export(model, torch.zeros(1, 1, HEIGHT, WIDTH), path, dynamo=False,
                  input_names=["image"], output_names=["logits"], opset_version=17)
onnx.checker.check_model(path)
(args.output / "alphabet.json").write_text(json.dumps(list(alphabet)), encoding="utf-8")
