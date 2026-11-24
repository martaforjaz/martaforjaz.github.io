# Newspaper line OCR

[Open the interactive comparison](https://martaforjaz.github.io/accessible-archive-search/ocr/) · [Watch the captioned walkthrough](https://martaforjaz.github.io/accessible-archive-search/ocr/#demo)

This CNN and bidirectional GRU uses CTC to recognize text from cropped newspaper lines. The expanded run uses material from both public training shards, geometric and photometric augmentation, and a cosine learning-rate schedule. The checkpoint is selected by character error rate on the **public validation split**. Page IDs are disjoint across training, validation and test.

## Results

- Public test, 240 lines: character error 12.4% → 8.9%; word error 22.4% → 17.2%; 111 → 147 exact lines.
- Three independent issues of The Sun, 36 lines: character error 9.5% → 7.3%; word error 27.6% → 19.1%; 7 → 15 exact lines.
- Williamsburg, ten lines: 24.3% archived OCR, 5.4% first model, 3.9% expanded model character error.

The expanded run used 11,000 training lines from 80 pages. Epoch 18 of 24 had the lowest public validation character error.

## Reproduce the training

Install PyTorch, Pillow, NumPy and PyArrow. Download the first and second train parquet shards of [Newspaper OCR Gold](https://huggingface.co/datasets/NealCaren/newspaper-ocr-gold) to `data/train.parquet` and `data/train-extra.parquet`. Save the validation and test shards as `data/val.parquet` and `data/test.parquet`. The dataset publisher describes the references as model-verified.

```sh
python train.py --lines 5500 --extra-lines 5500 --epochs 24 --augment --output results-v2
```

The original checkpoint can be rebuilt using [the original training script](https://github.com/martaforjaz/martaforjaz.github.io/blob/96fdba7/accessible-archive-search/ocr/train.py) with `--epochs 16`, the first training shard and the same validation and test files.

## Independent archive checks

[Ground truth](ground-truth/ground-truth.json) contains 36 line-by-line transcriptions from three issues of *The Sun*. None of those page IDs or the separate Williamsburg page ID occurs in either public training shard. Line boundaries are specified in the evaluation script.

```sh
python evaluate_issues.py --samples ground-truth
```

The [Williamsburg comparison](results/williamsburg-v2.json) uses ten checked reference lines and the [archived ALTO](https://tile.loc.gov/storage-services/service/ndnp/nn/batch_nn_aristotle_ver01/data/sn83030272/100479618/1900010601/0069.xml) from *The Sun*. Source scans are from the Library of Congress, [Chronicling America](https://www.loc.gov/collections/chronicling-america/). Character and word error rates measure edit distance against the reference. The evaluation uses cropped lines and leaves page segmentation and search ranking outside its scope.

## Browser model

Run `python export_model.py results-v2/checkpoint.pt model` with ONNX installed to rebuild the browser weights and alphabet. The website uses the exported model with ONNX Runtime Web. For a page, Tesseract supplies line coordinates. Its text is discarded.
