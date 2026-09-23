"""Collect all Writing student data and generate dashboard JSON."""

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

# Add parent dir to path so we can import writing_automation
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from writing_automation.api_client import TimebackAPI
from writing_automation.config import (
    CURRENT_YEAR,
    GRADE_SEQUENCES,
    MINUTES_GOAL_PER_DAY,
    PASS_THRESHOLD,
    RUSH_THRESHOLD,
    SCHOOL_YEARS,
    TIMEBACK_ROOT,
    XP_GOAL_PER_DAY,
)
from writing_automation import calendars as cal
from writing_automation.csv_loader import load_csv
from writing_automation.deep_dive import detect_deep_dives
from writing_automation.deep_dive_analysis import (
    identify_deep_dive_tests,
    is_rushed,
    load_analysis_cache,
)
from writing_automation.enrollment_fetcher import (
    fetch_student_profiles,
    fetch_writing_enrollments,
)
from writing_automation.student_progress import _get_level
from writing_automation.student_progress import _count_weekdays
from writing_automation.test_type_mapper import classify_test_types
# XP is now computed per-student from raw activity results (not the bulk fetcher)

# Dashboard-local modules (same directory as this script)
from enrollment_grades import (
    enrollment_mismatch as compute_enrollment_mismatch,
    is_excluded_enrollment as _is_excluded_enrollment,
    stale_enrollments,
)
from activity_resolution import CourseSubjects, LessonNames, is_writing_activity
from identity import load_links, merge_activities, merge_tests
from roster import EXCLUDED_EMAILS as _EXCLUDED_EMAILS
from roster import classify_dashboard as _classify_dashboard
from roster import load_roster
from year_metrics import compute_starting_hmg, hmg_from_tests, is_s1_cohort

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

import re as _re

GRADEBOOK_BASE = "/ims/oneroster/gradebook/v1p2"

# A student whose API fetch still fails after the client's retries is skipped for
# the day (never written with an empty history). If failures exceed
# max(MIN_FETCH_FAILURES_TO_ABORT, MAX_FETCH_FAILURE_RATE x processed students),
# the API is having an outage and the run aborts without writing output.
MIN_FETCH_FAILURES_TO_ABORT = 10
MAX_FETCH_FAILURE_RATE = 0.05


def fetch_failure_limit(processed: int) -> int:
    return max(MIN_FETCH_FAILURES_TO_ABORT, int(MAX_FETCH_FAILURE_RATE * processed))


class FetchError(RuntimeError):
    """A student's API fetch failed after retries."""


# A full writing-results export has thousands of rows (7,000+ in Sep 2026). A file far
# below that is almost certainly a filtered export (e.g. a name typed in the analytics
# page's search box), which would silently wipe deep dives and session tests.
MIN_CSV_ROWS = 1000


def check_csv_size(n_rows: int, allow_small: bool = False) -> None:
    if n_rows < MIN_CSV_ROWS and not allow_small:
        raise RuntimeError(
            f"writing-results CSV has only {n_rows} rows (expected at least {MIN_CSV_ROWS}). "
            "This looks like a filtered export; re-export the full file, or pass --allow-small-csv to override."
        )

_UUID_RE = _re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.I)


def _is_uuid(s: str) -> bool:
    return bool(_UUID_RE.match(s))


def _is_alphawrite(ali_sid: str) -> bool:
    """Check if an assessmentLineItem sourcedId is an AlphaWrite activity.

    AlphaWrite activities use two prefix formats:
    - 'alphawrite-' (sentences, paragraphs, etc.)
    - 'alphawrite:' (compositions/essays)
    """
    return ali_sid.startswith("alphawrite-") or ali_sid.startswith("alphawrite:")


# Lookup helpers initialised in collect() once the API client exists. They are
# disk-cached (_course_cache.json, _lesson_name_cache.json; both gitignored).
_COURSE_SUBJECTS: CourseSubjects | None = None
_LESSON_NAMES: LessonNames | None = None


def _is_writing_activity(ali_sid: str, meta: dict) -> bool:
    """Writing work = subject Writing, an AlphaWrite line item, or a record whose
    course is a Writing course. Lesson type alone (powerpath-100, articles, quizzes)
    is not evidence: those types are shared with Math/Science/Reading hole-filling."""
    return is_writing_activity(ali_sid, meta, _COURSE_SUBJECTS)


ACCURACY_THRESHOLD = 80
DASHBOARD_DIR = Path(__file__).resolve().parent
IDENTITY_LINKS_PATH = DASHBOARD_DIR / "identity_links.json"


def output_path_for(year: str) -> Path:
    return DASHBOARD_DIR / "data" / year / "data.json"

# Default paths for EG and S1 snapshot data
DEFAULT_EG_CSV = Path(__file__).resolve().parent.parent / "Student_Progress_Tra_1773079782808.csv"
DEFAULT_S1_SNAPSHOT = Path(__file__).resolve().parent.parent / "SY25-26 Session 1 Snapshot (Academics).xlsx"

# Nickname -> full name mappings for S1 snapshot matching
_S1_NAME_OVERRIDES = {
    "abi constain": "abigail constain",
    "benny valles": "benjamin valles",
    "bobbi brown": "bobbi sue brown",
    "cami fernandez": "camila fernandez",
    "dario poyatos ramos": "dario ramos",
    "daveyp paul": "david paul",
    "dax hummel": "daxon hummel",
    "des pardi": "desmond pardi",
    "izzy vicente": "isabella vicente",
    "ju orloff": "juliana orloff",
    "nathan scharf": "nathaniel scharf",
    "penny marty": "penelope marty",
    "saeed tarawneh": "said tarawneh",
    "sebi cobas": "sebastian cobas",
    "bella barba": "isabella barba",
    "ben de amorim": "ben deamorim",
    "gus haig": "august haig",
    "grey walker": "greyson walker",
}


def load_s1_writing_names(snapshot_path: str) -> set[str]:
    """Load S1 Writing-enrolled student names from the S1 Snapshot spreadsheet.

    Uses the XPschoolday sheet — students with Writing XP > 0 in S1.
    Returns a set of lowercase names, with nickname overrides applied.
    """
    import openpyxl

    wb = openpyxl.load_workbook(str(snapshot_path), data_only=True)
    ws = wb["XPschoolday"]
    names = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        fullname = row[2]
        subject = row[3]
        xp = row[4]
        if not fullname or not isinstance(fullname, str):
            continue
        if str(subject).strip() == "Writing" and isinstance(xp, (int, float)) and xp > 0:
            raw = fullname.strip().lower()
            names.add(_S1_NAME_OVERRIDES.get(raw, raw))
    wb.close()
    logger.info("Loaded %d S1 Writing students from snapshot", len(names))
    return names





def load_effective_grades(csv_path: str) -> tuple[dict[str, int], dict[str, int]]:
    """Load effective grades from the Student Progress Tracker CSV.

    The CSV may contain rows for multiple subjects. We separate Writing
    and Language EGs.

    Returns (writing_eg_by_name, language_eg_by_name) both mapping
    student name (lowercase) -> effective grade (int).
    """
    import csv as _csv

    writing_eg: dict[str, int] = {}
    language_eg: dict[str, int] = {}
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in _csv.DictReader(f):
            name = row.get("Student", "").strip()
            eg = row.get("Effective Grade", "").strip()
            subject = row.get("Subject", "Writing").strip()
            if not name or not eg:
                continue
            try:
                eg_val = int(eg)
            except ValueError:
                continue
            key = name.lower()
            if subject == "Language":
                language_eg[key] = eg_val
            else:
                writing_eg[key] = eg_val

    logger.info("Loaded effective grades: %d Writing, %d Language from %s",
                len(writing_eg), len(language_eg), csv_path)
    return writing_eg, language_eg


