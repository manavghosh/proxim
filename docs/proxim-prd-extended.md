# Proxim — Product Requirements Document (Extended)

**Version:** 2.0 — Extended with F9 & F10
**Author:** Manav Ghosh
**Status:** Draft — Ready for SpecKit Decomposition
**Last Updated:** April 2026

> **Core philosophy:** AI analyses, humans decide. Nothing external fires without explicit user approval.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Users](#2-target-users)
3. [System Architecture](#3-system-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Feature Specifications F1–F8](#5-feature-specifications-f1f8)
6. [Feature Addendum F9–F10](#6-feature-addendum-f9f10)
7. [Architecture Decision Records](#7-architecture-decision-records)
8. [Implementation Phases](#8-implementation-phases)
9. [Success Metrics](#9-success-metrics)
10. [MVP Scope](#10-mvp-scope)

---

## 1. Product Overview

Proxim is an autonomous multi-agent job hunting system built for senior IT professionals. It automates the full job search pipeline — discovery, scoring, resume personalisation, and outreach — while keeping the human in control of every consequential decision.

The system runs a LangGraph-orchestrated swarm of five specialised agents, each responsible for a distinct stage of the pipeline. Agents communicate through a shared state graph with persistent checkpointing. The candidate reviews scored results on a dashboard and approves outreach before anything external fires.

### Problem Statement

Senior IT professionals searching for leadership roles face:
- **Volume without signal** — 70%+ of job listings are poor fits, discovered only after reading the full JD
- **Personalisation gap** — generic CVs fail ATS filters and don't convert for senior roles
- **Outreach inconsistency** — follow-through degrades when life gets busy; opportunities lost between Day 1 and Day 7
- **No feedback loop** — no visibility into whether the problem is fit, the CV, or timing

### Solution

Proxim solves each problem with a dedicated agent:
1. **Job Hunter Agent** — discovers and deduplicates listings across aggregators and direct careers pages
2. **Match Analyst Agent** (upgraded with 10D scoring in F9) — grades every listing A–F before it reaches the user
3. **Resume Builder Agent** (new in F10) — generates ATS-optimised, archetype-matched resume + cover letter per approved job
4. **LinkedIn Connector Agent** — finds hiring managers and queues personalised connection notes
5. **Outreach Mailer Agent** — runs a 3-touch email cadence with tracking and auto-pause on reply

---

## 2. Target Users

**Primary:** Senior IT professionals in India targeting leadership AI roles

| Role Type | Examples |
|-----------|---------|
| Enterprise AI leadership | CAIO, Head of AI, VP AI at large Indian enterprises / GCCs |
| Startup CTO / VP Eng | Series B–D AI-first startups |
| Distinguished Engineer | Principal AI Architect at product companies |
| AI Practice Head | Head of AI Practice at GCCs (Walmart, JPMC, Goldman India) |
| AI Thought Leader | Partner / Principal at AI consultancies |

**Secondary:** Any senior IT professional (15+ years experience) conducting a structured job search in a competitive market.

---

## 3. System Architecture

### Agent Topology

```
User Input / Configuration
        │
        ▼
┌───────────────────────────────────────────────────────┐
│              Master LangGraph Orchestrator             │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Job     │  │  Match   │  │  Resume Builder  │   │
│  │  Hunter  │─▶│  Analyst │─▶│  Agent (F10)     │   │
│  │  Agent   │  │  (F9)    │  │                  │   │
│  └──────────┘  └──────────┘  └────────┬─────────┘   │
│                                        │             │
│              HITL Checkpoint ◀─────────┘             │
│              (User approves)                         │
│                    │                                 │
│        ┌───────────┴───────────┐                     │
│        ▼                       ▼                     │
│  ┌──────────┐          ┌──────────────┐              │
│  │ LinkedIn │          │   Outreach   │              │
│  │Connector │          │   Mailer     │              │
│  │  Agent   │          │   Agent      │              │
│  └──────────┘          └──────────────┘              │
└───────────────────────────────────────────────────────┘
        │
        ▼
  LangDB Observability + Neon PostgreSQL + Grafana Tempo + Grafana
```

### Data Flow

```
Job discovered → 10D scored → A/B grade → HITL review →
Approved → Resume generated → LinkedIn queued → Email cadence fired →
Reply detected → Pipeline paused → Interview tracked
```

### Graph Patterns

- **Master graph:** Reactive pattern — nodes triggered by state transitions
- **Job Hunter sub-graph:** Fan-out pattern — parallel scraping across N sources
- **Scoring sub-graph:** Sequential — gate-pass → weighted scoring → report generation
- **Outreach sub-graph:** Planner pattern — LinkedIn + email tracks run in parallel

---

## 4. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Orchestration | LangGraph | Multi-agent state graph with checkpointing |
| LLM | Claude Sonnet (Anthropic) — default | Scoring, report generation, resume personalisation, email drafting |
| LLM abstraction | LiteLLM | Provider-configurable LLM access (Anthropic / Gemini / OpenAI) via `LLM_PROVIDER` env var |
| Backend | FastAPI (Python) | API layer, webhook receivers, orchestration triggers |
| Frontend | Next.js (TypeScript) | HITL review dashboard, pipeline tracker, analytics |
| Database | Neon PostgreSQL (serverless) | Job records, resume versions, cadence state, user preferences |
| Job scraping | BeautifulSoup + Playwright | Aggregator scraping + company careers page navigation |
| LinkedIn enrichment | Proxycurl API | Hiring manager discovery and profile enrichment |
| Email discovery | Hunter.io | Verified email address lookup |
| Email sending | Gmail API (OAuth2) / Resend | Outreach cadence delivery |
| PDF rendering | Puppeteer (headless Chrome) | ATS-safe resume + cover letter PDF generation |
| Company research | Exa AI | Semantic search for recent company AI initiatives |
| Observability | LangDB | LLM cost tracking, decision auditing, token usage (SDK instrumentation mode — no proxy hop) |
| LLM tracing (dev/staging) | LangSmith | LangGraph-native run inspection, prompt replay, regression dataset capture |
| Distributed tracing | Grafana Tempo | Cross-agent request tracing via OpenTelemetry collector |
| Metrics | Prometheus + Grafana | System health, throughput, latency dashboards |
| Task queue | Celery + Redis | Async cadence scheduling, retry logic |
| State persistence | LangGraph checkpointer → Neon | Crash-safe pipeline resume from any step |
| Containerisation | Docker + Docker Compose | Local dev environment |

---

## 5. Feature Specifications F1–F8

### F1 — Resume Parsing & Candidate Profile

**Priority:** P0 | **Phase:** 1 — Foundation | **Dependencies:** None

#### F1.1 — Resume Upload

**Description:** Candidate uploads their base CV. System stores it in Markdown format as the canonical source for all personalisation.

**Acceptance Criteria:**
- Accepts .docx, .pdf, .md upload via dashboard
- Converts to structured Markdown on upload (preserving headings, bullets, tables)
- Computes SHA256 hash of resulting Markdown — stored as `base_cv_hash`
- Stores Markdown in Neon under `candidates.base_cv_md`
- Rejects files > 5MB with clear error message
- Displays upload confirmation with extracted section count

**Tech Stack:** FastAPI multipart upload → python-docx / pypdf for extraction → Neon storage

#### F1.2 — Resume Parsing & Structuring

**Description:** Claude parses the Markdown CV into structured JSON — extracting roles, skills, companies, technologies, and proof points for use by the scoring and personalisation agents.

**Acceptance Criteria:**
- Extracts: name, contact, summary, roles (title/company/dates/bullets), skills, patents, projects, education, certifications, awards
- Output is structured JSON stored in `candidates.parsed_profile`
- Handles non-standard CV structures gracefully — partial parse preferred over failure
- Re-parses automatically when base CV is updated (hash change detected)

**Tech Stack:** Claude Sonnet with structured XML output → JSON storage in Neon

#### F1.3 — Candidate Preferences

**Description:** Candidate configures their job search preferences — these drive the Job Hunter's query generation and the 10D Scoring Engine's weighting.

**Acceptance Criteria:**
- Target seniority levels (multi-select): CAIO / CTO / VP AI / Head of AI / Distinguished Engineer / Practice Head
- Preferred company stage (multi-select): Startup Series B–D / GCC / Indian Enterprise / Product Co / Consultancy
- Target compensation band (min/max in INR or USD)
- Geographic preference: Remote / Hybrid / Bengaluru-based / Open to relocation
- Target company list (free-text, one per line) — careers pages scanned directly
- Preferred domains (optional): BFSI / e-commerce / SaaS / Healthcare / Defence
- Stored in `candidates.preferences` as JSONB

---

### F2 — Job Discovery (Job Hunter Agent)

**Priority:** P0 | **Phase:** 2 — Core Pipeline | **Dependencies:** F1.3

#### F2.1 — Query Generation

**Description:** Agent generates optimised search queries for each job board based on candidate preferences and current market vocabulary.

**Acceptance Criteria:**
- Generates 5–8 distinct queries per run (title variants + skill combinations)
- Queries adapted per platform (LinkedIn boolean syntax vs Naukri keyword syntax)
- Includes senior AI leadership vocabulary: "Agentic AI", "LangGraph", "MCP", "Head of AI", "CAIO"
- Query log stored for debugging and tuning

#### F2.2 — Parallel Multi-Source Scraping

**Description:** Agent fans out across N job sources simultaneously, extracting structured job data from each.

**Sources:**
- LinkedIn India (job search API + page scraping)
- Naukri.com (keyword search)
- iimjobs.com (senior/leadership roles)
- Target company careers pages (Playwright navigation — from F1.3 list)
- Optional: Instahyre, Cutshort for startup roles

**Acceptance Criteria:**
- All sources scraped in parallel (fan-out via LangGraph)
- Per-job extraction: title, company, location, JD text, posted date, application URL
- Failed sources retry once with 30-second backoff; failure logged, not fatal
- Playwright used for JS-rendered careers pages
- Raw JD stored in `jobs.jd_raw` before normalisation

**Task Breakdown:**

| Task | Description |
|------|-------------|
| T2.2.1 | LinkedIn scraper module with rate limiting |
| T2.2.2 | Naukri scraper module |
| T2.2.3 | iimjobs scraper module |
| T2.2.4 | Playwright-based careers page navigator |
| T2.2.5 | Fan-out coordinator node in LangGraph |
| T2.2.6 | Per-source retry handler |
| T2.2.7 | Raw JD storage in Neon |
| T2.2.8 | Source health monitoring |
| T2.2.9 | Scraper integration tests against fixture pages |

#### F2.3 — Normalisation & Deduplication

**Description:** Normalise scraped data into a canonical schema and deduplicate against scan history.

**Acceptance Criteria:**
- URL-exact dedup: checked against `scan_history.url`
- Fuzzy dedup: normalised company + role title match (handles same job posted multiple times)
- Canonical schema: `{job_id, title, company, location, jd_text, source, posted_at, application_url}`
- Dedup log maintained — all seen URLs persisted even after processing
- New jobs inserted into `jobs` table with status `discovered`

---

### F3 — Match Analyst Agent (Legacy Scoring — superseded by F9)

**Priority:** P0 | **Phase:** 2 — Core Pipeline | **Dependencies:** F2.3, F1.2

> **Note:** F3 defined the original dual-scoring system (semantic + structured). F9 replaces the scoring framework entirely with the 10-Dimension Scoring Engine. The semantic scoring layer (F3.1) and Pinecone/embeddings stack have been dropped — F9's LLM-based structured scoring makes embedding similarity redundant. F3.2's rule-based dimension structure is retained as the conceptual baseline that F9 builds on.

#### ~~F3.1 — Semantic Scoring~~ *(Dropped)*

~~Compute cosine similarity between CV and JD embeddings using OpenAI text-embedding-3-small + Pinecone.~~ Removed — embedding similarity is a weak signal for senior leadership roles where fit is contextual, not keyword-density-based. F9's LLM-based scoring captures the same signal with higher fidelity and without additional infrastructure.

#### F3.2 — Structured Scoring

**Description:** Rule-based scoring across 5 structured dimensions (pre-F9 baseline).

**Dimensions:** Years of experience match, skill keyword overlap, title seniority match, location feasibility, company stage preference match.

**Acceptance Criteria:**
- Each dimension scored 0–1
- Weighted composite computed as `jobs.structured_score`
- Individual dimension scores stored for debugging

#### F3.3 — Composite Ranking

**Description:** Combine semantic and structured scores into a pre-F9 composite rank.

> **Superseded by F9.1** — F9 replaces this with the full 10D scoring framework and A–F grade. F3.3 is retained for rollback compatibility.

---

### F4 — Human-in-the-Loop Review Dashboard

**Priority:** P0 | **Phase:** 3 — Human Loop | **Dependencies:** F9 (for grade display), F3 (for scores)

#### F4.1 — Review Dashboard

**Description:** Next.js dashboard showing every scored job with grade, score breakdown, flags, and full report. User approves, rejects, or snoozes each job before outreach fires.

**Acceptance Criteria:**
- Job card displays: grade badge (A/B/C/D/F colour-coded), numeric score, company, title, posted date
- Top 3 strengths and top 2 risks visible as pills without expanding
- Score breakdown bar chart (10 dimensions) — expandable
- Full 6-block report viewable inline (one click, no modal)
- Filter by grade (A only / A+B / all) — persists in user preferences
- Sort by: score (default) / date posted / company name
- Three actions per job: ✅ Approve / ❌ Reject / ⏸ Snooze (7 days)
- Approved jobs move immediately to F10 Resume Builder Agent
- Rejected jobs marked — never resurface
- Snoozed jobs re-appear after 7 days

#### F4.2 — Pipeline Pause / Resume

**Description:** LangGraph checkpoint-based HITL gate — pipeline pauses after scoring, resumes only after user takes action on the review dashboard.

**Acceptance Criteria:**
- `interrupt_before` used at the HITL node in the master graph
- Pipeline state checkpointed to Neon before pause
- Resume triggered via dashboard action (approve/reject/snooze)
- Pipeline survives server restart during pause (state in Neon)
- Concurrent approvals handled without race conditions (row-level locking)

---

### F5 — LinkedIn Connector Agent

**Priority:** P1 | **Phase:** 4 — Outreach | **Dependencies:** F4 (approved jobs)

#### F5.1 — Hiring Manager Discovery

**Description:** Identify the most relevant decision-maker at the target company using Proxycurl.

**Acceptance Criteria:**
- Searches for: CAIO, CTO, VP Engineering, VP AI, Head of AI, Engineering Director at target company
- Falls back to HR/Talent Acquisition if no technical decision-maker found
- Stores: `{name, linkedin_url, title, company, seniority}` in `outreach_targets`
- Skips if company has active do-not-contact flag

#### F5.2 — Profile Enrichment

**Description:** Enrich hiring manager profile with personalisation signals.

**Acceptance Criteria:**
- Pulls via Proxycurl: recent posts (last 30 days), shared connections, current role tenure, education
- Extracts personalisation hooks: shared interest, mutual connection, recent article, company milestone
- Stored in `outreach_targets.enrichment_json`
- Graceful degradation if Proxycurl returns partial data

#### F5.3 — Connection Note Generation

**Description:** Claude generates a sub-300 character LinkedIn connection note personalised to the hiring manager's profile.

**Acceptance Criteria:**
- Under 300 characters (LinkedIn hard limit)
- Uses at least one personalisation hook from enrichment
- Mentions candidate's most relevant proof point for this archetype
- Never says "I saw your job posting" — sounds human
- User reviews and approves the note on dashboard before it sends
- A/B variant generated for user to choose from

#### F5.4 — Connection Request Sending

**Description:** Send approved connection request via Proxycurl write API.

**Acceptance Criteria:**
- Sends only after user approval on dashboard
- Rate limited: max 20 connection requests per day per account
- Tracks: sent timestamp, acceptance (polled every 24h), message reply
- Auto-pause if LinkedIn rate-limit warning received

---

### F6 — Outreach Mailer Agent

**Priority:** P1 | **Phase:** 4 — Outreach | **Dependencies:** F4 (approved jobs), F10.4 (generated PDFs)

#### F6.1 — Email Discovery

**Description:** Find a verified email address for the hiring manager using Hunter.io.

**Acceptance Criteria:**
- Hunter.io domain search + person finder
- Returns email + confidence score
- Only proceeds if confidence ≥ 70%
- Falls back to LinkedIn InMail suggestion if email not found
- Stores in `outreach_targets.email` + `email_confidence`

#### F6.2 — Email Content Generation

**Description:** Claude drafts three emails per job — Day 1 intro, Day 3 value-add, Day 7 gentle close.

**Email Specifications:**

| Email | Timing | Max Words | Tone | Attachment |
|-------|--------|-----------|------|-----------|
| Day 1 — Intro | Immediately after approval | 150 | Warm, specific | Resume PDF + Cover Letter PDF |
| Day 3 — Value-add | 3 days after Day 1 (no reply) | 100 | Insightful, low-pressure | None |
| Day 7 — Gentle close | 7 days after Day 1 (no reply) | 80 | Respectful, door-open | None |

**Acceptance Criteria:**
- Day 1: Opens with something specific about the person or company (from enrichment data)
- Day 1: Mentions 1–2 relevant qualifications naturally — conversational, not cover-letter style
- Day 3: Does NOT say "following up" or "checking in" — shares a genuinely useful insight
- Day 7: Acknowledges they're busy, low-commitment CTA, no pressure
- All emails thread under same subject line (`Re:`)
- Each email passes a "would a human send this?" Claude self-review check before storing

#### F6.3 — Email Cadence State Machine

**Description:** Celery Beat-based scheduler managing the 3-touch cadence with auto-pause on reply.

**States:** `scheduled → sent → opened → replied / bounced / cadence_complete`

**Acceptance Criteria:**
- Day 1 fires immediately after PDF generation confirmed
- Day 3 fires only if no reply detected after 72 hours
- Day 7 fires only if no reply detected after 168 hours
- Auto-pause: cadence halts immediately on reply detection (webhook + polling backup)
- Bounce handling: Day 2 and Day 3 skipped if Day 1 bounces
- Max 20 emails/day per Gmail account (safety cap)

#### F6.4 — Email Sending & Tracking

**Description:** Send via Gmail API with open/click tracking.

**Acceptance Criteria:**
- OAuth2 Gmail integration (candidate authorises their own account)
- Emails appear in candidate's Gmail Sent folder
- PDFs attached from Neon file storage (Day 1 only)
- Optional open tracking: 1×1 pixel via FastAPI redirect endpoint
- Optional click tracking: link redirect via FastAPI
- Bounce webhook receiver from Gmail API
- Dashboard: sent / opened / clicked / replied / bounced per cadence

---

### F7 — Real-Time Dashboard & Analytics

**Priority:** P1 | **Phase:** 5 — Dashboard | **Dependencies:** All previous features

#### F7.1 — Pipeline Status Dashboard

**Description:** Real-time view of active pipeline runs with phase indicators and live agent status.

**Acceptance Criteria:**
- Shows current stage per job: Discovered → Scored → Reviewed → Resume Generated → Outreach → Replied → Interview
- Live updates via Server-Sent Events (SSE) — no polling
- Per-agent status: idle / running / error / waiting
- Error cards with retry button for failed jobs
- Pipeline start/stop/pause controls

#### F7.2 — Campaign Analytics

**Description:** Metrics across the full pipeline for ongoing optimisation.

**Key Metrics:**

| Metric | Description |
|--------|-------------|
| Jobs discovered per run | Volume signal |
| A/B grade rate | Scoring calibration signal |
| Resume generation success rate | Agent reliability |
| Email open rate | Subject line quality |
| Email reply rate | Content + targeting quality |
| LinkedIn acceptance rate | Personalisation quality |
| Interview rate (A-grade jobs) | End-to-end conversion |
| Cost per application | LLM + API spend efficiency |

#### F7.3 — Pipeline History & Versioning

**Description:** Historical view of all pipeline runs with comparison across time periods.

**Acceptance Criteria:**
- Run history: start time, jobs discovered, A/B grades, resumes sent, replies
- Grade distribution chart (A/B/C/D/F) over time
- Weekly summary email (optional, configurable)
- Export to CSV

---

### F8 — Observability & Monitoring

**Priority:** P2 | **Phase:** 6 — Observability | **Dependencies:** All previous features

#### F8.0 — LangSmith Tracing (Dev/Staging)

**Description:** Enable LangGraph-native LangSmith tracing in development and staging environments from Phase 1. Provides agent run inspection, state transition visibility, and prompt replay without any code changes — activated via environment variables.

**Acceptance Criteria:**
- `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` set in dev and staging `.env`
- Every LangGraph run, node execution, HITL checkpoint, and LLM call automatically traced
- LangSmith project named `proxim-dev` — traces scoped per pipeline run via `run_id`
- Prompt replay available for debugging incorrect 10D scores or resume personalisation failures
- LangSmith disabled in production (replaced by LangDB + Grafana Tempo)

#### F8.1 — LangDB Integration

**Description:** Instrument all LLM calls with LangDB in SDK mode for production cost tracking, decision auditing, and token usage monitoring. SDK instrumentation is used — not proxy mode — to avoid adding latency to the critical scoring path.

**Acceptance Criteria:**
- LangDB SDK integrated directly into the LLM call wrapper — no proxy endpoint
- Per-call tracking: agent name, prompt tokens, completion tokens, cost (USD), latency
- Aggregate views: cost per job, cost per run, cost per feature (scoring vs resume gen vs email)
- LangDB dashboard accessible to candidate
- P99 LLM call latency unaffected by observability instrumentation (< 5ms overhead)

#### F8.2 — Distributed Tracing (Grafana Tempo)

**Description:** End-to-end tracing across all agents and API calls via Grafana Tempo as the OpenTelemetry backend. Jaeger is not used — Grafana Tempo provides equivalent tracing within the existing Grafana stack, eliminating a separate UI.

**Acceptance Criteria:**
- OpenTelemetry collector deployed — receives spans from FastAPI, LangGraph agents, Celery workers
- Spans forwarded to Grafana Tempo backend
- Full trace per job: discovery → scoring → HITL → resume gen → outreach
- Span attributes: job_id, agent_name, model, source, duration
- Traces visualised in Grafana alongside Prometheus metrics (unified observability UI)

#### F8.3 — Grafana Dashboards

**Description:** Operational dashboards for system health and pipeline performance.

**Dashboards:**

| Dashboard | Key Panels |
|-----------|-----------|
| System Health | API response times, error rates, Celery queue depth, DB connection pool |
| Pipeline Performance | Jobs/hour, scoring latency, resume gen latency, email delivery rate |
| Cost Monitoring | LLM spend per day, cost per agent, cost per feature, projected monthly spend |
| Agent Status | Per-agent uptime, success rate, average processing time |

---

## 6. Feature Addendum F9–F10

> **Context:** F9 and F10 were added following a competitive analysis of Career-Ops (37,600+ GitHub stars). The analysis identified two critical gaps in Proxim v1.0 that directly impact job-getting effectiveness. F9 upgrades the Match Analyst Agent; F10 adds the Resume Builder Agent — the single highest-leverage missing feature.

---

### F9 — 10-Dimension Scoring Engine

**Priority:** P0 | **Phase:** 2.5a–2.5c | **Dependencies:** F3 complete | **Duration:** ~7 days

#### F9.1 — Scoring Dimension Framework

**Description:** Replace F3's dual scoring with a structured 10-dimension framework producing an A–F grade tuned for senior Indian AI leadership roles.

##### Gate-Pass Dimensions (evaluated first)

If either gate-pass dimension scores < 2.5, the job is auto-graded **F** — no further processing, never shown on dashboard.

| Dimension | What It Checks |
|-----------|---------------|
| Role-Level Match | Seniority alignment: CAIO / CTO / VP AI / DE / Practice Head |
| AI/Agentic Stack Alignment | Tech overlap: LangGraph, MCP, LLM engineering, agentic frameworks |

##### Weighted Dimensions (evaluated after gate-pass)

| # | Dimension | Weight | What It Measures |
|---|-----------|--------|-----------------|
| 3 | Compensation vs Target | High | CTC range alignment with candidate's target band |
| 4 | Company Stage Fit | High | Startup / GCC / enterprise vs candidate preference |
| 5 | Interview Probability | High | Estimated callback likelihood given profile strength |
| 6 | Thought Leadership Leverage | Medium | Whether OSS, patents, publishing amplify fit |
| 7 | Geographic/Remote Flexibility | Medium | Remote/hybrid feasibility from Bengaluru |
| 8 | Growth Trajectory | Medium | Career ladder visibility toward CAIO/CTO |
| 9 | Domain Resonance | Medium | Problem space alignment with candidate interest |
| 10 | Hiring Urgency / Timeline | Low | Speed signals: posting date, urgency language |

##### Grading Scale

| Grade | Score | Meaning | Dashboard Action |
|-------|-------|---------|-----------------|
| A | 4.5–5.0 | Exceptional fit | Prioritise immediately |
| B | 4.0–4.4 | Strong fit | Apply with high confidence |
| C | 3.0–3.9 | Moderate fit | Review gaps before applying |
| D | 2.0–2.9 | Weak fit | Skip unless compensation exceptional |
| F | < 2.0 or gate-fail | Disqualified | Auto-rejected, never shown |

**Acceptance Criteria:**
- 10 dimensions scored on a 1–5 numeric scale with reasoning text per dimension
- Gate-pass logic applied before weighted average computation
- Weighted average computed across 8 non-gate dimensions
- Output: numeric score (1 decimal), letter grade (A–F), per-dimension scores, red/green flag summary
- Score + grade persisted to Neon `jobs` table (new columns: `score_10d JSONB`, `grade VARCHAR`, `report_md TEXT`)
- Claude returns structured XML output — parsed reliably without regex

#### F9.2 — Score Report Generation

**Description:** Claude generates a structured 6-block markdown report for every B+ grade job.

##### Report Structure

| Block | Content |
|-------|---------|
| A — Executive Summary | One-paragraph verdict: grade, key strengths, primary risk |
| B — CV Match | Table mapping each JD requirement to candidate proof points with strength rating |
| C — Gaps & Mitigation | Identified gaps, severity (Critical/Minor), mitigation plan |
| D — Level & Positioning | Detected seniority, recommended archetype, positioning notes |
| E — Compensation Analysis | JD range vs target, market context, negotiability signal |
| F — Interview Probability | Estimated callback %, key differentiators, likely interview topics |

**Acceptance Criteria:**
- All 6 blocks generated for every B+ job
- F-grade jobs generate Block A only (fast rejection)
- Report is human-readable without opening the original JD
- CV Match table references actual candidate proof points — no hallucination
- Full report generated in < 45 seconds per job

#### F9.3 — HITL Dashboard Score Display

**Description:** Update F4.1 dashboard to surface 10D scores and reports inline.

**Dashboard Changes:**
- Grade badge (A/B/C/D/F colour-coded) visible on job card without interaction
- Numeric score displayed next to grade
- Top 3 strengths + top 2 risks as pills — visible without expanding
- Score breakdown: expandable bar chart (10 dimensions)
- Full 6-block report: inline markdown render, one click, no modal
- Filter by grade (A only / A+B / all) — persists across sessions
- Sort by score (default), date posted, or company

**Acceptance Criteria:**
- Grade badge renders in < 200ms (data pre-loaded with job list)
- Full report viewable within 1 click
- Grade filter persists in `user_preferences` table
- F-grade jobs never appear on dashboard

---

### F10 — Resume Builder Agent

**Priority:** P0 | **Phase:** 2.5d–2.5i | **Dependencies:** F9 complete | **Duration:** ~13 days

#### F10.1 — Candidate Archetype System

**Description:** Define 5 archetypes for senior Indian AI leadership roles. Agent detects which archetype a JD is targeting and frames the entire resume accordingly.

##### Archetype Definitions

| Archetype | Target Roles | Lead Proof Points |
|-----------|-------------|------------------|
| Enterprise CAIO | CAIO, Head of AI at Tata/Jio/Mahindra/HDFC/Axis | Dell.com chatbot, 9+ patents, AI maturity framework, US/EMEA/APAC exposure |
| Startup CTO/VP | CTO, VP Eng at Series B–D AI-first startups | API2MCP OSS, startup CTO advisory, LangGraph/MCP production systems |
| Agentic Systems Architect | Principal AI Architect, DE at Freshworks/Razorpay/PhonePe | API2MCP architecture, STRIDE for agents, LangGraph patterns, chaos engineering |
| GCC AI Practice Head | Head of AI, Sr. Director at Walmart/JPMC/Goldman/Target India | $2B platform, global stakeholder management, IP creation pipeline |
| AI Thought Leader | Partner/Principal at Fractal/Tiger Analytics/Mu Sigma/TCS AI | Medium publishing (weekly), ADLC framework, STRIDE-for-agents, enterprise maturity |

**Detection Logic:** Claude analyses the JD and returns a primary archetype + confidence score (0–1). Confidence < 0.6 → defaults to Agentic Systems Architect (broadest fit). Confidence score stored with job record and surfaced in Report Block D.

**Acceptance Criteria:**
- Archetype detected correctly for ≥ 85% of test JDs (validated against 20-JD labelled set)
- Confidence score stored in `jobs.archetype_confidence`
- Fallback to Agentic Systems Architect when confidence < 0.6

#### F10.2 — JD Keyword Extraction & Injection

**Description:** Extract 15–20 high-signal keywords from the JD and inject them into resume sections naturally — ensuring ATS parsers score the resume highly.

**Extraction Rules:**
- Extract: technical terms, role-specific verbs (architect, lead, govern, deploy), domain nouns (agentic AI, MCP, LLM, RAG)
- Exclude: generic adjectives (strong, excellent), internal company jargon, unexpanded acronyms
- Prioritise: terms in first 200 words, terms appearing 2+ times, terms in "Required" over "Nice to have"

**Injection Points:**

| Location | Injection Rule |
|----------|---------------|
| Resume summary | 2–3 keywords woven naturally into 3-sentence summary |
| First bullet of each relevant role | 1 keyword per bullet lead — no stuffing |
| Skills section | All extracted keywords listed, grouped by category |
| Cover letter opening paragraph | Top 3 keywords appear in first paragraph |

**Acceptance Criteria:**
- 15–20 keywords extracted per JD — validated as JSON array before injection
- No keyword appears more than 3 times across the entire resume
- Keyword injection does not alter factual content — only reformulates existing proof points
- All injected text passes a Claude coherence self-review before finalisation

#### F10.3 — Resume Content Personalisation

**Description:** Reorder and reframe resume content per offer. Proof points are fixed and factual; ordering, emphasis, and framing change per archetype and JD.

**Personalisation Rules:**

| Element | Personalisation Logic |
|---------|----------------------|
| Summary | 3 sentences, archetype-matched, keyword-injected. Leading proof point varies by archetype. |
| Dell sub-section order | Agentic AI & Intelligent Systems always first. Sub-section order fixed; bullet order within sections reordered by JD relevance. |
| Project selection | Always include Dell.com chatbot. Include API2MCP for all except Enterprise CAIO. Include Medium publishing for AI Thought Leader + GCC Practice Head. |
| Skills ordering | Skills most relevant to JD float to top of each skill group |
| Patent highlight | For GCC + Enterprise CAIO archetypes, surface Patent 12436830 (message loss detection, Oct 2025) in Career Highlights |

**What Never Changes (factual integrity guarantee):**
- Job titles, company names, and dates — always exact
- Quantified outcomes ($2B platform, 25–30% revenue, sub-2-second) — never inflated
- Patent numbers and grant dates — always exact
- Education and certifications — unchanged

**Acceptance Criteria:**
- Personalised resume passes factual accuracy check — no fabricated proof points
- Archetype-specific summary is distinct across all 5 archetypes for the same base CV
- Bullet reordering is semantically correct — most relevant bullets lead within each sub-section

#### F10.4 — PDF Generation

**Description:** Render personalised resume and cover letter to ATS-safe PDF via Puppeteer.

**Technical Specification:**

| Parameter | Value |
|-----------|-------|
| Renderer | Puppeteer (headless Chrome) |
| Template engine | Jinja2 HTML → PDF |
| Font | Aptos (self-hosted WOFF2) |
| Layout | Single column, no tables for layout, ATS-safe |
| Page format | A4 (India/Europe) / US Letter (auto-detected by company HQ country) |
| Output naming | `{company}_{role}_{date}_cv.pdf` and `{company}_{role}_{date}_cl.pdf` |
| Storage | `resume_versions` table in Neon + local `/outputs/{job_id}/` directory |
| File size target | < 500KB per document |
| Generation time target | < 30 seconds per document pair |

**Cover Letter Structure (always 1 page):**
- Para 1: Who you are + most relevant proof point for this archetype (auto-populated from F10.1)
- Para 2: Builder depth + executive breadth + 2 quantified outcomes (selected by JD relevance)
- Para 3: Why this company — personalised from F10.5 deep research; JD-derived fallback if research fails

**Acceptance Criteria:**
- PDF renders correctly in Adobe Acrobat, Chrome, macOS Preview
- ATS parse test: Jobscan and Resume Worded both extract all sections correctly
- Resume: 2–3 pages enforced by template
- Cover letter: exactly 1 page enforced by template

#### F10.5 — Deep Company Research Integration

**Description:** Before generating the cover letter's "Why this company" paragraph, run a targeted research pass for specific, genuine company signals.

**Research Targets:**
- Recent AI initiatives (last 90 days): product launches, AI strategy announcements, engineering blog posts
- Leadership signals: CAIO/CTO statements on AI direction, hiring patterns
- Tech stack signals: engineering blog, GitHub org, JD tech mentions
- India office context (GCC applications): office size, charter, recent expansion signals

**Research Tools:** Exa AI semantic search (already in Proxim stack) + Proxycurl company page (already integrated)

**Acceptance Criteria:**
- Research completes in < 60 seconds per company
- At least 1 specific, verifiable company detail surfaced per cover letter
- Fallback to JD-derived reasoning if research fails (never blank)
- Research output stored with job record — not re-run if cover letter regenerated for same company

#### F10.6 — Resume Version Management

**Description:** Track all generated resume and cover letter versions per job, per archetype, with stale detection when base CV changes.

**Database Schema:**

```sql
CREATE TABLE resume_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                UUID REFERENCES jobs(id) NOT NULL,
  archetype             VARCHAR(50) NOT NULL,
  keywords              JSONB,
  score_at_generation   FLOAT,
  resume_pdf_path       TEXT,
  cover_letter_pdf_path TEXT,
  base_cv_hash          VARCHAR(64),   -- SHA256 of base CV at generation time
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  is_submitted          BOOLEAN DEFAULT false
);
```

**Acceptance Criteria:**
- Every generated PDF is version-tracked — no overwriting
- If base CV changes (SHA256 hash differs), dashboard flags jobs with stale resumes
- User can trigger regeneration from dashboard without re-scoring
- Submitted resumes are locked — cannot be overwritten, only a new version created

---

### F9–F10 Implementation Plan

#### Phase 2.5 — Sequencing

| Sub-phase | Feature | Duration | Dependency |
|-----------|---------|----------|-----------|
| 2.5a | F9.1 — Scoring Dimension Framework | 3 days | F3 complete |
| 2.5b | F9.2 — Score Report Generation | 2 days | F9.1 |
| 2.5c | F9.3 — HITL Dashboard Score Display | 2 days | F9.1, F9.2, F4 |
| 2.5d | F10.1 — Archetype System | 2 days | F9 complete |
| 2.5e | F10.2 — Keyword Extraction & Injection | 2 days | F10.1 |
| 2.5f | F10.3 — Resume Content Personalisation | 3 days | F10.1, F10.2 |
| 2.5g | F10.4 — PDF Generation | 3 days | F10.3 |
| 2.5h | F10.5 — Deep Company Research | 2 days | F10.4 |
| 2.5i | F10.6 — Version Management | 1 day | F10.4 |

**Total Phase 2.5 duration:** 20 working days (4 weeks)
**Can be parallelised:** F9 track and F10.1–F10.2 can run simultaneously after F3 is stable.

#### F9–F10 Success Metrics

| Metric | MVP Target | 6-Month Target |
|--------|-----------|---------------|
| 10D scoring accuracy (human agreement) | ≥ 80% | ≥ 90% |
| Resume ATS parse accuracy (Jobscan) | ≥ 85% | ≥ 95% |
| Archetype detection accuracy | ≥ 85% | ≥ 92% |
| HITL decision time (approve/reject) | < 60 seconds/job | < 30 seconds/job |
| PDF generation time | < 60 seconds/pair | < 30 seconds/pair |
| Interview callback rate (A-grade jobs) | ≥ 20% | ≥ 35% |

---

## 7. Architecture Decision Records

### ADR-001: LangGraph Over Custom Orchestration

**Decision:** Use LangGraph for multi-agent orchestration rather than building a custom state machine.

**Rationale:** LangGraph provides built-in checkpointing (crash recovery), `interrupt_before` for HITL gates, sub-graph composition for hierarchical agents, and streaming for real-time dashboard updates. Building equivalent infrastructure from scratch would take 4–6 weeks and introduce significant maintenance burden.

**Consequence:** LangGraph version pinned to **0.2.x** — the API, checkpointer interface, and `interrupt_before` syntax differ significantly from 0.1.x; version upgrades require explicit migration testing of checkpoint schema. Each pipeline run is assigned a unique `thread_id` (UUID generated at run start, stored in Neon `pipeline_runs` table) — this enables concurrent runs per candidate and crash-safe resume from any checkpoint. Checkpointer schema migrations handled via Alembic alongside the main Neon schema.

---

### ADR-002: Neon PostgreSQL Over Redis for Primary State

**Decision:** Use Neon (serverless PostgreSQL) as primary state store rather than Redis.

**Rationale:** Job records, resume versions, cadence state, and user preferences are relational by nature. Neon's serverless model eliminates infrastructure management. LangGraph's PostgreSQL checkpointer integrates natively. Redis is retained for Celery task queue only.

**Consequence:** All LangGraph checkpoint state is in Neon. Schema migrations require Alembic. Connection pooling via PgBouncer for high-concurrency scenarios.

---

### ADR-003: LiteLLM for Provider-Configurable LLM Access

**Decision:** All LLM calls are routed through LiteLLM. Default provider is `claude-sonnet-4-6` (Anthropic). Provider is swappable per deployment via `LLM_PROVIDER` environment variable — supported values: `anthropic`, `gemini`, `openai`. One provider is active at a time across all agents.

**Rationale:** Locking to a single SDK creates vendor dependency and makes cost/quality benchmarking across providers expensive to set up. LiteLLM provides a unified interface (OpenAI-compatible) so agents are written once and the provider is a config concern. Claude Sonnet remains the default and production-validated choice.

**Consequence:** Model version pinned per provider in `.env` — not auto-updated. Prompt caching is applied conditionally: enabled only when `LLM_PROVIDER=anthropic`, skipped silently for other providers. Structured output uses `response_format` JSON schema (see ADR-F9-01) — supported natively by Anthropic, OpenAI, and Gemini via LiteLLM.

---

### ADR-F9-01: Structured JSON Output via response_format for 10D Scoring

**Decision:** All structured LLM outputs (10D scores, report blocks, archetype detection) use LiteLLM's `response_format` parameter with a JSON schema, not free-text XML or markdown.

**Rationale:** `response_format` with JSON schema is supported natively by Anthropic, OpenAI, and Gemini — making it provider-agnostic. XML was previously chosen for parseability, but JSON schema enforced via `response_format` is equally reliable and removes the need for a custom XML parser. This aligns with the LiteLLM multi-provider architecture introduced in ADR-003.

**Consequence:** Parsing layer uses Python's `json.loads()` — no ElementTree required. Pydantic models define the JSON schema for each output type and serve as the single source of truth for validation. Self-repair loop retries with clarification if the response fails Pydantic validation.

---

### ADR-F9-02: Gate-Pass Logic Applied Before Weighted Average

**Decision:** Gate-pass dimensions are evaluated before the weighted average — not included in the average.

**Rationale:** Including gate-pass dimensions in the average dilutes their disqualifying effect. A role that fails Role-Level Match should be F regardless of a 5.0 on Compensation.

**Consequence:** Gate-pass dimension scores are stored but do not contribute to the numeric score displayed on the dashboard.

---

### ADR-F10-01: Puppeteer Over WeasyPrint for PDF Generation

**Decision:** Puppeteer (headless Chrome) for HTML→PDF rather than WeasyPrint (Python).

**Rationale:** Puppeteer produces pixel-accurate rendering matching the browser preview. WeasyPrint has known issues with CSS Grid and modern typography. Career-Ops (37K+ stars, production-proven) uses Puppeteer for this exact use case.

**Consequence:** Node.js required in the backend environment (already present as dev dependency). Puppeteer adds ~170MB to the container image.

---

### ADR-008: Self-Hosted LangGraph Over LangGraph Platform

**Decision:** Self-host LangGraph via Docker Compose rather than using LangGraph Platform (managed cloud).

**Rationale:** LangGraph Platform handles checkpointing, HITL interrupts, and agent deployment as a managed service, but introduces vendor lock-in and routes all pipeline state through Langchain's cloud infrastructure. Proxim processes sensitive candidate data (CV, compensation targets, outreach content) — keeping state in a self-controlled Neon instance is preferable for data residency. Docker Compose deployment also eliminates recurring Platform hosting costs during the build phase.

**Consequence:** Infrastructure management responsibility remains with the team. LangGraph Platform remains an option for post-MVP scale if self-hosted maintenance becomes a burden — migration cost is low since the graph definition and checkpointer interface are compatible.

---

### ADR-F10-02: Base CV Stored as Markdown

**Decision:** Canonical base CV stored as structured Markdown in Neon, not PDF or DOCX.

**Rationale:** Markdown is LLM-native — Claude reads, parses, and reorders sections without extraction overhead. PDF parsing introduces errors. DOCX requires python-docx. Markdown is version-controllable with meaningful diffs.

**Consequence:** Candidate must maintain a Markdown version of their CV. SHA256 hash of this file used for stale resume detection in F10.6. Initial upload auto-converts from DOCX/PDF.

---

## 8. Implementation Phases

### Complete Phase Plan

| Phase | Sub-phases | Duration | Deliverable |
|-------|-----------|----------|-------------|
| Phase 1: Foundation | F1.1, F1.2, F1.3 | 2 weeks | Resume parsing, database, infra setup |
| Phase 2: Core Pipeline | F2.1, F2.2, F2.3, F3.1, F3.2, F3.3 | 3 weeks | Job hunting swarm + match analyst |
| Phase 2.5: Scoring & Resume | F9.1–F9.3, F10.1–F10.6 | 4 weeks | 10D scoring + resume builder agent |
| Phase 3: Human Loop | F4.1, F4.2 | 2 weeks | HITL review dashboard |
| Phase 4: Outreach | F5.1–F5.4, F6.1–F6.4 | 3 weeks | LinkedIn + email outreach |
| Phase 5: Dashboard | F7.1, F7.2, F7.3 | 2 weeks | Analytics + real-time pipeline view |
| Phase 6: Observability | F8.1, F8.2, F8.3 | 1 week | LangDB + tracing + dashboards |

**Total MVP (Phases 1–3 including 2.5):** ~11 weeks
**Total Complete:** ~17 weeks

### Phase Dependencies

```
Phase 1 (Foundation)
    │
    ▼
Phase 2 (Core Pipeline)
    │
    ▼
Phase 2.5 (10D Scoring + Resume Builder)  ← NEW
    │
    ▼
Phase 3 (Human Loop / HITL Dashboard)
    │
    ▼
Phase 4 (Outreach) ─────────────────────────────┐
    │                                            │
    ▼                                            ▼
Phase 5 (Dashboard)               Phase 6 (Observability)
```

---

## 9. Success Metrics

### Pipeline Metrics

| Metric | MVP Target | 6-Month Target |
|--------|-----------|---------------|
| Jobs matched per run (A+B grade) | ≥ 15 quality matches | ≥ 25 |
| Scoring accuracy (human agreement on grade) | ≥ 80% | ≥ 90% |
| Resume ATS parse accuracy (Jobscan) | ≥ 85% | ≥ 95% |
| Email response rate | ≥ 8% | ≥ 15% |
| LinkedIn acceptance rate | ≥ 25% | ≥ 35% |
| Interview rate from A-grade applications | ≥ 20% | ≥ 35% |
| Pipeline completion rate | ≥ 90% | ≥ 98% |
| Time from discovery to application sent | < 2 hours | < 1 hour |

### System Metrics

| Metric | Target |
|--------|--------|
| HITL decision time | < 60 seconds/job |
| 10D scoring latency | < 45 seconds/job |
| PDF generation time | < 60 seconds/pair |
| Pipeline uptime | ≥ 99.5% |
| Cost per application | < $0.50 (LLM + API spend) |

---

## 10. MVP Scope

### In MVP (Phases 1–3 + 2.5)

| Feature | Status |
|---------|--------|
| Resume upload and parsing (F1) | ✅ MVP |
| Job hunting across 3+ sources (F2) | ✅ MVP |
| 10D scoring and A–F grading (F9) | ✅ MVP |
| 6-block score report generation (F9.2) | ✅ MVP |
| HITL review dashboard with grades (F4 + F9.3) | ✅ MVP |
| Resume Builder Agent — archetype detection (F10.1) | ✅ MVP |
| Resume Builder Agent — keyword injection (F10.2) | ✅ MVP |
| Resume Builder Agent — personalisation (F10.3) | ✅ MVP |
| Resume Builder Agent — PDF generation (F10.4) | ✅ MVP |
| Resume version management (F10.6) | ✅ MVP |

### Post-MVP (Phases 4–6)

| Feature | Status |
|---------|--------|
| Deep company research for cover letter (F10.5) | ⏳ Post-MVP |
| LinkedIn connection outreach (F5) | ⏳ Post-MVP |
| Email campaign automation (F6) | ⏳ Post-MVP |
| Full analytics dashboard (F7.2, F7.3) | ⏳ Post-MVP |
| LangDB + Jaeger + Grafana observability (F8) | ⏳ Post-MVP |

---

## Appendix: Feature Index

| Feature ID | Name | Phase | Priority |
|------------|------|-------|----------|
| F1.1 | Resume Upload | 1 | P0 |
| F1.2 | Resume Parsing & Structuring | 1 | P0 |
| F1.3 | Candidate Preferences | 1 | P0 |
| F2.1 | Query Generation | 2 | P0 |
| F2.2 | Parallel Multi-Source Scraping | 2 | P0 |
| F2.3 | Normalisation & Deduplication | 2 | P0 |
| F3.1 | Semantic Scoring | 2 | P0 |
| F3.2 | Structured Scoring | 2 | P0 |
| F3.3 | Composite Ranking | 2 | P0 |
| F4.1 | Review Dashboard | 3 | P0 |
| F4.2 | Pipeline Pause / Resume | 3 | P0 |
| F5.1 | Hiring Manager Discovery | 4 | P1 |
| F5.2 | Profile Enrichment | 4 | P1 |
| F5.3 | Connection Note Generation | 4 | P1 |
| F5.4 | Connection Request Sending | 4 | P1 |
| F6.1 | Email Discovery | 4 | P1 |
| F6.2 | Email Content Generation | 4 | P1 |
| F6.3 | Email Cadence State Machine | 4 | P1 |
| F6.4 | Email Sending & Tracking | 4 | P1 |
| F7.1 | Pipeline Status Dashboard | 5 | P1 |
| F7.2 | Campaign Analytics | 5 | P1 |
| F7.3 | Pipeline History & Versioning | 5 | P1 |
| F8.1 | LangDB Integration | 6 | P2 |
| F8.2 | Distributed Tracing (Grafana Tempo) | 6 | P2 |
| F8.3 | Grafana Dashboards | 6 | P2 |
| F9.1 | 10D Scoring Dimension Framework | 2.5a | P0 |
| F9.2 | Score Report Generation | 2.5b | P0 |
| F9.3 | HITL Dashboard Score Display | 2.5c | P0 |
| F10.1 | Candidate Archetype System | 2.5d | P0 |
| F10.2 | JD Keyword Extraction & Injection | 2.5e | P0 |
| F10.3 | Resume Content Personalisation | 2.5f | P0 |
| F10.4 | PDF Generation | 2.5g | P0 |
| F10.5 | Deep Company Research Integration | 2.5h | P1 |
| F10.6 | Resume Version Management | 2.5i | P0 |

---

*Proxim Extended PRD v2.0*
*Features F1.1–F10.6 · 34 feature specifications · 7 ADRs*
*Author: Manav Ghosh · April 2026*
*Inspired by Career-Ops competitive analysis (37,600+ GitHub stars)*
