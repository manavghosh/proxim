# Proxim — User Journey

> **Core philosophy:** Proxim automates analysis, you own every decision.
> Nothing external fires without your explicit approval.

---

## Overview

| Step | Who Does It | Time Required | Frequency |
|------|-------------|---------------|-----------|
| 1. Set up your profile | You | ~30 minutes | Once only |
| 2. Discover jobs | Proxim | ~10 minutes | Daily / on demand |
| 3. Score & grade every job | Proxim | ~45 sec/job | Automatic |
| 4. Review & approve | You | <60 sec/job | Daily |
| 5. Generate personalised resume & cover letter | Proxim | ~60 sec/job | Automatic |
| 6. Outreach fires | Proxim + You | Async | Per approval |
| 7. Track, iterate & land interviews | You + Proxim | Weekly review | Ongoing |

---

## Step 1 — Set Up Your Profile

**When:** Once only, before first run
**Time:** ~30 minutes
**Who:** You

This is the foundation every agent uses to make decisions on your behalf. Get this right and you rarely need to touch it again.

### What you configure

**Base CV (Markdown)**
Upload your CV in Markdown format. This becomes the single source of truth for the Resume Builder Agent. Every personalised resume is generated from this file — SHA256 hash-tracked so the system alerts you if it goes stale after a new project ships.

**Target role preferences**
- Seniority level: CAIO / CTO / VP AI / Head of AI / Distinguished Engineer / AI Practice Head
- Preferred company stage: Startup (Series B–D) / GCC / Indian enterprise / Product co / Consultancy
- Target compensation band (INR or USD)
- Geographic preference: remote / hybrid / Bengaluru-based / open to relocation

**Candidate archetypes (define your 5)**
The Resume Builder Agent uses these to frame every resume it generates. Each archetype points to different proof points from your CV.

| Archetype | Target Roles | Leads With |
|-----------|-------------|------------|
| Enterprise CAIO | CAIO, Head of AI at Tata/Jio/Mahindra/HDFC | Dell chatbot, patents, AI maturity framework |
| Startup CTO/VP | CTO, VP Eng at Series B–D AI startups | API2MCP OSS, startup CTO advisory, LangGraph |
| Agentic Systems Architect | Principal AI Architect, DE at Freshworks/Razorpay | API2MCP architecture, STRIDE, chaos engineering |
| GCC AI Practice Head | Head of AI at Walmart/JPMC/Goldman/Target India | $2B platform, global stakeholder management, IP |
| AI Thought Leader | Partner/Principal at Fractal/Tiger Analytics/TCS AI | Medium publishing, ADLC framework, STRIDE-for-agents |

**Target company list**
Add companies whose careers pages get scanned directly — many senior AI roles at GCCs and funded startups never appear on aggregators. Examples: JPMC India, Walmart Global Tech, Goldman Sachs Bangalore, Freshworks, Razorpay, PhonePe, Tata Digital, Jio Platforms.

**API connections**
- Gmail account (for outreach cadence)
- Hunter.io API key (email discovery)
- Proxycurl API key (LinkedIn enrichment)
- Exa AI key (company research)

---

## Step 2 — Discover Jobs

**When:** Daily or on demand
**Time:** ~10 minutes to run
**Who:** Proxim (fully automated)

The Job Hunter Agent scans multiple sources simultaneously. You never see a raw pile of listings — only what passes through scoring.

### What the agent does

1. **Scrapes aggregators:** LinkedIn India, Naukri, iimjobs.com — filtered to senior AI leadership roles by title and seniority signals
2. **Navigates company careers pages directly:** Your target company list gets visited every run — the agent reads the careers page, extracts active listings, and pulls the full JD text
3. **Deduplicates everything:** URL-match plus normalised company+role match against the scan history file — zero re-processing of already-seen listings
4. **Queues for scoring:** Every new, unseen listing goes into the 10D scoring pipeline