def _session_window(year: str, cal_key: str, as_of: datetime) -> dict:
    """Current session for a calendar as of ``as_of``: name, start, end, school_start,
    school_days_elapsed (school days from school_start to as_of - 1 day, capped at end).

    Because the dashboard is always updated the following day (due to timezone
    differences), ``as_of - 1 day`` is the cutoff so we don't under-track students.
    """
    name = cal.current_session(year, cal_key, as_of)
    s = cal.sessions(year, cal_key)[name]
    school_start = s.get("school_start", s["start"])
    cutoff = min(as_of - timedelta(days=1), datetime.strptime(s["end"], "%Y-%m-%d"))
    days = cal.school_days(year, cal_key, school_start, cutoff)
    return {"name": name, "start": s["start"], "end": s["end"], "school_start": school_start,
            "school_days_elapsed": days}


# ---------------------------------------------------------------------------
# AlphaWrite skill plan name mapping
# ---------------------------------------------------------------------------

def _load_skill_plan() -> dict[str, tuple[str, str]]:
    """Load AlphaWrite skill plan from xlsx and return {skill_id: (name, course)} mapping."""
    skill_plan_path = Path(__file__).resolve().parent.parent / "AlphaWrite Skill Plan 2025_2026.xlsx"
    if not skill_plan_path.exists():
        logger.warning("AlphaWrite Skill Plan not found at %s", skill_plan_path)
        return {}

    import openpyxl
    wb = openpyxl.load_workbook(str(skill_plan_path), read_only=True)
    ws = wb["new-aw-skill-plan 2025"]
    mapping: dict[str, tuple[str, str]] = {}
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        skill_id, name, qs_id = row[0], row[1], row[2]
        course = row[6] if len(row) > 6 else ""
        if skill_id and name:
            mapping[str(skill_id).lower()] = (str(name), str(course or ""))
        if qs_id and name:
            # Also map the QS_ID suffix (e.g. FRAGMENT_OR_SENTENCE from 3.2.FRAGMENT_OR_SENTENCE)
            qs_str = str(qs_id)
            mapping[qs_str.lower()] = (str(name), str(course or ""))
            if "." in qs_str:
                suffix = qs_str.rsplit(".", 1)[-1].lower()
                # Don't overwrite if already exists with a different name
                if suffix not in mapping:
                    mapping[suffix] = (str(name), str(course or ""))
    wb.close()
    logger.info("Loaded %d skill plan mappings", len(mapping))
    return mapping


_SKILL_PLAN: dict[str, tuple[str, str]] | None = None


def _get_skill_plan() -> dict[str, tuple[str, str]]:
    global _SKILL_PLAN
    if _SKILL_PLAN is None:
        _SKILL_PLAN = _load_skill_plan()
    return _SKILL_PLAN


def _resolve_compositions_name(ali_sid: str) -> tuple[str, str]:
    """Resolve an alphawrite:compositions: activity to (readable_name, course).

    Example ali_sid: alphawrite:compositions:essays-g6:essay-3-tfxy:stage-revise:
    Returns e.g. ("Revise (Essay 3)", "Essays G6")
    """
    parts = ali_sid.split(":")
    # parts: ['alphawrite', 'compositions', 'essays-g6', 'essay-3-tfxy', 'stage-revise', '']
    course = ""
    stage = ""
    essay_label = ""
    if len(parts) >= 3:
        # e.g. 'essays-g6' -> 'Essays G6'
        course = parts[2].replace("-", " ").title()
    if len(parts) >= 4:
        # e.g. 'essay-3-tfxy' -> 'Essay 3'
        essay_part = parts[3]
        m = _re.match(r"essay-(\d+)", essay_part)
        if m:
            essay_label = f"Essay {m.group(1)}"
    if len(parts) >= 5:
        # e.g. 'stage-revise' or 'stage-draft:attempt-1'
        stage_part = parts[4]
        stage = stage_part.replace("stage-", "").replace("-", " ").title()
        if stage.startswith("Identif"):
            stage = "Setup"  # stage-identify maps to "Setup" in the admin

    name = stage if stage else "Compositions Activity"
    if essay_label:
        name = f"{name} ({essay_label})"

    return (name, course)


def _resolve_activity_name(ali_sid: str, meta: dict) -> tuple[str, str] | None:
    """Resolve an AlphaWrite activity to (readable_name, course).
    Returns None if the activity is not an AlphaWrite activity."""
    # Only process AlphaWrite activities
    if not _is_alphawrite(ali_sid):
        return None

    # Handle alphawrite:compositions: prefix (Essays)
    if ali_sid.startswith("alphawrite:compositions:"):
        return _resolve_compositions_name(ali_sid)

    skill_plan = _get_skill_plan()

    # Try direct lookup by full ali_sid (minus -assessment-line-item suffix)
    clean_sid = ali_sid.replace("-assessment-line-item", "").lower()
    if clean_sid in skill_plan:
        return skill_plan[clean_sid]

    # Try extracting the activity slug from the ali_sid
    # e.g. alphawrite-sentences-iii-identify-sentence-type -> identify-sentence-type
    parts = clean_sid.split("-", 3)  # ['alphawrite', 'sentences', 'iii', 'identify-sentence-type']
    if len(parts) >= 4:
        slug = parts[3].replace("-", "_").upper()
        if slug.lower() in skill_plan:
            return skill_plan[slug.lower()]

    # Try metadata activity field
    activity_name = meta.get("activity", "")
    if activity_name:
        if activity_name.lower() in skill_plan:
            return skill_plan[activity_name.lower()]
        # Try converting underscores
        slug = activity_name.lower().replace(" ", "_")
        if slug in skill_plan:
            return skill_plan[slug]

    # Fallback: derive readable name from ali_sid
    readable = clean_sid.replace("alphawrite-", "").replace("-", " ").title()
    # Derive course from the structure
    course = ""
    if "sentences-i-" in ali_sid and "sentences-ii" not in ali_sid and "sentences-iii" not in ali_sid:
        course = "Sentences G3"
    elif "sentences-ii-" in ali_sid and "sentences-iii" not in ali_sid:
        course = "Sentences G4"
    elif "sentences-iii" in ali_sid:
        course = "Sentences G5"
    elif "sentences-iv" in ali_sid:
        course = "Sentences G6"
    elif "sentences-v-" in ali_sid:
        course = "Sentences G7"
    elif "sentences-vi" in ali_sid:
        course = "Sentences G8"
    elif "paragraphs-g3" in ali_sid:
        course = "Paragraphs G3"
    elif "paragraphs-g4" in ali_sid:
        course = "Paragraphs G4"
    elif "paragraphs-g5" in ali_sid:
        course = "Paragraphs G5"
    elif "paragraphs-g6" in ali_sid:
        course = "Paragraphs G6"
    elif "paragraphs-g7" in ali_sid:
        course = "Paragraphs G7"
    elif "paragraphs-g8" in ali_sid:
        course = "Paragraphs G8"
    elif "compositions" in ali_sid or "essays" in ali_sid:
        if "g6" in ali_sid:
            course = "Essays G6"
        elif "g7" in ali_sid:
            course = "Essays G7"
        elif "g8" in ali_sid:
            course = "Essays G8"

    return (readable, course)


