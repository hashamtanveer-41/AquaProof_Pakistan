"""Password sign-in and persistent HTTP-only browser sessions."""

import hashlib
import hmac
import os
import re
import secrets
import time
from getpass import getpass
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

COOKIE_NAME = "aquaproof_officer_session"
SESSION_SECONDS = 14 * 24 * 60 * 60
PASSWORD_FORMAT = re.compile(r"([0-9a-f]{32}):([0-9a-f]{64})")
SESSION_FORMAT = re.compile(r"([0-9]{1,12}\.[A-Za-z0-9_-]{24})\.([0-9a-f]{64})")
PUBLIC_PATHS = frozenset(("/api/auth/sign-in", "/api/auth/sign-out"))
SAFE_METHODS = frozenset(("GET", "HEAD", "OPTIONS"))

router = APIRouter(prefix="/api/auth", tags=["officer sign-in"])


def password_hash(password, salt=None):
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"{salt.hex()}:{digest.hex()}"


def login_required():
    # Officer sign-in is opt-in. By default the workspace opens without a password so the software
    # starts right away (demo/hackathon friendly). Set AQUAPROOF_REQUIRE_LOGIN=1 to restore the gate.
    return os.getenv("AQUAPROOF_REQUIRE_LOGIN", "0") == "1"


def config():
    verifier = os.getenv("AQUAPROOF_OFFICER_PASSWORD_HASH", "")
    secret = os.getenv("AQUAPROOF_SESSION_SECRET", "")
    if not PASSWORD_FORMAT.fullmatch(verifier) or len(secret) < 32:
        return None
    return verifier, secret


def signature(session, verifier, secret):
    return hmac.new(secret.encode(), f"{verifier}:{session}".encode(), hashlib.sha256).hexdigest()


def authorized(cookie):
    settings = config()
    match = SESSION_FORMAT.fullmatch(cookie or "")
    if not settings or not match:
        return False
    session, supplied = match.groups()
    return int(session.split(".", 1)[0]) > time.time() and hmac.compare_digest(
        supplied, signature(session, *settings),
    )


def secure_cookie(request):
    return os.getenv("AQUAPROOF_SECURE_COOKIES", "0") == "1" or request.url.scheme == "https"


def trusted_origins():
    # Front ends served from a different host (e.g. Vercel proxying /api to a Render backend)
    # present their own Origin. Trust the explicitly configured site origins in addition to the
    # backend's own host. Empty by default, so a single-origin deployment keeps same-host-only writes.
    raw = os.getenv("CORS_ORIGINS", "")
    return {origin.strip().rstrip("/").lower() for origin in raw.split(",") if origin.strip()}


def trusted_write(request):
    if request.method in SAFE_METHODS:
        return True
    origin = request.headers.get("Origin")
    if origin is None:
        return request.headers.get("Sec-Fetch-Site") not in ("cross-site", "same-site")
    try:
        target = urlsplit(origin)
        scheme = "https" if secure_cookie(request) else request.url.scheme
        if target.scheme == scheme and target.netloc.lower() == request.url.netloc.lower():
            return True
        return origin.rstrip("/").lower() in trusted_origins()
    except ValueError:
        return False


class SignIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


@router.post("/sign-in")
def sign_in(payload: SignIn, request: Request, response: Response):
    settings = config()
    if not settings:
        raise HTTPException(503, "Officer sign-in has not been configured.")
    verifier, secret = settings
    try:
        candidate = password_hash(payload.password, bytes.fromhex(verifier.split(":", 1)[0]))
    except UnicodeError:
        raise HTTPException(401, "Incorrect officer password.") from None
    if not hmac.compare_digest(candidate, verifier):
        raise HTTPException(401, "Incorrect officer password.")
    session = f"{int(time.time()) + SESSION_SECONDS}.{secrets.token_urlsafe(18)}"
    value = f"{session}.{signature(session, verifier, secret)}"
    response.set_cookie(COOKIE_NAME, value, max_age=SESSION_SECONDS, path="/api",
                        httponly=True, samesite="strict", secure=secure_cookie(request))
    return {"status": "signed_in"}


@router.post("/sign-out")
def sign_out(request: Request, response: Response):
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True, samesite="strict",
                           secure=secure_cookie(request))
    return {"status": "signed_out"}


if __name__ == "__main__":
    password = getpass("Choose an officer password (at least 12 characters): ")
    if not 12 <= len(password) <= 256 or password != getpass("Repeat the officer password: "):
        raise SystemExit("Choose a matching password between 12 and 256 characters.")
    print("AQUAPROOF_OFFICER_PASSWORD_HASH=" + password_hash(password))
