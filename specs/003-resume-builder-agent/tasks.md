# Tasks: Resume Builder Agent (F10)

**Input**: Design documents from `specs/003-resume-builder-agent/`
**Branch**: `003-resume-builder-agent`
**Date**: 2026-05-03
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data Model**: [data-model.md](data-model.md) | **Contracts**: [contracts/api.md](contracts/api.md) | **Research**: [research.md](research.md)

> **Skill gates embedded below.**
> — Before any implementation task: invoke `superpowers:test-driven-development`
> — Before any PR/completion claim: invoke `superpowers:verification-before-completion`
> — On any bug or test failure: invoke `superpowers:systematic-debugging`
> — On 2+ independent tasks: invoke `superpowers:dispatching-parallel-agents`

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Parallelisable (different files, no unresolved dependencies)
- **[Story]**: Which user story this task serves (US1/US2/US3/US4)
- **TDD gate** 🔴→🟢: Write the failing test first, confirm it fails, then implement

---

## Phase 1: Setup — Dependencies + Directories + Schema

**Purpose**: Install PDF/template dependencies, create asset directories, add `resume_versions` DB table.

- [x] T001 Add `weasyprint = "^62"` and `jinja2 = "^3.1"` to `agent/pyproject.toml` under `[tool.poetry.dependencies]`; run `poetry lock && poetry install` to confirm resolution
- [x] T002 [P] Create directories: `agent/agent/templates/`, `agent/agent/assets/fonts/`, `agent/output/resumes/.gitkeep`; create `agent/agent/templates/__init__.py` (empty)
- [x] T003 [P] Add `RESUME_OUTPUT_DIR=agent/output/resumes` to `agent/.env.example`; add field `resume_output_dir: str = "agent/output/resumes"` to `agent/agent/config.py` Settings class
- [x] T004 Place `Aptos.ttf` font file at `agent/agent/assets/fonts/Aptos.ttf` — verify file exists and is a valid TTF via `python -c "from weasyprint.fonts import FontConfiguration; print('ok')"`
- [x] T005 Add `resumeVersions` table to `src/db/schema.ts` per data-model.md: columns `id` (uuid PK), `jobId` (uuid FK → jobs), `candidateId` (uuid FK → candidates), `archetype` (text), `archetypeConfidence` (numeric), `keywords` (jsonb `$type<string[]>()`), `scoreAtGeneration` (numeric), `resumePdfPath` (text), `coverLetterPdfPath` (text), `baseCvHash` (text notNull), `isSubmitted` (boolean default false), `companyResearchUsed` (boolean default false), `generationStatus` (text default `'pending'`), `errorMessage` (text), `createdAt` (timestamp defaultNow); add indexes on `jobId` and `baseCvHash`
- [x] T006 Run `npm run db:generate` — review generated migration for correctness; run `npm run db:migrate` — confirm `resume_versions` table created
- [x] T007 Run `npx tsc --noEmit` — confirm zero TypeScript errors after schema addition

**Checkpoint ✅**: `poetry install` succeeds with WeasyPrint + Jinja2; `resume_versions` table exists in DB; TypeScript clean.

---

## Phase 2: Foundational — Models + Archetype Registry + DB Layer

**Purpose**: Core Python models, archetype configuration, and DB functions that all user story phases depend on. Must be complete before any graph work.

> ⚠️ **CRITICAL**: No user story work can begin until this phase is complete.

### 2A — Python Pydantic Models

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T009.

- [x] T008 Add the following Pydantic models to `agent/agent/models.py`:
  - `RoleSection`: `title: str`, `company: str`, `start_date: str`, `end_date: str`, `bullets: list[str]`
  - `KeywordSet`: `keywords: list[str]` with `field_validator` enforcing 15–20 unique lowercased entries
  - `PersonalisedResume`: `summary: str`, `roles: list[RoleSection]`, `skills: list[str]`, `proof_points: list[str]`, `coherence_ok: bool = False`
  - `CoverLetterContent`: `opening: str`, `body: str`, `closing: str`, `company_research_used: bool = False`
  - `ResumeBuilderState`: all fields per data-model.md — inputs (`candidate_id`, `pipeline_job_id`, `pipeline_run_id`, `job_id`, `job_title`, `job_company`, `jd_raw`, `parsed_profile`, `archetype`, `archetype_confidence`), intermediates (`keywords`, `personalised_resume`, `review_feedback`, `cover_letter`), retry tracking (`self_review_attempt: int = 0`, `review_passed: bool = False`), outputs (`resume_pdf_path`, `cover_letter_pdf_path`, `base_cv_hash`, `version_id`), error (`error: str = ""`)
