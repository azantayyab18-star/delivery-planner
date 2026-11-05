"""Sign in with Google (Android) and Sign in with Apple (iPhone).

The app gets an ID token from the phone's Google / Apple sign-in and sends it here. We check its signature against the
provider's published keys, its issuer, its audience (our app) and its expiry, then sign the rider in: by the provider's
user id when it is already linked, else by email (linked on first use), else as a new rider account. No Google or Apple
API is called per sign-in apart from fetching the signing keys, which are cached.
"""
from __future__ import annotations

import asyncio
import secrets
from typing import Any

import jwt
from jwt import PyJWKClient

from ..config import env
from ..db import db
from ..errors import AppError, forbidden
from ..http import now
from . import auth_service as auth

PROVIDERS = {
    "google": {"jwks": "https://www.googleapis.com/oauth2/v3/certs", "issuers": ("https://accounts.google.com", "accounts.google.com"), "column": "googleSub"},
    "apple": {"jwks": "https://appleid.apple.com/auth/keys", "issuers": ("https://appleid.apple.com",), "column": "appleSub"},
}
# PyJWKClient caches the keys (and refetches when a token names a key it has not seen).
_clients = {name: PyJWKClient(p["jwks"], cache_keys=True, lifespan=6 * 3600, timeout=10) for name, p in PROVIDERS.items()}


def _audiences(provider: str) -> tuple[str, ...]:
    return env.GOOGLE_SIGNIN_CLIENT_IDS if provider == "google" else env.APPLE_SIGNIN_AUDIENCES


def _invalid() -> AppError:
    return AppError(401, "INVALID_SOCIAL_TOKEN", "Could not confirm your sign-in. Please try again.")


def _decode(provider: str, token: str, key: Any) -> dict:
    return jwt.decode(token, key, algorithms=["RS256"], audience=list(_audiences(provider)), issuer=list(PROVIDERS[provider]["issuers"]),
                      options={"require": ["exp", "iat", "iss", "aud", "sub"]}, leeway=60)


async def verify(provider: str, token: str) -> dict:
    """The token's claims when it is genuine, for our app and not expired; otherwise 401."""
    if not _audiences(provider):
        raise AppError(503, "SOCIAL_SIGNIN_OFF", f"Sign in with {provider.title()} is not set up yet. Use your email and password.")
    try:
        signing_key = await asyncio.to_thread(_clients[provider].get_signing_key_from_jwt, token)
        return _decode(provider, token, signing_key.key)
    except (jwt.PyJWTError, ValueError):
        raise _invalid() from None


async def sign_in(provider: str, token: str, *, full_name: str | None, ctx: dict) -> dict:
    claims = await verify(provider, token)
    sub = str(claims["sub"])
    email = (claims.get("email") or "").strip().lower()
    # Google says whether it checked the address; Apple's addresses (real or private relay) are always verified.
    verified = provider == "apple" or claims.get("email_verified") in (True, "true")
    column = PROVIDERS[provider]["column"]

    user = await db.user.find_unique(where={column: sub})
    created = False
    if not user:
        if not email or not verified:
            raise AppError(400, "EMAIL_NOT_VERIFIED", f"Your {provider.title()} account has no verified email. Sign up with your email instead.")
        user = await db.user.find_unique(where={"email": email})
        if user:
            if user.role != "rider":
                raise forbidden("Please sign in with a rider account.", "WRONG_CLIENT")
            # The same person (the provider confirmed they own this email): link the account for next time.
            user = await db.user.update(where={"id": user.id}, data={column: sub})
        else:
            name = (full_name or claims.get("name") or email.split("@")[0]).strip()[:120] or "Rider"
            # A random password the rider never sees; "Forgot password" can set a real one for email sign-in.
            user = await auth.create_rider_account(full_name=name, email=email, password=secrets.token_urlsafe(32))
            user = await db.user.update(where={"id": user.id}, data={column: sub})
            created = True

    if user.status != "active":
        raise forbidden("Your account is suspended. Contact support.", "ACCOUNT_SUSPENDED")
    if user.role != "rider":
        raise forbidden("Please sign in with a rider account.", "WRONG_CLIENT")
    user = await db.user.update(where={"id": user.id}, data={"failedLoginCount": 0, "lockedUntil": None, "lastActiveAt": now()})
    tokens = await auth._issue_tokens(user, user_agent=ctx.get("userAgent"))
    if created:
        await auth._send_welcome(user)
    return {"user": auth.serialize_user(user), "created": created, **tokens}
