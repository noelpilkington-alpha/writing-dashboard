import collect_loop_data as cl
from test_review_fetcher import SAMPLE


def _student():
    return {
        "all_tests": [
            {"name": "Alpha Standardized Writing G3.4", "date": "2026-09-23", "score": 80, "assignment_id": 198181},
            {"name": "Alpha Standardized Writing G3.3", "date": "2026-09-10", "score": 71, "assignment_id": 190000},
            {"name": "Alpha Standardized Writing G3.2", "date": "2026-09-01", "score": 60},   # no assignment id
        ],
        "deep_dive": {"details": [{"grade": 3, "tests": [
            {"name": "Alpha Standardized Writing G3.4", "date": "2026-09-23", "score": 80, "rushed": True},
            {"name": "Alpha Standardized Writing G3.3", "date": "2026-09-10", "score": 71, "rushed": False},
            {"name": "Alpha Standardized Writing G3.2", "date": "2026-09-01", "score": 60, "rushed": False},
        ]}]},
    }


def test_fetch_and_parse_student_tests_uses_review_api_and_skips_unavailable(monkeypatch):
    seen = []

    def fake_fetch(aid, score=None, score_date=None, scope="incorrect"):
        seen.append((aid, score, score_date))
        return SAMPLE if aid == 198181 else None     # 190000 -> invalidated/unavailable

    monkeypatch.setattr(cl, "fetch_review", fake_fetch)
    parsed = cl.fetch_and_parse_student_tests(_student())
    assert seen == [(198181, 80, "2026-09-23"), (190000, 71, "2026-09-10")]
    assert len(parsed) == 1
    t = parsed[0]
    assert t["grade"] == 3 and t["csv_score"] == 80 and t["csv_date"] == "2026-09-23" and t["rushed"] is True
    assert t["source"] == "review_api" and t["questions"][0]["feedback"].startswith("Change the verb")


def test_build_test_analysis_data_keeps_header_total_and_feedback(monkeypatch):
    monkeypatch.setattr(cl, "fetch_review", lambda aid, **kw: SAMPLE)
    parsed = cl.fetch_and_parse_student_tests(_student())
    data = cl.build_test_analysis_data(parsed)
    assert data[0]["total_questions"] == 11            # from the review header, not the incorrect-only list
    assert len(data[0]["incorrect_questions"]) == 2
    assert data[0]["questions"][0]["feedback"].startswith("Change the verb")
    prompt = cl.build_student_analysis_prompt({"name": "A Student", "hmg": 3, "level": "Sentences", "effective_grade": 3,
                                               "campus": "X", "total_failed_tests": 2, "total_rushed": 1}, data, [])
    assert "Grader feedback: Change the verb" in prompt
