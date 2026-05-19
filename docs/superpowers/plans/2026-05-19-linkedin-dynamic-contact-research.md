# LinkedIn Dynamic Contact Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `DISCOVERY_ROLES` list and static note template with three dynamic upgrades: (1) LLM-driven contact targeting, (2) real-time Exa research on the person and company, (3) research-driven note generation with proper structure.

**Architecture:** Three new capabilities chain sequentially after existing `enrich_profile_node`: `determine_target_roles()` replaces the static role list in `discover_contact_node`; a new `research_contact_node` runs two Exa searches (person + company) and stores results in state; `generate_notes_node` is rewritten to use this live context with a dynamic system prompt. No hardcoded role lists or note templates remain.

**Tech Stack:** Python asyncio, LiteLLM (Claude), Exa Python SDK (`exa_py`), aiosqlite, Pydantic, structlog

---

## File Map

| File | Change |
|---|---|
| `agent/agent/proxycurl.py` | Add `research_person()` and `research_company()` async functions |
| `agent/agent/nodes/linkedin_connector.py` | Add `person_research`/`company_research` to state; add `determine_target_roles()`; rewrite `discover_contact_node`; add `research_contact_node`; rewrite `generate_notes_node` |
| `agent/agent/daemon.py` | Import + wire `research_contact_node` in both `linkedin_connector` and `linkedin_note_regen` pipelines; add state fields |
| `agent/tests/unit/test_linkedin_connector_nodes.py` | Add tests for `determine_target_roles`, `research_contact_node`, updated `generate_notes_node` |

---

## Task 1: Exa research functions in `proxycurl.py`

**Files:**
- Modify: `agent/agent/proxycurl.py`

- [ ] **Step 1: Add `research_person` and `research_company` at the end of `proxycurl.py`**

```python
async def research_person(name: str, company: str, api_key: str) -> str:
    """Real-time Exa search for a person's recent professional context.

    Returns bullet-point titles of up to 3 search results, or empty string
    if nothing is found or the API call fails.
    """
    if not api_key or not name:
        return ""
    query = f"{name} {company} professional insights career"
    try:
        exa     = _exa_client(api_key)
        results = exa.search(query, num_results=3)
        items   = [r.title for r in results.results if r.title][:3]
        snippet = "\n".join(f"• {t}" for t in items)
        logger.info("exa.person_research", name=name, found=len(items))
        return snippet
    except Exception as exc:
        logger.debug("exa.research_person_error", name=name, error=str(exc)[:100])
        return ""


async def research_company(company: str, api_key: str) -> str:
    """Real-time Exa search for recent company news and AI direction.

    Returns bullet-point titles of up to 3 search results, or empty string
    if nothing is found or the API call fails.
    """
    if not api_key or not company:
        return ""
    query = f"{company} artificial intelligence technology innovation 2025"
    try:
        exa     = _exa_client(api_key)
        results = exa.search(query, num_results=3)
        items   = [r.title for r in results.results if r.title][:3]
        snippet = "\n".join(f"• {t}" for t in items)
        logger.info("exa.company_research", company=company, found=len(items))
        return snippet
    except Exception as exc:
        logger.debug("exa.research_company_error", company=company, error=str(exc)[:100])
        return ""
```

- [ ] **Step 2: Commit**

```bash
cd C:\Agentic-AI\Proxim
git add agent/agent/proxycurl.py
git commit -m "feat: add research_person and research_company to proxycurl"
```

---

## Task 2: Extend `LinkedInConnectorState` with research fields

**Files:**
- Modify: `agent/agent/nodes/linkedin_connector.py` (the `LinkedInConnectorState` class, lines ~51-70)

- [ ] **Step 1: Add `person_research` and `company_research` to the TypedDict**

Find the `LinkedInConnectorState` class and add two fields in the `# Discovery` section:

