from app.generator.filters import leaks
from app.generator.generate import gold_chunk_ids_for, locate
from app.ingest.chunker import chunk_pages
from app.ingest.parser import Page
from app.lenses.answer_check import is_abstention
from app.schemas import Chunk, TestQuestion

PAGE = ("Attendance is recorded in every lecture. A student must maintain at least 78 percent attendance "
        "in each course to sit the exam.\n| Item | Amount |\n|---|---|\n| Late registration fee | 2,500 |\n")


def _chunk(text=PAGE, start=0):
    return Chunk(chunk_id="c0", doc_id="d", doc_name="d.md", page=1, text=text, start=start, end=start + len(text))


def test_leakage():
    src = "A student must maintain at least 78 percent attendance in each course to sit the exam."
    assert leaks("Is it true a student must maintain at least 78 percent attendance in each course?", src)
    assert not leaks("What attendance share do students need before end-semester exams?", src)


def test_locate_exact_flexible_and_fuzzy():
    c = _chunk()
    s, e = locate("A student must maintain at least 78 percent attendance in each course to sit the exam.", c)
    assert c.text[s:e].startswith("A student must")
    s, e = locate("A student  must maintain\nat least 78 percent", c)  # whitespace differs
    assert "78 percent" in c.text[s:e]
    s, e = locate("Late registration fee 2,500", c)  # table row without pipes
    assert "Late registration fee" in c.text[s:e] and "Attendance" not in c.text[s:e]
    assert locate("Something totally unrelated here", c) is None


def test_gold_remaps_across_chunk_sizes():
    text = " ".join(f"w{i}" for i in range(300)) + " The fee is 2,500 rupees. " + " ".join(f"x{i}" for i in range(300))
    small = chunk_pages([Page(1, text)], "d", "d.md", 50, 0)
    big = chunk_pages([Page(1, text)], "d", "d.md", 400, 0)
    start = text.index("The fee is")
    q = TestQuestion(qid="q", qtype="numeric", question="?", gold_answer="2,500", gold_chunk_ids=["x"],
                     gold_span={"doc_id": "d", "page": 1, "start": start, "end": start + 24})
    for chunks in (small, big):
        ids = gold_chunk_ids_for(q, chunks)
        assert ids and all("The fee is" in c.text or "2,500" in c.text for c in chunks if c.chunk_id in ids)


def test_abstention_detector():
    assert is_abstention("I don't know.")
    assert is_abstention("The context does not specify the warranty period.")
    assert not is_abstention("The warranty is 2 years.")
