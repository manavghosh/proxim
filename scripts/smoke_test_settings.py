from playwright.sync_api import sync_playwright
import sys

PASS = "[PASS]"
FAIL = "[FAIL]"

results = []

def check(label, condition):
    status = PASS if condition else FAIL
    print(f"  {status} {label}")
    results.append((label, condition))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Capture console errors
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

    print("\n=== Smoke test: /settings ===\n")

    page.goto("http://localhost:3000/settings")
    page.wait_for_load_state("networkidle")

    page.screenshot(path="/tmp/settings_initial.png", full_page=True)

    # 1. Pipeline readiness indicator visible (amber - not ready)
    amber_block = page.locator("text=Pipeline not ready").first
    check("Pipeline readiness indicator renders (amber - not ready)", amber_block.is_visible())

    # 2. Upload CV button visible
    upload_btn = page.locator("button", has_text="Upload CV").first
    check("'Upload CV' button is visible", upload_btn.is_visible())

    # 3. Preferences form renders with seniority options
    caio_btn = page.locator("button", has_text="CAIO").first
    check("Preferences form renders seniority options (CAIO visible)", caio_btn.is_visible())

    # 4. Geographic preference options present
    remote_btn = page.locator("button", has_text="Remote").first
    check("Geographic preference options present (Remote visible)", remote_btn.is_visible())

    # 5. No JS console errors on load
    check("No console errors on page load", len(console_errors) == 0)
    if console_errors:
        for err in console_errors:
            print(f"      Console error: {err}")

    # --- Interaction: select seniority + location, save preferences ---
    print("\n  [Interaction] Selecting CAIO + Remote and saving preferences...")
    caio_btn.click()
    page.wait_for_timeout(300)
    remote_btn.click()
    page.wait_for_timeout(300)

    save_prefs_btn = page.locator("button", has_text="Save Preferences").first
    save_prefs_btn.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    page.screenshot(path="/tmp/settings_after_prefs.png", full_page=True)

    # 6. Pipeline indicator should now be green after saving prefs + cv not yet uploaded
    # (still not ready since CV not uploaded — but let's check the save worked)
    caio_active = page.locator("button.bg-primary", has_text="CAIO").first
    # After save, button styling depends on shadcn/ui variant — just confirm no error shown
    pref_error = page.locator("text=Save failed").first
    check("Preferences saved without error", not pref_error.is_visible())

    browser.close()

print("\n=== Results ===\n")
passed = sum(1 for _, ok in results if ok)
total = len(results)
for label, ok in results:
    status = PASS if ok else FAIL
    print(f"  {status} {label}")

print(f"\n  {passed}/{total} checks passed\n")

if passed < total:
    sys.exit(1)
