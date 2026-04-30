import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_pool():
    """Mock asyncpg connection pool for unit tests."""
    pool = MagicMock()
    pool.acquire = MagicMock()
    return pool


@pytest.fixture
def mock_connection():
    """Mock asyncpg connection."""
    conn = AsyncMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=None)
    return conn
