from writing_automation import test_fetcher as tf


def test_question_helpers_tolerate_null_question():
    # timebackanalytics test pages can contain {"question": null, "response": {...}}
    assert tf._extract_question_prompt(None) == ""
    assert tf._get_max_score(None) == 1.0
    assert tf._extract_question_prompt({}) == ""


def test_question_helpers_normal_path():
    q = {"title": "Fallback title", "content": {"qti-assessment-item": {"qti-item-body": {"qti-prompt": {"_": "Combine the sentences."}}}}}
    assert tf._extract_question_prompt(q) == "Combine the sentences."
    assert tf._extract_question_prompt({"title": "Only title"}) == ""
