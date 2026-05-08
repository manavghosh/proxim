# Research: Resume Builder Agent (F10) — Phase 0

**Branch**: `003-resume-builder-agent` | **Date**: 2026-05-03

---

## Decision 1: PDF Generation Library

**Decision**: WeasyPrint `^62`

**Rationale**:
- Pure Python — no external binary required at runtime (unlike pdfkit/wkhtmltopdf)
- Renders HTML + CSS to PDF with full text layer → ATS parsers extract text correctly
- Native CSS Fragmentation Module support: `page-break-before`, `page-break-after`, `page-break-inside`, `@page :nth()` rules enforce 2–3 page resume and 1-page cover letter constraints
- Self-hosted font support via `@font-face { src: url("file:///...") }` — satisfies FR-013 Aptos font requirement with no external CDN call
- `FontConfiguration` object passed to `HTML.write_pdf()` registers bundled fonts before rendering

**Alternatives considered**:
- **Playwright/headless Chromium**: Rasterises text in PDF mode by default — fails ATS text extraction. Requires Chromium binary (~300MB) in agent Docker image.
- **ReportLab**: Requires programmatic layout (no HTML pipeline). Would need to abandon Jinja2 templates and rewrite layout logic in Python.
- **pdfkit/wkhtmltopdf**: Requires external `wkhtmltopdf` binary; fragile Windows installation; less Python-friendly.

**Critical gotcha**: WeasyPrint uses Fontconfig/Pango. On Linux Docker, install system packages: `libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 libffi-dev`. On Windows dev, register `Aptos.ttf` via absolute `file://` URL in `@font-face`. Use `full_fonts=True` in `write_pdf()` to embed complete glyph sets (not subsets), preventing ATS parser glyph-miss issues.

**Installation**:
```bash
pip install weasyprint
# Linux: apt-get install libpango-1.0-0 libcairo2
```

---

## Decision 2: HTML Template Engine

**Decision**: Jinja2 `^3.1`

**Rationale**: Already available in Python ecosystem. Template files (`resume.html.j2`, `cover_letter.html.j2`) are human-editable and version-controlled. Separating template from logic enables easy visual redesign without touching agent Python code. Jinja2's `autoescape=True` prevents XSS in any user-supplied content rendered into the HTML before PDF conversion.

**Alternatives considered**: Mako, Chameleon — less widely used, no advantage for this use case.

---

## Decision 3: LangGraph Self-Repair Retry Pattern

**Decision**: State-tracked retry counter with conditional edges

**Pattern**:
```python
class ResumeBuilderState(BaseModel):
    self_review_attempt: int = 0       # incremented on each retry
    review_passed: bool = False        # set True when coherence check passes

def route_after_review(state: ResumeBuilderState) -> str:
    if state.review_passed:
        return "generate_cover_letter"
    if state.self_review_attempt < 2:
        return "personalise_resume"    # retry with review_feedback
    return "generate_cover_letter"     # force forward at max retries

graph.add_conditional_edges("self_review", route_after_review)
```

**Rationale**: Retry counter in state (not node-level) gives full visibility in LangSmith traces. Max 2 retries (FR-014). If retries exhausted, pipeline continues with best available output rather than failing hard — persistent Pydantic validation failure at `store_version` marks job `resume_failed`.

**Alternatives considered**: LangGraph's built-in `RetryPolicy` — applies to node execution errors (exceptions), not logical validation failures. Not suitable here.

---

## Decision 4: Archetype Configuration Structure

**Decision**: `ArchetypeConfig` Pydantic model + `ArchetypeRegistry` singleton

**Rationale**: Strongly-typed, IDE-navigable, and serialisable to JSON for logging. Registry pattern centralises all 5 archetype definitions; `get_archetype()` handles unknown label → Agentic Systems Architect fallback (FR-002).

```python
class ArchetypeConfig(BaseModel):
    name: str
    section_order: list[str]          # e.g. ["summary", "proof_points", "roles", "skills"]
    lead_proof_point_types: list[str] # e.g. ["patent", "oss_project", "published_paper"]
    tone: str                         # "corporate" | "startup" | "thought_leadership"
    keywords_emphasis: list[str]      # domain keywords to prioritise in injection
```

**5 archetype definitions**:

| Archetype | Lead Proof Points | Section Order | Tone |
|---|---|---|---|
| Enterprise CAIO | patent, published_paper | summary → proof_points → roles → patents → education → skills | corporate |
| Startup CTO/VP | oss_project, speaking | proof_points → roles → skills → patents → education | startup |
| Agentic Systems Architect | oss_project, patent | proof_points → roles → skills → patents → education | thought_leadership |
| GCC AI Practice Head | published_paper, speaking | summary → roles → proof_points → education → skills | corporate |
| AI Thought Leader | speaking, published_paper | summary → proof_points → roles → education → skills | thought_leadership |

---

## Decision 5: PDF File Storage

**Decision**: Local filesystem in `agent/output/resumes/<job_id>/v<n>/` during MVP; path stored in `resume_versions.resume_pdf_path` and `cover_letter_pdf_path`.

**Rationale**: Avoids S3/object-storage complexity in MVP. Next.js `GET /api/jobs/[jobId]/resume/[versionId]/download` streams the file from disk. Path is absolute on the agent host; configurable via `RESUME_OUTPUT_DIR` env var. Migration to object storage is a path-swap in `pdf_renderer.py` only.

**Alternatives considered**: Inline `bytea` in PostgreSQL — rejected (large blobs inflate DB backup size and query latency). S3 — deferred to post-MVP.

---

## Decision 6: Keyword Extraction Approach

**Decision**: LiteLLM structured output with `KeywordSet` Pydantic model (15–20 strings)

**Rationale**: Consistent with existing scoring engine pattern (`response_format` JSON + Pydantic). Validates count (15–20) and uniqueness before injection. Simple NLP (TF-IDF, spaCy) was considered but rejected — the LLM better identifies *high-signal* keywords vs. high-frequency terms for ATS purposes.

**Validation**:
```python
class KeywordSet(BaseModel):
    keywords: list[str] = Field(min_length=15, max_length=20)

    @field_validator("keywords")
    @classmethod
    def no_duplicates(cls, v: list[str]) -> list[str]:
        unique = list(dict.fromkeys(kw.strip().lower() for kw in v))
        if len(unique) < 15:
            raise ValueError(f"Too few unique keywords after dedup: {len(unique)}")
        return unique[:20]
```

---

## Decision 7: Cover Letter Company Research Fallback

**Decision**: Primary source = JD-derived content. Deep company research (F10.5) not implemented in this phase. Fallback is clearly documented in version record (`company_research_used: bool = False`).

**Rationale**: Spec explicitly states F10.5 is optional and its absence degrades quality but does not block generation (spec §Edge Cases). This decision keeps F10 within its stated scope.
