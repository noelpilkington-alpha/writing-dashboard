"""Collect all Writing student data and generate dashboard JSON."""

import argparse
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Add parent dir to path so we can import writing_automation
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from writing_automation.api_client import TimebackAPI
from writing_automation.config import (
    GRADE_SEQUENCES,
    MINUTES_GOAL_PER_DAY,
    PASS_THRESHOLD,
    RUSH_THRESHOLD,
    SESSIONS,
    XP_GOAL_PER_DAY,
)
from writing_automation.csv_loader import load_csv
from writing_automation.deep_dive import detect_deep_dives
from writing_automation.deep_dive_analysis import identify_deep_dive_tests, is_rushed
from writing_automation.enrollment_fetcher import (
    fetch_student_profiles,
    fetch_writing_enrollments,
)
from writing_automation.hmg_calculator import compute_all_hmg
from writing_automation.student_progress import _get_level, _school_days_to_date
from writing_automation.test_type_mapper import classify_test_types
from writing_automation.xp_fetcher import fetch_xp_and_minutes

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

GRADEBOOK_BASE = "/ims/oneroster/gradebook/v1p2"
ACCURACY_THRESHOLD = 80
OUTPUT_PATH = Path(__file__).resolve().parent / "data.json"

# Campuses to exclude from the dashboard
EXCLUDED_CAMPUSES = {
    "AIE Elite Prep",
    "Alpha Austin 25' AI Summer Camp",
    "Alpha Internal Test School",
    "AlphaLearn",
    "BeyondAI",
    "Beyond AI",
    "Guide School",
    "High School SAT Prep",
    "Mock School Org",
    "SPEEDRUN",
    "Speedrun",
    "School In The Hills",
    "School in the Hills",
    "Trilogy Central Support",
}

# Email patterns that indicate shadow/test accounts
_EXCLUDE_EMAIL_PATTERNS = [
    "shadow",
    "test.account",
    "guide.sixth",
    "guide.fifth",
    "leman.student",
    "leman.test",
    "deleted_",
    "timeback",
    "studyreeltest",
    "stc3@",
    "gt.shadow",
    "austinhs.shadow",
    "alpha.san.francisco.shadow",
    "stimeback@",
    "cs-test",
]


def _is_excluded_account(email: str) -> bool:
    """Return True if the email matches a shadow/test account pattern."""
    email_lower = email.lower()
    return any(pat in email_lower for pat in _EXCLUDE_EMAIL_PATTERNS)


# ---------------------------------------------------------------------------
# AlphaWrite skill plan name mapping
# ---------------------------------------------------------------------------

def _load_skill_plan() -> dict[str, tuple[str, str]]:
    """Load AlphaWrite skill plan from xlsx and return {skill_id: (name, course)} mapping."""
    skill_plan_path = Path(__file__).resolve().parent.parent / "AlphaWrite Skill Plan 2025_2026 (1).xlsx"
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


def _resolve_activity_name(ali_sid: str, meta: dict) -> tuple[str, str] | None:
    """Resolve an AlphaWrite activity to (readable_name, course).
    Returns None if the activity is not an AlphaWrite activity."""
    # Only process AlphaWrite activities
    if not ali_sid.startswith("alphawrite-"):
        return None

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

