# Accessible Document Reader

An old manual can look perfectly readable on screen and still behave like a stack of pictures: search finds nothing, text cannot be selected, and a screen reader has no paragraphs to follow. I built this reader to turn those page images into a transcript you can search, navigate by keyboard, correct, and trace back to the scan.

[Open the reader](https://martaforjaz.github.io/accessible-document-reader/)

Open a PDF or try the built-in two-column document. Search for **snow**, press Tab to move from the results heading to the match, and press Enter to jump to the passage. The page preview highlights the source region. Use the headings list to move between sections or download the corrected transcript as plain text.

[Accessible Archive Search](https://martaforjaz.github.io/accessible-archive-search/) applies the same source-verification workflow to indexed historical newspapers.

## How it works

- PDF.js rasterizes one page at a time. Tesseract.js recognizes English text, bounding boxes and confidence scores in a worker.
- The reading-order heuristic separates page-wide blocks from overlapping left and right columns. It reads those columns in sequence. Text size and line count suggest headings.
- Search results target the transcript and the corresponding bounding box. Passages with low OCR confidence get a review notice. The corrected text is used for search, copy, and export during the current session.
- The app downloads pinned PDF rendering and OCR dependencies from public CDNs. The selected PDF is processed in the browser. The app does not upload the PDF.

## Evaluation and sources

The controlled image-only PDF uses original explanatory text based on the [USGS water cycle overview](https://www.usgs.gov/special-topics/water-science-school/water-cycle). Its reference transcript is generated from the source text before rasterization. The second example is the [NASA water-cycle PDF](https://science.nasa.gov/wp-content/uploads/2023/10/Water_Cycle_05_03_20.pdf), an independently published image-only document. It is used to check end-to-end extraction.

## Run locally

Serve this directory with Python 3 and open the reported local address.

```sh
python -m http.server 8982
```

The OCR flow needs network access for its dependencies on first use. The current reader accepts up to 30 pages and uses English OCR. Tables, handwriting, irregular multi-column layouts, decorative fonts, and low-quality scans can still require manual correction. The transcript is semantic HTML. Export produces plain text.

`browser-check.mjs` runs the browser evaluation using Node.js, Python and Microsoft Edge. Set `EDGE_PATH` to point to a different Edge installation. Stop any server already using port 8982 before running it. Run `python evaluate.py` afterwards to score recognized words and passage order.

## Measured results

On the controlled two-column page, the initial OCR transcript mixed lines from opposite columns. Its reading order matched 39 of 45 reference passage pairs and needed 55 word edits. After splitting lines at the column gutter before rebuilding the transcript, the order matched all 45 pairs and the 87 normalized words matched the reference. The score ignores punctuation and capitalization and includes error from words being out of order. These figures describe one controlled page, not an estimate of general OCR accuracy.

In Edge, a keyboard-driven check opened the example, followed a heading, searched for a phrase, jumped to the highlighted passage, and copied it. The NASA scan exercise verified extraction on both pages, without a reference transcript or an accuracy score. Heading detection remains heuristic. For example, it did not classify “Collection” as a heading on the controlled scan. Some paragraphs also appear as multiple selectable passages. A screen-reader usability study and formal accessibility audit are outside this evaluation.

[Raw evaluation results](examples/results.json) · [Browser screenshot](examples/demo.png)
