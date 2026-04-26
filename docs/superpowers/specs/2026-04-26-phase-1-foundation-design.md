# Phase 1 Foundation Design — Proxim

**Date:** 2026-04-26
**Author:** Manav Ghosh
**Status:** Approved
**Covers:** F1.1 (Resume Upload), F1.2 (Resume Parsing & Structuring), F1.3 (Candidate Preferences)

---

## Overview

Phase 1 establishes the candidate profile that every downstream agent depends on. It consists of
a single `/settings` page with two independent sections — CV and Preferences — that can be
completed in any order.

**Design decisions made during brainstorming (overrides or clarifications to PRD):**

| Decision | Choice | Note |
|----------|--------|------|
| User model | Single-user now, multi-user later | `candidate_id` FK in schema from day one; no auth in Phase 1 |
| Markdown review | Inline editable before save | Candidate corrects conversion errors before the CV is stored |
| Preference gate | Two-tier | Seniority level + geographic preference required; all other fields optional |
| File size limit | 10MB | Overrides PRD's 5MB |
| CV version history | Post-MVP | Current saved version only; prior versions overwritten |

---

## Architecture & User Flow

### `/settings` Page

Two independent sections on a single page. Either can be completed first.

**CV Section — flow:**

1. Candidate uploads PDF, DOCX, or MD file (max 10MB)
2. Server converts to Markdown and returns it immediately
3. Inline Markdown editor appears with the converted content
4. Candidate reviews and corrects the Markdown
5. Candidate clicks Save — SHA256 hash computed, Markdown stored as canonical base CV
6. Background parse job fires automatically — structured profile JSON extracted from saved Markdown
7. Parse status indicator updates: `parsing` → `ready` (or `failed` with retry button)

**Preferences Section — flow:**

- Form with all preference fields visible
- Seniority level and geographic preference are required (highlighted, validated on save)
- All other fields optional — save always succeeds for optional fields
- Partial saves never clear existing values

**Pipeline readiness indicator:**

Active when: CV saved AND seniority level set AND geographic preference set.
If inactive, a specific prompt identifies the missing field (e.g., "Set your target seniority
to activate the pipeline"). The indicator is informational only — it does not block saving.

---

## Data Model

### `candidates` table

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID PK | |
| `candidate_id` | UUID FK | Nullable in Phase 1 — populated when auth added post-MVP |
| `base_cv_md` | TEXT | Canonical Markdown CV as saved by the candidate after editing |
| `base_cv_hash` | VARCHAR(64) | SHA256 of saved Markdown — used for stale resume detection (F10.6) |
| `parsed_profile` | JSONB | Structured extraction from CV |
| `parse_status` | ENUM | `pending` / `parsing` / `ready` / `failed` |
| `preferences` | JSONB | All preference fields |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `parsed_profile` JSONB shape

```json
{
  "name": "",
  "contact": {},
  "summary": "",
  "roles": [{ "title": "", "company": "", "dates": "", "bullets": [] }],
  "skills": [],
  "patents": [],
  "projects": [],
  "education": [],
  "certifications": [],
  "awards": []
}
```

Schema-validated before write. Malformed output is rejected — not stored. Prior valid
`parsed_profile` is preserved until successfully overwritten.

### `preferences` JSONB shape

```json
{
  "seniority_levels": [],        // REQUIRED — e.g. ["CAIO", "VP AI", "Head of AI"]
  "geographic_preference": "",   // REQUIRED — e.g. "Remote", "Bengaluru-based"
  "company_stages": [],          // optional
  "compensation_band": {},        // optional — { "min": 0, "max": 0, "currency": "INR" }
  "target_companies": [],         // optional — list of company names
  "preferred_domains": []         // optional — e.g. ["BFSI", "SaaS"]
}
```

---

## Error Handling & Edge Cases

### CV Upload

| Scenario | Behaviour |
|----------|-----------|
| File > 10MB | Inline error before upload starts; file rejected |
| Unsupported format | Clear error; accepted formats listed (PDF, DOCX, MD) |
| Conversion failure (corrupt / scanned PDF) | Error shown in editor area; no Markdown stored; candidate prompted to try different file or paste Markdown directly |
| Parse failure after save | `parse_status = failed`; warning + retry button shown; prior `parsed_profile` preserved |
| Re-upload with identical content (same hash) | No re-parse triggered; silent no-op |
| Re-upload with changed content | New Markdown shown in editor; hash and re-parse fire only on confirmed save |

### Preferences

| Scenario | Behaviour |
|----------|-----------|
| Save with required field missing | Inline field-level validation; specific fields highlighted; save blocked only for required fields |
| Partial save of optional fields | Always succeeds; never clears existing values |

### Out of Scope for Phase 1

- Stale resume flags when base CV changes — F10.6 scope (hash is stored correctly; flags are downstream)
- CV version history — post-MVP
- Multi-user isolation — post-MVP

---

## Testing Approach

Per the Proxim constitution, critical paths require tests written before implementation
(Red-Green-Refactor).

### Critical paths requiring tests

- CV conversion produces valid Markdown from PDF, DOCX, and MD inputs
- SHA256 hash: identical content → identical hash; changed content → different hash
- Re-parse fires on hash change; does NOT fire on unchanged re-save
- `parsed_profile` JSON passes schema validation before write — malformed output rejected
- Pipeline readiness gate: active only when CV saved + seniority set + location set
- Required preference fields fail validation when missing; optional fields never block save

### Test fixtures

- Sample CV in each format (PDF, DOCX, MD)
- Deliberately non-standard CV (missing sections, unusual formatting) — validates graceful partial parse
- Corrupt / scanned PDF — validates conversion failure path

---

## User Stories Summary

### US1 — First-time setup (P1)

Candidate uploads their CV, reviews and corrects the Markdown conversion, saves it, then sets
their seniority level and geographic preference. Pipeline readiness indicator becomes active.

### US2 — CV update (P2)

Candidate re-uploads a revised CV. New Markdown appears in the editor. After saving, the hash
changes, background re-parse fires, and downstream stale resume flags are set (F10.6).

### US3 — Preferences update (P3)

Candidate updates one or more preference fields. Save succeeds without affecting other fields
or triggering CV re-parse.

---

*Phase 1 Foundation Design — Proxim*
*Aligns with PRD v2.0 F1.1–F1.3*
*Author: Manav Ghosh · 2026-04-26*
