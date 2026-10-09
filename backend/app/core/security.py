"""Supabase JWT verification + RBAC (project.md §4, §32). Issue #8.

Supabase Auth issues JWTs in two flavours (both accepted here):

* **Legacy HS256**, signed with ``SUPABASE_JWT_SECRET`` (backend-minted
  tokens from ``POST /auth/login`` and the seeded demo tokens).
* **Modern ES256/RS256**, signed by GoTrue's asymmetric keys and verified
  against its JWKS (``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``).
  Current Supabase CLI stacks issue these — including self-signup sessions,
  which carry role/facility in ``user_metadata`` (the client SDK cannot write
  ``app_metadata``).

    app_metadata: {"role": "ADMIN" | "FACILITY_MANAGER" | "ANALYST",
                   "facility_id": "<uuid>" | null}

FastAPI verifies the signature, builds a :class:`CurrentUser`, and enforces
the role model per project.md §4:

* ``ADMIN``            → everything, including runs/writes
* ``FACILITY_MANAGER`` → reads (facility scoping enforced by RLS + services)
* ``ANALYST``          → reads (network-wide analytics)

Role + facility are read from ``app_metadata`` first, then fall back to
``user_metadata`` (populated from the self-signup form via the client SDK,
which cannot write ``app_metadata``), then to top-level claims.

Usage on a route::

    @router.get("/x", dependencies=[Depends(require_read)])
    @router.post("/run", dependencies=[Depends(require_admin)])
"""

import logging
from collections.abc import Callable

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.entities import Hospital

logger = logging.getLogger("app.security")

ROLE_ADMIN = "ADMIN"
ROLE_FACILITY_MANAGER = "FACILITY_MANAGER"
ROLE_ANALYST = "ANALYST"
ALL_ROLES = (ROLE_ADMIN, ROLE_FACILITY_MANAGER, ROLE_ANALYST)

#: Reads are open to every authenticated role (§4: everyone views/inspects).
READ_ROLES = ALL_ROLES
#: Writes/runs (forecast runs, optimization, scenarios, record creation) are
#: ADMIN-only in the MVP — §4 grants run powers to Administrator only.
WRITE_ROLES = (ROLE_ADMIN,)

bearer_scheme = HTTPBearer(
    auto_error=False,
    description="Supabase JWT: Authorization: Bearer <supabase-jwt> (project.md §32)",
)


class CurrentUser(BaseModel):
    """Caller identity extracted from a verified Supabase JWT."""

    user_id: str
    email: str | None = None
    role: str
    facility_id: str | None = None


def jwt_secret_configured() -> bool:
    """True once SUPABASE_JWT_SECRET is present."""
    return bool(settings.SUPABASE_JWT_SECRET)


def create_access_token(
    user_id: str,
    email: str,
    role: str,
    facility_id: str | None = None,
    expires_in_seconds: int = 86400,
) -> str:
    """Mint a Supabase-compatible JWT token signed with SUPABASE_JWT_SECRET."""
    secret = settings.SUPABASE_JWT_SECRET
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET is not configured on the server",
        )
    import time
    now = int(time.time())
    payload = {
        "sub": user_id,
        "email": email,
        "aud": "authenticated",
        "iat": now,
        "exp": now + expires_in_seconds,
        "app_metadata": {
            "role": role,
            "facility_id": facility_id,
        },
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _jwks_url() -> str:
    """JWKS endpoint for asymmetric Supabase tokens (explicit override wins)."""
    if settings.SUPABASE_JWKS_URL:
        return settings.SUPABASE_JWKS_URL
    return f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"


_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """Cached JWKS client (keys cached by kid; refreshes on miss)."""
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(_jwks_url())
    return _jwks_client


def verify_token(token: str) -> dict:
    """Verify a Supabase-issued JWT and return its claims.

    Asymmetric (ES256/RS256) tokens go through JWKS; HS256 tokens use the
    shared secret. Raises:
        HTTPException: 401 when auth is unconfigured, the token is expired,
            or the signature/claims are invalid.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}"
        ) from exc
    try:
        if alg in ("ES256", "ES384", "RS256"):
            key = _get_jwks_client().get_signing_key_from_jwt(token).key
            claims: dict = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        else:
            secret = settings.SUPABASE_JWT_SECRET
            if not secret:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Auth is not configured (SUPABASE_JWT_SECRET missing)",
                )
            claims = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}"
        ) from exc
    return claims


def user_from_claims(claims: dict) -> CurrentUser:
    """Build a :class:`CurrentUser` from verified JWT claims (401 on bad claims)."""
    app_metadata = claims.get("app_metadata") or {}
    user_metadata = claims.get("user_metadata") or {}
    role = (
        app_metadata.get("role")
        or user_metadata.get("role")
        or claims.get("role")
    )
    facility_id = (
        app_metadata.get("facility_id")
        or user_metadata.get("facility_id")
        or claims.get("facility_id")
    )
    if role not in ALL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unknown or missing role claim: {role!r}",
        )
    return CurrentUser(
        user_id=str(claims.get("sub")),
        email=claims.get("email"),
        role=role,
        facility_id=str(facility_id) if facility_id else None,
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    """FastAPI dependency: verified caller or 401 (missing/invalid/expired)."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated: missing Bearer token",
        )
    return user_from_claims(verify_token(credentials.credentials))


def require_roles(*allowed: str) -> Callable:
    """Dependency factory: 403 unless the caller's role is in ``allowed``."""

    async def _check(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {user.role} is not allowed here (needs one of {list(allowed)})",
            )
        return user

    return _check


#: Ready-made dependencies: ``dependencies=[Depends(require_read)]`` on GETs,
#: ``dependencies=[Depends(require_admin)]`` on POSTs/runs.
require_read = require_roles(*READ_ROLES)
require_admin = require_roles(*WRITE_ROLES)


class HelpdeskScope(BaseModel):
    """Hospital scope for Helpdesk queries, resolved on the backend.

    Never trusts the payload: derived from a valid Supabase JWT's
    ``facility_id`` when present, otherwise from the ``X-Hospital-Id`` header.
    The resolved facility must exist in the DB or the request is rejected.
    """

    hospital_id: str
    hospital_name: str
    role: str | None = None


def get_helpdesk_scope(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    hospital_id: str | None = Header(default=None, alias="X-Hospital-Id"),
    db: Session = Depends(get_db),
) -> HelpdeskScope:
    """Resolve the caller's hospital scope (JWT authoritative, else header).

    Only ever scopes to ONE hospital — there is no network-wide path.
    """
    resolved_id: str | None = None
    role: str | None = None

    has_bearer = credentials is not None and bool(credentials.credentials)
    if has_bearer:
        user = user_from_claims(verify_token(credentials.credentials))
        if not user.facility_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has no facility scope",
            )
        resolved_id, role = user.facility_id, user.role
    elif hospital_id:
        resolved_id = hospital_id.strip() or None

    if not resolved_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Hospital scope required: valid Bearer JWT or X-Hospital-Id header",
        )

    hospital = db.query(Hospital).filter(Hospital.id == resolved_id).first()
    if hospital is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unknown hospital scope: {resolved_id!r}",
        )
    return HelpdeskScope(
        hospital_id=hospital.id,
        hospital_name=hospital.name,
        role=role,
    )
