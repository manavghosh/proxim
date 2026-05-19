"""Proxim agent polling daemon — polls DB every 3s for queued pipeline jobs."""
import warnings
# langchain_core uses pydantic.v1 compat layer which emits a UserWarning on Python 3.14+.
# The daemon functions correctly — suppress the noise.
warnings.filterwarnings("ignore", message="Core Pydantic V1 functionality", category=UserWarning)

import asyncio
import signal
import structlog

logger = structlog.get_logger()
_stop_event = asyncio.Event()


def _handle_sigterm(*_):
    logger.info("sigterm_received", message="Shutting down daemon gracefully")
    _stop_event.set()


async def _dispatch_job(pool, job: dict) -> None:
    """Dispatch a pipeline job to the appropriate LangGraph graph."""
    from agent.db import insert_pipeline_run, get_candidate_preferences

    run_id = await insert_pipeline_run(pool, job['id'], job['candidate_id'])

    if job['job_type'] == 'fetch_jds':
        from agent.graphs.fetch_jds import fetch_jds_graph
        from agent.models import FetchJdsState

        logger.info("job_dispatching", job_id=job['id'], job_type='fetch_jds')

        state = FetchJdsState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
        )
        await fetch_jds_graph.ainvoke(state)

    elif job['job_type'] == 'resume_builder':
        from agent.graphs.resume_builder import resume_builder_graph
        from agent.models import ResumeBuilderState

        payload = job.get('payload') or {}
        job_id = payload.get('job_id', '')
        logger.info("job_dispatching", job_id=job['id'], job_type='resume_builder', target_job_id=job_id)

        state = ResumeBuilderState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
            job_id=job_id,
        )
        await resume_builder_graph.ainvoke(state)

    elif job['job_type'] == 'score_jobs':
        from agent.graphs.scoring import scoring_graph
        from agent.models import ScoringState

        payload = job.get('payload') or {}
        job_ids = payload.get('job_ids') or []
        logger.info(
            "job_dispatching",
            job_id=job['id'],
            job_type='score_jobs',
            batch_size=len(job_ids) if job_ids else 'all_ready',
        )

        state = ScoringState(
            candidate_id=str(job['candidate_id']),
            pipeline_job_id=str(job['id']),
            pipeline_run_id=run_id,
            job_ids=list(job_ids),
        )
        await scoring_graph.ainvoke(state)

    elif job['job_type'] == 'linkedin_note_regen':
        import agent.db as _db_regen
        from agent.nodes.linkedin_connector import (
            LinkedInConnectorState, enrich_profile_node, generate_notes_node,
        )
        from agent.config import settings as _settings_regen
        from langchain_core.runnables import RunnableConfig as _RC

        payload   = job.get('payload') or {}
        target_id = payload.get('target_id', '')
        job_id    = payload.get('job_id', '')
        cand_id   = str(job['candidate_id'])

        logger.info("job_dispatching", job_id=job['id'], job_type='linkedin_note_regen',
                    target_id=target_id)

        target = await _db_regen.get_outreach_target(pool, target_id)
        if not target:
            logger.warning("linkedin_note_regen.target_not_found", target_id=target_id)
            await _db_regen.update_pipeline_job_status(pool, job['id'], 'failed',
                                                        error=f'Target {target_id} not found')
            return

        config = _RC(configurable={
            "pool": pool,
            "proxycurl_api_key": getattr(_settings_regen, 'exa_api_key', ''),
        })

        state: LinkedInConnectorState = {
            "job_id":               job_id,
            "candidate_id":         cand_id,
            "company":              target.get("company", ""),
            "job_title":            "",
            "archetype":            "",
            "archetype_confidence": 0.0,
            "contact":              {"profile_url": target.get("linkedin_url", "")},
            "enrichment":           target.get("enrichment_json"),
            "note_a":               None,
            "note_b":               None,
            "generation_attempts":  0,
            "outreach_target_id":   target_id,
            "status":               "generating",
            "error":                None,
        }
        try:
            state = {**state, **(await enrich_profile_node(state, config))}
            state = {**state, **(await generate_notes_node(state, config))}
            logger.info("linkedin_note_regen.complete", target_id=target_id,
                        status=state["status"])
            await _db_regen.update_pipeline_job_status(pool, job['id'], 'completed')
        except Exception as exc:
            logger.error("linkedin_note_regen.error", target_id=target_id, error=str(exc))
            await _db_regen.update_outreach_target(
                pool, target_id, status="failed", error_message=str(exc)
            )
            await _db_regen.update_pipeline_job_status(pool, job['id'], 'failed', error=str(exc))

    elif job['job_type'] == 'linkedin_connector':
        from agent.nodes.linkedin_connector import LinkedInConnectorState, check_dnc_node, discover_contact_node, enrich_profile_node, generate_notes_node
        from agent.db import insert_outreach_target, update_pipeline_job_status
        from agent.config import settings
        from langchain_core.runnables import RunnableConfig

        payload    = job.get('payload') or {}
        job_id     = payload.get('job_id', '')
        company    = payload.get('company', '')
        job_title  = payload.get('job_title', '')
        archetype  = payload.get('archetype', '')
        arch_conf  = float(payload.get('archetype_confidence', 0))
        cand_id    = str(job['candidate_id'])

        logger.info("job_dispatching", job_id=job['id'], job_type='linkedin_connector',
                    target_job_id=job_id, company=company)

        target_id = await insert_outreach_target(pool, job_id, cand_id, company)
        config    = RunnableConfig(configurable={
            "pool": pool,
            "proxycurl_api_key": getattr(settings, 'exa_api_key', ''),
        })

        state: LinkedInConnectorState = {
            "job_id":               job_id,
            "candidate_id":         cand_id,
            "company":              company,
            "job_title":            job_title,
            "archetype":            archetype,
            "archetype_confidence": arch_conf,
            "contact":              None,
            "enrichment":           None,
            "note_a":               None,
            "note_b":               None,
            "generation_attempts":  0,
            "outreach_target_id":   target_id,
            "status":               "pending",
            "error":                None,
        }

        try:
            state = {**state, **(await check_dnc_node(state, config))}
            if state["status"] == "skipped_dnc":
                logger.info("linkedin.dnc_skip_complete", target_id=target_id)
                await update_pipeline_job_status(pool, job['id'], 'completed')
                return

            state = {**state, **(await discover_contact_node(state, config))}
            if state["status"] == "no_contact_found":
                logger.info("linkedin.no_contact_complete", target_id=target_id)
                await update_pipeline_job_status(pool, job['id'], 'completed')
                return

            state = {**state, **(await enrich_profile_node(state, config))}
            state = {**state, **(await generate_notes_node(state, config))}
            logger.info("linkedin.connector_complete", target_id=target_id,
                        status=state["status"])
            await update_pipeline_job_status(pool, job['id'], 'completed')
        except Exception as exc:
            from agent.db import update_outreach_target
            logger.error("linkedin.connector_error", target_id=target_id, error=str(exc))
            await update_outreach_target(pool, target_id, status="failed",
                                         error_message=str(exc))
            await update_pipeline_job_status(pool, job['id'], 'failed', error=str(exc))

    elif job['job_type'] == 'import_jobs':
        from agent.db import (
            get_jobs_by_ids, update_job_meta, queue_pipeline_job,
            update_pipeline_job_status, insert_pipeline_log,
        )

        payload  = job.get('payload') or {}
        job_ids  = payload.get('job_ids', [])
        cand_id  = str(job['candidate_id'])
        pj_id    = job['id']

        logger.info("job_dispatching", job_id=pj_id, job_type='import_jobs', count=len(job_ids))

        async def _log(step: str, message: str, data: dict | None = None) -> None:
            try:
                await insert_pipeline_log(pool, pj_id, level="info", step=step,
                                          message=message, data=data)
            except Exception:
                pass

        try:
            if not job_ids:
                await update_pipeline_job_status(pool, pj_id, 'completed')
                return

            await _log("import_jobs", f"Starting import of {len(job_ids)} job(s)",
                       {"count": len(job_ids)})

            jobs_to_fetch = await get_jobs_by_ids(pool, job_ids)
            linkedin_jobs = [j for j in jobs_to_fetch if j['source'] == 'linkedin']
            other_jobs    = [j for j in jobs_to_fetch if j['source'] != 'linkedin']

            fetched = 0
            if linkedin_jobs:
                from agent.scrapers.linkedin_jd import LinkedInJdScraper
                scraper = LinkedInJdScraper()
                total = len(linkedin_jobs)

                await _log("import_jobs", f"Fetching job descriptions from LinkedIn for {total} job(s)",
                           {"total": total})

                async def on_fetched(job_id: str, jd_text: str, title: str = "", company: str = "") -> None:
                    nonlocal fetched
                    fetched += 1
                    if jd_text or title:
                        await update_job_meta(
                            pool, job_id,
                            title=title or "Imported Job",
                            company=company or "Unknown",
                            jd_raw=jd_text,
                        )
                        words = len(jd_text.split()) if jd_text else 0
                        await _log("import_jobs",
                                   f"Job {fetched}/{total} fetched: {(title or 'Unknown')[:50]} — {words} words",
                                   {"fetched": fetched, "total": total, "words": words})
                        logger.info("import_jobs.fetched", job_id=job_id, title=(title or "")[:60])
                    else:
                        await _log("import_jobs",
                                   f"Job {fetched}/{total} — no content found (URL may be expired or private)",
                                   {"fetched": fetched, "total": total})

                await scraper.fetch_jds(linkedin_jobs, on_fetched=on_fetched)

            # Non-LinkedIn: store source URL as JD so scoring can proceed
            for j in other_jobs:
                await update_job_meta(pool, j['id'],
                                      title=j.get('title') or "Imported Job",
                                      company=j.get('company') or "Unknown",
                                      jd_raw=j['source_url'])

            await _log("import_jobs",
                       f"Fetch complete — {fetched} LinkedIn job(s) processed. Queuing scoring.",
                       {"fetched": fetched})

            await queue_pipeline_job(pool, cand_id, 'score_jobs')
            await _log("import_jobs",
                       f"Score jobs queued — jobs will appear in the Pipeline review queue once scored.",
                       {"queued": True})

            await update_pipeline_job_status(pool, pj_id, 'completed')
            logger.info("import_jobs.complete", count=len(job_ids), fetched=fetched)

        except Exception as exc:
            logger.error("import_jobs.error", job_id=pj_id, error=str(exc))
            await _log("import_jobs", f"Import failed: {exc}", {"error": str(exc)})
            await update_pipeline_job_status(pool, pj_id, 'failed', error=str(exc))

    elif job['job_type'] in ('outreach_mailer', 'outreach_mailer_generate'):
        from agent.nodes.outreach_mailer import (
            OutreachMailerState, discover_email_node, generate_emails_node,
            write_cadence_checkpoint_node,
        )
        from agent.db import insert_email_cadence, update_pipeline_job_status, update_email_cadence
        from agent.config import settings as _settings
        from langchain_core.runnables import RunnableConfig

        payload    = job.get('payload') or {}
        job_id     = payload.get('job_id', '')
        company    = payload.get('company', '')
        job_title  = payload.get('job_title', '')
        archetype  = payload.get('archetype', '')
        arch_conf  = float(payload.get('archetype_confidence', 0))
        cand_id    = str(job['candidate_id'])
        pj_id      = job['id']

        logger.info("job_dispatching", job_id=pj_id, job_type=job['job_type'],
                    target_job_id=job_id, company=company)

        if job['job_type'] == 'outreach_mailer':
            cadence_id = await insert_email_cadence(pool, job_id, cand_id)
        else:
            cadence_id = str(payload.get('cadence_id', ''))
            # Guard: cadence must exist — stale jobs from a prev session may reference
            # a cadence that was deleted or never committed.
            async with pool.execute(
                "SELECT id FROM email_cadences WHERE id = ?", (cadence_id,)
            ) as cursor:
                if not await cursor.fetchone():
                    logger.warning("outreach_mailer_generate.cadence_not_found",
                                   cadence_id=cadence_id, pipeline_job_id=pj_id)
                    await update_pipeline_job_status(pool, pj_id, 'failed',
                                                     error=f'Cadence {cadence_id} not found')
                    return

        config = RunnableConfig(configurable={"pool": pool, "settings": _settings})

        state: OutreachMailerState = {
            "job_id": job_id,
            "candidate_id": cand_id,
            "company": company,
            "job_title": job_title,
            "archetype": archetype,
            "archetype_confidence": arch_conf,
            "hiring_manager_name": None,
            "cadence_id": cadence_id,
            "discovered_email": None,
            "email_confidence": None,
            "email_source": None,
            "subject": None,
            "day1_body": None,
            "day3_body": None,
            "day7_body": None,
            "generation_attempts": 0,
            "status": "discovering",
            "error": None,
        }

        try:
            if job['job_type'] == 'outreach_mailer':
                state = {**state, **(await discover_email_node(state, config))}
                if state["status"] in ("email_not_found", "low_confidence"):
                    await update_pipeline_job_status(pool, pj_id, 'completed')
                    return
            state = {**state, **(await generate_emails_node(state, config))}
            if state["status"] == "failed":
                await update_pipeline_job_status(pool, pj_id, 'failed',
                                                  error=state.get("error") or "Generation failed")
                return
            await write_cadence_checkpoint_node(state, config)
            await update_pipeline_job_status(pool, pj_id, 'completed')
        except Exception as exc:
            logger.error("outreach_mailer.error", cadence_id=cadence_id, error=str(exc))
            await update_email_cadence(pool, cadence_id, status="failed", error_message=str(exc))
            await update_pipeline_job_status(pool, pj_id, 'failed', error=str(exc))

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


