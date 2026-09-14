"""A&D Master Roster loading for the dashboard.

The roster is the population whitelist and the source of truth for campus.
``Student Group`` is a comma-separated tag list (e.g. "shadow, school_year_2026_2027,
test-record"); exclusions are evaluated per token.
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

EXCLUDED_GROUP_TOKENS = {"shadow", "test", "mock", "mock student", "guide", "test-record"}

# Individual student emails to exclude
EXCLUDED_EMAILS = {
    "lincoln.thomas@alpha.school",
    "luka.scaletta@alpha.school",
    "elle.liemandt@alpha.school",
}

# Students whose roster status should be treated as "Enrolled" (e.g. transfers)
STATUS_OVERRIDES = {
    "quinn.oneal@2hourlearning.com",
    "robin.oneal@2hourlearning.com",
    "atlas.kloiber@alpha.school",
    "lincoln.kloiber@alpha.school",
    "eva.quintero@2hourlearning.com",
    "scarlett.oneal@2hourlearning.com",
}

# Campuses excluded from the dashboard entirely
TIMEBACK_EXCLUDED_CAMPUSES = {
    "2 hour learning",
    "2 hour single user",
    "alpha k-8",
    "aie elite prep",
    "alpha austin 25' ai summer camp",
    "alpha international test school",
    "alphalearn",
    "beyond ai",
    "guide school",
    "high school sat prep",
    "mock school org",
    "speedrun",
    "school in the hills",
    "trilogy central support",
    "centner academy",
    "colearn academy",
    "the st. james performance academy",
}


def parse_groups(value: str | None) -> set[str]:
    return {t.strip().lower() for t in (value or "").split(",") if t.strip()}


def is_excluded_row(row: dict) -> bool:
    if parse_groups(row.get("Student Group")) & EXCLUDED_GROUP_TOKENS:
        return True
    return (row.get("is_test") or "").strip().upper() == "TRUE"


def classify_dashboard(campus: str) -> str:
    """'timeback' for in-scope campuses (including former Legacy Dash campuses), '' if excluded."""
    return "" if (campus or "").strip().lower() in TIMEBACK_EXCLUDED_CAMPUSES else "timeback"


def load_roster(path: str | Path, *, require_group_token: str | None) -> dict[str, dict]:
    """Return {email_lower: {campus, level, grade, name, group, advisor}} for admitted rows.

    A row is admitted when Admission Status == "Enrolled" (or the email is in
    STATUS_OVERRIDES), it is not excluded by group token / is_test, and -- when
    ``require_group_token`` is given -- that token is present in Student Group.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"A&D Master Roster not found at {path}")
    out: dict[str, dict] = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            email = (row.get("Student Alpha Email") or "").strip().lower()
            status = (row.get("Admission Status") or "").strip()
            if not email or (status != "Enrolled" and email not in STATUS_OVERRIDES):
                continue
            if is_excluded_row(row):
                continue
            groups = parse_groups(row.get("Student Group"))
            if require_group_token and require_group_token not in groups:
                continue
            out[email] = {
                "campus": (row.get("Campus") or "").strip(),
                "level": (row.get("Current Level") or "").strip(),
                "grade": (row.get("Current Grade Level") or "").strip(),
                "name": (row.get("Full Name") or "").strip(),
                "group": (row.get("Student Group") or "").strip().lower(),
                "advisor": (row.get("Advisor") or "").strip(),
            }
    logger.info("Loaded %d admitted students from roster %s", len(out), path.name)
    return out
