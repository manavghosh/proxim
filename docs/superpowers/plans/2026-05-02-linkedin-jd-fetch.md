# LinkedIn JD Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch full LinkedIn job descriptions for every discovered job using a separate `fetch_jds` pipeline job that runs automatically after `discovery_only`, using an isolated browser session.

**Architecture:** Two sequential pipeline jobs — `discovery_only` scrapes search results and stores jobs with `jd_raw=''`, then auto-queues a `fetch_jds` job; the daemon picks up `fetch_jds` within 3 seconds and opens a fresh browser to visit each job detail page and extract the JD text.

**Tech Stack:** Python, aiosqlite/asyncpg, Playwright + playwright-stealth, LangGraph 1.x, BeautifulSoup4

---

### Task 1: Add `FetchJdsState` to models

**Files:**
- Modify: `agent/agent/models.py`

- [x] **Step 1: Add the model**

Open `agent/agent/models.py` and add after the `DiscoveryState` class:

```python
class FetchJdsState(BaseModel):
    candidate_id: str
    pipeline_job_id: str
    pipeline_run_id: str = ""
    jobs_to_fetch: list[dict] = []
    fetched_count: int = 0
    failed_count: int = 0
```

- [x] **Step 2: Verify import works**

```bash
cd agent
poetry run python -c "from agent.models import FetchJdsState; print('OK')"
```

Expected: `OK`

- [x] **Step 3: Commit**

```bash
git add agent/agent/models.py
git commit -m "feat: add FetchJdsState pydantic model"
```

---

### Task 2: Add 4 new DB functions to `db_sqlite.py` (with tests)

**Files:**
- Modify: `agent/agent/db_sqlite.py`
- Modify: `agent/tests/unit/test_db_sqlite.py`

- [x] **Step 1: Write failing tests**

Add to the bottom of `agent/tests/unit/test_db_sqlite.py`:

```python
# ── New DB functions for JD fetch ─────────────────────────────────────────

async def test_count_jobs_with_empty_jd_returns_zero_when_no_jobs(conn):
    count = await count_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert count == 0


async def test_get_jobs_with_empty_jd_returns_empty_when_no_jobs(conn):
    result = await get_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert result == []


async def test_update_job_jd_updates_jd_raw(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    job_ids = await bulk_insert_jobs(conn, [{
        'candidate_id': CANDIDATE_ID,
        'pipeline_run_id': run_id,
        'title': 'AI Director',
        'company': 'Acme',
        'location': 'Bengaluru',
        'jd_raw': '',
        'jd_text': '',
        'source': 'linkedin',
        'source_url': 'https://linkedin.com/jobs/view/123',
        'application_url': None,
        'posted_at': None,
    }])
    inserted_job_id = job_ids[0]
    await update_job_jd(conn, inserted_job_id, 'We are hiring an AI Director…')
    async with conn.execute('SELECT jd_raw FROM jobs WHERE id = ?', (inserted_job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'We are hiring an AI Director…'


async def test_count_jobs_with_empty_jd_counts_correctly(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await bulk_insert_jobs(conn, [
        {'candidate_id': CANDIDATE_ID, 'pipeline_run_id': run_id, 'title': 'Job A', 'company': 'Co',
         'location': None, 'jd_raw': '', 'jd_text': '', 'source': 'linkedin',
         'source_url': 'https://linkedin.com/jobs/1', 'application_url': None, 'posted_at': None},
        {'candidate_id': CANDIDATE_ID, 'pipeline_run_id': run_id, 'title': 'Job B', 'company': 'Co',
         'location': None, 'jd_raw': 'has jd', 'jd_text': '', 'source': 'linkedin',
         'source_url': 'https://linkedin.com/jobs/2', 'application_url': None, 'posted_at': None},
    ])
    count = await count_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert count == 1


async def test_get_jobs_with_empty_jd_returns_only_empty_ones(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await bulk_insert_jobs(conn, [
        {'candidate_id': CANDIDATE_ID, 'pipeline_run_id': run_id, 'title': 'Job A', 'company': 'Co',
         'location': None, 'jd_raw': '', 'jd_text': '', 'source': 'linkedin',
         'source_url': 'https://linkedin.com/jobs/1', 'application_url': None, 'posted_at': None},
        {'candidate_id': CANDIDATE_ID, 'pipeline_run_id': run_id, 'title': 'Job B', 'company': 'Co',
         'location': None, 'jd_raw': 'has jd', 'jd_text': '', 'source': 'linkedin',
         'source_url': 'https://linkedin.com/jobs/2', 'application_url': None, 'posted_at': None},
    ])
    jobs = await get_jobs_with_empty_jd(conn, CANDIDATE_ID)
    assert len(jobs) == 1
    assert jobs[0]['source_url'] == 'https://linkedin.com/jobs/1'
    assert 'id' in jobs[0]


async def test_queue_pipeline_job_inserts_queued_job(conn):
    job_id = await queue_pipeline_job(conn, CANDIDATE_ID, 'fetch_jds')
    assert job_id is not None
    async with conn.execute('SELECT status, job_type FROM pipeline_jobs WHERE id = ?', (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'queued'
    assert row[1] == 'fetch_jds'
```

