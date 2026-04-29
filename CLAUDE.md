<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at:
docs/superpowers/plans/2026-04-27-phase-1-foundation.md
<!-- SPECKIT END -->

# Proxim — Agent Instructions

## Skill Triggers

Invoke the listed skill BEFORE taking any action in the corresponding situation.
If a skill applies, invoking it is mandatory — not optional.

### Development lifecycle

| Situation | Skill |
|---|---|
| Any new feature, component, or behaviour to design | `superpowers:brainstorming` |
| Writing a multi-step implementation plan from a spec | `superpowers:writing-plans` |
| Executing a written implementation plan | `superpowers:executing-plans` or `superpowers:subagent-driven-development` |
| Implementing any feature or bugfix (before writing code) | `superpowers:test-driven-development` |
| Before committing, opening a PR, or claiming work is done | `superpowers:verification-before-completion` |
| Encountering any bug, test failure, or unexpected behaviour | `superpowers:systematic-debugging` |
| 2+ independent tasks that can run without shared state | `superpowers:dispatching-parallel-agents` |
| Starting feature work that needs isolation from the workspace | `superpowers:using-git-worktrees` |
| Implementation complete — deciding how to integrate | `superpowers:finishing-a-development-branch` |
| Major feature step complete, pre-merge | `superpowers:requesting-code-review` |
| Receiving code review feedback | `superpowers:receiving-code-review` |

### Next.js / React code

| Situation | Skill |
|---|---|
| Writing or reviewing any React component, hook, or Next.js page | `vercel-react-best-practices` |
| Building any new UI page, layout, or component | `frontend-design` |
| Verifying frontend behaviour in the browser | `webapp-testing` |

### SpecKit workflows

| Situation | Skill |
|---|---|
| Creating or updating a feature specification | `speckit-specify` |
| Clarifying an underspecified spec before planning | `speckit-clarify` |
| Producing an implementation plan from design artifacts | `speckit-plan` |
| Generating a task list from design artifacts | `speckit-tasks` |
| Executing tasks defined in tasks.md | `speckit-implement` |
| Cross-checking spec, plan, and tasks for consistency | `speckit-analyze` |
| Creating or amending the project constitution | `speckit-constitution` |
