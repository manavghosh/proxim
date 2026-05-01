# LinkedIn JD Fetch — Design Spec

**Date:** 2026-05-02
**Status:** Approved

---

## Goal

Make the LinkedIn scraper spec-compliant by capturing full job description text (`jd_raw`) for every discovered job, while keeping each pipeline run fast and reliable through session isolation.

---

## Problem Statement

The current LinkedIn scraper captures title, company, location, and URL but leaves `jd_raw = ''`. This violates **FR-003** and **FR-011** of the job discovery spec. Fetching JDs in the same browser session as search scraping creates long sessions that LinkedIn rate-limits. JD fetches that fail have no retry path.

---

## Architecture

Two sequential pipeline job types processed one at a time by the daemon:

```
User clicks "Run Pipeline"
        ↓
[pipeline_job: discovery_only]
  LinkedIn search scraper (stealth, paginated, location-aware)
  → dedup → persist jobs with jd_raw = ''
  → write_run_summary: count jobs with empty jd_raw
        ↓ if > 0: INSERT pipeline_job(fetch_jds)
[pipeline_job: fetch_jds]   ← daemon picks up ~3 seconds later
  Fresh browser + stealth
  → SELECT jobs WHERE jd_raw = '' AND status = 'discovered'
  → Visit each job detail page → extract JD text
  → UPDATE jobs.jd_raw
  → Log progress to pipeline_logs (visible in dashboard log pane)
```

**Why two sessions?** Each session is short and pattern-focused. Session 1 only does search pages; Session 2 only visits individual job pages. LinkedIn is far less likely to rate-limit sessions that look like normal browsing. A fresh TCP connection for JD fetching carries no "prior suspicion" from the search phase.

**Retry path:** `write_run_summary` always checks for `jd_raw = ''` jobs. If any remain after a `fetch_jds` run, the next `discovery_only` run will auto-queue another `fetch_jds` job. No manual intervention needed.

---

## LinkedIn Search Scraper Changes (existing `linkedin.py`)

| Current | After |
|---|---|
| No stealth | `stealth_async` applied |
| Hardcoded `location=India` | Reads from `geographic_preference` preference |
| `jd_raw = ""` placeholder | Explicit `jd_raw = ""` — JD collected separately |
| No `posted_at` | Extract from `.job-search-card__listdate` |
| 1 page per query | Paginate to page 2 if page 1 returns a full result set (≥ 20 jobs) |
| Breaks on any error | Continues to next query on per-query failure |

---

## New: LinkedIn JD Scraper (`linkedin_jd.py`)

Single-responsibility scraper that only fetches job descriptions from LinkedIn job detail pages.

**Behaviour:**
- Opens one fresh browser + stealth context per run
- Processes jobs in batches of up to **100 per run** (prevents exceeding 10-min budget)
- For each job URL: navigate → wait for `#job-details` or `.description__text` → extract text
- Random delay 1.5–3s between pages
- On individual page failure: log warning, leave `jd_raw = ''`, continue to next — never aborts
- Closes browser when done

**JD extraction selectors (in priority order):**
1. `#job-details` — LinkedIn's primary JD container
2. `.description__text` — fallback for older layout
3. `.show-more-less-html__markup` — expanded JD markup
4. Any `section` containing "About the job" heading

---

## New: `fetch_jds` Graph (`graphs/fetch_jds.py`)

Simple sequential LangGraph (no fan-out):

```
load_jobs → fetch_jds_batch → write_fetch_summary → END
```

- `load_jobs`: queries `get_jobs_with_empty_jd(pool, candidate_id)`, caps at 100
- `fetch_jds_batch`: calls `LinkedInJdScraper.scrape(job_urls)`, updates DB per job
- `write_fetch_summary`: logs counts, marks `fetch_jds` job completed

---

## New DB Functions (both `db_sqlite.py` and `db_pg.py`)

| Function | Purpose |
|---|---|
| `get_jobs_with_empty_jd(pool, candidate_id) → list[dict]` | Returns `[{id, source_url}]` for jobs where `jd_raw = ''` |
| `update_job_jd(pool, job_id, jd_raw) → None` | Updates a single job's `jd_raw` field |
| `count_jobs_with_empty_jd(pool, candidate_id) → int` | Used by `write_run_summary` to decide whether to queue |
| `queue_pipeline_job(pool, candidate_id, job_type) → str` | Inserts a new pipeline_job, returns job_id |

---

## Modified: `write_run_summary` (discovery graph)

After marking `discovery_only` complete, adds:

```python
unfetched = await count_jobs_with_empty_jd(pool, state.candidate_id)
if unfetched > 0:
    await queue_pipeline_job(pool, state.candidate_id, 'fetch_jds')
    await _log(pool, state.pipeline_job_id, "info", "write_run_summary",
               f"Queuing JD fetch for {unfetched} jobs…", {"pending": unfetched})
```

---

## Modified: `daemon.py`

Dispatches `fetch_jds` job type to the new `fetch_jds_graph`:

```python
if job['job_type'] == 'fetch_jds':
    from agent.graphs.fetch_jds import fetch_jds_graph
    await fetch_jds_graph.ainvoke(state)
else:
    await discovery_graph.ainvoke(state)
```

---

## Schema Changes

**None.** `jobs.jd_raw` already exists as `TEXT NOT NULL`. `pipeline_jobs.job_type` is free-form `TEXT` — adding `'fetch_jds'` requires no migration. The PG enum `pipeline_job_status` is untouched.

---

## Files Changed / Created

| File | Action |
|---|---|
| `agent/agent/scrapers/linkedin.py` | Modify — stealth, location pref, posted_at, pagination |
| `agent/agent/scrapers/linkedin_jd.py` | Create — JD-only scraper |
| `agent/agent/graphs/fetch_jds.py` | Create — fetch_jds LangGraph |
| `agent/agent/graphs/discovery.py` | Modify — auto-queue in write_run_summary |
| `agent/agent/daemon.py` | Modify — dispatch fetch_jds job type |
| `agent/agent/db_sqlite.py` | Modify — 4 new DB functions |
| `agent/agent/db_pg.py` | Modify — 4 new DB functions |

---

## Constraints

- JD fetch capped at 100 jobs per `fetch_jds` run to stay within 10-min budget
- Failed individual JD fetches leave `jd_raw = ''` and are retried by the next run's auto-queue
- LinkedIn session never shared between search and JD phases
- No schema migration required