Also update the import block at the top of the test file to include the 4 new functions:

```python
from agent.db_sqlite import (
    claim_pipeline_job,
    update_pipeline_job_status,
    insert_pipeline_run,
    update_pipeline_run,
    get_scan_history_urls,
    bulk_insert_jobs,
    bulk_insert_scan_history,
    insert_pipeline_log,
    get_candidate_preferences,
    get_jobs_with_empty_jd,
    update_job_jd,
    count_jobs_with_empty_jd,
    queue_pipeline_job,
)
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd agent
poetry run pytest tests/unit/test_db_sqlite.py -k "empty_jd or update_job_jd or queue_pipeline" -v 2>&1 | tail -10
```

Expected: FAILED with `ImportError: cannot import name 'get_jobs_with_empty_jd'`

- [x] **Step 3: Implement the 4 functions in `db_sqlite.py`**

Add at the end of `agent/agent/db_sqlite.py`:

```python
async def get_jobs_with_empty_jd(
    pool: aiosqlite.Connection,
    candidate_id: str,
    limit: int = 100,
) -> list[dict]:
    async with pool.execute(
        "SELECT id, source_url FROM jobs "
        "WHERE candidate_id = ? AND jd_raw = '' AND status = 'discovered' "
        "ORDER BY created_at LIMIT ?",
        (candidate_id, limit),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{"id": row[0], "source_url": row[1]} for row in rows]


async def update_job_jd(
    pool: aiosqlite.Connection,
    job_id: str,
    jd_raw: str,
) -> None:
    await pool.execute(
        "UPDATE jobs SET jd_raw = ?, updated_at = ? WHERE id = ?",
        (jd_raw, _now(), job_id),
    )
    await pool.commit()


async def count_jobs_with_empty_jd(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> int:
    async with pool.execute(
        "SELECT COUNT(*) FROM jobs "
        "WHERE candidate_id = ? AND jd_raw = '' AND status = 'discovered'",
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row else 0


async def queue_pipeline_job(
    pool: aiosqlite.Connection,
    candidate_id: str,
    job_type: str,
) -> str:
    job_id = _new_id()
    await pool.execute(
        "INSERT INTO pipeline_jobs (id, status, job_type, candidate_id, payload, created_at) "
        "VALUES (?, 'queued', ?, ?, '{}', ?)",
        (job_id, job_type, candidate_id, _now()),
    )
    await pool.commit()
    return job_id
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd agent
poetry run pytest tests/unit/test_db_sqlite.py -v 2>&1 | tail -15
```

Expected: all tests pass

- [x] **Step 5: Commit**

```bash
git add agent/agent/db_sqlite.py agent/tests/unit/test_db_sqlite.py
git commit -m "feat: add get_jobs_with_empty_jd, update_job_jd, count_jobs_with_empty_jd, queue_pipeline_job to db_sqlite"
```

---

### Task 3: Add the same 4 DB functions to `db_pg.py`

**Files:**
- Modify: `agent/agent/db_pg.py`

No new tests needed — `db_pg.py` is covered by integration tests against the real PG DB.