# ---------------------------------------------------------------------------
# New data fetching functions
# ---------------------------------------------------------------------------

_WRITING_TEST_RE = _re.compile(r"Writing\s+G\d|Alpha\s+Standardized\s+Writing", _re.I)
_GRADE_SUB_RE = _re.compile(r"G(\d+)\.(\d+)")

# Spreadsheet-based test type lookup for S1 tests (before API tagging was reliable)
_SPREADSHEET_TYPES: dict[tuple[str, str], str] | None = None


def _load_spreadsheet_types() -> dict[tuple[str, str], str]:
    """Load test type classifications from Alpha Standardized Writing Tests Graded.xlsx.

    Returns dict mapping (name_lower, date_str, test_sub) -> test_type.
    Used for S1 tests where API metadata.testType is empty.
    Also builds a name→email mapping from the Master Roster for better matching.
    """
    global _SPREADSHEET_TYPES
    if _SPREADSHEET_TYPES is not None:
        return _SPREADSHEET_TYPES

    _SPREADSHEET_TYPES = {}
    spreadsheet_path = Path(__file__).resolve().parent.parent / "Daily workflow" / "Alpha Standardized Writing Tests Graded.xlsx"
    if not spreadsheet_path.exists():
        logger.warning("Tests Graded spreadsheet not found at %s", spreadsheet_path)
        return _SPREADSHEET_TYPES

    import openpyxl
    import csv as _csv
    from datetime import datetime as _dt

    type_map = {
        "Mastery Test": "end of course",
        "Retake": "end of course",
        "Test-Out": "test out",
        "Placement Test": "placement",
    }

    # Build name→email mapping from Master Roster for resolving spreadsheet names
    roster_path = Path(__file__).resolve().parent.parent / "A&D Master Roster 25-26 - Master.csv"
    name_to_email: dict[str, str] = {}
    if roster_path.exists():
        with open(roster_path, encoding="utf-8") as f:
            reader = _csv.DictReader(f)
            for row in reader:
                email = row.get("Student Alpha Email", "").strip().lower()
                first = row.get("First Name", "").strip().lower()
                last = row.get("Last Name", "").strip().lower()
                preferred = row.get("Preferred Name", "").strip().lower()
                if email and first and last:
                    name_to_email[f"{first} {last}"] = email
                    if preferred:
                        name_to_email[f"{preferred} {last}"] = email

    wb = openpyxl.load_workbook(str(spreadsheet_path), read_only=True, data_only=True)
    ws = wb["Tests Graded"]
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = (row[0] or "").strip().lower()
        date = row[2]
        test = str(row[3] or "").strip()
        test_type = row[4]
        if not date or not isinstance(date, _dt) or not test_type:
            continue
        date_str = date.strftime("%Y-%m-%d")
        mapped = type_map.get(test_type, test_type.lower())

        # Store by original name
        _SPREADSHEET_TYPES[(name, date_str, test)] = mapped
        # Store by last name for fuzzy matching
        parts = name.split()
        if parts:
            _SPREADSHEET_TYPES[(parts[-1], date_str, test)] = mapped
        # Store by email (resolved via roster) for reliable matching
        clean_name = _re.sub(r"\([^)]*\)", "", name).strip()
        clean_name = _re.sub(r"\s+", " ", clean_name)
        email = name_to_email.get(name) or name_to_email.get(clean_name)
        if email:
            _SPREADSHEET_TYPES[(email, date_str, test)] = mapped
    wb.close()
    logger.info("Loaded %d test type classifications from spreadsheet", len(_SPREADSHEET_TYPES))
    return _SPREADSHEET_TYPES


def _classify_unknown_test_types(tests: list[dict], student_name: str = "", student_email: str = "") -> list[dict]:
    """Retroactively classify tests with empty test_type.

    First tries spreadsheet lookup (authoritative for S1), then falls back to heuristic:
    - First ever test at G3.1 → 'placement'
    - .1 at a new grade after passing the previous grade → 'test out'
    - All other tests within a grade → 'end of course'
    """
    if not tests:
        return tests

    # Try spreadsheet lookup for tests with empty type
    sheet_types = _load_spreadsheet_types()
    name_lower = student_name.lower().strip()
    last_name = name_lower.split()[-1] if name_lower.split() else ""

    passed_grades: set[int] = set()
    first_test_seen = False

    for t in tests:  # already sorted by date
        if t.get("test_type"):
            # Track passed grades from known-type tests too
            m = _GRADE_SUB_RE.search(t.get("name", ""))
            if m and t.get("passed"):
                passed_grades.add(int(m.group(1)))
            first_test_seen = True
            continue

        m = _GRADE_SUB_RE.search(t.get("name", ""))
        if not m:
            t["test_type"] = "end of course"
            first_test_seen = True
            continue

        grade = int(m.group(1))
        sub = int(m.group(2))
        test_sub = f"G{grade}.{sub}"
        date = t.get("date", "")

        # Try spreadsheet lookup (authoritative for S1)
        # Try by email first (most reliable), then name, then last name
        sheet_type = (
            sheet_types.get((student_email, date, test_sub))
            or sheet_types.get((name_lower, date, test_sub))
            or sheet_types.get((last_name, date, test_sub))
        )
        if sheet_type:
            t["test_type"] = sheet_type
        elif not first_test_seen and sub == 1 and grade == 3:
            t["test_type"] = "placement"
        elif sub == 1 and (grade - 1) in passed_grades:
            t["test_type"] = "test out"
        else:
            t["test_type"] = "end of course"

        if t.get("passed"):
            passed_grades.add(grade)
        first_test_seen = True

    return tests


def fetch_writing_test_results(
    api: TimebackAPI, student_id: str, student_name: str = "", student_email: str = ""
) -> list[dict]:
    """Fetch standardized writing test results from the API for a student.

    Uses a wider search (no subject filter) and filters client-side,
    so tests with missing metadata.subject are still captured.
    """
    try:
        data = api.get(
            f"{GRADEBOOK_BASE}/assessmentResults/",
            {
                "limit": 3000,
                "filter": (
                    f"student.sourcedId='{student_id}'"
                    " AND metadata.resultType='assessment'"
                ),
            },
        )
        results = []
        for r in data.get("assessmentResults", []):
            meta = r.get("metadata", {})
            subject = meta.get("subject", "")
            test_name = meta.get("testName", "")
            # Include if subject is Writing OR testName matches writing test pattern
            if subject != "Writing" and not _WRITING_TEST_RE.search(test_name):
                continue
            results.append({
                "name": test_name,
                "test_type": meta.get("testType", ""),
                "score": r.get("score"),
                "date": (r.get("scoreDate") or "")[:10],
                "assigned_at": (meta.get("assignedAt") or "")[:10],
                "assignment_id": meta.get("assignmentId"),
                "test_link": meta.get("testLink", ""),
                "total_questions": meta.get("totalQuestions"),
                "correct_questions": meta.get("correctQuestions"),
                "passed": (r.get("score") or 0) >= PASS_THRESHOLD,
            })
        results.sort(key=lambda x: x["date"])
        return _classify_unknown_test_types(results, student_name, student_email)
    except Exception as e:
        raise FetchError(f"test results for {student_id}: {e}") from e


