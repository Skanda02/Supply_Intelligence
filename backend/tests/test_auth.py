"""Auth tests — JWT verification + RBAC (issue #8 acceptance criteria).

Covers: valid token passes (per role), missing/invalid/expired → 401,
wrong role on admin-only routes → 403, /health stays public, /me reflects
the caller, OpenAPI exposes the Bearer security scheme.
"""

import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core import security
from app.core.config import settings
from app.main import app

TEST_SECRET = "test-jwt-secret-for-issue-8-32bytes!!"

client = TestClient(app)


@pytest.fixture(autouse=True)
def _test_secret(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", TEST_SECRET)


def mint(role: str, facility_id: str | None = None, expired: bool = False) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "email": f"{role.lower()}@demo.local",
            "aud": "authenticated",
            "iat": now - (7200 if expired else 0),
            "exp": now - 10 if expired else now + 3600,
            "app_metadata": {
                "role": role,
                "facility_id": facility_id,
            },
        },
        TEST_SECRET,
        algorithm="HS256",
    )


def auth_headers(role: str, **kwargs) -> dict:
    return {"Authorization": f"Bearer {mint(role, **kwargs)}"}


def mint_metadata(
    app_metadata: dict | None = None,
    user_metadata: dict | None = None,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "email": "self-signed@demo.local",
            "aud": "authenticated",
            "iat": now,
            "exp": now + 3600,
            **({"app_metadata": app_metadata} if app_metadata else {}),
            **({"user_metadata": user_metadata} if user_metadata else {}),
        },
        TEST_SECRET,
        algorithm="HS256",
    )


def test_user_metadata_used_when_app_metadata_absent() -> None:
    """Client SDK can't write app_metadata; self-signup lands in user_metadata."""
    token = mint_metadata(user_metadata={"role": "ANALYST", "facility_id": "H02"})
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "ANALYST"
    assert body["facility_id"] == "H02"


