# Single-VPS Deployment (Docker Compose + Caddy)

Run all of Proxim — the Next.js UI **and** the Python agent — on one Linux VPS.
Because both runtimes live on the same machine, they share one disk, so the
object-storage migration in `../vercel-deployment-plan.md` is **not needed** here.

Files in this folder:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | The 3-service stack: `caddy` (TLS proxy) → `web` (Next.js) + `agent` (Python daemon) |
| `Dockerfile.web` | Production image for the Next.js UI (`next start`) |
| `Caddyfile` | Reverse-proxy + automatic HTTPS config |
| `.env.example` | Copy to `.env` and fill in |

> A `.dockerignore` was added at the **repo root** (required so the web image
> build context stays small and secret-free).

---

## What is Caddy, and why do I need it?

**Caddy is a small web server / reverse proxy** that sits in front of the app and
does three jobs you'd otherwise have to wire up yourself:

1. **HTTPS automatically.** Caddy obtains and auto-renews a free Let's Encrypt
   TLS certificate for your domain. No certbot, no cron, no manual renewals.
2. **Public entrypoint on ports 80/443.** Browsers expect `https://yourdomain`
   on port 443. The Next.js app only listens on internal port 3000; Caddy
   accepts public traffic and forwards it to `web:3000` on the private Docker
   network. The app port is never exposed to the internet directly.
3. **HTTP→HTTPS redirect + gzip/zstd compression**, out of the box.

**Why you specifically need it for Proxim:** two features break without a real
`https://` domain — (a) **Gmail OAuth** redirect URIs must be HTTPS, and
(b) **email open/click tracking** pixels/links use `TRACKING_HOST`, which must be
a public URL, not `localhost`. Caddy is the simplest way to get a trusted
certificate for that domain.

**Do you have to use Caddy?** No — it's just the least-effort option. nginx +
certbot or a cloud load balancer work too. If you only ever browse over the raw
IP and don't send outreach email, you could skip TLS entirely — but then OAuth
and tracking won't work. For this app, keep Caddy.

---

## Prerequisites

- A Linux VPS (Ubuntu 22.04+ recommended) with **≥ 2 GB RAM** (4 GB comfortable).
  The agent runs Chromium via Playwright — **512 MB will OOM.**
- **Docker Engine + Compose plugin** installed (`docker --version`, `docker compose version`).
- A **domain name** with a DNS **A record** pointing at the VPS's public IP.
- Inbound ports **80** and **443** open in the VPS firewall/security group.

---

## 1. Get the code and configure

```bash
git clone <your-repo-url> proxim && cd proxim
cd docs/vps
cp .env.example .env
nano .env          # set DOMAIN, ACME_EMAIL, API keys, TRACKING_HOST=https://<DOMAIN>
```

