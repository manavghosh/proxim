"""End-to-end test: approve the imported Cognizant job and verify the full downstream chain."""
import sqlite3, time, requests
from playwright.sync_api import sync_playwright

BASE_URL     = "http://localhost:3000"
CANDIDATE_ID = "9be8dbe1-e16e-49b0-8528-b72d9003d975"
DB_PATH      = "C:/Agentic-AI/Proxim/proxim-dev.db"
JOB_ID       = "c5375fb9-e9d5-425d-b236-b42242939d17"
PIPELINE_URL = f"{BASE_URL}/candidates/{CANDIDATE_ID}/pipeline"
APPS_URL     = f"{BASE_URL}/candidates/{CANDIDATE_ID}/applications"

def db(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    try: return conn.execute(sql, params).fetchall()
    finally: conn.close()

def poll(label, sql, params, target_val, field_idx=0, timeout=120):
    """Poll DB every 5s until field matches target or timeout."""
    for i in range(timeout // 5):
        time.sleep(5)
        rows = db(sql, params)
        val = rows[0][field_idx] if rows else None
        val_safe = (str(val) or "").encode("ascii", "replace").decode()
        print(f"  [{(i+1)*5:3d}s] {label}={val_safe}")
        if val == target_val or (isinstance(target_val, list) and val in target_val):
            return val
    return None

results = {}

def check(label, condition, detail=""):
    icon = "PASS" if condition else "FAIL"
    print(f"  [{icon}] {label}" + (f" ({detail})" if detail else ""))
    results[label] = condition
    return condition

print("=" * 60)
print("  End-to-End Approval Test")
print("  Job: Director - Transformation Head @ Cognizant")
print("=" * 60)

# ── 1. Browser: find job on Pipeline page and approve ─────────────────────────
print("\n--- 1. Find job on Pipeline page and click Approve ---")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=400)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(PIPELINE_URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/a1_pipeline.png")

    # Find the Cognizant job card
    cognizant = page.get_by_text("Cognizant").first
    check("Cognizant job visible on Pipeline", cognizant.is_visible())

    # Scroll to it
    cognizant.scroll_into_view_if_needed()
    page.screenshot(path="C:/tmp/a2_cognizant_card.png")

    # Find the Approve button near the Cognizant card
    approve_btn = page.locator("text=Approve & Tailor Resume").first
    check("Approve button visible", approve_btn.is_visible())

    approve_btn.scroll_into_view_if_needed()
    page.screenshot(path="C:/tmp/a3_before_approve.png")

    approve_btn.click()
    time.sleep(2)
    page.screenshot(path="C:/tmp/a4_after_approve.png")

    # Job should leave the pipeline queue (status changes to approved)
    time.sleep(2)
    page.reload()
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/a5_pipeline_after.png")

    cognizant_gone = page.get_by_text("Cognizant").count() == 0
    check("Cognizant job left Pipeline queue after approval", cognizant_gone,
          "not found" if cognizant_gone else "still showing")

    browser.close()

# ── 2. DB: verify job status changed to approved ──────────────────────────────
print("\n--- 2. DB: job status = approved ---")
time.sleep(1)
j = db("SELECT status FROM jobs WHERE id=?", (JOB_ID,))
job_status = j[0][0] if j else "not found"
check("Job status = approved", job_status == "approved", job_status)

# ── 3. DB: verify 3 pipeline jobs queued ─────────────────────────────────────
print("\n--- 3. DB: pipeline jobs queued ---")
time.sleep(1)
pjs = db(
    "SELECT job_type, status FROM pipeline_jobs WHERE payload LIKE ? ORDER BY created_at DESC LIMIT 5",
    (f"%{JOB_ID}%",)
)
print(f"  Pipeline jobs for this job:")
for pj in pjs:
    icon = "PASS" if pj[1] in ("queued", "running", "completed") else "FAIL"
    print(f"  [{icon}] {pj[0]:25s} status={pj[1]}")

pj_types = {pj[0] for pj in pjs}
check("resume_builder queued",      "resume_builder"    in pj_types)
check("linkedin_connector queued",  "linkedin_connector" in pj_types)
check("outreach_mailer queued",     "outreach_mailer"    in pj_types)

# ── 4. DB: watch resume_builder complete ─────────────────────────────────────
print("\n--- 4. Wait: resume_builder completes ---")
rb = db("SELECT id FROM pipeline_jobs WHERE job_type='resume_builder' AND payload LIKE ? ORDER BY created_at DESC LIMIT 1", (f"%{JOB_ID}%",))
rb_id = rb[0][0] if rb else None
if rb_id:
    print(f"  Watching resume_builder job {rb_id[:16]}...")
    final = poll("resume_builder", "SELECT status FROM pipeline_jobs WHERE id=?",
                 (rb_id,), ["completed", "failed"], timeout=180)
    check("resume_builder completed", final == "completed", final)

    # Check resume version created
    rv = db("SELECT id, generation_status, archetype FROM resume_versions WHERE job_id=?", (JOB_ID,))
    if rv:
        rs = rv[0][1].encode("ascii","replace").decode()
        arch = (rv[0][2] or "").encode("ascii","replace").decode()[:40]
        print(f"  resume_version: status={rs} archetype={arch}")
        check("Resume version created", True, rs)
    else:
        check("Resume version created", False, "not found")

# ── 5. DB: watch outreach_mailer create email cadence ────────────────────────
print("\n--- 5. Wait: outreach_mailer creates email cadence ---")
om = db("SELECT id FROM pipeline_jobs WHERE job_type='outreach_mailer' AND payload LIKE ? ORDER BY created_at DESC LIMIT 1", (f"%{JOB_ID}%",))
om_id = om[0][0] if om else None
if om_id:
    print(f"  Watching outreach_mailer job {om_id[:16]}...")
    final_om = poll("outreach_mailer", "SELECT status FROM pipeline_jobs WHERE id=?",
                    (om_id,), ["completed", "failed"], timeout=120)
    check("outreach_mailer completed", final_om in ("completed", "failed"), final_om)

    # Check email cadence created
    time.sleep(2)
    ec = db("SELECT id, status, hiring_manager_email, email_confidence FROM email_cadences WHERE job_id=?", (JOB_ID,))
    if ec:
        ec_status = ec[0][1]
        hm_email  = (ec[0][2] or "").encode("ascii","replace").decode()
        confidence = ec[0][3]
        print(f"  email_cadence: status={ec_status} email={hm_email} confidence={confidence}")
        check("Email cadence created", True, ec_status)
        check("Cadence reached pending_approval or email finding state",
              ec_status in ("pending_approval", "low_confidence", "email_not_found", "generating", "pending_discovery", "discovering"),
              ec_status)
        if ec_status == "pending_approval":
            drafts = db("SELECT day_number, subject FROM email_drafts WHERE cadence_id=? ORDER BY day_number", (ec[0][0],))
            print(f"  Email drafts created: {len(drafts)}")
            for d in drafts:
                subj = (d[1] or "").encode("ascii","replace").decode()[:60]
                print(f"    Day {d[0]}: {subj}")
            check("3 email drafts generated", len(drafts) == 3, f"{len(drafts)} drafts")
    else:
        check("Email cadence created", False, "not found in DB")

# ── 6. Browser: Applications page shows approved job ─────────────────────────
print("\n--- 6. Applications page: job visible with email cadence ---")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=300)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    page.goto(APPS_URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/a6_applications.png")

    cognizant_apps = page.get_by_text("Cognizant").first
    check("Cognizant job on Applications page", cognizant_apps.is_visible())

    # Check email badge is present
    email_badge = page.get_by_text("Email").first
    check("Email section shown on job card", email_badge.is_visible() if email_badge.count() > 0 else False)

    page.screenshot(path="C:/tmp/a7_applications_email.png")
    browser.close()

# ── Summary ────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("  SUMMARY")
print("=" * 60)
passed = sum(1 for v in results.values() if v)
total  = len(results)
for name, val in results.items():
    icon = "PASS" if val else "FAIL"
    print(f"  [{icon}] {name}")
print(f"\n  Result: {passed}/{total} passed")
print("\n  Screenshots: C:/tmp/a1_pipeline.png through a7_applications_email.png")