### Typical volume

- 50–120 new listings discovered per daily run in the Indian AI leadership market
- After dedup and gate-pass filtering: ~15–25 reach the HITL dashboard per run
- After your A/B grade filter: ~5–8 jobs per day require your attention

---

## Step 3 — Score & Grade Every Job

**When:** Immediately after discovery
**Time:** ~45 seconds per job
**Who:** Proxim (fully automated)

The 10-Dimension Scoring Engine evaluates every discovered job against your profile. Most get filtered before you ever see them.

### Gate-pass check (runs first)

Two dimensions are evaluated before anything else. If either fails, the job is auto-graded **F** and processing stops — no report generated, never shown to you.

| Gate Dimension | What It Checks | Threshold |
|---------------|---------------|-----------|
| Role-Level Match | Does the seniority match CAIO/CTO/VP AI/DE/Practice Head? | Score ≥ 2.5 |
| AI/Agentic Stack Alignment | Does the JD require LangGraph, MCP, LLM engineering, or agentic frameworks? | Score ≥ 2.5 |

### 10-Dimension scoring framework

| # | Dimension | Weight | What It Measures |
|---|-----------|--------|-----------------|
| 1 | Role-Level Match | Gate-pass | Seniority alignment |
| 2 | AI/Agentic Stack Alignment | Gate-pass | Tech stack overlap |
| 3 | Compensation vs Target | High | CTC range vs your target band |
| 4 | Company Stage Fit | High | Startup/GCC/enterprise vs your preference |
| 5 | Interview Probability | High | Estimated callback likelihood |
| 6 | Thought Leadership Leverage | Medium | Whether OSS, patents, publishing amplify fit |
| 7 | Geographic/Remote Flexibility | Medium | Remote/hybrid feasibility from Bengaluru |
| 8 | Growth Trajectory | Medium | Career ladder visibility toward CAIO/CTO |
| 9 | Domain Resonance | Medium | Problem space alignment with your interests |
| 10 | Hiring Urgency / Timeline | Low | Speed signals: posting date, urgency language |

### Grading scale

| Grade | Score | Meaning | Action |
|-------|-------|---------|--------|
| A | 4.5–5.0 | Exceptional fit | Prioritise immediately |
| B | 4.0–4.4 | Strong fit | Apply with confidence |
| C | 3.0–3.9 | Moderate fit | Review gaps before applying |
| D | 2.0–2.9 | Weak fit | Skip unless compensation is exceptional |
| F | < 2.0 or gate-fail | Disqualified | Auto-rejected, never shown |

### 6-Block score report (generated for B+ grades)

Every B-grade or above job gets a full Claude-generated report covering:

- **Block A — Executive Summary:** One-paragraph verdict with grade, key strengths, and primary risk
- **Block B — CV Match:** Table mapping each JD requirement to your proof points with strength rating (Strong / Moderate / Gap)
- **Block C — Gaps & Mitigation:** Identified gaps, severity (Critical / Minor), and honest mitigation plan
- **Block D — Level & Positioning Strategy:** Detected seniority, recommended archetype, honest positioning notes
- **Block E — Compensation Analysis:** JD range vs your target, market context, negotiability signal
- **Block F — Interview Probability:** Estimated callback %, key differentiators to lead with, likely interview topics

> **Based on Career-Ops real data:** ~74% of listings score below C and are filtered before reaching you. Proxim evaluates the volume so you don't have to.

---

## Step 4 — Review & Approve

**When:** Daily, after scoring completes
**Time:** <60 seconds per job
**Who:** You

This is the only mandatory human touchpoint in the discovery-to-application pipeline. The dashboard shows you everything you need to make a fast, confident decision.

### What you see on each job card

- **Grade badge** (A/B/C/D/F with colour coding) and numeric score — visible without any interaction
- **Top 3 strengths** and **top 2 risks** as pills — visible without expanding
- **Score breakdown** — expandable bar chart showing all 10 dimension scores
- **Full 6-block report** — inline, one click, no modal

