import hashlib
import json
import secrets
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..schemas import (
    OutboundAllocationOut,
    OutboundLineOut,
    OutboundOrderCreate,
    OutboundOrderListResponse,
    OutboundOrderOut,
)
from ..services.clients import apply_client_scope, ensure_client_access, resolve_client_id
from ..services.sync import append_sync_event
from ..utils import (
    decode_cursor,
    encode_cursor,
    new_id,
    to_decimal,
    to_decimal128,
    utcnow,
)

router = APIRouter(tags=["outbound"])

ZERO = Decimal("0")


def _order_number(now: datetime) -> str:
    return f"SO-{now:%Y%m%d}-{secrets.token_hex(3).upper()}"


def _fingerprint(payload: OutboundOrderCreate) -> str:
    raw = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _line_out(line: dict[str, Any]) -> OutboundLineOut:
    return OutboundLineOut(
        id=line["id"],
        item_id=line["item_id"],
        sku=line["sku"],
        item_name=line["item_name"],
        qty=to_decimal(line["qty"]),
        uom=line["uom"],
        base_qty=to_decimal(line["base_qty"]),
        base_uom=line["base_uom"],
    )


def _allocation_out(allocation: dict[str, Any]) -> OutboundAllocationOut:
    return OutboundAllocationOut(
        id=allocation["id"],
        line_id=allocation["line_id"],
        item_id=allocation["item_id"],
        sku=allocation["sku"],
        item_name=allocation["item_name"],
        location_id=allocation["location_id"],
        location_code=allocation["location_code"],
        lot_id=allocation.get("lot_id"),
        lot_no=allocation.get("lot_no"),
        expiry_date=allocation.get("expiry_date"),
        serial_id=allocation.get("serial_id"),
        serial_no=allocation.get("serial_no"),
        qty=to_decimal(allocation["qty"]),
        base_qty=to_decimal(allocation["base_qty"]),
        base_uom=allocation["base_uom"],
        status=allocation["status"],
        picked_at=allocation.get("picked_at"),
        picked_by=allocation.get("picked_by"),
    )


def _order_out(order: dict[str, Any]) -> OutboundOrderOut:
    return OutboundOrderOut(
        id=order["_id"],
        company_id=order["company_id"],
        client_id=order.get("client_id"),
        number=order["number"],
        status=order["status"],
        warehouse_id=order["warehouse_id"],
        customer_name=order["customer_name"],
        customer_reference=order.get("customer_reference"),
        note=order.get("note"),
        lines=[_line_out(line) for line in order.get("lines", [])],
        allocations=[_allocation_out(row) for row in order.get("allocations", [])],
        created_at=order["created_at"],
        updated_at=order["updated_at"],
        allocated_at=order.get("allocated_at"),
        shipped_at=order.get("shipped_at"),
        cancelled_at=order.get("cancelled_at"),
    )


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


