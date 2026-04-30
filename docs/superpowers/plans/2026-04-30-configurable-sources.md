# Configurable Job Sources & Custom Domains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the candidate choose which job boards to scrape and add custom domains from the Settings UI, persisted in the existing JSONB preferences column.

**Architecture:** Add two new optional fields to `Preferences` type and DB schema type. Extend `PreferencesForm` with source toggle buttons + two textareas (custom job sites, custom domains) using the existing raw-state and `toggleMulti` patterns. Update the Python `fan_out` node to read `enabled_sources` and `custom_job_sites` from preferences. Add a Monster stub scraper node.

**Tech Stack:** Next.js 15 / React 19 / TypeScript 5 / Tailwind v4 / Vitest — Python LangGraph agent

---

## Spec Reference

`docs/superpowers/specs/2026-04-30-configurable-sources-design.md`

---

## File Map

```
src/
  types/candidate.ts                    ← Task 1: +enabled_sources, +custom_job_sites
  db/schema.ts                          ← Task 1: mirror type change
  components/preferences/
    PreferencesForm.tsx                 ← Tasks 2 & 3: source toggles + textareas

agent/
  agent/scrapers/monster.py             ← Task 4: stub scraper
  agent/graphs/discovery.py             ← Task 5: fan_out + monster node + graph wiring
```

---

## Task 1: Type changes

**Files:**
- Modify: `src/types/candidate.ts`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add fields to `src/types/candidate.ts`**

In the `Preferences` interface, add two new optional fields after `preferred_domains`:

```typescript
export interface Preferences {
  seniority_levels?: string[]
  geographic_preference?: string[]
  company_stages?: string[]
  compensation_band?: { min: number; max: number; currency: string }
  target_companies?: string[]
  preferred_domains?: string[]
  enabled_sources?: string[]   // named scrapers to run; empty = run all
  custom_job_sites?: string[]  // additional careers page URLs to scrape
}
```

- [ ] **Step 2: Mirror in `src/db/schema.ts`**

In the `Preferences` type (around line 24), add the same two fields:

```typescript
type Preferences = {
  seniority_levels?: string[]
  geographic_preference?: string[]
  company_stages?: string[]
  compensation_band?: { min: number; max: number; currency: string }
  target_companies?: string[]
  preferred_domains?: string[]
  enabled_sources?: string[]
  custom_job_sites?: string[]
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/candidate.ts src/db/schema.ts
git commit -m "feat: add enabled_sources and custom_job_sites to Preferences type"
```

---

## Task 2: PreferencesForm — Job Sources section

**Files:**
- Modify: `src/components/preferences/PreferencesForm.tsx`

- [ ] **Step 1: Add SOURCE_OPTIONS constant and raw state**

At the top of `PreferencesForm.tsx`, add the constant after the existing `DOMAIN_OPTIONS` line:

```typescript
const SOURCE_OPTIONS = [
  { label: 'Naukri', value: 'naukri' },
  { label: 'iimjobs', value: 'iimjobs' },
  { label: 'LinkedIn', value: 'linkedin' },
  { label: 'Monster', value: 'monster' },
]
```

Inside the component, add after the `targetCompaniesText` state:

```typescript
const [customJobSitesText, setCustomJobSitesText] = useState(
  (initialPreferences.custom_job_sites ?? []).join('\n')
)
```

- [ ] **Step 2: Wire custom_job_sites into handleSave**

In `handleSave`, after the `parsedCompanies` variable, add:

```typescript
const parsedCustomSites = customJobSitesText
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
```

Update the `updatePreferences` call to include both new fields:

```typescript
const { preferences } = await updatePreferences({
  ...prefs,
  seniority_levels: parsed,
  target_companies: parsedCompanies,
  custom_job_sites: parsedCustomSites,
})
```

(`enabled_sources` is already in `prefs` via `toggleMulti` — no extra handling needed.)

- [ ] **Step 3: Add Job Sources section to the JSX**

Add this section after the Target Companies textarea block and before the Preferred Domains fieldset:

