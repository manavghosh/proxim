"""Monster.com job scraper — stub implementation."""
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()


class MonsterScraper(AbstractScraper):
    source_name = "monster"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        logger.warning(
            "monster_scraper_not_implemented",
            message="Monster scraper is a stub — returns no results. Implement monster.py to enable.",
        )
        return []