- [x] T009 Write failing tests in `agent/tests/unit/test_models_resume.py`:
  `test_keyword_set_accepts_15_unique_keywords`;
  `test_keyword_set_rejects_fewer_than_15`;
  `test_keyword_set_deduplicates_case_insensitive`;
  `test_keyword_set_trims_whitespace`;
  `test_resume_builder_state_defaults_to_zero_retry_attempt`
- [x] T010 Run `poetry run pytest tests/unit/test_models_resume.py -v` — confirm all FAIL 🔴 (validator not yet implemented)
- [x] T011 Implement `KeywordSet.unique_and_trimmed` field_validator in `agent/agent/models.py` per research.md Decision 6
- [x] T012 Run `poetry run pytest tests/unit/test_models_resume.py -v` — confirm all PASS 🟢

### 2B — Archetype Registry

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T014.

- [x] T013 Write failing tests in `agent/tests/unit/test_archetype_registry.py`:
  `test_get_archetype_returns_correct_config_for_each_of_5_names`;
  `test_unknown_archetype_falls_back_to_agentic_systems_architect`;
  `test_confidence_below_0_6_forces_agentic_systems_architect_default`;
  `test_all_5_archetypes_have_non_empty_section_order_and_lead_proof_points`;
  `test_archetype_names_are_exact_strings_matching_jobs_table`
- [x] T014 Run `poetry run pytest tests/unit/test_archetype_registry.py -v` — confirm all FAIL 🔴
- [x] T015 Create `agent/agent/archetype_registry.py` with `ArchetypeConfig` Pydantic model and `ArchetypeRegistry` singleton; define all 5 archetypes per research.md Decision 4 (Enterprise CAIO, Startup CTO/VP, Agentic Systems Architect, GCC AI Practice Head, AI Thought Leader) with `section_order`, `lead_proof_point_types`, `tone`, `keywords_emphasis`; implement `get_archetype(name: str, confidence: float = 1.0) -> ArchetypeConfig` with fallback logic (confidence < 0.6 → Agentic Systems Architect; unknown name → Agentic Systems Architect) per FR-002
- [x] T016 Run `poetry run pytest tests/unit/test_archetype_registry.py -v` — confirm all PASS 🟢

### 2C — Python DB Layer for Resume Operations

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T018.

- [x] T017 Write failing tests in `agent/tests/unit/test_db_resume.py`:
  `test_get_approved_jobs_without_resume_returns_jobs_with_approved_status`;
  `test_get_approved_jobs_without_resume_excludes_jobs_with_existing_completed_version`;
  `test_insert_resume_version_returns_uuid`;
  `test_mark_resume_failed_sets_status_and_error_message`;
  `test_lock_submitted_resume_sets_is_submitted_true`;
  `test_lock_submitted_resume_raises_if_already_submitted` — all using SQLite mock (follow pattern in `agent/tests/unit/test_db_sqlite.py`)
- [x] T018 Run `poetry run pytest tests/unit/test_db_resume.py -v` — confirm all FAIL 🔴
- [x] T019 Add to `agent/agent/db_sqlite.py`: `get_approved_jobs_without_resume(conn)` — SELECT jobs WHERE status='approved' AND id NOT IN (SELECT job_id FROM resume_versions WHERE generation_status='completed'); `insert_resume_version(conn, **kwargs) -> str` — INSERT INTO resume_versions, return id; `get_resume_versions(conn, job_id: str) -> list[dict]`; `mark_resume_failed(conn, job_id: str, error: str)`; `lock_submitted_resume(conn, version_id: str)`; `update_resume_version_status(conn, version_id: str, status: str, resume_pdf_path: str = "", cover_letter_pdf_path: str = "")`
- [x] T020 [P] Add identical functions to `agent/agent/db_pg.py` using asyncpg pool (follow pattern of existing asyncpg functions)
- [x] T021 Run `poetry run pytest tests/unit/test_db_resume.py -v` — confirm all PASS 🟢

### 2D — Daemon + Next.js Pipeline Type Registration

- [x] T022 Update `agent/agent/daemon.py` dispatch block: add `elif job["job_type"] == "resume_builder": await run_resume_builder(job, pool)` stub function that logs `"resume_builder dispatched"` (full implementation wired in Phase 3)
- [x] T023 [P] Add `'resume_builder'` to the `VALID_JOB_TYPES` tuple in `src/app/api/pipeline/trigger/route.ts` so the Next.js trigger endpoint accepts this job type

**Checkpoint ✅ Foundation Ready**: DB models pass, archetype registry covers all 5 archetypes with correct fallback, DB functions tested, daemon accepts `resume_builder` job type.

---

## Phase 3: User Story 1 — Archetype-Matched Resume Generation (Priority: P1) 🎯 MVP

**Goal**: An approved job triggers resume generation; the agent personalises the resume for the detected archetype, runs a self-review coherence check, and stores a version record with the generated content.

