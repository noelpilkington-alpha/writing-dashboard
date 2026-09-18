import requests

from writing_automation import api_client


class FakeResp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload or {}
        self.text = "x"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Server Error")

    def json(self):
        return self._payload


def _client():
    api = api_client.TimebackAPI.__new__(api_client.TimebackAPI)
    api.env = {}
    api.base_url = "https://example.test"
    api.token = "tok"
    return api


def _patch(monkeypatch, outcomes):
    """outcomes: list of FakeResp or Exception instances returned/raised in order."""
    calls = []

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append(url)
        o = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
        if isinstance(o, Exception):
            raise o
        return o

    monkeypatch.setattr(api_client.requests, "get", fake_get)
    monkeypatch.setattr(api_client.time, "sleep", lambda s: None)
    return calls


def test_get_retries_5xx_then_succeeds(monkeypatch):
    calls = _patch(monkeypatch, [FakeResp(503), FakeResp(503), FakeResp(200, {"ok": 1})])
    assert _client().get("/x") == {"ok": 1}
    assert len(calls) == 3


def test_get_retries_network_error_then_succeeds(monkeypatch):
    calls = _patch(monkeypatch, [requests.ConnectionError("reset"), requests.Timeout("t"), FakeResp(200, {"ok": 2})])
    assert _client().get("/x") == {"ok": 2}
    assert len(calls) == 3


def test_get_raises_after_persistent_5xx(monkeypatch):
    calls = _patch(monkeypatch, [FakeResp(503)])
    try:
        _client().get("/x")
        assert False, "expected HTTPError"
    except requests.HTTPError:
        pass
    assert len(calls) == api_client.TimebackAPI.GET_ATTEMPTS


def test_get_does_not_retry_404(monkeypatch):
    calls = _patch(monkeypatch, [FakeResp(404)])
    try:
        _client().get("/x")
        assert False, "expected HTTPError"
    except requests.HTTPError:
        pass
    assert len(calls) == 1