### Your three decisions

| Decision | What Happens Next |
|----------|------------------|
| ✅ **Approve** | Job moves immediately to Resume Builder Agent |
| ❌ **Reject** | Job marked, never resurfaces |
| ⏸ **Snooze** | Job held for 7 days, then re-surfaced (use when timing is wrong but the role is interesting) |

### Dashboard controls

- **Filter by grade:** Show A only / A+B / all — persists across sessions
- **Sort:** By score (default) / by date posted / by company
- **Target:** < 60 seconds per approval decision — the report has everything you need

> ⚠️ **Design principle:** Proxim automates analysis, you own every decision. Nothing external — no email, no LinkedIn request, no application form — fires without your explicit approval on this screen.

---

## Step 5 — Generate Personalised Resume & Cover Letter

**When:** Immediately after your approval
**Time:** ~60 seconds per document pair
**Who:** Proxim (fully automated)

For every job you approve, the Resume Builder Agent generates a tailored PDF pair. Same proof points as your base CV — completely different framing, keyword injection, and bullet ordering.

### What the agent does

**1. Detect archetype**
Claude analyses the JD and returns a primary archetype + confidence score (0–1). If confidence < 0.6, defaults to Agentic Systems Architect as the broadest fit.

**2. Extract JD keywords**
15–20 high-signal keywords extracted: technical terms, role-specific verbs, domain nouns. Keywords in the first 200 words of JD and those appearing 2+ times are prioritised.

**3. Personalise resume content**
- Summary rewritten (3 sentences, archetype-matched, keyword-injected)
- Bullets reordered by relevance to this JD — most relevant experience leads
- Skills section reordered — most relevant skills float to top
- Project selection adapted by archetype (API2MCP leads for Startup CTO; patents lead for Enterprise CAIO)

**4. Run deep company research** *(Post-MVP — F10.5)*
Exa AI searches for: recent AI initiatives, leadership statements on AI direction, engineering blog posts, India office context (for GCCs). Populates the "Why this company" paragraph in the cover letter. At MVP, this paragraph falls back to JD-derived reasoning if research is not yet active.

**5. Render PDF**
Puppeteer (headless Chrome) renders HTML template to PDF. ATS-safe single column, Aptos font, matching your CV visual style. Two PDFs output per job: `{company}_{role}_{date}_cv.pdf` and `{company}_{role}_{date}_cl.pdf`.

**6. Version tracking**
Every generated PDF is version-tracked. If your base CV changes (SHA256 hash differs), the dashboard flags jobs with stale resumes so you can regenerate without re-scoring.

### What never changes

No matter how the resume is personalised, these are always factual and unchanged:
- Job titles, company names, and dates
- Quantified outcomes ($2B platform, 25–30% revenue, sub-2-second load times)
- Patent numbers and grant dates
- Education and certifications

---

## Step 6 — Outreach Fires

**When:** After resume generation completes
**Time:** Async, runs in background
**Who:** Proxim (with your go-ahead on connection notes)

Two parallel outreach tracks activate. Both are rate-limited and designed to feel personal, not automated.

### Track A — LinkedIn Connector

1. Proxycurl finds the hiring manager or most relevant decision-maker at the company
2. Profile enriched for personalisation signals: recent posts, mutual connections, role history
3. Claude generates a sub-300 character connection note tailored to their profile
4. **You review the connection note before it sends** — one-click approve in the dashboard
5. Rate-limited to LinkedIn's guidelines — no spam patterns

### Track B — Email Cadence

Uses Hunter.io for verified email discovery, Gmail API for sending, open/click tracking throughout.

