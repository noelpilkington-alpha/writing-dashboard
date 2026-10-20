import json

import requests

from writing_automation import review_fetcher as rf

SAMPLE = """# Assessment review: Alpha Standardized Writing G3.4

- Assignment ID: 198181
- Assessment identifier: _68c0c86999e7c70fcc0dd264
- Subject: Writing
- Grade: Third Grade
- Overall score recorded: 80%
- Questions in the assessment: 11 (partially correct: 5, correct: 6)
- Scope of this document: 5 of 11 questions (scope: incorrect)
- Question records: 5 AI-written (model claude-opus-5-5)

---

## How to read this document
Legend text.

---

## Questions in this document

| Question | Type | Status | Recorded result |
| --- | --- | --- | --- |
| 1 | Extended text | PARTIALLY CORRECT | Partially correct (0.5 of 1). Score: 1 of 2. |

---

## Stimulus S1: Instructions

### Text (verbatim)

Some passage text.

---

## Question 1 of 11

- Item identifier: _7e563e90
- Status: PARTIALLY CORRECT
- Recorded result: Partially correct (0.5 of 1). Score: 1 of 2.
- Question type: Extended text (written response)
- Uses stimulus: S1 "Instructions"

### How this question works
The screen showed a writing prompt.

### What the student saw
Resource: "Instructions" (Stimulus S1)

Rewrite the sentence below by changing the verb to make the action stronger:

Original: *Layla looked at the flower.*

[Text box 1]

### Student response
Response text (Text box 1):

> Layla looked at the bright yellow flower moving in the wind.

The student typed the sentence "Layla looked at the bright yellow flower moving in the wind."

Feedback recorded by the grading system: "Change the verb to a more descriptive action word."

### Answer key
The item defines no answer key for this question.

---

## Question 11 of 11

- Item identifier: _abc
- Status: INCORRECT
- Recorded result: Incorrect (0 of 1). Score: 9 of 20.
- Question type: Extended text (written response)

### How this question works
Essay box.

### What the student saw
Write a paragraph about sports.

### Student response
Response text (Text box 1):

> Sports are good.

### Answer key
Rubric text.
"""


def test_parse_review_markdown_shape_and_scores():
    p = rf.parse_review_markdown(SAMPLE)
    assert p["test_name"] == "Alpha Standardized Writing G3.4"
    assert p["score"] == 80.0 and p["total_questions"] == 11 and p["source"] == "review_api"
    assert [q["question_number"] for q in p["questions"]] == [1, 11]
    q1, q11 = p["questions"]
    assert q1["correct_fraction"] == 0.5 and q1["max_score"] == 2.0 and q1["actual_score"] == 1.0
    assert q1["question_title"] == "Extended text (written response)"
    assert "Rewrite the sentence" in q1["prompt"] and "Resource:" not in q1["prompt"] and "[Text box 1]" not in q1["prompt"]
    assert q1["student_answer"] == "Layla looked at the bright yellow flower moving in the wind."
    assert q1["feedback"].startswith("Change the verb")
    assert q11["correct_fraction"] == 0.0 and q11["max_score"] == 20.0 and q11["actual_score"] == 9.0
    assert q11["feedback"] == "" and q11["standards"] == []


def test_parse_review_markdown_rejects_non_review():
    assert rf.parse_review_markdown("") is None
    assert rf.parse_review_markdown("# Report in progress\n...") is None


class FakeResp:
    def __init__(self, status, text="", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}


def _setup(monkeypatch, tmp_path, outcomes):
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        o = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
        if isinstance(o, Exception):
            raise o
        return o

    monkeypatch.setattr(rf.requests, "get", fake_get)
    monkeypatch.setattr(rf, "_token", lambda: "tok")
    monkeypatch.setattr(rf.time, "sleep", lambda s: None)
    monkeypatch.setattr(rf, "REVIEW_CACHE_DIR", tmp_path)
    return calls


def test_fetch_review_caches_until_score_changes(monkeypatch, tmp_path):
    calls = _setup(monkeypatch, tmp_path, [FakeResp(200, SAMPLE)])
    assert rf.fetch_review(198181, score=80, score_date="2026-09-23T14:00:00Z") == SAMPLE
    assert rf.fetch_review(198181, score=80, score_date="2026-09-23") == SAMPLE   # same key -> cache
    assert len(calls) == 1
    assert rf.fetch_review(198181, score=91, score_date="2026-09-23") == SAMPLE   # regraded -> refetch
    assert len(calls) == 2
    meta = json.loads((tmp_path / "198181_incorrect.json").read_text(encoding="utf-8"))
    assert meta["status"] == "ok" and meta["key"] == {"score": 91, "score_date": "2026-09-23"}


def test_fetch_review_waits_through_202_then_returns(monkeypatch, tmp_path):
    calls = _setup(monkeypatch, tmp_path, [FakeResp(202, "# Report in progress", {"Retry-After": "1"}), FakeResp(200, SAMPLE)])
    assert rf.fetch_review(1, score=50, score_date="2026-09-01") == SAMPLE
    assert len(calls) == 2


def test_fetch_review_404_is_none_and_remembered(monkeypatch, tmp_path):
    calls = _setup(monkeypatch, tmp_path, [FakeResp(404, '{"code":"ASSIGNMENT_NOT_FOUND"}')])
    assert rf.fetch_review(2, score=100, score_date="2026-09-30") is None
    assert rf.fetch_review(2, score=100, score_date="2026-09-30") is None
    assert len(calls) == 1            # the invalidated marker is cached
    assert rf.fetch_review(3, score=70, score_date="2026-09-30") is None   # 404 again for a new id
    assert len(calls) == 2


def test_fetch_review_409_and_network_error_return_none(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [FakeResp(409, '{"code":"ASSIGNMENT_NOT_COMPLETED"}')])
    assert rf.fetch_review(4, score=None, score_date=None) is None
    _setup(monkeypatch, tmp_path, [requests.ConnectionError("boom")])
    assert rf.fetch_review(5, score=1, score_date=None) is None


MCQ = """# Assessment review: Alpha Standardized Writing G7.5

- Overall score recorded: 83%
- Questions in the assessment: 30 (incorrect: 2)

---

## Question 2 of 30

- Status: INCORRECT
- Recorded result: Incorrect (0 of 1).
- Question type: Multiple choice (single answer)

### What the student saw
Passage: "The Robotics Club That Changed a School" (Stimulus S1)

What type of sentence is the following:

***They did not win, but they earned an award for teamwork.***

### Student response
- B. Imperative

The student selected option B, "Imperative."

### Answer key
- C. Compound
"""


def test_parse_review_markdown_cleans_mcq_restatements():
    q = rf.parse_review_markdown(MCQ)["questions"][0]
    assert q["prompt"].startswith("What type of sentence") and "Stimulus" not in q["prompt"]
    assert q["student_answer"] == "B. Imperative"
    assert q["correct_fraction"] == 0.0 and q["max_score"] == 1.0 and q["actual_score"] == 0.0