@router.post(
    "/outbound/orders",
    response_model=OutboundOrderOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_outbound_order(
    payload: OutboundOrderCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=200)],
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> OutboundOrderOut:
    context.require("stock.issue")
    company_id = context.company["_id"]
    client_id = await resolve_client_id(database, context, payload.client_id)
    await ensure_client_access(database, context, client_id)
    await _ensure_warehouse_scope(database, context, payload.warehouse_id)
    warehouse = await database.warehouses.find_one(
        {
            "_id": payload.warehouse_id,
            "company_id": company_id,
            "status": "active",
        }
    )
    if warehouse is None:
        raise APIError(
            422,
            "invalid_warehouse",
            "Select an active warehouse.",
            {"warehouse_id": "Select an active warehouse."},
        )

    item_ids = [line.item_id for line in payload.lines]
    if len(item_ids) != len(set(item_ids)):
        raise APIError(
            422,
            "duplicate_item",
            "Each item can appear only once on an outbound order.",
            {"lines": "Combine duplicate item lines into one quantity."},
        )
    items = await database.items.find(
        {
            "_id": {"$in": item_ids},
            "company_id": company_id,
            "client_id": client_id,
        }
    ).to_list(length=len(item_ids))
    item_map = {item["_id"]: item for item in items}
    lines: list[dict[str, Any]] = []
    for index, line in enumerate(payload.lines):
        item = item_map.get(line.item_id)
        if item is None:
            raise APIError(
                422,
                "invalid_item",
                "An order line references an item that was not found.",
                {f"lines.{index}.item_id": "Select an active item for this client."},
            )
        if item.get("status") != "active":
            raise APIError(
                422,
                "inactive_item",
                "An order line references an inactive item.",
                {f"lines.{index}.item_id": "Select an active item."},
            )
        lines.append(
            {
                "id": new_id(),
                "item_id": item["_id"],
                "sku": item["sku"],
                "item_name": item["name"],
                "qty": to_decimal128(line.qty),
                "uom": item["base_uom"],
                "base_qty": to_decimal128(line.qty),
                "base_uom": item["base_uom"],
            }
        )

    fingerprint = _fingerprint(payload)
    existing = await database.outbound_orders.find_one(
        {"company_id": company_id, "idempotency_key": idempotency_key}
    )
    if existing is not None:
        if existing.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            )
        return _order_out(existing)

    customer_id = payload.customer_id
    customer_name = payload.customer_name
    if customer_id:
        cust_doc = await database.clients.find_one(
            {"_id": customer_id, "company_id": company_id}
        )
        if cust_doc and not customer_name:
            customer_name = cust_doc.get("display_name") or cust_doc.get("name")

    now = utcnow()
    order = {
        "_id": new_id(),
        "company_id": company_id,
        "client_id": client_id,
        "number": _order_number(now),
        "status": "draft",
        "warehouse_id": payload.warehouse_id,
        "customer_id": customer_id,
        "customer_name": customer_name,
        "customer_reference": payload.customer_reference,
        "note": payload.note,
        "lines": lines,
        "allocations": [],
        "idempotency_key": idempotency_key,
        "request_fingerprint": fingerprint,
        "created_by": context.user["_id"],
        "created_at": now,
        "updated_at": now,
        "allocated_at": None,
        "shipped_at": None,
        "cancelled_at": None,
        "device_id": device_id,
    }
    try:
        await database.outbound_orders.insert_one(order)
    except DuplicateKeyError as exc:
        duplicate = await database.outbound_orders.find_one(
            {"company_id": company_id, "idempotency_key": idempotency_key}
        )
        if duplicate is None:
            raise APIError(
                409,
                "order_number_conflict",
                "The order could not be saved. Retry the request.",
                retryable=True,
            ) from exc
        if duplicate.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            ) from exc
        return _order_out(duplicate)

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="outbound_order.created",
        entity="outbound_order",
        entity_id=order["_id"],
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        after={"number": order["number"], "line_count": len(lines)},
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="outbound_order",
        entity_id=order["_id"],
        action="outbound_order.created",
        client_id=client_id,
        payload={"number": order["number"], "status": order["status"]},
        occurred_at=now,
    )
    return _order_out(order)


