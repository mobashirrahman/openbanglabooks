"""Conservative text normalisation.

Nothing here tries to *correct* Bengali spelling or OCR confusions: that is a
review job. We only remove artefacts that are unambiguously not part of the
book (soft hyphens, stray zero-width spaces, whitespace around the danda) and
join words that a PDF line break split.
"""

from __future__ import annotations

import re
import unicodedata

_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
_BN_DIGITS_REV = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

# Keep ZWJ/ZWNJ: Bengali orthography uses them for conjuncts.
_INVISIBLE = dict.fromkeys(map(ord, "\u00ad\u200b\u2060\ufeff"), None)

_WS = re.compile(r"[ \t\u00a0\u2000-\u200a\u202f\u205f\u3000]+")
_HYPHEN_BREAK = re.compile(r"(?<=[A-Za-z\u00c0-\u024f])-\s*\n\s*(?=[a-z\u00df-\u00ff])")
_LINE_BREAK = re.compile(r"\s*\n\s*")


def normalise_text(value: str) -> str:
    value = unicodedata.normalize("NFC", value).translate(_INVISIBLE)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = _HYPHEN_BREAK.sub("", value)
    value = _LINE_BREAK.sub(" ", value)
    value = _WS.sub(" ", value)
    return value.strip()


def normalise_html_text(value: str) -> str:
    """Normalise text inside an HTML fragment without touching tags.

    Whitespace at tag boundaries is preserved as a single space: dropping it
    turns ``word<sup>1</sup> next`` into ``word<sup>1</sup>next``.
    """
    parts = re.split(r"(<[^>]+>)", value)
    out: list[str] = []
    for part in parts:
        if part.startswith("<"):
            out.append(part)
            continue
        if not part:
            continue
        normalised = normalise_text(part)
        leading = bool(part[:1].isspace())
        trailing = bool(part[-1:].isspace())
        if not normalised:
            if out:
                out.append(" ")
            continue
        if leading and out and not out[-1].endswith(" "):
            out.append(" ")
        out.append(normalised)
        if trailing:
            out.append(" ")
    return re.sub(r" {2,}", " ", "".join(out))


def tidy_bengali(text: str) -> str:
    """Remove spaces OCR often inserts before Bengali punctuation."""
    text = re.sub(r"\s+([।॥])", r"\1", text)
    text = re.sub(r"([।॥])(?=[^\s<।॥])", r"\1 ", text)
    text = re.sub(r"[ \t]+([,;:!?])", r"\1", text)
    text = re.sub(r"([,;:!?])(?=[^\s<])", r"\1 ", text)
    return text


def bn_digits(value: int | str) -> str:
    return str(value).translate(_BN_DIGITS)


def ascii_digits(value: str) -> str:
    return value.translate(_BN_DIGITS_REV)


def word_count(text: str) -> int:
    return len(re.findall(r"[\w\u0980-\u09ff]+", text, flags=re.UNICODE))


def slugify(value: str, fallback: str = "book") -> str:
    """ASCII, filesystem-safe slug. Bengali titles fall back to a hash by caller."""
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:60] or fallback


def short(text: str, limit: int = 80) -> str:
    text = normalise_text(text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def is_page_number(text: str) -> bool:
    text = normalise_text(text)
    if not text:
        return False
    text = ascii_digits(text)
    return bool(re.fullmatch(r"[-–—\s]*\d{1,4}[-–—\s]*", text))
