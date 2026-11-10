from __future__ import annotations

import argparse
import hashlib

from pdf2epub import cli


def _args(**overrides):
    values = {
        "engine": "tesseract",
        "tesseract": "tesseract",
        "tessdata": None,
        "json": True,
        "strict": True,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def test_version_tuple():
    assert cli._version_tuple("5.5.3") == (5, 5, 3)
    assert cli._version_tuple("surya-ocr 0.22.1") == (0, 22, 1)


def test_check_ocr_accepts_pinned_best(tmp_path, monkeypatch):
    traineddata = tmp_path / "ben.traineddata"
    traineddata.write_bytes(b"best")
    digest = hashlib.md5(b"best").hexdigest()
    monkeypatch.setattr(cli, "TESSDATA_BEST_MD5", digest)
    monkeypatch.setattr(cli, "TESSDATA_FAST_MD5", "unused")

    class Result:
        stdout = "tesseract 5.5.3\n"

    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **k: Result())
    assert cli._check_ocr(_args(tessdata=tmp_path)) == 0


def test_check_ocr_rejects_fast_model(tmp_path, monkeypatch):
    traineddata = tmp_path / "ben.traineddata"
    traineddata.write_bytes(b"fast")
    digest = hashlib.md5(b"fast").hexdigest()
    monkeypatch.setattr(cli, "TESSDATA_BEST_MD5", "unused")
    monkeypatch.setattr(cli, "TESSDATA_FAST_MD5", digest)

    class Result:
        stdout = "tesseract 5.5.3\n"

    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **k: Result())
    assert cli._check_ocr(_args(tessdata=tmp_path)) == 1