@router.get("/outbound/orders", response_model=OutboundOrderListResponse)
async def list_outbound_orders(
    context: ContextDep,
    database: DbDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
    client_id: str | None = None,
) -> OutboundOrderListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)
    if status_filter:
        query["status"] = status_filter
    if context.location_scope is not None:
        warehouse_ids = await database.locations.distinct(
            "warehouse_id",
            {
                "company_id": context.company["_id"],
                "_id": {"$in": sorted(context.location_scope)},
            },
        )
        query["warehouse_id"] = {"$in": warehouse_ids}
    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        query["$or"] = [
            {"created_at": {"$lt": timestamp}},
            {"created_at": timestamp, "_id": {"$lt": identifier}},
        ]
    documents = (
        await database.outbound_orders.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["created_at"], documents[-1]["_id"])
    return OutboundOrderListResponse(
        orders=[_order_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/outbound/orders/{order_id}", response_model=OutboundOrderOut)
async def get_outbound_order(
    order_id: str,
    context: ContextDep,
    database: DbDep,
) -> OutboundOrderOut:
    context.require("inventory.read")
    query: dict[str, Any] = {"_id": order_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    order = await database.outbound_orders.find_one(query)
    if order is None:
        raise APIError(404, "outbound_order_not_found", "The outbound order was not found.")
    await _ensure_warehouse_scope(database, context, order["warehouse_id"])
    return _order_out(order)


async def _fetch_order(
    database: Any,
    context: ContextDep,
    order_id: str,
    *,
    session: Any = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {"_id": order_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    order = await database.outbound_orders.find_one(query, session=session)
    if order is None:
        raise APIError(404, "outbound_order_not_found", "The outbound order was not found.")
    await _ensure_warehouse_scope(database, context, order["warehouse_id"])
    return order


@router.post("/outbound/orders/{order_id}/allocate", response_model=OutboundOrderOut)
async def allocate_outbound_order(
    order_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> OutboundOrderOut:
    context.require("stock.issue")
    company_id = context.company["_id"]
    now = utcnow()

    async def allocate(session: Any) -> dict[str, Any]:
        order = await _fetch_order(database, context, order_id, session=session)
        if order["status"] == "allocated":
            return order
        if order["status"] != "draft":
            raise APIError(
                409,
                "order_not_allocatable",
                "Only draft orders can be allocated.",
            )
        item_ids = [line["item_id"] for line in order["lines"]]
        balance_query: dict[str, Any] = {
            "company_id": company_id,
            "client_id": order.get("client_id"),
            "warehouse_id": order["warehouse_id"],
            "item_id": {"$in": item_ids},
            "stock_status": "available",
        }
        if context.location_scope is not None:
            balance_query["location_id"] = {"$in": sorted(context.location_scope)}
        balances = await database.balances.find(
            balance_query, session=session
        ).to_list(length=10000)
        balances.sort(
            key=lambda row: (
                row.get("expiry_date") is None,
                row.get("expiry_date") or datetime.max,
                row.get("created_at") or datetime.max,
            )
        )
        location_ids = sorted({row["location_id"] for row in balances})
        locations = await database.locations.find(
            {
                "company_id": company_id,
                "_id": {"$in": location_ids},
            },
            session=session,
        ).to_list(length=len(location_ids))
        location_map = {row["_id"]: row for row in locations}
        by_item: dict[str, list[dict[str, Any]]] = {item_id: [] for item_id in item_ids}
        for balance in balances:
            location = location_map.get(balance["location_id"])
            if (
                location is None
                or location.get("status") != "active"
                or not location.get("is_pickable", True)
            ):
                continue
            available = (
                to_decimal(balance.get("on_hand"))
                - to_decimal(balance.get("reserved"))
                - to_decimal(balance.get("blocked"))
            )
            if available > ZERO:
                by_item.setdefault(balance["item_id"], []).append(
                    {**balance, "_available": available}
                )
        allocations: list[dict[str, Any]] = []
        for index, line in enumerate(order["lines"]):
            remaining = to_decimal(line["base_qty"])
            for balance in by_item.get(line["item_id"], []):
                if remaining <= ZERO:
                    break
                take = min(remaining, balance["_available"])
                if balance.get("serial_id") and take > Decimal("1"):
                    take = Decimal("1")
                if take <= ZERO:
                    continue
                updated = await database.balances.find_one_and_update(
                    {
                        "_id": balance["_id"],
                        "company_id": company_id,
                        "version": balance["version"],
                        "reserved": balance["reserved"],
                    },
                    {
                        "$inc": {"reserved": to_decimal128(take), "version": 1},
                        "$set": {"updated_at": now},
                    },
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )
                if updated is None:
                    raise APIError(
                        409,
                        "allocation_conflict",
                        "Stock changed while the order was being allocated. Retry.",
                        retryable=True,
                    )
                balance["_available"] -= take
                location = location_map.get(balance["location_id"], {})
                allocations.append(
                    {
                        "id": new_id(),
                        "line_id": line["id"],
                        "item_id": line["item_id"],
                        "sku": line["sku"],
                        "item_name": line["item_name"],
                        "location_id": balance["location_id"],
                        "location_code": location.get("code", ""),
                        "lot_id": balance.get("lot_id"),
                        "lot_no": balance.get("lot_no"),
                        "expiry_date": balance.get("expiry_date"),
                        "serial_id": balance.get("serial_id"),
                        "serial_no": balance.get("serial_no"),
                        "qty": to_decimal128(take),
                        "base_qty": to_decimal128(take),
                        "base_uom": line["base_uom"],
                        "status": "pending",
                        "picked_at": None,
                        "picked_by": None,
                        "balance_id": balance["_id"],
                    }
                )
                remaining -= take
            if remaining > ZERO:
                raise APIError(
                    409,
                    "insufficient_stock",
                    "There is not enough available stock to allocate this order.",
                    {
                        f"lines.{index}.qty": (
                            f"{remaining} {line['base_uom']} of {line['sku']} is unavailable."
                        )
                    },
                )
        updated_order = await database.outbound_orders.find_one_and_update(
            {"_id": order_id, "company_id": company_id, "status": "draft"},
            {
                "$set": {
                    "status": "allocated",
                    "allocations": allocations,
                    "allocated_at": now,
                    "updated_at": now,
                }
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated_order is None:
            raise APIError(
                409,
                "order_allocation_conflict",
                "The order was modified by another request. Retry.",
                retryable=True,
            )
        return updated_order

    try:
        async with database.client.start_session() as session:
            order = await session.with_transaction(allocate)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "order_allocation_conflict",
            "The order was modified by another request. Retry.",
            retryable=True,
        ) from exc

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="outbound_order.allocated",
        entity="outbound_order",
        entity_id=order_id,
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        after={"allocation_count": len(order.get("allocations", []))},
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="outbound_order",
        entity_id=order_id,
        action="outbound_order.allocated",
        client_id=order.get("client_id"),
        payload={"status": order["status"]},
        occurred_at=now,
    )
    return _order_out(order)


@router.post(
    "/outbound/orders/{order_id}/allocations/{allocation_id}/pick",
    response_model=OutboundOrderOut,
)
async def pick_outbound_allocation(
    order_id: str,
    allocation_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> OutboundOrderOut:
    context.require("stock.issue")
    company_id = context.company["_id"]
    now = utcnow()
    order = await _fetch_order(database, context, order_id)
    if order["status"] != "allocated":
        raise APIError(409, "order_not_pickable", "Only allocated orders can be picked.")
    allocations = list(order.get("allocations", []))
    index = next(
        (position for position, row in enumerate(allocations) if row["id"] == allocation_id),
        None,
    )
    if index is None:
        raise APIError(404, "allocation_not_found", "The pick allocation was not found.")
    if allocations[index]["status"] == "picked":
        return _order_out(order)
    allocations[index] = {
        **allocations[index],
        "status": "picked",
        "picked_at": now,
        "picked_by": context.user["_id"],
    }
    updated = await database.outbound_orders.find_one_and_update(
        {"_id": order_id, "company_id": company_id, "status": "allocated"},
        {"$set": {"allocations": allocations, "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise APIError(
            409,
            "order_pick_conflict",
            "The order was modified by another request. Retry.",
            retryable=True,
        )
    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="outbound_allocation.picked",
        entity="outbound_order",
        entity_id=order_id,
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        after={"allocation_id": allocation_id},
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="outbound_order",
        entity_id=order_id,
        action="outbound_allocation.picked",
        client_id=order.get("client_id"),
        payload={"allocation_id": allocation_id},
        occurred_at=now,
    )
    return _order_out(updated)


@router.post("/outbound/orders/{order_id}/ship", response_model=OutboundOrderOut)
async def ship_outbound_order(
    order_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> OutboundOrderOut:
    context.require("stock.issue")
    company_id = context.company["_id"]
    now = utcnow()

    async def ship(session: Any) -> dict[str, Any]:
        order = await _fetch_order(database, context, order_id, session=session)
        if order["status"] == "shipped":
            return order
        if order["status"] != "allocated":
            raise APIError(409, "order_not_shippable", "Only allocated orders can be shipped.")
        allocations = order.get("allocations", [])
        if any(row["status"] != "picked" for row in allocations):
            raise APIError(
                409,
                "pick_incomplete",
                "Pick every allocated line before shipping the order.",
            )
        for allocation in allocations:
            quantity = to_decimal128(to_decimal(allocation["base_qty"]))
            updated = await database.balances.find_one_and_update(
                {
                    "_id": allocation["balance_id"],
                    "company_id": company_id,
                    "client_id": order.get("client_id"),
                    "on_hand": {"$gte": quantity},
                    "reserved": {"$gte": quantity},
                    "stock_status": "available",
                },
                {
                    "$inc": {
                        "on_hand": to_decimal128(-to_decimal(quantity)),
                        "reserved": to_decimal128(-to_decimal(quantity)),
                        "version": 1,
                    },
                    "$set": {"updated_at": now},
                },
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            if updated is None:
                raise APIError(
                    409,
                    "outbound_stock_changed",
                    "Reserved stock changed before dispatch. Review the order and retry.",
                    retryable=True,
                )
            await database.movements.insert_one(
                {
                    "_id": new_id(),
                    "company_id": company_id,
                    "client_id": order.get("client_id"),
                    "type": "outbound",
                    "item_id": allocation["item_id"],
                    "sku": allocation["sku"],
                    "item_name": allocation["item_name"],
                    "quantity_delta": to_decimal128(-to_decimal(quantity)),
                    "uom": allocation["base_uom"],
                    "base_qty": quantity,
                    "from_location_id": allocation["location_id"],
                    "to_location_id": None,
                    "lot_id": allocation.get("lot_id"),
                    "lot_no": allocation.get("lot_no"),
                    "expiry_date": allocation.get("expiry_date"),
                    "serial_id": allocation.get("serial_id"),
                    "serial_no": allocation.get("serial_no"),
                    "stock_status": "available",
                    "source_type": "outbound_order",
                    "source_id": order_id,
                    "source_number": order["number"],
                    "order_id": order_id,
                    "allocation_id": allocation["id"],
                    "actor_id": context.user["_id"],
                    "device_id": device_id,
                    "occurred_at": now,
                    "recorded_at": now,
                    "reason": None,
                    "reversal_of": None,
                    "idempotency_key": f"outbound:{order_id}:{allocation['id']}",
                },
                session=session,
            )
            if allocation.get("serial_id"):
                await database.serials.update_one(
                    {"_id": allocation["serial_id"], "company_id": company_id},
                    {"$set": {"status": "shipped", "updated_at": now}},
                    session=session,
                )
        updated_order = await database.outbound_orders.find_one_and_update(
            {"_id": order_id, "company_id": company_id, "status": "allocated"},
            {"$set": {"status": "shipped", "shipped_at": now, "updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated_order is None:
            raise APIError(
                409,
                "order_ship_conflict",
                "The order was modified by another request. Retry.",
                retryable=True,
            )
        return updated_order

    async with database.client.start_session() as session:
        order = await session.with_transaction(ship)

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="outbound_order.shipped",
        entity="outbound_order",
        entity_id=order_id,
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        after={"number": order["number"]},
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="outbound_order",
        entity_id=order_id,
        action="outbound_order.shipped",
        client_id=order.get("client_id"),
        payload={"number": order["number"], "status": "shipped"},
        occurred_at=now,
    )
    return _order_out(order)


@router.post("/outbound/orders/{order_id}/cancel", response_model=OutboundOrderOut)
async def cancel_outbound_order(
    order_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> OutboundOrderOut:
    context.require("stock.issue")
    company_id = context.company["_id"]
    now = utcnow()

    async def cancel(session: Any) -> dict[str, Any]:
        order = await _fetch_order(database, context, order_id, session=session)
        if order["status"] == "cancelled":
            return order
        if order["status"] == "shipped":
            raise APIError(409, "order_already_shipped", "A shipped order cannot be cancelled.")
        for allocation in order.get("allocations", []):
            quantity = to_decimal128(to_decimal(allocation["base_qty"]))
            released = await database.balances.find_one_and_update(
                {
                    "_id": allocation["balance_id"],
                    "company_id": company_id,
                    "reserved": {"$gte": quantity},
                },
                {
                    "$inc": {"reserved": to_decimal128(-to_decimal(quantity)), "version": 1},
                    "$set": {"updated_at": now},
                },
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            if released is None:
                raise APIError(
                    409,
                    "reservation_release_conflict",
                    "Reserved stock changed before cancellation. Retry.",
                    retryable=True,
                )
        updated_order = await database.outbound_orders.find_one_and_update(
            {"_id": order_id, "company_id": company_id, "status": {"$in": ["draft", "allocated"]}},
            {
                "$set": {
                    "status": "cancelled",
                    "cancelled_at": now,
                    "updated_at": now,
                }
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated_order is None:
            raise APIError(
                409,
                "order_cancel_conflict",
                "The order was modified by another request. Retry.",
                retryable=True,
            )
        return updated_order

    async with database.client.start_session() as session:
        order = await session.with_transaction(cancel)

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="outbound_order.cancelled",
        entity="outbound_order",
        entity_id=order_id,
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="outbound_order",
        entity_id=order_id,
        action="outbound_order.cancelled",
        client_id=order.get("client_id"),
        payload={"status": "cancelled"},
        occurred_at=now,
    )
    return _order_out(order)