- [x] **Step 1: Add the 4 functions at the end of `db_pg.py`**

```python
async def get_jobs_with_empty_jd(
    pool: asyncpg.Pool,
    candidate_id: str,
    limit: int = 100,
) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, source_url FROM jobs "
            "WHERE candidate_id = $1 AND jd_raw = '' AND status = 'discovered' "
            "ORDER BY created_at LIMIT $2",
            candidate_id, limit,
        )
    return [{"id": str(row["id"]), "source_url": row["source_url"]} for row in rows]


async def update_job_jd(
    pool: asyncpg.Pool,
    job_id: str,
    jd_raw: str,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE jobs SET jd_raw = $1, updated_at = NOW() WHERE id = $2",
            jd_raw, job_id,
        )


async def count_jobs_with_empty_jd(
    pool: asyncpg.Pool,
    candidate_id: str,
) -> int:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS c FROM jobs "
            "WHERE candidate_id = $1 AND jd_raw = '' AND status = 'discovered'",
            candidate_id,
        )
    return row["c"] if row else 0


async def queue_pipeline_job(
    pool: asyncpg.Pool,
    candidate_id: str,
    job_type: str,
) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO pipeline_jobs (job_type, candidate_id, payload) "
            "VALUES ($1, $2, $3) RETURNING id",
            job_type, candidate_id, {},
        )
    return str(row["id"])
```

- [x] **Step 2: Verify import**

```bash
cd agent
poetry run python -c "from agent.db_pg import get_jobs_with_empty_jd, update_job_jd, count_jobs_with_empty_jd, queue_pipeline_job; print('OK')"
```

Expected: `OK`

- [x] **Step 3: Commit**

```bash
git add agent/agent/db_pg.py
git commit -m "feat: add get_jobs_with_empty_jd, update_job_jd, count_jobs_with_empty_jd, queue_pipeline_job to db_pg"
```

---

### Task 4: Improve the LinkedIn search scraper

**Files:**
- Modify: `agent/agent/scrapers/linkedin.py`

Changes: add stealth, use location from preferences, extract `posted_at`, paginate to page 2, continue on per-query error instead of breaking.

- [x] **Step 1: Replace the full content of `agent/agent/scrapers/linkedin.py`**

```python
"""LinkedIn job scraper — search results with stealth Playwright."""
import asyncio
import random
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()

LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/"
LINKEDIN_BASE     = "https://www.linkedin.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _extract_date(card) -> str | None:
    el = card.select_one("time.job-search-card__listdate, time[datetime]")
    if el:
        return el.get("datetime")
    return None


def _parse_cards(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for card in soup.select(".job-search-card"):
        title_el   = card.select_one(".base-search-card__title")
        company_el = card.select_one(".base-search-card__subtitle")
        loc_el     = card.select_one(".job-search-card__location")
        link_el    = card.select_one("a.base-card__full-link")

        if not title_el or not link_el:
            continue

        href = link_el.get("href", "")
        if isinstance(href, list):
            href = href[0] if href else ""
        if not href:
            continue

        job_url = href if href.startswith("http") else f"{LINKEDIN_BASE}{href}"
        # Strip LinkedIn tracking params — keep canonical URL for dedup
        if "?" in job_url:
            job_url = job_url.split("?")[0]

        results.append({
            "title":     title_el.get_text(strip=True),
            "company":   company_el.get_text(strip=True) if company_el else "",
            "location":  loc_el.get_text(strip=True) if loc_el else None,
            "url":       job_url,
            "posted_at": _extract_date(card),
        })
    return results


class LinkedInScraper(AbstractScraper):
    source_name = "linkedin"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:
        jobs: list[RawJob] = []
        seen_urls: set[str] = set()

        geo = preferences.get("geographic_preference", [])
        location = geo[0].replace("-based", "").strip() if geo else "India"

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            context = await browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1920, "height": 1080},
                locale="en-IN",
            )
            try:
                page = await context.new_page()
                await stealth_async(page)

                for query in queries[:3]:
                    for page_num in [1, 2]:
                        try:
                            start = (page_num - 1) * 25
                            encoded_q   = query.replace(" ", "%20")
                            encoded_loc = location.replace(" ", "%20")
                            url = (
                                f"{LINKEDIN_JOBS_URL}"
                                f"?keywords={encoded_q}"
                                f"&location={encoded_loc}"
                                f"&f_TPR=r604800"
                                f"&start={start}"
                            )
                            await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                            try:
                                await page.wait_for_selector(".job-search-card", timeout=10000)
                            except Exception:
                                break  # no cards → last page reached

                            html   = await page.content()
                            parsed = _parse_cards(html)

                            for item in parsed:
                                if item["url"] in seen_urls:
                                    continue
                                seen_urls.add(item["url"])
                                jobs.append(RawJob(
                                    title=item["title"],
                                    company=item["company"],
                                    location=item["location"],
                                    jd_raw="",      # JD fetched by fetch_jds pipeline job
                                    source="linkedin",
                                    source_url=item["url"],
                                    application_url=item["url"],
                                    posted_at=item["posted_at"],
                                ))

                            if len(parsed) < 20:
                                break   # fewer than a full page → stop paginating

                            await asyncio.sleep(random.uniform(2.0, 3.5))

                        except Exception as e:
                            logger.warning("linkedin_query_error",
                                           query=query, page=page_num, error=str(e))
                            break   # stop pagination for this query; try next query

                    await asyncio.sleep(random.uniform(1.5, 2.5))

            finally:
                await context.close()
                await browser.close()

        logger.info("linkedin_scrape_complete", jobs_found=len(jobs))
        return jobs
```

