"""LinkedIn OAuth API client for connection request sending (F5)."""
from __future__ import annotations

import httpx
import structlog

logger = structlog.get_logger(__name__)

INVITATIONS_URL = "https://api.linkedin.com/v2/invitations"


class LinkedInRateLimitError(Exception):
    """Raised when LinkedIn returns HTTP 429."""


class LinkedInAPIError(Exception):
    """Raised on non-429 LinkedIn API errors."""


async def send_connection_request(
    access_token: str,
    profile_id: str,
    message: str,
) -> str:
    """Send a LinkedIn connection request.

    Returns the LinkedIn invitation ID on success.
    Raises LinkedInRateLimitError on 429, LinkedInAPIError on other errors.
    """
    payload = {
        "invitee": {
            "com.linkedin.voyager.growth.invitation.InviteeProfile": {
                "profileId": profile_id,
            }
        },
        "message": message,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            INVITATIONS_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code == 429:
        logger.warning("linkedin.rate_limit", endpoint="send_invitation", profile_id=profile_id)
        raise LinkedInRateLimitError("LinkedIn connection request rate limit hit")

    if not resp.is_success:
        logger.error(
            "linkedin.error",
            endpoint="send_invitation",
            status=resp.status_code,
            profile_id=profile_id,
            body=resp.text[:200],
        )
        raise LinkedInAPIError(f"LinkedIn API error {resp.status_code}: {resp.text[:200]}")

    data          = resp.json()
    invitation_id = str(data.get("id", ""))
    logger.info("linkedin.invitation_sent", profile_id=profile_id, invitation_id=invitation_id)
    return invitation_id


async def get_invitation_status(
    access_token: str,
    invitation_id: str,
) -> str:
    """Poll the status of a sent LinkedIn invitation.

    Returns one of: PENDING | ACCEPTED | WITHDRAWN | EXPIRED
    Raises LinkedInAPIError on non-200 responses.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{INVITATIONS_URL}/{invitation_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if not resp.is_success:
        logger.error(
            "linkedin.error",
            endpoint="get_invitation",
            status=resp.status_code,
            invitation_id=invitation_id,
        )
        raise LinkedInAPIError(f"LinkedIn API error {resp.status_code}")

    data   = resp.json()
    status = data.get("invitationState", "PENDING")
    logger.info("linkedin.invitation_status", invitation_id=invitation_id, status=status)
    return status
