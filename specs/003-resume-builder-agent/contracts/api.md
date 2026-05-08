# API Contracts: Resume Builder Agent (F10)

**Branch**: `003-resume-builder-agent` | **Date**: 2026-05-03

All endpoints follow the existing Proxim pattern: Next.js Route Handlers in `src/app/api/`, thin wrappers over DB reads. Python agent is triggered exclusively via `pipeline_jobs` row — no direct HTTP calls to the agent service.

---

## POST `/api/jobs/[jobId]/resume`

Trigger resume generation for an approved job. Writes a `pipeline_jobs` row; returns immediately.

**Request**

```
POST /api/jobs/:jobId/resume
Content-Type: application/json

{}   (no body required — job_id from URL, candidate_id from session)
```

**Response — 201 Created**

```json
{
  "pipelineJobId": "uuid",
  "status": "queued"
}
```

**Response — 409 Conflict**

```json
{
  "error": "A resume_builder job is already queued or running for this job",
  "pipelineJobId": "uuid",
  "status": "running"
}
```
Returns existing job ID so the client can attach and poll.

**Response — 422 Unprocessable**

```json
{
  "error": "Job must be in 'approved' status to generate resume"
}
```

**Response — 404 Not Found**

```json
{
  "error": "Job not found"
}
```

---

## GET `/api/jobs/[jobId]/resume/versions`

List all resume versions for a job, ordered newest first.

**Response — 200 OK**

```json
{
  "versions": [
    {
      "id": "uuid",
      "archetype": "Agentic Systems Architect",
      "archetypeConfidence": 0.82,
      "keywords": ["agentic AI", "LangGraph", "MCP", "..."],
      "scoreAtGeneration": 4.3,
      "baseCvHash": "sha256:abc...",
      "isStale": false,
      "isSubmitted": false,
      "generationStatus": "completed",
      "createdAt": "2026-05-03T09:15:00Z"
    }
  ],
  "currentCvHash": "sha256:abc..."
}
```

`isStale = true` when `version.baseCvHash ≠ currentCvHash`.

---

## GET `/api/jobs/[jobId]/resume/[versionId]/download`

Stream a PDF file to the browser. The `type` query param selects resume or cover letter.

**Request**

```
GET /api/jobs/:jobId/resume/:versionId/download?type=resume
GET /api/jobs/:jobId/resume/:versionId/download?type=cover-letter
```

**Response — 200 OK**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="resume_<company>_<date>.pdf"
<binary PDF stream>
```

**Response — 404 Not Found**

```json
{
  "error": "Version not found or PDF not yet generated"
}
```

---

## POST `/api/jobs/[jobId]/resume/[versionId]/submit`

Mark a version as submitted. Locks the version — future regenerations create a new version.

**Response — 200 OK**

```json
{
  "versionId": "uuid",
  "isSubmitted": true
}
```

**Response — 409 Conflict**

```json
{
  "error": "Version is already marked as submitted"
}
```

---

## Python Agent Internal — `pipeline_jobs` Payload

The Python daemon receives this payload when it picks up a `resume_builder` job:

```json
{
  "job_id": "uuid",
  "candidate_id": "uuid"
}
```

The agent reads the job record (title, company, jd_raw, archetype, archetype_confidence) and the candidate record (parsed_profile, cv_hash) from the DB to build `ResumeBuilderState`.

---

## Error Propagation

| Agent failure | DB write | UI signal |
|---|---|---|
| Keyword extraction fails after 2 retries | `resume_versions.generation_status = 'failed'`, `jobs.status = 'resume_failed'` | "Resume generation failed — retry" banner |
| PDF render error | Same | Same |
| Pydantic validation fails (factual integrity) after 2 retries | Same | Same |
| Archetype not recognised | Force Agentic Systems Architect default; no failure | Silent fallback |
