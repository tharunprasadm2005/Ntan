import io
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep, SettingsDep
from ..errors import APIError
from ..permissions import (
    ALL_ROLES,
    DEFAULT_ROLES,
    PERMISSION_CATALOGUE,
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    permissions_for,
)
from ..schemas import (
    CustomRoleCreate,
    CustomRoleUpdate,
    ExcelImportConfirmRequest,
    ExcelImportConfirmResponse,
    ExcelImportConfirmRow,
    ExcelImportPreviewResponse,
    ExcelImportResultItem,
    ExcelImportRowPreview,
    InvitationBulkCreate,
    InvitationBulkResponse,
    InvitationBulkResult,
    InvitationCreate,
    InvitationCreated,
    InvitationListResponse,
    MemberListResponse,
    MemberOut,
    MemberUpdate,
    PermissionCategoryOut,
    PermissionItemOut,
    RecentActivityItem,
    RoleDefinitionOut,
    TeamOverviewResponse,
)
from ..security import (
    clean_phone_number,
    generate_invitation_token,
    generate_short_invite_code,
    hash_invitation_token,
    normalize_invite_code,
    revoke_all_refresh_tokens,
)
from ..serializers import invitation_out, member_out, role_definition_out
from ..services.email import send_invitation_email
from ..services.excel_import import (
    create_excel_template,
    parse_import_file,
    sanitize_for_spreadsheet,
)
from ..utils import new_id, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/members", tags=["members"])

INVITATION_TTL_DAYS = 7


async def _resolve_warehouse_and_location_names(
    database: Any,
    company_id: str,
    target_ids: list[str],
) -> list[str]:
    if not target_ids:
        return []
    wh_docs = await database.warehouses.find(
        {"company_id": company_id, "_id": {"$in": target_ids}}
    ).to_list(length=len(target_ids))
    wh_map = {w["_id"]: w.get("name") or w.get("code") or w["_id"] for w in wh_docs}

    loc_docs = await database.locations.find(
        {"company_id": company_id, "_id": {"$in": target_ids}}
    ).to_list(length=len(target_ids))

    missing_wh_ids = [
        loc["warehouse_id"]
        for loc in loc_docs
        if loc.get("warehouse_id") and loc["warehouse_id"] not in wh_map
    ]
    if missing_wh_ids:
        extra_whs = await database.warehouses.find(
            {"company_id": company_id, "_id": {"$in": missing_wh_ids}}
        ).to_list(length=len(missing_wh_ids))
        for ew in extra_whs:
            wh_map[ew["_id"]] = ew.get("name") or ew.get("code") or ew["_id"]

    resolved: list[str] = []
    for tid in target_ids:
        if tid in wh_map:
            resolved.append(wh_map[tid])
            continue
        loc = next((l for l in loc_docs if l["_id"] == tid), None)
        if loc:
            parent_name = wh_map.get(loc.get("warehouse_id", ""), "")
            loc_name = loc.get("name")
            loc_code = loc.get("code")
            loc_type = loc.get("type")

            if parent_name:
                if loc_type == "main" or loc_code in ("MAIN", "DEFAULT"):
                    resolved.append(parent_name)
                elif loc_name and loc_name != parent_name:
                    resolved.append(f"{parent_name} - {loc_name}")
                elif loc_code:
                    resolved.append(f"{parent_name} ({loc_code})")
                else:
                    resolved.append(parent_name)
            else:
                resolved.append(loc_name or loc_code or tid)
        else:
            resolved.append(tid)
    return resolved


async def _build_warehouse_maps(
    database: Any,
    company_id: str,
) -> tuple[dict[str, str], dict[str, str]]:
    wh_docs = await database.warehouses.find(
        {"company_id": company_id, "status": {"$ne": "archived"}}
    ).to_list(length=200)
    loc_docs = await database.locations.find(
        {"company_id": company_id, "status": {"$ne": "archived"}}
    ).to_list(length=500)

    wh_name_by_id = {w["_id"]: w.get("name") or w.get("code") or w["_id"] for w in wh_docs}
    display_name_map: dict[str, str] = {}
    valid_wh_map: dict[str, str] = {}

    for w in wh_docs:
        w_display = w.get("name") or w.get("code") or w["_id"]
        valid_wh_map[w["_id"].lower()] = w["_id"]
        display_name_map[w["_id"]] = w_display
        if w.get("code"):
            c_low = w["code"].strip().lower()
            valid_wh_map[c_low] = w["_id"]
            valid_wh_map[re.sub(r"[\s\-_]", "", c_low)] = w["_id"]
        if w.get("name"):
            n_low = w["name"].strip().lower()
            valid_wh_map[n_low] = w["_id"]
            valid_wh_map[re.sub(r"[\s\-_]", "", n_low)] = w["_id"]

    for l in loc_docs:
        parent_name = wh_name_by_id.get(l.get("warehouse_id", ""), "")
        l_code = l.get("code")
        l_type = l.get("type")
        if parent_name:
            if l_type == "main" or l_code in ("MAIN", "DEFAULT"):
                l_display = parent_name
            elif l_code:
                l_display = f"{parent_name} ({l_code})"
            else:
                l_display = parent_name
        else:
            l_display = l.get("name") or l_code or l["_id"]

        valid_wh_map[l["_id"].lower()] = l["_id"]
        display_name_map[l["_id"]] = l_display
        if l.get("code"):
            lc_low = l["code"].strip().lower()
            valid_wh_map[lc_low] = l["_id"]
            valid_wh_map[re.sub(r"[\s\-_]", "", lc_low)] = l["_id"]
        if l.get("name"):
            ln_low = l["name"].strip().lower()
            valid_wh_map[ln_low] = l["_id"]
            valid_wh_map[re.sub(r"[\s\-_]", "", ln_low)] = l["_id"]

    return valid_wh_map, display_name_map