- [x] **Step 2: Run existing tests**

```bash
cd agent
poetry run pytest tests/unit/ -v 2>&1 | tail -10
```

Expected: same pass count as before (LinkedIn scraper has no unit tests — all other tests pass)

- [x] **Step 3: Commit**

```bash
git add agent/agent/scrapers/linkedin.py
git commit -m "feat: improve LinkedIn scraper — stealth, location pref, posted_at, pagination, graceful error handling"
```

---

### Task 5: Create the LinkedIn JD scraper

**Files:**
- Create: `agent/agent/scrapers/linkedin_jd.py`

- [x] **Step 1: Create `agent/agent/scrapers/linkedin_jd.py`**

```python
"""LinkedIn JD scraper — visits individual job detail pages to extract full descriptions."""
import asyncio
import random
import structlog
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

logger = structlog.get_logger()

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Selectors tried in priority order on LinkedIn job detail pages
JD_SELECTORS = [
    "#job-details",
    ".description__text",
    ".show-more-less-html__markup",
]


class LinkedInJdScraper:
    """Fetches job description text from LinkedIn job detail pages.

    Does NOT extend AbstractScraper — has a different interface
    (takes {id, source_url} dicts, returns (job_id, jd_text) tuples).
    """

    async def fetch_jds(self, jobs: list[dict]) -> list[tuple[str, str]]:
        """
        Visit each job's LinkedIn detail page and extract the JD text.

        Returns a list of (job_id, jd_text) tuples. jd_text is '' for
        any page that fails — those jobs will be retried on the next run.
        """
        results: list[tuple[str, str]] = []

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            context = await browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1920, "height": 1080},
                locale="en-IN",
            )
            # Block images and fonts — only text content needed
            await context.route(
                "**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}",
                lambda r: r.abort(),
            )

            try:
                page = await context.new_page()
                await stealth_async(page)

                for job in jobs:
                    job_id = job["id"]
                    url    = job["source_url"]
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=20000)

                        jd_text = ""
                        for sel in JD_SELECTORS:
                            el = await page.query_selector(sel)
                            if el:
                                text = (await el.inner_text()).strip()
                                if text:
                                    jd_text = text
                                    break

                        results.append((job_id, jd_text))
                        logger.debug("linkedin_jd_fetched",
                                     job_id=job_id, chars=len(jd_text))
                        await asyncio.sleep(random.uniform(1.5, 3.0))

                    except Exception as e:
                        logger.warning("linkedin_jd_fetch_error",
                                       job_id=job_id, url=url, error=str(e))
                        results.append((job_id, ""))

            finally:
                await context.close()
                await browser.close()

        return results
```

