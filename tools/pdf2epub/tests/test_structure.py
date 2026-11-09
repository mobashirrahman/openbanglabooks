from __future__ import annotations

import re

from pdf2epub.htmlclean import clean_fragment
from pdf2epub.model import Block, PageContent
from pdf2epub.structure import build_book
from pdf2epub.textlayer import order_blocks
from pdf2epub.textnorm import is_page_number, normalise_text


def block(page: int, text: str, kind: str = "text", html: str = "", y: float = 100) -> Block:
    return Block(
        page=page,
        bbox=(54.0, y, 378.0, y + 14.0),
        kind=kind,
        html=html or f"<p>{text}</p>",
        text=text,
    )


def page(index: int, *blocks: Block, printed: str | None = None) -> PageContent:
    return PageContent(
        index=index,
        width=432,
        height=648,
        blocks=list(blocks),
        source="text",
        printed_number=printed,
    )


def book(pages: list[PageContent], **overrides):
    return build_book(
        pages,
        pdf_sha="a" * 64,
        title="নমুনা বই",
        author="একজন লেখক",
        **overrides,
    )


def test_title_page_is_dropped_and_chapters_split():
    cover = Block(page=0, bbox=(54, 54, 378, 600), kind="figure")
    pages = [
        page(0, cover),
        page(
            1,
            block(1, "নমুনা বই", "heading1", y=80),
            block(1, "একজন লেখক", y=120),
        ),
        page(
            2,
            block(2, "অধ্যায় ১", "heading1", y=80),
            block(2, "প্রথম অধ্যায়ের লেখা। " * 12, y=140),
        ),
        page(
            3,
            block(3, "অধ্যায় ২", "heading1", y=80),
            block(3, "দ্বিতীয় অধ্যায়ের লেখা।", y=140),
        ),
    ]
    built = book(pages)
    labels = [s.label for s in built.sections]
    assert "নমুনা বই" not in labels
    assert [s.id for s in built.sections if re.fullmatch(r"c\d{3}", s.id)] == ["c001", "c002"]
    assert built.sections[-1].id == "colophon"


def test_dedication_is_kept_as_front_matter():
    pages = [
        page(
            1,
            block(1, "উৎসর্গ", "heading1", y=80),
            block(1, "আমার মা", y=140),
        ),
        page(
            2,
            block(2, "অধ্যায় ১", "heading1", y=80),
            block(2, "প্রথম অধ্যায়ের লেখা।", y=140),
        ),
    ]
    built = book(pages)
    assert "উৎসর্গ" in [s.label for s in built.sections]


def test_short_preface_is_kept_as_front_matter():
    pages = [
        page(
            1,
            block(1, "ভূমিকা", "heading1", y=80),
            block(1, "এই সংস্করণে বানান ও যুক্তিবিন্যাস পরিমার্জিত হয়েছে।", y=140),
        ),
        page(
            2,
            block(2, "অধ্যায় ১", "heading1", y=80),
            block(2, "প্রথম অধ্যায়ের লেখা।", y=140),
        ),
    ]
    built = book(pages)
    labels = [s.label for s in built.sections]
    assert "ভূমিকা" in labels
    assert built.sections[1].epub_type == "frontmatter"


def test_footnote_reference_is_linked_inside_the_paragraph():
    pages = [
        page(
            1,
            block(1, "অধ্যায় ১", "heading1", y=80),
            block(1, "লেখা চলছে।", html="<p>লেখা চলছে।<sup>1</sup></p>", y=140),
            block(1, "১ টীকা", "footnote", html="<p>১ টীকা</p>", y=600),
        )
    ]
    built = book(pages)
    chapter = next(s for s in built.sections if s.id == "c001")
    assert '<a class="noteref" id="fnref-c001-1" href="#fn-c001-1"><sup>1</sup></a>' in chapter.xhtml
    assert 'id="fn-c001-1"' in chapter.xhtml
    assert chapter.xhtml.count("<p>") == chapter.xhtml.count("</p>")


def test_part_headings_nest_the_toc():
    pages = [
        page(
            1,
            block(1, "প্রথম খণ্ড", "heading1", y=60),
            block(1, "অধ্যায় ১", "heading1", y=120),
            block(1, "অধ্যায়ের লেখা। " * 14, y=180),
            block(1, "অধ্যায় ২", "heading1", y=400),
            block(1, "আরও লেখা।", y=460),
        )
    ]
    built = book(pages)
    assert any(s.id == "part-001" and s.epub_type == "part" for s in built.sections)
    chapter = next(s for s in built.sections if s.id == "c001")
    assert '<h1 class="part">' not in chapter.xhtml
    assert built.toc[0]["href"] == "part-001.xhtml"
    assert built.toc[0]["label"] == "প্রথম খণ্ড"
    assert [c["label"] for c in built.toc[0]["children"]] == ["অধ্যায় ১", "অধ্যায় ২"]


def test_running_heads_and_page_numbers_are_removed():
    pages = [
        page(
            i,
            block(i, "বইয়ের নাম", "header", y=20),
            block(i, f"পৃষ্ঠা {i} এর লেখা।", y=100),
            block(i, str(i + 1), "page-number", y=630),
        )
        for i in range(4)
    ]
    built = book(pages)
    text = " ".join(s.xhtml for s in built.sections)
    assert "বইয়ের নাম" not in text
    assert built.report["stats"]["dropped_running_heads"] >= 8


def test_clean_fragment_keeps_inline_markup_in_one_paragraph():
    out = clean_fragment("লেখা<sup>1</sup> আরও")
    assert out == "<p>লেখা<sup>1</sup> আরও</p>"


def test_clean_fragment_accepts_nested_lists_and_rejects_remote_images():
    assert clean_fragment("<ul><li>এক</li><li>দুই</li></ul>").startswith("<ul>")
    assert "<img" not in clean_fragment('<img src="https://evil.example/x.png" alt="x"/>')


def test_text_normalisation_and_page_numbers():
    assert normalise_text("লেখা   চলছে।\nআরও") == "লেখা চলছে। আরও"
    assert is_page_number(" ১২ ")
    assert is_page_number("– 42 –")
    assert not is_page_number("১২ জন")


def test_order_blocks_reads_two_columns_left_then_right():
    def b(x0: float, y0: float) -> Block:
        return Block(page=0, bbox=(x0, y0, x0 + 190, y0 + 20), kind="text", text="")

    heading = Block(page=0, bbox=(54, 20, 466, 40), kind="heading1", text="শিরোনাম")
    left1, left2 = b(54, 100), b(54, 200)
    right1, right2 = b(276, 100), b(276, 200)
    ordered = order_blocks([right1, left2, heading, right2, left1], 500, 700)
    assert ordered == [heading, left1, left2, right1, right2]


def test_order_blocks_keeps_single_column_top_to_bottom():
    def b(y0: float) -> Block:
        return Block(page=0, bbox=(54, y0, 466, y0 + 20), kind="text", text="")

    first, second, third = b(100), b(200), b(300)
    assert order_blocks([third, first, second], 500, 700) == [first, second, third]
