from __future__ import annotations

try:  # PyMuPDF ≥ 1.24 exposes the non-deprecated module name.
    import pymupdf as fitz
except ImportError:  # pragma: no cover - older PyMuPDF
    import fitz  # type: ignore

from pdf2epub.ocr import pages_from_json


def doc_with_pages(n: int = 1):
    doc = fitz.open()
    for _ in range(n):
        doc.new_page(width=432, height=648)
    return doc


def test_imports_surya_25_blocks_with_html():
    payload = {
        "book.pdf": [
            {
                "image_bbox": [0, 0, 432, 648],
                "blocks": [
                    {
                        "label": "Text",
                        "bbox": [10, 20, 400, 60],
                        "html": "<p>প্রথম <em>অনুচ্ছেদ</em></p>",
                        "reading_order": 1,
                        "confidence": 0.94,
                    }
                ],
            }
        ]
    }
    pages = pages_from_json(doc_with_pages(), payload)
    block = pages[0].blocks[0]
    assert block.kind == "text"
    assert block.html == "<p>প্রথম <em>অনুচ্ছেদ</em></p>"
    assert block.text == "প্রথম অনুচ্ছেদ"
    assert block.confidence == 0.94
    assert pages[0].mean_confidence == 0.94


def test_imports_older_surya_2_text_lines():
    payload = {
        "source": [
            {
                "image_bbox": [0, 0, 432, 648],
                "text_lines": [
                    {"text": "পুরোনো Surya 2 লাইন", "bbox": [10, 20, 300, 40], "confidence": 0.8}
                ],
            }
        ]
    }
    pages = pages_from_json(doc_with_pages(), payload)
    block = pages[0].blocks[0]
    assert block.text == "পুরোনো Surya 2 লাইন"
    assert block.bbox == (10.0, 20.0, 300.0, 40.0)


def test_imports_our_own_raw_pages_map():
    payload = {
        "model": "datalab-to/surya-ocr-2.5",
        "pages": {
            "0": {
                "image_bbox": [0, 0, 432, 648],
                "blocks": [
                    {"label": "SectionHeader", "bbox": [10, 10, 300, 25], "html": "<h1>অধ্যায়</h1>"}
                ],
            }
        },
    }
    pages = pages_from_json(doc_with_pages(), payload)
    assert pages[0].blocks[0].kind == "heading2"
    assert pages[0].blocks[0].text == "অধ্যায়"
