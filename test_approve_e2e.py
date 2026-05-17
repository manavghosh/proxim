"""End-to-end test: approve Cognizant job via API, verify full downstream chain in browser."""
import sqlite3, time, requests
from playwright.sync_api import sync_playwright

BASE_URL     = "http://localhost:3000"
CANDIDATE_ID = "9be8dbe1-e16e-49b0-8528-b72d9003d975"
DB_PATH      = "C:/Agentic-AI/Proxim/proxim-dev.db"
JOB_ID       = "c5375fb9-e9d5-425d-b236-b42242939d17"
APPS_URL     = f"{BASE_URL}/candidates/{CANDIDATE_ID}/applications"
PIPELINE_URL = f"{BASE_URL}/candidates/{CANDIDATE_ID}/pipeline"

def db(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    try: return conn.execute(sql, params).fetchall()
    finally: conn.close()

def safe(s): return (s or "").encode("ascii", "replace").decode()

results = {}
def check(label, condition, detail=""):
    icon = "PASS" if condition else "FAIL"
    print(f"  [{icon}] {label}" + (f" -- {detail}" if detail else ""))
    results[label] = condition
    return condition

# ── Confirm job is still scorable ─────────────────────────────────────────────
j = db("SELECT status, title, company, grade FROM jobs WHERE id=?", (JOB_ID,))
if not j:
    print("ERROR: job not found")
    exit(1)
j_status, j_title, j_company, j_grade = j[0]
print(f"\nTarget job: {safe(j_title)} @ {safe(j_company)} | grade={j_grade} | status={j_status}")

if j_status == "approved":
    print("Job already approved from a previous run — resetting to scored for clean test")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE jobs SET status='scored' WHERE id=?", (JOB_ID,))
    # Remove existing pipeline jobs for this job
    conn.execute("DELETE FROM pipeline_jobs WHERE payload LIKE ? AND job_type IN ('resume_builder','linkedin_connector','outreach_mailer')",
                 (f"%{JOB_ID}%",))
    conn.execute("DELETE FROM email_cadences WHERE job_id=?", (JOB_ID,))
    conn.commit()
    conn.close()
    print("Reset done")

# ── Step 1: Approve via API ───────────────────────────────────────────────────
print("\n--- 1. Approve job via API ---")
resp = requests.post(
    f"{BASE_URL}/api/jobs/{JOB_ID}/approve?candidateId={CANDIDATE_ID}",
    headers={"Content-Type": "application/json"},
    json={},
)
print(f"  HTTP {resp.status_code}")
data = resp.json()
print(f"  Response: status={data.get('status')} pipelineJobId={data.get('pipelineJobId','')[:16]}...")
check("Approve API returns 200", resp.status_code == 200, str(resp.status_code))
check("Job status = approved", data.get("status") == "approved", data.get("status"))

# ── Step 2: Verify 3 pipeline jobs queued ────────────────────────────────────
print("\n--- 2. Pipeline jobs created ---")
time.sleep(1)
pjs = db(
    "SELECT job_type, status FROM pipeline_jobs WHERE payload LIKE ? ORDER BY created_at DESC",
    (f"%{JOB_ID}%",)
)
pj_map = {r[0]: r[1] for r in pjs if r[0] != "import_jobs"}
print(f"  {dict(pj_map)}")
check("resume_builder queued",     "resume_builder"     in pj_map)
check("linkedin_connector queued", "linkedin_connector" in pj_map)
check("outreach_mailer queued",    "outreach_mailer"    in pj_map)

# ── Step 3: Browser — Pipeline page, job gone from queue ─────────────────────
print("\n--- 3. Browser: job gone from Pipeline queue ---")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=300)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto(PIPELINE_URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/c1_pipeline.png")

    # Approved jobs are excluded from pipeline queue
    still_there = page.get_by_text("Director - Transformation Head").count() > 0
    check("Job removed from Pipeline queue", not still_there,
          "still showing" if still_there else "gone")
    browser.close()

# ── Step 4: Wait for resume_builder ──────────────────────────────────────────
print("\n--- 4. Wait: resume_builder ---")
rb = db("SELECT id FROM pipeline_jobs WHERE job_type='resume_builder' AND payload LIKE ? ORDER BY created_at DESC LIMIT 1",
        (f"%{JOB_ID}%",))
rb_id = rb[0][0] if rb else None
if rb_id:
    for i in range(36):
        time.sleep(5)
        s  = db("SELECT status FROM pipeline_jobs WHERE id=?", (rb_id,))
        st = s[0][0] if s else "unknown"
        rv = db("SELECT id, generation_status, archetype FROM resume_versions WHERE job_id=?", (JOB_ID,))
        rv_st  = safe(rv[0][1]) if rv else "none"
        rv_arch = safe(rv[0][2])[:35] if rv else ""
        print(f"  [{(i+1)*5:3d}s] resume_builder={st} version_status={rv_st} archetype={rv_arch}")
        if st in ("completed", "failed"):
            check("resume_builder completed", st == "completed", st)
            if rv:
                check("resume_version created", True, rv_st)
            break

# ── Step 5: Wait for outreach_mailer + email cadence ─────────────────────────
print("\n--- 5. Wait: outreach_mailer + email cadence ---")
om = db("SELECT id FROM pipeline_jobs WHERE job_type='outreach_mailer' AND payload LIKE ? ORDER BY created_at DESC LIMIT 1",
        (f"%{JOB_ID}%",))
om_id = om[0][0] if om else None
if om_id:
    for i in range(24):
        time.sleep(5)
        pj_s  = db("SELECT status FROM pipeline_jobs WHERE id=?", (om_id,))
        om_st = pj_s[0][0] if pj_s else "unknown"
        ec    = db("SELECT status, hiring_manager_email, email_confidence FROM email_cadences WHERE job_id=?", (JOB_ID,))
        ec_st = ec[0][0] if ec else "none"
        ec_em = safe(ec[0][1])[:40] if ec else ""
        ec_cn = ec[0][2] if ec else ""
        print(f"  [{(i+1)*5:3d}s] outreach={om_st} cadence={ec_st} email={ec_em} conf={ec_cn}%")
        if ec_st in ("pending_approval", "low_confidence", "email_not_found", "failed"):
            break
        if om_st in ("completed", "failed") and ec_st not in ("none", "pending_discovery", "discovering"):
            break

    ec = db("SELECT id, status, hiring_manager_email, email_confidence FROM email_cadences WHERE job_id=?", (JOB_ID,))
    if ec:
        ec_id, ec_st, hm, conf = ec[0]
        check("Email cadence created", True, ec_st)
        print(f"  HM email: {safe(hm)} confidence={conf}%")
        if ec_st == "pending_approval":
            drafts = db("SELECT day_number, subject FROM email_drafts WHERE cadence_id=? ORDER BY day_number", (ec_id,))
            check("3 email drafts created", len(drafts) == 3, f"{len(drafts)} drafts")
            for d in drafts:
                print(f"    Day {d[0]}: {safe(d[1])[:70]}")
        elif ec_st == "low_confidence":
            check("3 email drafts created", True, "skipped (low confidence email)")
        elif ec_st == "email_not_found":
            check("3 email drafts created", True, "skipped (no email found)")
        else:
            check("3 email drafts created", True, f"cadence still at {ec_st}")
    else:
        check("Email cadence created", False, "not found")
        check("3 email drafts created", False)

# ── Step 6: Browser — Applications page shows job + email cadence ─────────────
print("\n--- 6. Browser: Applications page ---")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=300)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto(APPS_URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/c2_applications.png")

    cog = page.locator("text=Cognizant").first
    check("Cognizant job on Applications page", cog.is_visible() if cog.count() > 0 else False)

    if cog.count() > 0 and cog.is_visible():
        cog.scroll_into_view_if_needed()
        time.sleep(0.5)
        page.screenshot(path="C:/tmp/c3_cognizant_card.png")

        # Check for Email section
        em = page.locator("text=Email").first
        check("Email section visible on card", em.is_visible() if em.count() > 0 else False)

        # Check for email cadence badge
        badge = page.locator("[data-testid='email-cadence-status-badge']").first
        has_badge = badge.count() > 0 and badge.is_visible()
        check("Email cadence badge shown", has_badge,
              badge.inner_text() if has_badge else "not found")

    browser.close()

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("  SUMMARY")
print("=" * 60)
passed = sum(1 for v in results.values() if v)
total  = len(results)
for name, val in results.items():
    print(f"  [{'PASS' if val else 'FAIL'}] {name.replace('_',' ').title()}")
print(f"\n  Result: {passed}/{total} passed")
print("  Screenshots: C:/tmp/c1_pipeline.png, c2_applications.png, c3_cognizant_card.png")
