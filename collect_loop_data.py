"""Collect detailed data for students stuck in testing loops.

Reads data.json to identify loop students, fetches their full test content
(with caching), pulls AlphaWrite activity data, runs Claude analysis,
and writes loop_data.json for the dashboard.
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from writing_automation.api_client import TimebackAPI
from writing_automation.config import (
    ALPHA_SESSION_COOKIE_ENV,
    ENV_FILE,
    PASS_THRESHOLD,
    RUSH_THRESHOLD,
    SESSIONS,
)
from writing_automation.deep_dive_analysis import is_rushed
from writing_automation.test_fetcher import fetch_page, parse_test_page

from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

GRADEBOOK_BASE = "/ims/oneroster/gradebook/v1p2"
OUTPUT_PATH = Path(__file__).resolve().parent / "loop_data.json"
DATA_PATH = Path(__file__).resolve().parent / "data.json"

# Manual overrides — students who should be in the testing loop but aren't
# auto-detected (e.g., test types are "test out" or "placement" instead of
# "end of course", or below the 3-failure threshold).
MANUAL_LOOP_EMAILS = {
    "austin.pederson@2hourlearning.com",
    "ford.radde@2hourlearning.com",
}


def _is_alphawrite(sid: str) -> bool:
    return sid.startswith("alphawrite-") or sid.startswith("alphawrite:")


def _build_deep_dive_details(student: dict) -> list[dict]:
    """Build deep_dive details for a manually overridden student from all_tests."""
    by_grade = defaultdict(list)
    for t in student.get("all_tests", []):
        m = re.search(r"G(\d+)\.", t.get("name", ""))
        if m:
            by_grade[int(m.group(1))].append(t)

    hmg = student.get("hmg", 0) or 0
    details = []
    for grade, tests in sorted(by_grade.items()):
        if grade <= hmg:
            continue
        failed = [t for t in tests if not t.get("passed")]
        if len(failed) < 2:
            continue
        details.append({
            "grade": grade,
            "total_tests": len(tests),
            "failed_count": len(failed),
            "rushed_count": 0,
            "avg_time_minutes": 0,
            "tests": [
                {
                    "name": t.get("name", ""),
                    "score": t.get("score", 0),
                    "date": t.get("date", ""),
                    "rushed": False,
                }
                for t in tests
            ],
        })
    return details


def get_loop_students(data: dict) -> list[dict]:
    """Extract students with deep_dive.needed == True or in manual overrides."""
    loop = []
    seen_ids = set()
    for s in data["students"]:
        dd = s.get("deep_dive", {})
        if dd.get("needed"):
            loop.append(s)
            seen_ids.add(s.get("id"))

    # Add manually overridden students
    for s in data["students"]:
        if s.get("id") in seen_ids:
            continue
        if s.get("email", "").lower() in MANUAL_LOOP_EMAILS:
            details = _build_deep_dive_details(s)
            if details:
                s["deep_dive"] = {"needed": True, "details": details}
                loop.append(s)
                seen_ids.add(s.get("id"))
                logger.info("Manual override: added %s to loop students", s["name"])

    return loop


def fetch_alphawrite_activities(api: TimebackAPI, student_id: str) -> list[dict]:
    """Fetch all AlphaWrite activity results for a student (full school year)."""
    try:
        data = api.get(
            f"{GRADEBOOK_BASE}/assessmentResults/",
            {
                "limit": 3000,
                "filter": (
                    f"student.sourcedId='{student_id}'"
                    " AND scoreDate>='2025-08-01'"
                    " AND scoreDate<='2026-06-30'"
                ),
            },
        )
        results = []
        for r in data.get("assessmentResults", []):
            ali_sid = r.get("assessmentLineItem", {}).get("sourcedId", "")
            if not _is_alphawrite(ali_sid):
                continue
            meta = r.get("metadata", {})
            results.append({
                "ali_sid": ali_sid,
                "activity": meta.get("activity", ""),
                "accuracy": meta.get("accuracy"),
                "mastered_units": meta.get("masteredUnits"),
                "difficulty": meta.get("difficulty"),
                "xp": meta.get("xp", 0),
                "total_questions": meta.get("totalQuestions"),
                "correct_questions": meta.get("correctQuestions"),
                "attempt": meta.get("attemptNumber", meta.get("attempt", 1)),
                "date": (r.get("scoreDate") or "")[:10],
                "score": r.get("score"),
            })
        return results
    except Exception as e:
        logger.warning("Failed to fetch AlphaWrite activities for %s: %s", student_id, e)
        return []


def parse_skill_from_ali(ali_sid: str) -> dict:
    """Parse an AlphaWrite ali_sid into structured skill info."""
    info = {"course": "", "skill": "", "grade": None}

    if ali_sid.startswith("alphawrite:compositions:"):
        parts = ali_sid.split(":")
        if len(parts) >= 3:
            info["course"] = parts[2].replace("-", " ").title()
        if len(parts) >= 5:
            stage = parts[4].replace("stage-", "").replace("-", " ").title()
            info["skill"] = stage
        m = re.search(r"g(\d+)", ali_sid)
        if m:
            info["grade"] = int(m.group(1))
        return info

    clean = ali_sid.replace("-assessment-line-item", "").lower()

    # Detect course and grade
    course_patterns = [
        (r"sentences-vi(?:-|$)", "Sentences G8", 8),
        (r"sentences-v(?:-|$)", "Sentences G7", 7),
        (r"sentences-iv(?:-|$)", "Sentences G6", 6),
        (r"sentences-iii(?:-|$)", "Sentences G5", 5),
        (r"sentences-ii(?:-|$)", "Sentences G4", 4),
        (r"sentences-i(?:-|$)", "Sentences G3", 3),
        (r"paragraphs-g(\d+)", None, None),
    ]
    for pattern, course, grade in course_patterns:
        m = re.search(pattern, clean)
        if m:
            if course is None:
                g = int(m.group(1))
                info["course"] = f"Paragraphs G{g}"
                info["grade"] = g
            else:
                info["course"] = course
                info["grade"] = grade
            break

    # Extract skill name from the end of the ali_sid
    parts = clean.split("-", 3)
    if len(parts) >= 4:
        info["skill"] = parts[3].replace("-", " ").title()
    else:
        info["skill"] = clean.replace("alphawrite-", "").replace("-", " ").title()

    return info


def group_activities_by_skill(activities: list[dict]) -> list[dict]:
    """Group AlphaWrite activities by skill, computing summary stats."""
    by_skill = defaultdict(list)
    for a in activities:
        skill_info = parse_skill_from_ali(a["ali_sid"])
        key = (skill_info["course"], skill_info["skill"])
        by_skill[key].append({**a, **skill_info})

    skills = []
    for (course, skill_name), attempts in by_skill.items():
        accuracies = [a["accuracy"] for a in attempts if a["accuracy"] is not None]
        grades = [a["grade"] for a in attempts if a.get("grade")]
        grade = grades[0] if grades else None

        # Sort by date
        attempts.sort(key=lambda x: x.get("date", ""))

        # Detect depreciation: accuracy decreasing over recent attempts
        depreciating = False
        if len(accuracies) >= 3:
            recent = accuracies[-3:]
            if recent[-1] < recent[0] and recent[-1] < 80:
                depreciating = True

        skills.append({
            "course": course,
            "skill": skill_name,
            "grade": grade,
            "attempts": len(attempts),
            "best_accuracy": max(accuracies) if accuracies else None,
            "latest_accuracy": accuracies[-1] if accuracies else None,
            "avg_accuracy": round(sum(accuracies) / len(accuracies), 1) if accuracies else None,
            "mastered": any(a.get("mastered_units") and a["mastered_units"] > 0 for a in attempts),
            "depreciating": depreciating,
            "total_xp": sum(a.get("xp", 0) or 0 for a in attempts),
            "dates": [a["date"] for a in attempts if a.get("date")],
        })

    skills.sort(key=lambda x: (x["course"] or "", x["skill"] or ""))
    return skills


def fetch_and_parse_student_tests(student: dict, session_cookie: str) -> list[dict]:
    """Fetch and parse all failed Writing test pages for a loop student."""
    parsed_tests = []

    for dd in student.get("deep_dive", {}).get("details", []):
        grade = dd.get("grade")
        for t in dd.get("tests", []):
            # We need the assignment_id and test_link from all_tests
            test_name = t.get("name", "")
            test_date = t.get("date", "")
            score = t.get("score", 0)

            # Find matching entry in all_tests to get the URL
            match = None
            for at in student.get("all_tests", []):
                if at.get("name") == test_name and at.get("date") == test_date:
                    match = at
                    break

            if not match or not match.get("test_link") or not match.get("assignment_id"):
                continue

            test_id = str(match["assignment_id"])
            # Use timebackanalytics.com URL — the API's testLink points to
            # alphatest.alpha.school which returns a Vite SPA stub, not the
            # actual test page with question data.
            url = f"https://timebackanalytics.com/test/{test_id}"

            html, status = fetch_page(url, test_id, session_cookie)
            if html is None:
                logger.warning("  Failed to fetch %s: %s", test_name, status)
                continue

            if "accounts.google.com" in html[:500]:
                logger.error("  Session cookie expired!")
                sys.exit(1)

            parsed = parse_test_page(html)
            if parsed is None:
                logger.warning("  Failed to parse %s", test_name)
                continue

            parsed["grade"] = grade
            parsed["csv_score"] = score
            parsed["csv_date"] = test_date
            parsed["rushed"] = t.get("rushed", False)

            if status == "fetched":
                time.sleep(0.3)

            parsed_tests.append(parsed)

    return parsed_tests


def build_test_analysis_data(parsed_tests: list[dict]) -> list[dict]:
    """Convert parsed tests into structured analysis-ready data."""
    test_data = []
    for pt in parsed_tests:
        questions = []
        for q in pt.get("questions", []):
            questions.append({
                "number": q.get("question_number"),
                "title": q.get("question_title", ""),
                "type": q.get("question_type", ""),
                "prompt": q.get("prompt", "")[:500],
                "student_answer": str(q.get("student_answer", "")),
                "correct_fraction": q.get("correct_fraction"),
                "max_score": q.get("max_score", 1),
                "actual_score": q.get("actual_score"),
                "standards": q.get("standards", []),
            })

        test_data.append({
            "test_name": pt.get("test_name", ""),
            "grade": pt.get("grade"),
            "score": pt.get("csv_score", pt.get("score")),
            "date": pt.get("csv_date", pt.get("score_date", "")),
            "time_taken": pt.get("time_taken", ""),
            "rushed": pt.get("rushed", False),
            "questions": questions,
            "total_questions": len(questions),
            "incorrect_questions": [
                q for q in questions
                if q.get("correct_fraction") is not None and q["correct_fraction"] < 1.0
            ],
        })

    return test_data


def build_student_analysis_prompt(student: dict, test_data: list[dict],
                                   skill_data: list[dict]) -> str:
    """Build a prompt for Claude to analyze a loop student comprehensively."""
    name = student["name"]
    hmg = student.get("hmg", "?")
    eg = student.get("effective_grade", "?")

    lines = [
        f"Analyze the testing loop patterns for {name} (HMG: G{hmg}, EG: G{eg}).",
        f"This student has failed 3+ tests at their current grade level.",
        "",
    ]

    # Test data summary
    for td in test_data:
        lines.append(f"--- {td['test_name']} (Score: {td['score']}%, Date: {td['date']}"
                     f"{', RUSHED' if td['rushed'] else ''}) ---")
        wrong = td["incorrect_questions"]
        if not wrong:
            lines.append("  All questions correct (failed due to scoring threshold).")
        else:
            for q in wrong[:8]:  # Limit to avoid token overflow
                lines.append(f"  Q{q['number']} ({q['title']}, {(q['correct_fraction'] or 0)*100:.0f}%):")
                if q["prompt"]:
                    lines.append(f"    Prompt: {q['prompt'][:200]}")
                if q["student_answer"]:
                    lines.append(f"    Answer: {q['student_answer'][:300]}")
                stds = q.get("standards", [])
                if stds:
                    lines.append(f"    Standards: {'; '.join(s['label'] + ': ' + s['description'] for s in stds[:3])}")
        lines.append("")

    # AlphaWrite skill performance
    if skill_data:
        lines.append("--- AlphaWrite Skill Plan Performance ---")
        # Focus on skills at or near the loop grade
        dd_details = student.get("deep_dive", {}).get("details", [])
        loop_grades = {d["grade"] for d in dd_details}

        relevant_skills = [s for s in skill_data if s.get("grade") in loop_grades or s.get("grade") is None]
        if not relevant_skills:
            relevant_skills = skill_data[:20]

        for sk in relevant_skills[:15]:
            mastered_flag = " [MASTERED]" if sk["mastered"] else ""
            deprec_flag = " [DEPRECIATING]" if sk["depreciating"] else ""
            lines.append(f"  {sk['course']} > {sk['skill']}: "
                        f"best={sk['best_accuracy']}%, latest={sk['latest_accuracy']}%, "
                        f"{sk['attempts']} attempts{mastered_flag}{deprec_flag}")
        lines.append("")

    lines.append("""