| Touch | Timing | Content |
|-------|--------|---------|
| Day 1 | Immediately after approval | Intro email — personalised resume + cover letter attached, 3–4 sentence hook |
| Day 3 | 3 days after Day 1 (if no reply) | Value-add follow-up — relevant insight, article, or shared context. Not a chase. |
| Day 7 | 7 days after Day 1 (if no reply) | Gentle close — brief, respectful, leaves the door open |

**Auto-pause on reply:** The moment a reply is detected, the remaining cadence steps are cancelled automatically. You never send a follow-up to someone who has already responded.

---

## Step 7 — Track, Iterate & Land Interviews

**When:** Ongoing, weekly review
**Time:** 15–20 minutes per week
**Who:** You + Proxim

The pipeline doesn't end at outreach. This step is where compounding happens — the system gets smarter each week, and so do you.

### Pipeline stages

```
Discovered → Scored → Approved → Resume Sent → Replied → Interview Booked → Offer
```

Each job card moves through these stages. You can manually advance stages (e.g. mark "Interview Booked" when a call is confirmed) and add notes per company.

### Observability dashboard

LangDB tracks every LLM call. Grafana Tempo + Grafana handle distributed tracing. Your weekly summary shows:

| Metric | What It Tells You |
|--------|------------------|
| Jobs discovered | Is scan coverage wide enough? |
| A/B grades found | Is your 10D calibration too strict or too loose? |
| Resumes sent | Conversion from approval to application |
| Reply rate | Are the personalised resumes landing? |
| Interview rate | Are you applying to the right archetype of roles? |
| Cost per application | LLM + API spend per submitted application |

### Iteration signals

**If a C-grade job gets an interview reply:**
Review its score report to understand why. Use as feedback to tune dimension weights — your profile may be stronger for that company stage than the scoring assumed.

**If A-grade jobs get no replies:**
Check the email open rates. If opens are low, the subject line is the problem. If opens are high but no replies, the resume or cover letter needs tuning.

**If your base CV changes:**
Upload the new Markdown version. The system hashes it and flags all open applications with stale resumes — regenerate with one click, no re-scoring needed.

**When you receive an offer:**
Mark the job as closed. Proxim automatically pauses all remaining outreach for that company. Wind down the other active pipelines manually or set a pause on new approvals.

---

## End-to-End Timeline

From a new job posting going live to a personalised application in the hiring manager's inbox:

```
Job posted
    ↓ (minutes)
Discovered by Job Hunter Agent
    ↓ (~45 seconds)
10D scored and graded
    ↓ (next morning)
You review and approve on dashboard (<60 seconds)
    ↓ (~60 seconds)
Resume + cover letter generated and version-tracked
    ↓ (within the hour)
LinkedIn connection note sent (after your review)
Email Day 1 fires with tailored documents attached
    ↓ (Day 3, if no reply)
Value-add follow-up sent automatically
    ↓ (Day 7, if no reply)
Gentle close sent automatically
    ↓
Reply / Interview booked / Pipeline closed
```

**Total elapsed time from posting to application: under 2 hours**
**Your active time required: under 60 seconds**

---

## Key Design Principles

1. **AI analyses, you decide.** The 10D engine filters 74% of listings before they reach you. You decide on the remaining 26%. Nothing external fires without your approval.

2. **Personalisation at scale.** Every application arrives with a resume tailored to that specific JD — archetype-matched, keyword-injected, relevance-ordered. Not a generic PDF.

3. **Consistent follow-through.** The 3-touch email cadence runs automatically. You never lose an opportunity because life got busy between Day 1 and Day 7.

4. **Speed advantage.** Senior AI roles at funded Indian startups can fill in under a week. Proxim can evaluate, generate, and queue outreach within hours of a posting going live.

5. **Compounding over time.** Each week of data makes the scoring smarter. Each interview teaches you which archetypes convert. The system gets better the longer you run it.

---

*Proxim User Journey — v1.2*
*Aligns with: PRD v2.0 (F1.1–F10.6)*
*Author: Manav Ghosh*
