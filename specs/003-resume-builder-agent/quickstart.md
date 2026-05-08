# Quickstart: Resume Builder Agent (F10)

**Branch**: `003-resume-builder-agent` | **Date**: 2026-05-03

---

## Prerequisites

1. F9 (10D Scoring Engine) complete — jobs table must have `archetype` and `archetype_confidence` populated.
2. At least one job with `status = 'approved'` in the DB.
3. Python agent daemon running (`poetry run python -m agent.daemon`).
4. WeasyPrint system dependencies installed:
   ```bash
   # Linux / WSL
   apt-get install libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0
   # Windows — WeasyPrint auto-resolves via GTK runtime bundled in wheel
   ```
5. Aptos font placed at `agent/agent/assets/fonts/Aptos.ttf`.
6. `RESUME_OUTPUT_DIR` env var set (or defaults to `agent/output/resumes/`).

---

## Trigger Resume Generation

### Via Dashboard (UI)

1. Open `http://localhost:3000/applications`
2. Find an approved job card — click **Generate Resume**
3. The dashboard shows pipeline progress in the log pane
4. On completion, a **Download** button appears on the job card

### Via API (cURL)

```bash
# Get an approved job ID first
JOB_ID="<uuid-of-approved-job>"

# Trigger generation
curl -X POST http://localhost:3000/api/jobs/$JOB_ID/resume

# Poll until completed
curl http://localhost:3000/api/jobs/$JOB_ID/resume/versions

# Download resume PDF
VERSION_ID="<uuid-from-versions-response>"
curl -o resume.pdf \
  "http://localhost:3000/api/jobs/$JOB_ID/resume/$VERSION_ID/download?type=resume"

# Download cover letter PDF
curl -o cover_letter.pdf \
  "http://localhost:3000/api/jobs/$JOB_ID/resume/$VERSION_ID/download?type=cover-letter"
```

---

## Verify the Output

### 1. Check version record in DB

```bash
cd agent
poetry run python - <<'EOF'
import sqlite3
conn = sqlite3.connect('../proxim-dev.db')
cur = conn.cursor()
cur.execute("""
    SELECT id, archetype, generation_status, resume_pdf_path, cover_letter_pdf_path
    FROM resume_versions ORDER BY created_at DESC LIMIT 3
""")
for row in cur.fetchall():
    print(row)
EOF
```

### 2. Verify PDF text extractability (ATS check)

```bash
pip install pdfplumber
poetry run python - <<'EOF'
import pdfplumber
with pdfplumber.open("path/to/resume.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(f"Page {page.page_number}: {len(text)} chars extracted")
        assert text, "Empty text — ATS extraction will fail!"
print("ATS extraction: PASS")
EOF
```

### 3. Verify keyword injection

```bash
poetry run python - <<'EOF'
import sqlite3, json
conn = sqlite3.connect('../proxim-dev.db')
cur = conn.cursor()
cur.execute("SELECT keywords, resume_pdf_path FROM resume_versions ORDER BY created_at DESC LIMIT 1")
row = cur.fetchone()
keywords = json.loads(row[0])
print(f"Keywords to check ({len(keywords)}): {keywords}")

import pdfplumber
with pdfplumber.open(row[1]) as pdf:
    full_text = " ".join(p.extract_text() or "" for p in pdf.pages).lower()

found = [kw for kw in keywords if kw.lower() in full_text]
print(f"Keywords found in PDF: {len(found)}/{len(keywords)}")
assert len(found) >= 15, f"Fewer than 15 keywords in PDF: {len(found)}"
print("Keyword injection: PASS")
EOF
```

### 4. Run unit tests

```bash
cd agent
poetry run pytest tests/unit/test_resume_engine.py -v
poetry run pytest tests/unit/test_archetype_registry.py -v
poetry run pytest tests/unit/test_pdf_renderer.py -v
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RESUME_OUTPUT_DIR` | `agent/output/resumes/` | Directory where PDF files are stored |
| `LLM_PROVIDER` | `anthropic` | LLM provider for resume generation |
| `LLM_MODEL` | `claude-sonnet-4-6` | Model used for keyword extraction, personalisation, cover letter |
| `DATABASE_URL` | `../proxim-dev.db` | SQLite (dev) or Neon PostgreSQL URL |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `resume_failed` status | Pydantic validation failed after 2 retries | Check `pipeline_logs` for LLM output; adjust prompt if factual field mismatch |
| Empty PDF / blank pages | WeasyPrint Pango/Cairo not installed | Install system packages (see Prerequisites) |
| Font renders as fallback | Aptos.ttf not found at `file://` URL | Verify `agent/agent/assets/fonts/Aptos.ttf` exists; check absolute path in `pdf_renderer.py` |
| < 15 keywords in PDF | LLM returned fewer keywords | KeywordSet validator triggers retry; check `pipeline_logs` for `keyword_extraction` step |
| Version not created for approved job | Daemon not running | Start daemon: `poetry run python -m agent.daemon` |