Based on the test and AlphaWrite data above, provide your analysis in EXACTLY this format:

PATTERN_SUMMARY: [2-3 sentences. What specific writing skill gaps are causing this student to stay in the testing loop? Reference specific question types and error patterns.]

SKILL_GAPS: [Comma-separated list of specific skill gaps, e.g. "appositive phrases, paragraph development, text evidence integration"]

ALPHAWRITE_VS_TEST: [1-2 sentences. Are there skills the student has mastered in AlphaWrite but still fails on tests? What disconnect exists?]

RUSHING_IMPACT: [1 sentence. If any tests were rushed, how much did rushing likely affect outcomes?]

RECOMMENDED_ACTIVITIES: [3-5 specific activities, each formatted as "ACTIVITY_NAME (COURSE): reason". These should be AlphaWrite activities or Writing Brainlift activities that target the identified skill gaps. Be specific - e.g. "Combine Sentences Using Appositives (Sentences G5): student consistently misses appositive construction questions".]

PRIORITY: [high/medium/low - how urgent is intervention for this student?]
""")

    return "\n".join(lines)


def build_general_trends_prompt(all_analyses: list[dict]) -> str:
    """Build prompt for Claude to analyze general trends across all loop students."""
    lines = [
        f"Analyze general trends across {len(all_analyses)} students stuck in writing testing loops.",
        "For each student, I'll provide their key metrics and identified skill gaps.",
        "",
    ]

    for a in all_analyses:
        name = a["name"]
        hmg = a.get("hmg", "?")
        loop_grades = [d["grade"] for d in a.get("loop_details", [])]
        skill_gaps = a.get("analysis", {}).get("skill_gaps", "unknown")
        n_tests = a.get("total_failed_tests", 0)
        rushed = a.get("total_rushed", 0)

        lines.append(f"- {name} (HMG G{hmg}, looping at G{','.join(str(g) for g in loop_grades)}, "
                     f"{n_tests} failed tests, {rushed} rushed): Gaps: {skill_gaps}")

    lines.append("""

