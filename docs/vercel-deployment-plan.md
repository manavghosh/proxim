# Vercel Deployment — Object-Storage Migration Plan

**Status:** Draft / sketch
**Date:** 2026-06-06
**Scope:** Decouple PDF storage from the local filesystem so the Next.js UI (Vercel)
and the Python agent (container host) can run on separate machines against a shared
Neon database.

---

## 1. Why this is needed

Today Proxim is a **two-runtime app that shares one local filesystem**:

- The **Python agent** renders resume/cover-letter PDFs to local disk
  (`settings.resume_output_dir/<slug>/<jobId>/vN/resume.pdf`).
- The **Next.js UI** reads those exact files off the same disk to preview/download them.
- Uploaded base-resume PDFs are written by the UI to `RESUME_DIR/<slug>/<file>` and
  later read by the agent to attach to outreach emails.

This works only because both processes run on one machine. Once the UI moves to
**Vercel** (serverless, read-only FS except ephemeral `/tmp`) and the agent runs in a
**separate container**, they no longer share a disk and **every PDF preview, download,
and email attachment breaks**.

> This document covers **only the object-storage migration** — the one piece with real
> code impact. The broader deployment also requires: hosting the Python daemon as a
> container (Dockerfile already exists), pointing both `DATABASE_URL`s at Neon, and
> updating OAuth redirect URIs. Those are config/topology, not code, and are out of
> scope here.

---

## 2. Current touchpoints (the exact code to change)

### Writers (produce PDFs → currently to disk)
| # | Location | What it writes |
|---|----------|----------------|
| W1 | `agent/agent/pdf_renderer.py` → `_write_pdf()` | Low-level `open(path,"wb")` for every PDF |
| W2 | `agent/agent/graphs/resume_builder.py:264-276` | Tailored **resume** path + render |
| W3 | `agent/agent/graphs/resume_builder.py:~380-403` | **Cover letter** path + render |
| W4 | `src/app/api/cv/upload-pdf/route.ts:67-90` | **Base resume** upload (`mkdir`+`writeFile`) |

### Path columns (DB currently stores local paths)
| # | Column | Set by |
|---|--------|--------|
| P1 | `resume_versions.resume_pdf_path` | `insert_resume_version` (W2) |
| P2 | `resume_versions.cover_letter_pdf_path` | `update_*` (W3) |
| P3 | `candidates.base_resume_pdf_path` | upload route (W4) |

### Readers (consume PDFs → currently from disk)
| # | Location | What it reads |
|---|----------|---------------|
| R1 | `src/app/api/jobs/[jobId]/resume/latest-pdf/route.ts` | UI preview/download (4 path candidates + `readFile`) |
| R2 | `agent/agent/daemon.py:770-801` | Base + tailored + CL PDFs for **Gmail attachments** |
| R3 | `agent/agent/graphs/resume_builder.py:~116-135,388` | Reuse prior cover-letter file across versions |
| R4 | `src/app/api/cv/upload-pdf/route.ts:81-83` | `existsSync`/`unlink` of previous upload |

---

## 3. Storage backend decision

Both runtimes (Node + Python) must **read and write** the same store.

| Option | Node SDK | Python SDK | New infra | Notes |
|--------|----------|-----------|-----------|-------|
| **Cloudflare R2 (S3-compatible)** ✅ recommended | `@aws-sdk/client-s3` | `boto3` | R2 bucket + keys | Zero egress fees, mature SDKs both sides, presigned URLs |
| AWS S3 | `@aws-sdk/client-s3` | `boto3` | S3 bucket + IAM | Same code as R2; egress costs |
| Vercel Blob | `@vercel/blob` | REST API only | Built into Vercel | Easiest on Node side; Python must hand-roll REST |
| Postgres `bytea` in Neon | Drizzle | asyncpg/psycopg | **none** | No new service; transactional; fine for small PDFs (<1 MB). Bloats DB if volume grows |

**Recommendation: Cloudflare R2** behind a thin storage abstraction so the backend is
swappable. R2 because both `boto3` and `@aws-sdk/client-s3` speak S3 natively (no
hand-rolled REST), and there are no egress fees for serving PDFs to the browser.
*If you want zero new infra for the MVP, `bytea` in Neon is a valid fallback — the
abstraction below keeps that door open.*

