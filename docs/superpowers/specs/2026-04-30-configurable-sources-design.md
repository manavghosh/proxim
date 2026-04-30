# Configurable Job Sources & Custom Domains — Design Spec

**Date:** 2026-04-30
**Status:** Approved
**Scope:** Add job source toggles + custom site URLs to Settings; add free-text custom domains to Preferences

---

## 1. Goal

Give the candidate full control over which job boards are scraped and which domains are targeted, directly from the Settings page. No code changes required to add a new source or domain.

---

## 2. Changes

### 2.1 Preferences Type (`src/types/candidate.ts`)

Add two new optional fields:

```typescript
enabled_sources?: string[]   // named scrapers to run; empty = run all
custom_job_sites?: string[]  // additional careers page URLs to scrape
```

`preferred_domains` is unchanged — it continues to hold both predefined chip selections and free-text custom domain entries in the same array.

### 2.2 DB Schema (`src/db/schema.ts`)

No migration required. Both fields are stored in the existing `preferences` JSONB column.

---

## 3. Settings UI — Job Sources Section

**Location:** New section in the Preferences panel (`src/components/preferences/PreferencesForm.tsx`), positioned above the Save button.

**Predefined source toggle buttons** (same style as Company Stage chips):

| Button label | Internal value |
|---|---|
| Naukri | `naukri` |
| iimjobs | `iimjobs` |
| LinkedIn | `linkedin` |
| Monster | `monster` |

Toggle behaviour: clicking a selected source deselects it; clicking an unselected source selects it. Uses the existing `toggleMulti` pattern.

**Custom job sites textarea:**
- Label: "Additional job sites (one URL per line, optional)"
- Placeholder: `https://jobs.acmecorp.com/careers`
- Same raw-state pattern as Target Companies — no trimming/filtering on keystroke
- Parsed on save: `split('\n').map(trim).filter(Boolean)`
- Stored in `preferences.custom_job_sites`

**Default behaviour:** If `enabled_sources` is empty (not set or `[]`), the pipeline runs all scrapers. This preserves backward compatibility for existing saved preferences.

---

## 4. Settings UI — Preferred Domains Enhancement

**Location:** Same `PreferencesForm.tsx`, below the existing domain chip buttons.

**Addition:** A textarea for custom domains:
- Label: "Additional domains (one per line, optional)"
- Placeholder: `FinTech\nAI Research\nClimate Tech`
- Raw state variable `customDomainsText` — same pattern as Target Companies and seniority levels
- Initialised from: values in `preferences.preferred_domains` that are NOT in the predefined `DOMAIN_OPTIONS` list
- On save: merge chip selections + parsed textarea lines into one `preferred_domains` array (deduplicated)

No new type field. No DB change.

---

## 5. Python Agent (`agent/agent/graphs/discovery.py`)

**`fan_out` update:**

```python
def fan_out(state: DiscoveryState) -> list[Send]:
    enabled = state.preferences.get("enabled_sources", [])
    all_sources = ["naukri", "iimjobs", "linkedin"]
    active = enabled if enabled else all_sources

    sends = [Send(f"scrape_{s}", state) for s in active if s in all_sources]

    # Custom job sites → careers_page scraper
    custom_sites = state.preferences.get("custom_job_sites", [])
    if custom_sites:
        sends.append(Send("scrape_careers_page", state))

    # Monster — new scraper (stub for now, graceful skip)
    if "monster" in active:
        sends.append(Send("scrape_monster", state))

    return sends
```

**Monster scraper:** A stub `scrape_monster` node is added that logs a warning and returns `[]` until a real Monster scraper is implemented. This allows the UI to offer the toggle without crashing the pipeline.

**`CareersPageScraper`** reads `preferences.custom_job_sites` (already done via `preferences.target_companies_with_urls` pattern — update key to `custom_job_sites`).

---

## 6. Files Changed

```
src/
  types/candidate.ts               ← +enabled_sources, +custom_job_sites fields
  db/schema.ts                     ← no change (JSONB absorbs new fields)
  components/preferences/
    PreferencesForm.tsx             ← +source toggles, +custom sites textarea,
                                       +custom domains textarea
  __tests__/lib/
    preferences-helpers.test.ts    ← update if helper used for domain merge
    readiness-service.test.ts      ← no change (readiness ignores new fields)

agent/
  agent/graphs/discovery.py        ← fan_out reads enabled_sources + custom_job_sites
  agent/scrapers/monster.py        ← new stub scraper (returns [], logs warning)
```

---

## 7. Out of Scope

- Implementing a real Monster.com scraper (stub only)
- Reordering or hiding predefined domain chips
- Per-source scheduling or rate-limit configuration

---

## 8. Success Criteria

- Toggling off Naukri and running the pipeline produces no Naukri scrape log
- Adding a custom job site URL results in a `scrape_complete source=careers_page` log entry
- Custom domains entered in the textarea are saved and reloaded correctly on next visit
- Selecting Monster logs a warning but does not crash the pipeline
- All existing preferences (seniority, geography, company stage, domains) continue to work unchanged
- `npx tsc --noEmit` zero errors; all existing tests pass
