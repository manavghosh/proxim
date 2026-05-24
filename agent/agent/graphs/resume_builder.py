"""LangGraph resume builder graph for the Resume Builder Agent (F10)."""
from __future__ import annotations

import json
import os
import re
import structlog
from langgraph.graph import StateGraph, END

from agent.models import ResumeBuilderState

logger = structlog.get_logger()


def _candidate_slug(name: str) -> str:
    """Filesystem-safe folder name for a candidate. Keeps it human-readable.

    Examples:
      "Arijit Bhattacharya"  -> "arijit_bhattacharya"
      "Amélie O'Hara"        -> "amelie_ohara"
      ""  / None             -> "unnamed"
    """
    s = (name or '').strip().lower()
    # Decompose accented chars to ASCII so e.g. é → e.
    import unicodedata
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
    s = re.sub(r"[^\w\s-]", '', s)   # drop punctuation (apostrophes, commas, …)
    s = re.sub(r"\s+", '_', s)        # collapse whitespace to underscores
    s = s.strip('_')
    return s or 'unnamed'


async def _make_pool():
    from agent.config import settings
    from agent.db import create_pool
    return await create_pool(settings.database_url)


async def _close_pool(pool) -> None:
    from agent.db import close_pool
    await close_pool(pool)


async def _log(pool, pipeline_job_id: str, step: str, message: str,
               level: str = "info", data: dict | None = None) -> None:
    try:
        from agent.db import insert_pipeline_log
        await insert_pipeline_log(pool, pipeline_job_id, level=level,
                                  step=step, message=message, data=data)
    except Exception as e:
        logger.warning("log_write_failed", error=str(e))


# ── Nodes ─────────────────────────────────────────────────────────────────────

async def validate_inputs(state: ResumeBuilderState) -> dict:
    """Load job record, candidate profile, resolve archetype config."""
    pool = await _make_pool()
    try:
        import hashlib
        from agent.archetype_registry import ArchetypeRegistry
        from agent.db import get_candidate_preferences

        # Load job record
        if hasattr(pool, 'execute'):  # SQLite
            async with pool.execute(
                "SELECT id, title, company, jd_raw, archetype, archetype_confidence, candidate_id "
                "FROM jobs WHERE id = ?", (state.job_id,)
            ) as cur:
                row = await cur.fetchone()
        else:  # asyncpg
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT id, title, company, jd_raw, archetype, archetype_confidence, candidate_id "
                    "FROM jobs WHERE id = $1", state.job_id
                )
                row = tuple(row.values()) if row else None

        if not row:
            return {"error": f"Job {state.job_id} not found"}

        job_id, title, company, jd_raw, archetype, arch_conf, cand_id = row
        archetype = archetype or "Agentic Systems Architect"
        arch_conf = float(arch_conf or 1.0)

        # Load candidate profile
        if hasattr(pool, 'execute'):
            async with pool.execute(
                "SELECT parsed_profile, base_cv_hash FROM candidates WHERE id = ?",
                (cand_id or state.candidate_id,)
            ) as cur:
                cand_row = await cur.fetchone()
        else:
            async with pool.acquire() as conn:
                cand_row = await conn.fetchrow(
                    "SELECT parsed_profile, base_cv_hash FROM candidates WHERE id = $1",
                    cand_id or state.candidate_id
                )
                cand_row = tuple(cand_row.values()) if cand_row else None

        parsed_profile = {}
        base_cv_hash = ""
        if cand_row:
            raw = cand_row[0]
            parsed_profile = json.loads(raw) if isinstance(raw, str) else (raw or {})
            base_cv_hash = cand_row[1] or ""

        registry = ArchetypeRegistry()
        registry.get_archetype(archetype, arch_conf)  # validates

        # Look for an existing cover letter from a previous successful version —
        # on retry runs we skip re-generating if one already exists.
        existing_cl_path = ""
        if hasattr(pool, 'execute'):
            async with pool.execute(
                "SELECT cover_letter_pdf_path FROM resume_versions "
                "WHERE job_id = ? AND cover_letter_pdf_path IS NOT NULL "
                "AND generation_status = 'completed' "
                "ORDER BY created_at DESC LIMIT 1",
                (state.job_id,)
            ) as cur:
                cl_row = await cur.fetchone()
            if cl_row and cl_row[0]:
                existing_cl_path = cl_row[0]
        else:
            async with pool.acquire() as conn:
                cl_row = await conn.fetchrow(
                    "SELECT cover_letter_pdf_path FROM resume_versions "
                    "WHERE job_id = $1 AND cover_letter_pdf_path IS NOT NULL "
                    "AND generation_status = 'completed' "
                    "ORDER BY created_at DESC LIMIT 1",
                    state.job_id
                )
            if cl_row and cl_row['cover_letter_pdf_path']:
                existing_cl_path = cl_row['cover_letter_pdf_path']

        await _log(pool, state.pipeline_job_id, "validate_inputs",
                   f"Generating resume for {title} @ {company}")

        return {
            "job_title": title,
            "job_company": company,
            "jd_raw": jd_raw or "",
            "parsed_profile": parsed_profile,
            "archetype": archetype,
            "archetype_confidence": arch_conf,
            "base_cv_hash": base_cv_hash,
            "cover_letter_pdf_path": existing_cl_path,
        }
    except Exception as e:
        logger.error("validate_inputs_failed", error=str(e))
        return {"error": str(e)}
    finally:
        await _close_pool(pool)


