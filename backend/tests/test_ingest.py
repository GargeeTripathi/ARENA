import pymupdf
import pytest

from app.ingest.chunker import chunk_pages
from app.ingest.parser import Page, ParseError, parse


def test_chunk_size_overlap_and_offsets():
    text = " ".join(f"w{i}" for i in range(100))
    chunks = chunk_pages([Page(1, text)], "d", "d.txt", size=30, overlap=10)
    assert all(len(c.text.split()) == 30 for c in chunks[:-1])
    assert chunks[0].text.split()[-10:] == chunks[1].text.split()[:10]  # overlap
    for c in chunks:
        assert text[c.start : c.end] == c.text  # offsets point back into the page
    assert chunks[-1].text.endswith("w99")


def test_tables_split_on_rows_and_flagged():
    table = "| a | b |\n|---|---|\n" + "".join(f"| r{i} | {i} |\n" for i in range(20))
    chunks = chunk_pages([Page(1, "intro text", [table])], "d", "d.pdf", size=20, overlap=0)
    tbl = [c for c in chunks if c.is_table]
    assert len(tbl) > 1 and all(c.text.endswith("|\n") for c in tbl)
    assert not chunks[0].is_table


def test_empty_and_scanned_pdf_raise_clear_error(tmp_path):
    p = tmp_path / "empty.pdf"
    doc = pymupdf.open()
    doc.new_page()  # a page with no text == what a scanned PDF looks like to us
    doc.save(p)
    with pytest.raises(ParseError, match="no extractable text"):
        parse(p)


def test_unsupported_type(tmp_path):
    p = tmp_path / "x.xlsx"
    p.write_bytes(b"x")
    with pytest.raises(ParseError):
        parse(p)
