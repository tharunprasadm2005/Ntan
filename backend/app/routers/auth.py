from datetime import timedelta
import hashlib
from typing import Any

from fastapi import APIRouter, Request, Response, status
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep, SettingsDep, UserDep
from ..errors import APIError
from ..permissions import ROLE_LABELS
from ..rate_limit import clear_rate_limit, enforce_rate_limit
from ..schemas import (
    AuthResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    InvitationAcceptRequest,
    InvitationPreviewRequest,
    InvitationPreviewResponse,
    LoginRequest,
    LogoutRequest,
    MembershipOut,
    RefreshRequest,
    RegisterCompanyRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    SessionResponse,
    TokenResponse,
    UserCheckRequest,
    UserCheckResponse,
    UserOut,
    UserUpdate,
)
from ..security import (
    clean_invitation_input,
    generate_reset_code,
    hash_invitation_token,
    hash_password,
    hash_reset_code,
    issue_token_pair,
    normalize_invite_code,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
    validate_password_strength,
    verify_password,
)
from ..serializers import client_out, company_out, membership_out, user_out
from ..services.clients import ensure_internal_client
from ..services.email import send_password_reset_email
from ..utils import new_id, utcnow
from .warehouses import _build_initial_locations

router = APIRouter(prefix="/auth", tags=["auth"])


def _membership(document: dict[str, Any], company_name: str | None) -> MembershipOut:
    return membership_out(document, company_name)


async def _auth_response(
    database: Any,
    settings: Any,
    user: dict[str, Any],
    company: dict[str, Any],
    membership: dict[str, Any],
) -> AuthResponse:
    tokens = await issue_token_pair(
        database,
        settings,
        user["_id"],
        company["_id"],
        membership["role"],
    )
    return AuthResponse(
        **tokens,
        user=user_out(user),
        company=company_out(company),
        membership=_membership(membership, company.get("name")),
    )