- [x] **Step 2: Verify import**

```bash
cd agent
poetry run python -c "from agent.scrapers.linkedin_jd import LinkedInJdScraper; print('OK')"
```

Expected: `OK`

- [x] **Step 3: Commit**

```bash
git add agent/agent/scrapers/linkedin_jd.py
git commit -m "feat: add LinkedInJdScraper — fetches JD text from LinkedIn job detail pages"
```

---

### Task 6: Create the `fetch_jds` LangGraph

**Files:**
- Create: `agent/agent/graphs/fetch_jds.py`

- [x] **Step 1: Create `agent/agent/graphs/fetch_jds.py`**

```python
"""LangGraph for fetching LinkedIn job descriptions for discovered jobs with empty jd_raw."""
from __future__ import annotations
from datetime import datetime, timezone
import structlog
from langgraph.graph import StateGraph, END
from agent.models import FetchJdsState

logger = structlog.get_logger()

JD_FETCH_LIMIT = 100


async def _make_pool():
    from agent.config import settings
    from agent.db import create_pool
    return await create_pool(settings.database_url)


async def _close_pool(pool) -> None:
    from agent.db import close_pool
    await close_pool(pool)


async def _log(pool, job_id: str, level: str, step: str, message: str,
               data: dict | None = None) -> None:
    try:
        from agent.db import insert_pipeline_log
        await insert_pipeline_log(pool, job_id, level=level,
                                  step=step, message=message, data=data)
    except Exception as e:
        logger.warning("log_write_failed", error=str(e))


# ── Node: load_jobs ───────────────────────────────────────────────────────────

async def load_jobs(state: FetchJdsState) -> dict:
    """Load all discovered jobs with empty jd_raw (capped at JD_FETCH_LIMIT)."""
    pool = await _make_pool()
    try:
        from agent.db import get_jobs_with_empty_jd
        jobs = await get_jobs_with_empty_jd(
            pool, state.candidate_id, limit=JD_FETCH_LIMIT
        )
        await _log(pool, state.pipeline_job_id, "info", "load_jobs",
                   f"Found {len(jobs)} jobs needing JD fetch",
                   {"count": len(jobs)})
        logger.info("fetch_jds_load", count=len(jobs))
    finally:
        await _close_pool(pool)
    return {"jobs_to_fetch": jobs}


# ── Node: fetch_jds_batch ─────────────────────────────────────────────────────

async def fetch_jds_batch(state: FetchJdsState) -> dict:
    """Visit each job detail page and update jd_raw in the database."""
    from agent.scrapers.linkedin_jd import LinkedInJdScraper

    if not state.jobs_to_fetch:
        logger.info("fetch_jds_batch_skip", reason="no jobs to fetch")
        return {"fetched_count": 0, "failed_count": 0}

    pool = await _make_pool()
    scraper = LinkedInJdScraper()
    fetched = 0
    failed = 0

    try:
        await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                   f"Fetching JDs for {len(state.jobs_to_fetch)} jobs…",
                   {"total": len(state.jobs_to_fetch)})

        results = await scraper.fetch_jds(state.jobs_to_fetch)

        from agent.db import update_job_jd
        for job_id, jd_text in results:
            if jd_text:
                await update_job_jd(pool, job_id, jd_text)
                fetched += 1
            else:
                failed += 1

        await _log(pool, state.pipeline_job_id, "info", "fetch_jds_batch",
                   f"JD fetch complete — {fetched} fetched, {failed} failed",
                   {"fetched": fetched, "failed": failed})
        logger.info("fetch_jds_batch_done", fetched=fetched, failed=failed)

    finally:
        await _close_pool(pool)

    return {"fetched_count": fetched, "failed_count": failed}


# ── Node: write_fetch_summary ─────────────────────────────────────────────────

async def write_fetch_summary(state: FetchJdsState) -> dict:
    """Mark the fetch_jds pipeline job as completed and log the summary."""
    pool = await _make_pool()
    try:
        from agent.db import update_pipeline_run, update_pipeline_job_status

        now = datetime.now(timezone.utc).isoformat()
        try:
            await update_pipeline_run(
                pool, state.pipeline_run_id,
                status="completed",
                completedAt=now,
                jobsDiscovered=state.fetched_count,
            )
        except Exception as e:
            logger.error("write_fetch_summary_run_update_failed", error=str(e))
            await update_pipeline_run(pool, state.pipeline_run_id,
                                      status="completed", completedAt=now)

        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        await _log(pool, state.pipeline_job_id, "info", "write_fetch_summary",
                   f"JD fetch complete — {state.fetched_count} updated"
                   + (f", {state.failed_count} still pending" if state.failed_count else ""),
                   {"fetched": state.fetched_count, "pending": state.failed_count})

        logger.info("fetch_jds_complete",
                    fetched=state.fetched_count, failed=state.failed_count)

    except Exception as e:
        logger.error("write_fetch_summary_failed", error=str(e))
        try:
            await update_pipeline_job_status(
                pool, state.pipeline_job_id, "failed", error=str(e)
            )
        except Exception:
            pass
    finally:
        await _close_pool(pool)

    return {}


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_fetch_jds_graph():
    graph = StateGraph(FetchJdsState)
    graph.add_node("load_jobs",          load_jobs)
    graph.add_node("fetch_jds_batch",    fetch_jds_batch)
    graph.add_node("write_fetch_summary", write_fetch_summary)

    graph.set_entry_point("load_jobs")
    graph.add_edge("load_jobs",           "fetch_jds_batch")
    graph.add_edge("fetch_jds_batch",     "write_fetch_summary")
    graph.add_edge("write_fetch_summary", END)

    return graph.compile()


fetch_jds_graph = build_fetch_jds_graph()
```

