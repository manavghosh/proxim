"""Test Hunter.io and Gmail API connections."""
import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

HUNTER_API_KEY  = os.getenv('HUNTER_API_KEY', '')
GMAIL_CLIENT_ID     = os.getenv('GMAIL_CLIENT_ID', '')
GMAIL_CLIENT_SECRET = os.getenv('GMAIL_CLIENT_SECRET', '')


# ── 1. Hunter.io ──────────────────────────────────────────────────────────────

async def test_hunter():
    print("\n━━━ Hunter.io ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    if not HUNTER_API_KEY:
        print("❌  HUNTER_API_KEY not set in .env")
        return False

    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                'https://api.hunter.io/v2/account',
                params={'api_key': HUNTER_API_KEY},
            )
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            print(f"✅  Connected — plan: {data.get('plan_name', 'unknown')}")
            print(f"    Searches used : {data.get('calls', {}).get('used', '?')}")
            print(f"    Searches left : {data.get('calls', {}).get('available', '?')}")
            return True
        else:
            print(f"❌  HTTP {resp.status_code}: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌  Connection error: {e}")
        return False


# ── 2. Quick Hunter domain search ─────────────────────────────────────────────

async def test_hunter_search():
    print("\n━━━ Hunter.io — domain search (stripe.com sample) ━━━━━━━━━━━━")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                'https://api.hunter.io/v2/domain-search',
                params={'domain': 'stripe.com', 'limit': 3, 'api_key': HUNTER_API_KEY},
            )
        if resp.status_code == 200:
            emails = resp.json().get('data', {}).get('emails', [])
            print(f"✅  Found {len(emails)} addresses for stripe.com (showing up to 3):")
            for e in emails[:3]:
                print(f"    {e.get('value')}  (confidence: {e.get('confidence')}%)")
            return True
        else:
            print(f"❌  HTTP {resp.status_code}: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌  {e}")
        return False


# ── 3. Gmail OAuth ────────────────────────────────────────────────────────────

def test_gmail_oauth():
    print("\n━━━ Gmail OAuth ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    if not GMAIL_CLIENT_ID or not GMAIL_CLIENT_SECRET:
        print("❌  GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not set in .env")
        return None, None

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow

        client_config = {
            "installed": {
                "client_id": GMAIL_CLIENT_ID,
                "client_secret": GMAIL_CLIENT_SECRET,
                "redirect_uris": ["http://localhost"],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

        scopes = [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly',
        ]

        print("🌐  Opening browser for Gmail sign-in…")
        flow = InstalledAppFlow.from_client_config(client_config, scopes)
        creds = flow.run_local_server(port=0)

        print(f"✅  OAuth successful!")
        print(f"\n    ACCESS TOKEN  : {creds.token}")
        print(f"    REFRESH TOKEN : {creds.refresh_token}")
        return creds.token, creds.refresh_token

    except Exception as e:
        print(f"❌  OAuth error: {e}")
        return None, None


def test_gmail_send(access_token: str, refresh_token: str):
    print("\n━━━ Gmail — verify connection (read profile) ━━━━━━━━━━━━━━━━")
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=GMAIL_CLIENT_ID,
            client_secret=GMAIL_CLIENT_SECRET,
        )
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        profile = service.users().getProfile(userId='me').execute()
        email   = profile.get('emailAddress', '?')
        total   = profile.get('messagesTotal', '?')
        print(f"✅  Connected as: {email}")
        print(f"    Total messages in mailbox: {total}")
        return email
    except Exception as e:
        print(f"❌  Gmail API error: {e}")
        return None


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  Proxim — API Connection Test")
    print("=" * 60)

    # Hunter.io
    ok_hunter  = await test_hunter()
    if ok_hunter:
        await test_hunter_search()

    # Gmail
    access_token, refresh_token = test_gmail_oauth()
    gmail_email = None
    if access_token:
        gmail_email = test_gmail_send(access_token, refresh_token)

    # Summary
    print("\n" + "=" * 60)
    print("  Summary")
    print("=" * 60)
    print(f"  Hunter.io : {'✅ OK' if ok_hunter else '❌ FAIL'}")
    print(f"  Gmail     : {'✅ OK — ' + gmail_email if gmail_email else '❌ FAIL'}")

    if access_token and refresh_token:
        print("\n━━━ Next step — store tokens in DB ━━━━━━━━━━━━━━━━━━━━━━━━")
        print("Run this (replace CANDIDATE_ID with your actual UUID):\n")
        print(f"""  cd agent
  poetry run python -c "
import sqlite3, json
conn = sqlite3.connect('../proxim-dev.db')
cid = 'CANDIDATE_ID'
row = conn.execute('SELECT preferences FROM candidates WHERE id=?', (cid,)).fetchone()
prefs = json.loads(row[0]) if row else {{}}
prefs.update({{
    'gmail_access_token':  '{access_token}',
    'gmail_refresh_token': '{refresh_token}',
    'gmail_email':         '{gmail_email or 'you@gmail.com'}',
}})
conn.execute('UPDATE candidates SET preferences=? WHERE id=?', (json.dumps(prefs), cid))
conn.commit()
print('Tokens saved.')
"
""")

if __name__ == '__main__':
    asyncio.run(main())
