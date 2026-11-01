import hashlib
import json
import re
import secrets
from datetime import UTC, datetime, time
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..schemas import (
    PurchaseOrderCreate,
    PurchaseOrderListResponse,
    PurchaseOrderOut,
)
from ..serializers import purchase_order_out
from ..services.clients import apply_client_scope, resolve_client_id
from ..services.supplier_items import supplier_sku_snapshot
from ..services.sync import append_sync_event
from ..utils import (
    decode_cursor,
    encode_cursor,
    new_id,
    to_decimal,
    to_decimal128,
    utcnow,
)

router = APIRouter(prefix="/purchase-orders", tags=["purchasing"])

ZERO = Decimal("0")

RECEIVABLE_STATUSES = ("open", "partially_received")
PURCHASE_ORDER_STATUSES = ("open", "partially_received", "received", "cancelled")


def _order_number(now: datetime) -> str:
    return f"PO-{now:%Y%m%d}-{secrets.token_hex(3).upper()}"


def _fingerprint(payload: PurchaseOrderCreate) -> str:
    raw = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _ensure_warehouse_scope(
    database: Any,
    context: ContextDep,
    warehouse_id: str,
) -> None:
    if context.location_scope is None:
        return
    allowed = await database.locations.find_one(
        {
            "company_id": context.company["_id"],
            "warehouse_id": warehouse_id,
            "_id": {"$in": sorted(context.location_scope)},
        }
    )
    if allowed is None:
        raise APIError(
            403,
            "location_forbidden",
            "You do not have access to this warehouse.",
        )


async def warehouse_scope_query(database: Any, context: ContextDep) -> list[str] | None:
    """Return the warehouse ids a location-scoped member may see, or ``None``."""
    if context.location_scope is None:
        return None
    return list(
        await database.locations.distinct(
            "warehouse_id",
            {
                "company_id": context.company["_id"],
                "_id": {"$in": sorted(context.location_scope)},
            },
        )
    )