def fetch_activity_results(
    api: TimebackAPI, student_id: str, lower: str, upper: str
) -> list[dict]:
    """Fetch per-activity assessment results for a student between two ISO dates (inclusive)."""
    try:
        return api.get_paginated(
            f"{GRADEBOOK_BASE}/assessmentResults/",
            {
                "filter": (
                    f"student.sourcedId='{student_id}'"
                    f" AND scoreDate>='{lower}'"
                    f" AND scoreDate<='{upper}'"
                ),
            },
            "assessmentResults",
        )
    except Exception as e:
        raise FetchError(f"activities for {student_id}: {e}") from e


def extract_low_accuracy_activities(raw_results: list[dict]) -> list[dict]:
    """Extract AlphaWrite activities below the accuracy threshold."""
    low = []
    for r in raw_results:
        ali_sid = r.get("assessmentLineItem", {}).get("sourcedId", "")
        meta = r.get("metadata", {})

        # Only include AlphaWrite activities
        resolved = _resolve_activity_name(ali_sid, meta)
        if resolved is None:
            continue

        name, course = resolved

        accuracy = meta.get("accuracy")
        if accuracy is None:
            total = meta.get("totalQuestions")
            correct = meta.get("correctQuestions")
            if total and correct is not None and total > 0:
                accuracy = round(100 * correct / total)
            else:
                continue

        if accuracy >= ACCURACY_THRESHOLD:
            continue

        total_q = meta.get("totalQuestions", 0)
        correct_q = meta.get("correctQuestions", 0)

        low.append({
            "name": name,
            "course": course,
            "accuracy": accuracy,
            "questions": f"{correct_q}/{total_q}" if total_q else "?",
            "xp": meta.get("xp", 0),
            "attempt": meta.get("attemptNumber", meta.get("attempt", 1)),
            "date": (r.get("scoreDate") or "")[:10],
        })

    return low


def extract_repeated_activities(raw_results: list[dict]) -> list[dict]:
    """Find AlphaWrite activities where a student has multiple attempts."""
    by_activity: dict[str, list[dict]] = defaultdict(list)
    activity_names: dict[str, tuple[str, str]] = {}

    for r in raw_results:
        ali_sid = r.get("assessmentLineItem", {}).get("sourcedId", "")
        if not ali_sid:
            continue
        meta = r.get("metadata", {})

        # Only include AlphaWrite activities
        resolved = _resolve_activity_name(ali_sid, meta)
        if resolved is None:
            continue

        if ali_sid not in activity_names:
            activity_names[ali_sid] = resolved

        accuracy = meta.get("accuracy")
        if accuracy is None:
            total = meta.get("totalQuestions")
            correct = meta.get("correctQuestions")
            if total and correct is not None and total > 0:
                accuracy = round(100 * correct / total)
        attempt = meta.get("attemptNumber", meta.get("attempt", 1))
        by_activity[ali_sid].append({
            "accuracy": accuracy,
            "attempt": attempt,
            "date": (r.get("scoreDate") or "")[:10],
        })

    repeated = []
    for ali_sid, attempts in by_activity.items():
        if len(attempts) <= 1:
            continue
        max_attempt = max(a.get("attempt", 1) or 1 for a in attempts)
        if max_attempt <= 1:
            continue

        accuracies = [a["accuracy"] for a in attempts if a["accuracy"] is not None]
        name, course = activity_names.get(ali_sid, (ali_sid, ""))

        repeated.append({
            "name": name,
            "course": course,
            "attempts": max_attempt,
            "best_accuracy": max(accuracies) if accuracies else None,
            "latest_accuracy": accuracies[-1] if accuracies else None,
        })

    return repeated


def infer_next_test(hmg: int, test_history: list[dict]) -> dict | None:
    """Infer the next expected test based on HMG.

    When a student passes a test, they advance to the next grade level.
    So the next test is always G{HMG+1}.1.
    """
    if hmg >= 8:
        return None  # Completed all grades

    next_grade = hmg + 1
    if next_grade not in GRADE_SEQUENCES:
        return None

    test_name = f"G{next_grade}.1"

    # Check if student has already attempted a test at this grade level
    taken = any(
        f"G{next_grade}." in t.get("name", "")
        for t in test_history
        if not t.get("passed")
    )

    return {
        "name": test_name,
        "reason": f"HMG is G{hmg}, next grade level is G{next_grade}",
        "status": "retaking" if taken else "pending",
    }


def extract_xp_and_details(raw_results: list[dict]) -> dict:
    """Extract per-activity and per-test XP breakdowns, plus compute XP totals.

    A result is counted as Writing XP if:
    - metadata.subject == 'Writing', OR
    - assessmentLineItem.sourcedId is an AlphaWrite activity (alphawrite- or alphawrite:)

    Returns dict with 'activity_xp', 'test_xp' lists, and XP totals.
    Also counts ALL Writing activities (including 0-XP) for time-spent analysis.
    """
    activity_xp_items = []
    test_xp_items = []
    alphawrite_xp_total = 0.0
    mastery_track_xp_total = 0.0
    test_xp_total = 0.0
    total_writing_activities = 0
    writing_active_dates = set()

    for r in raw_results:
        meta = r.get("metadata", {})
        ali_sid = r.get("assessmentLineItem", {}).get("sourcedId", "")

        if not _is_writing_activity(ali_sid, meta):
            continue

        # Count ALL Writing activities (including 0-XP) for time-spent metric
        total_writing_activities += 1
        date = (r.get("scoreDate") or "")[:10]
        if date:
            writing_active_dates.add(date)

        xp = meta.get("xp", 0) or 0
        if xp <= 0:
            continue

        subject = meta.get("subject", "")
        is_alphawrite = _is_alphawrite(ali_sid)

        result_type = meta.get("resultType", "")
        lesson_type = meta.get("lessonType", "")
        date = (r.get("scoreDate") or "")[:10]

        if result_type == "assessment":
            # This is a writing test
            test_xp_total += xp
            test_xp_items.append({
                "name": meta.get("testName", "Unknown Test"),
                "xp": xp,
                "score": r.get("score"),
                "date": date,
            })
        else:
            # Activity XP
            resolved = _resolve_activity_name(ali_sid, meta)
            if resolved:
                name, course = resolved
                alphawrite_xp_total += xp
            elif is_alphawrite:
                # Fallback: derive readable name from ali_sid
                clean = ali_sid.replace("alphawrite-", "").replace("alphawrite:", "")
                name = clean.replace("-assessment-line-item", "").replace("-", " ").replace(":", " ").title()
                course = ""
                alphawrite_xp_total += xp
            else:
                # Non-AlphaWrite Writing activity (new-format AlphaWrite caliper rows,
                # Writing-course PowerPath quizzes, external lessons). Prefer the real
                # lesson title from the component resource / line item.
                app_name = meta.get("appName", "")
                test_name = meta.get("testName", "")
                course = ""
                looked_up = _LESSON_NAMES.resolve(ali_sid, meta) if _LESSON_NAMES else None
                if looked_up:
                    name = looked_up
                else:
                    name = test_name or app_name or "Writing Activity"
                    if name.startswith("caliper_") or name.startswith("Caliper_"):
                        name = app_name or "Mastery Track Activity"
                    elif name.startswith("Nice_"):
                        name = name.replace("Nice_", "").replace("_", " ").title()
                    elif _is_uuid(name):
                        name = app_name or "Writing Activity"
                if app_name == "Alphawrite" or (meta.get("isAWTimeback2") or meta.get("isAWCaliper")):
                    alphawrite_xp_total += xp
                else:
                    mastery_track_xp_total += xp

            is_aw_caliper = meta.get("appName") == "Alphawrite" or bool(meta.get("isAWTimeback2") or meta.get("isAWCaliper"))
            activity_xp_items.append({
                "name": name,
                "course": course,
                "xp": xp,
                "date": date,
                "type": "alphawrite" if (is_alphawrite or is_aw_caliper or lesson_type == "powerpath-100") else (
                    "external" if lesson_type == "external-lesson" else "mastery_track"
                ),
            })

    # Sort by date
    activity_xp_items.sort(key=lambda x: x["date"])
    test_xp_items.sort(key=lambda x: x["date"])

    # Determine most recent XP date
    all_dates = [a["date"] for a in activity_xp_items if a["date"]] + \
                [t["date"] for t in test_xp_items if t["date"]]
    last_xp_date = max(all_dates) if all_dates else None

    return {
        "activity_xp": activity_xp_items,
        "test_xp": test_xp_items,
        "alphawrite_xp": alphawrite_xp_total,
        "mastery_track_xp": mastery_track_xp_total,
        "test_xp_total": test_xp_total,
        "last_xp_date": last_xp_date,
        "total_writing_activities": total_writing_activities,
        "writing_active_days": len(writing_active_dates),
        "writing_active_dates_set": writing_active_dates,  # excluded from JSON, used by caller
        "first_writing_date": min(writing_active_dates) if writing_active_dates else None,
    }


