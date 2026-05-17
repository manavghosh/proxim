"""One-time script to get Gmail OAuth2 tokens. Run once, store the output in DB."""
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
]

CLIENT_ID = '1010079959820-9i2jn90plfap44puoqsj9qgcbj2rvaij.apps.googleusercontent.com'
CLIENT_SECRET = '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'

client_config = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uris": ["http://localhost"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
creds = flow.run_local_server(port=0)

print("\n✅ Gmail OAuth tokens obtained successfully!\n")
print(f"ACCESS TOKEN:  {creds.token}")
print(f"REFRESH TOKEN: {creds.refresh_token}")
print(f"\nAdd these to your candidate row in the DB (see instructions below).")
