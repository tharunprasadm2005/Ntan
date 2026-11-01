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
    TransferCreate,
    TransferListResponse,
    TransferOut,
)
from ..serializers import transfer_out
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

router = APIRouter(prefix="/transfers", tags=["transfers"])

ZERO = Decimal("0")


def _transfer_number(now: datetime) -> str:
    return f"TR-{now:%Y%m%d}-{secrets.token_hex(3).upper()}"


def _fingerprint(payload: TransferCreate) -> str:
    raw = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _apply_transfer_location_scope(query: dict[str, Any], location_scope: frozenset[str] | None) -> None:
    if location_scope is None:
        return
    scoped = sorted(location_scope)
    query["$or"] = [
        {"from_location_id": {"$in": scoped}},
        {"to_location_id": {"$in": scoped}},
    ]


async def _ensure_active_location(
    database: Any,
    company_id: str,
    warehouse_id: str,
    location_id: str,
    field_name: str,
    location_scope: frozenset[str] | None = None,
) -> dict[str, Any]:
    location = await database.locations.find_one(
        {
            "_id": location_id,
            "company_id": company_id,
            "warehouse_id": warehouse_id,
            "status": "active",
        }
    )
    if location is None:
        raise APIError(
            422,
            f"invalid_{field_name}",
            f"The selected {field_name.replace('_', ' ')} does not exist or is not active in this warehouse.",
            {field_name: "Select an active location within the warehouse."},
        )
    if location_scope is not None and location_id not in location_scope:
        raise APIError(
            403,
            "location_forbidden",
            f"You do not have access to the selected {field_name.replace('_', ' ')}.",
            {field_name: "You lack operational permission for this location."},
        )
    return location