async def _linkedin_acceptance_poll_once(pool) -> None:
    """Single poll pass — update accepted/expired status for sent outreach targets."""
    import agent.db as _db
    import agent.linkedin_api as linkedin_api
    from datetime import datetime, timezone, timedelta
    get_sent_outreach_targets_for_polling = _db.get_sent_outreach_targets_for_polling
    get_candidate_preferences             = _db.get_candidate_preferences
    update_outreach_target                = _db.update_outreach_target

    targets = await get_sent_outreach_targets_for_polling(pool)
    for t in targets:
        try:
            prefs        = await get_candidate_preferences(pool, t["candidate_id"])
            access_token = prefs.get("linkedin_access_token", "")
            inv_id       = t.get("linkedin_invitation_id", "")
            if not access_token or not inv_id:
                continue

            status = await linkedin_api.get_invitation_status(access_token, inv_id)

            sent_at_raw = t.get("sent_at") or ""
            sent_at: datetime | None = None
            try:
                sent_at = datetime.fromisoformat(sent_at_raw.replace("Z", "+00:00"))
            except Exception:
                pass

            now = datetime.now(timezone.utc)
            is_old = sent_at is not None and (now - sent_at) > timedelta(days=30)

            if status == "ACCEPTED":
                await update_outreach_target(
                    pool, t["id"],
                    status="accepted",
                    accepted_at=now.isoformat(),
                    last_polled_at=now.isoformat(),
                )
                logger.info("linkedin.accepted", target_id=t["id"])
            elif is_old and status == "PENDING":
                await update_outreach_target(
                    pool, t["id"],
                    status="expired",
                    last_polled_at=now.isoformat(),
                )
                logger.info("linkedin.expired", target_id=t["id"])
            else:
                await update_outreach_target(
                    pool, t["id"],
                    last_polled_at=now.isoformat(),
                )
        except Exception as exc:
            logger.warning("linkedin.poll_error", target_id=t.get("id"), error=str(exc))


