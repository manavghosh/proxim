# Agent Workflow

Diagrams of all LangGraph graphs in the Proxim agent and how they chain together.

---

## Overall Pipeline Flow

Graphs are never invoked directly by each other. They communicate through the database queue — the daemon polls every 3 seconds, claims the next queued job, and dispatches it to the right graph.

```mermaid
flowchart TD
    UI([User / Dashboard]) -->|trigger search| Q1[(pipeline_jobs: discover)]
    Q1 --> DaemonA[Daemon poll loop]
    DaemonA --> DG[Discovery Graph]
    DG -->|unfetched jobs → queue fetch_jds| Q2[(pipeline_jobs: fetch_jds)]
    Q2 --> DaemonB[Daemon poll loop]
    DaemonB --> FG[Fetch JDs Graph]
    FG -->|user reviews jobs in UI| UI2([User selects jobs])
    UI2 -->|queue score_jobs| Q3[(pipeline_jobs: score_jobs)]
    Q3 --> DaemonC[Daemon poll loop]
    DaemonC --> SG[Scoring Graph]
    SG -->|user triggers resume| Q4[(pipeline_jobs: resume_builder)]
    Q4 --> DaemonD[Daemon poll loop]
    DaemonD --> RG[Resume Builder Graph]
    RG --> Done([Resume PDF stored])

    style Q1 fill:#f5f0e8,stroke:#c9a84c
    style Q2 fill:#f5f0e8,stroke:#c9a84c
    style Q3 fill:#f5f0e8,stroke:#c9a84c
    style Q4 fill:#f5f0e8,stroke:#c9a84c
    style Done fill:#d4edda,stroke:#28a745
```

---

## Discovery Graph

Builds search queries, fans out to all enabled job boards in parallel, deduplicates, then persists.

```mermaid
flowchart TD
    START([START]) --> BQ[build_queries]
    BQ -->|fan_out — one Send per enabled source| SN[scrape_naukri]
    BQ --> SI[scrape_iimjobs]
    BQ --> SL[scrape_linkedin]
    BQ --> SC[scrape_careers_page]
    BQ --> SM[scrape_monster]
    SN --> ND[normalise_and_dedup]
    SI --> ND
    SL --> ND
    SC --> ND
    SM --> ND
    ND --> PJ[persist_jobs]
    PJ --> WR[write_run_summary]
    WR -->|if unfetched jobs > 0| QFetch[(queue: fetch_jds)]
    WR --> END_D([END])

    style QFetch fill:#f5f0e8,stroke:#c9a84c
    style END_D fill:#d4edda,stroke:#28a745
```

> `fan_out` is a conditional edge that emits one `Send` per enabled source in `preferences.enabled_sources`. Disabled sources are skipped entirely. All scrapers run in parallel and their `raw_jobs` lists are merged via `operator.add`.

---

## Fetch JDs Graph

Loads jobs that have no JD text yet and fetches their full descriptions from source URLs.

```mermaid
flowchart TD
    START([START]) --> LJ[load_jobs]
    LJ --> FB[fetch_jds_batch]
    FB --> WF[write_fetch_summary]
    WF --> END_F([END])

    style END_F fill:#d4edda,stroke:#28a745
```

> After this graph completes, the pipeline **waits for user action** — the candidate reviews discovered jobs in the UI and selects which to score.

---

## Scoring Graph

Scores a batch of jobs (all ready jobs, or a user-selected subset) against the candidate's profile.

```mermaid
flowchart TD
    START([START]) --> LJ[load_jobs]
    LJ --> SB[score_and_report_batch]
    SB --> WS[write_score_summary]
    WS --> END_S([END])

    style END_S fill:#d4edda,stroke:#28a745
```

> `state.job_ids` is an optional list of specific job IDs to score. When empty, all `fetch_ready` jobs for the candidate are scored.

---

## Resume Builder Graph

Tailors the candidate's base resume to a specific job, runs a self-review loop, injects keywords, generates a cover letter, and renders the final PDF.

```mermaid
flowchart TD
    START([START]) --> VI[validate_inputs]
    VI -->|error| HF[handle_failure]
    VI -->|ok| EK[extract_keywords]
    EK --> PR[personalise_resume]
    PR -->|error| HF
    PR -->|ok| SR[self_review]
    SR -->|review passed OR attempt ≥ 2| IK[inject_keywords]
    SR -->|not passed AND attempt < 2| PR
    IK --> GC[generate_cover_letter]
    GC --> RP[render_pdf]
    RP -->|error| HF
    RP -->|ok| SV[store_version]
    SV --> END_R([END])
    HF --> END_R

    style END_R fill:#d4edda,stroke:#28a745
    style HF fill:#f8d7da,stroke:#dc3545
```

> `self_review` retries `personalise_resume` up to **2 times** if the LLM self-review fails. On the third attempt it forces forward to `inject_keywords` regardless (FR-014).

---

## Non-Graph Pipelines (node sequences in daemon)

These job types run as direct node-function sequences inside `daemon.py` — no compiled `StateGraph`.

| Job type | Steps |
|---|---|
| `linkedin_connector` | check_dnc → extract_hiring_team → discover_contact → enrich_profile → research_contact → generate_notes |
| `linkedin_note_regen` | enrich_profile → research_contact → generate_notes |
| `outreach_mailer` | discover_email → generate_emails → write_cadence_checkpoint |
| `outreach_mailer_generate` | generate_emails → write_cadence_checkpoint |
| `import_jobs` | fetch LinkedIn JDs → update job meta → queue score_jobs |
