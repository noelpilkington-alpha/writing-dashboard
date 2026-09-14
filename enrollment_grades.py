"""Rules for interpreting Writing class titles.

SY26-27 class titles look like "Sentences G9 Class" where G# is the STUDENT's age
grade, not the content grade, so they yield no content grade. Legacy titles
(hole-filling, Roman tiers, "... G# 2025-26") do carry a content grade.
"""
from __future__ import annotations

import re

EXCLUDED_ENROLLMENT_PATTERNS = [
    "manual xp",
    "scribble",
    "writing placement tests",
    "remediation",
    "frq mastery",
    "ap english language",
]

_ROMAN = {"i": 0, "ii": 1, "iii": 2}
_TRACK_BASE = {"sentences": 3, "paragraphs": 4}   # Sentences I = G3, Paragraphs I = G4

_HOLE_FILLING_RE = re.compile(r"writing g(\d+) hole-filling", re.I)
_ROMAN_RE = re.compile(r"\b(sentences|paragraphs)\s+(iii|ii|i)\b", re.I)
_YEAR_TAGGED_RE = re.compile(r"\b(sentences|paragraphs|essays)\s+g(\d+)\s+2025-26\b", re.I)
_AGE_GRADE_TITLE_RE = re.compile(r"^(sentences|paragraphs|essays)\s+g\d+\s+class$", re.I)
_SWF_RE = re.compile(r"standardized writing fundamentals g(\d+)", re.I)


def is_excluded_enrollment(title: str) -> bool:
    """True for non-core Writing courses (Manual XP, Scribble, remediation, AP, ...)."""
    t = (title or "").lower()
    return any(p in t for p in EXCLUDED_ENROLLMENT_PATTERNS)


def content_grade_for_title(title: str) -> int | None:
    """Content grade implied by an enrollment title, or None when the title carries none."""
    t = (title or "").strip()
    if not t or is_excluded_enrollment(t):
        return None
    if _AGE_GRADE_TITLE_RE.match(t):
        return None
    m = _HOLE_FILLING_RE.search(t)
    if m:
        return int(m.group(1))
    m = _ROMAN_RE.search(t)
    if m:
        return _TRACK_BASE[m.group(1).lower()] + _ROMAN[m.group(2).lower()]
    m = _YEAR_TAGGED_RE.search(t)
    if m:
        return int(m.group(2))
    m = _SWF_RE.search(t)
    if m:
        return int(m.group(1))
    return None


def is_stale_title(title: str, year: str) -> bool:
    return year == "2026-27" and "2025-26" in (title or "")


def stale_enrollments(titles: list[str], year: str) -> list[str]:
    return [t for t in titles if is_stale_title(t, year)]


def enrollment_mismatch(hmg: int, titles: list[str]) -> str | None:
    """'Expected G{hmg+1}, enrolled in G4, G6' when no enrollment with a content grade
    matches hmg+1. None when no enrollment carries a content grade."""
    expected = hmg + 1
    grades = [g for g in (content_grade_for_title(t) for t in titles) if g is not None]
    if not grades or expected in grades:
        return None
    actual = ", ".join(f"G{g}" for g in sorted(set(grades)))
    return f"Expected G{expected}, enrolled in {actual}"