def purchase_order_query(
    context: ContextDep,
    *,
    purchase_order_id: str | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if purchase_order_id is not None:
        query["_id"] = purchase_order_id
    apply_client_scope(query, context.client_scope)
    return query


async def find_purchase_order(
    database: Any,
    context: ContextDep,
    purchase_order_id: str,
    *,
    session: Any = None,
) -> dict[str, Any]:
    purchase_order = await database.purchase_orders.find_one(
        purchase_order_query(context, purchase_order_id=purchase_order_id),
        session=session,
    )
    if purchase_order is None:
        raise APIError(404, "purchase_order_not_found", "The purchase order was not found.")
    await _ensure_warehouse_scope(database, context, purchase_order["warehouse_id"])
    return purchase_order


@router.post("", response_model=PurchaseOrderOut, status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    payload: PurchaseOrderCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=200)],
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> PurchaseOrderOut:
    context.require("purchasing.manage")
    company_id = context.company["_id"]
    client_id = await resolve_client_id(database, context, payload.client_id)
    await _ensure_warehouse_scope(database, context, payload.warehouse_id)

    warehouse = await database.warehouses.find_one(
        {"_id": payload.warehouse_id, "company_id": company_id, "status": "active"}
    )
    if warehouse is None:
        raise APIError(
            422,
            "invalid_warehouse",
            "Select an active warehouse.",
            {"warehouse_id": "Select an active warehouse."},
        )

    supplier = await database.clients.find_one(
        {"_id": payload.supplier_id, "company_id": company_id, "status": "active"}
    )
    if supplier is None or "supplier" not in supplier.get("types", []):
        raise APIError(
            422,
            "invalid_supplier",
            "Select an active supplier.",
            {"supplier_id": "Select a partner configured as a supplier."},
        )

    item_ids = [line.item_id for line in payload.lines]
    if len(item_ids) != len(set(item_ids)):
        raise APIError(
            422,
            "duplicate_item",
            "Each item can appear only once on a purchase order.",
            {"lines": "Combine duplicate item lines into one quantity."},
        )

    items = await database.items.find(
        {"_id": {"$in": item_ids}, "company_id": company_id, "client_id": client_id}
    ).to_list(length=len(item_ids))
    item_map = {item["_id"]: item for item in items}
    supplier_skus = await supplier_sku_snapshot(
        database, company_id, supplier["_id"], item_ids
    )
    lines: list[dict[str, Any]] = []
    for index, line in enumerate(payload.lines):
        item = item_map.get(line.item_id)
        if item is None:
            raise APIError(
                422,
                "invalid_item",
                "A purchase-order line references an item that was not found.",
                {f"lines.{index}.item_id": "Select an active item for this inventory owner."},
            )
        if item.get("status") != "active":
            raise APIError(
                422,
                "inactive_item",
                "A purchase-order line references an inactive item.",
                {f"lines.{index}.item_id": "Select an active item."},
            )
        lines.append(
            {
                "id": new_id(),
                "item_id": item["_id"],
                "sku": item["sku"],
                "supplier_sku": supplier_skus.get(item["_id"]),
                "item_name": item["name"],
                "uom": item["base_uom"],
                "base_uom": item["base_uom"],
                "ordered_qty": to_decimal128(line.qty),
                "received_qty": to_decimal128(ZERO),
            }
        )

    fingerprint = _fingerprint(payload)
    existing = await database.purchase_orders.find_one(
        {"company_id": company_id, "idempotency_key": idempotency_key}
    )
    if existing is not None:
        if existing.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            )
        return purchase_order_out(existing)

    now = utcnow()
    expected_date = (
        datetime.combine(payload.expected_date, time.min, tzinfo=UTC)
        if payload.expected_date
        else None
    )
    purchase_order = {
        "_id": new_id(),
        "company_id": company_id,
        "client_id": client_id,
        "number": _order_number(now),
        "status": "open",
        "warehouse_id": payload.warehouse_id,
        "supplier_id": supplier["_id"],
        "supplier_name": supplier.get("display_name") or supplier.get("name"),
        "expected_date": expected_date,
        "note": payload.note,
        "lines": lines,
        "receipts": [],
        "version": 0,
        "idempotency_key": idempotency_key,
        "request_fingerprint": fingerprint,
        "created_by": context.user["_id"],
        "created_at": now,
        "updated_at": now,
        "received_at": None,
        "cancelled_at": None,
        "device_id": device_id,
    }
    try:
        await database.purchase_orders.insert_one(purchase_order)
    except DuplicateKeyError as exc:
        duplicate = await database.purchase_orders.find_one(
            {"company_id": company_id, "idempotency_key": idempotency_key}
        )
        if duplicate is None:
            raise APIError(
                409,
                "purchase_order_number_conflict",
                "The purchase order could not be saved. Retry the request.",
                retryable=True,
            ) from exc
        if duplicate.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            ) from exc
        return purchase_order_out(duplicate)

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="purchase_order.created",
        entity="purchase_order",
        entity_id=purchase_order["_id"],
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        after={
            "number": purchase_order["number"],
            "status": purchase_order["status"],
            "line_count": len(lines),
            "supplier_id": purchase_order["supplier_id"],
            "warehouse_id": purchase_order["warehouse_id"],
        },
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="purchase_order",
        entity_id=purchase_order["_id"],
        action="purchase_order.created",
        client_id=client_id,
        payload={
            "number": purchase_order["number"],
            "status": purchase_order["status"],
            "line_count": len(lines),
        },
        occurred_at=now,
    )
    return purchase_order_out(purchase_order)