async def extract_keywords(state: ResumeBuilderState) -> dict:
    """Extract 15–20 ATS keywords from the JD."""
    if state.error:
        return {}
    pool = await _make_pool()
    try:
        from agent.config import settings
        from agent.resume_engine import extract_keywords as _extract
        try:
            keyword_set = _extract(state.jd_raw, settings)
            await _log(pool, state.pipeline_job_id, "extract_keywords",
                       f"Extracted {len(keyword_set.keywords)} keywords")
            return {"keywords": keyword_set.keywords}
        except Exception as e:
            logger.warning("keyword_extraction_failed", error=str(e))
            await _log(pool, state.pipeline_job_id, "extract_keywords",
                       f"Keyword extraction failed (degraded): {e}", level="warning")
            return {"keywords": []}
    finally:
        await _close_pool(pool)


async def personalise_resume(state: ResumeBuilderState) -> dict:
    """Personalise the resume for the detected archetype."""
    if state.error:
        return {}
    pool = await _make_pool()
    try:
        from agent.config import settings
        from agent.archetype_registry import ArchetypeRegistry
        from agent.resume_engine import personalise_resume as _personalise
        from agent.telemetry import get_tracer

        registry = ArchetypeRegistry()
        arch_config = registry.get_archetype(state.archetype, state.archetype_confidence)

        prompt_kwargs = {}
        if state.review_feedback:
            prompt_kwargs["review_feedback"] = state.review_feedback

        try:
            with get_tracer().start_as_current_span("personalise_resume") as span:
                span.set_attribute("agent_name", "resume_builder")
                span.set_attribute("job_id", state.job_id or "")
                span.set_attribute("pipeline_run_id", state.pipeline_run_id or "")
                result = _personalise(
                    {"id": state.job_id, "title": state.job_title,
                     "company": state.job_company, "jd_raw": state.jd_raw},
                    state.parsed_profile, arch_config, state.keywords, settings,
                    job_id=state.job_id, run_id=state.pipeline_run_id,
                )
            await _log(pool, state.pipeline_job_id, "personalise_resume",
                       f"Resume personalised (attempt {state.self_review_attempt + 1})")
            return {
                "personalised_resume": result.model_dump_json(),
                "self_review_attempt": state.self_review_attempt + 1,
            }
        except Exception as e:
            logger.warning("personalise_resume_failed", error=str(e))
            await _log(pool, state.pipeline_job_id, "personalise_resume",
                       f"Personalisation failed: {e}", level="warning")
            return {"error": str(e)}
    finally:
        await _close_pool(pool)


async def self_review(state: ResumeBuilderState) -> dict:
    """Coherence check on the personalised resume."""
    if state.error:
        return {"review_passed": True}  # force forward on error state
    pool = await _make_pool()
    try:
        from agent.config import settings
        from agent.models import PersonalisedResume
        from agent.resume_engine import self_review as _review
        from agent.telemetry import get_tracer

        if not state.personalised_resume:
            return {"review_passed": False, "review_feedback": "No resume content generated"}

        pr = PersonalisedResume.model_validate_json(state.personalised_resume)
        with get_tracer().start_as_current_span("self_review") as span:
            span.set_attribute("agent_name", "resume_builder")
            span.set_attribute("job_id", state.job_id or "")
            span.set_attribute("pipeline_run_id", state.pipeline_run_id or "")
            ok, feedback = _review(
                {"id": state.job_id, "title": state.job_title, "company": state.job_company},
                pr, state.parsed_profile, settings,
                job_id=state.job_id, run_id=state.pipeline_run_id,
            )
        await _log(pool, state.pipeline_job_id, "self_review",
                   f"Coherence check: {'passed' if ok else 'failed'} — {feedback}")
        return {"review_passed": ok, "review_feedback": feedback}
    except Exception as e:
        logger.warning("self_review_failed", error=str(e))
        return {"review_passed": True, "review_feedback": "Review skipped due to error"}
    finally:
        await _close_pool(pool)