async def _send_bulk_invitations_background(
    settings: Any,
    database: Any,
    tasks_data: list[dict[str, Any]],
) -> None:
    for t in tasks_data:
        try:
            delivered, del_status, del_error = await send_invitation_email(
                settings,
                to_email=t["to_email"],
                recipient_name=t.get("recipient_name"),
                company_name=t["company_name"],
                role_name=t["role_name"],
                invite_code=t["invite_code"],
                invite_url=t.get("invite_url"),
                assigned_warehouses=t.get("assigned_warehouses"),
                expires_at=t.get("expires_at"),
            )
            await database.invitations.update_one(
                {"_id": t["doc_id"]},
                {
                    "$set": {
                        "email_delivery_status": del_status,
                        "email_delivery_error": del_error,
                        "updated_at": utcnow(),
                    }
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("[EMAIL SERVICE] Background bulk invite failed for %s: %s", t["to_email"], exc)
            await database.invitations.update_one(
                {"_id": t["doc_id"]},
                {
                    "$set": {
                        "email_delivery_status": "failed",
                        "email_delivery_error": str(exc),
                        "updated_at": utcnow(),
                    }
                },
            )


def _invitation_active_key(company_id: str, email: str) -> str:
    return f"{company_id}:{email}"


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "custom_role"


async def _release_expired_invitation_key(
    database: Any,
    company_id: str,
    email: str,
    now: Any,
) -> None:
    await database.invitations.update_many(
        {
            "company_id": company_id,
            "email": email,
            "accepted_at": None,
            "revoked_at": None,
            "expires_at": {"$lte": now},
            "active_key": {"$type": "string"},
        },
        {"$unset": {"active_key": ""}},
    )


async def _create_invitation_document(
    database: Any,
    context: ContextDep,
    email: str,
    role: str,
    location_ids: list[str],
    client_ids: list[str],
    now: Any,
    *,
    name: str | None = None,
    valid_from: datetime | None = None,
    valid_until: datetime | None = None,
    phone: str | None = None,
    department: str | None = None,
    job_title: str | None = None,
    employee_id: str | None = None,
) -> tuple[str, dict[str, Any] | None, str | None]:
    existing_user = await database.users.find_one({"email": email})
    if existing_user is not None:
        existing_membership = await database.memberships.find_one(
            {
                "company_id": context.company["_id"],
                "user_id": existing_user["_id"],
            }
        )
        if existing_membership is not None and existing_membership.get("status") == "active":
            return "already_member", None, None

    await _release_expired_invitation_key(database, context.company["_id"], email, now)
    pending = await database.invitations.find_one(
        {
            "company_id": context.company["_id"],
            "email": email,
            "accepted_at": None,
            "revoked_at": None,
            "expires_at": {"$gt": now},
        }
    )
    if pending is not None:
        return "pending_invitation", None, None

    invitation_token = generate_invitation_token()
    invite_code = generate_short_invite_code()
    document = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "name": name.strip() if name else None,
        "email": email,
        "role": role,
        "location_ids": location_ids,
        "warehouse_ids": location_ids,
        "client_ids": client_ids,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "phone": clean_phone_number(phone) if phone else None,
        "department": department.strip() if department else None,
        "job_title": job_title.strip() if job_title else None,
        "employee_id": employee_id.strip() if employee_id else None,
        "invite_code": invite_code,
        "normalized_invite_code": normalize_invite_code(invite_code),
        "token_hash": hash_invitation_token(invitation_token),
        "active_key": _invitation_active_key(context.company["_id"], email),
        "email_delivery_status": "pending",
        "email_delivery_error": None,
        "created_by": context.user["_id"],
        "created_at": now,
        "updated_at": now,
        "expires_at": now + timedelta(days=INVITATION_TTL_DAYS),
        "accepted_at": None,
        "accepted_by": None,
        "revoked_at": None,
    }
    try:
        await database.invitations.insert_one(document)
    except DuplicateKeyError:
        pending = await database.invitations.find_one(
            {
                "company_id": context.company["_id"],
                "email": email,
                "accepted_at": None,
                "revoked_at": None,
                "expires_at": {"$gt": now},
            }
        )
        if pending is not None:
            return "pending_invitation", None, None
        return "failed", None, None
    return "created", document, invitation_token


def _ensure_role_authorized(context: ContextDep, current_role: str, next_role: str) -> None:
    if context.is_owner:
        return
    if current_role == "owner" or next_role == "owner":
        raise APIError(
            403,
            "owner_role_required",
            "Only a company owner can manage the owner role.",
        )


async def _validate_location_ids(
    database: Any,
    company_id: str,
    location_ids: list[str],
    caller_scope: frozenset[str] | None = None,
) -> list[str]:
    unique_ids = list(dict.fromkeys(location_ids))
    if caller_scope is not None:
        if not unique_ids:
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "Managers with scoped warehouse access must explicitly specify warehouse assignments within their authorized facilities.",
            )
        for uid in unique_ids:
            if uid not in caller_scope:
                raise APIError(
                    403,
                    "delegation_scope_exceeded",
                    f"You cannot grant access to warehouse or location '{uid}' outside your authorized facilities.",
                )
    if not unique_ids:
        return []
    found_locs = await database.locations.find(
        {"_id": {"$in": unique_ids}, "company_id": company_id, "status": "active"}
    ).to_list(length=len(unique_ids))
    found_whs = await database.warehouses.find(
        {"_id": {"$in": unique_ids}, "company_id": company_id}
    ).to_list(length=len(unique_ids))
    valid_ids = {doc["_id"] for doc in found_locs}.union({doc["_id"] for doc in found_whs})
    if len(valid_ids) != len(unique_ids):
        raise APIError(
            422,
            "invalid_location_scope",
            "One or more selected warehouses or locations are not active in this company.",
            {"location_ids": "Select active warehouses or locations from this company."},
        )
    return unique_ids


async def _validate_client_ids(
    database: Any,
    company_id: str,
    client_ids: list[str],
) -> list[str]:
    unique_ids = list(dict.fromkeys(client_ids))
    if not unique_ids:
        return []
    found = await database.clients.find(
        {"_id": {"$in": unique_ids}, "company_id": company_id, "status": "active"}
    ).to_list(length=len(unique_ids))
    if len(found) != len(unique_ids):
        raise APIError(
            422,
            "invalid_client_scope",
            "One or more selected clients are not active in this company.",
            {"client_ids": "Select active clients from this company."},
        )
    return unique_ids


# ---------------------------------------------------------------------------
# 1. TEAM OVERVIEW
# ---------------------------------------------------------------------------
@router.get("/overview", response_model=TeamOverviewResponse)
async def get_team_overview(
    context: ContextDep,
    database: DbDep,
) -> TeamOverviewResponse:
    context.require("members.read")
    company_id = context.company["_id"]
    now = utcnow()
    expiring_soon_threshold = now + timedelta(hours=24)

    total_members = await database.memberships.count_documents({"company_id": company_id})
    active_members = await database.memberships.count_documents(
        {"company_id": company_id, "status": "active"}
    )
    suspended_members = await database.memberships.count_documents(
        {"company_id": company_id, "status": "suspended"}
    )
    deactivated_members = await database.memberships.count_documents(
        {"company_id": company_id, "status": "inactive"}
    )

    pending_invitations = await database.invitations.count_documents(
        {
            "company_id": company_id,
            "accepted_at": None,
            "revoked_at": None,
            "expires_at": {"$gt": now},
        }
    )

    attention_invitations = await database.invitations.count_documents(
        {
            "company_id": company_id,
            "accepted_at": None,
            "revoked_at": None,
            "$or": [
                {"email_delivery_status": "failed"},
                {"expires_at": {"$lte": expiring_soon_threshold, "$gt": now}},
            ],
        }
    )

    pipeline = [
        {"$match": {"company_id": company_id, "status": "active"}},
        {"$project": {"warehouses": {"$setUnion": ["$warehouse_ids", "$location_ids"]}}},
        {"$unwind": "$warehouses"},
        {"$group": {"_id": "$warehouses"}},
        {"$count": "total"},
    ]
    cursor = await database.memberships.aggregate(pipeline)
    wh_agg = await cursor.to_list(length=1)
    warehouses_represented = wh_agg[0]["total"] if wh_agg else 0

    custom_roles_count = await database.custom_roles.count_documents(
        {"company_id": company_id, "is_active": {"$ne": False}}
    )

    audit_docs = (
        await database.audit_events.find(
            {
                "company_id": company_id,
                "action": {
                    "$in": [
                        "membership.role_changed",
                        "membership.status_changed",
                        "membership.scope_changed",
                        "membership.suspended",
                        "membership.reactivated",
                        "membership.removed",
                        "invitation.created",
                        "invitation.bulk_created",
                        "invitation.resent",
                        "invitation.revoked",
                        "invitation.replaced",
                        "role.created",
                        "role.updated",
                        "role.deleted",
                    ]
                },
            }
        )
        .sort([("created_at", -1)])
        .to_list(length=10)
    )

    actor_ids = list({doc.get("actor_id") for doc in audit_docs if doc.get("actor_id")})
    actors = {}
    if actor_ids:
        actor_users = await database.users.find({"_id": {"$in": actor_ids}}).to_list(length=len(actor_ids))
        actors = {u["_id"]: u.get("name") or u.get("email") for u in actor_users}

    recent_activity: list[RecentActivityItem] = []
    for doc in audit_docs:
        actor_name = actors.get(doc.get("actor_id"), "System")
        action = doc.get("action", "")
        summary = f"{actor_name} performed {action}"
        if action == "invitation.created":
            summary = f"{actor_name} invited {doc.get('after', {}).get('email', 'a member')}"
        elif action == "invitation.resent":
            summary = f"{actor_name} resent an invitation"
        elif action == "invitation.revoked":
            summary = f"{actor_name} revoked an invitation"
        elif action == "membership.suspended":
            summary = f"{actor_name} suspended a team member"
        elif action == "membership.reactivated":
            summary = f"{actor_name} reactivated a team member"
        elif action == "membership.role_changed":
            new_r = doc.get("after", {}).get("role", "")
            summary = f"{actor_name} updated role to {ROLE_LABELS.get(new_r, new_r)}"
        elif action.startswith("role."):
            summary = f"{actor_name} modified custom roles"

        recent_activity.append(
            RecentActivityItem(
                id=doc["_id"],
                action=action,
                actor_id=doc.get("actor_id"),
                actor_name=actor_name,
                target_entity=doc.get("entity", ""),
                target_id=doc.get("entity_id", ""),
                summary=summary,
                created_at=doc.get("created_at") or now,
            )
        )

    return TeamOverviewResponse(
        total_members=total_members,
        active_members=active_members,
        suspended_members=suspended_members,
        deactivated_members=deactivated_members,
        pending_invitations=pending_invitations,
        attention_invitations=attention_invitations,
        warehouses_represented=warehouses_represented,
        custom_roles_count=custom_roles_count,
        active_members_count=active_members,
        suspended_members_count=suspended_members,
        pending_invitations_count=pending_invitations,
        attention_invitations_count=attention_invitations,
        warehouses_count=warehouses_represented,
        recent_activity=recent_activity,
    )