```python
class LinkedInConnectorState(TypedDict):
    # Input
    job_id:               str
    candidate_id:         str
    candidate_name:       str
    company:              str
    job_title:            str
    archetype:            str
    archetype_confidence: float
    # Discovery
    contact:          Optional[dict]
    enrichment:       Optional[dict]
    person_research:  str          # ← new: real-time person context from Exa
    company_research: str          # ← new: real-time company news from Exa
    # Generation
    note_a:              Optional[str]
    note_b:              Optional[str]
    generation_attempts: int
    # Output
    outreach_target_id: Optional[str]
    status:             str
    error:              Optional[str]
```

- [ ] **Step 2: Commit**

```bash
git add agent/agent/nodes/linkedin_connector.py
git commit -m "feat: add person_research and company_research to LinkedInConnectorState"
```

---

## Task 3: Write tests for `determine_target_roles`

**Files:**
- Modify: `agent/tests/unit/test_linkedin_connector_nodes.py`

- [ ] **Step 1: Write failing tests**

Add to `agent/tests/unit/test_linkedin_connector_nodes.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_determine_target_roles_returns_llm_roles():
    """LLM response is parsed into a list of role strings."""
    from agent.nodes.linkedin_connector import determine_target_roles

    mock_resp = MagicMock()
    mock_resp.choices[0].message.content = '{"roles": ["VP of AI", "CTO", "Head of Data"]}'

    with patch("agent.nodes.linkedin_connector.litellm.acompletion", new=AsyncMock(return_value=mock_resp)):
        roles = await determine_target_roles("AI Architect", "Acme Corp", "Agentic Systems Architect")

    assert roles == ["VP of AI", "CTO", "Head of Data"]


@pytest.mark.asyncio
async def test_determine_target_roles_falls_back_on_llm_failure():
    """Falls back to sensible defaults when LLM call raises an exception."""
    from agent.nodes.linkedin_connector import determine_target_roles

    with patch("agent.nodes.linkedin_connector.litellm.acompletion", new=AsyncMock(side_effect=Exception("timeout"))):
        roles = await determine_target_roles("AI Architect", "Acme Corp", "Agentic Systems Architect")

    assert len(roles) >= 3
    assert any("Chief AI Officer" in r or "Chief Technology Officer" in r for r in roles)


@pytest.mark.asyncio
async def test_determine_target_roles_caps_at_five():
    """Never returns more than 5 roles regardless of LLM output."""
    from agent.nodes.linkedin_connector import determine_target_roles

    mock_resp = MagicMock()
    mock_resp.choices[0].message.content = (
        '{"roles": ["R1","R2","R3","R4","R5","R6","R7"]}'
    )

    with patch("agent.nodes.linkedin_connector.litellm.acompletion", new=AsyncMock(return_value=mock_resp)):
        roles = await determine_target_roles("AI Architect", "Acme", "Agentic Systems Architect")

    assert len(roles) <= 5
```

- [ ] **Step 2: Run tests — expect FAIL (function not yet defined)**

```bash
cd C:\Agentic-AI\Proxim\agent
poetry run pytest tests/unit/test_linkedin_connector_nodes.py::test_determine_target_roles_returns_llm_roles -v
```

Expected: `FAILED` — `ImportError: cannot import name 'determine_target_roles'`

---

## Task 4: Implement `determine_target_roles` + rewrite `discover_contact_node`

**Files:**
- Modify: `agent/agent/nodes/linkedin_connector.py`

- [ ] **Step 1: Replace `DISCOVERY_ROLES` constant and `discover_contact_node` with the following**

Remove the entire `DISCOVERY_ROLES` list (lines ~37-47) and replace `discover_contact_node` with:

