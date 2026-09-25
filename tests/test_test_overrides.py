import json
from types import SimpleNamespace

import test_overrides as to

OVR = [{"email": "reznor.sacks@alpha.school", "from": "G4.1", "to": "G8.1", "reason": "cheating"}]


def t(name):
    return {"name": f"Alpha Standardized Writing {name}", "passed": True}


def test_in_range_is_inclusive_on_grade_and_sequence():
    assert to.in_range("Alpha Standardized Writing G4.1", "G4.1", "G8.1")
    assert to.in_range("Alpha Standardized Writing G5.1", "G4.1", "G8.1")
    assert to.in_range("Alpha Standardized Writing G8.1", "G4.1", "G8.1")
    assert not to.in_range("Alpha Standardized Writing G3.4", "G4.1", "G8.1")
    assert not to.in_range("Alpha Standardized Writing G8.2", "G4.1", "G8.1")
    assert not to.in_range("Some test without an id", "G4.1", "G8.1")


def test_filter_invalidated_tests_only_affects_named_student():
    tests = [t("G3.4"), t("G4.1"), t("G6.1"), t("G8.1")]
    kept, removed = to.filter_invalidated_tests(tests, "Reznor.Sacks@alpha.school", OVR)
    assert [x["name"][-4:] for x in kept] == ["G3.4"]
    assert removed == ["Alpha Standardized Writing G4.1", "Alpha Standardized Writing G6.1", "Alpha Standardized Writing G8.1"]
    kept2, removed2 = to.filter_invalidated_tests(tests, "someone.else@alpha.school", OVR)
    assert kept2 == tests and removed2 == []
    assert to.filter_invalidated_tests(tests, "reznor.sacks@alpha.school", []) == (tests, [])


def test_filter_csv_rows():
    rows = [SimpleNamespace(student_email="reznor.sacks@alpha.school", test_name="Alpha Standardized Writing G5.1"),
            SimpleNamespace(student_email="reznor.sacks@alpha.school", test_name="Alpha Standardized Writing G3.3"),
            SimpleNamespace(student_email="other@alpha.school", test_name="Alpha Standardized Writing G5.1")]
    kept = to.filter_invalidated_csv_rows(rows, OVR)
    assert [(r.student_email[:6], r.test_name[-4:]) for r in kept] == [("reznor", "G3.3"), ("other@", "G5.1")]


def test_load_overrides_and_reasons(tmp_path):
    assert to.load_overrides(tmp_path / "missing.json") == []
    p = tmp_path / "o.json"
    p.write_text(json.dumps({"invalidated_tests": [{"email": "A@B.com", "from": "G4.1", "to": "G8.1", "reason": "x"}]}))
    ovr = to.load_overrides(p)
    assert ovr[0]["email"] == "a@b.com"
    assert to.reasons_for("a@b.com", ovr) == ["G4.1–G8.1: x"]
    assert to.reasons_for("nobody@b.com", ovr) == []
