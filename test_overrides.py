"""Manual test overrides.

``test_overrides.json`` lists test attempts that must not count toward HMG, deep
dives or session tests regardless of what the API says (e.g. a cheating run that
has not yet been invalidated upstream). Each entry covers one student and an
inclusive range of test ids:

    {"invalidated_tests": [
      {"email": "student@alpha.school", "from": "G4.1", "to": "G8.1",
       "reason": "Cheating on 2026-09-24 placement run; invalidated per Noel 2026-09-25"}
    ]}

Test ids are compared as (grade, sequence) tuples, so "G4.1".."G8.1" covers G4.x,
G5.x, G6.x, G7.x and G8.1.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_GRADE_SUB_RE = re.compile(r"G(\d+)\.(\d+)")


def parse_test_id(name: str) -> tuple[int, int] | None:
    m = _GRADE_SUB_RE.search(name or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def in_range(test_name: str, frm: str, to: str) -> bool:
    tid, lo, hi = parse_test_id(test_name), parse_test_id(frm), parse_test_id(to)
    if tid is None or lo is None or hi is None:
        return False
    return lo <= tid <= hi


def load_overrides(path: str | Path) -> list[dict]:
    """Return the invalidated-test entries (emails lower-cased); [] when the file is absent."""
    path = Path(path)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for e in data.get("invalidated_tests", []):
        out.append({**e, "email": (e.get("email") or "").strip().lower()})
    return out


def _matching(test_name: str, email: str, overrides: list[dict]) -> dict | None:
    email = (email or "").lower()
    for o in overrides:
        if o["email"] == email and in_range(test_name, o.get("from", ""), o.get("to", "")):
            return o
    return None


def filter_invalidated_tests(tests: list[dict], email: str, overrides: list[dict]) -> tuple[list[dict], list[str]]:
    """Split API test dicts (with a 'name' key) into (kept, names_of_removed)."""
    if not overrides:
        return tests, []
    kept, removed = [], []
    for t in tests:
        if _matching(t.get("name", ""), email, overrides):
            removed.append(t.get("name", ""))
        else:
            kept.append(t)
    return kept, removed


def filter_invalidated_csv_rows(rows: list, overrides: list[dict]) -> list:
    """Drop CSV WritingResult rows (attributes student_email, test_name) that are invalidated."""
    if not overrides:
        return rows
    return [r for r in rows if not _matching(r.test_name, r.student_email, overrides)]


def reasons_for(email: str, overrides: list[dict]) -> list[str]:
    email = (email or "").lower()
    return [f"{o.get('from')}–{o.get('to')}: {o.get('reason', 'invalidated')}" for o in overrides if o["email"] == email]