**Independent Test**: Feed fixture approved job (archetype = "Agentic Systems Architect", confidence = 0.82) + fixture parsed_profile into `resume_builder_graph.ainvoke()`; assert `state.personalised_resume` is non-empty, `state.review_passed = True`, `state.version_id` is a UUID, version record in DB has `generation_status = 'completed'`.

> 🔵 Invoke `superpowers:test-driven-development` before T026 and T031.

### HTML Templates (Jinja2)

- [x] T024 [P] Create `agent/agent/templates/resume.html.j2`: ATS-safe semantic HTML (`<h1>` name, `<section>` per resume section, `<article>` per role, `<ul><li>` for bullets); CSS `@page { size: A4; margin: 1.5cm }` with `page-break-inside: avoid` on role articles; `@font-face` for Aptos using absolute path via `{{ font_path }}` Jinja2 variable; sections rendered in `{{ archetype_section_order }}` — sections with no data are hidden via `{% if %}` guards
- [x] T025 [P] Create `agent/agent/templates/cover_letter.html.j2`: single-page layout enforced via `@page { size: A4; margin: 2cm }` and `max-height` CSS; sections: opening paragraph, body (2–3 paragraphs), closing paragraph; same Aptos `@font-face` as resume template

### PDF Renderer

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T027.

- [x] T026 Write failing tests in `agent/tests/unit/test_pdf_renderer.py`:
  `test_render_resume_returns_bytes`;
  `test_render_resume_pdf_has_at_least_2_pages`;
  `test_render_cover_letter_pdf_has_exactly_1_page`;
  `test_pdf_text_is_extractable_via_pdfplumber` (assert `page.extract_text()` non-empty for each page);
  `test_resume_pdf_saved_to_correct_output_path` — use fixture minimal resume/cover letter dicts
- [x] T027 Run `poetry run pytest tests/unit/test_pdf_renderer.py -v` — confirm all FAIL 🔴
- [x] T028 Create `agent/agent/pdf_renderer.py`:
  - `FontConfig` dataclass: `aptos_path: str` resolved from `Path(__file__).parent / "assets/fonts/Aptos.ttf"`
  - `render_to_pdf(template_name: str, context: dict, output_path: str) -> bytes`: loads Jinja2 template from `agent/agent/templates/`, passes `font_path = f"file:///{font_config.aptos_path}"` in context, renders HTML string, calls `HTML(string=html).write_pdf(output_path, stylesheets=[CSS(string=css_overrides)], font_config=font_config, uncompressed_pdf=False)`; returns file bytes
  - `render_resume(personalised: dict, archetype_config: dict, job: dict, output_path: str) -> bytes`
  - `render_cover_letter(cover_letter: dict, job: dict, output_path: str) -> bytes`
  - Output path: `{settings.resume_output_dir}/{job_id}/v{version_n}/resume.pdf`
- [x] T029 Run `poetry run pytest tests/unit/test_pdf_renderer.py -v` — confirm all PASS 🟢

### Resume Personalisation Engine

> 🔴→🟢 TDD gate: invoke `superpowers:test-driven-development` before T031.

- [x] T030 Write failing tests in `agent/tests/unit/test_resume_engine.py`:
  `test_personalise_resume_returns_personalised_resume_model`;
  `test_personalise_resume_preserves_verbatim_titles_companies_dates`;
  `test_self_review_returns_coherence_ok_true_on_valid_output`;
  `test_self_review_returns_coherence_ok_false_on_fabricated_claim`;
  `test_generate_cover_letter_returns_cover_letter_content` — all mocking LiteLLM with fixture JSON responses
- [x] T031 Run `poetry run pytest tests/unit/test_resume_engine.py -v` — confirm all FAIL 🔴
- [x] T032 Create `agent/agent/resume_engine.py`:
  - `_get_api_key(settings) -> str`: returns `settings.gemini_api_key` or `settings.anthropic_api_key` per provider
  - `personalise_resume(job: dict, parsed_profile: dict, archetype_config: ArchetypeConfig, keywords: list[str], settings) -> PersonalisedResume`: builds prompt instructing LLM to reorder and reframe proof points per archetype section_order and lead_proof_point_types; CRITICAL RULE in prompt: all job titles, companies, dates, metrics, patent numbers MUST be verbatim from `parsed_profile`; calls `litellm.completion(model=f"{settings.llm_provider}/{settings.llm_model}", api_key=_get_api_key(settings), response_format={"type": "json_object"}, ...)`; validates with `PersonalisedResume.model_validate(parsed)`; raises `ValueError` on Pydantic failure
  - `self_review(job: dict, personalised: PersonalisedResume, parsed_profile: dict, settings) -> tuple[bool, str]`: calls LLM asking "does any bullet or proof point contain information NOT present verbatim in the source profile?"; returns `(coherence_ok: bool, feedback: str)`
  - `generate_cover_letter(job: dict, parsed_profile: dict, archetype_config: ArchetypeConfig, settings) -> CoverLetterContent`: generates 3-section cover letter; sets `company_research_used = False` (F10.5 deferred)
