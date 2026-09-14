import csv
from pathlib import Path

import roster

HEADER = ["Student Alpha Email", "Admission Status", "Student Group", "Campus", "Current Level",
          "Current Grade Level", "Full Name", "is_test", "Advisor"]


def _write(tmp_path: Path, rows: list[list[str]]) -> Path:
    p = tmp_path / "roster.csv"
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    return p


def test_parse_groups_splits_and_lowercases():
    assert roster.parse_groups("shadow, School_Year_2026_2027, test-record") == {"shadow", "school_year_2026_2027", "test-record"}
    assert roster.parse_groups("") == set()


def test_is_excluded_row_by_token_and_is_test():
    assert roster.is_excluded_row({"Student Group": "Shadow", "is_test": "FALSE"})
    assert roster.is_excluded_row({"Student Group": "school_year_2026_2027, test-record", "is_test": "FALSE"})
    assert roster.is_excluded_row({"Student Group": "school_year_2026_2027", "is_test": "TRUE"})
    assert not roster.is_excluded_row({"Student Group": "school_year_2026_2027", "is_test": "FALSE"})
    assert not roster.is_excluded_row({"Student Group": "Budapest Alpha, school_year_2026_2027", "is_test": ""})


def test_load_roster_requires_group_token_when_given(tmp_path):
    p = _write(tmp_path, [
        ["a@x.com", "Enrolled", "school_year_2026_2027", "Alpha Austin", "MS", "7", "A Student", "FALSE", "Adv One"],
        ["b@x.com", "Enrolled", "", "Alpha Austin", "MS", "7", "B Student", "FALSE", ""],
        ["c@x.com", "Enrolled", "shadow, school_year_2026_2027", "Alpha Austin", "MS", "7", "C Student", "FALSE", ""],
        ["d@x.com", "Pending Review", "school_year_2026_2027", "Alpha Austin", "MS", "7", "D Student", "FALSE", ""],
    ])
    r = roster.load_roster(p, require_group_token="school_year_2026_2027")
    assert set(r) == {"a@x.com"}
    assert r["a@x.com"] == {"campus": "Alpha Austin", "level": "MS", "grade": "7", "name": "A Student",
                            "group": "school_year_2026_2027", "advisor": "Adv One"}


def test_load_roster_without_token_keeps_all_enrolled(tmp_path):
    p = _write(tmp_path, [
        ["a@x.com", "Enrolled", "", "Novatio", "L2", "4", "A", "FALSE", ""],
        ["b@x.com", "Enrolled", "Mock", "Novatio", "L2", "4", "B", "FALSE", ""],
    ])
    assert set(roster.load_roster(p, require_group_token=None)) == {"a@x.com"}


def test_status_override_admits_non_enrolled(tmp_path):
    email = next(iter(roster.STATUS_OVERRIDES))
    p = _write(tmp_path, [[email, "Former Student", "school_year_2026_2027", "Alpha Austin", "MS", "7", "X", "FALSE", ""]])
    assert email in roster.load_roster(p, require_group_token="school_year_2026_2027")


def test_classify_dashboard_legacy_campuses_are_timeback_now():
    assert roster.classify_dashboard("Novatio") == "timeback"
    assert roster.classify_dashboard("Alpha Anywhere (homeschool)") == "timeback"
    assert roster.classify_dashboard("Guide School") == ""
    assert roster.classify_dashboard("High School SAT Prep") == ""