Keep `DATABASE_URL=/data/proxim.db` for the self-contained SQLite setup (default),
or point it at a Neon Postgres URL — see [Database options](#database-options).

---

## 2. Bootstrap the database (one time)

The `web` and `agent` containers share a Docker volume (`proxim_data`) mounted at
`/data`. The SQLite DB lives at `/data/proxim.db`.

**Option A — seed from your existing local DB (recommended if you have one):**

```bash
# Create the volume and copy your populated proxim-dev.db into it as proxim.db.
docker volume create vps_proxim_data 2>/dev/null || true
# (compose names the volume <project>_proxim_data; the project defaults to the
#  folder name "vps". Adjust if you set a different -p/COMPOSE_PROJECT_NAME.)
docker run --rm -v vps_proxim_data:/data -v "$(pwd)/../../":/repo alpine \
  sh -c "cp /repo/proxim-dev.db /data/proxim.db"
```

**Option B — fresh database from migrations:**

```bash
# Apply the SQLite migrations (in ../../migrations/sqlite) to a local file,
# then seed it into the volume exactly as in Option A.
cd ../..                       # repo root
DATABASE_URL=./proxim-dev.db npm ci && DATABASE_URL=./proxim-dev.db npm run db:migrate:sqlite
cd docs/vps
docker run --rm -v vps_proxim_data:/data -v "$(pwd)/../../":/repo alpine \
  sh -c "cp /repo/proxim-dev.db /data/proxim.db"
```

> Using **Neon** instead? Skip this step entirely — the schema lives in Neon and
> both runtimes connect over the network.

---

## 3. Build and start

```bash
cd docs/vps
docker compose up -d --build
docker compose ps
docker compose logs -f agent   # expect the dispatch loop polling, no DB errors
docker compose logs -f caddy   # expect a certificate to be obtained for $DOMAIN
```

Visit `https://<DOMAIN>` — the UI should load over HTTPS.

---

## 4. Gmail OAuth (for outreach sending)

In Google Cloud Console → your OAuth client, add the **authorized redirect URI**
for your production domain (the same callback path you use locally, but on
`https://<DOMAIN>`). Then connect each candidate's Gmail from the app's settings
as usual. Per-candidate tokens are stored in the DB, not in env.

---

## Database options

The Node DB layer (`src/db/index.ts`) auto-detects the driver from `DATABASE_URL`:

| `DATABASE_URL` | Driver | Use on a VPS? |
|---|---|---|
| a file path, e.g. `/data/proxim.db` | `better-sqlite3` (WAL, `busy_timeout=5000`) | ✅ default — self-contained |
| `postgresql://…` | **Neon HTTP** serverless driver | ✅ managed Postgres (Neon only) |
| `postgresql://…` to a self-hosted Postgres | ❌ | not supported without a code change (the driver speaks Neon's HTTP API, not generic TCP) |

SQLite handles the two-process (web + agent) access via WAL + a 5 s busy-timeout,
which is fine for personal/low-concurrency use. If you expect heavier concurrent
writes, use **Neon**: set `DATABASE_URL=postgresql://…` in `.env` and
**rebuild the web image** (`docker compose up -d --build web`) — the driver is
selected at build time.

---

## How the shared disk works (why it "just works" here)

The DB stores **absolute** file paths:

- `web` writes uploaded base resumes to `/data/base-resumes/<slug>/…` and the
  agent reads them for email attachments.
- `agent` writes tailored resumes/cover letters to `/data/output/resumes/…` and
  the UI reads them for preview/download.

Both containers mount the **same volume at the same path (`/data`)**, so every
absolute path resolves identically on both sides. That's the whole reason a
single VPS avoids the object-storage migration that a Vercel+Fly split requires.

---

## Operations

```bash
# Update to latest code
git pull && docker compose up -d --build

# Tail logs
docker compose logs -f web
docker compose logs -f agent

# Restart one service
docker compose restart agent

# Stop everything (data volume is preserved)
docker compose down

# Back up the SQLite DB
docker run --rm -v vps_proxim_data:/data -v "$(pwd)":/backup alpine \
  sh -c "cp /data/proxim.db /backup/proxim-backup-$(date +%F).db"
```

---

## Troubleshooting

- **Caddy can't get a certificate:** confirm the DNS A record points at the VPS
  and ports 80/443 are open; `docker compose logs caddy`.
- **Agent OOM / Chromium crashes:** the box is under ~2 GB RAM. Resize, or set a
  swap file; optionally cap with `mem_limit` in `docker-compose.yml`.
- **UI loads but PDFs 404:** the DB has paths from a different machine. Either
  regenerate (re-run the resume builder) or ensure you seeded the DB whose paths
  match `/data/...` (fresh runs always write under `/data`).
- **`database is locked`:** transient under heavy concurrent writes on SQLite —
  switch to Neon if persistent.
- **Wrong DB driver bundled:** the web image bakes the driver at build time from
  `DATABASE_URL`; after changing it between SQLite and Neon, rebuild with
  `docker compose up -d --build web`.
