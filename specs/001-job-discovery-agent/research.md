# Research: Job Discovery Agent (F2)

**Phase 0 output** | Date: 2026-04-30 | Spec: spec.md

---

## Decision 1: LinkedIn Job Scraping Approach

**Decision**: Playwright-based browser automation with human-like delays.

**Rationale**: LinkedIn removed public job search API access. Proxycurl offers a job listings API (paid tier) but is cost-prohibitive at scale for discovery. Playwright with stealth configuration (disabling `navigator.webdriver` fingerprint) mimics browser behaviour closely enough for low-volume, single-candidate use. For an MVP serving one candidate, rate limits are easily manageable.

**Alternatives considered**:
- Proxycurl job listings API — rejected: expensive per-call pricing at discovery volume; reserved for profile enrichment in F5.
- Unofficial LinkedIn API wrappers (linkedin-api, linkedin-scraper on PyPI) — rejected: fragile, frequently broken by LinkedIn UI changes, no maintenance guarantees.
- Static HTML scraping with requests — rejected: LinkedIn job search results are fully JavaScript-rendered.

**Implementation notes**:
- Use `playwright-stealth` plugin to mask automation fingerprints.
- Add 2–4 second random delay between page navigations.
- Limit to 50 job results per query per run (enough for a single-candidate MVP).
- If 429 / CAPTCHA detected: log, skip source for this run, do not retry.

---

## Decision 2: Naukri.com and iimjobs.com Scraping

**Decision**: Naukri — requests + BeautifulSoup with Naukri's undocumented JSON search endpoint. iimjobs — requests + BeautifulSoup on paginated search results.

**Rationale**: Both sites render key job data server-side (no JS required for the listing cards). Naukri exposes a JSON API at `/api/pht/jobs/search` that returns structured job data directly. iimjobs paginated HTML is stable and straightforward to parse.

**Alternatives considered**:
- Playwright for both — rejected: overkill for static pages; adds 2–5s per page vs. < 0.5s with requests.
- Official APIs — neither Naukri nor iimjobs provides a public job search API.

**Implementation notes**:
- Naukri: `GET https://www.naukri.com/jobapi/v3/search?noOfResults=50&urlType=search_by_keyword&searchType=adv&keyword={query}&jobAge=3` with appropriate headers.
- iimjobs: paginated HTML at `https://www.iimjobs.com/j/{slugified-query}-jobs`.
- Both sources: set realistic `User-Agent` and `Accept` headers. Add 1–2 second delay between requests.
- If HTTP 429 or connection error: single retry after 30 seconds.

---

## Decision 3: Fuzzy Deduplication Algorithm

**Decision**: `rapidfuzz` library — `fuzz.token_sort_ratio` on a normalised `(company + title)` compound key, threshold ≥ 85.

**Rationale**: Job titles have high variance: "Head of AI", "Head, Artificial Intelligence", "AI Practice Head" all refer to similar roles at the same company. Token sort ratio handles word-order variance better than simple Levenshtein. Threshold of 85 catches variants while avoiding false positives between genuinely different roles (e.g., "Head of AI" vs. "Head of Data" at the same company).

**Normalisation pre-processing before comparison**:
1. Lowercase both strings.
2. Remove punctuation, parentheses, and articles.
3. Expand common abbreviations: `sr.` → `senior`, `mgr` → `manager`, `vp` → `vice president`.
4. Strip trailing qualifiers: `(Remote)`, `- Urgent`, `#1234`.

**Alternatives considered**:
- TF-IDF cosine similarity — overkill; requires a corpus. Token sort ratio on 2-field compound key is sufficient.
- Edit distance only (Levenshtein) — fails on word-reordering ("VP of AI Engineering" vs. "AI Engineering VP").
- Exact match only — misses the "Head of AI" / "Head, AI" class of duplicates from multiple boards.

---

## Decision 4: LangGraph Fan-Out Pattern for Parallel Scraping

**Decision**: LangGraph `Send` API for dynamic fan-out — one `Send` per source, collected by a state reducer.

**Rationale**: LangGraph 0.4.x supports dynamic fan-out via `Send` objects returned from a routing node. Each scraper runs as a separate graph node receiving its source config. Results are merged into the graph state via a `list` reducer (each node appends its jobs to a shared list).

