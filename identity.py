"""Link old and new Timeback accounts for students whose email changed.

A student whose email changed between rosters usually has two API user records; test
history stays on the old sourcedId. ``build_links`` finds such pairs by
(first name, last name, DOB); the collector merges histories with ``merge_tests`` /
``merge_activities``.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path


def person_key(first: str, last: str, dob: str) -> tuple[str, str, str]:
    return ((first or "").strip().lower(), (last or "").strip().lower(), (dob or "").strip())


def _email(row: dict) -> str:
    return (row.get("Student Alpha Email") or "").strip().lower()


def build_links(old_rows: list[dict], new_rows: list[dict], users: list[dict]) -> list[dict]:
    """Pairs (old email -> new email) for the same person with distinct API sourcedIds.

    Only Enrolled rows on both sides are considered.
    """
    sid_by_email = {(u.get("email") or "").strip().lower(): u.get("sourcedId") for u in users if u.get("sourcedId")}
    # A person may appear more than once in the old roster (one row per email), so keep them all.
    old_emails_by_person: dict[tuple, list[str]] = defaultdict(list)
    for r in old_rows:
        if (r.get("Admission Status") or "").strip() == "Enrolled" and _email(r):
            key = person_key(r.get("First Name"), r.get("Last Name"), r.get("Date of Birth"))
            if _email(r) not in old_emails_by_person[key]:
                old_emails_by_person[key].append(_email(r))
    links = []
    seen: set[tuple[str, str]] = set()
    for r in new_rows:
        if (r.get("Admission Status") or "").strip() != "Enrolled":
            continue
        key = person_key(r.get("First Name"), r.get("Last Name"), r.get("Date of Birth"))
        new_email = _email(r)
        if not new_email:
            continue
        new_sid = sid_by_email.get(new_email)
        if not new_sid:
            continue
        for old_email in old_emails_by_person.get(key, []):
            if old_email == new_email:
                continue
            old_sid = sid_by_email.get(old_email)
            if not old_sid or old_sid == new_sid or (old_sid, new_sid) in seen:
                continue
            seen.add((old_sid, new_sid))
            links.append({
                "old_sourced_id": old_sid,
                "new_sourced_id": new_sid,
                "old_email": old_email,
                "new_email": new_email,
                "name": f"{(r.get('First Name') or '').strip()} {(r.get('Last Name') or '').strip()}".strip(),
            })
    return links


def load_links(path: str | Path) -> dict[str, list[str]]:
    """{new_sourced_id: [old_sourced_id, ...]}; empty when the file does not exist."""
    path = Path(path)
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, list[str]] = defaultdict(list)
    for link in data.get("links", []):
        out[link["new_sourced_id"]].append(link["old_sourced_id"])
    return dict(out)


def merge_tests(primary: list[dict], extras: list[list[dict]]) -> list[dict]:
    """Concatenate test lists, de-duplicate on (name, date), sort by date."""
    seen: set[tuple] = set()
    out = []
    for t in primary + [t for lst in extras for t in lst]:
        key = (t.get("name"), t.get("date"))
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    out.sort(key=lambda t: t.get("date") or "")
    return out


def merge_activities(primary: list[dict], extras: list[list[dict]]) -> list[dict]:
    """Concatenate raw assessmentResult lists, de-duplicate on sourcedId."""
    seen: set[str] = set()
    out = []
    for r in primary + [r for lst in extras for r in lst]:
        sid = r.get("sourcedId")
        if sid and sid in seen:
            continue
        if sid:
            seen.add(sid)
        out.append(r)
    return out