async def _linkedin_acceptance_poll_loop(pool) -> None:
    """Poll acceptance status every 24 hours."""
    while not _stop_event.is_set():
        try:
            await _linkedin_acceptance_poll_once(pool)
        except Exception as exc:
            logger.error("linkedin.poll_loop_error", error=str(exc))
        await asyncio.sleep(86400)


async def _linkedin_queued_send_once(pool) -> None:
    """Single pass — process queued outreach targets when under the daily limit."""
    import agent.db as _db
    import agent.linkedin_api as linkedin_api
    from datetime import datetime, timezone
    get_queued_outreach_targets = _db.get_queued_outreach_targets
    get_daily_send_count        = _db.get_daily_send_count
    get_candidate_preferences   = _db.get_candidate_preferences
    update_outreach_target      = _db.update_outreach_target

    # candidate_id="" → db_sqlite returns all queued across candidates
    all_queued = await get_queued_outreach_targets(pool, "")
    if not all_queued:
        return

    # Group by candidate
    by_cand: dict[str, list[dict]] = {}
    for t in all_queued:
        by_cand.setdefault(t["candidate_id"], []).append(t)

    now = datetime.now(timezone.utc)

    for cand_id, targets in by_cand.items():
        try:
            prefs = await get_candidate_preferences(pool, cand_id)
            if prefs.get("linkedin_paused"):
                continue

            access_token = prefs.get("linkedin_access_token", "")
            if not access_token:
                continue

            daily_count  = await get_daily_send_count(pool, cand_id)
            remaining    = max(0, 20 - daily_count)

            for target in targets[:remaining]:
                try:
                    note = (
                        target.get("edited_note")
                        or (target.get("note_a") if target.get("selected_note") == "A" else target.get("note_b"))
                        or target.get("note_a")
                        or ""
                    )
                    profile_id = (target.get("linkedin_url") or "").rstrip("/").split("/")[-1]
                    inv_id = await linkedin_api.send_connection_request(
                        access_token, profile_id, note
                    )
                    await update_outreach_target(
                        pool, target["id"],
                        status="sent",
                        sent_at=now.isoformat(),
                        linkedin_invitation_id=inv_id,
                    )
                    logger.info("linkedin.queued_sent", target_id=target["id"])
                except linkedin_api.LinkedInRateLimitError:
                    await update_outreach_target(pool, target["id"], status="paused")
                    logger.warning("linkedin.rate_limit_on_queued_send", target_id=target["id"])
                    break
                except Exception as exc:
                    logger.error("linkedin.queued_send_error", target_id=target["id"], error=str(exc))
        except Exception as exc:
            logger.error("linkedin.queued_loop_cand_error", candidate_id=cand_id, error=str(exc))