# ---------------------------------------------------------------------------
# Main collector
# ---------------------------------------------------------------------------

def collect(
    csv_path: str,
    year: str,
    as_of: datetime,
    *,
    skip_analysis: bool = False,
    effective_grades_csv: str | None = None,
    s1_snapshot_path: str | None = None,
    limit: int | None = None,
    prior_year_data: dict | None = None,
    allow_small_csv: bool = False,
) -> dict:
    """Collect all data for one school year and return the dashboard JSON structure."""
    year_cfg = SCHOOL_YEARS[year]
    as_of = as_of.replace(hour=0, minute=0, second=0, microsecond=0)
    as_of_str = as_of.strftime("%Y-%m-%d")
    as_of_end = as_of + timedelta(days=1)          # exclusive upper bound for CSV timestamps
    activity_lower = year_cfg["activity_start"]
    activity_upper = max(year_cfg["year_end"], as_of_str)

    # Current session + school days per calendar
    windows = {k: _session_window(year, k, as_of) for k in cal.calendar_keys(year)}
    logger.info("Year %s as of %s: %s", year, as_of_str,
                ", ".join(f"{k}={w['name']} day {w['school_days_elapsed']}" for k, w in windows.items()))

    # 1. Roster (whitelist + campus source of truth)
    roster = load_roster(TIMEBACK_ROOT / year_cfg["roster"], require_group_token=year_cfg["roster_group_token"])

    # 1b. Identity links (old -> new sourcedIds)
    links = load_links(IDENTITY_LINKS_PATH)
    logger.info("Loaded identity links for %d students", len(links))

    # 1c. Prior-year EG carry-forward (26-27 only)
    prior_eg: dict[str, dict] = {}
    if prior_year_data:
        for s in prior_year_data.get("students", []):
            if s.get("effective_grade") is not None:
                prior_eg[s["email"].lower()] = {"effective_grade": s["effective_grade"],
                                                "language_eg": s.get("language_eg")}
        logger.info("Carried forward EG for %d students from prior year", len(prior_eg))

    # 2. Load CSV (rows after the as-of date are ignored so archives stay frozen)
    logger.info("Loading CSV: %s", csv_path)
    all_csv_rows = load_csv(csv_path)
    check_csv_size(len(all_csv_rows), allow_small_csv)
    csv_results = [r for r in all_csv_rows if r.score_date < as_of_end]
    logger.info("Loaded %d CSV results on/before %s", len(csv_results), as_of_str)

    # 3. Init API + cached lookup helpers for subject and lesson-name resolution
    logger.info("Initializing Timeback API...")
    api = TimebackAPI()
    global _COURSE_SUBJECTS, _LESSON_NAMES
    _COURSE_SUBJECTS = CourseSubjects(api, DASHBOARD_DIR / "_course_cache.json")
    _LESSON_NAMES = LessonNames(api, DASHBOARD_DIR / "_lesson_name_cache.json")

    # 4. Fetch enrollments + profiles
    logger.info("Fetching Writing enrollments...")
    enrollments = fetch_writing_enrollments(api)
    student_ids = set(enrollments.keys())
    logger.info("Found %d enrolled students", len(student_ids))

    logger.info("Fetching student profiles...")
    profiles = fetch_student_profiles(api, student_ids)

    # 5. Classify + deep dives (CSV-based; identify_deep_dive_tests collects all-time
    # failures regardless of the session argument, so a constant is passed)
    classifications = classify_test_types(csv_results)
    deep_dives = detect_deep_dives(csv_results)
    deep_dive_tests = identify_deep_dive_tests(csv_results, deep_dives, "S1")

    # 6b. Load deep dive analyses from cache (written by writing_automation CLI)
    if skip_analysis:
        logger.info("Skipping deep dive analysis (--skip-analysis)")
        dd_analyses = {}
    else:
        dd_analyses = load_analysis_cache()
        cached_keys = set(dd_analyses.keys()) & set(deep_dive_tests.keys())
        logger.info(
            "Loaded %d/%d deep dive analyses from cache",
            len(cached_keys), len(deep_dive_tests),
        )

    # 6c. Load effective grades from CSV
    eg_by_name: dict[str, int] = {}
    lang_eg_by_name: dict[str, int] = {}
    if effective_grades_csv:
        eg_by_name, lang_eg_by_name = load_effective_grades(effective_grades_csv)

    # 6d. Load S1 cohort names
    s1_names: set[str] = set()
    if s1_snapshot_path:
        s1_names = load_s1_writing_names(s1_snapshot_path)

    # 7. Build email -> csv results map
    csv_by_email: dict[str, list] = defaultdict(list)
    for r in csv_results:
        csv_by_email[r.student_email].append(r)

    # 9. Assemble per-student data
    students = []
    merged_count = 0
    failed_fetches: list[dict] = []
    total = len(student_ids)
    processed = 0
    for idx, sid in enumerate(sorted(student_ids), 1):
        if limit is not None and processed >= limit:
            break
        profile = profiles.get(sid)
        if not profile:
            continue

        email = profile.email

        # Only include students in the A&D Master Roster
        roster_entry = roster.get(email.lower())
        if not roster_entry:
            continue

        # Skip individually excluded students
        if email.lower() in _EXCLUDED_EMAILS:
            continue

        # Use roster campus as source of truth
        roster_campus = roster_entry["campus"]

        # Classify into dashboard group — excluded campuses drop out here
        dash_group = _classify_dashboard(roster_campus)
        if dash_group != "timeback":
            continue

        # Calendar-dependent session window and goals
        cal_key = cal.resolve_calendar(year, roster_campus)
        window = windows[cal_key]
        session_start, session_end = window["start"], window["end"]
        school_start_date = window["school_start"]
        school_days = window["school_days_elapsed"]
        xp_goal = XP_GOAL_PER_DAY * school_days

        logger.info("Processing student %d/%d: %s", idx, total, email)
        processed += 1

        # Enrollments
        student_enrollments = enrollments.get(sid, [])

        # Fetch test history from API (primary account + linked old accounts), bounded by as-of
        student_full_name = f"{profile.given_name} {profile.family_name}"
        linked_ids = links.get(sid, [])
        try:
            api_tests = fetch_writing_test_results(api, sid, student_full_name, email)
            if linked_ids:
                extra_tests = [fetch_writing_test_results(api, old, student_full_name, email) for old in linked_ids]
                api_tests = merge_tests(api_tests, extra_tests)
                merged_count += 1
        except FetchError as e:
            logger.error("Skipping %s for today: %s", email, e)
            failed_fetches.append({"email": email, "name": student_full_name, "error": str(e)})
            continue
        api_tests = [t for t in api_tests if (t.get("date") or "") <= as_of_str]

        # Override API test_type with CSV classification, then spreadsheet
        # CSV is authoritative for S2+ (has "End of Course" type)
        # Spreadsheet is authoritative for S1 (CSV has everything as "Test Out")
        sheet_types = _load_spreadsheet_types()
        for t in api_tests:
            test_date = t.get("date", "")
            csv_matches = [
                r for r in csv_by_email.get(email, [])
                if r.test_name == t["name"]
                and r.score_date.strftime("%Y-%m-%d") == test_date
            ]
            if csv_matches:
                r = csv_matches[0]
                key = (email, r.test_name, r.score_date)
                csv_type = classifications.get(key, r.csv_test_type)
                csv_type_mapped = {
                    "End of Course": "end of course",
                    "Test Out": "test out",
                    "Test-Out": "test out",
                    "Placement": "placement",
                    "Placement Test": "placement",
                    "Mastery Test": "end of course",
                    "Retake": "end of course",
                }.get(csv_type, csv_type.lower().replace("-", " ") if csv_type else t["test_type"])
                if csv_type_mapped:
                    t["test_type"] = csv_type_mapped

            # Spreadsheet override (authoritative for S1 where CSV lacks EOC distinction)
            m = _GRADE_SUB_RE.search(t.get("name", ""))
            if m:
                test_sub = m.group(0)
                sheet_type = (
                    sheet_types.get((email, test_date, test_sub))
                    or sheet_types.get((student_full_name.lower().strip(), test_date, test_sub))
                )
                if sheet_type:
                    t["test_type"] = sheet_type

        # Skip students whose only enrollments are non-core courses
        # (unless they have test history, indicating they completed core courses)
        if student_enrollments and not any(
            not _is_excluded_enrollment(e) for e in student_enrollments
        ):
            if not api_tests:
                continue

        # Level
        level = _get_level(profile.age_grade)

        # HMG — lifetime, from (merged) API test results
        hmg = hmg_from_tests(api_tests)
        starting_hmg, starting_hmg_basis = compute_starting_hmg(
            api_tests, mode=year_cfg["starting_hmg_mode"], year_start=year_cfg["year_start"])
        student_csv = csv_by_email.get(email, [])

        # G8 completion check
        completed_g8 = hmg >= 8

        # Last test
        last_test = None
        if api_tests:
            t = api_tests[-1]
            last_test = {
                "name": t["name"],
                "type": t["test_type"],
                "score": t["score"],
                "date": t["date"],
                "passed": t["passed"],
            }

        # Session tests (from CSV for detailed info including time)
        session_start_dt = datetime.strptime(session_start, "%Y-%m-%d")
        session_end_dt = datetime.strptime(session_end, "%Y-%m-%d")
        session_tests = []
        for r in sorted(student_csv, key=lambda x: x.score_date):
            if session_start_dt <= r.score_date <= session_end_dt:
                key = (r.student_email, r.test_name, r.score_date)
                test_type = classifications.get(key, r.csv_test_type)
                session_tests.append({
                    "name": r.test_name,
                    "type": test_type,
                    "score": r.score,
                    "date": r.score_date.strftime("%Y-%m-%d"),
                    "passed": r.score >= PASS_THRESHOLD,
                    "time_seconds": r.time_spent_seconds,
                    "rushed": is_rushed(r.time_spent_seconds, r.test_grade),
                })

        # Next expected test (passing a test advances to next grade level)
        next_test = infer_next_test(hmg, api_tests)

        # Group the student's tests by grade so we can check the MOST RECENT
        # test at each grade. A loop at grade G is resolved once the student's
        # most recent test at grade G is a pass — per the product rule
        # "if a student passes the grade they were looping in, remove them."
        tests_by_grade: dict[int, list[dict]] = {}
        for t in api_tests:
            m = _re.search(r"G(\d+)", t.get("name", ""))
            if m:
                g = int(m.group(1))
                tests_by_grade.setdefault(g, []).append(t)

        def _loop_still_current(loop_grade: int) -> bool:
            """A loop at loop_grade is resolved when the most recent test at
            that grade (by date) is a pass (score >= PASS_THRESHOLD)."""
            tests = tests_by_grade.get(loop_grade, [])
            if not tests:
                return True  # detection said 3+ fails but no tests visible — keep flagged
            latest = max(tests, key=lambda t: t.get("date", ""))
            return latest.get("score", 0) < PASS_THRESHOLD

        # Deep dive — flag every grade where the student has 3+ EOC failures
        # whose most recent test at that grade hasn't passed.
        dd_needed = any(
            (email, g) in deep_dives and _loop_still_current(g)
            for g in range(3, 9)
        )
        dd_details = []
        for (dd_email, dd_grade), dd_tests in deep_dive_tests.items():
            if dd_email != email:
                continue
            # Skip if the student's most recent test at this grade was a pass
            if not _loop_still_current(dd_grade):
                continue
            failed = [t for t in dd_tests if t.score < PASS_THRESHOLD]
            rushed_count = sum(1 for t in dd_tests if is_rushed(t.time_spent_seconds, dd_grade))
            times = [t.time_spent_seconds for t in dd_tests if t.time_spent_seconds]
            avg_time = round(sum(times) / len(times) / 60, 1) if times else 0

            dd_details.append({
                "grade": dd_grade,
                "total_tests": len(dd_tests),
                "failed_count": len(failed),
                "rushed_count": rushed_count,
                "avg_time_minutes": avg_time,
                "tests": [
                    {
                        "name": t.test_name,
                        "score": t.score,
                        "date": t.score_date.strftime("%Y-%m-%d"),
                        "rushed": is_rushed(t.time_spent_seconds, dd_grade),
                    }
                    for t in dd_tests
                ],
                "analysis": dd_analyses.get((dd_email, dd_grade)),
            })

        # Fetch activity results for accuracy analysis, XP details, and XP totals
        try:
            raw_activities = fetch_activity_results(api, sid, activity_lower, activity_upper)
            if linked_ids:
                extra_acts = [fetch_activity_results(api, old, activity_lower, activity_upper) for old in linked_ids]
                raw_activities = merge_activities(raw_activities, extra_acts)
        except FetchError as e:
            logger.error("Skipping %s for today: %s", email, e)
            failed_fetches.append({"email": email, "name": student_full_name, "error": str(e)})
            continue
        xp_result = extract_xp_and_details(raw_activities)
        xp_details = xp_result
        alphawrite_xp = xp_result["alphawrite_xp"]
        mastery_track_xp = xp_result["mastery_track_xp"]
        test_xp_val = xp_result["test_xp_total"]
        total_xp = alphawrite_xp + mastery_track_xp + test_xp_val

        # Split XP into school vs break periods for accurate goal tracking
        all_xp_items = xp_result.get("activity_xp", []) + xp_result.get("test_xp", [])
        school_xp = sum(a["xp"] for a in all_xp_items if a.get("date", "") >= school_start_date)
        break_xp = total_xp - school_xp
        avg_xp = round(school_xp / school_days, 1) if school_days else 0

        # XP/day metric (lifetime: from first Writing activity to today)
        # Discount 15 school days for MAP testing weeks (3 weeks across the year)
        today = as_of
        total_writing_activities = xp_result.get("total_writing_activities", 0)
        writing_active_days = xp_result.get("writing_active_days", 0)
        first_writing_date = xp_result.get("first_writing_date")
        lifetime_xp = xp_result.get("alphawrite_xp", 0) + xp_result.get("mastery_track_xp", 0) + xp_result.get("test_xp_total", 0)
        if first_writing_date:
            first_dt = datetime.strptime(first_writing_date, "%Y-%m-%d")
            lifetime_school_days = _count_weekdays(first_dt, today)
            map_discount_days = 15
            available_days = max(1, lifetime_school_days - map_discount_days)
        else:
            available_days = max(1, school_days - 5)
        avg_xp_per_day = round(lifetime_xp / available_days, 1) if available_days > 0 else 0

        # Compute inactivity (weekdays since last XP or test, up to today).
        # We don't clamp at session_end — if the session is over and a student
        # genuinely hasn't done anything post-session, that's real inactivity.
        last_xp_date_str = xp_details.get("last_xp_date")
        # Also consider tests taken (students in HF/SWF courses may only take
        # periodic tests without daily practice XP)
        test_dates = [t.get("date", "") for t in api_tests if t.get("date")]
        if test_dates:
            last_test_date = max(test_dates)
            if not last_xp_date_str or last_test_date > last_xp_date_str:
                last_xp_date_str = last_test_date
        today = as_of
        session_start_dt = datetime.strptime(session_start, "%Y-%m-%d")
        inactivity_cutoff = today
        if last_xp_date_str:
            last_xp_dt = datetime.strptime(last_xp_date_str, "%Y-%m-%d")
            # Count weekdays strictly after last_xp and up to cutoff
            if inactivity_cutoff > last_xp_dt:
                days_inactive = _count_weekdays(last_xp_dt + timedelta(days=1), inactivity_cutoff)
            else:
                days_inactive = 0
            never_active_this_session = False
        else:
            # No activity at all this session: count weekdays from session start to cutoff
            if inactivity_cutoff >= session_start_dt:
                days_inactive = _count_weekdays(session_start_dt, inactivity_cutoff)
            else:
                days_inactive = 0
            never_active_this_session = True

        # Suppress inactivity for G8 completers and unenrolled students
        if completed_g8 or not student_enrollments:
            days_inactive = 0
            never_active_this_session = False

        # For G8 completers, skip accuracy/deep dive/enrollment analysis
        if completed_g8:
            low_accuracy = []
            repeated = []
            enrollment_mismatch = None
            stale = []
            insights = []
        else:
            low_accuracy = extract_low_accuracy_activities(raw_activities)
            repeated = extract_repeated_activities(raw_activities)

            # Enrollment mismatch: content grade vs HMG+1. SY26-27 "<Track> G# Class"
            # titles carry the student's age grade, not a content grade, and are ignored.
            enrollment_mismatch = compute_enrollment_mismatch(hmg, student_enrollments) if student_enrollments else None
            stale = stale_enrollments(student_enrollments, year)

            # Build insights
            insights = []
            if dd_needed:
                for d in dd_details:
                    rushed_txt = f" ({d['rushed_count']} rushed)" if d["rushed_count"] else ""
                    insights.append({
                        "type": "deep_dive",
                        "severity": "high",
                        "text": f"Deep Dive at G{d['grade']}: {d['failed_count']} failed tests{rushed_txt}",
                    })
            if low_accuracy:
                insights.append({
                    "type": "low_accuracy",
                    "severity": "medium",
                    "text": f"{len(low_accuracy)} activit{'y' if len(low_accuracy) == 1 else 'ies'} below {ACCURACY_THRESHOLD}% accuracy",
                })
            if repeated:
                for rep in repeated[:3]:
                    insights.append({
                        "type": "repeated",
                        "severity": "low",
                        "text": f"Repeating '{rep['name']}' in {rep['course']} ({rep['attempts']} attempts)",
                    })
            if school_xp < xp_goal and school_days > 0:
                pct = round(100 * school_xp / xp_goal) if xp_goal > 0 else 0
                last_xp = xp_details.get("last_xp_date")
                xp_text = f"XP behind target: {round(school_xp)}/{round(xp_goal)} ({pct}%)"
                if last_xp:
                    xp_text += f" — last XP earned {last_xp}"
                insights.append({
                    "type": "goal_xp",
                    "severity": "medium",
                    "text": xp_text,
                })
            if enrollment_mismatch:
                insights.append({
                    "type": "enrollment_mismatch",
                    "severity": "medium",
                    "text": enrollment_mismatch,
                })
            if stale:
                insights.append({
                    "type": "stale_enrollment",
                    "severity": "medium",
                    "text": f"Still enrolled in last year's class: {', '.join(stale)}",
                })
            if days_inactive >= 5 and student_enrollments:
                if never_active_this_session:
                    inactive_text = f"No writing activity this session ({days_inactive} school days)"
                else:
                    inactive_text = f"No writing activity for {days_inactive} school days (last XP {last_xp_date_str})"
                insights.append({
                    "type": "inactive",
                    "severity": "high" if days_inactive >= 10 else "medium",
                    "text": inactive_text,
                })

        # Test summary stats (from all-time api_tests)
        passed_tests = [t for t in api_tests if t["passed"]]
        test_summary = {
            "total_taken": len(api_tests),
            "total_passed": len(passed_tests),
            "end_of_course_passed": sum(1 for t in passed_tests if t["test_type"] == "end of course"),
            "test_outs_passed": sum(1 for t in passed_tests if t["test_type"] == "test out"),
            "placement_passed": sum(1 for t in passed_tests if t["test_type"] == "placement"),
        }

        # Effective grade: from the 25-26 export when given, else carried forward from the
        # prior year's snapshot (labelled by date); S1 cohort from snapshot names when given,
        # else from the first XP date of this year against the student's calendar.
        name_key = profile.full_name.lower()
        if eg_by_name:
            eg_value, lang_eg_value = eg_by_name.get(name_key), lang_eg_by_name.get(name_key)
            eg_as_of = "2026-03-09" if eg_value is not None else None
        elif email.lower() in prior_eg:
            eg_value = prior_eg[email.lower()]["effective_grade"]
            lang_eg_value = prior_eg[email.lower()]["language_eg"]
            eg_as_of = "2026-03-09"
        else:
            eg_value, lang_eg_value, eg_as_of = None, None, None
        if s1_names:
            s1_flag = name_key in s1_names
        else:
            s1_flag = is_s1_cohort(first_writing_date, year, cal_key)
        first_date_for_session = first_writing_date or (api_tests[0]["date"] if api_tests else None)

        students.append({
            "id": sid,
            "name": profile.full_name,
            "email": email,
            "campus": roster_campus,
            "calendar": cal_key,
            "dashboard": dash_group,
            "level": level,
            "age_grade": profile.age_grade,
            "hmg": hmg,
            "starting_hmg": starting_hmg,
            "starting_hmg_basis": starting_hmg_basis,
            "grades_advanced": hmg - starting_hmg,
            "linked_ids": linked_ids,
            "stale_enrollments": stale,
            "effective_grade": eg_value,
            "effective_grades_mastered": (max(0, hmg - (eg_value - 1)) if eg_value else None),
            "language_eg": lang_eg_value,
            "eg_as_of": eg_as_of,
            "s1_cohort": s1_flag,
            "start_session": cal.session_for_date(year, cal_key, first_date_for_session) if first_date_for_session else None,
            "completed_g8": completed_g8,
            "enrollments": student_enrollments,
            "still_enrolled": bool(student_enrollments),
            "last_test": last_test,
            "next_expected_test": next_test,
            "all_tests": api_tests,
            "test_summary": test_summary,
            "xp": {
                "alphawrite": round(alphawrite_xp, 1),
                "mastery_track": round(mastery_track_xp, 1),
                "test": round(test_xp_val, 1),
                "total": round(total_xp, 1),
                "school": round(school_xp, 1),
                "break": round(break_xp, 1),
                "goal_to_date": round(xp_goal, 1),
                "avg_per_day": avg_xp,
                "meets_goal": school_xp >= xp_goal,
                "last_xp_date": xp_details.get("last_xp_date"),
                "total_activities": total_writing_activities,
                "active_days": writing_active_days,
                "available_days": available_days,
                "avg_xp_per_day_lifetime": avg_xp_per_day,
                "first_activity_date": first_writing_date,
            },
            "xp_details": {k: v for k, v in xp_details.items() if k != "writing_active_dates_set"},
            "session_tests": session_tests,
            "accuracy": {
                "activities_below_threshold": low_accuracy,
                "repeated_activities": repeated,
            },
            "deep_dive": {
                "needed": dd_needed if not completed_g8 else False,
                "details": dd_details if not completed_g8 else [],
            },
            "insights": insights,
            "enrollment_mismatch": enrollment_mismatch,
            "inactivity": {
                "days_inactive": days_inactive,
                "never_active_this_session": never_active_this_session,
                "last_xp_date": last_xp_date_str,
            },
        })

    logger.info("Merged histories for %d students with linked accounts", merged_count)
    _COURSE_SUBJECTS.save()
    _LESSON_NAMES.save()

    limit_failures = fetch_failure_limit(processed)
    if len(failed_fetches) > limit_failures:
        raise RuntimeError(
            f"{len(failed_fetches)} students failed API fetch after retries (limit {limit_failures} "
            f"for {processed} processed); the API is likely unavailable. Output NOT written. First: "
            + ", ".join(f["email"] for f in failed_fetches[:5])
        )
    if failed_fetches:
        logger.error("%d student(s) skipped today after fetch failures: %s",
                     len(failed_fetches), ", ".join(f["email"] for f in failed_fetches))

    # Calendars (sessions + holidays) for the frontend; all_sessions kept for compatibility
    primary_key = cal.calendar_keys(year)[0]
    calendars_out = {
        k: {"first_day": cal.get_calendar(year, k).get("first_day"),
            "sessions": cal.sessions_with_labels(year, k),
            "holidays": cal.get_calendar(year, k).get("holidays", [])}
        for k in cal.calendar_keys(year)
    }
    campus_calendar = {s["campus"]: s["calendar"] for s in students}

    # Top-level structure
    dashboard = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "year": year,
        "as_of": as_of_str,
        "session": {**windows[primary_key], "by_calendar": windows},
        "all_sessions": calendars_out[primary_key]["sessions"],
        "calendars": calendars_out,
        "campus_calendar": campus_calendar,
        "thresholds": {
            "xp_per_day": XP_GOAL_PER_DAY,
            "minutes_per_day": MINUTES_GOAL_PER_DAY,
            "accuracy_pct": ACCURACY_THRESHOLD,
            "pass_score": PASS_THRESHOLD,
        },
        "students": students,
        "fetch_failures": failed_fetches,
    }

    return dashboard


