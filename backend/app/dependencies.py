from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase

from .config import Settings, get_settings
from .errors import APIError
from .permissions import ensure_permissions, permissions_for
from .security import decode_token
from .utils import utcnow

bearer_scheme = HTTPBearer(auto_error=False)


def get_db(request: Request) -> AsyncDatabase:
    return request.app.state.db


DbDep = Annotated[AsyncDatabase, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_token_payload(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: SettingsDep,
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise APIError(401, "authentication_required", "Authentication is required.")
    return decode_token(settings, credentials.credentials, "access")


PayloadDep = Annotated[dict[str, Any], Depends(get_token_payload)]


async def get_current_user(database: DbDep, payload: PayloadDep) -> dict[str, Any]:
    user = await database.users.find_one({"_id": payload["sub"], "status": "active"})
    if user is None:
        raise APIError(401, "invalid_session", "The user session is no longer valid.")
    return user


UserDep = Annotated[dict[str, Any], Depends(get_current_user)]


@dataclass(frozen=True)
class AuthContext:
    user: dict[str, Any]
    company: dict[str, Any]
    membership: dict[str, Any]
    role: str
    permissions: list[str]
    token: dict[str, Any]

    def require(self, *permissions: str) -> None:
        ensure_permissions(self.permissions, *permissions)

    def require_any(self, *permissions: str) -> None:
        if not set(permissions).intersection(self.permissions):
            raise APIError(
                403,
                "forbidden",
                "You do not have permission to perform this action.",
            )

    @property
    def location_scope(self) -> frozenset[str] | None:
        location_ids = self.membership.get("location_ids") or self.membership.get("warehouse_ids") or []
        return frozenset(location_ids) if location_ids else None

    @property
    def warehouse_scope(self) -> frozenset[str] | None:
        warehouse_ids = self.membership.get("warehouse_ids") or self.membership.get("location_ids") or []
        return frozenset(warehouse_ids) if warehouse_ids else None

    @property
    def client_scope(self) -> frozenset[str] | None:
        client_ids = self.membership.get("client_ids") or []
        return frozenset(client_ids) if client_ids else None

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"


async def get_auth_context(
    database: DbDep,
    user: UserDep,
    payload: PayloadDep,
) -> AuthContext:
    company_id = payload["company_id"]
    company = await database.companies.find_one({"_id": company_id, "status": "active"})
    if company is None:
        raise APIError(401, "membership_inactive", "The company is inactive or not found.")

    membership = await database.memberships.find_one(
        {"company_id": company_id, "user_id": user["_id"]}
    )
    if membership is None:
        raise APIError(401, "membership_inactive", "The company membership is inactive.")

    mem_status = membership.get("status", "active")
    if mem_status == "suspended":
        raise APIError(
            403,
            "membership_suspended",
            "Your membership has been suspended. Please contact your company administrator.",
        )
    if mem_status != "active":
        raise APIError(401, "membership_inactive", "The company membership is inactive.")

    valid_until = membership.get("valid_until")
    if valid_until is not None:
        now = utcnow()
        if isinstance(valid_until, str):
            try:
                valid_until_dt = datetime.fromisoformat(valid_until.replace("Z", "+00:00"))
            except ValueError:
                valid_until_dt = None
        else:
            valid_until_dt = valid_until
        if valid_until_dt and valid_until_dt.tzinfo is None:
            valid_until_dt = valid_until_dt.replace(tzinfo=timezone.utc)
        if valid_until_dt and now > valid_until_dt:
            raise APIError(
                403,
                "membership_expired",
                "Your temporary access to this organization has expired.",
            )

    role = membership["role"]
    custom_perms: list[str] | None = None
    custom_role = await database.custom_roles.find_one(
        {"company_id": company_id, "slug": role, "is_active": {"$ne": False}}
    )
    if custom_role:
        custom_perms = custom_role.get("permissions", [])

    return AuthContext(
        user=user,
        company=company,
        membership=membership,
        role=role,
        permissions=permissions_for(role, custom_perms),
        token=payload,
    )


ContextDep = Annotated[AuthContext, Depends(get_auth_context)]
