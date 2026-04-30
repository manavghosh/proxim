"""Abstract base class for all job scrapers."""
from abc import ABC, abstractmethod
import structlog
from agent.models import RawJob

logger = structlog.get_logger()


class AbstractScraper(ABC):
    source_name: str = ""

    @abstractmethod
    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:
        """Scrape jobs for the given queries. Returns empty list on failure."""
        ...

    async def safe_scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:
        """Wraps scrape() with error handling — never raises, returns [] on error."""
        try:
            return await self.scrape(queries, preferences)
        except Exception as e:
            logger.warning("scraper_error", source=self.source_name, error=str(e))
            return []