@router.post("/register-company", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_company(
    payload: RegisterCompanyRequest,
    request: Request,
    database: DbDep,
    settings: SettingsDep,
) -> AuthResponse:
    email = str(payload.email).lower()
    valid, strength_err = validate_password_strength(payload.password)
    if not valid:
        raise APIError(
            422,
            "weak_password",
            strength_err or "Password is not strong enough.",
            {"password": strength_err or "Password is not strong enough."},
        )
    existing = await database.users.find_one({"email": email})
    if existing is not None:
        raise APIError(
            409, "email_already_registered", "An account with this email already exists."
        )

    now = utcnow()
    company = {
        "_id": new_id(),
        "name": payload.company_name,
        "currency": payload.currency,
        "timezone": payload.timezone,
        "inventory_model": payload.inventory_model,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    user = {
        "_id": new_id(),
        "name": payload.name,
        "email": email,
        "phone": payload.phone.strip() if payload.phone else None,
        "password_hash": hash_password(payload.password),
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    warehouse: dict[str, Any] | None = None
    default_locations: list[dict[str, Any]] = []
    if payload.warehouse_name:
        layout = payload.warehouse_layout
        if payload.warehouse_category:
            if payload.warehouse_category in ("all_in_one", "multi_zone", "bulk_storage"):
                layout = payload.warehouse_category
            elif payload.warehouse_category in ("main", "finished_goods"):
                layout = "bulk_storage"
            elif payload.warehouse_category in ("receiving", "project_site", "bin"):
                layout = "all_in_one"
                if not payload.location_code:
                    payload.location_code = "RECV" if payload.warehouse_category == "receiving" else ("SITE-01" if payload.warehouse_category == "project_site" else "BIN-01")

        wh_code = (payload.warehouse_code or "WH-01").strip().upper()
        warehouse = {
            "_id": new_id(),
            "company_id": company["_id"],
            "code": wh_code,
            "name": payload.warehouse_name,
            "name_key": payload.warehouse_name.casefold(),
            "address": payload.warehouse_address,
            "warehouse_type": payload.warehouse_type,
            "warehouse_layout": layout,
            "status": "active",
            "created_at": now,
            "updated_at": now,
            "created_by": user["_id"],
        }
        custom_code = (payload.location_code or "").strip().upper()

        if payload.initial_locations is not None:
            default_locations = _build_initial_locations(
                company_id=company["_id"],
                warehouse_id=warehouse["_id"],
                initial_locations=payload.initial_locations,
                existing_locations=[],
                now=now,
            )
        elif layout == "all_in_one":
            code = custom_code or "FLOOR"
            default_locations = [
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": code,
                    "path": code,
                    "barcode": None,
                    "type": "main",
                    "is_pickable": True,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                }
            ]
        elif layout == "bulk_storage":
            default_locations = [
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": "RECV",
                    "path": "RECV",
                    "barcode": None,
                    "type": "receiving",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": custom_code or "MAIN",
                    "path": custom_code or "MAIN",
                    "barcode": None,
                    "type": "main",
                    "is_pickable": True,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": "DISP",
                    "path": "DISP",
                    "barcode": None,
                    "type": "dispatch",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
            ]
        else:
            # "multi_zone": Receiving Dock -> Main Racks -> Picking Bins -> Dispatch
            main_location_id = new_id()
            default_locations = [
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": "RECV",
                    "path": "RECV",
                    "barcode": None,
                    "type": "receiving",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": main_location_id,
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": "MAIN",
                    "path": "MAIN",
                    "barcode": None,
                    "type": "main",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": main_location_id,
                    "code": custom_code or "BIN-01",
                    "path": f"MAIN/{custom_code or 'BIN-01'}",
                    "barcode": None,
                    "type": "bin",
                    "is_pickable": True,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": new_id(),
                    "company_id": company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": None,
                    "code": "DISP",
                    "path": "DISP",
                    "barcode": None,
                    "type": "dispatch",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
            ]
    membership = {
        "_id": new_id(),
        "company_id": company["_id"],
        "user_id": user["_id"],
        "role": "owner",
        "location_ids": [],
        "client_ids": [],
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }

    async def create_account(session: Any) -> None:
        await database.companies.insert_one(company, session=session)
        if warehouse is not None:
            await database.warehouses.insert_one(warehouse, session=session)
            await database.locations.insert_many(default_locations, session=session)
        await database.users.insert_one(user, session=session)
        await ensure_internal_client(database, company["_id"], session=session)
        await database.memberships.insert_one(membership, session=session)

    try:
        async with database.client.start_session() as session:
            await session.with_transaction(create_account)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "account_already_exists",
            "An account with this email already exists.",
        ) from exc

    await record_audit(
        database,
        company_id=company["_id"],
        actor_id=user["_id"],
        action="company.registered",
        entity="company",
        entity_id=company["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={"name": company["name"], "currency": company["currency"]},
    )
    if warehouse is not None:
        await record_audit(
            database,
            company_id=company["_id"],
            actor_id=user["_id"],
            action="warehouse.created",
            entity="warehouse",
            entity_id=warehouse["_id"],
            request_id=getattr(request.state, "request_id", None),
            after={"name": warehouse["name"], "address": warehouse["address"]},
        )
    await record_audit(
        database,
        company_id=company["_id"],
        actor_id=user["_id"],
        action="membership.role_assigned",
        entity="membership",
        entity_id=membership["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={"role": "owner", "location_ids": []},
    )
    return await _auth_response(database, settings, user, company, membership)


async def _resolve_invitation(database: Any, raw_input: str) -> dict[str, Any]:
    cleaned = clean_invitation_input(raw_input)
    if not cleaned:
        raise APIError(404, "invalid_invitation", "Please provide a valid invitation code.")

    token_hash = hash_invitation_token(cleaned)
    normalized_code = normalize_invite_code(cleaned)

    # Search by token hash or by short invite code
    invitation = await database.invitations.find_one(
        {
            "$or": [
                {"token_hash": token_hash},
                {"normalized_invite_code": normalized_code},
                {"invite_code": cleaned},
                {"invite_code": cleaned.upper()},
            ]
        }
    )

    if invitation is None:
        raise APIError(
            404,
            "invalid_invitation",
            "Invitation code not recognized. Check the code or scan the invitation QR code.",
        )

    if invitation.get("accepted_at") is not None:
        raise APIError(
            404,
            "invalid_invitation",
            "This invitation has already been accepted. Sign in with your existing account.",
        )

    if invitation.get("revoked_at") is not None:
        raise APIError(
            404,
            "invalid_invitation",
            "This invitation was revoked by a company administrator.",
        )

    if invitation.get("expires_at") <= utcnow():
        expires_str = invitation["expires_at"].strftime("%b %d, %Y")
        raise APIError(
            404,
            "invalid_invitation",
            f"This invitation expired on {expires_str}. Please ask your team admin for a new invite.",
        )

    return invitation


@router.post("/invitation-preview", response_model=InvitationPreviewResponse)
async def preview_invitation(
    payload: InvitationPreviewRequest,
    database: DbDep,
) -> InvitationPreviewResponse:
    invitation = await _resolve_invitation(database, payload.invitation_token)
    company = await database.companies.find_one(
        {"_id": invitation["company_id"], "status": "active"}
    )
    if company is None:
        raise APIError(404, "invalid_invitation", "The company for this invitation is no longer active.")
    inviter = None
    if invitation.get("created_by"):
        inviter = await database.users.find_one({"_id": invitation["created_by"]})
    return InvitationPreviewResponse(
        company_name=company["name"],
        email=invitation["email"],
        role=invitation["role"],
        role_label=ROLE_LABELS.get(invitation["role"], invitation["role"]),
        expires_at=invitation["expires_at"],
        inviter_name=inviter.get("name") if inviter else None,
        name=invitation.get("name"),
        phone=invitation.get("phone"),
        department=invitation.get("department"),
        job_title=invitation.get("job_title"),
        employee_id=invitation.get("employee_id"),
    )


@router.post("/accept-invitation", response_model=AuthResponse)
async def accept_invitation(
    payload: InvitationAcceptRequest,
    request: Request,
    database: DbDep,
    settings: SettingsDep,
) -> AuthResponse:
    email = str(payload.email).lower()
    invitation = await _resolve_invitation(database, payload.invitation_token)
    if invitation["email"] != email:
        raise APIError(
            403,
            "invitation_email_mismatch",
            f"This invitation was issued to {invitation['email']}, but you entered {email}.",
        )
    company = await database.companies.find_one(
        {"_id": invitation["company_id"], "status": "active"}
    )
    if company is None:
        raise APIError(404, "invalid_invitation", "The company for this invitation is no longer active.")

    effective_name = (payload.name or "").strip() or invitation.get("name")
    existing_user = await database.users.find_one({"email": email})
    if existing_user is not None:
        if not verify_password(payload.password, existing_user.get("password_hash")):
            raise APIError(401, "invalid_credentials", "The email or password is incorrect.")
        if existing_user.get("status") != "active":
            raise APIError(401, "invalid_credentials", "The email or password is incorrect.")
    elif not effective_name:
        raise APIError(
            422,
            "validation_error",
            "A name is required for a new account.",
            {"name": "Enter your name."},
        )
    else:
        valid, strength_err = validate_password_strength(payload.password)
        if not valid:
            raise APIError(
                422,
                "weak_password",
                strength_err or "Password is not strong enough.",
                {"password": strength_err or "Password is not strong enough."},
            )

    now = utcnow()
    clean_phone = (payload.phone or "").strip() or invitation.get("phone")
    user_document = existing_user or {
        "_id": new_id(),
        "name": effective_name,
        "email": email,
        "phone": clean_phone,
        "password_hash": hash_password(payload.password),
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    existing_membership = await database.memberships.find_one(
        {"company_id": company["_id"], "user_id": user_document["_id"]}
    )
    if existing_membership is not None and existing_membership.get("status") == "active":
        raise APIError(
            409,
            "already_a_member",
            "This account is already an active member of the company.",
        )
    warehouse_ids = invitation.get("warehouse_ids") or invitation.get("location_ids", [])
    valid_from = invitation.get("valid_from")
    valid_until = invitation.get("valid_until")
    department = invitation.get("department")
    job_title = invitation.get("job_title")
    employee_id = invitation.get("employee_id")

    membership = existing_membership or {
        "_id": new_id(),
        "company_id": company["_id"],
        "user_id": user_document["_id"],
        "role": invitation["role"],
        "location_ids": warehouse_ids,
        "warehouse_ids": warehouse_ids,
        "client_ids": invitation.get("client_ids", []),
        "valid_from": valid_from,
        "valid_until": valid_until,
        "department": department,
        "job_title": job_title,
        "employee_id": employee_id,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    if existing_membership is not None:
        membership = {
            **membership,
            "role": invitation["role"],
            "location_ids": warehouse_ids,
            "warehouse_ids": warehouse_ids,
            "client_ids": invitation.get("client_ids", []),
            "valid_from": valid_from,
            "valid_until": valid_until,
            "department": department or membership.get("department"),
            "job_title": job_title or membership.get("job_title"),
            "employee_id": employee_id or membership.get("employee_id"),
            "status": "active",
            "updated_at": now,
        }

    async def accept(session: Any) -> None:
        if existing_user is None:
            await database.users.insert_one(user_document, session=session)
        elif clean_phone and not existing_user.get("phone"):
            await database.users.update_one(
                {"_id": existing_user["_id"]},
                {"$set": {"phone": clean_phone, "updated_at": now}},
                session=session,
            )
            user_document["phone"] = clean_phone
        if existing_membership is None:
            await database.memberships.insert_one(membership, session=session)
        else:
            await database.memberships.update_one(
                {"_id": membership["_id"], "company_id": company["_id"]},
                {
                    "$set": {
                        "role": invitation["role"],
                        "location_ids": warehouse_ids,
                        "warehouse_ids": warehouse_ids,
                        "client_ids": invitation.get("client_ids", []),
                        "valid_from": valid_from,
                        "valid_until": valid_until,
                        "department": department or membership.get("department"),
                        "job_title": job_title or membership.get("job_title"),
                        "employee_id": employee_id or membership.get("employee_id"),
                        "status": "active",
                        "updated_at": now,
                    }
                },
                session=session,
            )
        result = await database.invitations.update_one(
            {
                "_id": invitation["_id"],
                "accepted_at": None,
                "revoked_at": None,
            },
            {
                "$set": {
                    "accepted_at": now,
                    "accepted_by": user_document["_id"],
                    "updated_at": now,
                },
                "$unset": {"active_key": ""},
            },
            session=session,
        )
        if result.modified_count != 1:
            raise APIError(
                409,
                "invitation_already_used",
                "The invitation has already been used.",
            )

    try:
        async with database.client.start_session() as session:
            await session.with_transaction(accept)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "membership_conflict",
            "The invitation could not be accepted. Sign in and try again.",
            retryable=True,
        ) from exc

    await record_audit(
        database,
        company_id=company["_id"],
        actor_id=user_document["_id"],
        action="membership.role_assigned",
        entity="membership",
        entity_id=membership["_id"],
        request_id=getattr(request.state, "request_id", None),
        before={"role": existing_membership.get("role")} if existing_membership else None,
        after={
            "role": invitation["role"],
            "location_ids": invitation.get("location_ids", []),
            "client_ids": invitation.get("client_ids", []),
            "invitation_id": invitation["_id"],
        },
    )
    await record_audit(
        database,
        company_id=company["_id"],
        actor_id=user_document["_id"],
        action="invitation.accepted",
        entity="invitation",
        entity_id=invitation["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={"email": email, "role": invitation["role"]},
    )
    return await _auth_response(database, settings, user_document, company, membership)


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    database: DbDep,
    settings: SettingsDep,
) -> AuthResponse:
    email = str(payload.email).lower()
    client_host = request.client.host if request.client else "unknown"
    login_key = "login:" + hashlib.sha256(f"{client_host}:{email}".encode()).hexdigest()
    await enforce_rate_limit(database, key=login_key, limit=5, window_seconds=15 * 60)
    user = await database.users.find_one({"email": email})
    if not verify_password(payload.password, user.get("password_hash") if user else None):
        raise APIError(401, "invalid_credentials", "The email or password is incorrect.")
    if user is None or user.get("status") != "active":
        raise APIError(401, "invalid_credentials", "The email or password is incorrect.")
    await clear_rate_limit(database, login_key)

    query: dict[str, Any] = {"user_id": user["_id"], "status": "active"}
    if payload.company_id:
        query["company_id"] = payload.company_id
    memberships = await database.memberships.find(query).to_list(length=20)
    if not memberships:
        raise APIError(401, "membership_inactive", "No active company membership was found.")
    if len(memberships) > 1:
        raise APIError(
            400,
            "company_selection_required",
            "This account belongs to multiple companies. Provide company_id.",
        )
    membership = memberships[0]
    company = await database.companies.find_one(
        {"_id": membership["company_id"], "status": "active"}
    )
    if company is None:
        raise APIError(401, "company_inactive", "The company is not active.")

    await record_audit(
        database,
        company_id=company["_id"],
        actor_id=user["_id"],
        action="auth.login",
        entity="user",
        entity_id=user["_id"],
        request_id=getattr(request.state, "request_id", None),
    )
    return await _auth_response(database, settings, user, company, membership)


@router.post("/check-user", response_model=UserCheckResponse)
async def check_user_exists(
    payload: UserCheckRequest,
    database: DbDep,
) -> UserCheckResponse:
    email = str(payload.email).strip().lower()
    user = await database.users.find_one({"email": email})
    if user is None:
        return UserCheckResponse(exists=False, is_active=False, email=email)
    return UserCheckResponse(
        exists=True,
        is_active=user.get("status") == "active",
        email=email,
    )


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    database: DbDep,
    settings: SettingsDep,
) -> ForgotPasswordResponse:
    email = str(payload.email).strip().lower()
    client_host = request.client.host if request.client else "unknown"
    rate_key = "forgot:" + hashlib.sha256(f"{client_host}:{email}".encode()).hexdigest()
    await enforce_rate_limit(database, key=rate_key, limit=5, window_seconds=15 * 60)

    now = utcnow()
    user = await database.users.find_one({"email": email})
    if user is None:
        raise APIError(
            404,
            "user_not_found",
            "No account found with this email address. Please check your email or register a new workspace.",
            {"email": "No registered account found with this email address."},
        )
    if user.get("status") != "active":
        raise APIError(
            403,
            "account_inactive",
            "This account is suspended or inactive. Please contact your company administrator.",
            {"email": "Account is inactive or suspended."},
        )

    await database.password_resets.update_many(
        {"email": email, "used_at": None},
        {"$set": {"used_at": now}},
    )
    code = generate_reset_code()
    reset_record = {
        "_id": new_id(),
        "user_id": user["_id"],
        "email": email,
        "code_hash": hash_reset_code(code),
        "attempts": 0,
        "expires_at": now + timedelta(minutes=15),
        "used_at": None,
        "created_at": now,
    }
    await database.password_resets.insert_one(reset_record)
    await record_audit(
        database,
        company_id=None,
        actor_id=user["_id"],
        action="auth.password_reset_requested",
        entity="user",
        entity_id=user["_id"],
        request_id=getattr(request.state, "request_id", None),
    )

    email_sent = await send_password_reset_email(settings, email, code)

    dev_code = code if settings.app_env in ("development", "test") else None
    return ForgotPasswordResponse(
        message=f"A 6-digit password reset verification code has been sent to {email}.",
        expires_in_minutes=15,
        email_sent=email_sent,
        dev_code=dev_code,
    )


@router.get("/dev-pending-invitations")
async def dev_pending_invitations(
    database: DbDep,
    settings: SettingsDep,
) -> list[dict[str, Any]]:
    if settings.app_env == "production":
        raise APIError(404, "not_found", "Not found.")
    now = utcnow()
    invitations = (
        await database.invitations.find(
            {
                "accepted_at": None,
                "revoked_at": None,
                "expires_at": {"$gt": now},
            }
        )
        .sort([("created_at", -1)])
        .to_list(length=10)
    )
    results = []
    for inv in invitations:
        company = await database.companies.find_one({"_id": inv["company_id"]})
        results.append(
            {
                "id": inv["_id"],
                "company_name": company["name"] if company else "Unknown Company",
                "email": inv["email"],
                "role": inv["role"],
                "role_label": ROLE_LABELS.get(inv["role"], inv["role"]),
                "invite_code": inv.get("invite_code"),
                "token_preview": inv["token_hash"][:8],
                "expires_at": inv["expires_at"].isoformat(),
            }
        )
    return results


@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    database: DbDep,
) -> ResetPasswordResponse:
    email = str(payload.email).lower()
    client_host = request.client.host if request.client else "unknown"
    rate_key = "reset:" + hashlib.sha256(f"{client_host}:{email}".encode()).hexdigest()
    await enforce_rate_limit(database, key=rate_key, limit=10, window_seconds=15 * 60)

    valid, strength_err = validate_password_strength(payload.new_password)
    if not valid:
        raise APIError(
            422,
            "weak_password",
            strength_err or "Password is not strong enough.",
            {"new_password": strength_err or "Password is not strong enough."},
        )

    now = utcnow()
    reset_doc = await database.password_resets.find_one(
        {
            "email": email,
            "used_at": None,
            "expires_at": {"$gt": now},
        }
    )
    if reset_doc is None:
        raise APIError(400, "invalid_reset_code", "The reset code is invalid or has expired.")

    if reset_doc.get("attempts", 0) >= 5:
        await database.password_resets.update_one(
            {"_id": reset_doc["_id"]},
            {"$set": {"used_at": now}},
        )
        raise APIError(
            400,
            "too_many_attempts",
            "Too many failed attempts. Please request a new reset code.",
        )

    expected_hash = reset_doc["code_hash"]
    given_hash = hash_reset_code(payload.code)
    if given_hash != expected_hash:
        await database.password_resets.update_one(
            {"_id": reset_doc["_id"]},
            {"$inc": {"attempts": 1}},
        )
        raise APIError(400, "invalid_reset_code", "The reset code is incorrect.")

    # Success: Mark code as used
    await database.password_resets.update_one(
        {"_id": reset_doc["_id"]},
        {"$set": {"used_at": now}},
    )

    # Update user password
    user_id = reset_doc["user_id"]
    await database.users.update_one(
        {"_id": user_id},
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": now}},
    )

    # Revoke all active refresh tokens for this user across all companies
    await database.refresh_tokens.update_many(
        {"user_id": user_id, "revoked_at": None},
        {"$set": {"revoked_at": now}},
    )

    await record_audit(
        database,
        company_id=None,
        actor_id=user_id,
        action="auth.password_reset_completed",
        entity="user",
        entity_id=user_id,
        request_id=getattr(request.state, "request_id", None),
    )

    return ResetPasswordResponse(
        message="Your password has been successfully reset. You can now sign in with your new password."
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    payload: RefreshRequest,
    database: DbDep,
    settings: SettingsDep,
) -> TokenResponse:
    tokens = await rotate_refresh_token(database, settings, payload.refresh_token)
    return TokenResponse(**tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: LogoutRequest, database: DbDep, settings: SettingsDep) -> Response:
    await revoke_refresh_token(database, settings, payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    context: ContextDep,
    database: DbDep,
    request: Request,
) -> Response:
    await revoke_all_refresh_tokens(database, context.user["_id"], context.company["_id"])
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="auth.logout_all",
        entity="user",
        entity_id=context.user["_id"],
        request_id=getattr(request.state, "request_id", None),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/session", response_model=SessionResponse)
async def session(context: ContextDep, database: DbDep) -> SessionResponse:
    query: dict[str, Any] = {
        "company_id": context.company["_id"],
        "status": "active",
    }
    if context.client_scope is not None:
        query["$or"] = [
            {"_id": {"$in": sorted(context.client_scope)}},
            {"types": "supplier"},
        ]
    clients = (
        await database.clients.find(query)
        .sort([("is_internal", -1), ("name", 1)])
        .to_list(length=500)
    )
    return SessionResponse(
        user=user_out(context.user),
        company=company_out(context.company),
        membership=membership_out(context.membership, context.company.get("name")),
        clients=[client_out(client) for client in clients],
        permissions=context.permissions,
    )


@router.get("/me", response_model=UserOut)
async def me(user: UserDep) -> UserOut:
    return user_out(user)


@router.patch("/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    user: UserDep,
    database: DbDep,
    request: Request,
) -> UserOut:
    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.phone is not None:
        updates["phone"] = payload.phone.strip() or None

    if not updates:
        return user_out(user)

    now = utcnow()
    updates["updated_at"] = now
    await database.users.update_one(
        {"_id": user["_id"]},
        {"$set": updates},
    )
    user.update(updates)

    await record_audit(
        database,
        company_id="",
        actor_id=user["_id"],
        action="user.profile_updated",
        entity="user",
        entity_id=user["_id"],
        after=updates,
        request_id=getattr(request.state, "request_id", None),
    )
    return user_out(user)


@router.get("/me/memberships", response_model=list[MembershipOut])
async def my_memberships(user: UserDep, database: DbDep) -> list[MembershipOut]:
    memberships = await database.memberships.find(
        {"user_id": user["_id"], "status": "active"}
    ).to_list(length=100)
    company_ids = [item["company_id"] for item in memberships]
    companies = {}
    if company_ids:
        documents = await database.companies.find({"_id": {"$in": company_ids}}).to_list(
            length=len(company_ids)
        )
        companies = {document["_id"]: document for document in documents}
    return [
        membership_out(item, companies.get(item["company_id"], {}).get("name"))
        for item in memberships
    ]


@router.post("/change-password", response_model=ResetPasswordResponse)
async def change_password(
    payload: ChangePasswordRequest,
    user: UserDep,
    database: DbDep,
    request: Request,
) -> ResetPasswordResponse:
    if not verify_password(payload.current_password, user["password_hash"]):
        raise APIError(
            400,
            "invalid_current_password",
            "The current password you entered is incorrect.",
            {"current_password": "Current password is incorrect."},
        )

    validate_password_strength(payload.new_password)

    if verify_password(payload.new_password, user["password_hash"]):
        raise APIError(
            400,
            "password_unchanged",
            "Your new password must be different from your current password.",
            {"new_password": "New password cannot match your current password."},
        )

    now = utcnow()
    new_hash = hash_password(payload.new_password)
    await database.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": new_hash, "updated_at": now}},
    )

    await record_audit(
        database,
        company_id="",
        actor_id=user["_id"],
        action="auth.password_changed",
        entity="user",
        entity_id=user["_id"],
        request_id=getattr(request.state, "request_id", None),
    )

    return ResetPasswordResponse(
        message="Your password has been changed successfully."
    )
