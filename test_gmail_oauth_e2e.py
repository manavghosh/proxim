"""
End-to-end test for Gmail OAuth connect flow.

Since real Google OAuth requires browser interaction with Google's servers,
this test covers:
  1. API: /api/gmail/status  — returns not-connected state
  2. API: /api/gmail/connect — redirects to correct Google OAuth URL
  3. API: Simulate callback  — inject tokens directly into DB, verify storage
  4. API: /api/gmail/status  — now returns connected state
  5. UI:  Settings page      — shows Connect Gmail button → then Connected state
  6. API: /api/gmail/revoke  — clears tokens, verifies DB cleaned
  7. UI:  Settings page      — shows Connect Gmail button again
"""
import sqlite3, requests, time, json
from playwright.sync_api import sync_playwright
from urllib.parse import urlparse, parse_qs

BASE  = "http://localhost:3000"
CAND  = "9be8dbe1-e16e-49b0-8528-b72d9003d975"
DB    = "C:/Agentic-AI/Proxim/proxim-dev.db"
SETTINGS = f"{BASE}/candidates/{CAND}/settings"

def db(sql, params=()):
    c = sqlite3.connect(DB); r = c.execute(sql, params).fetchall(); c.close(); return r

def safe(s): return (s or "").encode("ascii", "replace").decode()

results = {}
def check(label, ok, detail=""):
    icon = "PASS" if ok else "FAIL"
    print(f"  [{icon}] {label}" + (f" -- {detail}" if detail else ""))
    results[label] = ok
    return ok

print()
print("=" * 60)
print("  Gmail OAuth Connect Flow — E2E Test")
print("=" * 60)

# ── Step 0: Clean DB state ─────────────────────────────────────────────────
print()
print("--- Setup: clear any existing Gmail tokens ---")
conn = sqlite3.connect(DB)
row = conn.execute("SELECT preferences FROM candidates WHERE id=?", (CAND,)).fetchone()
prefs = json.loads(row[0]) if row else {}
# Remove gmail fields to start clean
for key in ["gmail_access_token","gmail_refresh_token","gmail_email","gmail_token_expiry","email_outreach_mode"]:
    prefs.pop(key, None)
conn.execute("UPDATE candidates SET preferences=? WHERE id=?", (json.dumps(prefs), CAND))
conn.commit(); conn.close()
print("  DB cleaned")

# ── Step 1: Status — not connected ─────────────────────────────────────────
print()
print("--- 1. GET /api/gmail/status — expect not connected ---")
r = requests.get(f"{BASE}/api/gmail/status?candidateId={CAND}")
print(f"  HTTP {r.status_code}: {r.json()}")
check("Status returns 200", r.status_code == 200)
check("connected=false", r.json().get("connected") == False)
check("email=null", r.json().get("email") is None)

# ── Step 2: Connect redirect ───────────────────────────────────────────────
print()
print("--- 2. GET /api/gmail/connect — expect redirect to Google ---")
r = requests.get(f"{BASE}/api/gmail/connect?candidateId={CAND}", allow_redirects=False)
print(f"  HTTP {r.status_code}")
print(f"  Location: {r.headers.get('location','')[:120]}")
check("Returns 307/308 redirect", r.status_code in (307, 308))
location = r.headers.get("location", "")
check("Redirects to accounts.google.com", "accounts.google.com" in location)
check("Contains gmail.send scope", "gmail.send" in location)
check("Contains gmail.readonly scope", "gmail.readonly" in location)
check("access_type=offline", "access_type=offline" in location or "access_type%3Doffline" in location)
check("prompt=consent", "prompt=consent" in location or "prompt%3Dconsent" in location)

# Extract and verify state contains candidateId
import base64
qs = dict(p.split("=",1) for p in location.split("?",1)[-1].split("&") if "=" in p)
state_raw = qs.get("state","")
try:
    state_decoded = json.loads(base64.urlsafe_b64decode(state_raw + "=="))
    check("State contains candidateId", state_decoded.get("candidateId") == CAND,
          f"got {state_decoded}")
except Exception as e:
    check("State contains candidateId", False, str(e))

# ── Step 3: Simulate callback — inject tokens directly ────────────────────
print()
print("--- 3. Simulate OAuth callback — inject tokens into DB ---")
FAKE_ACCESS  = "ya29.fake_access_token_for_test"
FAKE_REFRESH = "1//fake_refresh_token_for_test"
FAKE_EMAIL   = "manav.test@gmail.com"
FAKE_EXPIRY  = "2026-12-31T23:59:59Z"

conn = sqlite3.connect(DB)
row  = conn.execute("SELECT preferences FROM candidates WHERE id=?", (CAND,)).fetchone()
prefs = json.loads(row[0]) if row else {}
prefs.update({
    "gmail_access_token":  FAKE_ACCESS,
    "gmail_refresh_token": FAKE_REFRESH,
    "gmail_email":         FAKE_EMAIL,
    "gmail_token_expiry":  FAKE_EXPIRY,
})
conn.execute("UPDATE candidates SET preferences=? WHERE id=?", (json.dumps(prefs), CAND))
conn.commit(); conn.close()
print(f"  Injected tokens for {FAKE_EMAIL}")