- [x] T033 Run `poetry run pytest tests/unit/test_resume_engine.py -v` — confirm all PASS 🟢

### LangGraph Resume Builder Graph

- [x] T034 Create `agent/agent/graphs/resume_builder.py` with helper `_make_pool()` (reuse pattern from existing graphs) and `_log(pool, pipeline_job_id, step, message, level, data)` (writes to `pipeline_logs`)
- [x] T035 [P] Implement `validate_inputs` node in `agent/agent/graphs/resume_builder.py`: load job record (assert status='approved', archetype non-null); load candidate parsed_profile; compute base_cv_hash; resolve archetype_config via `ArchetypeRegistry.get_archetype(state.archetype, state.archetype_confidence)`; log "Generating resume for {job_title} @ {job_company}"
- [x] T036 [P] Implement `personalise_resume` node in `agent/agent/graphs/resume_builder.py`: call `resume_engine.personalise_resume()`; on Pydantic failure → log warning; on success → store in state as JSON string; increment `state.self_review_attempt` on retry path (passed as `review_feedback` in state)
- [x] T037 Implement `self_review` node in `agent/agent/graphs/resume_builder.py`: call `resume_engine.self_review()`; set `state.review_passed` per result; log review outcome; define `route_after_review(state) -> str`: if `review_passed` → `"generate_cover_letter"`; elif `self_review_attempt < 2` → `"personalise_resume"` (retry with feedback); else → `"generate_cover_letter"` (force forward per FR-014)
- [x] T038 [P] Implement `generate_cover_letter` node in `agent/agent/graphs/resume_builder.py`: call `resume_engine.generate_cover_letter()`; store result in state; log "Cover letter generated"
- [x] T039 Implement `render_pdf` node in `agent/agent/graphs/resume_builder.py`: compute versioned output dir `{resume_output_dir}/{job_id}/v{n}/`; create dirs; call `pdf_renderer.render_resume()` and `pdf_renderer.render_cover_letter()`; store paths in state; log "PDFs rendered"
- [x] T040 Implement `store_version` node in `agent/agent/graphs/resume_builder.py`: call `insert_resume_version()` with all fields from state; update `pipeline_jobs.status = 'completed'`; update `jobs.status = 'resume_ready'`; set `state.version_id`; log "Version stored"
- [x] T041 Implement error handler `handle_failure` node: call `mark_resume_failed(job_id, error)`; update `jobs.status = 'resume_failed'`; update `pipeline_jobs.status = 'failed'`; log error
- [x] T042 Wire `StateGraph(ResumeBuilderState)` in `agent/agent/graphs/resume_builder.py`: add all nodes; edges: `validate_inputs → personalise_resume → self_review`; conditional edges from `self_review` via `route_after_review`; `generate_cover_letter → render_pdf → store_version → END`; add error edge from each node → `handle_failure`; compile to `resume_builder_graph`
- [x] T043 Update `agent/agent/daemon.py`: replace stub `run_resume_builder` with `state = ResumeBuilderState(candidate_id=..., pipeline_job_id=..., job_id=payload["job_id"], ...)`; `await resume_builder_graph.ainvoke(state, config=...)` following pattern of existing graph dispatches

### Next.js: Trigger + Versions Routes

- [x] T044 Create `src/app/api/jobs/[jobId]/resume/route.ts`:
  - `POST`: validate job exists and has `status = 'approved'`; check for existing `resume_builder` pipeline job (queued/running) → 409 with existing `pipelineJobId`; insert new `pipeline_jobs` row with `job_type = 'resume_builder'`, `payload = { job_id, candidate_id }`; return 201 `{ pipelineJobId, status: 'queued' }`
  - `GET`: query `resume_versions` WHERE `job_id = :jobId` ORDER BY `created_at DESC`; fetch `candidates.cv_hash` for staleness check; return versions array with `isStale` computed field per data-model.md
- [x] T045 Create `src/app/api/jobs/[jobId]/resume/[versionId]/download/route.ts`: `GET` handler; read `type` query param (`resume` | `cover-letter`); load version record; resolve file path (`resumePdfPath` or `coverLetterPdfPath`); stream file as `application/pdf` with `Content-Disposition: attachment`; 404 if not found or path empty
- [x] T046 Create `src/app/api/jobs/[jobId]/resume/[versionId]/submit/route.ts`: `POST`; verify version exists and `is_submitted = false` → 409 if already submitted; UPDATE `resume_versions SET is_submitted = true`; UPDATE `jobs SET status = 'submitted'`; return `{ versionId, isSubmitted: true }`
- [x] T047 [P] Add to `src/lib/api.ts`: `triggerResumeGeneration(jobId: string)`, `getResumeVersions(jobId: string)`, `downloadResumeUrl(jobId: string, versionId: string, type: 'resume' | 'cover-letter'): string` (returns URL string for `<a href>` download), `submitResumeVersion(jobId: string, versionId: string)`
- [x] T048 Run `npx tsc --noEmit` — zero TypeScript errors across all new routes