async def _linkedin_queued_send_loop(pool) -> None:
    """Process queued sends every hour."""
    while not _stop_event.is_set():
        try:
            await _linkedin_queued_send_once(pool)
        except Exception as exc:
            logger.error("linkedin.queued_loop_error", error=str(exc))
        await asyncio.sleep(3600)


async def _snooze_resurface_loop(pool) -> None:
    """Poll every 60 seconds for expired snoozed jobs and resurface them."""
    from agent.db import get_snoozed_jobs_to_resurface, resurface_snoozed_job

    while not _stop_event.is_set():
        try:
            expired = await get_snoozed_jobs_to_resurface(pool)
            for item in expired:
                await resurface_snoozed_job(pool, item['checkpoint_id'], item['job_id'])
                logger.info(
                    "snooze_resurfaced",
                    job_id=item['job_id'],
                    checkpoint_id=item['checkpoint_id'],
                )
        except Exception as exc:
            logger.error("snooze_resurface_error", error=str(exc))
        await asyncio.sleep(60)


async def _outreach_send_once(pool) -> None:
    """Single pass of the cadence send loop."""
    import agent.db as _db
    import agent.gmail_client as gmail_client
    from agent.gmail_client import GmailAuthExpiredError
    from datetime import datetime, timezone, timedelta

    drafts = await _db.get_scheduled_drafts(pool)
    for draft in drafts:
        candidate_id = draft["candidate_id"]
        cadence_id = draft["cadence_id"]
        draft_id = draft["id"]
        day_number = draft["day_number"]

        # Daily cap check
        count = await _db.get_daily_email_send_count(pool, candidate_id)
        if count >= 20:
            next_send = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
            await _db.update_email_draft(pool, draft_id, status="rate_limited", scheduled_send_at=next_send)
            logger.warning("outreach.rate_limited", candidate_id=candidate_id, draft_id=draft_id)
            continue

        # Load candidate preferences
        prefs = await _db.get_candidate_preferences(pool, candidate_id)

        # Day 1 attachment check
        attachments = None
        if day_number == 1:
            attach_mode = (prefs or {}).get("email_resume_attachment", "tailored")

            if attach_mode == "original":
                async with pool.execute(
                    "SELECT base_resume_pdf_path FROM candidates WHERE id = ?",
                    (candidate_id,)
                ) as cur:
                    row = await cur.fetchone()
                base_path = row[0] if row else None
                if base_path:
                    attachments = [{"path": base_path, "filename": "resume.pdf"}]
                    logger.info("outreach.original_resume_attached",
                                candidate_id=candidate_id)
                else:
                    logger.warning("outreach.original_resume_missing_fallback",
                                   candidate_id=candidate_id)

            if attachments is None:  # tailored mode, or original fallback
                resume = await _db.get_resume_version_for_send(
                    pool, candidate_id, draft.get("job_id", ""))
                if resume is None:
                    await _db.update_email_cadence(pool, cadence_id,
                                                   status="attachment_missing")
                    logger.info("outreach.attachment_missing", cadence_id=cadence_id)
                    continue
                pdf_path = resume.get("resume_pdf_path")
                cl_path  = resume.get("cover_letter_pdf_path")
                attachments = (
                    [{"path": pdf_path, "filename": "resume.pdf"}] if pdf_path else []
                )
                if cl_path:
                    attachments.append(
                        {"path": cl_path, "filename": "cover_letter.pdf"}
                    )

        # Skip auto-send if candidate is using manual mode (default)
        email_mode = (prefs or {}).get("email_outreach_mode", "manual")
        if email_mode == "manual":
            logger.debug("outreach.manual_mode_skip", draft_id=draft_id, candidate_id=candidate_id)
            continue

        access_token = prefs.get("gmail_access_token", "") if prefs else ""
        refresh_token = prefs.get("gmail_refresh_token", "") if prefs else ""

        try:
            result = gmail_client.send_email(
                service=None,
                to=draft["hiring_manager_email"],
                subject=draft["subject"],
                body_html=draft["body_html"],
                body_text=draft["body_text"],
                thread_id=draft.get("gmail_thread_id"),
                in_reply_to=draft.get("day1_message_id"),
                references=draft.get("day1_message_id"),
                attachments=attachments,
            )
            now = datetime.now(timezone.utc).isoformat()
            await _db.update_email_draft(pool, draft_id, status="sent", sent_at=now,
                                          gmail_message_id=result["id"])
            logger.info("outreach.sent", draft_id=draft_id, day=day_number)

            if day_number == 1:
                await _db.update_email_cadence(pool, cadence_id,
                                                gmail_thread_id=result["threadId"],
                                                day1_message_id=result["id"],
                                                status="active")
                # Schedule Day 3 and Day 7
                day3_at = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
                day7_at = (datetime.now(timezone.utc) + timedelta(hours=168)).isoformat()
                other_drafts = await _db.get_cadence_drafts(pool, cadence_id)
                for od in other_drafts:
                    if od["day_number"] == 3:
                        await _db.update_email_draft(pool, od["id"], status="scheduled",
                                                      scheduled_send_at=day3_at)
                    elif od["day_number"] == 7:
                        await _db.update_email_draft(pool, od["id"], status="scheduled",
                                                      scheduled_send_at=day7_at)

        except GmailAuthExpiredError:
            await _db.update_email_cadence(pool, cadence_id, status="auth_expired")
            logger.warning("outreach.auth_expired", cadence_id=cadence_id)


