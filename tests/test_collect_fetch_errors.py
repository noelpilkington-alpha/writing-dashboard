import pytest

import collect_data as cd


class FailingAPI:
    def get(self, path, params=None):
        raise RuntimeError("503 Server Error")

    def get_paginated(self, path, params, result_key):
        raise RuntimeError("503 Server Error")


class EmptyAPI:
    def get(self, path, params=None):
        return {"assessmentResults": []}

    def get_paginated(self, path, params, result_key):
        return []


class CapturingAPI:
    """Returns one active, one tobedeleted and one ungraded assessment row; records the filter used."""

    def __init__(self):
        self.filters = []

    def get(self, path, params=None):
        self.filters.append((params or {}).get("filter", ""))
        row = lambda status, score, score_status, name: {
            "status": status, "score": score, "scoreStatus": score_status, "scoreDate": "2026-10-01T10:00:00Z",
            "metadata": {"subject": "Writing", "testName": name, "testType": "placement", "resultType": "assessment", "assignmentId": 1},
        }
        return {"assessmentResults": [
            row("active", 91, "fully graded", "Alpha Standardized Writing G3.1"),
            row("tobedeleted", 100, "fully graded", "Alpha Standardized Writing G4.1"),   # invalidated
            row("active", None, "not submitted", "Alpha Standardized Writing G5.1"),     # placeholder
        ]}


def test_test_fetch_excludes_invalidated_and_ungraded_rows():
    api = CapturingAPI()
    tests = cd.fetch_writing_test_results(api, "sid-1", "A Student", "a@x.com")
    assert "status='active'" in api.filters[0]
    assert [t["name"][-4:] for t in tests] == ["G3.1"]


def test_fetchers_raise_fetch_error_instead_of_returning_empty():
    with pytest.raises(cd.FetchError):
        cd.fetch_writing_test_results(FailingAPI(), "sid-1", "A Student", "a@x.com")
    with pytest.raises(cd.FetchError):
        cd.fetch_activity_results(FailingAPI(), "sid-1", "2026-08-01", "2027-06-18")


def test_fetchers_return_empty_lists_for_genuinely_empty_students():
    assert cd.fetch_writing_test_results(EmptyAPI(), "sid-1", "A Student", "a@x.com") == []
    assert cd.fetch_activity_results(EmptyAPI(), "sid-1", "2026-08-01", "2027-06-18") == []


def test_failure_limit_scales_with_population():
    assert cd.fetch_failure_limit(0) == cd.MIN_FETCH_FAILURES_TO_ABORT
    assert cd.fetch_failure_limit(100) == cd.MIN_FETCH_FAILURES_TO_ABORT      # 5% of 100 < floor
    assert cd.fetch_failure_limit(1600) == int(0.05 * 1600) == 80
