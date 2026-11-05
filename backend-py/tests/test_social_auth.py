"""Continue with Google / Sign in with Apple: token checks, new accounts, linking by email, and refusals."""
from __future__ import annotations

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import env
from app.db import db
from app.services import social_auth

from .test_api import rider

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
GOOGLE_CLIENT = "123-web.apps.googleusercontent.com"


@pytest.fixture(autouse=True)
def providers(monkeypatch):
    """Our test key stands in for Google's and Apple's published keys; Google sign-in is switched on."""
    saved = env.GOOGLE_SIGNIN_CLIENT_IDS
    object.__setattr__(env, "GOOGLE_SIGNIN_CLIENT_IDS", (GOOGLE_CLIENT,))
    for client in social_auth._clients.values():
        monkeypatch.setattr(client, "get_signing_key_from_jwt", lambda _token: SimpleNamespace(key=KEY.public_key()))
    yield
    object.__setattr__(env, "GOOGLE_SIGNIN_CLIENT_IDS", saved)


def token(provider: str, sub: str, email: str | None, *, key=KEY, aud: str | None = None, verified=True, expires_in=600, **extra) -> str:
    iss = "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com"
    claims = {"iss": iss, "aud": aud or (GOOGLE_CLIENT if provider == "google" else env.APPLE_SIGNIN_AUDIENCES[0]), "sub": sub,
              "iat": int(time.time()), "exp": int(time.time()) + expires_in, **extra}
    if email:
        claims["email"] = email
        if provider == "google":
            claims["email_verified"] = verified
    return jwt.encode(claims, key, algorithm="RS256")


async def test_google_creates_a_rider_then_signs_them_in_again(client):
    first = await client.post("/api/v1/auth/google", json={"idToken": token("google", "g-1", "New.Rider@Gmail.com", name="New Rider")})
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["created"] is True and data["user"]["email"] == "new.rider@gmail.com" and data["user"]["fullName"] == "New Rider"
    assert data["accessToken"] and data["refreshToken"]
    # New riders start without a plan, as with email sign-up.
    me = await client.get("/api/v1/subscriptions/me", headers={"Authorization": f"Bearer {data['accessToken']}"})
    assert me.json()["data"]["subscription"]["status"] == "inactive"

    again = (await client.post("/api/v1/auth/google", json={"idToken": token("google", "g-1", "new.rider@gmail.com")})).json()["data"]
    assert again["created"] is False and again["user"]["id"] == data["user"]["id"]


async def test_an_existing_email_account_is_linked(client):
    body, _ = await rider(client, "linked@example.com")
    res = (await client.post("/api/v1/auth/apple", json={"idToken": token("apple", "a-1", "linked@example.com"), "fullName": "Ignored"})).json()["data"]
    assert res["created"] is False and res["user"]["id"] == body["user"]["id"] and res["user"]["fullName"] == body["user"]["fullName"]
    assert (await db.user.find_unique(where={"id": body["user"]["id"]})).appleSub == "a-1"
    # Later Apple tokens may leave the email out: the linked id is enough.
    later = (await client.post("/api/v1/auth/apple", json={"idToken": token("apple", "a-1", None)})).json()["data"]
    assert later["user"]["id"] == body["user"]["id"]


async def test_apple_uses_the_name_the_app_sends(client):
    res = (await client.post("/api/v1/auth/apple", json={"idToken": token("apple", "a-2", "x1y2@privaterelay.appleid.com"), "fullName": "Aoife Byrne"})).json()["data"]
    assert res["created"] is True and res["user"]["fullName"] == "Aoife Byrne"


@pytest.mark.parametrize("bad", [
    {"key": OTHER_KEY},                       # not signed by the provider
    {"aud": "someone-elses-app"},             # issued to another app
    {"expires_in": -3600},                    # expired
])
async def test_forged_or_foreign_tokens_are_refused(client, bad):
    res = await client.post("/api/v1/auth/google", json={"idToken": token("google", "g-bad", "bad@example.com", **bad)})
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_SOCIAL_TOKEN"
    assert not await db.user.find_unique(where={"email": "bad@example.com"})


async def test_an_unverified_google_email_is_not_linked_or_used(client):
    await rider(client, "victim@example.com")
    res = await client.post("/api/v1/auth/google", json={"idToken": token("google", "g-x", "victim@example.com", verified=False)})
    assert res.status_code == 400 and res.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"
    assert (await db.user.find_unique(where={"email": "victim@example.com"})).googleSub is None


async def test_google_sign_in_is_off_until_configured(client):
    object.__setattr__(env, "GOOGLE_SIGNIN_CLIENT_IDS", ())
    res = await client.post("/api/v1/auth/google", json={"idToken": token("google", "g-off", "off@example.com")})
    assert res.status_code == 503 and res.json()["error"]["code"] == "SOCIAL_SIGNIN_OFF"