def route_after_review(state: ResumeBuilderState) -> str:
    if state.review_passed:
        return "inject_keywords"
    if state.self_review_attempt < 2:
        return "personalise_resume"
    return "inject_keywords"  # force forward after max retries per FR-014


async def inject_keywords(state: ResumeBuilderState) -> dict:
    """Inject extracted keywords into the personalised resume."""
    if state.error or not state.personalised_resume:
        return {}
    pool = await _make_pool()
    try:
        from agent.models import PersonalisedResume
        from agent.resume_engine import inject_keywords as _inject

        pr = PersonalisedResume.model_validate_json(state.personalised_resume)
        updated = _inject(pr, state.keywords)
        await _log(pool, state.pipeline_job_id, "inject_keywords",
                   f"Injected {len(state.keywords)} keywords")
        return {"personalised_resume": updated.model_dump_json()}
    except Exception as e:
        logger.warning("inject_keywords_failed", error=str(e))
        return {}
    finally:
        await _close_pool(pool)


async def generate_cover_letter(state: ResumeBuilderState) -> dict:
    """Generate a cover letter tailored to the archetype."""
    if state.error:
        return {}
    # Reuse cover letter from a previous successful run — skip generation.
    if state.cover_letter_pdf_path:
        pool = await _make_pool()
        try:
            await _log(pool, state.pipeline_job_id, "generate_cover_letter",
                       "Cover letter reused from previous version")
        finally:
            await _close_pool(pool)
        return {}
    pool = await _make_pool()
    try:
        from agent.config import settings
        from agent.archetype_registry import ArchetypeRegistry
        from agent.resume_engine import generate_cover_letter as _gen_cl

        registry = ArchetypeRegistry()
        arch_config = registry.get_archetype(state.archetype, state.archetype_confidence)

        cl = _gen_cl(
            {"id": state.job_id, "title": state.job_title,
             "company": state.job_company, "jd_raw": state.jd_raw},
            state.parsed_profile, arch_config, settings,
        )
        if not cl.company_research_used:
            await _log(pool, state.pipeline_job_id, "cover_letter_fallback",
                       "Company research not available — using JD-derived content")
        await _log(pool, state.pipeline_job_id, "generate_cover_letter",
                   "Cover letter generated")
        return {"cover_letter": cl.model_dump_json()}
    except Exception as e:
        logger.warning("generate_cover_letter_failed", error=str(e))
        return {"cover_letter": "{}"}
    finally:
        await _close_pool(pool)


async def render_pdf(state: ResumeBuilderState) -> dict:
    """Render resume + cover letter PDFs via WeasyPrint."""
    if state.error:
        return {}
    pool = await _make_pool()
    try:
        from agent.config import settings
        from agent.models import PersonalisedResume, CoverLetterContent
        from agent.archetype_registry import ArchetypeRegistry
        from agent.pdf_renderer import render_resume, render_cover_letter

        if not state.personalised_resume:
            return {"error": "No resume content to render"}

        registry = ArchetypeRegistry()
        arch_config = registry.get_archetype(state.archetype, state.archetype_confidence)

        pr = PersonalisedResume.model_validate_json(state.personalised_resume)
        pr_dict = pr.model_dump()
        pr_dict["profile"] = state.parsed_profile

        # Resolve the candidate's name so we can group all of their resumes
        # under one folder. Operators reviewing the output directory can then
        # navigate by candidate first instead of scanning a flat list of
        # job-id folders to find the right person.
        from agent.db import get_candidate_name
        candidate_name = await get_candidate_name(pool, state.candidate_id)
        candidate_slug = _candidate_slug(candidate_name)

        # Determine version number
        output_base = os.path.join(settings.resume_output_dir, candidate_slug, state.job_id)
        existing = [
            d for d in (os.listdir(output_base) if os.path.exists(output_base) else [])
            if d.startswith("v")
        ]
        version_n = len(existing) + 1
        version_dir = os.path.join(output_base, f"v{version_n}")
        os.makedirs(version_dir, exist_ok=True)

        resume_path = os.path.join(version_dir, "resume.pdf")

        job = {"id": state.job_id, "title": state.job_title, "company": state.job_company}
        render_resume(pr_dict, arch_config, job, resume_path)

        # Reuse existing cover letter PDF if no new one was generated this run.
        if state.cover_letter_pdf_path and not state.cover_letter:
            cl_path = state.cover_letter_pdf_path
        else:
            cl_path = os.path.join(version_dir, "cover_letter.pdf")
            cl_dict = {}
            if state.cover_letter:
                try:
                    cl_dict = json.loads(state.cover_letter)
                except Exception:
                    pass
            render_cover_letter(cl_dict, job, cl_path, profile=state.parsed_profile)

        await _log(pool, state.pipeline_job_id, "render_pdf",
                   f"PDFs rendered: v{version_n}")
        return {
            "resume_pdf_path": resume_path,
            "cover_letter_pdf_path": cl_path,
        }
    except Exception as e:
        logger.error("render_pdf_failed", error=str(e))
        return {"error": str(e)}
    finally:
        await _close_pool(pool)