```tsx
{/* Job Sources — optional */}
<fieldset className="space-y-2">
  <Label>
    Job Sources{' '}
    <span className="text-muted-foreground font-normal">(optional — all run if none selected)</span>
  </Label>
  <div className="flex flex-wrap gap-2">
    {SOURCE_OPTIONS.map((opt) => (
      <Button
        key={opt.value}
        type="button"
        size="sm"
        variant={prefs.enabled_sources?.includes(opt.value) ? 'default' : 'outline'}
        onClick={() => toggleMulti('enabled_sources', opt.value)}
      >
        {opt.label}
      </Button>
    ))}
  </div>
</fieldset>

{/* Custom job sites — optional */}
<div className="space-y-2">
  <Label>
    Additional Job Sites{' '}
    <span className="text-muted-foreground font-normal">(optional — one URL per line)</span>
  </Label>
  <Textarea
    rows={3}
    placeholder={'https://jobs.acmecorp.com/careers\nhttps://careers.example.in'}
    value={customJobSitesText}
    onChange={(e) => setCustomJobSitesText(e.target.value)}
  />
</div>
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Run tests**

```bash
npm run test:run
```

Expected: all 50 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/preferences/PreferencesForm.tsx
git commit -m "feat: add job source toggles and custom job sites textarea to PreferencesForm"
```

---

## Task 3: PreferencesForm — Custom Domains textarea

**Files:**
- Modify: `src/components/preferences/PreferencesForm.tsx`

- [ ] **Step 1: Add customDomainsText raw state**

Inside the component, add after `customJobSitesText` state:

```typescript
const [customDomainsText, setCustomDomainsText] = useState(
  (initialPreferences.preferred_domains ?? [])
    .filter((d) => !DOMAIN_OPTIONS.includes(d))
    .join('\n')
)
```

This initialises the textarea with any saved domain values that aren't one of the predefined chips (e.g. "FinTech", "Climate Tech").

- [ ] **Step 2: Wire custom domains into handleSave**

In `handleSave`, after `parsedCustomSites`, add:

```typescript
const parsedCustomDomains = customDomainsText
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)

// Merge chip selections (predefined only) with custom text entries
const mergedDomains = [
  ...(prefs.preferred_domains?.filter((d) => DOMAIN_OPTIONS.includes(d)) ?? []),
  ...parsedCustomDomains,
]
```

Update the `updatePreferences` call to include `preferred_domains`:

```typescript
const { preferences } = await updatePreferences({
  ...prefs,
  seniority_levels: parsed,
  target_companies: parsedCompanies,
  custom_job_sites: parsedCustomSites,
  preferred_domains: mergedDomains,
})
```

- [ ] **Step 3: Add custom domains textarea to JSX**

Add this immediately after the closing `</div>` of the domain chip buttons `<div className="flex flex-wrap gap-2">`, still inside the Preferred Domains `<fieldset>`:

```tsx
{/* Preferred Domains fieldset — updated */}
<fieldset className="space-y-2">
  <Label>
    Preferred Domains{' '}
    <span className="text-muted-foreground font-normal">(optional)</span>
  </Label>
  <div className="flex flex-wrap gap-2">
    {DOMAIN_OPTIONS.map((opt) => (
      <Button
        key={opt}
        type="button"
        size="sm"
        variant={prefs.preferred_domains?.includes(opt) ? 'default' : 'outline'}
        onClick={() => toggleMulti('preferred_domains', opt)}
      >
        {opt}
      </Button>
    ))}
  </div>
  <Textarea
    rows={3}
    placeholder={'FinTech\nClimate Tech\nAI Research'}
    value={customDomainsText}
    onChange={(e) => setCustomDomainsText(e.target.value)}
  />
</fieldset>
```

Replace the existing Preferred Domains fieldset entirely with the above.

- [ ] **Step 4: TypeScript check + tests**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: zero errors, all 50 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/preferences/PreferencesForm.tsx
git commit -m "feat: add custom domains free-text area to Preferred Domains section"
```

---

## Task 4: Monster stub scraper

**Files:**
- Create: `agent/agent/scrapers/monster.py`

- [ ] **Step 1: Create the stub**

Create `agent/agent/scrapers/monster.py`:

```python
"""Monster.com job scraper — stub implementation."""
import structlog
from agent.scrapers.base import AbstractScraper
from agent.models import RawJob

logger = structlog.get_logger()


class MonsterScraper(AbstractScraper):
    source_name = "monster"

    async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
        logger.warning(
            "monster_scraper_not_implemented",
            message="Monster scraper is a stub — returns no results. Implement monster.py to enable.",
        )
        return []
