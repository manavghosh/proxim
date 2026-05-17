"""Focused test: Add Jobs with a FRESH URL to verify pipeline log capture."""
import time
import sqlite3
import json
import requests
from playwright.sync_api import sync_playwright

BASE_URL     = "http://localhost:3000"
CANDIDATE_ID = "9be8dbe1-e16e-49b0-8528-b72d9003d975"
DB_PATH      = "C:/Agentic-AI/Proxim/proxim-dev.db"
DASHBOARD_URL = f"{BASE_URL}/candidates/{CANDIDATE_ID}/dashboard"

# One fresh URL (not in scan_history) + one known duplicate to test mixed batch
FRESH_URL = "https://www.linkedin.com/jobs/view/4398234521/"
KNOWN_DUP = "https://www.linkedin.com/jobs/view/4415158878/"
TEST_URLS = f"{FRESH_URL}\n{KNOWN_DUP}"


def db(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def check(label, condition, detail=""):
    icon = "PASS" if condition else "FAIL"
    print(f"  [{icon}] {label}" + (f" ({detail})" if detail else ""))
    return condition


results = {}

print("\n=== Add Jobs E2E Test — Fresh URL ===\n")

# Direct API test first (no browser needed to verify backend)
print("--- API Layer Test ---")
resp = requests.post(
    f"{BASE_URL}/api/jobs/import?candidateId={CANDIDATE_ID}",
    json={"urls": TEST_URLS},
    headers={"Content-Type": "application/json"},
)
print(f"  POST /api/jobs/import → HTTP {resp.status_code}")
api_data = resp.json()
print(f"  Response: {api_data}")

results["api_status_201"] = check("API returns 201", resp.status_code == 201, f"got {resp.status_code}")
results["api_imported_1"] = check("1 new job imported", api_data.get("imported") == 1, f"imported={api_data.get('imported')}")
results["api_skipped_1"]  = check("1 duplicate skipped", api_data.get("skipped") == 1, f"skipped={api_data.get('skipped')}")
results["api_has_pjid"]   = check("pipelineJobId returned", bool(api_data.get("pipelineJobId")), api_data.get("pipelineJobId","")[:16])
results["api_has_jobids"] = check("jobIds returned", len(api_data.get("jobIds", [])) == 1, f"{len(api_data.get('jobIds', []))} IDs")

pj_id = api_data.get("pipelineJobId")
job_ids = api_data.get("jobIds", [])

# Verify DB state
print("\n--- DB Verification ---")
if job_ids:
    inserted = db("SELECT id, title, company, status, source, source_url FROM jobs WHERE id=?", (job_ids[0],))
    if inserted:
        j = inserted[0]
        print(f"  Job: id={j[0][:16]}... title={j[1]} company={j[2]} status={j[3]}")
        results["job_in_db"]      = check("Job inserted in DB", True, f"status={j[3]}")
        results["job_title_ph"]   = check("Title is placeholder 'Importing...'", j[1] == "Importing...", j[1])
        results["job_status_disc"]= check("Status is 'discovered'", j[3] == "discovered")
        results["job_source"]     = check("Source is 'linkedin'", j[4] == "linkedin", j[4])

if pj_id:
    pj = db("SELECT id, status, payload FROM pipeline_jobs WHERE id=?", (pj_id,))
    if pj:
        payload = json.loads(pj[0][2]) if pj[0][2] else {}
        print(f"  PipelineJob status: {pj[0][1]}")
        print(f"  Payload job_ids: {payload.get('job_ids', [])}")
        results["pj_status_queued"] = check("Pipeline job queued", pj[0][1] in ("queued","running"), pj[0][1])
        results["pj_payload_match"] = check("Payload job_ids matches", payload.get("job_ids") == job_ids)

    # Verify scan_history
    sh = db("SELECT url FROM scan_history WHERE url=?", (FRESH_URL.rstrip("/"),))
    results["scan_history"] = check("URL added to scan_history", len(sh) > 0)

# Check logs endpoint for the pipeline job
if pj_id:
    print("\n--- Pipeline Logs API ---")
    logs_resp = requests.get(f"{BASE_URL}/api/pipeline/{pj_id}/logs")
    print(f"  GET /api/pipeline/{pj_id[:16]}.../logs → HTTP {logs_resp.status_code}")
    if logs_resp.status_code == 200:
        logs_data = logs_resp.json()
        print(f"  jobStatus: {logs_data.get('jobStatus')}")
        print(f"  log entries: {len(logs_data.get('logs', []))}")
        results["logs_endpoint_ok"] = check("Logs endpoint returns 200", True)
        results["logs_job_status"]  = check("Job status visible in logs response", "jobStatus" in logs_data)
    else:
        results["logs_endpoint_ok"] = check("Logs endpoint returns 200", False, f"got {logs_resp.status_code}")
        results["logs_job_status"]  = False

    # Check status endpoint + chain
    status_resp = requests.get(f"{BASE_URL}/api/pipeline/{pj_id}/status")
    print(f"  GET /api/pipeline/{pj_id[:16]}.../status → HTTP {status_resp.status_code}")
    if status_resp.status_code == 200:
        status_data = status_resp.json()
        print(f"  jobType: {status_data.get('jobType')}")
        print(f"  status: {status_data.get('status')}")
        print(f"  followUpJobId: {status_data.get('followUpJobId')}")
        results["status_endpoint_ok"] = check("Status endpoint returns 200", True)
        results["status_job_type"]    = check("jobType is import_jobs", status_data.get("jobType") == "import_jobs")


# Browser test for UI
print("\n--- UI Test (Browser) ---")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=300)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    network_404s = []
    page.on("response", lambda r: network_404s.append(r.url) if r.status == 404 else None)

    page.goto(DASHBOARD_URL)
    page.wait_for_load_state("networkidle")

    # Simulate what happens when importJobId is set — pass it directly via URL
    # to the log pane by checking if the log pane polls the import job
    if pj_id:
        # Check the logs endpoint is reachable from browser
        page.evaluate(f"""
            fetch('/api/pipeline/{pj_id}/logs')
              .then(r => r.json())
              .then(d => console.log('LOG_CHECK:' + JSON.stringify({{status: d.jobStatus, logs: d.logs.length}})))
        """)
        time.sleep(1)

    page.screenshot(path="C:/tmp/10_dashboard_with_import.png")

    # Verify the Add Jobs button triggers the import sheet and shows the pipeline job
    btn = page.get_by_role("button", name="Add Jobs").first
    btn.click()
    time.sleep(0.8)

    # We need to import the fresh URL again - but it now exists in scan_history
    # So let's use a totally new URL for the UI flow
    new_fresh = "https://www.linkedin.com/jobs/view/9999999999/"
    page.locator("textarea").fill(new_fresh)
    time.sleep(0.3)
    page.screenshot(path="C:/tmp/11_sheet_fresh_url.png")

    page.get_by_role("button", name="Import & Score").first.click()
    time.sleep(2)
    page.screenshot(path="C:/tmp/12_after_fresh_import.png")

    # Check success state shows 3-step progress
    new_queued = page.get_by_text("queued for import").is_visible()
    results["ui_new_import_queued"] = check("New URL import shows queued state", new_queued)

    if new_queued:
        results["ui_step1"] = check("Step 1 visible (Scraping)", page.get_by_text("Scraping job pages").is_visible())
        results["ui_step2"] = check("Step 2 visible (Scoring)",  page.get_by_text("Scoring against").is_visible())
        results["ui_step3"] = check("Step 3 visible (Pipeline)", page.get_by_text("Pipeline for your review").is_visible())
        results["ui_go_btn"] = check("Go to Pipeline button shown", page.get_by_role("link", name="Go to Pipeline").is_visible())
    else:
        print("  (URL may already exist from a previous test run)")

    # Check no unexpected 404s (filter known OK ones)
    bad_404s = [u for u in network_404s if "favicon" not in u and "placeholder" not in u]
    results["no_404s"] = check("No unexpected 404s", len(bad_404s) == 0,
        f"{len(bad_404s)} 404s: {[u[-60:] for u in bad_404s[:2]]}" if bad_404s else "clean")

    page.screenshot(path="C:/tmp/13_final.png")
    browser.close()

# Final summary
print("\n=== SUMMARY ===")
passed = sum(1 for v in results.values() if v)
total  = len(results)
for name, val in results.items():
    icon = "PASS" if val else "FAIL"
    print(f"  [{icon}] {name.replace('_',' ').title()}")
print(f"\n  Result: {passed}/{total} passed")
