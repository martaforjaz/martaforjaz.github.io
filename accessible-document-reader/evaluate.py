"""Score the controlled scan against the source transcript."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent / "examples"
reference = json.loads((ROOT / "reference.json").read_text(encoding="utf-8"))
observed = json.loads((ROOT / "observed.json").read_text(encoding="utf-8"))

def tokenize(text):
    return re.findall(r"\w+", text.lower())

def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        next_row = [i]
        for j, y in enumerate(b, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j-1] + (x != y)))
        row = next_row
    return row[-1]

expected = tokenize(" ".join(reference))
anchors = [tokenize(p)[:min(3, len(tokenize(p)))] for p in reference]

def score(passages):
    scan = tokenize(" ".join(passages))
    positions = [
        next((i for i in range(len(scan)) if scan[i:i+len(anchor)] == anchor), None)
        for anchor in anchors
    ]
    pairs = [(a, b) for i, a in enumerate(positions) for b in positions[i+1:]]
    errors = distance(expected, scan)
    return {
        "word_edits": errors,
        "normalized_word_error_rate": errors / len(expected),
        "reference_passages_found": sum(i is not None for i in positions),
        "passage_pairs_in_order": sum(a is not None and b is not None and a < b for a, b in pairs),
    }

baseline = json.loads((ROOT / "baseline.json").read_text(encoding="utf-8"))
result = {
    "reference_words": len(expected),
    "reference_passages": len(reference),
    "reference_pairs": len(reference) * (len(reference) - 1) // 2,
    "before_gutter_reconstruction": score(baseline["passages"]),
    "after_gutter_reconstruction": score(observed["passages"]),
    "keyboard_tasks": observed["keyboardTasks"],
    "nasa_passages_extracted": observed["nasaPassages"],
}
(ROOT / "results.json").write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
print(json.dumps(result, indent=2))