**Graph topology**:
```
start
  └─► build_queries (generate 5-8 queries per source)
        └─► fan_out (returns [Send(scrape_linkedin, ...), Send(scrape_naukri, ...), ...])
              ├─► scrape_linkedin ─┐
              ├─► scrape_naukri   ├─► collect (reducer merges all job lists)
              ├─► scrape_iimjobs  │       └─► normalise_and_dedup
              └─► scrape_careers  ┘               └─► persist_jobs
                                                       └─► write_run_summary → END
```

**State schema** (Pydantic):
```python
class DiscoveryState(BaseModel):
    candidate_id: str
    pipeline_job_id: str
    preferences: dict
    queries: dict[str, list[str]]  # source → [query list]
    raw_jobs: Annotated[list[RawJob], operator.add]  # reducer: append
    deduplicated_jobs: list[NormalisedJob]
    run_summary: RunSummary | None
    errors: Annotated[list[SourceError], operator.add]  # reducer: append
```

**Alternatives considered**:
- Sequential scraping in a loop — rejected: wastes time; spec requires parallel execution.
- asyncio.gather outside LangGraph — rejected: bypasses LangGraph checkpointing and LangSmith tracing.
- Subgraph per source — rejected: overkill for simple scraping nodes; `Send` fan-out is sufficient.

---

## Decision 5: Python Service Structure

**Decision**: `agent/` directory at repository root alongside `src/` (Next.js). Poetry for dependency management. No FastAPI — the agent is a polling daemon, not an HTTP server (per Constitution §VII: only `GET /health` is permitted).

**Directory layout**:
```
agent/
├── pyproject.toml              ← Poetry manifest
├── Dockerfile
├── agent/
│   ├── daemon.py               ← asyncio polling loop (3s interval)
│   ├── graphs/
│   │   └── discovery.py        ← LangGraph discovery graph
│   ├── scrapers/
│   │   ├── base.py             ← AbstractScraper ABC
│   │   ├── linkedin.py         ← Playwright
│   │   ├── naukri.py           ← requests + BS4
│   │   ├── iimjobs.py          ← requests + BS4
│   │   └── careers_page.py     ← Playwright
│   ├── normalise.py            ← Dedup + normalisation (rapidfuzz)
│   ├── db.py                   ← asyncpg pool + query functions
│   ├── models.py               ← Pydantic models (RawJob, NormalisedJob, etc.)
│   └── config.py               ← Settings from environment (pydantic-settings)
└── tests/
    ├── unit/
    │   ├── test_normalise.py
    │   └── test_scrapers/      ← Fixture-based scraper tests
    └── fixtures/
        ├── linkedin_page.html
        ├── naukri_response.json
        └── iimjobs_page.html
```

**Rationale**: Single `agent/` service directory keeps Python code isolated from the Next.js app. Poetry provides reproducible builds. Fixture-based tests avoid live network calls in CI.

---

## Decision 6: `pipeline_jobs` Table Ownership

**Decision**: Table defined in Next.js `src/db/schema.ts` (Drizzle) and migrated with `drizzle-kit`. Python reads it via asyncpg directly, not via Drizzle.

**Rationale**: Per Constitution §VII, Neon is the sole communication channel between runtimes. The Next.js schema file is the source of truth for the database schema. Python reads the same tables via raw asyncpg queries. This avoids maintaining two schema definitions (one in Drizzle, one in SQLAlchemy).

**Implication**: Any schema change must be made in `src/db/schema.ts` and applied via `npm run db:generate && npm run db:migrate`. Python models are hand-aligned to the Drizzle-managed schema.

---

## Decision 7: Playwright Runtime in Docker

**Decision**: Playwright Chromium browsers installed inside the agent Docker image. Not installed on the host.

**Rationale**: Playwright requires browser binaries. Baking them into the Docker image ensures consistent behaviour across environments and avoids `playwright install` on every host setup.

**Docker base image**: `mcr.microsoft.com/playwright/python:v1.44.0-jammy` — official Playwright Python image with Chromium pre-installed.

**Local development (non-Docker)**: `poetry run playwright install chromium` — documented in quickstart.md.