def test_user_metadata_scope_drives_helpdesk() -> None:
    token = mint_metadata(user_metadata={"role": "FACILITY_MANAGER", "facility_id": "H01"})
    resp = client.get(
        "/api/v1/helpdesk/capabilities",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200


def test_app_metadata_takes_precedence_over_user_metadata() -> None:
    token = mint_metadata(
        app_metadata={"role": "ADMIN", "facility_id": "H01"},
        user_metadata={"role": "ANALYST", "facility_id": "H02"},
    )
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "ADMIN"
    assert body["facility_id"] == "H01"


def test_user_metadata_unknown_role_is_401() -> None:
    token = mint_metadata(user_metadata={"role": "SUPERUSER"})
    resp = client.get("/api/state", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_health_is_public() -> None:
    assert client.get("/health").status_code == 200


def test_missing_token_is_401() -> None:
    assert client.get("/api/state").status_code == 401


def test_invalid_token_is_401() -> None:
    resp = client.get("/api/state", headers={"Authorization": "Bearer garbage.token.here"})
    assert resp.status_code == 401


def test_expired_token_is_401() -> None:
    resp = client.get("/api/state", headers=auth_headers("ADMIN", expired=True))
    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


def test_unknown_role_is_401() -> None:
    token = jwt.encode(
        {
            "sub": "u1",
            "aud": "authenticated",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
            "app_metadata": {"role": "SUPERUSER"},
        },
        TEST_SECRET,
        algorithm="HS256",
    )
    resp = client.get("/api/state", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_all_roles_can_read() -> None:
    for role in ("ADMIN", "FACILITY_MANAGER", "ANALYST"):
        resp = client.get("/api/state", headers=auth_headers(role))
        assert resp.status_code == 200, f"{role} should read /api/state"


def test_me_reflects_caller() -> None:
    fid = "00000000-0000-0000-0000-00000000fac1"
    resp = client.get("/api/v1/auth/me", headers=auth_headers("FACILITY_MANAGER", facility_id=fid))
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "FACILITY_MANAGER"
    assert body["facility_id"] == fid


def test_admin_can_run_optimize() -> None:
    resp = client.post(
        "/api/redistribution/optimize",
        json={"scenario": "outbreak"},
        headers=auth_headers("ADMIN"),
    )
    assert resp.status_code == 200


def test_analyst_and_manager_cannot_run_optimize() -> None:
    for role in ("ANALYST", "FACILITY_MANAGER"):
        resp = client.post(
            "/api/redistribution/optimize",
            json={"scenario": "outbreak"},
            headers=auth_headers(role),
        )
        assert resp.status_code == 403, f"{role} should be forbidden from optimize"


def test_analyst_cannot_create_scenario() -> None:
    resp = client.post(
        "/api/v1/scenarios",
        json={"name": "t", "scenario": "combined"},
        headers=auth_headers("ANALYST"),
    )
    assert resp.status_code == 403


def test_openapi_has_bearer_security_scheme() -> None:
    spec = client.get("/openapi.json").json()
    schemes = spec.get("components", {}).get("securitySchemes", {})
    assert "HTTPBearer" in schemes


def test_auth_unconfigured_is_401(monkeypatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", "")
    resp = client.get("/api/state", headers=auth_headers("ADMIN"))
    assert resp.status_code == 401
    assert security.jwt_secret_configured() is False


def test_login_hospital_success() -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "H01", "password": "supplyPass2026!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["role"] == "FACILITY_MANAGER"
    assert data["user"]["facility_id"] == "H01"

    # Token can access /api/v1/auth/me
    token = data["access_token"]
    me_resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["facility_id"] == "H01"


def test_login_admin_success() -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@medipulse.health", "password": "supplyPass2026!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["role"] == "ADMIN"

    # Admin can call /api/redistribution/optimize
    token = data["access_token"]
    opt_resp = client.post(
        "/api/redistribution/optimize",
        json={"scenario": "outbreak"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert opt_resp.status_code == 200


def test_login_invalid_password() -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "H01", "password": "wrong_password"},
    )
    assert resp.status_code == 401


def test_login_unknown_user() -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "nonexistent@hospital.org", "password": "supplyPass2026!"},
    )
    assert resp.status_code == 401


READ_ONLY_ENDPOINTS = (
    ("get", "/api/v1/dashboard"),
    ("get", "/api/v1/hospitals"),
    ("get", "/api/v1/hospitals/H01"),
    ("get", "/api/v1/medicines"),
    ("get", "/api/v1/medicines/M001"),
    ("get", "/api/v1/inventory"),
    ("get", "/api/v1/inventory/H01/M001"),
    ("get", "/api/v1/procurement/recommendations"),
    ("get", "/api/v1/procurement/redistribution"),
    ("get", "/api/v1/risks/stockout"),
    ("get", "/api/v1/risks/expiry"),
    ("get", "/api/dashboard"),
    ("get", "/api/hospitals"),
    ("get", "/api/medicines"),
    ("get", "/api/procurement/recommendations"),
)


@pytest.mark.parametrize("method,path", READ_ONLY_ENDPOINTS)
def test_readonly_routes_require_auth(method, path):
    resp = getattr(client, method)(path)
    assert resp.status_code == 401


@pytest.mark.parametrize("method,path", READ_ONLY_ENDPOINTS)
def test_readonly_routes_open_to_all_roles(method, path):
    for role in ("ADMIN", "FACILITY_MANAGER", "ANALYST"):
        resp = getattr(client, method)(path, headers=auth_headers(role))
        assert resp.status_code not in (401, 403), f"{role} {method} {path} -> {resp.status_code}"


class _FakeJWK:
    def __init__(self, key):
        self.key = key


class _FakeJWKSClient:
    def __init__(self, key):
        self._key = key

    def get_signing_key_from_jwt(self, token):
        return _FakeJWK(self._key)


def _mint_es256(private_pem: str, role: str = "ANALYST") -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "aud": "authenticated",
            "iat": now,
            "exp": now + 3600,
            "user_metadata": {"role": role, "facility_id": None},
        },
        private_pem,
        algorithm="ES256",
    )


def test_es256_token_verified_via_jwks(monkeypatch):
    """Regression: Supabase CLI (ES256) session tokens must authenticate."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(public_pem))

    claims = security.verify_token(_mint_es256(private_pem))
    user = security.user_from_claims(claims)
    assert user.role == "ANALYST"

    resp = client.get("/api/hospitals", headers={"Authorization": f"Bearer {_mint_es256(private_pem)}"})
    assert resp.status_code == 200


def test_es256_wrong_key_rejected(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    def pem(key):
        return key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

    signer = ec.generate_private_key(ec.SECP256R1())
    other = ec.generate_private_key(ec.SECP256R1())
    other_public = other.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(other_public))

    with pytest.raises(Exception) as exc_info:
        security.verify_token(_mint_es256(pem(signer)))
    assert getattr(exc_info.value, "status_code", None) == 401
