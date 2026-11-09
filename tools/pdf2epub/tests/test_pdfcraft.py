from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from PIL import Image

from pdf2epub.pdfcraft import convert_pcex, pcex_cover, pcex_document


def _png(width: int = 40, height: int = 60) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (30, 60, 45)).save(buffer, format="PNG")
    return buffer.getvalue()


def make_pcex(root: Path) -> Path:
    chapter_head = """<?xml version="1.0" encoding="UTF-8"?>
<chapter level="0"><body>
  <paragraph ref="title" level="0"><block page_index="1" order="0" det="0,0,10,10">নমুনা বই</block></paragraph>
  <paragraph ref="text" level="0"><block page_index="1" order="1" det="0,0,10,10">একজন লেখক</block></paragraph>
</body></chapter>"""
    chapter_7 = """<?xml version="1.0" encoding="UTF-8"?>
<chapter id="7" level="0"><body>
  <paragraph ref="title" level="0"><block page_index="2" order="0" det="0,0,10,10">অধ্যায় এক</block></paragraph>
  <paragraph ref="text" level="0"><block page_index="2" order="1" det="0,0,10,10">প্রথম <strong>গুরুত্বপূর্ণ</strong> লেখা<ref id="2-9"/></block></paragraph>
  <asset ref="image" page_index="3" det="0,0,40,60" hash="img123"><caption>চিত্রের ক্যাপশন</caption></asset>
</body>
<references>
  <ref id="2-9"><paragraph ref="text" level="0"><block page_index="2" order="9" det="0,0,10,10">টীকা পাঠ</block></paragraph></ref>
</references>
</chapter>"""
    chapter_8 = """<?xml version="1.0" encoding="UTF-8"?>
<chapter id="8" level="1"><body>
  <paragraph ref="title" level="0"><block page_index="3" order="2" det="0,0,10,10">অধ্যায় দুই</block></paragraph>
  <paragraph ref="text" level="0"><block page_index="3" order="3" det="0,0,10,10">দ্বিতীয় অধ্যায়ের লেখা।</block></paragraph>
</body></chapter>"""
    toc = """<?xml version="1.0" encoding="UTF-8"?>
<toc page_indexes="2">
  <item id="7" page_index="2" order="0" level="0">
    <item id="8" page_index="3" order="2" level="1"/>
  </item>
</toc>"""
    manifest = {
        "format_version": 1,
        "producer": {"name": "pdf-craft", "version": "test"},
        "created_at": "2026-01-01T00:00:00+00:00",
        "document": {
            "title": "নমুনা বই",
            "description": "",
            "publisher": "OpenBanglaBooks",
            "isbn": None,
            "authors": ["একজন লেখক"],
            "editors": [],
            "translators": [],
            "modified": "2026-01-01T00:00:00+00:00",
            "language": "bn",
        },
    }
    pages = """<?xml version="1.0" encoding="UTF-8"?>
<pages index_base="1" coordinate_space="ocr_pixels" render_dpi="300">
  <page index="1" width="400" height="600"/>
  <page index="2" width="400" height="600"/>
  <page index="3" width="400" height="600"/>
</pages>"""

    path = root / "book.pcex"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("pages.xml", pages)
        archive.writestr("toc.xml", toc)
        archive.writestr("chapters/chapter_head.xml", chapter_head)
        archive.writestr("chapters/chapter_7.xml", chapter_7)
        archive.writestr("chapters/chapter_8.xml", chapter_8)
        archive.writestr("assets/img123.png", _png())
        archive.writestr("cover.png", _png(300, 450))
    return path


def test_converts_pcex_to_bundle(tmp_path):
    pcex = make_pcex(tmp_path)
    assert pcex_document(pcex)["title"] == "নমুনা বই"
    assert pcex_cover(pcex) is not None

    built = convert_pcex(
        pcex,
        pdf_sha="a" * 64,
        pdf_pages=3,
        pdf_bytes=1234,
        title="নমুনা বই",
        author="একজন লেখক",
        cover_mode="original",
        cover_reason="test cover",
        ocr_model="pdf-craft/tesseract",
    )

    assert [s.id for s in built.sections] == ["title", "c001", "c002", "colophon"]
    chapter = built.sections[1]
    assert chapter.label == "অধ্যায় এক"
    assert 'id="page-2"' in chapter.xhtml
    assert 'epub:type="pagebreak"' in chapter.xhtml
    assert "<strong>গুরুত্বপূর্ণ</strong>" in chapter.xhtml
    assert 'class="noteref"' in chapter.xhtml
    assert 'id="fn-c001-1"' in chapter.xhtml
    assert "টীকা পাঠ" in chapter.xhtml
    assert "<figure" in chapter.xhtml
    assert "চিত্রের ক্যাপশন" in chapter.xhtml
    assert built.sections[2].label == "অধ্যায় দুই"

    assert built.toc[0]["label"] == "অধ্যায় এক"
    assert built.toc[0]["children"][0]["label"] == "অধ্যায় দুই"
    assert built.page_list[0] == {"label": "২", "href": "c001.xhtml#page-2"}
    assert built.report["stats"]["figures"] == 1
    assert built.report["stats"]["footnotes"] == 1
    assert built.report["pipeline"]["name"] == "pdf-craft"
    assert built.cover["kind"] == "original"


def test_redundant_title_page_is_dropped(tmp_path):
    built = convert_pcex(
        make_pcex(tmp_path),
        pdf_sha="b" * 64,
        pdf_pages=3,
        pdf_bytes=1234,
        title="নমুনা বই",
        author="একজন লেখক",
    )
    assert all(s.id != "front" for s in built.sections)


def test_head_only_extraction_becomes_body(tmp_path):
    path = tmp_path / "head-only.pcex"
    head = """<?xml version="1.0" encoding="UTF-8"?>
<chapter level="0"><body>
  <paragraph ref="text" level="0"><block page_index="1" order="0" det="0,0,10,10">একটি ছোট বইয়ের সম্পূর্ণ পাঠ।</block></paragraph>
</body></chapter>"""
    manifest = {
        "format_version": 1,
        "producer": {"name": "pdf-craft", "version": "test"},
        "created_at": "2026-01-01T00:00:00+00:00",
        "document": {"title": "ছোট বই", "authors": ["লেখক"], "language": "bn"},
    }
    pages = """<?xml version="1.0" encoding="UTF-8"?>
<pages index_base="1" coordinate_space="ocr_pixels" render_dpi="300">
  <page index="1" width="400" height="600"/>
</pages>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("pages.xml", pages)
        archive.writestr("chapters/chapter_head.xml", head)

    built = convert_pcex(
        path,
        pdf_sha="c" * 64,
        pdf_pages=1,
        pdf_bytes=1,
        title="ছোট বই",
        author="লেখক",
    )
    assert [s.id for s in built.sections] == ["title", "c001", "colophon"]
    assert built.toc == [{"label": "মূল পাঠ", "href": "c001.xhtml"}]
    assert built.page_list == [{"label": "১", "href": "c001.xhtml#page-1"}]