- [x] **Step 2: Verify graph builds**

```bash
cd agent
poetry run python -c "from agent.graphs.fetch_jds import fetch_jds_graph; print('Graph nodes:', list(fetch_jds_graph.nodes))"
```

Expected output includes: `load_jobs`, `fetch_jds_batch`, `write_fetch_summary`

- [x] **Step 3: Commit**

```bash
git add agent/agent/graphs/fetch_jds.py
git commit -m "feat: add fetch_jds LangGraph — load_jobs → fetch_jds_batch → write_fetch_summary"
```

---

### Task 7: Modify `write_run_summary` to auto-queue `fetch_jds`

**Files:**
- Modify: `agent/agent/graphs/discovery.py` (lines 302–354)

- [x] **Step 1: Update `write_run_summary` to auto-queue `fetch_jds` when needed**

Find the existing `write_run_summary` function. Replace the block that calls `update_pipeline_job_status` and logs "Pipeline complete" with the following (everything from `await update_pipeline_job_status` onwards, inside the try block):

```python
        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        # Auto-queue a fetch_jds job if any discovered jobs still have empty jd_raw
        from agent.db import count_jobs_with_empty_jd, queue_pipeline_job
        unfetched = await count_jobs_with_empty_jd(pool, state.candidate_id)
        if unfetched > 0:
            await queue_pipeline_job(pool, state.candidate_id, "fetch_jds")
            await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
                       f"Pipeline complete — {new_count} jobs discovered. "
                       f"Queuing JD fetch for {unfetched} jobs…",
                       {"jobs_new": new_count, "jobs_deduped": dedup_count,
                        "pending_jd_fetch": unfetched})
        else:
            await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
                       f"Pipeline complete — {new_count} jobs discovered",
                       {"jobs_new": new_count, "jobs_deduped": dedup_count})

        logger.info(
            "discovery_run_complete",
            jobs_new=new_count,
            jobs_deduped=dedup_count,
            sources_failed=error_sources,
            pending_jd_fetch=unfetched if unfetched > 0 else 0,
        )
```

The `unfetched` variable must be declared before the `if/else` to avoid `possibly unbound` lint errors. Keep `unfetched = 0` as a default before the block:

Full updated `write_run_summary` try-block (replace from `new_count = ...` to the logger.info call):

