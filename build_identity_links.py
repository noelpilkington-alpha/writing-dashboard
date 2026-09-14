"""Build identity_links.json: old -> new Timeback sourcedIds for students whose email changed.

Usage (from dashboard/):
    python build_identity_links.py                    # fetches API users (~1 min)
    python build_identity_links.py --users-cache ../_probe_users.json
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from writing_automation.api_client import TimebackAPI
from writing_automation.config import SCHOOL_YEARS, TIMEBACK_ROOT

from identity import build_links

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

OUTPUT = Path(__file__).resolve().parent / "identity_links.json"


def _rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-year", default="2025-26")
    ap.add_argument("--new-year", default="2026-27")
    ap.add_argument("--users-cache", help="JSON list of API users (sourcedId, email) to reuse")
    ap.add_argument("--output", default=str(OUTPUT))
    args = ap.parse_args()

    old_rows = _rows(TIMEBACK_ROOT / SCHOOL_YEARS[args.old_year]["roster"])
    new_rows = _rows(TIMEBACK_ROOT / SCHOOL_YEARS[args.new_year]["roster"])
    if args.users_cache:
        users = json.loads(Path(args.users_cache).read_text(encoding="utf-8"))
    else:
        api = TimebackAPI()
        users = api.get_paginated("/ims/oneroster/rostering/v1p2/students/",
                                  {"fields": "sourcedId,email"}, "users")
    logger.info("old roster %d rows, new roster %d rows, api users %d", len(old_rows), len(new_rows), len(users))
    links = build_links(old_rows, new_rows, users)
    Path(args.output).write_text(json.dumps({
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "links": links,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Wrote %d links to %s", len(links), args.output)
    for l in links:
        logger.info("  %s: %s -> %s", l["name"], l["old_email"], l["new_email"])


if __name__ == "__main__":
    main()
