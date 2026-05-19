# Design: Email Attachment Resume Choice

**Date:** 2026-05-19  
**Status:** Approved  

## Problem

Day 1 outreach emails currently always attach the AI-generated tailored resume. Some candidates want to attach their own original resume PDF instead.

## Solution

Add a global preference (`email_resume_attachment: 'tailored' | 'original'`) plus a PDF upload in Settings. The daemon reads the preference at send time and attaches the appropriate file.

---

## Section 1 — Data Model

### DB schema change
Add nullable column to `candidates`:
```sql
base_resume_pdf_path TEXT
```
Requires a Drizzle migration (`npm run db:generate` → `npm run db:migrate`).

### Preferences (no migration)
Add to `Preferences` interface in `src/types/candidate.ts`:
```typescript
email_resume_attachment?: 'tailored' | 'original'  // default: 'tailored'
```
Stored in the existing `candidates.preferences` JSONB column — no schema migration needed.

---

## Section 2 — Upload API

**Endpoint:** `POST /api/cv/upload-pdf?candidateId=...`

- Accepts `multipart/form-data` with a single `file` field
- Validates `content-type: application/pdf`
- File size cap: 10 MB
- Saves to `{resume_output_dir}/{candidate_slug}/base_resume.pdf` (overwrites any previous upload — no versioning)
- Updates `candidates.base_resume_pdf_path` in the DB
- Returns `{ path: string, filename: string }`
- Returns 400 for non-PDF or oversized files; 404 if candidate not found

**Storage location:** Same root directory as AI-generated resumes (`settings.resume_output_dir`), under the candidate's slug subfolder. This keeps all candidate files co-located and survives daemon restarts.

---

## Section 3 — Settings UI

Location: inside the existing **Email Outreach** section of the Settings page.

### Elements

**Toggle — "Resume to attach"**
- Option A (default): `Tailored AI resume` — the job-specific resume built by the AI
- Option B: `My original resume` — the PDF uploaded by the candidate
- Auto-saves on change via `PATCH /api/preferences` (same pattern as `email_outreach_mode`)

**PDF upload area** (visible only when `My original resume` is selected)
- Idle state: "No PDF uploaded yet" or filename of current upload
- A `Choose file` button opens a native file picker filtered to `.pdf`
- On file selection: immediately POSTs to `/api/cv/upload-pdf`, shows spinner
- Success state: shows filename + a "Replace" button
- Error state: inline red message (e.g. "File must be a PDF under 10 MB")

No explicit Save button — both the toggle and the upload auto-save on change, consistent with the rest of Settings.

---

## Section 4 — Daemon

**File:** `agent/agent/daemon.py` → `_outreach_send_once`

Logic added before the Day 1 attachment block:

```
attach_mode = prefs.get("email_resume_attachment", "tailored")

if Day 1 email:
    if attach_mode == "original":
        query candidates.base_resume_pdf_path for this candidate
        if path exists on disk:
            attachments = [{"path": path, "filename": "resume.pdf"}]
        else:
            log warning "original_resume_missing_fallback"
            fall through to tailored logic below
    
    if attach_mode == "tailored" (or fallback):
        existing get_resume_version_for_send logic (resume.pdf + cover_letter.pdf)
        if no resume version found → set cadence to attachment_missing, skip
```

- Days 3 and 7 are unaffected (no attachments regardless of preference)
- Fallback to tailored if `base_resume_pdf_path` is missing ensures the email sends rather than getting stuck in `attachment_missing`

---

## Files Touched

| File | Change |
|---|---|
| `src/db/schema.ts` | Add `baseResumePdfPath: text()` to candidates table |
| `migrations/sqlite/` | New Drizzle-generated SQLite migration |
| `migrations/` | New Drizzle-generated PG migration |
| `src/types/candidate.ts` | Add `email_resume_attachment` to Preferences |
| `src/app/api/cv/upload-pdf/route.ts` | New upload endpoint |
| `src/app/candidates/[id]/settings/page.tsx` | Toggle + PDF upload UI |
| `agent/agent/daemon.py` | Attachment logic in `_outreach_send_once` |
