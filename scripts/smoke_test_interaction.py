"""
Focused interaction test: verify button toggles and preference save.
"""
from playwright.sync_api import sync_playwright
import sys

results = []

def check(label, condition, detail=""):
    status = "[PASS]" if condition else "[FAIL]"
    suffix = f"\n    detail: {detail}" if detail else ""
    print(f"  {status} {label}{suffix}")
    results.append((label, condition))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

    print("\n=== Interaction smoke test: /settings ===\n")

    page.goto("http://localhost:3000/settings")
    page.wait_for_load_state("networkidle")

    # 1. Initial render checks
    check("Page loads with Settings heading", "Settings" in (page.locator("h1").text_content() or ""))
    check("Pipeline not ready shown", page.locator("text=Pipeline not ready").is_visible())

    # 2. Read initial CAIO button class to detect pre-selected state
    caio = page.get_by_role("button", name="CAIO")
    initial_class = caio.get_attribute("class") or ""
    caio_was_selected = "bg-primary" in initial_class
    print(f"\n  [INFO] CAIO initial state: {'selected' if caio_was_selected else 'unselected'}")

    # If already selected, clicking will deselect — click again to ensure it's selected
    caio.click()
    page.wait_for_timeout(500)
    after_first_click = caio.get_attribute("class") or ""
    after_first_selected = "bg-primary" in after_first_click

    if not after_first_selected:
        # Was deselected - click again to re-select
        caio.click()
        page.wait_for_timeout(500)

    final_caio_class = caio.get_attribute("class") or ""
    caio_selected = "bg-primary" in final_caio_class
    check("CAIO button ends in selected state", caio_selected, final_caio_class[:120] if not caio_selected else "")

    # 3. Ensure Remote is selected
    remote = page.get_by_role("button", name="Remote")
    remote_class = remote.get_attribute("class") or ""
    remote_was_selected = "bg-primary" in remote_class
    print(f"  [INFO] Remote initial state: {'selected' if remote_was_selected else 'unselected'}")

    if not remote_was_selected:
        remote.click()
        page.wait_for_timeout(500)

    final_remote_class = remote.get_attribute("class") or ""
    remote_selected = "bg-primary" in final_remote_class
    check("Remote button ends in selected state", remote_selected, final_remote_class[:120] if not remote_selected else "")

    # 4. Save preferences
    save_btn = page.get_by_role("button", name="Save Preferences")
    save_btn.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    validation_err = page.locator("text=Select at least one seniority level")
    api_err = page.locator("text=Save failed")
    check("No validation error after save", not validation_err.is_visible())
    check("No API error after save", not api_err.is_visible())

    # 5. Take screenshot of final state
    page.screenshot(path="/tmp/settings_interaction.png", full_page=True)

    # 6. Reload to verify persistence
    page.reload()
    page.wait_for_load_state("networkidle")

    caio_after_reload = page.get_by_role("button", name="CAIO")
    caio_reload_class = caio_after_reload.get_attribute("class") or ""
    check("CAIO persists as selected after reload", "bg-primary" in caio_reload_class)

    page.screenshot(path="/tmp/settings_after_reload.png", full_page=True)

    # 7. No console errors
    check("No console errors", len(console_errors) == 0)
    if console_errors:
        for e in console_errors:
            print(f"    console error: {e}")

    browser.close()

print("\n=== Results ===\n")
passed = sum(1 for _, ok in results if ok)
total = len(results)
for label, ok in results:
    print(f"  {'[PASS]' if ok else '[FAIL]'} {label}")

print(f"\n  {passed}/{total} checks passed\n")

if passed < total:
    sys.exit(1)
