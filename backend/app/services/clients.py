from typing import Any

from ..errors import APIError
from ..utils import new_id, utcnow

INTERNAL_CLIENT_CODE = "INTERNAL"


async def ensure_internal_client(
    database: Any,
    company_id: str,
    *,
    session: Any = None,
) -> dict[str, Any]:
    query = {
        "company_id": company_id,
        "$or": [{"is_internal": True}, {"code": INTERNAL_CLIENT_CODE}],
    }
    existing = await database.clients.find_one(query, session=session)
    if existing is not None:
        if not existing.get("is_internal") or existing.get("code") != INTERNAL_CLIENT_CODE:
            await database.clients.update_one(
                {"_id": existing["_id"], "company_id": company_id},
                {
                    "$set": {
                        "is_internal": True,
                        "code": INTERNAL_CLIENT_CODE,
                        "updated_at": utcnow(),
                    }
                },
                session=session,
            )
            existing = {
                **existing,
                "is_internal": True,
                "code": INTERNAL_CLIENT_CODE,
            }
        return existing

    now = utcnow()
    document = {
        "_id": new_id(),
        "company_id": company_id,
        "code": INTERNAL_CLIENT_CODE,
        "name": "Internal",
        "types": ["3pl_client"],
        "contact_name": None,
        "contact_email": None,
        "is_internal": True,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await database.clients.insert_one(document, session=session)
    return document


async def resolve_client_id(
    database: Any,
    context: Any,
    requested_client_id: str | None,
) -> str:
    company_id = context.company["_id"]
    scope = context.client_scope

    if requested_client_id is not None:
        clean_id = str(requested_client_id).strip()
        if not clean_id or clean_id.lower() in ("all", "*", "null", "none"):
            raise APIError(
                422,
                "invalid_client",
                "Transactions require an explicit inventory owner, not 'all'.",
                {"client_id": "Select an explicit inventory owner."},
            )
        client = await database.clients.find_one(
            {
                "_id": clean_id,
                "company_id": company_id,
                "status": "active",
            }
        )
        if client is None:
            raise APIError(
                422,
                "invalid_client",
                "The selected client was not found or is inactive.",
                {"client_id": "Select an active client."},
            )
        if not client.get("is_internal") and "3pl_client" not in client.get("types", ["3pl_client"]):
            raise APIError(
                422,
                "invalid_client",
                "The selected partner is not configured as a 3PL inventory client.",
                {"client_id": "Select a partner with the 3PL client role."},
            )
        if scope is not None and clean_id not in scope:
            raise APIError(
                403,
                "client_forbidden",
                "You do not have access to this client.",
            )
        return clean_id

    if scope is not None:
        if len(scope) == 1:
            return next(iter(scope))
        if scope:
            internal = await database.clients.find_one(
                {
                    "company_id": company_id,
                    "is_internal": True,
                    "_id": {"$in": sorted(scope)},
                }
            )
            if internal is not None:
                return internal["_id"]
            raise APIError(
                422,
                "client_required",
                "Select an inventory owner for this operation.",
                {"client_id": "An inventory owner is required."},
            )

    inventory_model = context.company.get("inventory_model", "internal")
    if inventory_model == "3pl":
        raise APIError(
            422,
            "client_required",
            "Select an inventory owner for this operation.",
            {"client_id": "An inventory owner is required in 3PL inventory mode."},
        )

    internal = await ensure_internal_client(database, company_id)
    return internal["_id"]


async def ensure_client_access(database: Any, context: Any, client_id: str | None) -> None:
    if client_id is None:
        return
    scope = context.client_scope
    if scope is not None and client_id not in scope:
        raise APIError(
            404,
            "item_not_found",
            "The item was not found.",
        )
    exists = await database.clients.find_one(
        {
            "_id": client_id,
            "company_id": context.company["_id"],
            "status": "active",
        }
    )
    if exists is None:
        raise APIError(404, "item_not_found", "The item was not found.")


def apply_client_scope(query: dict[str, Any], scope: frozenset[str] | None) -> None:
    if scope is None:
        return
    requested = query.get("client_id")
    if isinstance(requested, str):
        query["client_id"] = requested if requested in scope else {"$in": []}
        return
    query["client_id"] = {"$in": sorted(scope)}