### Integration Test

- [x] T049 Write integration test `agent/tests/unit/test_resume_builder_graph.py`: fixture approved job (archetype="Agentic Systems Architect", confidence=0.82) + fixture parsed_profile; mock LiteLLM calls for `personalise_resume`, `self_review` (returns coherence_ok=True), `generate_cover_letter`; mock `render_to_pdf` to return `b"FAKEPDF"`; mock all DB writes; invoke `resume_builder_graph.ainvoke()`; assert `state.review_passed = True`, `state.version_id` non-empty, `state.error == ""`, `store_version` called once with correct args
- [x] T050 Run `poetry run pytest tests/unit/test_resume_builder_graph.py -v` — confirm PASS 🟢
- [x] T051 Run `poetry run pytest tests/ -v` — all tests pass

**Checkpoint ✅ US1**: Trigger `POST /api/jobs/:id/resume` on approved job → daemon picks up → resume personalised per archetype → PDFs rendered → version record in DB with `generation_status = 'completed'`. Verify via `npm run db:studio`.

---

## Phase 4: User Story 2 — ATS Keyword Injection (Priority: P2)

**Goal**: 15–20 high-signal keywords extracted from the JD are injected into the personalised resume naturally, with no keyword appearing more than 3 times and no factual field altered.

**Independent Test**: Feed fixture JD into `extract_keywords()` with mocked LiteLLM; assert `KeywordSet` has 15–20 unique keywords. Feed fixture resume + keywords into `inject_keywords()`; assert ≥15 keywords present in output, no keyword appears > 3 times, all verbatim factual fields unchanged.

> 🔵 Invoke `superpowers:test-driven-development` before T053.

### Keyword Extraction (TDD)

- [x] T052 Write failing tests in `agent/tests/unit/test_keyword_extraction.py`:
  `test_extract_keywords_returns_keyword_set_with_15_to_20_items`;
  `test_extract_keywords_deduplicates_case_insensitively`;
  `test_extract_keywords_rejects_llm_response_with_fewer_than_15`;
  `test_inject_keywords_does_not_alter_job_title_or_company`;
  `test_inject_keywords_each_keyword_appears_at_most_3_times`;
  `test_inject_keywords_result_contains_at_least_15_keywords`
- [x] T053 Run `poetry run pytest tests/unit/test_keyword_extraction.py -v` — confirm all FAIL 🔴
- [x] T054 Add `extract_keywords(jd_raw: str, settings) -> KeywordSet` to `agent/agent/resume_engine.py`: prompt instructs LLM to identify 15–20 high-signal ATS keywords from the JD as a JSON array; validates with `KeywordSet.model_validate(parsed)`; retries once if validation fails; raises `ValueError` after 2 failures
- [x] T055 Add `inject_keywords(personalised: PersonalisedResume, keywords: list[str]) -> PersonalisedResume` to `agent/agent/resume_engine.py`: iterate keywords; check if keyword already appears in summary/bullets (case-insensitive); if count < 3 and keyword not in a factual field (title, company, date, metric pattern) → inject into most relevant bullet via natural reformulation; skip if injection would alter a factual claim (FR-004); returns updated `PersonalisedResume`
- [x] T056 Run `poetry run pytest tests/unit/test_keyword_extraction.py -v` — confirm all PASS 🟢

### Wire into Graph

- [x] T057 Add `extract_keywords` node to `agent/agent/graphs/resume_builder.py`: call `resume_engine.extract_keywords()`; store `keywords` in state; on `ValueError` → log warning + set `state.keywords = []` (injection is degraded but not fatal); log "Extracted {n} keywords"
- [x] T058 Add `inject_keywords` node to `agent/agent/graphs/resume_builder.py`: call `resume_engine.inject_keywords(state.personalised_resume_obj, state.keywords)`; update `state.personalised_resume` with injected version; log "Injected {n} keywords"
- [x] T059 Update graph edges in `agent/agent/graphs/resume_builder.py`: insert `extract_keywords` between `validate_inputs` and `personalise_resume`; insert `inject_keywords` between `self_review` approval path and `generate_cover_letter`: `validate_inputs → extract_keywords → personalise_resume → self_review → [inject_keywords] → generate_cover_letter`
- [x] T060 Update integration test `agent/tests/unit/test_resume_builder_graph.py`: add mock for `extract_keywords` returning fixture 18 keywords; assert `state.keywords` has 18 items; assert `inject_keywords` was called
- [x] T061 Run `poetry run pytest tests/ -v` — all tests pass