```python
        new_count    = sum(1 for j in state.deduplicated_jobs if not j.is_duplicate)
        dedup_count  = sum(1 for j in state.deduplicated_jobs if j.is_duplicate)
        error_sources = len(state.errors)
        unfetched    = 0

        summary = RunSummary(
            total_new=new_count,
            total_deduped=dedup_count,
            total_failed_sources=error_sources,
        )

        now = datetime.now(timezone.utc).isoformat()

        try:
            await update_pipeline_run(
                pool, state.pipeline_run_id,
                status="completed",
                completedAt=now,
                summary=summary.model_dump(),
            )
        except Exception as e:
            logger.error("write_run_summary_update_failed", error=str(e))
            await update_pipeline_run(pool, state.pipeline_run_id,
                                      status="completed", completedAt=now)

        await update_pipeline_job_status(pool, state.pipeline_job_id, "completed")

        from agent.db import count_jobs_with_empty_jd, queue_pipeline_job
        unfetched = await count_jobs_with_empty_jd(pool, state.candidate_id)
        if unfetched > 0:
            await queue_pipeline_job(pool, state.candidate_id, "fetch_jds")
            await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
                       f"Pipeline complete — {new_count} jobs discovered. "
                       f"Queuing JD fetch for {unfetched} jobs…",
                       {"jobs_new": new_count, "jobs_deduped": dedup_count,
                        "pending_jd_fetch": unfetched})
        else:
            await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
                       f"Pipeline complete — {new_count} jobs discovered",
                       {"jobs_new": new_count, "jobs_deduped": dedup_count})

        logger.info(
            "discovery_run_complete",
            jobs_new=new_count,
            jobs_deduped=dedup_count,
            sources_failed=error_sources,
            pending_jd_fetch=unfetched,
        )
```

- [x] **Step 2: Run all Python tests**

```bash
cd agent
poetry run pytest tests/unit/ -v 2>&1 | tail -10
```

Expected: all tests pass

- [x] **Step 3: Commit**

```bash
git add agent/agent/graphs/discovery.py
git commit -m "feat: auto-queue fetch_jds job in write_run_summary when jd_raw is empty"
```

---

### Task 8: Modify `daemon.py` to dispatch `fetch_jds` job type

**Files:**
- Modify: `agent/agent/daemon.py`

- [x] **Step 1: Update `_dispatch_job` to branch on `job_type`**

Find the current `_dispatch_job` function and replace it with:

```python
async def _dispatch_job(pool, job: dict) -> None:
    """Dispatch a pipeline job to the appropriate LangGraph graph."""
    from agent.db import insert_pipeline_run, get_candidate_preferences

    run_id = await insert_pipeline_run(pool, job['id'], job['candidate_id'])

    if job['job_type'] == 'fetch_jds':
        from agent.graphs.fetch_jds import fetch_jds_graph
        from agent.models import FetchJdsState

        logger.info("job_dispatching",
                    job_id=job['id'], job_type='fetch_jds')

        state = FetchJdsState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
        )
        await fetch_jds_graph.ainvoke(state)

    else:
        from agent.graphs.discovery import discovery_graph
        from agent.models import DiscoveryState

        preferences = await get_candidate_preferences(pool, str(job['candidate_id']))
        enabled = preferences.get('enabled_sources', [])
        logger.info(
            "job_dispatching",
            job_id=job['id'],
            job_type=job['job_type'],
            enabled_sources=enabled if enabled else 'all (none selected)',
        )

        state = DiscoveryState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
            preferences=preferences,
        )
        logger.info("graph_invoking", graph="discovery", job_id=job['id'])
        await discovery_graph.ainvoke(state)
        logger.info("graph_complete", graph="discovery", job_id=job['id'])
```

- [x] **Step 2: Verify daemon imports cleanly**

```bash
cd agent
poetry run python -c "from agent.daemon import main; print('daemon OK')" 2>&1
```

Expected: `daemon OK` (no warnings, no errors)

- [x] **Step 3: Run all tests**

```bash
cd agent
poetry run pytest tests/unit/ -v 2>&1 | tail -10
```

Expected: all tests pass

- [x] **Step 4: Commit**

```bash
git add agent/agent/daemon.py
git commit -m "feat: dispatch fetch_jds job type to fetch_jds_graph in daemon"
```

