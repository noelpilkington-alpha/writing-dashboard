"""Year-scoped metrics: starting HMG and S1 cohort membership."""
from __future__ import annotations

import re

from writing_automation.calendars import session_for_date

_GRADE_RE = re.compile(r"G(\d+)")


def _grade(test: dict) -> int | None:
    m = _GRADE_RE.search(test.get("name", ""))
    return int(m.group(1)) if m else None


def hmg_from_tests(tests: list[dict]) -> int:
    """Highest grade with a passed Writing test; 2 = pre-G3 baseline."""
    hmg = 2
    for t in tests:
        if t.get("passed"):
            g = _grade(t)
            if g is not None and g > hmg:
                hmg = g
    return hmg


def _placement_contiguous(passed_grades: set[int]) -> int:
    hmg = 2
    for g in range(3, 9):
        if g in passed_grades:
            hmg = g
        else:
            break
    return hmg


def compute_starting_hmg(api_tests: list[dict], *, mode: str, year_start: str) -> tuple[int, str]:
    """Return (starting_hmg, basis).

    mode == "placement" (SY25-26 archive rule): contiguous passed placement grades from G3.
    mode == "year": max(HMG over tests dated before year_start, highest passed placement grade
    at any date). basis is "prior_year_tests", "placement" or "default".
    """
    placements = {g for g in (_grade(t) for t in api_tests
                              if t.get("test_type") == "placement" and t.get("passed")) if g is not None}
    if mode == "placement":
        hmg = _placement_contiguous(placements)
        return hmg, ("placement" if hmg > 2 else "default")
    prior = hmg_from_tests([t for t in api_tests if (t.get("date") or "") < year_start])
    placement_max = max(placements) if placements else 2
    if placement_max > prior:
        return placement_max, "placement"
    if prior > 2:
        return prior, "prior_year_tests"
    return 2, "default"


def is_s1_cohort(first_xp_date: str | None, year: str, calendar_key: str) -> bool | None:
    """True when the student's first XP of the year falls in S1 of their calendar."""
    if not first_xp_date:
        return None
    return session_for_date(year, calendar_key, first_xp_date) == "S1"
