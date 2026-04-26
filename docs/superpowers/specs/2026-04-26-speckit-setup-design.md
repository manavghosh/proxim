# SpecKit Setup Design — Proxim

**Date:** 2026-04-26
**Author:** Manav Ghosh
**Status:** Approved

---

## Overview

Set up SpecKit (spec-driven development) for the Proxim autonomous job-hunting agent, with a private GitHub repository, phase-by-phase feature scoping, and the Superpowers Bridge extension wiring Superpowers skills into the SpecKit lifecycle.

---

## Section 1 — Repository & Project Structure

A private GitHub repository `manavghosh/proxim` is created and cloned to `C:\Agentic-AI\Proxim`. Existing PRD and user journey documents move into `docs/`. SpecKit initialises with the Claude Code integration.

```
proxim/
├── .specify/                        # SpecKit artifacts
│   ├── constitution.md              # Project governing principles
│   └── features/
│       ├── phase-1-foundation/      # Created now — F1.1, F1.2, F1.3
│       │   ├── spec.md
│       │   ├── plan.md
│       │   └── tasks.md
│       └── ...                      # Subsequent phases added when reached
├── docs/
│   ├── proxim-prd-extended.md
│   ├── user-journey.md
│   └── superpowers/
│       └── specs/
│           └── 2026-04-26-speckit-setup-design.md
├── .superpowers/                    # Visual companion mockups (gitignored)
├── .gitignore
└── README.md
```

---

## Section 2 — Phase Mapping

One SpecKit feature folder per PRD phase. Only `phase-1-foundation` is created during this setup. Remaining folders are created at the start of each phase.

| SpecKit Feature Folder | PRD Phase | PRD Features |
|---|---|---|
| `phase-1-foundation` | Phase 1 | F1.1, F1.2, F1.3 |
| `phase-2-core-pipeline` | Phase 2 | F2.1–F2.3, F3.1–F3.3 |
| `phase-2-5-scoring-resume` | Phase 2.5 | F9.1–F9.3, F10.1–F10.6 |
| `phase-3-hitl` | Phase 3 | F4.1, F4.2 |
| `phase-4-outreach` | Phase 4 | F5.1–F5.4, F6.1–F6.4 |
| `phase-5-dashboard` | Phase 5 | F7.1–F7.3 |
| `phase-6-observability` | Phase 6 | F8.0–F8.3 |

Since the PRD already exists, Phase 1 skips `/speckit.specify` and goes directly to `/speckit.plan` using F1.1–F1.3 as input.

---

## Section 3 — Superpowers Bridge + Constitution

### Superpowers Bridge

Installs the Superpowers Bridge extension to automatically trigger Superpowers skills at each SpecKit lifecycle phase:

| SpecKit Phase | Superpowers Skill |
|---|---|
| Before `/speckit.specify` | `brainstorming` |
| Before `/speckit.plan` | `writing-plans` |
| Before `/speckit.implement` | `test-driven-development` |
| After `/speckit.implement` | `requesting-code-review` |
| Before claiming done | `verification-before-completion` |
| On any bug | `systematic-debugging` |

### Constitution Principles

The following principles are encoded in `/speckit.constitution`:

- **Language:** Python (FastAPI backend), TypeScript (Next.js frontend)
- **LLM:** Provider-configurable via LiteLLM. Default: `claude-sonnet-4-6`. Switch by setting `LLM_PROVIDER` in `.env` (supported: `anthropic`, `gemini`, `openai`). One provider active at a time across all agents.
- **Prompt caching:** Enabled conditionally — applied only when `LLM_PROVIDER=anthropic`, skipped silently for other providers.
- **Structured output:** All agents use LiteLLM `response_format` with Pydantic JSON schemas — provider-agnostic, validated on parse, self-repair loop on failure.
- **Orchestration:** LangGraph 0.2.x — version pinned, no auto-upgrade
- **Observability:** Every LangGraph agent node instrumented with OpenTelemetry spans carrying `job_id` and `agent_name` attributes
- **HITL gate:** No external action (email, LinkedIn, file send) fires without explicit user approval
- **Factual integrity:** Job titles, company names, dates, patent numbers, and quantified outcomes are never modified during resume personalisation
- **TDD:** Tests written before implementation code for every feature (enforced via Superpowers Bridge)
- **MCP servers (active from setup):** Context7 for library version lookups, GitHub MCP for repo operations. Neon DB MCP added at Phase 1, Playwright MCP at Phase 2.

---

## MCP Servers

| MCP Server | Set Up When | Purpose |
|---|---|---|
| Context7 | Now | Correct library versions and current API docs at plan/implement time |
| GitHub MCP | Now | Private repo creation and management |
| Neon DB MCP | Phase 1 | Database schema setup and migrations |
| Playwright MCP | Phase 2 | Job scraping agent browser automation |

Context7 and GitHub MCP are development environment prerequisites — configured in Claude Code settings before any SpecKit commands run.

## Installation Steps (Implementation Plan Input)

1. Configure Context7 MCP server in Claude Code settings
2. Configure GitHub MCP server in Claude Code settings
3. Create private GitHub repo `manavghosh/proxim`
4. Clone to `C:\Agentic-AI\Proxim` (replacing current local directory)
5. Move existing docs into `docs/`
6. Install `specify-cli` via `uv tool install`
7. Run `specify init . --integration claude-code`
8. Run `/speckit.constitution` with Proxim principles
9. Install Superpowers Bridge extension
10. Add `.superpowers/` to `.gitignore`
11. Create `phase-1-foundation` feature folder
12. Initial commit and push

---

## Out of Scope

- Specifying or implementing any Proxim features (Phase 1 implementation begins after this setup)
- Installing any other SpecKit community extensions beyond Superpowers Bridge
- Setting up CI/CD pipelines