---

### Task 9: End-to-end verification

**Files:** none changed — verification only

- [x] **Step 1: Reset DB and trigger a fresh discovery run**

```bash
# From repo root
node -e "
const db = require('better-sqlite3')('./proxim-dev.db')
db.prepare('DELETE FROM pipeline_logs').run()
db.prepare('DELETE FROM pipeline_runs').run()
db.prepare('DELETE FROM jobs').run()
db.prepare('DELETE FROM scan_history').run()
db.prepare('DELETE FROM pipeline_jobs').run()
console.log('Reset done')
"
curl -s -X POST http://localhost:3000/api/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"jobType":"discovery_only"}'
```

Expected: `{"jobId":"...","status":"queued",...}`

- [x] **Step 2: Start the daemon (restart if already running)**

```bash
cd agent
poetry run python -m agent.daemon
```

Watch for these log lines in order:
1. `job_claimed job_type=discovery_only`
2. `linkedin_scrape_complete jobs_found=N`
3. `Pipeline complete — N jobs discovered. Queuing JD fetch for N jobs…`
4. `job_claimed job_type=fetch_jds`
5. `Found N jobs needing JD fetch`
6. `Fetching JDs for N jobs…`
7. `JD fetch complete — N fetched, M failed`
8. `JD fetch complete — N updated`

- [x] **Step 3: Verify `jd_raw` is populated in the DB**

```bash
node -e "
const db = require('better-sqlite3')('./proxim-dev.db')
const total  = db.prepare('SELECT COUNT(*) as c FROM jobs').get().c
const withJd = db.prepare(\"SELECT COUNT(*) as c FROM jobs WHERE jd_raw != ''\").get().c
const noJd   = db.prepare(\"SELECT COUNT(*) as c FROM jobs WHERE jd_raw = ''\").get().c
console.log('Total jobs:', total)
console.log('With JD:   ', withJd)
console.log('Without JD:', noJd)
const sample = db.prepare(\"SELECT title, company, substr(jd_raw,1,100) as preview FROM jobs WHERE jd_raw != '' LIMIT 3\").all()
sample.forEach(j => console.log(' -', j.title, '@', j.company, '|', j.preview))
"
```

Expected: `With JD` count > 0, sample shows real JD text

- [x] **Step 4: Verify pipeline_jobs shows both job types**

```bash
node -e "
const db = require('better-sqlite3')('./proxim-dev.db')
console.log(JSON.stringify(db.prepare('SELECT job_type, status, created_at FROM pipeline_jobs ORDER BY created_at').all(), null, 2))
"
```

Expected: two rows — `discovery_only` (completed) and `fetch_jds` (completed)

- [x] **Step 5: Run Next.js tests to ensure nothing broken**

```bash
npm run test:run && npx tsc --noEmit
```

Expected: 0 failures, 0 type errors

- [x] **Step 6: Commit plan completion marker**

```bash
git add docs/superpowers/plans/2026-05-02-linkedin-jd-fetch.md
git commit -m "docs: mark LinkedIn JD fetch plan complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ FR-003/FR-011 raw JD text captured — Tasks 5, 6
- ✅ Session isolation — Tasks 4, 5 (separate browser instances)
- ✅ Auto-queue `fetch_jds` — Task 7
- ✅ Graceful per-job failure (empty jd_raw, retry next run) — Task 5
- ✅ 100-job cap per `fetch_jds` run — Task 6 (JD_FETCH_LIMIT)
- ✅ Location from preferences — Task 4
- ✅ `posted_at` extraction — Task 4
- ✅ Pagination — Task 4
- ✅ 4 new DB functions in both sqlite + pg — Tasks 2, 3
- ✅ `FetchJdsState` model — Task 1
- ✅ Daemon dispatch — Task 8
- ✅ End-to-end test — Task 9

**Type consistency:** `FetchJdsState` defined in Task 1, used identically in Tasks 6 and 8. `get_jobs_with_empty_jd` returns `list[dict]` with keys `id` and `source_url` — consumed identically in Task 6. `queue_pipeline_job` returns `str` — return value used in Task 7 (discarded; job ID not needed after queuing).