@router.post("", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    payload: TransferCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=200)],
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> TransferOut:
    context.require("stock.transfer")
    client_id = await resolve_client_id(database, context, payload.client_id)
    fingerprint = _fingerprint(payload)

    existing = await database.transfers.find_one(
        {"company_id": context.company["_id"], "idempotency_key": idempotency_key}
    )
    if existing is not None:
        if existing.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            )
        return transfer_out(existing)

    if payload.from_location_id == payload.to_location_id:
        raise APIError(
            422,
            "identical_locations",
            "The destination location must be different from the source location.",
            {"to_location_id": "Choose a different destination location."},
        )

    # Validate source warehouse and location (must be allowed in location scope)
    from_location = await _ensure_active_location(
        database,
        context.company["_id"],
        payload.from_warehouse_id,
        payload.from_location_id,
        "from_location_id",
        context.location_scope,
    )

    # Validate destination warehouse and location
    to_location = await _ensure_active_location(
        database,
        context.company["_id"],
        payload.to_warehouse_id,
        payload.to_location_id,
        "to_location_id",
    )

    is_bin_to_bin = payload.from_warehouse_id == payload.to_warehouse_id
    transfer_type = "bin_to_bin" if is_bin_to_bin else "cross_warehouse"

    # Validate lines and available inventory
    prepared_lines = []
    for index, line in enumerate(payload.lines):
        item = await database.items.find_one(
            {"_id": line.item_id, "company_id": context.company["_id"]}
        )
        if item is None:
            raise APIError(
                404,
                "item_not_found",
                f"Item at line {index + 1} was not found.",
                {f"lines.{index}.item_id": "Select a valid item."},
            )
        await ensure_client_access(database, context, item.get("client_id"))

        if payload.client_id and item.get("client_id") and item["client_id"] != payload.client_id:
            raise APIError(
                422,
                "client_mismatch",
                f"Item {item['sku']} does not belong to the selected inventory owner.",
                {f"lines.{index}.item_id": "Item owner does not match transfer owner."},
            )

        item_uom = item.get("base_uom", "unit")
        entered_uom = (line.uom or item_uom).strip()
        if entered_uom != item_uom:
            raise APIError(
                422,
                "uom_conversion_not_supported",
                f"Use the item base unit {item_uom}; unit conversion is not supported.",
                {f"lines.{index}.uom": f"Unit must match {item_uom}."},
            )

        quantity = to_decimal(line.qty)
        if quantity <= ZERO:
            raise APIError(
                422,
                "invalid_quantity",
                "Transfer quantity must be greater than zero.",
                {f"lines.{index}.qty": "Quantity must be positive."},
            )

        tracking_mode = item.get("tracking_mode", "none")
        lot_id = line.lot_id
        lot_no = line.lot_no
        expiry_date = line.expiry_date
        serial_id = None
        serial_no = None
        serial_numbers = [s.strip() for s in line.serial_numbers if s.strip()]

        balance_query: dict[str, Any] = {
            "company_id": context.company["_id"],
            "client_id": client_id,
            "item_id": item["_id"],
            "warehouse_id": payload.from_warehouse_id,
            "location_id": payload.from_location_id,
            "stock_status": "available",
        }

        if tracking_mode == "lot":
            if not lot_id and not lot_no:
                raise APIError(
                    422,
                    "lot_required",
                    f"Item {item['sku']} is lot-tracked. Lot number is required.",
                    {f"lines.{index}.lot_no": "Specify lot identifier."},
                )
            if lot_id:
                balance_query["lot_id"] = lot_id
            elif lot_no:
                balance_query["lot_no"] = lot_no
        elif tracking_mode == "serial":
            if not serial_numbers:
                raise APIError(
                    422,
                    "serial_required",
                    f"Item {item['sku']} is serial-tracked. Serial numbers are required.",
                    {f"lines.{index}.serial_numbers": "Add serial numbers for transfer."},
                )
            if quantity != quantity.to_integral_value() or len(serial_numbers) != int(quantity):
                raise APIError(
                    422,
                    "serial_quantity_mismatch",
                    "The quantity must match the count of serial numbers.",
                    {f"lines.{index}.serial_numbers": "Provide exactly one serial number per unit."},
                )
            # Verify each serial exists at source location and is available
            serial_query: dict[str, Any] = {
                "company_id": context.company["_id"],
                "item_id": item["_id"],
                "serial_no": {"$in": serial_numbers},
                "status": {"$in": ["active", "available"]},
            }
            if client_id:
                serial_query["client_id"] = client_id

            serial_docs = await database.serials.find(serial_query).to_list(length=len(serial_numbers) + 10)
            raw_serial_ids = [d["_id"] for d in serial_docs]

            # Verify presence in balances at from_location_id
            bal_q: dict[str, Any] = {
                "company_id": context.company["_id"],
                "item_id": item["_id"],
                "location_id": payload.from_location_id,
                "serial_id": {"$in": raw_serial_ids},
                "stock_status": "available",
                "on_hand": {"$gte": to_decimal128(Decimal("1"))},
            }
            if client_id:
                bal_q["client_id"] = client_id
            serial_balances = await database.balances.find(bal_q).to_list(length=len(raw_serial_ids) + 10)
            avail_serial_ids = {b["serial_id"] for b in serial_balances}

            serial_doc_map = {doc["serial_no"]: doc for doc in serial_docs}
            found_serials = {
                doc["serial_no"]
                for doc in serial_docs
                if doc["_id"] in avail_serial_ids or doc.get("location_id") == payload.from_location_id
            }

            missing = [s for s in serial_numbers if s not in found_serials]
            if missing:
                raise APIError(
                    422,
                    "serial_not_available_at_source",
                    f"Serials not available at source location: {', '.join(missing[:3])}",
                    {f"lines.{index}.serial_numbers": "Ensure all serials exist at source location."},
                )

            serial_ids = [serial_doc_map[s]["_id"] for s in serial_numbers if s in serial_doc_map]
            if len(serial_numbers) == 1:
                serial_no = serial_numbers[0]
                serial_id = serial_ids[0] if serial_ids else None

        # Check source available stock
        balances = await database.balances.find(balance_query).to_list(length=100)
        source_on_hand = sum((to_decimal(b.get("on_hand", 0)) for b in balances), ZERO)
        source_reserved = sum((to_decimal(b.get("reserved", 0)) for b in balances), ZERO)
        source_blocked = sum((to_decimal(b.get("blocked", 0)) for b in balances), ZERO)
        source_available = source_on_hand - source_reserved - source_blocked

        if source_available < quantity:
            raise APIError(
                409,
                "insufficient_available_stock",
                f"Insufficient stock for {item['sku']} at source location. Available: {source_available}, Requested: {quantity}",
                {f"lines.{index}.qty": f"Only {source_available} {item_uom} available."},
            )

        if tracking_mode == "lot" and balances:
            lot_id = lot_id or balances[0].get("lot_id")
            lot_no = lot_no or balances[0].get("lot_no")
            expiry_date = expiry_date or balances[0].get("expiry_date")

        line_record = {
            "id": new_id(),
            "item_id": item["_id"],
            "sku": item["sku"],
            "item_name": item["name"],
            "qty": str(quantity),
            "uom": entered_uom,
            "base_qty": str(quantity),
            "base_uom": item_uom,
            "lot_id": lot_id,
            "lot_no": lot_no,
            "expiry_date": expiry_date,
            "serial_id": serial_id,
            "serial_no": serial_no,
            "serial_numbers": serial_numbers,
            "serial_ids": serial_ids if tracking_mode == "serial" else [],
        }
        prepared_lines.append(line_record)

    now = utcnow()
    actor_id = context.user["_id"] if context.user else None
    request_id = getattr(request.state, "request_id", None)

    transfer_doc = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "client_id": client_id,
        "number": _transfer_number(now),
        "status": "draft",
        "transfer_type": transfer_type,
        "from_warehouse_id": payload.from_warehouse_id,
        "from_location_id": payload.from_location_id,
        "to_warehouse_id": payload.to_warehouse_id,
        "to_location_id": payload.to_location_id,
        "note": payload.note,
        "reason": payload.reason,
        "lines": prepared_lines,
        "idempotency_key": idempotency_key,
        "request_fingerprint": fingerprint,
        "created_by": actor_id,
        "created_at": now,
        "updated_at": now,
        "dispatched_at": None,
        "dispatched_by": None,
        "completed_at": None,
        "completed_by": None,
        "cancelled_at": None,
        "cancelled_by": None,
    }

    try:
        await database.transfers.insert_one(transfer_doc)
    except DuplicateKeyError as exc:
        existing = await database.transfers.find_one(
            {"company_id": context.company["_id"], "idempotency_key": idempotency_key}
        )
        if existing is not None:
            return transfer_out(existing)
        raise APIError(409, "transfer_creation_conflict", "Transfer creation conflict. Retry.") from exc

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=actor_id,
        action="transfer.created",
        entity="transfer",
        entity_id=transfer_doc["_id"],
        request_id=request_id,
        device_id=device_id,
        after={"number": transfer_doc["number"], "status": "draft", "lines_count": len(prepared_lines)},
    )
    await append_sync_event(
        database,
        context.company["_id"],
        entity_type="transfer",
        entity_id=transfer_doc["_id"],
        action="transfer.created",
        client_id=client_id,
        payload={"number": transfer_doc["number"], "status": "draft"},
        occurred_at=now,
    )

    return transfer_out(transfer_doc)