**Checkpoint ✅ US2**: Generated resume contains 15–20 extracted keywords injected without altering factual fields. Verify with `pdfplumber` keyword count script from `quickstart.md`.

---

## Phase 5: User Story 3 — PDF Generation + Cover Letter (Priority: P3)

**Goal**: Resume PDF (2–3 pages enforced) and cover letter PDF (exactly 1 page enforced) are rendered from Jinja2 HTML templates with Aptos font; both are served via download route.

**Independent Test**: Generate PDFs from fixture content; verify with `pdfplumber`: resume has 2–3 pages, cover letter has exactly 1 page; all pages have extractable text (ATS check); download route streams correct `Content-Type: application/pdf`.

> 🔵 Invoke `superpowers:test-driven-development` before T063.

### Template + Page Enforcement

- [x] T062 Update `agent/agent/templates/resume.html.j2`: add CSS `@page :nth(4) { display: none }` to enforce max 3 pages; add overflow-hidden + auto-truncation of optional sections (older certifications, additional projects) via Jinja2 `{% if loop.index <= 3 %}` guards on lower-priority sections; add section priority comment block mapping each section to a truncation tier
- [x] T063 Write failing tests in `agent/tests/unit/test_pdf_page_count.py`:
  `test_resume_pdf_has_at_least_2_pages`;
  `test_resume_pdf_has_at_most_3_pages`;
  `test_cover_letter_pdf_has_exactly_1_page`;
  `test_all_resume_pages_have_extractable_text`;
  `test_all_cover_letter_pages_have_extractable_text` — use `pdfplumber` to inspect generated PDFs from fixture content
- [x] T064 Run `poetry run pytest tests/unit/test_pdf_page_count.py -v` — confirm all FAIL 🔴
- [x] T065 Tune CSS `@page` rules and Jinja2 section truncation in `agent/agent/templates/resume.html.j2` until all page count tests pass; tune `agent/agent/templates/cover_letter.html.j2` single-page enforcement
- [x] T066 Run `poetry run pytest tests/unit/test_pdf_page_count.py -v` — confirm all PASS 🟢

### Cover Letter Generation Integration

- [x] T067 [P] Verify `generate_cover_letter` node in `agent/agent/graphs/resume_builder.py` passes `archetype_config.tone` and `archetype_config.keywords_emphasis` to the cover letter LLM prompt so cover letter tone matches archetype; update `resume_engine.generate_cover_letter()` prompt to include these fields
- [x] T068 [P] Add cover letter JD-fallback logging: when `company_research_used = False`, log `_log(pool, "cover_letter_fallback", "Company research not available — using JD-derived content", level="info")`

### Download Route UI Wiring

- [x] T069 Add `ExportResumePanel` component to `src/components/applications/ExportResumePanel.tsx`: accepts `jobId: string`, `versions: ResumeVersion[]`, `currentCvHash: string` props; renders version list with: version number, archetype badge, creation date, stale indicator (`isStale = version.baseCvHash !== currentCvHash`), submitted badge (`isSubmitted`); per-version: "Download Resume" `<a>` link (calls `downloadResumeUrl(jobId, versionId, 'resume')`), "Download Cover Letter" `<a>` link, "Mark Submitted" button (calls `submitResumeVersion`); "Generate New" button at top triggers `triggerResumeGeneration(jobId)` and shows loading state
- [x] T070 Update `src/components/applications/JobCard.tsx`: add "Generate Resume" button visible when `job.status === 'approved'`; add "View Versions" button visible when `job.status === 'resume_ready' | 'resume_failed' | 'submitted'`; wire buttons to open `ExportResumePanel` in a drawer (follow pattern of existing `ReportDrawer`)
- [x] T071 Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T072 Run `npm run test:run` — all Next.js tests pass

**Checkpoint ✅ US3**: PDFs generated with correct page counts, ATS text extractable, download links work from job card.

---

## Phase 6: User Story 4 — Resume Version Management (Priority: P4)

**Goal**: Every generated PDF is tracked as an immutable version. Submitted versions are locked. Stale resumes (base CV changed) are flagged on the dashboard.

**Independent Test**: Generate v1 for a job; update candidate `cv_hash`; call `GET /api/jobs/:id/resume/versions` — assert `isStale = true` on v1. Mark v1 submitted; call `POST /api/jobs/:id/resume/generate` → new v2 created, v1 untouched (`is_submitted = true`). Attempt to regenerate v1 path directly → 409.

> 🔵 Invoke `superpowers:test-driven-development` before T074.