# ---------------------------------------------------------------------------
# 2. TEAM MEMBERS (Search, Filter, Pagination, Details)
# ---------------------------------------------------------------------------
@router.get("", response_model=MemberListResponse)
async def list_members(
    context: ContextDep,
    database: DbDep,
    q: str | None = Query(None, description="Search by name, email, or employee ID"),
    status: str | None = Query(None, description="Filter by status: active, suspended, inactive"),
    role: str | None = Query(None, description="Filter by role slug"),
    warehouse_id: str | None = Query(None, description="Filter by assigned warehouse ID"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> MemberListResponse:
    context.require("members.read")
    company_id = context.company["_id"]

    query: dict[str, Any] = {"company_id": company_id}
    if status and status != "all":
        query["status"] = status
    if role:
        query["role"] = role
    if context.location_scope is not None and not context.is_owner:
        if warehouse_id:
            if warehouse_id not in context.location_scope:
                raise APIError(403, "location_forbidden", "You do not have access to this warehouse.")
            query["$or"] = [
                {"warehouse_ids": warehouse_id},
                {"location_ids": warehouse_id},
            ]
        else:
            query["$or"] = [
                {"warehouse_ids": {"$in": list(context.location_scope)}},
                {"location_ids": {"$in": list(context.location_scope)}},
            ]
    elif warehouse_id:
        query["$or"] = [
            {"warehouse_ids": warehouse_id},
            {"location_ids": warehouse_id},
        ]

    if q and q.strip():
        search_term = q.strip()
        user_matches = await database.users.find(
            {
                "$or": [
                    {"name": {"$regex": re.escape(search_term), "$options": "i"}},
                    {"email": {"$regex": re.escape(search_term), "$options": "i"}},
                ]
            }
        ).to_list(length=200)
        matched_user_ids = [u["_id"] for u in user_matches]

        mem_q: list[dict[str, Any]] = [
            {"employee_id": {"$regex": re.escape(search_term), "$options": "i"}},
            {"department": {"$regex": re.escape(search_term), "$options": "i"}},
            {"job_title": {"$regex": re.escape(search_term), "$options": "i"}},
        ]
        if matched_user_ids:
            mem_q.append({"user_id": {"$in": matched_user_ids}})

        if "$or" in query:
            query = {"$and": [query, {"$or": mem_q}]}
        else:
            query["$or"] = mem_q

    total = await database.memberships.count_documents(query)
    memberships = (
        await database.memberships.find(query)
        .sort([("created_at", 1)])
        .skip(skip)
        .limit(limit)
        .to_list(length=limit)
    )

    user_ids = list({m["user_id"] for m in memberships})
    users = {}
    if user_ids:
        documents = await database.users.find({"_id": {"$in": user_ids}}).to_list(
            length=len(user_ids)
        )
        users = {doc["_id"]: doc for doc in documents}

    return MemberListResponse(
        members=[
            member_out(m, users[m["user_id"]])
            for m in memberships
            if m["user_id"] in users
        ],
        total=total,
        total_count=total,
    )


@router.patch("/{membership_id}", response_model=MemberOut)
async def update_member(
    membership_id: str,
    payload: MemberUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> MemberOut:
    context.require("members.manage")
    warehouse_input = payload.warehouse_ids if payload.warehouse_ids else payload.location_ids
    validated_location_ids = None
    if warehouse_input is not None:
        validated_location_ids = await _validate_location_ids(
            database,
            context.company["_id"],
            warehouse_input,
            caller_scope=context.location_scope if not context.is_owner else None,
        )
    validated_client_ids = None
    if payload.client_ids is not None:
        validated_client_ids = await _validate_client_ids(
            database,
            context.company["_id"],
            payload.client_ids,
        )

    now = utcnow()
    applied: dict[str, Any] = {}

    async def apply_update(session: Any) -> None:
        target = await database.memberships.find_one(
            {"_id": membership_id, "company_id": context.company["_id"]},
            session=session,
        )
        if target is None:
            raise APIError(404, "member_not_found", "The company member was not found.")

        if context.location_scope is not None and not context.is_owner:
            target_whs = target.get("warehouse_ids") or target.get("location_ids") or []
            if not target_whs or any(wid not in context.location_scope for wid in target_whs):
                raise APIError(
                    403,
                    "delegation_scope_exceeded",
                    "You cannot manage members outside your authorized warehouse facilities.",
                )

        next_role = payload.role or target["role"]
        next_status = payload.status or target.get("status", "active")
        role_changed = next_role != target["role"]
        status_changed = next_status != target.get("status", "active")
        location_scope_changed = (
            validated_location_ids is not None
            and validated_location_ids != target.get("location_ids", [])
        )
        client_scope_changed = (
            validated_client_ids is not None
            and validated_client_ids != target.get("client_ids", [])
        )
        scope_changed = location_scope_changed or client_scope_changed

        if role_changed:
            context.require("roles.assign")
        if role_changed or target["role"] == "owner":
            _ensure_role_authorized(context, target["role"], next_role)

        changes: dict[str, Any] = {"updated_at": now}
        if role_changed:
            changes["role"] = next_role
        if status_changed:
            changes["status"] = next_status
        if validated_location_ids is not None:
            changes["location_ids"] = validated_location_ids
            changes["warehouse_ids"] = validated_location_ids
        if validated_client_ids is not None:
            changes["client_ids"] = validated_client_ids
        if payload.department is not None:
            changes["department"] = payload.department.strip() or None
        if payload.job_title is not None:
            changes["job_title"] = payload.job_title.strip() or None
        if payload.employee_id is not None:
            changes["employee_id"] = payload.employee_id.strip() or None
        if payload.valid_from is not None:
            changes["valid_from"] = payload.valid_from
        if payload.valid_until is not None:
            changes["valid_until"] = payload.valid_until

        result = await database.memberships.update_one(
            {"_id": membership_id, "company_id": context.company["_id"]},
            {"$set": changes},
            session=session,
        )
        if result.matched_count != 1:
            raise APIError(404, "member_not_found", "The company member was not found.")

        if target["role"] == "owner" and (next_role != "owner" or next_status != "active"):
            await database.companies.update_one(
                {"_id": context.company["_id"]},
                {"$inc": {"membership_guard": 1}},
                session=session,
            )
            remaining_owners = await database.memberships.count_documents(
                {
                    "company_id": context.company["_id"],
                    "role": "owner",
                    "status": "active",
                },
                session=session,
            )
            if remaining_owners < 1:
                raise APIError(
                    409,
                    "last_owner_required",
                    "The last active company owner cannot be demoted or deactivated.",
                )

        applied.clear()
        applied.update(
            {
                "target": target,
                "next_role": next_role,
                "next_status": next_status,
                "role_changed": role_changed,
                "status_changed": status_changed,
                "scope_changed": scope_changed,
                "changes": changes,
            }
        )

    async with database.client.start_session() as session:
        await session.with_transaction(apply_update)

    target = applied["target"]
    next_role = applied["next_role"]
    next_status = applied["next_status"]
    changes = applied["changes"]

    if applied["status_changed"] and next_status in ("inactive", "suspended"):
        await revoke_all_refresh_tokens(database, target["user_id"], context.company["_id"])

    request_id = getattr(request.state, "request_id", None)
    if applied["role_changed"]:
        await record_audit(
            database,
            company_id=context.company["_id"],
            actor_id=context.user["_id"],
            action="membership.role_changed",
            entity="membership",
            entity_id=membership_id,
            request_id=request_id,
            before={"role": target["role"]},
            after={"role": next_role},
        )
    if applied["status_changed"]:
        await record_audit(
            database,
            company_id=context.company["_id"],
            actor_id=context.user["_id"],
            action="membership.status_changed",
            entity="membership",
            entity_id=membership_id,
            request_id=request_id,
            before={"status": target.get("status", "active")},
            after={"status": next_status},
        )
    if applied["scope_changed"]:
        await record_audit(
            database,
            company_id=context.company["_id"],
            actor_id=context.user["_id"],
            action="membership.scope_changed",
            entity="membership",
            entity_id=membership_id,
            request_id=request_id,
            before={
                "location_ids": target.get("location_ids", []),
                "client_ids": target.get("client_ids", []),
            },
            after={
                "location_ids": changes.get("location_ids", target.get("location_ids", [])),
                "client_ids": changes.get("client_ids", target.get("client_ids", [])),
            },
        )

    updated = await database.memberships.find_one(
        {"_id": membership_id, "company_id": context.company["_id"]}
    )
    member_user = await database.users.find_one({"_id": target["user_id"]})
    if updated is None or member_user is None:
        raise APIError(404, "member_not_found", "The company member was not found.")
    return member_out(updated, member_user)


@router.post("/{membership_id}/suspend", response_model=MemberOut)
async def suspend_member(
    membership_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> MemberOut:
    context.require("members.manage")
    target = await database.memberships.find_one(
        {"_id": membership_id, "company_id": context.company["_id"]}
    )
    if target is None:
        raise APIError(404, "member_not_found", "The company member was not found.")
    if context.location_scope is not None and not context.is_owner:
        target_whs = target.get("warehouse_ids") or target.get("location_ids") or []
        if not target_whs or any(wid not in context.location_scope for wid in target_whs):
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "You cannot manage members outside your authorized warehouse facilities.",
            )
    if target["role"] == "owner":
        if not context.is_owner:
            raise APIError(403, "owner_role_required", "Only a company owner can suspend an owner.")
        remaining = await database.memberships.count_documents(
            {"company_id": context.company["_id"], "role": "owner", "status": "active"}
        )
        if remaining <= 1:
            raise APIError(409, "last_owner_required", "The last active owner cannot be suspended.")

    now = utcnow()
    await database.memberships.update_one(
        {"_id": membership_id, "company_id": context.company["_id"]},
        {"$set": {"status": "suspended", "updated_at": now}},
    )
    await revoke_all_refresh_tokens(database, target["user_id"], context.company["_id"])

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="membership.suspended",
        entity="membership",
        entity_id=membership_id,
        request_id=getattr(request.state, "request_id", None),
        before={"status": target.get("status")},
        after={"status": "suspended"},
    )

    updated = await database.memberships.find_one({"_id": membership_id})
    user = await database.users.find_one({"_id": target["user_id"]})
    return member_out(updated, user)


@router.post("/{membership_id}/reactivate", response_model=MemberOut)
async def reactivate_member(
    membership_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> MemberOut:
    context.require("members.manage")
    target = await database.memberships.find_one(
        {"_id": membership_id, "company_id": context.company["_id"]}
    )
    if target is None:
        raise APIError(404, "member_not_found", "The company member was not found.")
    if context.location_scope is not None and not context.is_owner:
        target_whs = target.get("warehouse_ids") or target.get("location_ids") or []
        if not target_whs or any(wid not in context.location_scope for wid in target_whs):
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "You cannot manage members outside your authorized warehouse facilities.",
            )

    now = utcnow()
    await database.memberships.update_one(
        {"_id": membership_id, "company_id": context.company["_id"]},
        {"$set": {"status": "active", "updated_at": now}},
    )

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="membership.reactivated",
        entity="membership",
        entity_id=membership_id,
        request_id=getattr(request.state, "request_id", None),
        before={"status": target.get("status")},
        after={"status": "active"},
    )

    updated = await database.memberships.find_one({"_id": membership_id})
    user = await database.users.find_one({"_id": target["user_id"]})
    return member_out(updated, user)


@router.delete("/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    membership_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> Response:
    context.require("members.manage")
    target = await database.memberships.find_one(
        {"_id": membership_id, "company_id": context.company["_id"]}
    )
    if target is None:
        raise APIError(404, "member_not_found", "The company member was not found.")
    if context.location_scope is not None and not context.is_owner:
        target_whs = target.get("warehouse_ids") or target.get("location_ids") or []
        if not target_whs or any(wid not in context.location_scope for wid in target_whs):
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "You cannot manage members outside your authorized warehouse facilities.",
            )

    if target["role"] == "owner":
        if not context.is_owner:
            raise APIError(403, "owner_role_required", "Only an owner can remove an owner.")
        remaining = await database.memberships.count_documents(
            {"company_id": context.company["_id"], "role": "owner", "status": "active"}
        )
        if remaining <= 1:
            raise APIError(409, "last_owner_required", "The last active company owner cannot be removed.")

    await database.memberships.delete_one({"_id": membership_id, "company_id": context.company["_id"]})
    await revoke_all_refresh_tokens(database, target["user_id"], context.company["_id"])

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="membership.removed",
        entity="membership",
        entity_id=membership_id,
        request_id=getattr(request.state, "request_id", None),
        before={"role": target["role"], "user_id": target["user_id"]},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 3. ROLES & PERMISSIONS
# ---------------------------------------------------------------------------
@router.get("/roles", response_model=list[RoleDefinitionOut])
async def list_roles(
    context: ContextDep,
    database: DbDep,
) -> list[RoleDefinitionOut]:
    context.require("members.read")
    company_id = context.company["_id"]

    pipeline = [
        {"$match": {"company_id": company_id, "status": {"$in": ["active", "suspended"]}}},
        {"$group": {"_id": "$role", "count": {"$sum": 1}}},
    ]
    cursor = await database.memberships.aggregate(pipeline)
    counts_res = await cursor.to_list(length=100)
    assigned_counts = {item["_id"]: item["count"] for item in counts_res}

    results: list[RoleDefinitionOut] = []

    for slug in DEFAULT_ROLES:
        results.append(
            RoleDefinitionOut(
                id=f"builtin_{slug}",
                name=ROLE_LABELS.get(slug, slug),
                slug=slug,
                description=ROLE_DESCRIPTIONS.get(slug, ""),
                is_custom=False,
                is_system=True,
                permissions=permissions_for(slug),
                assigned_count=assigned_counts.get(slug, 0),
            )
        )

    custom_roles = (
        await database.custom_roles.find({"company_id": company_id, "is_active": {"$ne": False}})
        .sort([("created_at", 1)])
        .to_list(length=100)
    )
    for cr in custom_roles:
        results.append(role_definition_out(cr, assigned_counts.get(cr["slug"], 0)))

    return results


@router.post("/roles", response_model=RoleDefinitionOut, status_code=status.HTTP_201_CREATED)
async def create_custom_role(
    payload: CustomRoleCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> RoleDefinitionOut:
    context.require("roles.manage")
    if context.location_scope is not None and not context.is_owner:
        raise APIError(
            403,
            "organization_authorization_required",
            "Creating custom company roles requires organization-wide authorization.",
        )
    company_id = context.company["_id"]

    slug = _slugify(payload.slug or payload.name)
    if slug in DEFAULT_ROLES or slug in ALL_ROLES:
        raise APIError(
            409,
            "role_conflict",
            f"Role identifier '{slug}' conflicts with a built-in system role. Use a distinct name.",
            {"slug": "Use a distinct custom role name."},
        )

    existing = await database.custom_roles.find_one({"company_id": company_id, "slug": slug})
    if existing is not None:
        raise APIError(
            409,
            "role_conflict",
            f"A custom role with slug '{slug}' already exists in your organization.",
            {"name": "A role with this name already exists."},
        )

    if not context.is_owner:
        caller_perms = set(context.permissions)
        excess = set(payload.permissions) - caller_perms
        if excess:
            raise APIError(
                403,
                "privilege_escalation",
                f"You cannot grant permissions you do not possess: {', '.join(sorted(excess))}",
            )

    now = utcnow()
    doc = {
        "_id": new_id(),
        "company_id": company_id,
        "name": payload.name.strip(),
        "slug": slug,
        "description": payload.description.strip(),
        "permissions": sorted(list(set(payload.permissions))),
        "is_active": True,
        "created_by": context.user["_id"],
        "created_at": now,
        "updated_at": now,
    }
    await database.custom_roles.insert_one(doc)

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="role.created",
        entity="custom_role",
        entity_id=doc["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={"name": doc["name"], "slug": slug, "permissions": doc["permissions"]},
    )
    return role_definition_out(doc, assigned_count=0)


@router.patch("/roles/{role_id}", response_model=RoleDefinitionOut)
async def update_custom_role(
    role_id: str,
    payload: CustomRoleUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> RoleDefinitionOut:
    context.require("roles.manage")
    if context.location_scope is not None and not context.is_owner:
        raise APIError(
            403,
            "organization_authorization_required",
            "Managing custom company roles requires organization-wide authorization.",
        )
    company_id = context.company["_id"]

    target = await database.custom_roles.find_one({"_id": role_id, "company_id": company_id})
    if target is None:
        raise APIError(404, "role_not_found", "The custom role was not found.")

    changes: dict[str, Any] = {"updated_at": utcnow()}
    if payload.name is not None:
        changes["name"] = payload.name.strip()
    if payload.description is not None:
        changes["description"] = payload.description.strip()
    if payload.permissions is not None:
        if not context.is_owner:
            caller_perms = set(context.permissions)
            excess = set(payload.permissions) - caller_perms
            if excess:
                raise APIError(
                    403,
                    "privilege_escalation",
                    f"You cannot grant permissions you do not possess: {', '.join(sorted(excess))}",
                )
        changes["permissions"] = sorted(list(set(payload.permissions)))

    await database.custom_roles.update_one(
        {"_id": role_id, "company_id": company_id},
        {"$set": changes},
    )

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="role.updated",
        entity="custom_role",
        entity_id=role_id,
        request_id=getattr(request.state, "request_id", None),
        before={"name": target["name"], "permissions": target.get("permissions", [])},
        after=changes,
    )

    updated = await database.custom_roles.find_one({"_id": role_id})
    assigned_count = await database.memberships.count_documents(
        {"company_id": company_id, "role": target["slug"], "status": {"$in": ["active", "suspended"]}}
    )
    return role_definition_out(updated, assigned_count=assigned_count)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_role(
    role_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> Response:
    context.require("roles.manage")
    if context.location_scope is not None and not context.is_owner:
        raise APIError(
            403,
            "organization_authorization_required",
            "Deleting custom company roles requires organization-wide authorization.",
        )
    company_id = context.company["_id"]

    target = await database.custom_roles.find_one({"_id": role_id, "company_id": company_id})
    if target is None:
        raise APIError(404, "role_not_found", "The custom role was not found.")

    assigned_count = await database.memberships.count_documents(
        {"company_id": company_id, "role": target["slug"], "status": {"$in": ["active", "suspended"]}}
    )
    if assigned_count > 0:
        raise APIError(
            409,
            "role_in_use",
            f"Cannot delete custom role '{target['name']}' because {assigned_count} member(s) are currently assigned to it. Reassign them first.",
        )

    await database.custom_roles.delete_one({"_id": role_id, "company_id": company_id})

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="role.deleted",
        entity="custom_role",
        entity_id=role_id,
        request_id=getattr(request.state, "request_id", None),
        before={"name": target["name"], "slug": target["slug"]},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/permissions", response_model=list[PermissionCategoryOut])
async def list_permissions(context: ContextDep) -> list[PermissionCategoryOut]:
    context.require("members.read")
    return [
        PermissionCategoryOut(
            category=cat["category"],
            description=cat.get("description", ""),
            permissions=[PermissionItemOut(**item) for item in cat["permissions"]],
        )
        for cat in PERMISSION_CATALOGUE
    ]


# ---------------------------------------------------------------------------
# 4. INVITATIONS
# ---------------------------------------------------------------------------
@router.get("/invitations", response_model=InvitationListResponse)
async def list_invitations(
    context: ContextDep,
    database: DbDep,
    status_filter: str | None = Query(None, description="Filter: pending, accepted, revoked, expired, all"),
) -> InvitationListResponse:
    context.require("invitations.read")
    now = utcnow()
    query: dict[str, Any] = {"company_id": context.company["_id"]}

    if status_filter == "pending":
        query["accepted_at"] = None
        query["revoked_at"] = None
        query["expires_at"] = {"$gt": now}
    elif status_filter == "accepted":
        query["accepted_at"] = {"$ne": None}
    elif status_filter == "revoked":
        query["revoked_at"] = {"$ne": None}
    elif status_filter == "expired":
        query["accepted_at"] = None
        query["revoked_at"] = None
        query["expires_at"] = {"$lte": now}

    if context.location_scope is not None and not context.is_owner:
        scope_clause = {
            "$or": [
                {"warehouse_ids": {"$in": list(context.location_scope)}},
                {"location_ids": {"$in": list(context.location_scope)}},
            ]
        }
        if "$or" in query:
            query = {"$and": [query, scope_clause]}
        else:
            query.update(scope_clause)

    documents = (
        await database.invitations.find(query)
        .sort([("created_at", -1)])
        .to_list(length=300)
    )
    return InvitationListResponse(invitations=[invitation_out(item) for item in documents])


@router.post(
    "/invitations",
    response_model=InvitationCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    payload: InvitationCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
    settings: SettingsDep,
) -> InvitationCreated:
    context.require("invitations.manage", "roles.assign")
    if payload.role == "owner" and not context.is_owner:
        raise APIError(
            403,
            "owner_role_required",
            "Only a company owner can assign the owner role.",
        )

    if not context.is_owner:
        target_perms = permissions_for(payload.role)
        caller_perms = set(context.permissions)
        excess = set(target_perms) - caller_perms
        if excess:
            raise APIError(
                403,
                "privilege_escalation",
                f"You cannot invite a user with permissions you do not possess: {', '.join(sorted(excess))}",
            )

    email = str(payload.email).lower()
    wh_input = payload.warehouse_ids if payload.warehouse_ids else payload.location_ids
    location_ids = await _validate_location_ids(
        database,
        context.company["_id"],
        wh_input,
        caller_scope=context.location_scope if not context.is_owner else None,
    )
    client_ids = await _validate_client_ids(
        database,
        context.company["_id"],
        payload.client_ids,
    )
    now = utcnow()
    status_value, document, invitation_token = await _create_invitation_document(
        database,
        context,
        email,
        payload.role,
        location_ids,
        client_ids,
        now,
        name=payload.name,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        phone=payload.phone,
        department=payload.department,
        job_title=payload.job_title,
        employee_id=payload.employee_id,
    )
    if status_value == "already_member":
        raise APIError(
            409,
            "already_a_member",
            "This person is already an active member of the company.",
        )
    if status_value == "pending_invitation":
        raise APIError(
            409,
            "invitation_already_pending",
            "A pending invitation already exists for this email address.",
        )
    if status_value != "created" or document is None or invitation_token is None:
        raise APIError(
            409,
            "invitation_conflict",
            "The invitation could not be created. Retry the request.",
            retryable=True,
        )

    warehouse_names: list[str] = await _resolve_warehouse_and_location_names(
        database, context.company["_id"], location_ids
    )

    role_label = ROLE_LABELS.get(payload.role, payload.role.replace("_", " ").title())
    delivered, delivery_status, error_msg = await send_invitation_email(
        settings,
        to_email=email,
        recipient_name=payload.name or email.split("@")[0],
        company_name=context.company.get("name", "NTAN Inventory"),
        role_name=role_label,
        invite_code=document["invite_code"],
        invite_url=f"https://app.ntan.in/join?code={document['invite_code']}",
        assigned_warehouses=warehouse_names,
        expires_at=document["expires_at"],
    )

    await database.invitations.update_one(
        {"_id": document["_id"]},
        {
            "$set": {
                "email_delivery_status": delivery_status,
                "email_delivery_error": error_msg,
                "updated_at": utcnow(),
            }
        },
    )
    document["email_delivery_status"] = delivery_status
    document["email_delivery_error"] = error_msg

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="invitation.created",
        entity="invitation",
        entity_id=document["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={
            "email": email,
            "role": payload.role,
            "warehouse_ids": location_ids,
            "email_delivery_status": delivery_status,
            "expires_at": document["expires_at"].isoformat(),
        },
    )
    return InvitationCreated(
        **invitation_out(document).model_dump(),
        invitation_token=invitation_token,
    )


@router.post("/invitations/bulk", response_model=InvitationBulkResponse)
async def create_invitations_bulk(
    payload: InvitationBulkCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
    settings: SettingsDep,
    background_tasks: BackgroundTasks,
) -> InvitationBulkResponse:
    context.require("invitations.manage", "roles.assign")
    if payload.role == "owner" and not context.is_owner:
        raise APIError(
            403,
            "owner_role_required",
            "Only a company owner can assign the owner role.",
        )
    location_ids = await _validate_location_ids(
        database,
        context.company["_id"],
        payload.location_ids,
        caller_scope=context.location_scope if not context.is_owner else None,
    )
    client_ids = await _validate_client_ids(
        database,
        context.company["_id"],
        payload.client_ids,
    )
    now = utcnow()
    results: list[InvitationBulkResult] = []
    created_count = 0
    email_tasks: list[dict[str, Any]] = []

    warehouse_names: list[str] = await _resolve_warehouse_and_location_names(
        database, context.company["_id"], location_ids
    )
    role_label = ROLE_LABELS.get(payload.role, payload.role.replace("_", " ").title())

    for email in payload.emails:
        status_value, document, invitation_token = await _create_invitation_document(
            database,
            context,
            email,
            payload.role,
            location_ids,
            client_ids,
            now,
        )
        if status_value == "created" and document is not None and invitation_token is not None:
            created_count += 1
            document["email_delivery_status"] = "pending"
            document["email_delivery_error"] = None

            email_tasks.append({
                "doc_id": document["_id"],
                "to_email": email,
                "recipient_name": email.split("@")[0],
                "company_name": context.company.get("name", "NTAN Inventory"),
                "role_name": role_label,
                "invite_code": document["invite_code"],
                "invite_url": f"https://app.ntan.in/join?code={document['invite_code']}",
                "assigned_warehouses": warehouse_names,
                "expires_at": document["expires_at"],
            })

            invitation = InvitationCreated(
                **invitation_out(document).model_dump(),
                invitation_token=invitation_token,
            )
            results.append(
                InvitationBulkResult(
                    email=email,
                    status="created",
                    invitation=invitation,
                )
            )
            await record_audit(
                database,
                company_id=context.company["_id"],
                actor_id=context.user["_id"],
                action="invitation.created",
                entity="invitation",
                entity_id=document["_id"],
                request_id=getattr(request.state, "request_id", None),
                after={
                    "email": email,
                    "role": payload.role,
                    "location_ids": location_ids,
                    "client_ids": client_ids,
                    "email_delivery_status": "pending",
                    "expires_at": document["expires_at"].isoformat(),
                    "bulk": True,
                },
            )
            continue

        status_by_value = {
            "already_member": (
                "already_member",
                "This person is already an active member.",
            ),
            "pending_invitation": (
                "pending_invitation",
                "A pending invitation already exists.",
            ),
        }
        result_status, message = status_by_value.get(
            status_value,
            ("failed", "The invitation could not be created. Retry it."),
        )
        results.append(
            InvitationBulkResult(
                email=email,
                status=result_status,
                message=message,
            )
        )

    if email_tasks:
        background_tasks.add_task(_send_bulk_invitations_background, settings, database, email_tasks)

    skipped_count = len(results) - created_count
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="invitation.bulk_created",
        entity="company",
        entity_id=context.company["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={
            "role": payload.role,
            "location_ids": location_ids,
            "client_ids": client_ids,
            "created_count": created_count,
            "skipped_count": skipped_count,
        },
    )
    return InvitationBulkResponse(
        results=results,
        total_count=len(results),
        created_count=created_count,
        skipped_count=skipped_count,
    )


@router.post("/invitations/{invitation_id}/resend", response_model=InvitationCreated)
async def resend_invitation(
    invitation_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    settings: SettingsDep,
) -> InvitationCreated:
    context.require("invitations.manage")
    invitation = await database.invitations.find_one(
        {"_id": invitation_id, "company_id": context.company["_id"]}
    )
    if invitation is None:
        raise APIError(404, "invitation_not_found", "The invitation was not found.")
    if invitation.get("accepted_at") is not None:
        raise APIError(409, "invitation_already_accepted", "Accepted invitations cannot be resent.")
    if invitation.get("revoked_at") is not None:
        raise APIError(409, "invitation_revoked", "Revoked invitations cannot be resent. Issue a new invite or replace it.")

    if context.location_scope is not None and not context.is_owner:
        inv_whs = invitation.get("warehouse_ids") or invitation.get("location_ids") or []
        if not inv_whs or any(wid not in context.location_scope for wid in inv_whs):
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "You cannot resend invitations outside your authorized warehouse facilities.",
            )

    now = utcnow()
    if invitation.get("expires_at") <= now:
        raise APIError(409, "invitation_expired", "This invitation has expired. Use the Replace action to generate a fresh invitation.")

    wh_ids = invitation.get("warehouse_ids") or invitation.get("location_ids", [])
    warehouse_names: list[str] = await _resolve_warehouse_and_location_names(
        database, context.company["_id"], wh_ids
    )

    role_label = ROLE_LABELS.get(invitation["role"], invitation["role"].replace("_", " ").title())
    delivered, delivery_status, error_msg = await send_invitation_email(
        settings,
        to_email=invitation["email"],
        recipient_name=invitation["email"].split("@")[0],
        company_name=context.company.get("name", "NTAN Inventory"),
        role_name=role_label,
        invite_code=invitation["invite_code"],
        invite_url=f"https://app.ntan.in/join?code={invitation['invite_code']}",
        assigned_warehouses=warehouse_names,
        expires_at=invitation["expires_at"],
    )

    await database.invitations.update_one(
        {"_id": invitation_id},
        {
            "$set": {
                "email_delivery_status": delivery_status,
                "email_delivery_error": error_msg,
                "updated_at": utcnow(),
            }
        },
    )
    invitation["email_delivery_status"] = delivery_status
    invitation["email_delivery_error"] = error_msg

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="invitation.resent",
        entity="invitation",
        entity_id=invitation_id,
        request_id=getattr(request.state, "request_id", None),
        after={"email": invitation["email"], "email_delivery_status": delivery_status},
    )

    return InvitationCreated(
        **invitation_out(invitation).model_dump(),
        invitation_token=None,
    )