```python
# ── LLM-driven role determination ────────────────────────────────────────────

async def determine_target_roles(job_title: str, company: str, archetype: str) -> list[str]:
    """Use the LLM to determine 3-5 ideal contact roles for this specific job.

    Replaces the static DISCOVERY_ROLES list — the LLM adapts to company
    type, job seniority, and archetype so the most relevant contacts are
    tried first.  Falls back to a sensible default list on any failure.
    """
    prompt = (
        f"A candidate is applying for: '{job_title}' at '{company}'.\n"
        f"Candidate archetype: {archetype}.\n\n"
        f"Who are the ideal LinkedIn contacts to approach at this company?\n"
        f"Consider the company type — large enterprise vs startup will differ.\n"
        f"For AI/tech roles target AI/engineering leadership first.\n"
        f"Always include HR/Talent Acquisition as a fallback.\n"
        f"Give 3-5 specific job titles, ordered from most valuable (hiring manager) "
        f"to least (recruiter).\n"
        f'Return JSON: {{"roles": ["Role 1", "Role 2", "Role 3"]}}'
    )
    try:
        resp = await litellm.acompletion(
            model=_llm_model(),
            api_key=_llm_api_key(),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=200,
        )
        raw   = resp.choices[0].message.content or "{}"
        data  = json.loads(raw)
        roles = [str(r) for r in data.get("roles", []) if r][:5]
        if roles:
            logger.info("linkedin.roles_determined", roles=roles, company=company)
            return roles
    except Exception as exc:
        logger.warning("linkedin.role_determination_failed", error=str(exc)[:200])

    return [
        "Chief AI Officer",
        "Chief Technology Officer",
        "Head of Artificial Intelligence",
        "Vice President of Engineering",
        "Talent Acquisition Manager",
    ]


# ── Node: discover_contact ────────────────────────────────────────────────────

async def discover_contact_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Search for a hiring manager using LLM-determined roles (adaptive per job)."""
    pool    = _pool(config)
    api_key = _px_key(config)
    company = state["company"]

    await update_outreach_target(pool, state["outreach_target_id"], status="discovering")

    roles = await determine_target_roles(
        job_title=state["job_title"],
        company=company,
        archetype=state["archetype"],
    )

    for role in roles:
        logger.info("proxycurl.employee_search", company=company, role=role)
        contact = await proxycurl.search_employees(
            company_name=company, role=role, api_key=api_key
        )
        if contact:
            seniority = role.upper().replace(" ", "_")
            await update_outreach_target(
                pool,
                state["outreach_target_id"],
                status="enriching",
                name=contact.get("name"),
                linkedin_url=contact.get("profile_url"),
                title=contact.get("title"),
                seniority=seniority,
            )
            logger.info(
                "linkedin.contact_found",
                company=company,
                role=role,
                name=contact.get("name"),
            )
            return {"contact": contact, "status": "enriching"}

    logger.info("linkedin.no_contact_found", company=company)
    await update_outreach_target(
        pool, state["outreach_target_id"], status="no_contact_found"
    )
    return {"contact": None, "status": "no_contact_found"}
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
poetry run pytest tests/unit/test_linkedin_connector_nodes.py::test_determine_target_roles_returns_llm_roles tests/unit/test_linkedin_connector_nodes.py::test_determine_target_roles_falls_back_on_llm_failure tests/unit/test_linkedin_connector_nodes.py::test_determine_target_roles_caps_at_five -v
```

Expected: `3 passed`

- [ ] **Step 3: Commit**

```bash
cd C:\Agentic-AI\Proxim
git add agent/agent/nodes/linkedin_connector.py agent/tests/unit/test_linkedin_connector_nodes.py
git commit -m "feat: replace DISCOVERY_ROLES with LLM-driven determine_target_roles"
```

---

## Task 5: Write tests for `research_contact_node`

**Files:**
- Modify: `agent/tests/unit/test_linkedin_connector_nodes.py`

- [ ] **Step 1: Write failing tests**

Add to `agent/tests/unit/test_linkedin_connector_nodes.py`:

```python
@pytest.mark.asyncio
async def test_research_contact_node_populates_state():
    """research_contact_node adds person_research and company_research to state."""
    from agent.nodes.linkedin_connector import research_contact_node
    from langchain_core.runnables import RunnableConfig

    config = RunnableConfig(configurable={"pool": None, "proxycurl_api_key": "key"})
    state = {
        "contact": {"name": "Jane Doe"},
        "company": "Acme Corp",
        "candidate_id": "cand-1",
        "person_research": "",
        "company_research": "",
    }

    with (
        patch("agent.proxycurl.research_person", new=AsyncMock(return_value="• Jane's recent talk on AI")),
        patch("agent.proxycurl.research_company", new=AsyncMock(return_value="• Acme launches AI product")),
    ):
        result = await research_contact_node(state, config)

    assert result["person_research"] == "• Jane's recent talk on AI"
    assert result["company_research"] == "• Acme launches AI product"


@pytest.mark.asyncio
async def test_research_contact_node_handles_empty_results():
    """research_contact_node returns empty strings when Exa finds nothing."""
    from agent.nodes.linkedin_connector import research_contact_node
    from langchain_core.runnables import RunnableConfig

    config = RunnableConfig(configurable={"pool": None, "proxycurl_api_key": "key"})
    state  = {"contact": {"name": "Unknown"}, "company": "X Corp",
               "candidate_id": "c1", "person_research": "", "company_research": ""}

    with (
        patch("agent.proxycurl.research_person", new=AsyncMock(return_value="")),
        patch("agent.proxycurl.research_company", new=AsyncMock(return_value="")),
    ):
        result = await research_contact_node(state, config)

    assert result["person_research"] == ""
    assert result["company_research"] == ""
```

- [ ] **Step 2: Run — expect FAIL**

```bash
poetry run pytest tests/unit/test_linkedin_connector_nodes.py::test_research_contact_node_populates_state -v
```

Expected: `FAILED` — `ImportError: cannot import name 'research_contact_node'`

---

## Task 6: Implement `research_contact_node`

**Files:**
- Modify: `agent/agent/nodes/linkedin_connector.py` (add after `enrich_profile_node`)

- [ ] **Step 1: Add `research_contact_node` after `enrich_profile_node`**

Insert the following function immediately after the `enrich_profile_node` function (before `_NOTE_SYSTEM`):

```python
# ── Node: research_contact ────────────────────────────────────────────────────

async def research_contact_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Run real-time Exa research on the contact and their company.

    Fetches:
    - Person context: recent professional activity, talks, articles
    - Company context: recent AI announcements, news, strategy

    Results are stored in state and used by generate_notes_node to
    produce notes that reference real, timely information rather than
    generic phrases.
    """
    api_key = _px_key(config)
    contact = state.get("contact") or {}
    name    = contact.get("name", "")
    company = state["company"]

    person_research  = await proxycurl.research_person(name, company, api_key)
    company_research = await proxycurl.research_company(company, api_key)

    logger.info(
        "linkedin.research_complete",
        contact=name,
        company=company,
        has_person=bool(person_research),
        has_company=bool(company_research),
    )
    return {
        "person_research":  person_research,
        "company_research": company_research,
    }
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
poetry run pytest tests/unit/test_linkedin_connector_nodes.py::test_research_contact_node_populates_state tests/unit/test_linkedin_connector_nodes.py::test_research_contact_node_handles_empty_results -v
```

Expected: `2 passed`

- [ ] **Step 3: Commit**

```bash
git add agent/agent/nodes/linkedin_connector.py agent/tests/unit/test_linkedin_connector_nodes.py
git commit -m "feat: add research_contact_node — real-time Exa person + company research"
```

---

## Task 7: Rewrite `generate_notes_node` with dynamic structure

**Files:**
- Modify: `agent/agent/nodes/linkedin_connector.py`

- [ ] **Step 1: Replace `_NOTE_SYSTEM` constant and `generate_notes_node` entirely**

Remove the old `_NOTE_SYSTEM` string and the entire `generate_notes_node` function and replace with:

```python
MAX_NOTE_RETRIES = 3


async def generate_notes_node(state: LinkedInConnectorState, config: RunnableConfig) -> dict:
    """Generate A/B connection notes using real-time research for genuine personalisation.

    Uses three tiers of personalisation context (highest to lowest priority):
    1. Real-time Exa research (person_research, company_research from research_contact_node)
    2. Proxycurl enrichment signals (experience, education)
    3. Basic contact info (name, title, company)

    The system prompt and note structure are constructed dynamically per contact
    — no static templates.
    """
    pool             = _pool(config)
    enrichment       = state.get("enrichment") or {}
    contact          = state.get("contact") or {}
    person_research  = state.get("person_research", "")
    company_research = state.get("company_research", "")

    contact_name   = contact.get("name", "")
    first_name     = contact_name.split()[0] if contact_name else "there"
    candidate_name = state.get("candidate_name", "")

    # Real title from enrich_profile_node; fall back to first experience line
    raw_title = contact.get("title", "")
    if not raw_title:
        exps = enrichment.get("experiences", [])
        if exps:
            raw_title = exps[0].get("title", "").split(" at ")[0].strip()
    _EXPANSIONS = {"CAIO": "Chief AI Officer"}
    contact_title = _EXPANSIONS.get(raw_title.strip().upper(), raw_title) or "professional"

    # Build research context block — real-time Exa data takes priority
    context_parts: list[str] = []
    if person_research:
        context_parts.append(f"Recent context about {contact_name}:\n{person_research}")
    if company_research:
        context_parts.append(f"Recent news about {state['company']}:\n{company_research}")
    # Fallback to enrichment signals if Exa research is empty
    if not context_parts:
        exps = enrichment.get("experiences", [])
        edu  = enrichment.get("education", [])
        if exps and exps[0].get("title"):
            context_parts.append(f"Known about them: {exps[0]['title']}")
        elif edu:
            school = (edu[0].get("school") or {}).get("name", "")
            if school:
                context_parts.append(f"Known: studied at {school}")
    research_block = "\n\n".join(context_parts) if context_parts else "No additional context available."

    # Dynamic system prompt — structure enforced, angle decided by context
    system = (
        "You write hyper-personalised LinkedIn connection notes (max 300 chars each).\n"
        "Each note MUST follow this exact structure (use \\n for newlines in JSON):\n"
        "  Line 1: 'Hi [FirstName],'\n"
        "  Line 2: (blank)\n"
        "  Lines 3-4: 1-2 sentences using REAL context from the research below\n"
        "  Line 5: (blank)\n"
        "  Line 6: 'Thanks,'\n"
        "  Line 7: candidate's name\n\n"
        "Rules: never mention a job posting; use actual role title; "
        "note_a and note_b must differ in angle not just wording; max 300 chars total."
    )

    prompt = (
        f"Contact: {contact_name}, {contact_title} at {state['company']}\n"
        f"Candidate: {candidate_name} — {state['archetype']}\n\n"
        f"{research_block}\n\n"
        f"note_a angle: company innovation / recent news\n"
        f"note_b angle: the person's own expertise or career\n\n"
        f'Return JSON: {{"note_a": "...", "note_b": "..."}}'
    )

    await update_outreach_target(pool, state["outreach_target_id"], status="generating")

    last_error: str = ""
    for attempt in range(1, MAX_NOTE_RETRIES + 1):
        logger.info(
            "linkedin.generate_notes",
            attempt=attempt,
            candidate_id=state["candidate_id"],
            has_research=bool(person_research or company_research),
        )
        response = litellm.completion(
            model=_llm_model(),
            api_key=_llm_api_key(),
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        try:
            parsed   = json.loads(raw)
            variants = NoteVariants(**parsed)
            await update_outreach_target(
                pool,
                state["outreach_target_id"],
                status="notes_ready",
                note_a=variants.note_a,
                note_b=variants.note_b,
            )
            return {
                "note_a":              variants.note_a,
                "note_b":              variants.note_b,
                "generation_attempts": attempt,
                "status":              "notes_ready",
            }
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "linkedin.note_validation_failed",
                attempt=attempt,
                error=last_error,
            )

    await update_outreach_target(
        pool,
        state["outreach_target_id"],
        status="failed",
        error_message=f"Note generation failed after {MAX_NOTE_RETRIES} attempts: {last_error}",
    )
    return {
        "generation_attempts": MAX_NOTE_RETRIES,
        "status":              "failed",
        "error":               last_error,
    }
```

- [ ] **Step 2: Commit**

```bash
git add agent/agent/nodes/linkedin_connector.py
git commit -m "feat: rewrite generate_notes_node with dynamic structure and research context"
```

---

## Task 8: Wire `research_contact_node` into `daemon.py`

**Files:**
- Modify: `agent/agent/daemon.py`