@router.get("", response_model=PurchaseOrderListResponse)
async def list_purchase_orders(
    context: ContextDep,
    database: DbDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    supplier_id: str | None = None,
    warehouse_id: str | None = None,
    client_id: str | None = None,
    search: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
) -> PurchaseOrderListResponse:
    context.require("inventory.read")
    # Apply the requested owner before the member's client scope so an
    # out-of-scope ``client_id`` is narrowed to nothing instead of widening it.
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)
    if supplier_id:
        query["supplier_id"] = supplier_id
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    allowed_warehouses = await warehouse_scope_query(database, context)
    if allowed_warehouses is not None:
        query["warehouse_id"] = {"$in": allowed_warehouses}
    if status_filter:
        requested = status_filter.strip().lower()
        if requested not in PURCHASE_ORDER_STATUSES:
            raise APIError(
                422,
                "invalid_status",
                "Select a valid purchase-order status.",
                {"status": "Use open, partially_received, received, or cancelled."},
            )
        query["status"] = requested
    if search and search.strip():
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"number": {"$regex": pattern, "$options": "i"}},
            {"supplier_name": {"$regex": pattern, "$options": "i"}},
            {"note": {"$regex": pattern, "$options": "i"}},
            {"lines.sku": {"$regex": pattern, "$options": "i"}},
            {"lines.supplier_sku": {"$regex": pattern, "$options": "i"}},
            {"lines.item_name": {"$regex": pattern, "$options": "i"}},
        ]
    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        cursor_clause = {
            "$or": [
                {"created_at": {"$lt": timestamp}},
                {"created_at": timestamp, "_id": {"$lt": identifier}},
            ]
        }
        if "$or" in query:
            query["$and"] = [{"$or": query.pop("$or")}]
        query["$or"] = cursor_clause["$or"]
    documents = (
        await database.purchase_orders.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["created_at"], documents[-1]["_id"])
    return PurchaseOrderListResponse(
        orders=[purchase_order_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/{purchase_order_id}", response_model=PurchaseOrderOut)
async def get_purchase_order(
    purchase_order_id: str,
    context: ContextDep,
    database: DbDep,
) -> PurchaseOrderOut:
    context.require("inventory.read")
    purchase_order = await find_purchase_order(database, context, purchase_order_id)
    return purchase_order_out(purchase_order)


@router.post("/{purchase_order_id}/cancel", response_model=PurchaseOrderOut)
async def cancel_purchase_order(
    purchase_order_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> PurchaseOrderOut:
    context.require("purchasing.manage")
    company_id = context.company["_id"]
    now = utcnow()
    purchase_order = await find_purchase_order(database, context, purchase_order_id)
    if purchase_order["status"] == "cancelled":
        return purchase_order_out(purchase_order)
    received = sum(
        (to_decimal(line.get("received_qty")) for line in purchase_order.get("lines", [])),
        ZERO,
    )
    if purchase_order["status"] != "open" or received > ZERO:
        raise APIError(
            409,
            "purchase_order_not_cancellable",
            "Only purchase orders without received stock can be cancelled.",
        )
    draft_receipts = await database.receipts.count_documents(
        {
            "company_id": company_id,
            "purchase_order_id": purchase_order_id,
            "status": "draft",
        }
    )
    if draft_receipts > 0:
        raise APIError(
            409,
            "purchase_order_has_drafts",
            "Draft receipts reference this purchase order. Discard them before cancelling.",
            {"purchase_order_id": "Discard the outstanding receipt drafts first."},
        )
    updated = await database.purchase_orders.find_one_and_update(
        {
            "_id": purchase_order_id,
            "company_id": company_id,
            "status": "open",
            "version": purchase_order.get("version", 0),
        },
        {
            "$set": {"status": "cancelled", "cancelled_at": now, "updated_at": now},
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise APIError(
            409,
            "purchase_order_cancel_conflict",
            "The purchase order was modified by another request.",
            retryable=True,
        )
    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="purchase_order.cancelled",
        entity="purchase_order",
        entity_id=purchase_order_id,
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        before={"status": "open"},
        after={"status": "cancelled"},
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="purchase_order",
        entity_id=purchase_order_id,
        action="purchase_order.cancelled",
        client_id=updated.get("client_id"),
        payload={"number": updated["number"], "status": "cancelled"},
        occurred_at=now,
    )
    return purchase_order_out(updated)