### Object key scheme (provider-agnostic)
```
base-resumes/<candidateId>/<filename>.pdf
resumes/<candidateId>/<jobId>/v<N>/resume.pdf
resumes/<candidateId>/<jobId>/v<N>/cover_letter.pdf
```
Store the **object key** (not a local path) in P1/P2/P3. Keys are stable and
host-independent. (Reuse the existing columns; no schema change required — just change
what goes in them.)

---

## 4. Design: a storage abstraction on each side

### Python — `agent/agent/storage.py` (new)
```python
class BlobStore(Protocol):
    def put(self, key: str, data: bytes, content_type="application/pdf") -> str: ...  # returns key
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...

# S3Store(boto3) for prod; LocalStore(filesystem) for dev/tests.
# Selected via settings.storage_backend ("s3" | "local").
```

### Node — `src/lib/storage.ts` (new)
```ts
export interface BlobStore {
  put(key: string, data: Buffer, contentType?: string): Promise<string>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
// s3Store (@aws-sdk/client-s3) for prod; localStore for dev/tests.
// Selected via process.env.STORAGE_BACKEND ("s3" | "local").
```

Keeping a `local` implementation on both sides means **dev and the existing test
suites keep working unchanged**, and the swap is a single env var.

---

## 5. Migration steps

> Order matters: introduce the abstraction with a `local` default first (no behaviour
> change, all tests green), then flip producers/consumers to keys, then switch the env
> var to `s3` in prod.

### Phase 0 — Provision (no code)
- [ ] Create R2 bucket `proxim-pdfs` (+ dev bucket `proxim-pdfs-dev`).
- [ ] Generate access key/secret; add to **both** Vercel env and the container host env:
  `STORAGE_BACKEND`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.

### Phase 1 — Abstraction layer (behaviour-preserving)
- [ ] Add `agent/agent/storage.py` with `LocalStore` + `S3Store`, default `local`.
- [ ] Add `src/lib/storage.ts` with `localStore` + `s3Store`, default `local`.
- [ ] `npm install @aws-sdk/client-s3`; `poetry add boto3`.
- [ ] Unit tests for both stores (mock S3 with `moto` / aws-sdk mock; real fs for local).
- [ ] Gate: `npm run test:run`, `npx tsc --noEmit`, `pytest` all green — **zero behaviour change**.

### Phase 2 — Writers emit keys
- [ ] **W1** `pdf_renderer.py`: change `_write_pdf` to return bytes only (it already does)
      and **not** require a disk path; callers decide where bytes go. Render-to-bytes
      via a `BytesIO` dest for `pisa.CreatePDF` instead of `open(path)`.
- [ ] **W2/W3** `resume_builder.py`: build an **object key** instead of `output_base`
      dir; call `render_resume(...) -> bytes` then `store.put(key, bytes)`; persist the
      **key** to `resume_pdf_path` / `cover_letter_pdf_path` (P1/P2).
- [ ] **W4** `cv/upload-pdf/route.ts`: replace `mkdir`/`writeFile` with `store.put(key, buf)`;
      persist **key** to `base_resume_pdf_path` (P3). Replace `unlink(prevPath)` with
      `store.delete(prevKey)` (R4).

### Phase 3 — Readers fetch by key
- [ ] **R1** `latest-pdf/route.ts`: drop the 4-candidate path probing + `readFile`;
      do `await store.get(version.resumePdfPath)` and stream the bytes. *(Optional: for
      large files, redirect to a presigned GET URL instead of proxying bytes through the
      function — avoids Vercel response-size limits.)*
- [ ] **R2** `daemon.py:770-801`: Gmail attach currently takes `{"path": ...}`. Change
      to fetch bytes via `store.get(key)` and pass bytes to `gmail_client` (update
      `gmail_client.send_email` to accept in-memory attachments, not just file paths).
- [ ] **R3** `resume_builder.py`: cover-letter reuse already reads the stored value from
      DB — once it's a key, `store.exists(key)` / pass-through works without disk.

### Phase 4 — Flip to S3 + data migration
- [ ] Set `STORAGE_BACKEND=s3` in Vercel + container envs.
- [ ] One-off migration script: for existing rows with local paths, upload the on-disk
      file to R2 under the new key scheme and rewrite the column to the key. (Skip if you
      treat existing local PDFs as disposable — they regenerate on next pipeline run.)
