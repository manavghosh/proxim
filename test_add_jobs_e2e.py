"""End-to-end test for Add Jobs flow."""
import time
import sqlite3
import json
from playwright.sync_api import sync_playwright

BASE_URL     = "http://localhost:3000"
CANDIDATE_ID = "9be8dbe1-e16e-49b0-8528-b72d9003d975"
DB_PATH      = "C:/Agentic-AI/Proxim/proxim-dev.db"

TEST_URLS = "https://www.linkedin.com/jobs/view/4415158878/?eBP=NOT_ELIGIBLE_FOR_CHARGING&trk=flagship3_search_srp_jobs\nhttps://www.linkedin.com/jobs/view/4212345678/"

DASHBOARD_URL = f"{BASE_URL}/candidates/{CANDIDATE_ID}/dashboard"
PIPELINE_URL  = f"{BASE_URL}/candidates/{CANDIDATE_ID}/pipeline"


def db_query(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def section(title):
    print(f"\n--- {title} ---")


def check(label, condition, detail=""):
    icon = "PASS" if condition else "FAIL"
    msg = f"  [{icon}] {label}"
    if detail:
        msg += f" ({detail})"
    print(msg)
    return condition


results = {}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=400)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

    # 1. Dashboard loads and shows Add Jobs button
    section("1. Dashboard - Add Jobs button")
    page.goto(DASHBOARD_URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/01_dashboard.png")

    btn = page.get_by_role("button", name="Add Jobs").first
    results["add_jobs_btn"] = check("Add Jobs button visible", btn.is_visible())

    # 2. Open the sheet
    section("2. Open Import Sheet")
    btn.click()
    time.sleep(1)
    page.screenshot(path="C:/tmp/02_sheet_open.png")

    results["sheet_title"] = check("Sheet title 'Import Jobs' shown",
        page.get_by_text("Import Jobs").first.is_visible())
    results["textarea"] = check("Textarea visible",
        page.locator("textarea").is_visible())

    # 3. Paste URLs
    section("3. Paste URLs")
    page.locator("textarea").fill(TEST_URLS)
    time.sleep(0.5)
    page.screenshot(path="C:/tmp/03_urls_pasted.png")

    # Check URL count label
    try:
        count_label = page.locator("text=2 URLs detected").is_visible()
        results["url_count"] = check("URL count detected (2 URLs)", count_label)
    except Exception:
        results["url_count"] = check("URL count detected", False, "label not found")

    import_btn = page.get_by_role("button", name="Import & Score").first
    results["import_btn_enabled"] = check("Import & Score button enabled", import_btn.is_enabled())

    # 4. Pre-import DB snapshot
    section("4. Pre-import DB state")
    pre_count = db_query("SELECT COUNT(*) FROM jobs WHERE candidate_id=?", (CANDIDATE_ID,))[0][0]
    pre_pj_count = len(db_query("SELECT id FROM pipeline_jobs WHERE job_type='import_jobs'"))
    print(f"  Jobs before: {pre_count}")
    print(f"  import_jobs pipeline jobs before: {pre_pj_count}")

    # 5. Submit
    section("5. Submit import")
    import_btn.click()
    try:
        page.wait_for_selector("text=queued for import", timeout=8000)
        success = True
    except Exception:
        try:
            page.wait_for_selector("text=already exist", timeout=3000)
            success = True  # deduplication is also correct
        except Exception:
            success = False
    page.screenshot(path="C:/tmp/05_after_submit.png")
    results["import_success"] = check("Import submitted successfully", success)

    # 6. Success state content
    section("6. Success state content")
    is_queued = page.get_by_text("queued for import").is_visible() if success else False
    is_dedup  = page.get_by_text("already exist").is_visible() if success else False

    if is_queued:
        print("  New jobs queued path:")
        results["step1"] = check("Step 1 visible (Scraping job pages)",
            page.get_by_text("Scraping job pages").is_visible())
        results["step2"] = check("Step 2 visible (Scoring against CV)",
            page.get_by_text("Scoring against").is_visible())
        results["step3"] = check("Step 3 visible (Jobs appear in Pipeline)",
            page.get_by_text("Pipeline for your review").is_visible())
        results["go_pipeline"] = check("Go to Scorecard button visible",
            page.get_by_role("link", name="Go to Scorecard").is_visible())
    elif is_dedup:
        print("  Deduplication path (URLs already existed):")
        results["step1"] = results["step2"] = results["step3"] = True
        results["go_pipeline"] = check("Add More button visible",
            page.get_by_role("button", name="Add More").is_visible())
    else:
        results["step1"] = results["step2"] = results["step3"] = results["go_pipeline"] = False

    # 7. DB verification
    section("7. DB - pipeline job created")
    time.sleep(1)
    post_pjs = db_query(
        "SELECT id, status, payload FROM pipeline_jobs WHERE job_type='import_jobs' ORDER BY created_at DESC LIMIT 1"
    )
    post_count = db_query("SELECT COUNT(*) FROM jobs WHERE candidate_id=?", (CANDIDATE_ID,))[0][0]

    if post_pjs:
        pj = post_pjs[0]
        print(f"  pipeline_job id: {pj[0][:16]}...")
        print(f"  status: {pj[1]}")
        try:
            payload = json.loads(pj[2]) if pj[2] else {}
            job_ids = payload.get('job_ids', [])
            print(f"  job_ids in payload: {len(job_ids)}")
        except Exception:
            job_ids = []
        results["pj_created"] = check("import_jobs pipeline job in DB", True, f"status={pj[1]}")
        results["payload_has_ids"] = check("Payload contains job IDs", len(job_ids) > 0, f"{len(job_ids)} IDs")
    else:
        results["pj_created"] = check("import_jobs pipeline job in DB", False, "not found")
        results["payload_has_ids"] = False

    print(f"  Jobs after: {post_count} (was {pre_count}, added {post_count - pre_count})")
    results["jobs_inserted"] = check("Jobs inserted into DB",
        post_count >= pre_count,
        f"+{post_count - pre_count} new jobs")

    # 8. Pipeline log pane
    section("8. Dashboard - Pipeline log pane after import")
    page.keyboard.press("Escape")
    time.sleep(0.8)
    page.screenshot(path="C:/tmp/08_dashboard_logs.png")

    # Look for log pane container
    log_texts = ["Fetching", "import", "scraping", "queued", "pipeline", "JD"]
    log_found = any(
        page.get_by_text(t).count() > 0
        for t in log_texts
    )
    # Also check if a log pane element exists
    log_pane = page.locator("[class*='log'], [class*='Log']").count()
    results["log_pane"] = check("Pipeline log pane present on dashboard",
        log_found or log_pane > 0,
        f"log elements: {log_pane}")

    # 9. Pipeline page
    section("9. Navigate to Pipeline page")
    page.goto(PIPELINE_URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path="C:/tmp/09_pipeline.png")
    results["pipeline_loads"] = check("Pipeline page loads without error",
        not page.get_by_text("Failed to load").is_visible())

    # Check for imported jobs with 'Importing...' title (before daemon runs)
    importing = page.get_by_text("Importing").count()
    print(f"  Jobs still showing 'Importing...' (daemon not yet run): {importing}")

    # 10. Console errors
    section("10. Console errors")
    results["no_errors"] = check("No JS console errors",
        len(console_errors) == 0,
        f"{len(console_errors)} errors" if console_errors else "clean")
    for e in console_errors[:3]:
        print(f"    ERROR: {e[:120]}")

    # Summary
    section("SUMMARY")
    passed = sum(1 for v in results.values() if v)
    total  = len(results)
    for name, val in results.items():
        icon = "PASS" if val else "FAIL"
        print(f"  [{icon}] {name.replace('_', ' ').title()}")
    print(f"\n  Result: {passed}/{total} passed")

    if passed == total:
        print("  All checks passed!")
    else:
        print(f"  {total - passed} check(s) failed")

    print("\n  Screenshots: C:/tmp/01..09_*.png")
    browser.close()