def main():
    parser = argparse.ArgumentParser(description="Collect Writing dashboard data")
    parser.add_argument("csv", help="Path to writing-results CSV")
    parser.add_argument("--year", default=CURRENT_YEAR, choices=list(SCHOOL_YEARS.keys()))
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD; defaults to today")
    parser.add_argument("--output", default=None, help="Output JSON path (default data/<year>/data.json)")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N students (smoke test)")
    parser.add_argument("--skip-analysis", action="store_true",
                        help="Skip Claude deep dive analysis (faster)")
    parser.add_argument("--effective-grades", default=None,
                        help="Path to Student Progress Tracker CSV with effective grades (25-26)")
    parser.add_argument("--s1-snapshot", default=None,
                        help="Path to S1 Snapshot Excel for S1 cohort identification (25-26)")
    parser.add_argument("--prior-year-data", default=None,
                        help="Previous year's data.json for EG carry-forward (default data/2025-26/data.json when --year 2026-27)")
    parser.add_argument("--allow-small-csv", action="store_true",
                        help=f"Proceed even if the CSV has fewer than {MIN_CSV_ROWS} rows (normally a sign of a filtered export)")
    args = parser.parse_args()

    as_of = datetime.strptime(args.as_of, "%Y-%m-%d") if args.as_of else datetime.now()
    output = Path(args.output) if args.output else output_path_for(args.year)

    prior_year_data = None
    prior_path = args.prior_year_data
    if prior_path is None and args.year == "2026-27":
        prior_path = str(output_path_for("2025-26"))
    if prior_path and Path(prior_path).exists():
        prior_year_data = json.loads(Path(prior_path).read_text(encoding="utf-8"))
        logger.info("Loaded prior-year data from %s", prior_path)

    data = collect(args.csv, args.year, as_of, skip_analysis=args.skip_analysis,
                   effective_grades_csv=args.effective_grades,
                   s1_snapshot_path=args.s1_snapshot,
                   limit=args.limit, prior_year_data=prior_year_data,
                   allow_small_csv=args.allow_small_csv)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Dashboard data written to %s (%d students)", output, len(data["students"]))


if __name__ == "__main__":
    main()