def fetch_writing_test_results(
    api: TimebackAPI, student_id: str
) -> list[dict]:
    """Fetch standardized writing test results from the API for a student."""
    try:
        data = api.get(
            f"{GRADEBOOK_BASE}/assessmentResults/",
            {
                "limit": 100,
                "filter": (
                    f"student.sourcedId='{student_id}'"
                    " AND metadata.subject='Writing'"
                    " AND metadata.resultType='assessment'"
                ),
            },
        )
        results = []
        for r in data.get("assessmentResults", []):
            meta = r.get("metadata", {})
            results.append({
                "name": meta.get("testName", ""),
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
        return results
    except Exception as e:
        logger.warning("Failed to fetch test results for %s: %s", student_id, e)
        return []


def fetch_activity_results(
    api: TimebackAPI, student_id: str, session_start: str, session_end: str
) -> list[dict]:
    """Fetch per-activity assessment results for a student within a session."""
    try:
        data = api.get(
            f"{GRADEBOOK_BASE}/assessmentResults/",
            {
                "limit": 3000,
                "filter": (
                    f"student.sourcedId='{student_id}'"
                    f" AND scoreDate>='{session_start}'"
                    f" AND scoreDate<='{session_end}'"
                ),
            },
        )
        return data.get("assessmentResults", [])
    except Exception as e:
        logger.warning("Failed to fetch activities for %s: %s", student_id, e)
        return []


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
    """Infer the next expected test based on HMG and test history."""
    if hmg >= 8:
        return None  # Completed all grades

    next_grade = hmg + 1
    max_seq = GRADE_SEQUENCES.get(next_grade, 0)
    if max_seq == 0:
        return None

    # Find highest passed sequence at next_grade
    passed_seqs = set()
    for t in test_history:
        name = t.get("name", "")
        if f"G{next_grade}." in name and t.get("passed"):
            # Extract sequence number
            try:
                seq = int(name.split(f"G{next_grade}.")[1].split()[0])
                passed_seqs.add(seq)
            except (IndexError, ValueError):
                pass

    # Next sequence is highest_passed + 1, or 1 if none passed
    if passed_seqs:
        next_seq = max(passed_seqs) + 1
        if next_seq > max_seq:
            # All tests at this grade passed — HMG should advance
            return None
    else:
        next_seq = 1

    # Check if this test already exists in history (taken but not passed)
    test_name = f"G{next_grade}.{next_seq}"
    taken = any(
        f"G{next_grade}.{next_seq}" in t.get("name", "")
        for t in test_history
        if not t.get("passed") and t.get("date", "") >= "2026-01-01"
    )

    return {
        "name": test_name,
        "reason": f"HMG is G{hmg}, next in sequence is G{next_grade}.{next_seq}",
        "status": "retaking" if taken else "pending",
    }


# ---------------------------------------------------------------------------
# Main collector
# ---------------------------------------------------------------------------

def collect(csv_path: str, session_name: str) -> dict:
    """Collect all data and return the dashboard JSON structure."""
    session = SESSIONS[session_name]
    session_start = session["start"]
    session_end = session["end"]
    school_days = _school_days_to_date(session_name)

    # 1. Load CSV
    logger.info("Loading CSV: %s", csv_path)
    csv_results = load_csv(csv_path)
    logger.info("Loaded %d CSV results", len(csv_results))

    # 2. Init API
    logger.info("Initializing Timeback API...")
    api = TimebackAPI()

    # 3. Fetch enrollments + profiles
    logger.info("Fetching Writing enrollments...")
    enrollments = fetch_writing_enrollments(api)
    student_ids = set(enrollments.keys())
    logger.info("Found %d enrolled students", len(student_ids))

    logger.info("Fetching student profiles...")
    profiles = fetch_student_profiles(api, student_ids)

    # 4. Fetch XP/minutes
    logger.info("Fetching XP/minutes data...")
    xp_data = fetch_xp_and_minutes(api, session_start, session_end)

    # 5. Compute HMG + classify
    hmg_map = compute_all_hmg(csv_results)
    classifications = classify_test_types(csv_results)

    # 6. Detect deep dives
    deep_dives = detect_deep_dives(csv_results)
    deep_dive_tests = identify_deep_dive_tests(csv_results, deep_dives, session_name)

    # 7. Build email -> csv results map
    csv_by_email: dict[str, list] = defaultdict(list)
    for r in csv_results:
        csv_by_email[r.student_email].append(r)

    # 8. Goals
    xp_goal = XP_GOAL_PER_DAY * school_days
    minutes_goal = MINUTES_GOAL_PER_DAY * school_days

    # 9. Assemble per-student data
    students = []
    total = len(student_ids)
    for idx, sid in enumerate(sorted(student_ids), 1):
        profile = profiles.get(sid)
        if not profile:
            continue

        email = profile.email

        # Skip excluded campuses and shadow/test accounts
        if profile.org_name in EXCLUDED_CAMPUSES:
            continue
        if _is_excluded_account(email):
            continue

        logger.info("Processing student %d/%d: %s", idx, total, email)

        # Enrollments
        student_enrollments = enrollments.get(sid, [])

        # HMG
        hmg = hmg_map.get(email, 2)
        starting_hmg = 2
        student_csv = csv_by_email.get(email, [])
        if student_csv:
            placement = [r for r in student_csv if r.csv_test_type == "Placement"]
            if placement:
                passed = {r.test_grade for r in placement if r.score >= PASS_THRESHOLD}
                for g in range(3, 9):
                    if g in passed:
                        starting_hmg = g
                    else:
                        break

        # Level
        level = _get_level(profile.age_grade)

        # XP/Minutes
        xp = xp_data.get(email)
        alphawrite_xp = xp.alphawrite_xp if xp else 0
        mastery_track_xp = xp.mastery_track_xp if xp else 0
        test_xp = xp.test_xp if xp else 0
        total_xp = alphawrite_xp + mastery_track_xp + test_xp
        total_minutes = xp.total_minutes if xp else 0
        avg_xp = round(total_xp / school_days, 1) if school_days else 0
        avg_min = round(total_minutes / school_days, 1) if school_days else 0

        # Fetch test history from API
        api_tests = fetch_writing_test_results(api, sid)

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

        # Next expected test
        next_test = infer_next_test(hmg, api_tests)

        # Deep dive
        dd_needed = any((email, g) in deep_dives for g in range(3, 9))
        dd_details = []
        for (dd_email, dd_grade), dd_tests in deep_dive_tests.items():
            if dd_email != email:
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
            })

        # Fetch activity results for accuracy analysis
        raw_activities = fetch_activity_results(api, sid, session_start, session_end)
        low_accuracy = extract_low_accuracy_activities(raw_activities)
        repeated = extract_repeated_activities(raw_activities)

        # Enrollment mismatch
        enrollment_mismatch = None
        if student_enrollments and hmg < 8:
            import re
            expected = hmg + 1
            enrolled_grades = []
            for e in student_enrollments:
                m = re.search(r"G(\d+)", e)
                if m:
                    enrolled_grades.append(int(m.group(1)))
            if enrolled_grades and expected not in enrolled_grades:
                actual = ", ".join(f"G{g}" for g in enrolled_grades)
                enrollment_mismatch = f"Expected G{expected}, enrolled in {actual}"

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
        if total_xp < xp_goal and school_days > 0:
            pct = round(100 * total_xp / xp_goal) if xp_goal > 0 else 0
            insights.append({
                "type": "goal_xp",
                "severity": "medium",
                "text": f"XP behind target: {round(total_xp)}/{round(xp_goal)} ({pct}%)",
            })
        if total_minutes < minutes_goal and school_days > 0:
            pct = round(100 * total_minutes / minutes_goal) if minutes_goal > 0 else 0
            insights.append({
                "type": "goal_minutes",
                "severity": "medium",
                "text": f"Time behind target: {round(total_minutes)}/{round(minutes_goal)} min ({pct}%)",
            })
        if enrollment_mismatch:
            insights.append({
                "type": "enrollment_mismatch",
                "severity": "medium",
                "text": enrollment_mismatch,
            })

        students.append({
            "id": sid,
            "name": profile.full_name,
            "email": email,
            "campus": profile.org_name,
            "level": level,
            "age_grade": profile.age_grade,
            "hmg": hmg,
            "starting_hmg": starting_hmg,
            "grades_advanced": hmg - starting_hmg,
            "enrollments": student_enrollments,
            "still_enrolled": bool(student_enrollments),
            "last_test": last_test,
            "next_expected_test": next_test,
            "xp": {
                "alphawrite": round(alphawrite_xp, 1),
                "mastery_track": round(mastery_track_xp, 1),
                "test": round(test_xp, 1),
                "total": round(total_xp, 1),
                "goal_to_date": round(xp_goal, 1),
                "avg_per_day": avg_xp,
                "meets_goal": total_xp >= xp_goal,
            },
            "minutes": {
                "total": round(total_minutes, 1),
                "goal_to_date": round(minutes_goal, 1),
                "avg_per_day": avg_min,
                "meets_goal": total_minutes >= minutes_goal,
            },
            "session_tests": session_tests,
            "accuracy": {
                "activities_below_threshold": low_accuracy,
                "repeated_activities": repeated,
            },
            "deep_dive": {
                "needed": dd_needed,
                "details": dd_details,
            },
            "insights": insights,
            "enrollment_mismatch": enrollment_mismatch,
        })

    # Top-level structure
    dashboard = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "session": {
            "name": session_name,
            "start": session_start,
            "end": session_end,
            "school_start": session.get("school_start", session_start),
            "school_days_elapsed": school_days,
        },
        "thresholds": {
            "xp_per_day": XP_GOAL_PER_DAY,
            "minutes_per_day": MINUTES_GOAL_PER_DAY,
            "accuracy_pct": ACCURACY_THRESHOLD,
            "pass_score": PASS_THRESHOLD,
        },
        "students": students,
    }

    return dashboard


def main():
    parser = argparse.ArgumentParser(description="Collect Writing dashboard data")
    parser.add_argument("csv", help="Path to writing-results CSV")
    parser.add_argument("--session", default="S4", choices=list(SESSIONS.keys()))
    parser.add_argument("--output", default=str(OUTPUT_PATH), help="Output JSON path")
    args = parser.parse_args()

    data = collect(args.csv, args.session)

    output = Path(args.output)
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Dashboard data written to %s (%d students)", output, len(data["students"]))


if __name__ == "__main__":
    main()