async def store_version(state: ResumeBuilderState) -> dict:
    """Persist the resume version record to the DB."""
    pool = await _make_pool()
    try:
        from agent.db_sqlite import insert_resume_version, update_resume_version_status

        keywords_list = state.keywords

        vid = await insert_resume_version(
            pool,
            job_id=state.job_id,
            candidate_id=state.candidate_id,
            archetype=state.archetype,
            base_cv_hash=state.base_cv_hash,
            archetype_confidence=state.archetype_confidence,
            keywords=keywords_list,
            resume_pdf_path=state.resume_pdf_path,
            cover_letter_pdf_path=state.cover_letter_pdf_path,
            generation_status="completed",
        )

        # Update job status
        if hasattr(pool, 'execute'):
            await pool.execute("UPDATE jobs SET status = 'resume_ready' WHERE id = ?", (state.job_id,))
            await pool.execute("UPDATE pipeline_jobs SET status = 'completed' WHERE id = ?",
                               (state.pipeline_job_id,))
            await pool.commit()

        await _log(pool, state.pipeline_job_id, "store_version",
                   f"Version stored: {vid}")
        return {"version_id": vid}
    except Exception as e:
        logger.error("store_version_failed", error=str(e))
        return {"error": str(e)}
    finally:
        await _close_pool(pool)


async def handle_failure(state: ResumeBuilderState) -> dict:
    """Mark the job as failed in the DB."""
    pool = await _make_pool()
    try:
        from agent.db_sqlite import mark_resume_failed
        error_msg = state.error or "Unknown error"
        await mark_resume_failed(pool, state.job_id, error_msg)
        if hasattr(pool, 'execute'):
            await pool.execute(
                "UPDATE pipeline_jobs SET status = 'failed', error = ? WHERE id = ?",
                (error_msg, state.pipeline_job_id),
            )
            await pool.commit()
        await _log(pool, state.pipeline_job_id, "handle_failure",
                   f"Resume generation failed: {error_msg}", level="error")
        return {}
    except Exception as e:
        logger.error("handle_failure_error", error=str(e))
        return {}
    finally:
        await _close_pool(pool)


# ── Graph wiring ──────────────────────────────────────────────────────────────

def _has_error(state: ResumeBuilderState) -> str:
    return "handle_failure" if state.error else "continue"


def _build_graph():
    g = StateGraph(ResumeBuilderState)

    g.add_node("validate_inputs", validate_inputs)
    g.add_node("extract_keywords", extract_keywords)
    g.add_node("personalise_resume", personalise_resume)
    g.add_node("self_review", self_review)
    g.add_node("inject_keywords", inject_keywords)
    g.add_node("generate_cover_letter", generate_cover_letter)
    g.add_node("render_pdf", render_pdf)
    g.add_node("store_version", store_version)
    g.add_node("handle_failure", handle_failure)

    g.set_entry_point("validate_inputs")
    g.add_conditional_edges("validate_inputs", _has_error,
                            {"handle_failure": "handle_failure", "continue": "extract_keywords"})
    g.add_edge("extract_keywords", "personalise_resume")
    g.add_conditional_edges("personalise_resume", _has_error,
                            {"handle_failure": "handle_failure", "continue": "self_review"})
    g.add_conditional_edges("self_review", route_after_review)
    g.add_edge("inject_keywords", "generate_cover_letter")
    g.add_edge("generate_cover_letter", "render_pdf")
    g.add_conditional_edges("render_pdf", _has_error,
                            {"handle_failure": "handle_failure", "continue": "store_version"})
    g.add_edge("store_version", END)
    g.add_edge("handle_failure", END)

    return g.compile()


resume_builder_graph = _build_graph()
