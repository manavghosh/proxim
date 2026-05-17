"""Gmail API client for sending cadence emails and detecting replies/bounces."""
from __future__ import annotations

import base64
import email.mime.multipart
import email.mime.text
import email.mime.application
from pathlib import Path

import structlog
from google.oauth2.credentials import Credentials
from google.auth.exceptions import RefreshError
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = structlog.get_logger()


class GmailAuthExpiredError(Exception):
    pass


def build_service(access_token: str, refresh_token: str):
    """Build a Gmail API service resource from stored OAuth2 tokens."""
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id="",
        client_secret="",
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def send_email(
    service,
    to: str,
    subject: str,
    body_html: str,
    body_text: str,
    thread_id: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    attachments: list[dict] | None = None,
) -> dict:
    """
    Send a MIME email via Gmail API.

    attachments: list of {path: str, filename: str} dicts.
    Returns {id, threadId} from Gmail API response.
    """
    try:
        if attachments:
            msg = email.mime.multipart.MIMEMultipart("mixed")
            alt = email.mime.multipart.MIMEMultipart("alternative")
            alt.attach(email.mime.text.MIMEText(body_text, "plain"))
            alt.attach(email.mime.text.MIMEText(body_html, "html"))
            msg.attach(alt)
            for att in attachments:
                path = Path(att["path"])
                if path.exists():
                    with open(path, "rb") as f:
                        part = email.mime.application.MIMEApplication(f.read(), _subtype="pdf")
                    part.add_header("Content-Disposition", "attachment", filename=att["filename"])
                    msg.attach(part)
        else:
            msg = email.mime.multipart.MIMEMultipart("alternative")
            msg.attach(email.mime.text.MIMEText(body_text, "plain"))
            msg.attach(email.mime.text.MIMEText(body_html, "html"))

        msg["To"] = to
        msg["Subject"] = subject
        if in_reply_to:
            msg["In-Reply-To"] = in_reply_to
            msg["References"] = references or in_reply_to

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        body: dict = {"raw": raw}
        if thread_id:
            body["threadId"] = thread_id

        result = service.users().messages().send(userId="me", body=body).execute()
        logger.info("gmail.sent", to=to, subject=subject, message_id=result.get("id"))
        return result

    except RefreshError as e:
        raise GmailAuthExpiredError("Gmail OAuth2 token expired") from e
    except HttpError as e:
        if e.resp.status == 401:
            raise GmailAuthExpiredError("Gmail OAuth2 token expired") from e
        raise


def check_reply(service, day1_message_id: str) -> bool:
    """Return True if the inbox contains a reply to day1_message_id."""
    try:
        query = f"in:inbox in-reply-to:{day1_message_id}"
        result = service.users().messages().list(userId="me", q=query).execute()
        return bool(result.get("messages"))
    except RefreshError as e:
        raise GmailAuthExpiredError("Gmail OAuth2 token expired") from e


def check_bounce(service, day1_message_id: str) -> bool:
    """Return True if a mailer-daemon bounce message referencing day1_message_id exists."""
    try:
        query = f"from:(mailer-daemon OR postmaster) in:inbox {day1_message_id}"
        result = service.users().messages().list(userId="me", q=query).execute()
        return bool(result.get("messages"))
    except RefreshError as e:
        raise GmailAuthExpiredError("Gmail OAuth2 token expired") from e
