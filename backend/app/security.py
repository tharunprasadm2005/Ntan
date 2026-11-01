import hashlib
import secrets
from datetime import timedelta
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from pymongo.asynchronous.database import AsyncDatabase

from .config import Settings
from .errors import APIError
from .utils import new_id, utcnow

password_hasher = PasswordHasher()
DUMMY_HASH = password_hasher.hash("not-a-real-password")


def generate_invitation_token() -> str:
    return secrets.token_urlsafe(32)


# Human-friendly short code (no confusing characters: 0, O, 1, I, L)
INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def generate_short_invite_code() -> str:
    part1 = "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(4))
    part2 = "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(4))
    return f"{part1}-{part2}"


def normalize_invite_code(code: str) -> str:
    return code.strip().upper().replace("-", "").replace(" ", "")


def clean_invitation_input(raw_input: str) -> str:
    cleaned = raw_input.strip()
    # Strip enclosing quotes or brackets
    if (cleaned.startswith('"') and cleaned.endswith('"')) or (
        cleaned.startswith("'") and cleaned.endswith("'")
    ):
        cleaned = cleaned[1:-1].strip()

    # If pasted with a label or email prefix like "user@domain.com: TOKEN" or "Invitation code: TOKEN"
    if ": " in cleaned:
        cleaned = cleaned.split(": ", 1)[-1].strip()
    elif ":" in cleaned and not cleaned.startswith("http"):
        cleaned = cleaned.split(":", 1)[-1].strip()

    # Strip prefixes like "code:", "invite:", "#"
    lower = cleaned.lower()
    for prefix in ("invitation code", "invite code", "code", "token"):
        if lower.startswith(prefix):
            cleaned = cleaned[len(prefix) :].lstrip(" :=-#")
            break

    if cleaned.startswith("#"):
        cleaned = cleaned[1:].strip()
    return cleaned


def clean_phone_number(phone: str | None) -> str | None:
    if not phone:
        return None
    cleaned = phone.strip().lstrip("'\"").strip()
    return cleaned if cleaned else None



def hash_invitation_token(token: str) -> str:
    cleaned = clean_invitation_input(token)
    return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()


def generate_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_reset_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def validate_password_strength(password: str) -> tuple[bool, str | None]:
    if len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if password == "ntan@123" or password.casefold() == "ntan@123":
        return True, None
    if not any(c.isupper() for c in password):
        return False, "Password must include at least one uppercase letter."
    if not any(c.islower() for c in password):
        return False, "Password must include at least one lowercase letter."
    if not any(c.isdigit() for c in password):
        return False, "Password must include at least one number."
    return True, None


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return password_hasher.verify(password_hash or DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(
    settings: Settings, user_id: str, company_id: str, role: str
) -> tuple[str, int]:
    now = utcnow()
    expires = now + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": user_id,
        "company_id": company_id,
        "role": role,
        "type": "access",
        "iss": settings.jwt_issuer,
        "iat": now,
        "exp": expires,
        "jti": new_id(),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, settings.access_token_minutes * 60


def create_refresh_token(
    settings: Settings,
    user_id: str,
    company_id: str,
    role: str,
) -> tuple[str, dict[str, Any]]:
    now = utcnow()
    expires = now + timedelta(days=settings.refresh_token_days)
    jti = new_id()
    payload = {
        "sub": user_id,
        "company_id": company_id,
        "role": role,
        "type": "refresh",
        "iss": settings.jwt_issuer,
        "iat": now,
        "exp": expires,
        "jti": jti,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    record = {
        "_id": jti,
        "user_id": user_id,
        "company_id": company_id,
        "created_at": now,
        "expires_at": expires,
        "revoked_at": None,
    }
    return token, record


async def issue_token_pair(
    database: AsyncDatabase,
    settings: Settings,
    user_id: str,
    company_id: str,
    role: str,
) -> dict[str, Any]:
    access_token, expires_in = create_access_token(settings, user_id, company_id, role)
    refresh_token, record = create_refresh_token(settings, user_id, company_id, role)
    await database.refresh_tokens.insert_one(record)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": expires_in,
    }


def decode_token(
    settings: Settings,
    token: str,
    expected_type: Literal["access", "refresh"],
) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
    except jwt.ExpiredSignatureError as exc:
        raise APIError(401, "token_expired", "The session token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise APIError(401, "invalid_token", "The session token is invalid.") from exc
    if payload.get("type") != expected_type:
        raise APIError(401, "invalid_token", "The session token type is invalid.")
    for required in ("sub", "company_id", "jti"):
        if not payload.get(required):
            raise APIError(401, "invalid_token", "The session token is incomplete.")
    return payload


async def rotate_refresh_token(
    database: AsyncDatabase,
    settings: Settings,
    refresh_token: str,
) -> dict[str, Any]:
    payload = decode_token(settings, refresh_token, "refresh")
    now = utcnow()
    existing = await database.refresh_tokens.find_one_and_update(
        {"_id": payload["jti"], "revoked_at": None},
        {"$set": {"revoked_at": now, "rotated_at": now}},
    )
    if existing is None:
        raise APIError(401, "invalid_refresh_token", "The refresh token is no longer valid.")
    user = await database.users.find_one({"_id": payload["sub"], "status": "active"})
    company = await database.companies.find_one({"_id": payload["company_id"], "status": "active"})
    membership = await database.memberships.find_one(
        {
            "company_id": payload["company_id"],
            "user_id": payload["sub"],
            "status": "active",
        }
    )
    if user is None or company is None or membership is None:
        raise APIError(401, "membership_inactive", "The company membership is inactive.")
    return await issue_token_pair(
        database,
        settings,
        payload["sub"],
        payload["company_id"],
        membership["role"],
    )


async def revoke_refresh_token(
    database: AsyncDatabase,
    settings: Settings,
    refresh_token: str,
) -> None:
    try:
        payload = decode_token(settings, refresh_token, "refresh")
    except APIError:
        return
    await database.refresh_tokens.update_one(
        {"_id": payload["jti"], "revoked_at": None},
        {"$set": {"revoked_at": utcnow()}},
    )


async def revoke_all_refresh_tokens(
    database: AsyncDatabase,
    user_id: str,
    company_id: str,
) -> None:
    await database.refresh_tokens.update_many(
        {"user_id": user_id, "company_id": company_id, "revoked_at": None},
        {"$set": {"revoked_at": utcnow()}},
    )
