from datetime import date

import pytest

from writing_automation import calendars as cal
from writing_automation.config import SCHOOL_YEARS, CURRENT_YEAR


def test_current_year_is_2026_27():
    assert CURRENT_YEAR == "2026-27"
    assert set(SCHOOL_YEARS) == {"2025-26", "2026-27"}


def test_expand_holidays_handles_ranges_and_singles():
    days = cal.expand_holidays(["2026-09-07", "2026-11-23..2026-11-27"])
    assert date(2026, 9, 7) in days
    assert date(2026, 11, 25) in days
    assert len(days) == 6


@pytest.mark.parametrize("key,d,expected", [
    ("A", "2026-08-12", "S1"), ("A", "2026-10-09", "S1"), ("A", "2026-10-12", None),
    ("A", "2026-10-19", "S2"), ("A", "2027-03-01", "S4"), ("A", "2027-06-04", "S5"),
    ("B", "2026-09-08", "S1"), ("B", "2026-08-20", None), ("B", "2027-02-24", "S4"),
    ("B", "2027-06-18", "S5"),
])
def test_session_for_date_2026_27(key, d, expected):
    assert cal.session_for_date("2026-27", key, d) == expected


@pytest.mark.parametrize("d,expected", [
    ("2025-08-11", "S1"), ("2025-08-01", "S1"),        # gap rule: before 2025-10-18 -> S1
    ("2025-10-18", "S2"), ("2025-10-19", "S2"),        # gap rule
    ("2026-04-20", "S5"),                              # gap rule: 04-18..04-26 -> S5
    ("2026-02-21", "S4"), ("2026-06-06", None),
])
def test_session_for_date_2025_26_gap_rules(d, expected):
    assert cal.session_for_date("2025-26", "default", d) == expected


def test_current_session_in_gap_returns_latest_started():
    assert cal.current_session("2026-27", "A", "2026-10-14") == "S1"
    assert cal.current_session("2026-27", "A", "2026-09-14") == "S1"
    assert cal.current_session("2026-27", "B", "2026-08-20") == "S1"   # before first day -> first session
    assert cal.current_session("2026-27", "A", "2026-12-28") == "S2"


def test_school_days_excludes_weekends_breaks_and_holidays():
    # Calendar A, Aug 12 (Wed) .. Sep 11 (Fri): weekdays = 23, minus Labor Day Sep 7 = 22
    assert cal.school_days("2026-27", "A", "2026-08-12", "2026-09-11") == 22
    # Calendar B has not started yet on Sep 4
    assert cal.school_days("2026-27", "B", "2026-08-12", "2026-09-04") == 0
    # Break Oct 12-16 does not count
    assert cal.school_days("2026-27", "A", "2026-10-09", "2026-10-19") == 2
    # end before start
    assert cal.school_days("2026-27", "A", "2026-09-10", "2026-09-01") == 0


def test_school_days_2025_26_matches_weekday_counting_inside_session():
    # S4 school_start 2026-03-02 (Mon) .. 2026-03-13 (Fri) = 10 weekdays
    assert cal.school_days("2025-26", "default", "2026-03-02", "2026-03-13") == 10


def test_sessions_with_labels():
    s = cal.sessions_with_labels("2026-27", "B")
    assert s["S1"] == {"start": "2026-09-08", "end": "2026-10-16", "label": "Session 1"}


@pytest.mark.parametrize("campus,expected", [
    ("Alpha School Austin", "A"), ("Alpha Austin", "A"), ("Alpha Austin High School", "A"),
    ("Alpha School Miami", "A"), ("Alpha Miami Beach", "B"),
    ("Alpha School Santa Barbara", "B"), ("Alpha School Chicago", "B"), ("Alpha Boca Raton", "B"),
    ("Alpha Greenwich - Armonk", "B"), ("Alpha School Kirkland", "B"), ("Alpha South Bay", "B"),
    ("Alpha The Woodlands", "A"), ("Alpha School East Bay", "A"), ("Alpha Highland Park", "A"),
    ("Alpha School Nashville", "A"), ("Alpha Anywhere Center", "B"), ("Alpha Anywhere Center - Founders", "A"),
    ("Alpha Anywhere (homeschool)", "A"), ("TSA Online", "A"), ("TSA Football - Carrollton", "A"),
    ("GT Anywhere", "A"), ("GT School", "A"), ("Unbound Academy", "A"), ("Novatio", "A"),
    ("Montessorium Cedar Park", "A"), ("Nova Academy Bastrop", "A"), ("Alpha School Lake Forest", "A"),
    ("JHMS - Hardeeville Junior Senior High School", "A"),   # unknown -> default A
])
def test_resolve_calendar_2026_27(campus, expected):
    assert cal.resolve_calendar("2026-27", campus) == expected


def test_resolve_calendar_2025_26_single_calendar():
    assert cal.resolve_calendar("2025-26", "Anything") == "default"
    assert cal.calendar_keys("2025-26") == ["default"]