```

- [ ] **Step 2: Commit**

```bash
git add agent/agent/scrapers/monster.py
git commit -m "feat: add Monster stub scraper (logs warning, returns empty list)"
```

---

## Task 5: Python fan_out — read enabled_sources and custom_job_sites

**Files:**
- Modify: `agent/agent/graphs/discovery.py`

- [ ] **Step 1: Update fan_out to read enabled_sources**

Replace the current `fan_out` function in `agent/agent/graphs/discovery.py`:

```python
def fan_out(state: DiscoveryState) -> list[Send]:
    """Dispatch scraper nodes based on enabled_sources preference.

    If enabled_sources is empty or not set, all standard sources run.
    Monster is only dispatched if explicitly enabled (stub returns []).
    Custom job site URLs are routed to the careers_page scraper.
    """
    enabled: list[str] = state.preferences.get("enabled_sources", [])
    standard_sources = ["naukri", "iimjobs", "linkedin"]
    active = enabled if enabled else standard_sources

    sends: list[Send] = []

    for source in active:
        if source in standard_sources:
            sends.append(Send(f"scrape_{source}", state))
        elif source == "monster":
            sends.append(Send("scrape_monster", state))

    # Custom job site URLs → careers_page scraper
    custom_sites: list[str] = state.preferences.get("custom_job_sites", [])
    if custom_sites:
        sends.append(Send("scrape_careers_page", state))

    return sends
```

- [ ] **Step 2: Add scrape_monster node**

Add this function after `scrape_careers_page` in `discovery.py`:

```python
async def scrape_monster(state: DiscoveryState) -> dict:
    from agent.scrapers.monster import MonsterScraper
    scraper = MonsterScraper()
    queries = state.queries.get("naukri", [])[:3]
    jobs = await scraper.safe_scrape(queries, state.preferences)
    logger.info("scrape_complete", source="monster", jobs_found=len(jobs))
    return {"raw_jobs": jobs}
```

- [ ] **Step 3: Register monster node in build_discovery_graph()**

In `build_discovery_graph()`, add the monster node after `scrape_careers_page`:

```python
graph.add_node("scrape_monster", scrape_monster)
```

Add its edge after the careers_page edge:

```python
graph.add_edge("scrape_monster", "normalise_and_dedup")
```

- [ ] **Step 4: Update CareersPageScraper to read custom_job_sites**

In `agent/agent/scrapers/careers_page.py`, the `scrape()` method currently reads `preferences.get("target_companies_with_urls", [])`. Update it to also check `custom_job_sites`:

```python
async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]:  # noqa: ARG002
    # Support both legacy key and new custom_job_sites key
    target_companies: list = preferences.get("custom_job_sites", []) or preferences.get("target_companies_with_urls", [])
    jobs: list[RawJob] = []
    # ... rest of implementation unchanged
```

- [ ] **Step 5: Run Next.js tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent/agent/graphs/discovery.py agent/agent/scrapers/careers_page.py
git commit -m "feat: fan_out reads enabled_sources + custom_job_sites; add Monster node"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full Next.js test suite**

```bash
npm run test:run
```

Expected: all 50 tests pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: clean build, all pages static/dynamic as before.

- [ ] **Step 4: Manual smoke test**

Start `npm run dev`, open `http://localhost:3000/settings`.

Verify in the Preferences panel:
- "Job Sources" section shows 4 toggle buttons: Naukri, iimjobs, LinkedIn, Monster
- "Additional Job Sites" textarea accepts URLs
- Preferred Domains chips still work; new textarea below accepts custom domains
- Clicking Save Preferences succeeds (check Network tab — 200 response)
- Reload page — all selections and text persisted correctly

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: configurable job sources + custom domains complete"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `enabled_sources?: string[]` in Preferences | Task 1 |
| `custom_job_sites?: string[]` in Preferences | Task 1 |
| DB schema type updated | Task 1 |
| Source toggle buttons (Naukri, iimjobs, LinkedIn, Monster) | Task 2 |
| Empty `enabled_sources` = run all (backward compatible) | Task 5 |
| Custom job sites textarea, raw state, saved on submit | Task 2 |
| Custom domains textarea below domain chips | Task 3 |
| Custom domains merged with chip selections on save | Task 3 |
| Monster stub scraper — logs warning, returns [] | Task 4 |
| `fan_out` reads `enabled_sources` | Task 5 |
| `fan_out` routes `custom_job_sites` to careers_page | Task 5 |
| TypeScript zero errors | Tasks 1, 2, 3, 6 |
| All existing tests pass | Tasks 2, 3, 6 |

**No gaps found.**

**Type consistency:** `enabled_sources` and `custom_job_sites` used consistently as `string[]` throughout. `toggleMulti('enabled_sources', opt.value)` matches the `keyof Preferences` signature since `enabled_sources` is `string[]`.

**Placeholder scan:** No TBDs or "implement later" present.