@router.get("", response_model=TransferListResponse)
async def list_transfers(
    context: ContextDep,
    database: DbDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    from_warehouse_id: str | None = None,
    to_warehouse_id: str | None = None,
    client_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
) -> TransferListResponse:
    if "stock.transfer" not in context.permissions and "inventory.read" not in context.permissions:
        raise APIError(403, "forbidden", "You do not have permission to view stock transfers.")

    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)
    _apply_transfer_location_scope(query, context.location_scope)

    if status_filter:
        query["status"] = status_filter
    if from_warehouse_id:
        query["from_warehouse_id"] = from_warehouse_id
    if to_warehouse_id:
        query["to_warehouse_id"] = to_warehouse_id

    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        query["$or"] = [
            {"created_at": {"$lt": timestamp}},
            {"created_at": timestamp, "_id": {"$lt": identifier}},
        ]

    documents = (
        await database.transfers.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )

    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["created_at"], documents[-1]["_id"])

    return TransferListResponse(
        transfers=[transfer_out(doc) for doc in documents],
        next_cursor=next_cursor,
    )


@router.get("/{transfer_id}", response_model=TransferOut)
async def get_transfer(
    transfer_id: str,
    context: ContextDep,
    database: DbDep,
) -> TransferOut:
    if "stock.transfer" not in context.permissions and "inventory.read" not in context.permissions:
        raise APIError(403, "forbidden", "You do not have permission to view stock transfers.")

    query: dict[str, Any] = {"_id": transfer_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    _apply_transfer_location_scope(query, context.location_scope)

    document = await database.transfers.find_one(query)
    if document is None:
        raise APIError(404, "transfer_not_found", "The stock transfer was not found.")
    return transfer_out(document)


@router.post("/{transfer_id}/confirm", response_model=TransferOut)
async def confirm_transfer(
    transfer_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> TransferOut:
    context.require("stock.transfer")
    actor_id = context.user["_id"] if context.user else None
    request_id = getattr(request.state, "request_id", None)
    now = utcnow()

    query: dict[str, Any] = {"_id": transfer_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    transfer = await database.transfers.find_one(query)
    if transfer is None:
        raise APIError(404, "transfer_not_found", "The stock transfer was not found.")

    if context.location_scope is not None and transfer["from_location_id"] not in context.location_scope:
        raise APIError(403, "location_forbidden", "You do not have permission to transfer stock out of this source location.")

    if transfer["status"] != "draft":
        if transfer["status"] in ("completed", "in_transit"):
            return transfer_out(transfer)
        raise APIError(
            409,
            "transfer_not_confirmable",
            f"Cannot confirm transfer in '{transfer['status']}' status.",
        )

    is_bin_to_bin = transfer.get("transfer_type") == "bin_to_bin" or transfer["from_warehouse_id"] == transfer["to_warehouse_id"]

    async def execute_confirm(session: Any):
        # 1. Deduct stock from source location
        for line in transfer["lines"]:
            qty_dec = to_decimal(line["base_qty"])
            qty_128 = to_decimal128(qty_dec)
            neg_qty_128 = to_decimal128(-qty_dec)

            if line.get("serial_numbers"):
                # Handle each serial unit individually
                serial_pairs = list(
                    zip(line.get("serial_ids", []), line.get("serial_numbers", []), strict=False)
                )
                if not serial_pairs or not all(p[0] for p in serial_pairs):
                    s_docs = await database.serials.find(
                        {
                            "company_id": transfer["company_id"],
                            "item_id": line["item_id"],
                            "serial_no": {"$in": line["serial_numbers"]},
                        },
                        session=session,
                    ).to_list(length=len(line["serial_numbers"]) + 10)
                    s_map = {d["serial_no"]: d["_id"] for d in s_docs}
                    serial_pairs = [(s_map.get(s), s) for s in line["serial_numbers"] if s_map.get(s)]

                for s_id, s_no in serial_pairs:
                    src_filter: dict[str, Any] = {
                        "company_id": transfer["company_id"],
                        "item_id": line["item_id"],
                        "warehouse_id": transfer["from_warehouse_id"],
                        "location_id": transfer["from_location_id"],
                        "serial_id": s_id,
                        "stock_status": "available",
                    }
                    if transfer.get("client_id"):
                        src_filter["client_id"] = transfer["client_id"]

                    src_bal = await database.balances.find_one(src_filter, session=session)
                    if src_bal is None or to_decimal(src_bal.get("on_hand", 0)) < Decimal("1"):
                        raise APIError(
                            409,
                            "insufficient_stock",
                            f"Serial {s_no} is no longer available at source location.",
                            retryable=True,
                        )
                    await database.balances.find_one_and_update(
                        {"_id": src_bal["_id"], "on_hand": {"$gte": to_decimal128(Decimal("1"))}},
                        {"$inc": {"on_hand": to_decimal128(Decimal("-1")), "version": 1}, "$set": {"updated_at": now}},
                        session=session,
                    )

                    if is_bin_to_bin:
                        dest_filter = {
                            "company_id": transfer["company_id"],
                            "client_id": transfer.get("client_id"),
                            "item_id": line["item_id"],
                            "warehouse_id": transfer["to_warehouse_id"],
                            "location_id": transfer["to_location_id"],
                            "serial_id": s_id,
                            "stock_status": "available",
                        }
                        await database.balances.find_one_and_update(
                            dest_filter,
                            {
                                "$inc": {"on_hand": to_decimal128(Decimal("1")), "version": 1},
                                "$setOnInsert": {
                                    "_id": new_id(),
                                    "company_id": transfer["company_id"],
                                    "client_id": transfer.get("client_id"),
                                    "item_id": line["item_id"],
                                    "sku": line["sku"],
                                    "item_name": line["item_name"],
                                    "warehouse_id": transfer["to_warehouse_id"],
                                    "location_id": transfer["to_location_id"],
                                    "serial_id": s_id,
                                    "serial_no": s_no,
                                    "stock_status": "available",
                                    "reserved": to_decimal128(ZERO),
                                    "blocked": to_decimal128(ZERO),
                                    "created_at": now,
                                },
                                "$set": {"updated_at": now},
                            },
                            upsert=True,
                            session=session,
                        )

                        await database.serials.update_one(
                            {"_id": s_id},
                            {
                                "$set": {
                                    "warehouse_id": transfer["to_warehouse_id"],
                                    "location_id": transfer["to_location_id"],
                                    "status": "available",
                                    "updated_at": now,
                                }
                            },
                            session=session,
                        )

                        await database.movements.insert_one(
                            {
                                "_id": new_id(),
                                "company_id": transfer["company_id"],
                                "client_id": transfer.get("client_id"),
                                "type": "transfer",
                                "item_id": line["item_id"],
                                "sku": line["sku"],
                                "item_name": line["item_name"],
                                "quantity_delta": to_decimal128(ZERO),
                                "uom": line["uom"],
                                "base_qty": to_decimal128(Decimal("1")),
                                "from_location_id": transfer["from_location_id"],
                                "to_location_id": transfer["to_location_id"],
                                "serial_id": s_id,
                                "serial_no": s_no,
                                "stock_status": "available",
                                "source_type": "transfer",
                                "source_id": transfer["_id"],
                                "source_number": transfer["number"],
                                "actor_id": actor_id,
                                "device_id": device_id,
                                "occurred_at": now,
                                "recorded_at": now,
                                "reason": transfer.get("reason"),
                                "idempotency_key": f"{transfer['_id']}:serial:{s_id}:complete",
                            },
                            session=session,
                        )
                    else:
                        # Cross-warehouse: mark serial in_transit
                        await database.serials.update_one(
                            {"_id": s_id},
                            {"$set": {"location_id": None, "status": "in_transit", "updated_at": now}},
                            session=session,
                        )
                        await database.movements.insert_one(
                            {
                                "_id": new_id(),
                                "company_id": transfer["company_id"],
                                "client_id": transfer.get("client_id"),
                                "type": "transfer",
                                "item_id": line["item_id"],
                                "sku": line["sku"],
                                "item_name": line["item_name"],
                                "quantity_delta": to_decimal128(Decimal("-1")),
                                "uom": line["uom"],
                                "base_qty": to_decimal128(Decimal("1")),
                                "from_location_id": transfer["from_location_id"],
                                "to_location_id": None,
                                "serial_id": s_id,
                                "serial_no": s_no,
                                "stock_status": "available",
                                "source_type": "transfer",
                                "source_id": transfer["_id"],
                                "source_number": transfer["number"],
                                "actor_id": actor_id,
                                "device_id": device_id,
                                "occurred_at": now,
                                "recorded_at": now,
                                "reason": transfer.get("reason"),
                                "idempotency_key": f"{transfer['_id']}:serial:{s_id}:dispatch",
                            },
                            session=session,
                        )
            else:
                source_filter: dict[str, Any] = {
                    "company_id": transfer["company_id"],
                    "client_id": transfer.get("client_id"),
                    "item_id": line["item_id"],
                    "warehouse_id": transfer["from_warehouse_id"],
                    "location_id": transfer["from_location_id"],
                    "stock_status": "available",
                }
                if line.get("lot_id"):
                    source_filter["lot_id"] = line["lot_id"]
                elif line.get("lot_no"):
                    source_filter["lot_no"] = line["lot_no"]

                # Ensure on_hand is sufficient and not reserved/blocked
                source_balance = await database.balances.find_one(source_filter, session=session)
                if source_balance is None:
                    raise APIError(
                        409,
                        "insufficient_stock",
                        f"Stock for {line['sku']} is no longer available at source location.",
                        retryable=True,
                    )
                avail = to_decimal(source_balance.get("on_hand", 0)) - to_decimal(source_balance.get("reserved", 0)) - to_decimal(source_balance.get("blocked", 0))
                if avail < qty_dec:
                    raise APIError(
                        409,
                        "insufficient_stock",
                        f"Insufficient stock for {line['sku']}. Available: {avail}, Needed: {qty_dec}",
                        retryable=True,
                    )

                updated_src = await database.balances.find_one_and_update(
                    {
                        "_id": source_balance["_id"],
                        "on_hand": {"$gte": qty_128},
                    },
                    {
                        "$inc": {"on_hand": neg_qty_128, "version": 1},
                        "$set": {"updated_at": now},
                    },
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )
                if updated_src is None:
                    raise APIError(
                        409,
                        "concurrent_stock_mutation",
                        f"Stock for {line['sku']} was modified by another operation. Retry.",
                        retryable=True,
                    )

                # If bin-to-bin: credit destination immediately
                if is_bin_to_bin:
                    dest_filter: dict[str, Any] = {
                        "company_id": transfer["company_id"],
                        "client_id": transfer.get("client_id"),
                        "item_id": line["item_id"],
                        "warehouse_id": transfer["to_warehouse_id"],
                        "location_id": transfer["to_location_id"],
                        "lot_id": line.get("lot_id"),
                        "serial_id": line.get("serial_id"),
                        "stock_status": "available",
                    }
                    await database.balances.find_one_and_update(
                        dest_filter,
                        {
                            "$inc": {"on_hand": qty_128, "version": 1},
                            "$setOnInsert": {
                                "_id": new_id(),
                                "company_id": transfer["company_id"],
                                "client_id": transfer.get("client_id"),
                                "item_id": line["item_id"],
                                "sku": line["sku"],
                                "item_name": line["item_name"],
                                "warehouse_id": transfer["to_warehouse_id"],
                                "location_id": transfer["to_location_id"],
                                "lot_id": line.get("lot_id"),
                                "lot_no": line.get("lot_no"),
                                "expiry_date": line.get("expiry_date"),
                                "serial_id": line.get("serial_id"),
                                "serial_no": line.get("serial_no"),
                                "stock_status": "available",
                                "reserved": to_decimal128(ZERO),
                                "blocked": to_decimal128(ZERO),
                                "created_at": now,
                            },
                            "$set": {"updated_at": now},
                        },
                        upsert=True,
                        return_document=ReturnDocument.AFTER,
                        session=session,
                    )

                    # Record movement
                    await database.movements.insert_one(
                        {
                            "_id": new_id(),
                            "company_id": transfer["company_id"],
                            "client_id": transfer.get("client_id"),
                            "type": "transfer",
                            "item_id": line["item_id"],
                            "sku": line["sku"],
                            "item_name": line["item_name"],
                            "quantity_delta": to_decimal128(ZERO),
                            "uom": line["uom"],
                            "base_qty": qty_128,
                            "from_location_id": transfer["from_location_id"],
                            "to_location_id": transfer["to_location_id"],
                            "lot_id": line.get("lot_id"),
                            "lot_no": line.get("lot_no"),
                            "expiry_date": line.get("expiry_date"),
                            "serial_id": line.get("serial_id"),
                            "serial_no": line.get("serial_no"),
                            "stock_status": "available",
                            "source_type": "transfer",
                            "source_id": transfer["_id"],
                            "source_number": transfer["number"],
                            "actor_id": actor_id,
                            "device_id": device_id,
                            "occurred_at": now,
                            "recorded_at": now,
                            "reason": transfer.get("reason"),
                            "idempotency_key": f"{transfer['_id']}:line:{line['id']}:complete",
                        },
                        session=session,
                    )
                else:
                    # Record dispatch movement (decrements source location inventory)
                    await database.movements.insert_one(
                        {
                            "_id": new_id(),
                            "company_id": transfer["company_id"],
                            "client_id": transfer.get("client_id"),
                            "type": "transfer",
                            "item_id": line["item_id"],
                            "sku": line["sku"],
                            "item_name": line["item_name"],
                            "quantity_delta": neg_qty_128,
                            "uom": line["uom"],
                            "base_qty": qty_128,
                            "from_location_id": transfer["from_location_id"],
                            "to_location_id": None,
                            "lot_id": line.get("lot_id"),
                            "lot_no": line.get("lot_no"),
                            "expiry_date": line.get("expiry_date"),
                            "serial_id": line.get("serial_id"),
                            "serial_no": line.get("serial_no"),
                            "stock_status": "available",
                            "source_type": "transfer",
                            "source_id": transfer["_id"],
                            "source_number": transfer["number"],
                            "actor_id": actor_id,
                            "device_id": device_id,
                            "occurred_at": now,
                            "recorded_at": now,
                            "reason": transfer.get("reason"),
                            "idempotency_key": f"{transfer['_id']}:line:{line['id']}:dispatch",
                        },
                        session=session,
                    )

        new_status = "completed" if is_bin_to_bin else "in_transit"
        update_fields: dict[str, Any] = {
            "status": new_status,
            "updated_at": now,
        }
        if is_bin_to_bin:
            update_fields["completed_at"] = now
            update_fields["completed_by"] = actor_id
        else:
            update_fields["dispatched_at"] = now
            update_fields["dispatched_by"] = actor_id

        updated_transfer = await database.transfers.find_one_and_update(
            {"_id": transfer["_id"]},
            {"$set": update_fields},
            return_document=ReturnDocument.AFTER,
            session=session,
        )

        audit_action = "transfer.completed" if is_bin_to_bin else "transfer.dispatched"
        await record_audit(
            database,
            company_id=transfer["company_id"],
            actor_id=actor_id,
            action=audit_action,
            entity="transfer",
            entity_id=transfer["_id"],
            request_id=request_id,
            device_id=device_id,
            before={"status": "draft"},
            after={"status": new_status},
        )
        await append_sync_event(
            database,
            transfer["company_id"],
            entity_type="transfer",
            entity_id=transfer["_id"],
            action=audit_action,
            client_id=transfer.get("client_id"),
            payload={"number": transfer["number"], "status": new_status},
            occurred_at=now,
            session=session,
        )
        return updated_transfer

    async with database.client.start_session() as session:
        result = await session.with_transaction(execute_confirm)
    return transfer_out(result)


@router.post("/{transfer_id}/receive", response_model=TransferOut)
async def receive_transfer(
    transfer_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> TransferOut:
    context.require("stock.transfer")
    actor_id = context.user["_id"] if context.user else None
    request_id = getattr(request.state, "request_id", None)
    now = utcnow()

    query: dict[str, Any] = {"_id": transfer_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    transfer = await database.transfers.find_one(query)
    if transfer is None:
        raise APIError(404, "transfer_not_found", "The stock transfer was not found.")

    if context.location_scope is not None and transfer["to_location_id"] not in context.location_scope:
        raise APIError(403, "location_forbidden", "You do not have permission to receive stock into this destination location.")

    if transfer["status"] == "completed":
        return transfer_out(transfer)

    if transfer["status"] != "in_transit":
        raise APIError(
            409,
            "transfer_not_receivable",
            f"Cannot receive transfer in '{transfer['status']}' status. Transfer must be in_transit.",
        )

    async def execute_receive(session: Any):
        for line in transfer["lines"]:
            qty_128 = to_decimal128(line["base_qty"])

            if line.get("serial_numbers"):
                serial_pairs = list(
                    zip(line.get("serial_ids", []), line.get("serial_numbers", []), strict=False)
                )
                if not serial_pairs or not all(p[0] for p in serial_pairs):
                    s_docs = await database.serials.find(
                        {
                            "company_id": transfer["company_id"],
                            "item_id": line["item_id"],
                            "serial_no": {"$in": line["serial_numbers"]},
                        },
                        session=session,
                    ).to_list(length=len(line["serial_numbers"]) + 10)
                    s_map = {d["serial_no"]: d["_id"] for d in s_docs}
                    serial_pairs = [(s_map.get(s), s) for s in line["serial_numbers"] if s_map.get(s)]

                for s_id, s_no in serial_pairs:
                    dest_filter = {
                        "company_id": transfer["company_id"],
                        "client_id": transfer.get("client_id"),
                        "item_id": line["item_id"],
                        "warehouse_id": transfer["to_warehouse_id"],
                        "location_id": transfer["to_location_id"],
                        "serial_id": s_id,
                        "stock_status": "available",
                    }
                    await database.balances.find_one_and_update(
                        dest_filter,
                        {
                            "$inc": {"on_hand": to_decimal128(Decimal("1")), "version": 1},
                            "$setOnInsert": {
                                "_id": new_id(),
                                "company_id": transfer["company_id"],
                                "client_id": transfer.get("client_id"),
                                "item_id": line["item_id"],
                                "sku": line["sku"],
                                "item_name": line["item_name"],
                                "warehouse_id": transfer["to_warehouse_id"],
                                "location_id": transfer["to_location_id"],
                                "serial_id": s_id,
                                "serial_no": s_no,
                                "stock_status": "available",
                                "reserved": to_decimal128(ZERO),
                                "blocked": to_decimal128(ZERO),
                                "created_at": now,
                            },
                            "$set": {"updated_at": now},
                        },
                        upsert=True,
                        session=session,
                    )
                    await database.serials.update_one(
                        {"_id": s_id},
                        {
                            "$set": {
                                "warehouse_id": transfer["to_warehouse_id"],
                                "location_id": transfer["to_location_id"],
                                "status": "available",
                                "updated_at": now,
                            }
                        },
                        session=session,
                    )
                    await database.movements.insert_one(
                        {
                            "_id": new_id(),
                            "company_id": transfer["company_id"],
                            "client_id": transfer.get("client_id"),
                            "type": "transfer",
                            "item_id": line["item_id"],
                            "sku": line["sku"],
                            "item_name": line["item_name"],
                            "quantity_delta": to_decimal128(Decimal("1")),
                            "uom": line["uom"],
                            "base_qty": to_decimal128(Decimal("1")),
                            "from_location_id": None,
                            "to_location_id": transfer["to_location_id"],
                            "serial_id": s_id,
                            "serial_no": s_no,
                            "stock_status": "available",
                            "source_type": "transfer",
                            "source_id": transfer["_id"],
                            "source_number": transfer["number"],
                            "actor_id": actor_id,
                            "device_id": device_id,
                            "occurred_at": now,
                            "recorded_at": now,
                            "reason": transfer.get("reason"),
                            "idempotency_key": f"{transfer['_id']}:serial:{s_id}:receive",
                        },
                        session=session,
                    )
            else:
                dest_filter = {
                    "company_id": transfer["company_id"],
                    "client_id": transfer.get("client_id"),
                    "item_id": line["item_id"],
                    "warehouse_id": transfer["to_warehouse_id"],
                    "location_id": transfer["to_location_id"],
                    "lot_id": line.get("lot_id"),
                    "serial_id": line.get("serial_id"),
                    "stock_status": "available",
                }
                await database.balances.find_one_and_update(
                    dest_filter,
                    {
                        "$inc": {"on_hand": qty_128, "version": 1},
                        "$setOnInsert": {
                            "_id": new_id(),
                            "company_id": transfer["company_id"],
                            "client_id": transfer.get("client_id"),
                            "item_id": line["item_id"],
                            "sku": line["sku"],
                            "item_name": line["item_name"],
                            "warehouse_id": transfer["to_warehouse_id"],
                            "location_id": transfer["to_location_id"],
                            "lot_id": line.get("lot_id"),
                            "lot_no": line.get("lot_no"),
                            "expiry_date": line.get("expiry_date"),
                            "serial_id": line.get("serial_id"),
                            "serial_no": line.get("serial_no"),
                            "stock_status": "available",
                            "reserved": to_decimal128(ZERO),
                            "blocked": to_decimal128(ZERO),
                            "created_at": now,
                        },
                        "$set": {"updated_at": now},
                    },
                    upsert=True,
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )

                # Insert destination receiving movement
                await database.movements.insert_one(
                    {
                        "_id": new_id(),
                        "company_id": transfer["company_id"],
                        "client_id": transfer.get("client_id"),
                        "type": "transfer",
                        "item_id": line["item_id"],
                        "sku": line["sku"],
                        "item_name": line["item_name"],
                        "quantity_delta": qty_128,
                        "uom": line["uom"],
                        "base_qty": qty_128,
                        "from_location_id": None,
                        "to_location_id": transfer["to_location_id"],
                        "lot_id": line.get("lot_id"),
                        "lot_no": line.get("lot_no"),
                        "expiry_date": line.get("expiry_date"),
                        "serial_id": line.get("serial_id"),
                        "serial_no": line.get("serial_no"),
                        "stock_status": "available",
                        "source_type": "transfer",
                        "source_id": transfer["_id"],
                        "source_number": transfer["number"],
                        "actor_id": actor_id,
                        "device_id": device_id,
                        "occurred_at": now,
                        "recorded_at": now,
                        "reason": transfer.get("reason"),
                        "idempotency_key": f"{transfer['_id']}:line:{line['id']}:receive",
                    },
                    session=session,
                )

        updated_transfer = await database.transfers.find_one_and_update(
            {"_id": transfer["_id"]},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": now,
                    "completed_by": actor_id,
                    "updated_at": now,
                }
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )

        await record_audit(
            database,
            company_id=transfer["company_id"],
            actor_id=actor_id,
            action="transfer.completed",
            entity="transfer",
            entity_id=transfer["_id"],
            request_id=request_id,
            device_id=device_id,
            before={"status": "in_transit"},
            after={"status": "completed"},
        )
        await append_sync_event(
            database,
            transfer["company_id"],
            entity_type="transfer",
            entity_id=transfer["_id"],
            action="transfer.completed",
            client_id=transfer.get("client_id"),
            payload={"number": transfer["number"], "status": "completed"},
            occurred_at=now,
            session=session,
        )
        return updated_transfer

    async with database.client.start_session() as session:
        result = await session.with_transaction(execute_receive)
    return transfer_out(result)


@router.post("/{transfer_id}/cancel", response_model=TransferOut)
async def cancel_transfer(
    transfer_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> TransferOut:
    context.require("stock.transfer")
    actor_id = context.user["_id"] if context.user else None
    request_id = getattr(request.state, "request_id", None)
    now = utcnow()

    query: dict[str, Any] = {"_id": transfer_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    transfer = await database.transfers.find_one(query)
    if transfer is None:
        raise APIError(404, "transfer_not_found", "The stock transfer was not found.")

    if transfer["status"] == "cancelled":
        return transfer_out(transfer)

    if transfer["status"] != "draft":
        raise APIError(
            409,
            "transfer_not_cancellable",
            f"Only draft transfers can be cancelled. Current status: '{transfer['status']}'.",
        )

    updated = await database.transfers.find_one_and_update(
        {"_id": transfer["_id"]},
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "cancelled_by": actor_id,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    await record_audit(
        database,
        company_id=transfer["company_id"],
        actor_id=actor_id,
        action="transfer.cancelled",
        entity="transfer",
        entity_id=transfer["_id"],
        request_id=request_id,
        device_id=device_id,
        before={"status": "draft"},
        after={"status": "cancelled"},
    )
    await append_sync_event(
        database,
        transfer["company_id"],
        entity_type="transfer",
        entity_id=transfer["_id"],
        action="transfer.cancelled",
        client_id=transfer.get("client_id"),
        payload={"number": transfer["number"], "status": "cancelled"},
        occurred_at=now,
    )

    return transfer_out(updated)
