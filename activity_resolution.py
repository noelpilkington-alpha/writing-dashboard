"""Resolve the subject and lesson name of Writing activity records.

Result records from hole-filling, PowerPath and caliper sources often carry no
``metadata.subject`` and no lesson title. This module answers two questions with
disk-cached API lookups:

- Is this record Writing work? (``is_writing_activity``) -- yes when the subject
  metadata says Writing, the line item is an AlphaWrite item, or the record's
  course (``metadata.courseSourcedId``) is a Writing course. Lesson type alone
  (powerpath-100, alpha-read-article, quiz) is NOT evidence: those types are shared
  with Math, Science and Reading hole-filling courses.
- What is the lesson called? (``LessonNames.resolve``) -- the title of the component
  resource the record points at (new-format AlphaWrite rows), else the title of the
  assessment line item (PowerPath quizzes), else None.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_CR_RE = re.compile(r"component-resources/([^/?#]+)")
_TITLE_PREFIXES = ("PowerPath Test: ", "[AlphaWrite] - ", "[Alphawrite] - ")
_WRITING_TITLE_RE = re.compile(r"\bwriting\b|\bessays?\b|\bsentences\b|\bparagraphs\b|alphawrite", re.I)
_SAVE_EVERY = 50


def is_alphawrite(ali_sid: str) -> bool:
    return ali_sid.startswith("alphawrite-") or ali_sid.startswith("alphawrite:")


def parse_component_resource_id(original_object_id) -> str | None:
    """'.../courses/component-resources/<id>' -> '<id>'; None for anything else."""
    if not original_object_id:
        return None
    m = _CR_RE.search(str(original_object_id))
    return m.group(1) if m else None


def tidy_title(title: str) -> str:
    t = (title or "").strip()
    changed = True
    while changed:
        changed = False
        for p in _TITLE_PREFIXES:
            if t.startswith(p):
                t = t[len(p):].strip()
                changed = True
    return t


class _DiskCache:
    """A JSON dict on disk, saved every _SAVE_EVERY new entries and on save()."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.data: dict = {}
        self._dirty = 0
        if self.path.exists():
            try:
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception as e:  # corrupt cache: start fresh
                logger.warning("Ignoring unreadable cache %s: %s", self.path, e)
                self.data = {}

    def touched(self) -> None:
        self._dirty += 1
        if self._dirty >= _SAVE_EVERY:
            self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)
        self._dirty = 0


class CourseSubjects:
    """course sourcedId -> is it a Writing course? Cached on disk."""

    def __init__(self, api, cache_path: Path):
        self._api = api
        self._cache = _DiskCache(cache_path)

    def _lookup(self, course_id: str) -> dict:
        if course_id in self._cache.data:
            return self._cache.data[course_id]
        try:
            c = self._api.get(f"/ims/oneroster/rostering/v1p2/courses/{course_id}")
            c = c.get("course", c)
            entry = {"title": c.get("title"), "subjects": list(c.get("subjects") or [])}
        except Exception as e:
            # Transient failure (outage, timeout): do NOT cache, so the next run retries.
            logger.warning("course %s lookup failed (not cached): %s", course_id, e)
            return {"title": None, "subjects": []}
        self._cache.data[course_id] = entry
        self._cache.touched()
        return entry

    def is_writing_course(self, course_id: str | None) -> bool:
        if not course_id:
            return False
        entry = self._lookup(course_id)
        if entry["subjects"]:
            return "Writing" in entry["subjects"]
        return bool(entry["title"] and _WRITING_TITLE_RE.search(entry["title"]))

    def save(self) -> None:
        self._cache.save()


class LessonNames:
    """Lesson titles for records whose result metadata has no name. Cached on disk."""

    def __init__(self, api, cache_path: Path):
        self._api = api
        self._cache = _DiskCache(cache_path)
        self._cache.data.setdefault("component_resources", {})
        self._cache.data.setdefault("line_items", {})

    def _component_resource_title(self, cr_id: str) -> str:
        cache = self._cache.data["component_resources"]
        if cr_id in cache:
            return cache[cr_id]
        title = ""
        try:
            cr = self._api.get(f"/ims/oneroster/rostering/v1p2/courses/component-resources/{cr_id}")
            cr = cr.get("componentResource", cr)
            title = tidy_title(cr.get("title") or "")
            if not title:
                rid = (cr.get("resource") or {}).get("sourcedId")
                if rid:
                    res = self._api.get(f"/ims/oneroster/resources/v1p2/resources/{rid}")
                    res = res.get("resource", res)
                    title = tidy_title(res.get("title") or "")
        except Exception as e:
            logger.warning("component resource %s lookup failed (not cached): %s", cr_id, e)
            return ""
        cache[cr_id] = title
        self._cache.touched()
        return title

    def _line_item_title(self, ali_sid: str) -> str:
        cache = self._cache.data["line_items"]
        if ali_sid in cache:
            return cache[ali_sid]
        title = ""
        try:
            li = self._api.get(f"/ims/oneroster/gradebook/v1p2/assessmentLineItems/{ali_sid}")
            li = li.get("assessmentLineItem", li)
            title = tidy_title(li.get("title") or "")
        except Exception as e:
            logger.warning("line item %s lookup failed (not cached): %s", ali_sid, e)
            return ""
        cache[ali_sid] = title
        self._cache.touched()
        return title

    def resolve(self, ali_sid: str, meta: dict) -> str | None:
        cr_id = parse_component_resource_id((meta or {}).get("originalObjectId"))
        if cr_id:
            title = self._component_resource_title(cr_id)
            if title:
                return title
        if ali_sid and not is_alphawrite(ali_sid) and not ali_sid.startswith("caliper_"):
            title = self._line_item_title(ali_sid)
            if title:
                return title
        return None

    def save(self) -> None:
        self._cache.save()


def is_writing_activity(ali_sid: str, meta: dict, course_subjects: CourseSubjects | None) -> bool:
    """True when a result record is Writing work (see module docstring)."""
    meta = meta or {}
    subject = meta.get("subject") or ""
    if subject == "Writing":
        return True
    if is_alphawrite(ali_sid or ""):
        return True
    if subject:            # explicitly another subject
        return False
    course_id = meta.get("courseSourcedId")
    if course_id and course_subjects is not None:
        return course_subjects.is_writing_course(course_id)
    return False