async def _outreach_send_loop(pool) -> None:
    """Cadence send loop — polls every 3 minutes for scheduled drafts."""
    while not _stop_event.is_set():
        try:
            await _outreach_send_once(pool)
        except Exception as exc:
            logger.error("outreach_send_loop.error", error=str(exc))
        await asyncio.sleep(180)


async def _reply_bounce_detection_once(pool) -> None:
    """Single pass of reply/bounce detection."""
    import agent.db as _db
    import agent.gmail_client as gmail_client
    from agent.gmail_client import GmailAuthExpiredError

    cadences = await _db.get_active_cadences_for_polling(pool)
    for cadence in cadences:
        cadence_id = cadence["id"]
        day1_message_id = cadence.get("day1_message_id")

        if not day1_message_id:
            continue

        candidate_id = cadence["candidate_id"]
        prefs = await _db.get_candidate_preferences(pool, candidate_id)
        access_token = prefs.get("gmail_access_token", "") if prefs else ""
        refresh_token = prefs.get("gmail_refresh_token", "") if prefs else ""

        try:
            service = gmail_client.build_service(access_token, refresh_token)

            if gmail_client.check_reply(service, day1_message_id):
                from datetime import datetime, timezone
                await _db.update_email_cadence(pool, cadence_id,
                                                status="replied",
                                                reply_detected_at=datetime.now(timezone.utc).isoformat())
                await _db.cancel_pending_drafts(pool, cadence_id)
                logger.info("outreach.reply_detected", cadence_id=cadence_id)
                continue

            if gmail_client.check_bounce(service, day1_message_id):
                from datetime import datetime, timezone
                await _db.update_email_cadence(pool, cadence_id,
                                                status="bounced",
                                                bounce_detected_at=datetime.now(timezone.utc).isoformat())
                await _db.bounce_day1_cancel_day3_day7(pool, cadence_id)
                logger.info("outreach.bounce_detected", cadence_id=cadence_id)

        except GmailAuthExpiredError:
            await _db.update_email_cadence(pool, cadence_id, status="auth_expired")
            logger.warning("outreach.detection_auth_expired", cadence_id=cadence_id)
        except Exception as exc:
            logger.warning("outreach.detection_error", cadence_id=cadence_id, error=str(exc))


