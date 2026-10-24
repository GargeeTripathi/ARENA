GEN_SYSTEM = "You write test questions for evaluating a document question-answering system. You output JSON only."

ANSWERABLE = """Read the passage and write test questions that can be answered ONLY from this passage.

Write {n_single} "single_hop" questions (a fact stated in one place: a name, rule, date, place, condition) and \
{n_numeric} "numeric" questions (the answer is a number, amount, percentage, duration or quantity stated in the passage). \
Skip a type if the passage has nothing suitable.

Rules:
- Each question must make sense on its own: name the organisation or product, never say "the passage" or "the document".
- Do NOT copy long phrases from the passage into the question; rephrase it.
- "answer" is short (a few words or one sentence).
- "evidence" is the exact sentence or table row from the passage that contains the answer, copied character for character.

Passage (from "{doc_name}"):
\"\"\"
{text}
\"\"\"

Return JSON: {{"questions": [{{"qtype": "single_hop" or "numeric", "question": "...", "answer": "...", "evidence": "..."}}]}}"""

UNANSWERABLE = """Below is an excerpt from "{doc_name}". Write {n} questions that a real reader of this document might \
plausibly ask, about the same organisation/product and topic, but whose answer is NOT given anywhere in the excerpt. \
Good examples ask for a specific detail that sounds like it should be there but is missing. \
Each question must make sense on its own (name the organisation or product).

Excerpt:
\"\"\"
{text}
\"\"\"

Return JSON: {{"questions": ["...", "..."]}}"""

ANSWERABILITY = """Can the question be answered from the passages below alone (no outside knowledge)?

Question: {question}

Passages:
{passages}

Return JSON: {{"answerable": true or false, "reason": "one short sentence"}}"""

CORRECTNESS = """Decide if the candidate answer is correct, given the reference answer.
The candidate is correct if it states the same key facts/numbers as the reference (wording may differ; extra detail is fine \
unless it contradicts the reference). It is incorrect if it is wrong, missing the key fact, or says it doesn't know.

Question: {question}
Reference answer: {gold}
Candidate answer: {answer}

Return JSON: {{"correct": true or false, "reason": "one short sentence"}}"""