### Version Locking (TDD)

- [x] T073 Write failing tests in `agent/tests/unit/test_version_management.py`:
  `test_store_version_creates_new_version_when_previous_exists`;
  `test_store_version_does_not_overwrite_submitted_version`;
  `test_lock_submitted_resume_idempotent_raises_on_second_call`;
  `test_get_resume_versions_returns_newest_first`;
  `test_staleness_detected_when_cv_hash_differs`
- [x] T074 Run `poetry run pytest tests/unit/test_version_management.py -v` — confirm all FAIL 🔴
- [x] T075 Update `store_version` node in `agent/agent/graphs/resume_builder.py`: before inserting, query existing versions for this job; auto-compute version number as `MAX(version_n) + 1` (add `version_n: int` column to `resume_versions` via Drizzle migration); never overwrite or mutate existing version rows
- [x] T076 Add `version_n` column to `resumeVersions` table in `src/db/schema.ts`: `integer('version_n').notNull().default(1)`; run `npm run db:generate && npm run db:migrate`
- [x] T077 Run `poetry run pytest tests/unit/test_version_management.py -v` — confirm all PASS 🟢

### Staleness + UI Polish

- [x] T078 Update `GET /api/jobs/[jobId]/resume/route.ts` (GET handler): include `currentCvHash` from `candidates.cv_hash` in response; compute `isStale` per version in DB query (compare `base_cv_hash` to current)
- [x] T079 Update `src/components/applications/ExportResumePanel.tsx`: show orange "⚠ Stale — CV updated since generation" badge on stale versions; disable "Mark Submitted" on stale versions with tooltip "Regenerate first — CV has changed"
- [x] T080 Update `src/components/applications/JobCard.tsx`: show amber "CV Changed" indicator when latest version is stale and job status is `resume_ready`; show red "Generation Failed" badge when `job.status === 'resume_failed'` with retry button
- [x] T081 Run `npx tsc --noEmit` — zero TypeScript errors

**Checkpoint ✅ US4**: Version history persists across runs; stale indicator shows after CV update; submitted versions locked.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Observability, final verification, production hardening.

> 🔵 Invoke `superpowers:verification-before-completion` at T086 before final commit.

- [x] T082 [P] Add `structlog` logging throughout `agent/agent/graphs/resume_builder.py` and `agent/agent/resume_engine.py`: log `job_id`, `archetype`, `keywords_count`, `self_review_attempt`, `review_passed` at each node; log LLM call latency; log PDF file sizes on render
- [x] T083 [P] Add error boundary logging in all LiteLLM calls in `agent/agent/resume_engine.py`: catch `litellm.AuthenticationError` → log + re-raise; catch `litellm.RateLimitError` → log warning + sleep 60s + retry once
- [x] T084 [P] Update `agent/.env.example`: add `RESUME_OUTPUT_DIR=agent/output/resumes`
- [x] T085 Run full Python test suite: `cd agent && poetry run pytest tests/ -v --cov=agent --cov-report=term-missing` — all tests pass; coverage ≥ 80% on `resume_engine.py`, `pdf_renderer.py`, `archetype_registry.py`
- [x] T086 🔵 **Invoke `superpowers:verification-before-completion`** — run `npm run test:run`, `npx tsc --noEmit`, `npm run build`; all must pass with evidence before proceeding to T087
- [x] T087 Manual smoke test: start daemon; approve a job via dashboard; observe pipeline log pane showing resume generation steps; download PDF pair from job card; open PDFs and verify Aptos font, correct page count, candidate name correct
- [x] T088 Final commit: `git add -A && git commit -m "feat: resume builder agent — F10 complete"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup — DB schema, dependencies)
    └─► Phase 2 (Foundational — models, registry, DB layer)
              └─► Phase 3 (US1 — Core personalisation + graph) 🎯 MVP
                        └─► Phase 4 (US2 — Keyword injection)
                        │         └─► Phase 5 (US3 — PDF + cover letter)
                        │                   └─► Phase 6 (US4 — Version management)
                        │                             └─► Phase 7 (Polish)
                        └─► Phase 5 (US3 — templates can be built in parallel with Phase 4)
```

### User Story Dependencies

- **US1 (P1)**: Requires Phase 2 complete. Delivers end-to-end archetype-matched resume without keyword injection.
- **US2 (P2)**: Requires US1 graph wired (needs `ResumeBuilderState` and existing nodes to insert into). Keyword extraction adds one node before `personalise_resume`.
- **US3 (P3)**: Template work (T024, T025) can begin in parallel with Phase 3. WeasyPrint tests require `pdf_renderer.py` from Phase 3. Cover letter generation is already in Phase 3 — US3 focuses on page enforcement and download route.
- **US4 (P4)**: Requires US1 complete (`store_version` node exists). Version locking is a DB guard + `version_n` column addition.