async def _reply_bounce_detection_loop(pool) -> None:
    """Reply/bounce detection loop — polls every 60 minutes."""
    while not _stop_event.is_set():
        try:
            await _reply_bounce_detection_once(pool)
        except Exception as exc:
            logger.error("detection_loop.error", error=str(exc))
        await asyncio.sleep(3600)


async def main() -> None:
    from agent.config import settings
    from agent.db import (
        create_pool, close_pool, claim_pipeline_job,
        reset_stale_pipeline_jobs,
        reset_stale_linkedin_outreach, reset_stale_email_cadences,
    )

    loop = asyncio.get_running_loop()

    def _handle_shutdown(*_):
        logger.info("shutdown_signal", message="Shutting down — cancelling all tasks")
        _stop_event.set()
        for task in asyncio.all_tasks(loop):
            if task is not asyncio.current_task():
                task.cancel()

    signal.signal(signal.SIGTERM, _handle_shutdown)
    signal.signal(signal.SIGINT, _handle_shutdown)

    logger.info("daemon_starting", polling_interval_seconds=settings.polling_interval_seconds)
    pool = await create_pool(settings.database_url)

    # On startup, re-queue any pipeline_jobs that were 'running' when the
    # daemon was last killed, then reset in-flight outreach rows to 'failed'.
    # Together these ensure: interrupted jobs re-run automatically, and the
    # UI shows Retry buttons instead of eternal spinners.
    pj_reset = await reset_stale_pipeline_jobs(pool)
    li_reset = await reset_stale_linkedin_outreach(pool)
    em_reset = await reset_stale_email_cadences(pool)
    if pj_reset or li_reset or em_reset:
        logger.info("daemon_stale_reset", pipeline_jobs=pj_reset, linkedin=li_reset, email=em_reset)

    async def _job_poll_loop():
        try:
            while not _stop_event.is_set():
                job = await claim_pipeline_job(pool)
                if job:
                    logger.info("job_claimed", job_id=job['id'], job_type=job['job_type'])
                    await _dispatch_job(pool, job)
                else:
                    logger.debug("poll_idle", message="No jobs queued")
                await asyncio.sleep(settings.polling_interval_seconds)
        except asyncio.CancelledError:
            pass
        finally:
            await close_pool(pool)
            logger.info("daemon_stopped")

    try:
        await asyncio.gather(
            _job_poll_loop(),
            _snooze_resurface_loop(pool),
            _linkedin_acceptance_poll_loop(pool),
            _linkedin_queued_send_loop(pool),
            _outreach_send_loop(pool),
            _reply_bounce_detection_loop(pool),
        )
    except asyncio.CancelledError:
        logger.info("daemon_cancelled", message="All tasks cancelled, exiting cleanly")


if __name__ == "__main__":
    asyncio.run(main())
