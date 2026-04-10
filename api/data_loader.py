"""Load and index dashboard JSON data for the API."""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

_data: dict = {}
_loop_data: dict = {}
_students_by_id: dict[str, dict] = {}
_loop_students_by_id: dict[str, dict] = {}


def load_all():
    """Load data.json and loop_data.json, build indexes."""
    global _data, _loop_data, _students_by_id, _loop_students_by_id

    data_path = ROOT / "data.json"
    loop_path = ROOT / "loop_data.json"

    with open(data_path) as f:
        _data = json.load(f)
    logger.info("Loaded data.json: %d students", len(_data.get("students", [])))

    if loop_path.exists():
        with open(loop_path) as f:
            _loop_data = json.load(f)
        logger.info("Loaded loop_data.json: %d loop students", len(_loop_data.get("students", [])))
    else:
        _loop_data = {"students": [], "trends": {}}

    _students_by_id = {s["id"]: s for s in _data.get("students", [])}
    _loop_students_by_id = {s["id"]: s for s in _loop_data.get("students", [])}


def get_metadata() -> dict:
    """Return top-level metadata (session, thresholds, etc.)."""
    return {
        "generated_at": _data.get("generated_at", ""),
        "session": _data.get("session", {}),
        "all_sessions": _data.get("all_sessions", {}),
        "thresholds": _data.get("thresholds", {}),
    }


# -- Student summary fields (stripped of heavy nested data) --
_SUMMARY_FIELDS = {
    "id", "name", "email", "campus", "dashboard", "level", "age_grade",
    "hmg", "starting_hmg", "grades_advanced", "effective_grade",
    "language_eg", "s1_cohort", "completed_g8", "still_enrolled",
    "last_test", "next_expected_test", "test_summary", "xp",
    "insights", "enrollment_mismatch",
}


def _student_summary(s: dict) -> dict:
    return {k: v for k, v in s.items() if k in _SUMMARY_FIELDS}


def get_students(
    campus: str | None = None,
    level: str | None = None,
    grade: int | None = None,
    search: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[dict], int]:
    """Filter and paginate students. Returns (summaries, total_count)."""
    results = _data.get("students", [])

    if campus:
        campus_lower = campus.lower()
        results = [s for s in results if s.get("campus", "").lower() == campus_lower]
    if level:
        level_lower = level.lower()
        results = [s for s in results if s.get("level", "").lower() == level_lower]
    if grade is not None:
        results = [s for s in results if s.get("age_grade") == grade]
    if search:
        q = search.lower()
        results = [
            s for s in results
            if q in s.get("name", "").lower() or q in s.get("email", "").lower()
        ]

    total = len(results)
    page = results[skip : skip + limit]
    return [_student_summary(s) for s in page], total


def get_student(student_id: str) -> dict | None:
    """Return full student record by ID."""
    return _students_by_id.get(student_id)


def get_loop_students(
    campus: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Return loop students, optionally filtered."""
    results = _loop_data.get("students", [])
    if campus:
        campus_lower = campus.lower()
        results = [s for s in results if s.get("campus", "").lower() == campus_lower]
    if search:
        q = search.lower()
        results = [
            s for s in results
            if q in s.get("name", "").lower() or q in s.get("email", "").lower()
        ]
    return results


def get_loop_student(student_id: str) -> dict | None:
    """Return full loop student record by ID."""
    return _loop_students_by_id.get(student_id)


def get_loop_trends() -> dict:
    """Return general trends analysis from loop data."""
    return _loop_data.get("trends", {})


def get_session_stats() -> dict:
    """Compute per-session aggregate statistics."""
    students = _data.get("students", [])
    all_sessions = _data.get("all_sessions", {})
    threshold = _data.get("thresholds", {}).get("pass", 87)

    stats = {}
    for session_name, session_info in all_sessions.items():
        start = session_info.get("start", "")
        end = session_info.get("end", "")

        tests_taken = 0
        tests_passed = 0
        unique_testers = set()
        unique_passers = set()
        scores = []

        for s in students:
            for t in s.get("all_tests", []):
                date = t.get("date", "")
                if start <= date <= end:
                    tests_taken += 1
                    unique_testers.add(s["id"])
                    score = t.get("score", 0)
                    scores.append(score)
                    if score >= threshold:
                        tests_passed += 1
                        unique_passers.add(s["id"])

        stats[session_name] = {
            "start": start,
            "end": end,
            "tests_taken": tests_taken,
            "tests_passed": tests_passed,
            "pass_rate": round(tests_passed / tests_taken * 100, 1) if tests_taken else 0,
            "unique_testers": len(unique_testers),
            "unique_passers": len(unique_passers),
            "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
        }

    return stats


def get_pass_rates() -> list[dict]:
    """Compute pass rates broken down by grade level."""
    students = _data.get("students", [])
    threshold = _data.get("thresholds", {}).get("pass", 87)

    by_grade: dict[int, dict] = {}
    for s in students:
        for t in s.get("all_tests", []):
            import re
            m = re.search(r"G(\d+)\.", t.get("name", ""))
            if not m:
                continue
            grade = int(m.group(1))
            if grade not in by_grade:
                by_grade[grade] = {"total": 0, "passed": 0, "scores": []}
            by_grade[grade]["total"] += 1
            score = t.get("score", 0)
            by_grade[grade]["scores"].append(score)
            if score >= threshold:
                by_grade[grade]["passed"] += 1

    result = []
    for grade in sorted(by_grade):
        g = by_grade[grade]
        result.append({
            "grade": grade,
            "total_tests": g["total"],
            "passed": g["passed"],
            "pass_rate": round(g["passed"] / g["total"] * 100, 1) if g["total"] else 0,
            "avg_score": round(sum(g["scores"]) / len(g["scores"]), 1) if g["scores"] else 0,
        })
    return result
