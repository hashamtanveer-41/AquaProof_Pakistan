"""Bounded retries and sanitized diagnostics for external HTTP services."""

import time
from threading import Lock

import httpx

TRANSIENT = {408, 429, 500, 502, 503, 504}
_lock = Lock()
_circuits = {}


class ProviderError(RuntimeError):
    def __init__(self, reason, status=None):
        super().__init__(reason)
        self.status = status


def request_json(method, url, *, service=None, **kwargs):
    identity = service or url
    with _lock:
        failures, until = _circuits.get(identity, (0, 0))
        if until:
            if time.monotonic() < until:
                raise ProviderError("Circuit open after repeated provider failures")
            _circuits[identity] = (failures, time.monotonic() + 30)
    for attempt in range(2):
        try:
            response = httpx.request(method, url, timeout=httpx.Timeout(7, connect=3), **kwargs)
            if response.status_code in TRANSIENT:
                raise ProviderError(f"HTTP {response.status_code}", response.status_code)
        except (httpx.RequestError, ProviderError) as error:
            if attempt == 0 and getattr(error, "status", None) != 429:
                time.sleep(0.25)
                continue
            with _lock:
                failures = _circuits.get(identity, (0, 0))[0] + 1
                _circuits[identity] = (failures, time.monotonic() + 60 if failures >= 3 else 0)
            if isinstance(error, ProviderError):
                raise
            raise ProviderError(type(error).__name__) from None
        with _lock:
            _circuits.pop(identity, None)
        if response.status_code != 200:
            raise ProviderError(f"HTTP {response.status_code}", response.status_code)
        try:
            data = response.json()
        except ValueError:
            raise ProviderError("Invalid JSON", response.status_code) from None
        if not isinstance(data, dict):
            raise ProviderError("Unexpected response schema", response.status_code)
        return data, response
