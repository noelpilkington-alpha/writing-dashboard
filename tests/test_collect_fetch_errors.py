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
