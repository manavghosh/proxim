"""
Database driver dispatcher.

Imports from db_sqlite or db_pg based on DATABASE_URL:
  - starts with postgresql:// or postgres://  →  asyncpg (production)
  - anything else                              →  aiosqlite (local dev)
"""
from agent.config import settings


def _is_sqlite(url: str) -> bool:
    return not url.startswith(('postgresql://', 'postgres://'))


if _is_sqlite(settings.database_url):
    from agent.db_sqlite import *  # noqa: F401, F403
else:
    from agent.db_pg import *  # noqa: F401, F403
