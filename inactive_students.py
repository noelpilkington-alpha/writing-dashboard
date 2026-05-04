"""Alert on students with no writing activity for 5+ school days.

Reads dashboard/data.json (produced by collect_data.py) and prints a grouped
summary of inactive students. Uses the `inactivity` field that collect_data.py
computes (weekdays since last XP, session-aware, excludes G8 completers and
unenrolled students).

Usage:
    python inactive_students.py            # default: 5+ weekdays inactive
    python inactive_students.py --days 7   # custom threshold
    python inactive_students.py --csv out.csv  # also write CSV
"""

import argparse
import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DATA_PATH = SCRIPT_DIR / "data.json"
ROSTER_PATH = SCRIPT_DIR.parent / "A&D Master Roster 25-26 - Master.csv"


def load_roster_advisors():
    """email -> advisor name."""
    advisors = {}
    with open(ROSTER_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            email = row.get("Student Alpha Email", "").strip().lower()
            if email:
                advisors[email] = row.get("Advisor", "").strip() or "(no advisor)"
    return advisors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=5,
                    help="Minimum weekdays of inactivity to flag (default: 5)")
    ap.add_argument("--csv", type=str, default=None,
                    help="Optional CSV output path")
    ap.add_argument("--data", type=str, default=str(DATA_PATH),
                    help="Path to dashboard data.json")
    args = ap.parse_args()

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    with open(args.data, encoding="utf-8") as f:
        dash = json.load(f)

    advisors = load_roster_advisors() if ROSTER_PATH.exists() else {}

    flagged = []
    for s in dash["students"]:
        inact = s.get("inactivity") or {}
        days = inact.get("days_inactive", 0)
        if days < args.days:
            continue
        if not s.get("still_enrolled"):
            continue
        if s.get("completed_g8"):
            continue
        flagged.append({
            "name": s["name"],
            "email": s["email"],
            "campus": s.get("campus") or "Unknown",
            "advisor": advisors.get(s["email"].lower(), "(no advisor)"),
            "level": s.get("level") or "",
            "age_grade": s.get("age_grade"),
            "hmg": s.get("hmg"),
            "days_inactive": days,
            "last_xp_date": inact.get("last_xp_date"),
            "never_active_this_session": inact.get("never_active_this_session", False),
        })

    print(f"Inactive students ({args.days}+ weekdays without writing XP)")
    print(f"Data generated: {dash.get('generated_at', '?')}")
    print(f"Session: {dash['session']['name']} ({dash['session']['start']} – {dash['session']['end']})")
    print("=" * 72)

    if not flagged:
        print("\nNo students flagged. 🎉")
        return

    # Split into "never active this session" vs "fell inactive"
    never = [s for s in flagged if s["never_active_this_session"]]
    fell_inactive = [s for s in flagged if not s["never_active_this_session"]]

    total = len(flagged)
    print(f"\nTotal flagged: {total}  (fell inactive: {len(fell_inactive)}, never started session: {len(never)})\n")

    def print_group(title, students):
        if not students:
            return
        # Group by campus
        by_campus = defaultdict(list)
        for s in students:
            by_campus[s["campus"]].append(s)

        print(f"--- {title} ({len(students)}) ---")
        for campus in sorted(by_campus):
            items = sorted(by_campus[campus], key=lambda x: (-x["days_inactive"], x["name"]))
            print(f"\n  [{campus}] ({len(items)})")
            for s in items:
                last = s["last_xp_date"] or "never"
                print(f"    {s['days_inactive']:>3}d  {s['name']:30s}  "
                      f"G{s['age_grade']}/HMG G{s['hmg']}  last XP: {last}  "
                      f"advisor: {s['advisor']}")
        print()

    print_group("Fell Inactive (had activity, then stopped)", fell_inactive)
    print_group("Never Started This Session", never)

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=[
                "name", "email", "campus", "advisor", "level", "age_grade", "hmg",
                "days_inactive", "last_xp_date", "never_active_this_session",
            ])
            w.writeheader()
            for s in sorted(flagged, key=lambda x: (-x["days_inactive"], x["campus"], x["name"])):
                w.writerow(s)
        print(f"Wrote CSV: {args.csv}")


if __name__ == "__main__":
    main()