@router.post("/invitations/{invitation_id}/replace", response_model=InvitationCreated)
async def replace_invitation(
    invitation_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    settings: SettingsDep,
) -> InvitationCreated:
    context.require("invitations.manage", "roles.assign")
    invitation = await database.invitations.find_one(
        {"_id": invitation_id, "company_id": context.company["_id"]}
    )
    if invitation is None:
        raise APIError(404, "invitation_not_found", "The invitation was not found.")
    if invitation.get("accepted_at") is not None:
        raise APIError(409, "invitation_already_accepted", "Accepted invitations cannot be replaced.")

    if context.location_scope is not None and not context.is_owner:
        inv_whs = invitation.get("warehouse_ids") or invitation.get("location_ids") or []
        if not inv_whs or any(wid not in context.location_scope for wid in inv_whs):
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "You cannot replace invitations outside your authorized warehouse facilities.",
            )

    now = utcnow()
    await database.invitations.update_one(
        {"_id": invitation_id, "company_id": context.company["_id"]},
        {"$set": {"revoked_at": now, "updated_at": now}, "$unset": {"active_key": ""}},
    )

    email = invitation["email"]
    role = invitation["role"]
    location_ids = invitation.get("warehouse_ids") or invitation.get("location_ids", [])
    client_ids = invitation.get("client_ids", [])

    status_value, new_doc, invitation_token = await _create_invitation_document(
        database,
        context,
        email,
        role,
        location_ids,
        client_ids,
        now,
        valid_from=invitation.get("valid_from"),
        valid_until=invitation.get("valid_until"),
        phone=invitation.get("phone"),
        department=invitation.get("department"),
        job_title=invitation.get("job_title"),
        employee_id=invitation.get("employee_id"),
    )
    if status_value != "created" or new_doc is None or invitation_token is None:
        raise APIError(409, "invitation_replace_failed", "Could not replace invitation. Please try again.")

    warehouse_names: list[str] = await _resolve_warehouse_and_location_names(
        database, context.company["_id"], location_ids
    )

    role_label = ROLE_LABELS.get(role, role.replace("_", " ").title())
    delivered, delivery_status, error_msg = await send_invitation_email(
        settings,
        to_email=email,
        recipient_name=email.split("@")[0],
        company_name=context.company.get("name", "NTAN Inventory"),
        role_name=role_label,
        invite_code=new_doc["invite_code"],
        invite_url=f"https://app.ntan.in/join?code={new_doc['invite_code']}",
        assigned_warehouses=warehouse_names,
        expires_at=new_doc["expires_at"],
    )

    await database.invitations.update_one(
        {"_id": new_doc["_id"]},
        {"$set": {"email_delivery_status": delivery_status, "email_delivery_error": error_msg}},
    )
    new_doc["email_delivery_status"] = delivery_status
    new_doc["email_delivery_error"] = error_msg

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="invitation.replaced",
        entity="invitation",
        entity_id=new_doc["_id"],
        request_id=getattr(request.state, "request_id", None),
        before={"old_invitation_id": invitation_id},
        after={"new_invitation_id": new_doc["_id"], "email": email},
    )

    return InvitationCreated(
        **invitation_out(new_doc).model_dump(),
        invitation_token=invitation_token,
    )


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> Response:
    context.require("invitations.manage")
    invitation = await database.invitations.find_one(
        {"_id": invitation_id, "company_id": context.company["_id"]}
    )
    if invitation is None:
        raise APIError(404, "invitation_not_found", "The invitation was not found.")
    if invitation.get("accepted_at") is not None:
        raise APIError(
            409,
            "invitation_already_accepted",
            "Accepted invitations cannot be revoked.",
        )
    if invitation.get("revoked_at") is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    if context.location_scope is not None and not context.is_owner:
        inv_whs = invitation.get("warehouse_ids") or invitation.get("location_ids") or []
        if not inv_whs or any(wid not in context.location_scope for wid in inv_whs):
            raise APIError(
                403,
                "delegation_scope_exceeded",
                "You cannot revoke invitations outside your authorized warehouse facilities.",
            )
    now = utcnow()
    await database.invitations.update_one(
        {"_id": invitation_id, "company_id": context.company["_id"], "revoked_at": None},
        {
            "$set": {"revoked_at": now, "updated_at": now},
            "$unset": {"active_key": ""},
        },
    )
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="invitation.revoked",
        entity="invitation",
        entity_id=invitation_id,
        request_id=getattr(request.state, "request_id", None),
        before={"email": invitation["email"], "role": invitation["role"]},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 5. BULK EXCEL IMPORT