- [ ] Smoke test: upload base resume → run resume_builder → preview in UI → send outreach
      with attachment, all against R2.

---

## 6. gmail_client attachment change (the one ripple)

`agent/agent/gmail_client.py` `send_email(... attachments=[{"path","filename"}])` reads
files from disk. After migration the daemon has **bytes**, not paths. Change the
attachment contract to `{"bytes": ..., "filename": ...}` (or accept either). This is the
only consumer-side API change beyond swapping read calls.

- [ ] Update `gmail_client.send_email` signature + MIME-attach from bytes.
- [ ] Update its callers in `daemon.py` and any tests
      (`tests/unit/test_daemon_outreach.py`, `test_outreach_mailer_nodes.py`).

---

## 7. Verification gate (per `CLAUDE.md`)

Before any commit/PR on this work:
```bash
npm run test:run     # 0 failures
npx tsc --noEmit     # no output
npm run build        # exit 0, no prerender errors
cd agent && poetry run pytest   # agent suite green
```
Plus manual smoke: base-resume upload, tailored-resume preview, cover-letter preview,
and an outreach email with both attachments — all with `STORAGE_BACKEND=s3`.

---

## 8. Agent hosting — Fly.io

The Python agent is a **persistent always-on daemon** (3s job-dispatch loop + 3-min
outreach loop + 60-min reply/bounce loop) that runs **Chromium via Playwright**. It cannot
go on Vercel (serverless/stateless). Fly.io is the recommended host: the existing
`agent/Dockerfile` maps directly onto Fly Machines (persistent micro-VMs), billing is
per-second (~$5–11/mo at the spec below), and you can pin it to the same region as Neon.

**Why Fly over the alternatives:** ~$4 Hetzner VM is cheaper but you own all ops
(Docker, restarts, patching); Railway is the slickest DX but ~$10–20/mo; Render's
Chromium-safe worker is a flat $25/mo. Fly is the cost/effort sweet spot and needs
**zero code changes** — your Dockerfile + daemon model already fit.

