"""Unit tests for Exa transient-error retry/backoff (_exa_call)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from agent import proxycurl


@pytest.mark.asyncio
async def test_retries_transient_524_then_succeeds():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise Exception("Request failed with status code 524: A timeout occurred")
        return "ok"

    with patch("agent.proxycurl.asyncio.sleep", new=AsyncMock()) as slp:
        result = await proxycurl._exa_call(fn, attempts=3, base_delay=0.01)

    assert result == "ok"
    assert calls["n"] == 3
    assert slp.await_count == 2  # slept between the 3 attempts


@pytest.mark.asyncio
async def test_does_not_retry_rate_limit_429():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise Exception("Request failed with status code 429 rate limit exceeded")

    with patch("agent.proxycurl.asyncio.sleep", new=AsyncMock()) as slp:
        with pytest.raises(Exception) as ei:
            await proxycurl._exa_call(fn, attempts=3, base_delay=0.01)

    assert "429" in str(ei.value)
    assert calls["n"] == 1          # raised immediately, no retry
    slp.assert_not_awaited()


@pytest.mark.asyncio
async def test_gives_up_after_attempts_on_persistent_524():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise Exception("status code 524")

    with patch("agent.proxycurl.asyncio.sleep", new=AsyncMock()):
        with pytest.raises(Exception) as ei:
            await proxycurl._exa_call(fn, attempts=3, base_delay=0.01)

    assert "524" in str(ei.value)
    assert calls["n"] == 3          # exhausted all attempts


@pytest.mark.asyncio
async def test_does_not_retry_non_transient_error():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise Exception("status code 404 not found")

    with patch("agent.proxycurl.asyncio.sleep", new=AsyncMock()) as slp:
        with pytest.raises(Exception):
            await proxycurl._exa_call(fn, attempts=3, base_delay=0.01)

    assert calls["n"] == 1          # non-transient → no retry
    slp.assert_not_awaited()