# ── Step 4: Status — now connected ─────────────────────────────────────────
print()
print("--- 4. GET /api/gmail/status — expect connected ---")
r = requests.get(f"{BASE}/api/gmail/status?candidateId={CAND}")
print(f"  HTTP {r.status_code}: {r.json()}")
check("Status returns 200", r.status_code == 200)
check("connected=true", r.json().get("connected") == True)
check("email returned", r.json().get("email") == FAKE_EMAIL, r.json().get("email"))

# ── Step 5: UI — Settings page shows connected state ─────────────────────
print()
print("--- 5. Browser: Settings page shows Gmail connected ---")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=300)
    page = browser.new_page(viewport={"width":1400,"height":900})
    page.goto(SETTINGS)
    page.wait_for_load_state("networkidle")
    time.sleep(2)

    # Scroll to Email Outreach section
    email_section = page.get_by_text("EMAIL OUTREACH").last
    if email_section.count() > 0:
        email_section.scroll_into_view_if_needed()
        time.sleep(0.5)

    page.screenshot(path="C:/tmp/gmail_connected.png")

    # Check for connected state text
    connected_text = page.get_by_text(FAKE_EMAIL).first
    check("Settings shows Gmail email", connected_text.is_visible() if connected_text.count() > 0 else False,
          FAKE_EMAIL)

    # Check Connect Gmail button is gone
    connect_btn = page.locator("[data-testid=connect-gmail-btn]").first
    check("Connect Gmail button hidden when connected",
          connect_btn.count() == 0 or not connect_btn.is_visible())

    # Check Agentic option is selectable
    agentic_radio = page.locator("[data-testid=mode-agentic]").first
    check("Agentic radio visible", agentic_radio.is_visible() if agentic_radio.count() > 0 else False)

    # Select Agentic and verify save is enabled
    if agentic_radio.count() > 0 and agentic_radio.is_visible():
        agentic_radio.click()
        time.sleep(0.3)
        save_btn = page.locator("[data-testid=save-mode-btn]").last
        check("Save button enabled after selecting Agentic with Gmail connected",
              not save_btn.is_disabled() if save_btn.count() > 0 else False)

    browser.close()

# ── Step 6: Revoke ─────────────────────────────────────────────────────────
print()
print("--- 6. POST /api/gmail/revoke — clears tokens ---")
r = requests.post(f"{BASE}/api/gmail/revoke?candidateId={CAND}")
print(f"  HTTP {r.status_code}: {r.json()}")
check("Revoke returns 200", r.status_code == 200)
check("revoked=true", r.json().get("revoked") == True)
check("mode=manual", r.json().get("mode") == "manual")

# Verify DB is clean
row = db("SELECT preferences FROM candidates WHERE id=?", (CAND,))
prefs_after = json.loads(row[0][0]) if row else {}
check("gmail_access_token deleted from DB",  "gmail_access_token"  not in prefs_after)
check("gmail_refresh_token deleted from DB", "gmail_refresh_token" not in prefs_after)
check("gmail_email deleted from DB",          "gmail_email"         not in prefs_after)
check("gmail_token_expiry deleted from DB",   "gmail_token_expiry"  not in prefs_after)
check("email_outreach_mode = manual",
      prefs_after.get("email_outreach_mode") == "manual",
      prefs_after.get("email_outreach_mode"))

# ── Step 7: Status — not connected again ──────────────────────────────────
print()
print("--- 7. GET /api/gmail/status — expect not connected after revoke ---")
r = requests.get(f"{BASE}/api/gmail/status?candidateId={CAND}")
print(f"  HTTP {r.status_code}: {r.json()}")
check("Status connected=false after revoke", r.json().get("connected") == False)

# ── Step 8: UI — Settings page shows Connect button again ─────────────────
print()
print("--- 8. Browser: Settings page shows Connect Gmail button again ---")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=300)
    page = browser.new_page(viewport={"width":1400,"height":900})
    page.goto(SETTINGS)
    page.wait_for_load_state("networkidle")
    time.sleep(2)

    email_section = page.get_by_text("EMAIL OUTREACH").last
    if email_section.count() > 0:
        email_section.scroll_into_view_if_needed()
        time.sleep(0.5)

    page.screenshot(path="C:/tmp/gmail_disconnected.png")

    connect_btn = page.locator("[data-testid=connect-gmail-btn]").first
    check("Connect Gmail button visible after revoke",
          connect_btn.is_visible() if connect_btn.count() > 0 else False)

    # Verify save is disabled when Agentic selected but not connected
    agentic_radio = page.locator("[data-testid=mode-agentic]").first
    if agentic_radio.count() > 0:
        agentic_radio.click()
        time.sleep(0.3)
        save_btn = page.locator("[data-testid=save-mode-btn]").last
        check("Save disabled when Agentic selected without Gmail",
              save_btn.is_disabled() if save_btn.count() > 0 else False)

    browser.close()

# ── Summary ────────────────────────────────────────────────────────────────
print()
print("=" * 60)
print("  SUMMARY")
print("=" * 60)
passed = sum(1 for v in results.values() if v)
total  = len(results)
for name, val in results.items():
    print(f"  [{'PASS' if val else 'FAIL'}] {name}")
print(f"\n  Result: {passed}/{total} passed")
print("  Screenshots: C:/tmp/gmail_connected.png, gmail_disconnected.png")