### 8.1 Spec
- VM: `shared-cpu-1x`, **2 GB RAM** (Chromium needs headroom; 512 MB will OOM).
- **Always-on**, single machine, no scale-to-zero (the loops must keep polling).
- **No `[http_service]`** — the daemon receives no inbound web traffic (it's a worker).
- **No Fly volume** once PDFs go to object storage (§3–5). Until that migration lands,
  the agent still writes PDFs to local disk and would need a volume — another reason to
  do the object-storage migration first.

### 8.2 Region pinning to Neon
Set `primary_region` to the Fly region closest to your Neon project's AWS region to
minimise DB round-trip latency (the daemon is DB-chatty):

| Neon AWS region | Fly region |
|---|---|
| `us-east-1` (N. Virginia) | `iad` |
| `us-east-2` (Ohio) | `ord` |
| `us-west-2` (Oregon) | `sea` |
| `eu-central-1` (Frankfurt) | `fra` |
| `ap-southeast-1` (Singapore) | `sin` |
| `ap-south-1` (Mumbai) | `bom` |

### 8.3 `fly.toml` (place in `agent/`)
```toml
app            = "proxim-agent"
primary_region = "iad"            # ← match your Neon region (see table above)

[build]
  dockerfile = "Dockerfile"        # existing agent/Dockerfile (Playwright base image)

[vm]
  size   = "shared-cpu-1x"
  memory = "2gb"                   # Chromium headroom

# The daemon is a worker with no inbound traffic — deliberately no [http_service].
[processes]
  app = "python -m agent.daemon"   # same as the Dockerfile CMD

# Keep exactly one machine running at all times (no auto-stop for a poller).
[deploy]
  strategy = "immediate"
```

### 8.4 Deploy steps
```bash
# 1. Install + auth (one-time)
#    Windows: iwr https://fly.io/install.ps1 -useb | iex
fly auth login

# 2. From the agent/ directory, create the app WITHOUT deploying yet
cd agent
fly launch --no-deploy --dockerfile Dockerfile --name proxim-agent --region iad
#    (edit the generated fly.toml to match §8.3, or overwrite it)

# 3. Set secrets (§8.5) — these become env vars the pydantic Settings reads
fly secrets set ...   # see block below

# 4. Deploy
fly deploy

# 5. Force a single always-on machine (no scale-to-zero for a poller)
fly scale count 1

# 6. Verify the loops are polling
fly logs            # expect job-dispatch / outreach loop log lines
fly status
```

### 8.5 Secrets (`fly secrets set`)
Field names come from `agent/agent/config.py` (`pydantic-settings` upper-cases each
field). Set them as Fly secrets — never bake them into the image:

```bash
fly secrets set \
  DATABASE_URL="postgresql://...neon-POOLED-connection..." \
  ENVIRONMENT="production" \
  LLM_PROVIDER="anthropic" \
  LLM_MODEL="claude-sonnet-4-6" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  GEMINI_API_KEY="..." \
  EXA_API_KEY="..." \
  HUNTER_API_KEY="..." \
  GMAIL_CLIENT_ID="...apps.googleusercontent.com" \
  GMAIL_CLIENT_SECRET="..." \
  TRACKING_HOST="https://your-app.vercel.app" \
  STORAGE_BACKEND="s3" \
  S3_ENDPOINT="https://<accountid>.r2.cloudflarestorage.com" \
  S3_BUCKET="proxim-pdfs" \
  S3_REGION="auto" \
  S3_ACCESS_KEY_ID="..." \
  S3_SECRET_ACCESS_KEY="..."
```

| Secret | Required? | Notes / gotcha |
|---|---|---|
| `DATABASE_URL` | ✅ | **Identical to Vercel's.** Use the Neon **pooled** connection string. Single shared DB (per `CLAUDE.md`). |
| `ENVIRONMENT` | ✅ | `production` |
| `LLM_PROVIDER` / `LLM_MODEL` | ✅ | Defaults are `gemini` / `gemini-2.5-flash`; set explicitly to match Vercel |
| `ANTHROPIC_API_KEY` | ⚠️ | Required if `LLM_PROVIDER=anthropic` |
| `GEMINI_API_KEY` | ⚠️ | Required if `LLM_PROVIDER=gemini` |
| `EXA_API_KEY` | ✅ | Job discovery |
| `HUNTER_API_KEY` | ✅ | Hiring-manager email lookup |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | ✅ | OAuth refresh for outreach send. Per-candidate access/refresh tokens live in the DB, not here. |
| `TRACKING_HOST` | ✅ | **Must be the production Vercel URL** — defaults to `localhost:3000`; tracking links/pixels in emails point here |
| `STORAGE_BACKEND` + `S3_*` | ✅ (after §5) | The object-storage credentials from the migration; **same bucket as Vercel** |
| `LANGSMITH_*` / `OTEL_*` | optional | Tracing/telemetry only |
| `PROXYCURL_API_KEY` | ❌ | Legacy — Proxycurl shut down; skip |

### 8.6 Post-deploy checks
- [ ] `fly logs` shows the dispatch loop polling and no DB-connection errors.
- [ ] Trigger a `fetch_jds` run from the UI → confirm jobs appear (agent picked the queue row off shared Neon).
- [ ] Confirm a tailored-resume run writes the PDF to R2 (not local) and the UI preview loads it.
- [ ] Send a test outreach email → confirm attachment fetched from R2 and `TRACKING_HOST` links resolve to the Vercel domain.

---

## 9. Out of scope (tracked elsewhere)

- `DATABASE_URL` → Neon on both runtimes (auto-detected by `src/db/index.ts`).
- OAuth redirect/callback URIs → production Vercel domain.
- `maxDuration` tuning on LLM-bearing routes (e.g. synchronous `parseCV`).
- Replicating all API-key env vars (Anthropic, Gemini, Exa, Hunter, Proxycurl, Gmail,
  LinkedIn) into both Vercel and the container host.

---

## 10. Risk notes

- **Vercel response size:** proxying PDF bytes through a serverless function is fine for
  typical resumes (<1 MB) but presigned-URL redirect (R1 option) is safer and cheaper.
- **Dev parity:** keep `local` backend as the dev/test default so the existing suites and
  local workflow are untouched.
- **Atomicity:** a PDF write + DB key-write are now two systems. On failure, prefer
  "write blob first, then DB" so a dangling blob (harmless) is the worst case, never a DB
  row pointing at a missing object.