Based on the above loop students, provide your analysis in EXACTLY this format:

COMMON_SKILL_GAPS: [List the top 5 most common skill gaps across all loop students, with counts. E.g. "Paragraph development (8/19 students), Appositive phrases (6/19), ..."]

CURRICULUM_GAPS: [2-3 sentences. Are there areas where the AlphaWrite curriculum may not be adequately preparing students for tests? What test skills seem under-represented in the activity plan?]

RUSHING_TRENDS: [1-2 sentences. How prevalent is rushing among loop students? What grades/test types are most affected?]

GRADE_LEVEL_PATTERNS: [Which grade levels have the most students stuck? What makes those grades particularly challenging?]

TOP_RECOMMENDATIONS: [3-5 system-level recommendations to reduce the number of students in testing loops. These should be actionable changes to curriculum, pacing, or intervention strategies.]
""")

    return "\n".join(lines)


def parse_student_analysis(text: str) -> dict:
    """Parse Claude's student-level analysis response."""
    fields = {}
    patterns = {
        "pattern_summary": r"PATTERN_SUMMARY:\s*(.+?)(?=\n\n|\nSKILL_GAPS:|\Z)",
        "skill_gaps": r"SKILL_GAPS:\s*(.+?)(?=\n\n|\nALPHAWRITE_VS_TEST:|\Z)",
        "alphawrite_vs_test": r"ALPHAWRITE_VS_TEST:\s*(.+?)(?=\n\n|\nRUSHING_IMPACT:|\Z)",
        "rushing_impact": r"RUSHING_IMPACT:\s*(.+?)(?=\n\n|\nRECOMMENDED_ACTIVITIES:|\Z)",
        "recommended_activities": r"RECOMMENDED_ACTIVITIES:\s*(.+?)(?=\n\n|\nPRIORITY:|\Z)",
        "priority": r"PRIORITY:\s*(.+?)(?=\n\n|\Z)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.DOTALL)
        fields[key] = m.group(1).strip() if m else ""
    return fields


def parse_trends_analysis(text: str) -> dict:
    """Parse Claude's general trends analysis response."""
    fields = {}
    patterns = {
        "common_skill_gaps": r"COMMON_SKILL_GAPS:\s*(.+?)(?=\n\n|\nCURRICULUM_GAPS:|\Z)",
        "curriculum_gaps": r"CURRICULUM_GAPS:\s*(.+?)(?=\n\n|\nRUSHING_TRENDS:|\Z)",
        "rushing_trends": r"RUSHING_TRENDS:\s*(.+?)(?=\n\n|\nGRADE_LEVEL_PATTERNS:|\Z)",
        "grade_level_patterns": r"GRADE_LEVEL_PATTERNS:\s*(.+?)(?=\n\n|\nTOP_RECOMMENDATIONS:|\Z)",
        "top_recommendations": r"TOP_RECOMMENDATIONS:\s*(.+?)(?=\n\n|\Z)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.DOTALL)
        fields[key] = m.group(1).strip() if m else ""
    return fields


def run_claude_analysis(prompt: str) -> str:
    """Run a prompt through Claude and return the response text."""
    import anthropic
    client = anthropic.AnthropicBedrock(
        aws_region=os.environ.get("AWS_REGION", "us-east-1"),
    )
    message = client.messages.create(
        model="us.anthropic.claude-sonnet-4-20250514-v1:0",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def main():
    parser = argparse.ArgumentParser(description="Collect testing loop data for dashboard")
    parser.add_argument("--output", default=str(OUTPUT_PATH), help="Output JSON path")
    parser.add_argument("--skip-analysis", action="store_true",
                        help="Skip Claude analysis (faster, uses cached or empty)")
    parser.add_argument("--data-json", default=str(DATA_PATH),
                        help="Path to data.json")
    args = parser.parse_args()

    load_dotenv(ENV_FILE)
    session_cookie = os.getenv(ALPHA_SESSION_COOKIE_ENV, "")
    if not session_cookie:
        logger.error(f"No session cookie. Set {ALPHA_SESSION_COOKIE_ENV} in .env")
        sys.exit(1)

    # 1. Load data.json
    logger.info("Loading data.json...")
    with open(args.data_json) as f:
        data = json.load(f)

    # 2. Identify loop students
    loop_students = get_loop_students(data)
    logger.info("Found %d loop students", len(loop_students))

    if not loop_students:
        logger.info("No loop students. Writing empty loop_data.json.")
        with open(args.output, "w") as f:
            json.dump({"students": [], "trends": {}}, f, indent=2)
        return

    # 3. Init API
    logger.info("Initializing Timeback API...")
    api = TimebackAPI()

    # 4. Process each loop student
    student_results = []
    for i, student in enumerate(sorted(loop_students, key=lambda s: s["name"]), 1):
        name = student["name"]
        sid = student["id"]
        logger.info("[%d/%d] Processing %s...", i, len(loop_students), name)

        # 4a. Fetch and parse test pages
        logger.info("  Fetching test pages...")
        parsed_tests = fetch_and_parse_student_tests(student, session_cookie)
        test_data = build_test_analysis_data(parsed_tests)
        logger.info("  Parsed %d tests", len(test_data))

        # 4b. Fetch AlphaWrite activity data
        logger.info("  Fetching AlphaWrite activities...")
        raw_activities = fetch_alphawrite_activities(api, sid)
        skill_data = group_activities_by_skill(raw_activities)
        logger.info("  Found %d skills from %d activities", len(skill_data), len(raw_activities))

        # 4c. Detect flags
        dd_details = student.get("deep_dive", {}).get("details", [])
        loop_grades = [d["grade"] for d in dd_details]
        total_failed = sum(d.get("failed_count", 0) for d in dd_details)
        total_rushed = sum(d.get("rushed_count", 0) for d in dd_details)

        # Skills mastered in AlphaWrite but potentially not on tests
        mastered_skills = [s for s in skill_data if s["mastered"] and s.get("grade") in loop_grades]

        # Depreciating skills
        depreciating_skills = [s for s in skill_data if s["depreciating"]]

        # 4d. Claude analysis
        analysis = {}
        if not args.skip_analysis and test_data:
            logger.info("  Running Claude analysis...")
            try:
                prompt = build_student_analysis_prompt(student, test_data, skill_data)
                response = run_claude_analysis(prompt)
                analysis = parse_student_analysis(response)
            except Exception as e:
                logger.error("  Claude analysis failed: %s", e)
                analysis = {"pattern_summary": f"Analysis failed: {e}"}

        student_results.append({
            "id": sid,
            "name": name,
            "email": student["email"],
            "campus": student.get("campus", ""),
            "level": student.get("level", ""),
            "hmg": student.get("hmg"),
            "effective_grade": student.get("effective_grade"),
            "loop_details": dd_details,
            "total_failed_tests": total_failed,
            "total_rushed": total_rushed,
            "tests": test_data,
            "skills": skill_data,
            "flags": {
                "mastered_in_alphawrite_not_tests": [
                    {"course": s["course"], "skill": s["skill"], "best_accuracy": s["best_accuracy"]}
                    for s in mastered_skills
                ],
                "depreciating_skills": [
                    {"course": s["course"], "skill": s["skill"],
                     "best_accuracy": s["best_accuracy"], "latest_accuracy": s["latest_accuracy"]}
                    for s in depreciating_skills
                ],
                "rushing": total_rushed > 0,
                "rushed_count": total_rushed,
            },
            "analysis": analysis,
        })

    # 5. General trends analysis
    trends = {}
    if not args.skip_analysis and student_results:
        logger.info("Running general trends analysis...")
        try:
            prompt = build_general_trends_prompt(student_results)
            response = run_claude_analysis(prompt)
            trends = parse_trends_analysis(response)
        except Exception as e:
            logger.error("Trends analysis failed: %s", e)
            trends = {"common_skill_gaps": f"Analysis failed: {e}"}

    # 6. Write output
    output = {
        "generated_at": data.get("generated_at", ""),
        "session": data.get("session", {}),
        "total_loop_students": len(student_results),
        "students": student_results,
        "trends": trends,
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)
    logger.info("Wrote %s (%d students)", args.output, len(student_results))


if __name__ == "__main__":
    main()
