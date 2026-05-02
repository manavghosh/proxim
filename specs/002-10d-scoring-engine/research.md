# Research: 10-Dimension Scoring Engine (F9)

**Phase 0 output** | Date: 2026-05-02 | Spec: [spec.md](spec.md)

---

## Decision 1: LLM Structured Output Strategy

**Decision**: LiteLLM `completion()` with `response_format={"type": "json_object"}` + Pydantic `model_validate()`. Grade and numeric score are **recomputed deterministically in Python** — the LLM's self-reported grade is discarded.

**Rationale**: Per Constitution §V, all Python-agent LLM calls must use LiteLLM with `response_format` JSON schema + Pydantic validation. Computing grade deterministically in Python (not trusting the LLM's output) prevents the LLM from gaming its own score and ensures 100% reproducible grade boundaries given the same dimension scores.

**Alternatives considered**:
- Vercel AI SDK `generateObject` — rejected: Next.js runtime only (Constitution §V). Scoring is a multi-step pipeline step — must run in Python agent.
- Free-text LLM response with regex parsing — rejected: Constitution §IV explicitly forbids regex on machine-consumed outputs.
- Asking LLM to compute weighted average — rejected: floating-point arithmetic in LLM responses is unreliable; deterministic Python computation is the correct approach.

**Implementation notes**:
- Temperature 0.1 for scoring (consistency over creativity).
- Self-repair retry: up to 2 retries on `ValidationError` or `json.JSONDecodeError`. After 3 total attempts, mark job `score_failed`.
- Gate-pass threshold: `< 2.5` on either gate dimension → automatic F, no weighted scoring.
- Weighted average computed locally: `sum(score * weight for dim, weight in WEIGHTS.items()) / sum(WEIGHTS.values())`.

---

## Decision 2: Report Generation — One LLM Call Per Job

**Decision**: For B+ jobs, a second LiteLLM call generates all 6 report blocks in one JSON response. F-grade jobs get block_a only via a shorter, faster prompt.

**Rationale**: Combining all 6 blocks in one call minimises latency (stays within the 45-second target). Splitting into 6 calls would multiply latency by ~6x. The prompt explicitly references `candidates.parsed_profile` as the sole source of truth for proof points, enforcing Constitution §III (Factual Integrity).

**Alternatives considered**:
- Streaming report generation — rejected: adds UI complexity for marginal benefit; report is viewed after job is fully scored, not during scoring.
- 6 separate LLM calls per block — rejected: latency would exceed SC-002's 45-second target.
- Skipping report for C/D grades — rejected: FR-006 only exempts F-grade from full report; B+ is explicitly required. C/D report generation is out of scope for MVP (Block A only for C/D is an acceptable interpretation).

---

## Decision 3: Auto-Chain Trigger — fetch_jds Queues score_jobs

**Decision**: `write_fetch_summary` in `graphs/fetch_jds.py` calls `count_jobs_to_score()` after completing; if > 0, auto-queues a `score_jobs` pipeline job. The dashboard status poll chains to `score_jobs` via `followUpJobId`, keeping the "Pipeline: running" state visible throughout.

**Rationale**: The PRD data flow is "Job discovered → 10D scored" — scoring should be automatic, not a manual user action. Chaining via the Neon job queue (not HTTP) is the correct pattern per Constitution §VII.

**Alternatives considered**:
- Manual "Score Jobs" button on dashboard — rejected: adds friction; PRD requires automatic scoring after discovery.
- Scoring inline in `fetch_jds_batch` — rejected: violates agent modularity (Constitution §II); scoring is a separate concern from JD fetching.
- Auto-queue from `discovery_only` write_run_summary — rejected: JDs must be populated first; scoring on empty `jd_raw` would always return poor results.

---

## Decision 4: Archetype Stored With Score, Not Re-Detected in F10

**Decision**: The scoring prompt detects the archetype (one of 5) and returns it as part of `JobScoreOutput`. It is stored in `jobs.archetype` and `jobs.archetype_confidence` during scoring, so F10 (Resume Builder) can read it directly without a second LLM call.

**Rationale**: Spec §Assumptions explicitly states "Archetype detection (used by F10) is a by-product of scoring Block D and is stored with the job record to avoid a second LLM call in F10." Embedding archetype detection in the scoring prompt costs nothing additional and eliminates a future LLM call.

---

## Decision 5: SQLite Compatibility — Deterministic Grade Not Timestamp Comparison

**Decision**: The `get_jobs_to_score()` query filters `WHERE jd_raw != '' AND status = 'discovered'` using text comparison (works on both SQLite and PostgreSQL). The timestamp-based `started_at` comparison in the auto-expire uses `.toISOString()` (established pattern from trigger route).

**Rationale**: This project runs SQLite locally and Neon in production. All DB functions must work on both. Using string comparisons and ISO timestamps avoids the better-sqlite3 `Date` object binding issue (documented in commit `e8a9047`).