### Within Each Phase

- TDD tasks (test writing) MUST complete and tests MUST **FAIL** before implementation begins
- Models (`models.py`) before services (`resume_engine.py`) before graph nodes (`resume_builder.py`)
- Python DB functions tested before graph nodes call them
- Drizzle migration must run before any DB-touching Next.js routes

### Parallel Opportunities

Within Phase 2: T008–T012 (Python models + DB functions) and T013–T016 (archetype registry) are fully parallel — different files.

Within Phase 3: T024+T025 (Jinja2 templates) parallel with T026+T030 (PDF renderer tests + resume engine tests); both are independent files.

Within Phase 3 graph: T035 (`validate_inputs` node) + T036 (`personalise_resume` node) parallel with T038 (`generate_cover_letter` node) — different nodes, no cross-dependency until wiring T042.

Polish: T082, T083, T084 all parallel (different files).

---

## Parallel Example: Phase 3 (US1)

```bash
# These 4 tasks can be dispatched in parallel (different files, no shared dependency):
Task T024: Create agent/agent/templates/resume.html.j2
Task T025: Create agent/agent/templates/cover_letter.html.j2
Task T026: Write agent/tests/unit/test_pdf_renderer.py (failing)
Task T030: Write agent/tests/unit/test_resume_engine.py (failing)

# Then after T026 and T030 fail-confirmed:
Task T028: Implement agent/agent/pdf_renderer.py
Task T032: Implement agent/agent/resume_engine.py (personalise + self_review + cover_letter)

# Then graph nodes (T034–T042) sequentially — each depends on the previous
```

---

## Implementation Strategy

### MVP First (US1 Only — ~5 days)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational)
3. Complete Phase 3 (US1) through T051
4. **STOP and VALIDATE**: Approve a job; verify daemon generates personalised resume + version record; download PDF from `/api/jobs/:id/resume/:versionId/download`
5. MVP delivered: end-to-end archetype-personalised resume PDF generated and downloadable

### Incremental Delivery

1. Phases 1–3 → US1 MVP: personalised resume generated per archetype
2. Phase 4 → US2: 15–20 keywords injected naturally into resume
3. Phase 5 → US3: PDF page count enforced, cover letter generated, download UI complete
4. Phase 6 → US4: version locking, staleness, submitted badge
5. Phase 7 → Production-hardened, fully verified

### Parallel Team Strategy

Once Phase 2 (Foundational) is complete:
- **Developer A**: US1 — `resume_engine.py`, `pdf_renderer.py`, `resume_builder.py` graph
- **Developer B**: US1 templates — `resume.html.j2`, `cover_letter.html.j2` (no Python dependency until `pdf_renderer.py` uses them)
- **Developer C**: US1 Next.js — trigger route, versions route, download route, `ExportResumePanel` UI

---

## Task Tracker Summary

| Phase | Tasks | Completed | Status |
|---|---|---|---|
| Phase 1: Setup | T001–T007 | 0/7 | ⬜ Pending |
| Phase 2: Foundational | T008–T023 | 0/16 | ⬜ Pending |
| Phase 3: US1 (Core Personalisation) | T024–T051 | 0/28 | ⬜ Pending |
| Phase 4: US2 (Keyword Injection) | T052–T061 | 0/10 | ⬜ Pending |
| Phase 5: US3 (PDF + Cover Letter) | T062–T072 | 0/11 | ⬜ Pending |
| Phase 6: US4 (Version Management) | T073–T081 | 0/9 | ⬜ Pending |
| Phase 7: Polish | T082–T088 | 0/7 | ⬜ Pending |
| **Total** | **T001–T088** | **0/88** | **0% complete** |

---

## Superpowers Skill Gate Summary

| Gate | When | Task ref |
|---|---|---|
| `superpowers:test-driven-development` | Before T009 (KeywordSet validator tests) | Phase 2 |
| `superpowers:test-driven-development` | Before T013 (ArchetypeRegistry tests) | Phase 2 |
| `superpowers:test-driven-development` | Before T017 (DB resume functions tests) | Phase 2 |
| `superpowers:test-driven-development` | Before T026 (PDF renderer tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T030 (resume engine tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T052 (keyword extraction tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T063 (PDF page count tests) | Phase 5 |
| `superpowers:test-driven-development` | Before T073 (version management tests) | Phase 6 |
| `superpowers:systematic-debugging` | On any test failure or unexpected behaviour | Any phase |
| `superpowers:dispatching-parallel-agents` | T024+T025+T026+T030 in parallel (Phase 3); T008+T013 in parallel (Phase 2) | Phases 2, 3 |
| `superpowers:verification-before-completion` | Before T087 (smoke test + final commit) | Phase 7 |