# ---------------------------------------------------------------------------
@router.get("/import/template")
async def download_import_template(
    context: ContextDep,
    database: DbDep,
) -> StreamingResponse:
    context.require("invitations.manage")
    company_id = context.company["_id"]

    warehouses = await database.locations.find(
        {"company_id": company_id, "status": "active"}
    ).to_list(length=100)
    wh_list = [(w.get("code") or w["_id"], w.get("name") or w["_id"]) for w in warehouses]

    custom_roles = await database.custom_roles.find(
        {"company_id": company_id, "is_active": {"$ne": False}}
    ).to_list(length=100)
    custom_role_list = [(cr["slug"], cr["name"]) for cr in custom_roles]

    excel_bytes = create_excel_template(warehouses=wh_list, custom_roles=custom_role_list)

    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=NTAN_Employee_Import_Template.xlsx"},
    )


@router.post("/import/preview", response_model=ExcelImportPreviewResponse)
async def preview_excel_import(
    context: ContextDep,
    database: DbDep,
    file: UploadFile = File(...),
) -> ExcelImportPreviewResponse:
    context.require("invitations.manage", "roles.assign")
    company_id = context.company["_id"]

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise APIError(413, "file_too_large", "Import file size exceeds 10MB limit.")

    parsed_rows, parse_errors = parse_import_file(file.filename or "upload.xlsx", content)
    if parse_errors:
        raise APIError(422, "import_file_invalid", parse_errors[0])

    if not parsed_rows:
        raise APIError(422, "empty_file", "The spreadsheet contains no data rows.")

    if len(parsed_rows) > 500:
        raise APIError(422, "row_limit_exceeded", "Maximum 500 rows allowed per import.")

    now = utcnow()

    existing_memberships = await database.memberships.find(
        {"company_id": company_id, "status": "active"}
    ).to_list(length=1000)
    member_user_ids = [m["user_id"] for m in existing_memberships]
    member_users = await database.users.find({"_id": {"$in": member_user_ids}}).to_list(length=len(member_user_ids))
    existing_emails = {u["email"].lower() for u in member_users if u.get("email")}

    pending_invites = await database.invitations.find(
        {
            "company_id": company_id,
            "accepted_at": None,
            "revoked_at": None,
            "expires_at": {"$gt": now},
        }
    ).to_list(length=1000)
    pending_emails = {inv["email"].lower() for inv in pending_invites}

    valid_wh_map, display_name_map = await _build_warehouse_maps(database, company_id)
    active_wh_docs = await database.warehouses.find({"company_id": company_id, "status": {"$ne": "archived"}}).to_list(length=10)

    custom_roles = await database.custom_roles.find({"company_id": company_id, "is_active": {"$ne": False}}).to_list(length=100)
    valid_role_slugs = set(DEFAULT_ROLES).union({cr["slug"] for cr in custom_roles})

    seen_emails_in_file: set[str] = set()
    row_previews: list[ExcelImportRowPreview] = []

    valid_count = 0
    invalid_count = 0
    duplicate_count = 0
    existing_members_count = 0
    pending_invites_count = 0

    for r in parsed_rows:
        row_idx = r.get("row_number") or r.get("row_index") or 0
        raw_email = r.get("email", "").strip().lower()
        full_name = sanitize_for_spreadsheet(r.get("name", "").strip())
        role_slug = r.get("role", "").strip().lower()
        raw_whs = r.get("warehouse_codes", [])

        errors: list[str] = []
        warnings: list[str] = []

        if not raw_email or "@" not in raw_email or "." not in raw_email:
            errors.append("Invalid or missing email address.")
        if not full_name:
            errors.append("Full name is required.")

        if raw_email in seen_emails_in_file:
            duplicate_count += 1
            errors.append("Duplicate email address within this import file.")
        else:
            seen_emails_in_file.add(raw_email)

        if raw_email in existing_emails:
            existing_members_count += 1
            errors.append("This person is already an active member of this organization.")

        if raw_email in pending_emails:
            pending_invites_count += 1
            warnings.append("A pending invitation already exists for this email. Confirming will replace it.")

        if not role_slug:
            errors.append("Role is required.")
        elif role_slug not in valid_role_slugs:
            errors.append(f"Invalid role '{role_slug}'. Must match a valid NTAN role code.")
        elif role_slug == "owner" and not context.is_owner:
            errors.append("Only an organization owner can assign the owner role.")
        elif not context.is_owner:
            target_perms = permissions_for(role_slug)
            caller_perms = set(context.permissions)
            excess = set(target_perms) - caller_perms
            if excess:
                errors.append(f"Delegation restricted: cannot grant role with permissions: {', '.join(sorted(excess))}")

        resolved_warehouse_ids: list[str] = []
        for raw_w in raw_whs:
            key = raw_w.lower().strip()
            norm_k = re.sub(r"[\s\-_]", "", key)
            wid = valid_wh_map.get(key) or valid_wh_map.get(norm_k)
            if not wid and len(active_wh_docs) == 1:
                wid = active_wh_docs[0]["_id"]
            if wid:
                if context.location_scope is not None and not context.is_owner and wid not in context.location_scope:
                    errors.append(f"Warehouse '{raw_w}' is outside your authorized facilities.")
                else:
                    if wid not in resolved_warehouse_ids:
                        resolved_warehouse_ids.append(wid)
            else:
                errors.append(f"Warehouse '{raw_w}' was not found in your organization.")

        if context.location_scope is not None and not context.is_owner and not resolved_warehouse_ids:
            errors.append("Managers with scoped warehouse access must explicitly specify warehouse assignments within their authorized facilities.")

        is_valid = len(errors) == 0
        status_tag = "valid"
        if not is_valid:
            invalid_count += 1
            status_tag = "invalid"
        else:
            valid_count += 1

        row_previews.append(
            ExcelImportRowPreview(
                row_number=row_idx,
                name=full_name,
                email=raw_email,
                role=role_slug,
                role_label=ROLE_LABELS.get(role_slug, role_slug.replace("_", " ").title()),
                phone=r.get("phone"),
                department=r.get("department"),
                job_title=r.get("job_title"),
                employee_id=r.get("employee_id"),
                warehouse_codes=resolved_warehouse_ids,
                warehouse_names=[display_name_map.get(wid, wid) for wid in resolved_warehouse_ids],
                status=status_tag,
                is_valid=is_valid,
                errors=errors,
                warnings=warnings,
            )
        )

    return ExcelImportPreviewResponse(
        total_rows=len(parsed_rows),
        valid_count=valid_count,
        invalid_count=invalid_count,
        duplicate_count=duplicate_count,
        existing_member_count=existing_members_count,
        pending_invitation_count=pending_invites_count,
        warnings_count=sum(len(rp.warnings) for rp in row_previews),
        rows=row_previews,
    )


