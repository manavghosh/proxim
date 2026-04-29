"""Navigation smoke test — verifies all 4 pages and sidebar navigation."""
from playwright.sync_api import sync_playwright
import sys

PASS = "[PASS]"
FAIL = "[FAIL]"
results = []

def check(label, condition, detail=""):
    status = PASS if condition else FAIL
    msg = f"  {status} {label}"
    if detail and not condition:
        msg += f"\n      Detail: {detail}"
    print(msg)
    results.append((label, condition))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    print("\n=== Navigation Check: Proxim UI ===\n")

    # 1. Root redirect to /dashboard
    page.goto("http://localhost:3000", wait_until="networkidle")
    check(
        "Root / redirects to /dashboard",
        page.url.endswith("/dashboard"),
        f"URL was: {page.url}"
    )

    # 2. Dashboard renders: topbar with "Dashboard", 4 stat cards
    topbar_text = page.locator("text=Dashboard").first
    check("Dashboard topbar shows 'Dashboard' text", topbar_text.is_visible())

    stat_labels = ["Pipeline Status", "CV Parse", "Jobs Matched", "Applications"]
    for label in stat_labels:
        el = page.locator(f"text={label}").first
        check(f"Dashboard stat card label '{label}' visible", el.is_visible())

    # Screenshot of dashboard
    page.screenshot(path="/tmp/proxim_dashboard_final.png", full_page=True)
    print("\n  [INFO] Screenshot saved: /tmp/proxim_dashboard_final.png")

    # 3. Sidebar nav items present (check <a> links by href)
    sidebar_links = {
        "Dashboard": "/dashboard",
        "Pipeline": "/pipeline",
        "Applications": "/applications",
        "Settings": "/settings",
    }
    for label, href in sidebar_links.items():
        el = page.locator(f"aside a[href='{href}']").first
        check(f"Sidebar nav item '{label}' link present", el.is_visible())

    # 4. Click Pipeline link by href -> /pipeline with placeholder text
    page.locator("aside a[href='/pipeline']").first.click()
    page.wait_for_url("**/pipeline", timeout=10000)
    page.wait_for_load_state("networkidle")
    check(
        "Clicking Pipeline navigates to /pipeline",
        "/pipeline" in page.url,
        f"URL was: {page.url}"
    )
    phase2_text = page.get_by_text("Phase 2", exact=False).first
    check(
        "/pipeline page has placeholder content (Phase 2 text)",
        phase2_text.is_visible(),
        "Could not find 'Phase 2' text"
    )

    # 5. Click Applications link -> /applications with placeholder text
    page.locator("aside a[href='/applications']").first.click()
    page.wait_for_url("**/applications", timeout=10000)
    page.wait_for_load_state("networkidle")
    check(
        "Clicking Applications navigates to /applications",
        "/applications" in page.url,
        f"URL was: {page.url}"
    )
    phase2_text2 = page.get_by_text("Phase 2", exact=False).first
    check(
        "/applications page has placeholder content (Phase 2 text)",
        phase2_text2.is_visible(),
        "Could not find 'Phase 2' text"
    )

    # 6. Click Settings -> /settings with CV and Preferences sections
    page.locator("aside a[href='/settings']").first.click()
    page.wait_for_url("**/settings", timeout=10000)
    page.wait_for_load_state("networkidle")
    check(
        "Clicking Settings navigates to /settings",
        "/settings" in page.url,
        f"URL was: {page.url}"
    )
    # Wait for async data load on settings page
    page.wait_for_timeout(3000)
    page.wait_for_load_state("networkidle")

    cv_section = page.locator("text=CV").first
    prefs_section = page.locator("text=Preferences").first
    check("/settings has CV section", cv_section.is_visible())
    check("/settings has Preferences section", prefs_section.is_visible())

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