- [ ] **Step 1: Update `linkedin_connector` import and state initialisation**

Find the `elif job['job_type'] == 'linkedin_connector':` block (around line 144).

**Update the import line** from:
```python
from agent.nodes.linkedin_connector import LinkedInConnectorState, check_dnc_node, discover_contact_node, enrich_profile_node, generate_notes_node
```
to:
```python
from agent.nodes.linkedin_connector import (
    LinkedInConnectorState, check_dnc_node, discover_contact_node,
    enrich_profile_node, research_contact_node, generate_notes_node,
)
```

**Add `person_research` and `company_research` to the state dict** (after `"enrichment": None`):
```python
        state: LinkedInConnectorState = {
            "job_id":               job_id,
            "candidate_id":         cand_id,
            "candidate_name":       li_candidate_name,
            "company":              company,
            "job_title":            job_title,
            "archetype":            archetype,
            "archetype_confidence": arch_conf,
            "contact":              None,
            "enrichment":           None,
            "person_research":      "",    # ← new
            "company_research":     "",    # ← new
            "note_a":               None,
            "note_b":               None,
            "generation_attempts":  0,
            "outreach_target_id":   target_id,
            "status":               "pending",
            "error":                None,
        }
```

**Insert `research_contact_node` call** in the `try:` block, between `enrich_profile_node` and `generate_notes_node`:
```python
            state = {**state, **(await enrich_profile_node(state, config))}
            state = {**state, **(await research_contact_node(state, config))}   # ← new
            state = {**state, **(await generate_notes_node(state, config))}
```

- [ ] **Step 2: Update `linkedin_note_regen` block**

Find the `elif job['job_type'] == 'linkedin_note_regen':` block (around line 76).

**Update the import line** from:
```python
        from agent.nodes.linkedin_connector import (
            LinkedInConnectorState, enrich_profile_node, generate_notes_node,
        )
```
to:
```python
        from agent.nodes.linkedin_connector import (
            LinkedInConnectorState, enrich_profile_node,
            research_contact_node, generate_notes_node,
        )
```

**Add `person_research` and `company_research` to the state dict** (after `"enrichment": target.get("enrichment_json")`):
```python
            "enrichment":           target.get("enrichment_json"),
            "person_research":      "",    # ← new
            "company_research":     "",    # ← new
```

**Insert `research_contact_node` call** between `enrich_profile_node` and `generate_notes_node`:
```python
            state = {**state, **(await enrich_profile_node(state, config))}
            state = {**state, **(await research_contact_node(state, config))}   # ← new
            state = {**state, **(await generate_notes_node(state, config))}
```

- [ ] **Step 3: Commit**

```bash
git add agent/agent/daemon.py
git commit -m "feat: wire research_contact_node into linkedin_connector and linkedin_note_regen pipelines"
```

---

## Task 9: Final verification

- [ ] **Step 1: Clear Python cache**

```bash
cd C:\Agentic-AI\Proxim\agent
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete 2>/dev/null
echo done
```

- [ ] **Step 2: Run full agent test suite**

```bash
poetry run pytest tests/unit/test_linkedin_connector_nodes.py -v
```

Expected: all tests pass (new tests + existing ones).

- [ ] **Step 3: Verify daemon starts cleanly**

```bash
cd C:\Agentic-AI\Proxim\agent
poetry run python -c "from agent.daemon import main; print('import OK')"
```

Expected: `import OK`

- [ ] **Step 4: Manual end-to-end smoke test**

1. Restart the daemon
2. In the Applications screen, click Retry on a LinkedIn Outreach section
3. Watch daemon logs — confirm you see all three new log lines:
   - `linkedin.roles_determined roles=[...]`
   - `exa.person_research found=N` and `exa.company_research found=N`
   - `linkedin.research_complete has_person=True has_company=True`
4. Once `notes_ready`, open the card and verify:
   - Note references the person's **actual** real title (not a search term)
   - Note has three sections: `Hi [Name],` / blank / body / blank / `Thanks,\n[Candidate]`
   - note_a and note_b differ in angle (one company-focused, one person-focused)