@router.post("/import/confirm", response_model=ExcelImportConfirmResponse)
async def confirm_excel_import(
    payload: ExcelImportConfirmRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
    settings: SettingsDep,
    background_tasks: BackgroundTasks,
) -> ExcelImportConfirmResponse:
    context.require("invitations.manage", "roles.assign")
    company_id = context.company["_id"]
    now = utcnow()

    created_count = 0
    skipped_count = 0
    failed_count = 0
    results: list[ExcelImportResultItem] = []
    email_tasks: list[dict[str, Any]] = []

    valid_wh_map, display_name_map = await _build_warehouse_maps(database, company_id)
    active_wh_docs = await database.warehouses.find({"company_id": company_id, "status": {"$ne": "archived"}}).to_list(length=10)

    for row in payload.rows:
        email = str(row.email).strip().lower()
        role = row.role.strip().lower()
        raw_wh_ids = row.warehouse_codes or []
        resolved_wids: list[str] = []
        for raw_w in raw_wh_ids:
            key = str(raw_w).lower().strip()
            norm_k = re.sub(r"[\s\-_]", "", key)
            wid = valid_wh_map.get(key) or valid_wh_map.get(norm_k)
            if not wid and len(active_wh_docs) == 1:
                wid = active_wh_docs[0]["_id"]
            if wid and wid not in resolved_wids:
                resolved_wids.append(wid)
        wh_ids = resolved_wids

        if context.location_scope is not None and not context.is_owner:
            if not wh_ids or any(wid not in context.location_scope for wid in wh_ids):
                failed_count += 1
                results.append(
                    ExcelImportResultItem(
                        email=email,
                        name=row.name,
                        status="failed",
                        row_number=row.row_number,
                        message="Cannot assign warehouses outside your authorized scope.",
                    )
                )
                continue

        await database.invitations.update_many(
            {
                "company_id": company_id,
                "email": email,
                "accepted_at": None,
                "revoked_at": None,
            },
            {"$set": {"revoked_at": now, "updated_at": now}, "$unset": {"active_key": ""}},
        )

        status_val, doc, inv_token = await _create_invitation_document(
            database,
            context,
            email,
            role,
            wh_ids,
            [],
            now,
            name=row.name,
            phone=row.phone,
            department=row.department,
            job_title=row.job_title,
            employee_id=row.employee_id,
            valid_from=row.valid_from,
            valid_until=row.valid_until,
        )

        if status_val == "already_member":
            skipped_count += 1
            results.append(
                ExcelImportResultItem(
                    email=email,
                    name=row.name,
                    status="skipped",
                    row_number=row.row_number,
                    message="Already an active member.",
                )
            )
            continue

        if status_val != "created" or doc is None:
            failed_count += 1
            results.append(
                ExcelImportResultItem(
                    email=email,
                    name=row.name,
                    status="failed",
                    row_number=row.row_number,
                    message="Could not create invitation.",
                )
            )
            continue

        wh_names = [display_name_map.get(wid, wid) for wid in wh_ids]
        role_label = ROLE_LABELS.get(role, role.replace("_", " ").title())
        del_status = "pending"
        if payload.send_emails:
            email_tasks.append({
                "doc_id": doc["_id"],
                "to_email": email,
                "recipient_name": row.name or email.split("@")[0],
                "company_name": context.company.get("name", "NTAN Inventory"),
                "role_name": role_label,
                "invite_code": doc["invite_code"],
                "invite_url": f"https://app.ntan.in/join?code={doc['invite_code']}",
                "assigned_warehouses": wh_names,
                "expires_at": doc["expires_at"],
            })

        created_count += 1
        results.append(
            ExcelImportResultItem(
                email=email,
                name=row.name,
                status="created",
                row_number=row.row_number,
                invitation_id=doc["_id"],
                invite_code=doc["invite_code"],
                delivery_status=del_status,
                email_delivery_status=del_status,
                message="Invitation created successfully.",
            )
        )

    if email_tasks:
        background_tasks.add_task(_send_bulk_invitations_background, settings, database, email_tasks)

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="invitation.bulk_created",
        entity="company",
        entity_id=company_id,
        request_id=getattr(request.state, "request_id", None),
        after={
            "created_count": created_count,
            "skipped_count": skipped_count,
            "failed_count": failed_count,
            "total_rows": len(payload.rows),
        },
    )

    return ExcelImportConfirmResponse(
        total_processed=len(payload.rows),
        created_count=created_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        results=results,
    )
