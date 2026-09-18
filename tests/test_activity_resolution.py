import json

import activity_resolution as ar


class StubAPI:
    """Minimal stand-in for TimebackAPI.get: maps path -> response dict, counts calls."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path, params=None):
        self.calls.append(path)
        if path not in self.responses:
            raise RuntimeError(f"404 {path}")
        return self.responses[path]


def test_parse_component_resource_id():
    oid = "https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/component-resources/79fcbf92-f090-4b1a-9c2e-0a1b2c3d4e5f"
    assert ar.parse_component_resource_id(oid) == "79fcbf92-f090-4b1a-9c2e-0a1b2c3d4e5f"
    assert ar.parse_component_resource_id("https://alphatest.alpha.school/tests/__68c1") is None
    assert ar.parse_component_resource_id(None) is None


def test_tidy_title_strips_prefixes():
    assert ar.tidy_title("PowerPath Test: Write Equations for Area Formulas - Quiz") == "Write Equations for Area Formulas - Quiz"
    assert ar.tidy_title("[AlphaWrite] - Grade 7 Essay — Draft") == "Grade 7 Essay — Draft"
    assert ar.tidy_title("  Write a Free-Form Paragraph ") == "Write a Free-Form Paragraph"


def test_lookup_failures_are_not_cached(tmp_path):
    # A 5xx/timeout during an outage must not be remembered as "not Writing" / "no title".
    api = StubAPI({})   # every lookup raises
    cs = ar.CourseSubjects(api, tmp_path / "courses.json")
    assert cs.is_writing_course("swf3") is False
    assert cs.is_writing_course("swf3") is False
    assert api.calls.count("/ims/oneroster/rostering/v1p2/courses/swf3") == 2   # retried, not cached
    cs.save()
    assert "swf3" not in json.loads((tmp_path / "courses.json").read_text(encoding="utf-8"))
    ln = ar.LessonNames(api, tmp_path / "names.json")
    oid = "https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/component-resources/crX"
    assert ln.resolve("ali-1", {"originalObjectId": oid}) is None
    assert ln.resolve("ali-1", {"originalObjectId": oid}) is None
    assert api.calls.count("/ims/oneroster/rostering/v1p2/courses/component-resources/crX") == 2
    assert api.calls.count("/ims/oneroster/gradebook/v1p2/assessmentLineItems/ali-1") == 2


def test_course_subjects_classifies_and_caches(tmp_path):
    api = StubAPI({
        "/ims/oneroster/rostering/v1p2/courses/math1": {"course": {"title": "[Timeback] Math G6 hole-filling", "subjects": ["Math"]}},
        "/ims/oneroster/rostering/v1p2/courses/swf3": {"course": {"title": "Standardized Writing Fundamentals G3", "subjects": ["Writing"]}},
        "/ims/oneroster/rostering/v1p2/courses/untagged": {"course": {"title": "[AlphaWrite] Writing G4 hole-filling", "subjects": []}},
    })
    cs = ar.CourseSubjects(api, tmp_path / "courses.json")
    assert cs.is_writing_course("math1") is False
    assert cs.is_writing_course("swf3") is True
    assert cs.is_writing_course("untagged") is True          # title fallback
    assert cs.is_writing_course("missing") is False          # 404 -> not writing
    assert cs.is_writing_course(None) is False
    assert cs.is_writing_course("math1") is False
    assert len(api.calls) == 4                               # second math1 lookup served from memory
    cs.save()
    cs2 = ar.CourseSubjects(StubAPI({}), tmp_path / "courses.json")
    assert cs2.is_writing_course("swf3") is True             # served from disk, no API call needed


def test_is_writing_activity_decision_table(tmp_path):
    api = StubAPI({
        "/ims/oneroster/rostering/v1p2/courses/math1": {"course": {"title": "Math G6", "subjects": ["Math"]}},
        "/ims/oneroster/rostering/v1p2/courses/swf3": {"course": {"title": "SWF G3", "subjects": ["Writing"]}},
    })
    cs = ar.CourseSubjects(api, tmp_path / "courses.json")
    assert ar.is_writing_activity("alphawrite-sentences-i-fragment", {}, cs) is True
    assert ar.is_writing_activity("anything", {"subject": "Writing"}, cs) is True
    assert ar.is_writing_activity("538304c0-d50b-4207-a047-c47a50ae8c39", {"lessonType": "powerpath-100", "courseSourcedId": "math1"}, cs) is False
    assert ar.is_writing_activity("538304c0-d50b-4207-a047-c47a50ae8c39", {"lessonType": "powerpath-100", "courseSourcedId": "swf3"}, cs) is True
    assert ar.is_writing_activity("cr_article_3000575_article_3000575", {"lessonType": "alpha-read-article"}, cs) is False
    assert ar.is_writing_activity("unit_12_quiz", {"lessonType": "quiz", "subject": ""}, cs) is False
    assert ar.is_writing_activity("unit_12_quiz", {"lessonType": "quiz", "subject": "Math"}, cs) is False


def test_lesson_names_resolves_component_resource_then_line_item(tmp_path):
    api = StubAPI({
        "/ims/oneroster/rostering/v1p2/courses/component-resources/cr1": {"componentResource": {"title": "[AlphaWrite] - Grade 7 Essay — Draft", "resource": {"sourcedId": "r1"}}},
        "/ims/oneroster/rostering/v1p2/courses/component-resources/cr2": {"componentResource": {"title": "", "resource": {"sourcedId": "r2"}}},
        "/ims/oneroster/resources/v1p2/resources/r2": {"resource": {"title": "Write a Free-Form Paragraph"}},
        "/ims/oneroster/gradebook/v1p2/assessmentLineItems/ali-uuid": {"assessmentLineItem": {"title": "PowerPath Test: Practice: Energy Flow Efficiency"}},
    })
    ln = ar.LessonNames(api, tmp_path / "names.json")
    oid = "https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/component-resources/"
    assert ln.resolve("caliper_abc", {"originalObjectId": oid + "cr1"}) == "Grade 7 Essay — Draft"
    assert ln.resolve("caliper_def", {"originalObjectId": oid + "cr2"}) == "Write a Free-Form Paragraph"   # falls through to resource
    assert ln.resolve("ali-uuid", {"lessonType": "powerpath-100"}) == "Practice: Energy Flow Efficiency"
    assert ln.resolve("ali-missing", {}) is None
    assert ln.resolve("caliper_abc", {"originalObjectId": oid + "cr1"}) == "Grade 7 Essay — Draft"
    assert api.calls.count("/ims/oneroster/rostering/v1p2/courses/component-resources/cr1") == 1   # cached
    ln.save()
    data = json.loads((tmp_path / "names.json").read_text(encoding="utf-8"))
    assert data["component_resources"]["cr1"] == "Grade 7 Essay — Draft"
