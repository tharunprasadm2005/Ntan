import csv
import hashlib
import io
import json
import re
import secrets
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, status
from fastapi.responses import Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..permissions import has_permission
from ..schemas import (
    AvailabilityOut,
    BalanceListResponse,
    MovementListResponse,
    MovementOut,
    ReceiptCreate,
    ReceiptListResponse,
    ReceiptOut,
    ReorderNeededResponse,
    ReorderNeedRow,
)
from ..serializers import balance_out, movement_out, receipt_out
from ..services.clients import apply_client_scope, ensure_client_access, resolve_client_id
from ..services.putaway import PUTAWAY_SOURCE_TYPES, create_putaway_tasks
from ..services.supplier_items import (
    supplier_options_for_items,
    supplier_sku_snapshot,
    supplier_summaries,
)
from ..services.sync import append_sync_event
from ..utils import (
    decode_cursor,
    encode_cursor,
    new_id,
    to_decimal,
    to_decimal128,
    utcnow,
)

router = APIRouter(tags=["stock"])

ZERO = Decimal("0")


def _receipt_number(now: datetime) -> str:
    return f"GR-{now:%Y%m%d}-{secrets.token_hex(3).upper()}"


def _fingerprint(payload: ReceiptCreate) -> str:
    raw = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _load_purchase_order(
    database: Any,
    context: ContextDep,
    purchase_order_id: str,
    *,
    client_id: str,
    warehouse_id: str,
    session: Any = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {
        "_id": purchase_order_id,
        "company_id": context.company["_id"],
    }
    apply_client_scope(query, context.client_scope)
    purchase_order = await database.purchase_orders.find_one(query, session=session)
    if purchase_order is None:
        raise APIError(
            422,
            "invalid_purchase_order",
            "The selected purchase order was not found for this inventory owner.",
            {"purchase_order_id": "Select an open purchase order for this inventory owner."},
        )
    if purchase_order.get("client_id") != client_id:
        raise APIError(
            422,
            "invalid_purchase_order",
            "The purchase order belongs to a different inventory owner.",
            {"purchase_order_id": "Select a purchase order for this inventory owner."},
        )
    if purchase_order["warehouse_id"] != warehouse_id:
        raise APIError(
            422,
            "purchase_order_warehouse_mismatch",
            "The purchase order is assigned to a different warehouse.",
            {"warehouse_id": "Receive this purchase order in its destination warehouse."},
        )
    if purchase_order["status"] not in ("open", "partially_received"):
        raise APIError(
            409,
            "purchase_order_not_receivable",
            f"Purchase order status '{purchase_order['status']}' cannot be received.",
        )
    return purchase_order


def _purchase_order_remaining(
    purchase_order: dict[str, Any],
    pending: dict[str, Decimal] | None = None,
) -> dict[str, Decimal]:
    pending = pending or {}
    remaining: dict[str, Decimal] = {}
    for line in purchase_order.get("lines", []):
        ordered = to_decimal(line.get("ordered_qty"))
        received = to_decimal(line.get("received_qty"))
        item_id = line["item_id"]
        available = ordered - received - pending.get(item_id, ZERO)
        remaining[item_id] = available if available > ZERO else ZERO
    return remaining


async def _company_allows_over_receipt(database: Any, company_id: str) -> bool:
    company = await database.companies.find_one(
        {"_id": company_id}, {"allow_over_receipt": 1}
    )
    return bool(company and company.get("allow_over_receipt", False))


async def _supplier_sku_snapshot(
    database: Any,
    company_id: str,
    supplier_id: str | None,
    item_ids: list[str],
) -> dict[str, str]:
    return await supplier_sku_snapshot(database, company_id, supplier_id, item_ids)


async def _draft_purchase_order_quantities(
    database: Any,
    company_id: str,
    purchase_order_id: str,
    *,
    exclude_receipt_id: str | None = None,
) -> dict[str, Decimal]:
    query: dict[str, Any] = {
        "company_id": company_id,
        "purchase_order_id": purchase_order_id,
        "status": "draft",
    }
    if exclude_receipt_id is not None:
        query["_id"] = {"$ne": exclude_receipt_id}
    pending: dict[str, Decimal] = {}
    async for receipt in database.receipts.find(query):
        for line in receipt.get("lines", []):
            item_id = line["item_id"]
            pending[item_id] = pending.get(item_id, ZERO) + to_decimal(line.get("base_qty"))
    return pending



async def _ensure_location(
    database: Any,
    company_id: str,
    warehouse_id: str,
    location_id: str,
    location_scope: frozenset[str] | None,
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
            "invalid_location",
            "The receiving location was not found in this warehouse.",
            {"location_id": "Select an active location in the warehouse."},
        )
    if location_scope is not None and location_id not in location_scope:
        raise APIError(
            403,
            "location_forbidden",
            "You do not have access to this warehouse location.",
        )
    return location


def _apply_location_scope(
    query: dict[str, Any],
    location_scope: frozenset[str] | None,
    *,
    field: str = "location_id",
) -> None:
    if location_scope is None:
        return
    requested = query.get(field)
    if isinstance(requested, str):
        query[field] = requested if requested in location_scope else {"$in": []}
        return
    query[field] = {"$in": sorted(location_scope)}


def _normalize_serials(line: Any) -> list[str]:
    values = list(line.serial_numbers)
    if line.serial_no:
        values.append(line.serial_no)
    normalized: list[str] = []
    for raw in values:
        value = raw.strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


async def _resolve_lot(
    database: Any,
    *,
    company_id: str,
    client_id: str,
    item_id: str,
    lot_id: str | None,
    lot_no: str | None,
    expiry_date: Any,
    require_expiry: bool,
    index: int,
) -> dict[str, Any] | None:
    lot = None
    if lot_id:
        lot = await database.lots.find_one(
            {
                "_id": lot_id,
                "company_id": company_id,
                "client_id": client_id,
                "item_id": item_id,
            }
        )
        if lot is None:
            raise APIError(
                422,
                "invalid_lot",
                "The selected lot was not found for this item.",
                {f"lines.{index}.lot_id": "Select a lot for this item."},
            )
    elif lot_no:
        lot = await database.lots.find_one(
            {
                "company_id": company_id,
                "client_id": client_id,
                "item_id": item_id,
                "lot_no": lot_no,
            }
        )
    if lot is not None and lot.get("status") != "active":
        raise APIError(
            422,
            "inactive_lot",
            "The selected lot is no longer active.",
            {f"lines.{index}.lot_no": "Select an active lot."},
        )
    effective_expiry = expiry_date or (lot.get("expiry_date") if lot else None)
    if require_expiry and effective_expiry is None:
        raise APIError(
            422,
            "expiry_required",
            "This item requires an expiry date.",
            {f"lines.{index}.expiry_date": "Enter the expiry date."},
        )
    return lot


async def _prepare_lines(
    database: Any,
    company_id: str,
    client_id: str,
    payload: ReceiptCreate,
    location_id: str,
    purchase_order: dict[str, Any] | None = None,
    purchase_order_remaining: dict[str, Decimal] | None = None,
    *,
    supplier_id: str | None = None,
    allow_over_receipt: bool = False,
) -> list[dict[str, Any]]:
    item_ids = list({line.item_id for line in payload.lines})
    purchase_order_lines: dict[str, dict[str, Any]] = {}
    if purchase_order is not None:
        purchase_order_lines = {
            line["item_id"]: line for line in purchase_order.get("lines", [])
        }
        if len(item_ids) != len(payload.lines):
            raise APIError(
                422,
                "duplicate_item",
                "Each item can appear only once on a purchase-order receipt.",
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
    supplier_skus = await _supplier_sku_snapshot(
        database, company_id, supplier_id, item_ids
    )
    prepared = []
    seen_serials_by_item: dict[str, set[str]] = {}
    for index, line in enumerate(payload.lines):
        item = item_map.get(line.item_id)
        if item is None:
            raise APIError(
                422,
                "invalid_item",
                "A receipt line references an item that was not found.",
                {f"lines.{index}.item_id": "Select an item in this company."},
            )
        if item.get("status") != "active":
            raise APIError(
                422,
                "inactive_item",
                "A receipt line references an inactive item.",
                {f"lines.{index}.item_id": "Select an active item."},
            )
        purchase_order_line: dict[str, Any] | None = None
        if purchase_order is not None:
            purchase_order_line = purchase_order_lines.get(line.item_id)
            if purchase_order_line is None:
                raise APIError(
                    422,
                    "purchase_order_item_mismatch",
                    "A receipt line references an item that is not on this purchase order.",
                    {f"lines.{index}.item_id": "Receive only items that were ordered."},
                )
            remaining = (purchase_order_remaining or {}).get(line.item_id, ZERO)
            if to_decimal(line.qty) > remaining and not allow_over_receipt:
                raise APIError(
                    422,
                    "purchase_order_over_receipt",
                    "The received quantity exceeds the quantity still on order.",
                    {
                        f"lines.{index}.qty": (
                            f"Receive {remaining} {item['base_uom']} or less for this item."
                        )
                    },
                )
        item_uom = item["base_uom"]
        entered_uom = line.uom or item_uom
        if entered_uom != item_uom:
            raise APIError(
                422,
                "uom_conversion_not_supported",
                "Unit conversion is not available in this release.",
                {
                    f"lines.{index}.uom": (
                        f"Use the item base unit {item_uom}; unit conversion is not available yet."
                    )
                },
            )
        tracking_mode = item.get("tracking_mode", "none")
        expiry_tracked = item.get("expiry_tracked", False)
        lot_id = line.lot_id
        lot_no = line.lot_no
        expiry_date = line.expiry_date
        serials: list[str] = []
        if tracking_mode == "lot":
            if not lot_id and not lot_no:
                raise APIError(
                    422,
                    "lot_required",
                    "This item requires a lot number.",
                    {f"lines.{index}.lot_no": "Enter or select a lot."},
                )
            lot = await _resolve_lot(
                database,
                company_id=company_id,
                client_id=client_id,
                item_id=item["_id"],
                lot_id=lot_id,
                lot_no=lot_no,
                expiry_date=expiry_date,
                require_expiry=expiry_tracked,
                index=index,
            )
            if lot is not None:
                lot_id = lot["_id"]
                lot_no = lot["lot_no"]
                expiry_date = expiry_date or lot.get("expiry_date")
        elif tracking_mode == "serial":
            # Check within-line duplicates for this item before deduplication
            raw_serials = [
                s.strip()
                for s in (list(line.serial_numbers) + ([line.serial_no] if line.serial_no else []))
                if s.strip()
            ]
            if len(raw_serials) != len(set(raw_serials)):
                raise APIError(
                    422,
                    "duplicate_serial",
                    "One or more duplicate serial numbers were entered in the same line.",
                    {f"lines.{index}.serial_numbers": "Each serial number in the line must be unique."},
                )
            serials = _normalize_serials(line)
            quantity = to_decimal(line.qty)
            if not serials:
                raise APIError(
                    422,
                    "serial_required",
                    "This serial-tracked item requires serial numbers.",
                    {f"lines.{index}.serial_numbers": "Add one serial number per unit."},
                )
            if quantity != quantity.to_integral_value() or len(serials) != int(quantity):
                raise APIError(
                    422,
                    "serial_quantity_mismatch",
                    "The quantity must match the number of serial numbers.",
                    {
                        f"lines.{index}.serial_numbers": (
                            "Add exactly one serial number for each unit."
                        )
                    },
                )
            # Check cross-line duplicates for this item
            item_serials = seen_serials_by_item.setdefault(item["_id"], set())
            for s in serials:
                if s in item_serials:
                    raise APIError(
                        422,
                        "duplicate_serial",
                        f"Serial {s} appears multiple times in this receipt.",
                        {f"lines.{index}.serial_numbers": f"Serial {s} appears multiple times in this receipt."},
                    )
                item_serials.add(s)
            existing = await database.serials.find_one(
                {
                    "company_id": company_id,
                    "client_id": client_id,
                    "item_id": item["_id"],
                    "serial_no": {"$in": serials},
                }
            )
            if existing is not None:
                raise APIError(
                    422,
                    "duplicate_serial",
                    "One or more serial numbers already exist for this item.",
                    {
                        f"lines.{index}.serial_numbers": (
                            f"Serial {existing['serial_no']} is already recorded."
                        )
                    },
                )
            if lot_id or lot_no:
                lot = await _resolve_lot(
                    database,
                    company_id=company_id,
                    client_id=client_id,
                    item_id=item["_id"],
                    lot_id=lot_id,
                    lot_no=lot_no,
                    expiry_date=expiry_date,
                    require_expiry=expiry_tracked,
                    index=index,
                )
                if lot is not None:
                    lot_id = lot["_id"]
                    lot_no = lot["lot_no"]
                    expiry_date = expiry_date or lot.get("expiry_date")
            elif expiry_tracked and expiry_date is None:
                raise APIError(
                    422,
                    "expiry_required",
                    "This item requires an expiry date.",
                    {f"lines.{index}.expiry_date": "Enter the expiry date."},
                )
        else:
            lot_id = None
            lot_no = None
            expiry_date = None
            serials = []
        expiry_date = _expiry_datetime(expiry_date)
        prepared.append(
            {
                "id": new_id(),
                "item_id": item["_id"],
                "sku": item["sku"],
                "supplier_sku": supplier_skus.get(item["_id"]),
                "item_name": item["name"],
                "qty": to_decimal128(line.qty),
                "uom": entered_uom,
                "base_qty": to_decimal128(line.qty),
                "base_uom": item_uom,
                "location_id": location_id,
                "lot_id": lot_id,
                "lot_no": lot_no,
                "expiry_date": expiry_date,
                "serial_no": serials[0] if len(serials) == 1 else None,
                "serial_numbers": serials,
                "tracking_mode": tracking_mode,
                "expiry_tracked": expiry_tracked,
                "discrepancy_reason": line.discrepancy_reason or payload.discrepancy_reason,
                "purchase_order_line_id": (
                    purchase_order_line["id"] if purchase_order_line else None
                ),
            }
        )
    return prepared


def _expiry_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    return None


async def _ensure_lot(
    database: Any,
    receipt: dict[str, Any],
    line: dict[str, Any],
    *,
    now: datetime,
    session: Any,
) -> dict[str, Any] | None:
    if not line.get("lot_no"):
        return None
    query = {
        "company_id": receipt["company_id"],
        "client_id": receipt.get("client_id"),
        "item_id": line["item_id"],
        "lot_no": line["lot_no"],
    }
    existing = await database.lots.find_one(query, session=session)
    expiry = _expiry_datetime(line.get("expiry_date"))
    if existing is not None:
        if existing.get("status") != "active":
            raise APIError(
                422,
                "inactive_lot",
                "The selected lot is no longer active.",
                {"lot_no": "Select an active lot."},
            )
        existing_expiry = existing.get("expiry_date")
        if expiry and existing_expiry and _expiry_datetime(existing_expiry) != expiry:
            raise APIError(
                422,
                "lot_expiry_conflict",
                "The lot already exists with a different expiry date.",
                {"expiry_date": "Use the expiry date already recorded for this lot."},
            )
        if expiry and not existing_expiry:
            await database.lots.update_one(
                {"_id": existing["_id"], "company_id": receipt["company_id"]},
                {"$set": {"expiry_date": expiry, "updated_at": now}},
                session=session,
            )
            existing["expiry_date"] = expiry
        line["lot_id"] = existing["_id"]
        line["expiry_date"] = expiry or existing_expiry
        return existing

    lot = {
        "_id": new_id(),
        "company_id": receipt["company_id"],
        "client_id": receipt.get("client_id"),
        "item_id": line["item_id"],
        "sku": line["sku"],
        "item_name": line["item_name"],
        "lot_no": line["lot_no"],
        "expiry_date": expiry,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await database.lots.insert_one(lot, session=session)
    line["lot_id"] = lot["_id"]
    line["expiry_date"] = expiry
    return lot


async def _ensure_serials(
    database: Any,
    receipt: dict[str, Any],
    line: dict[str, Any],
    *,
    now: datetime,
    session: Any,
) -> list[str]:
    serial_ids: list[str] = []
    for serial_no in line.get("serial_numbers", []):
        existing = await database.serials.find_one(
            {
                "company_id": receipt["company_id"],
                "client_id": receipt.get("client_id"),
                "item_id": line["item_id"],
                "serial_no": serial_no,
            },
            session=session,
        )
        if existing is not None:
            raise APIError(
                409,
                "duplicate_serial",
                f"Serial {serial_no} is already recorded for this item.",
                {"serial_numbers": f"Serial {serial_no} already exists."},
            )
        serial = {
            "_id": new_id(),
            "company_id": receipt["company_id"],
            "client_id": receipt.get("client_id"),
            "item_id": line["item_id"],
            "sku": line["sku"],
            "item_name": line["item_name"],
            "serial_no": serial_no,
            "lot_id": line.get("lot_id"),
            "lot_no": line.get("lot_no"),
            "expiry_date": _expiry_datetime(line.get("expiry_date")),
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        await database.serials.insert_one(serial, session=session)
        serial_ids.append(serial["_id"])
    line["serial_ids"] = serial_ids
    return serial_ids


async def _apply_receipt_line(
    database: Any,
    receipt: dict[str, Any],
    line: dict[str, Any],
    *,
    now: datetime,
    actor_id: str,
    device_id: str | None,
    session: Any,
) -> None:
    serial_entries: list[tuple[str | None, str | None]] = [(None, None)]
    if line.get("tracking_mode") == "serial":
        serial_entries = list(
            zip(line.get("serial_ids", []), line.get("serial_numbers", []), strict=True)
        )
    expiry = _expiry_datetime(line.get("expiry_date"))
    for serial_id, serial_no in serial_entries:
        quantity = to_decimal128(1) if serial_id else line["base_qty"]
        balance_filter = {
            "company_id": receipt["company_id"],
            "client_id": receipt.get("client_id"),
            "item_id": line["item_id"],
            "location_id": line["location_id"],
            "lot_id": line.get("lot_id"),
            "serial_id": serial_id,
            "stock_status": "available",
        }
        await database.balances.find_one_and_update(
            balance_filter,
            {
                "$inc": {"on_hand": quantity, "version": 1},
                "$setOnInsert": {
                    "_id": new_id(),
                    "company_id": receipt["company_id"],
                    "client_id": receipt.get("client_id"),
                    "item_id": line["item_id"],
                    "sku": line["sku"],
                    "item_name": line["item_name"],
                    "warehouse_id": receipt["warehouse_id"],
                    "location_id": line["location_id"],
                    "lot_id": line.get("lot_id"),
                    "lot_no": line.get("lot_no"),
                    "expiry_date": expiry,
                    "serial_id": serial_id,
                    "serial_no": serial_no,
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
        await database.movements.insert_one(
            {
                "_id": new_id(),
                "company_id": receipt["company_id"],
                "client_id": receipt.get("client_id"),
                "type": "receipt",
                "item_id": line["item_id"],
                "sku": line["sku"],
                "item_name": line["item_name"],
                "quantity_delta": quantity,
                "uom": line["base_uom"],
                "base_qty": quantity,
                "from_location_id": None,
                "to_location_id": line["location_id"],
                "lot_id": line.get("lot_id"),
                "lot_no": line.get("lot_no"),
                "expiry_date": expiry,
                "serial_id": serial_id,
                "serial_no": serial_no,
                "stock_status": "available",
                "source_type": "receipt",
                "source_id": receipt["_id"],
                "source_number": receipt["number"],
                "receipt_id": receipt["_id"],
                "line_id": line["id"],
                "actor_id": actor_id,
                "device_id": device_id,
                "occurred_at": now,
                "recorded_at": now,
                "reason": line.get("discrepancy_reason") or receipt.get("discrepancy_reason"),
                "reversal_of": None,
                "idempotency_key": f"{receipt['_id']}:{line['id']}:{serial_id or 'base'}",
            },
            session=session,
        )


async def _apply_purchase_order_receipt(
    database: Any,
    receipt: dict[str, Any],
    *,
    now: datetime,
    actor_id: str,
    device_id: str | None,
    session: Any,
    allow_over_receipt: bool = False,
) -> None:
    """Advance the linked purchase order inside the receipt-commit transaction.

    Ordered quantities never change on receipt; only ``received_qty`` grows so
    on-hand stock is still written exclusively by the receipt ledger lines.
    """
    purchase_order_id = receipt.get("purchase_order_id")
    if not purchase_order_id:
        return
    purchase_order = await database.purchase_orders.find_one(
        {"_id": purchase_order_id, "company_id": receipt["company_id"]},
        session=session,
    )
    if purchase_order is None:
        raise APIError(404, "purchase_order_not_found", "The purchase order was not found.")
    if purchase_order["status"] not in ("open", "partially_received"):
        raise APIError(
            409,
            "purchase_order_not_receivable",
            f"Purchase order status '{purchase_order['status']}' cannot be received.",
        )

    received_by_item: dict[str, Decimal] = {}
    for line in receipt["lines"]:
        item_id = line["item_id"]
        received_by_item[item_id] = received_by_item.get(item_id, ZERO) + to_decimal(
            line.get("base_qty")
        )

    purchase_order_lines: list[dict[str, Any]] = []
    for line in purchase_order.get("lines", []):
        ordered = to_decimal(line.get("ordered_qty"))
        received = to_decimal(line.get("received_qty"))
        delta = received_by_item.get(line["item_id"], ZERO)
        if delta > ordered - received and not allow_over_receipt:
            raise APIError(
                422,
                "purchase_order_over_receipt",
                "The received quantity exceeds the quantity still on order.",
                {"lines": f"{line.get('sku', line['item_id'])} exceeds the open order quantity."},
            )
        purchase_order_lines.append(
            {**line, "received_qty": to_decimal128(received + delta)}
        )

    fully_received = all(
        to_decimal(line["received_qty"]) >= to_decimal(line.get("ordered_qty"))
        for line in purchase_order_lines
    )
    purchase_order_status = "received" if fully_received else "partially_received"
    history_lines = [
        {"item_id": item_id, "qty": to_decimal128(qty)}
        for item_id, qty in received_by_item.items()
        if qty > ZERO
    ]
    result = await database.purchase_orders.update_one(
        {
            "_id": purchase_order["_id"],
            "company_id": receipt["company_id"],
            "version": purchase_order.get("version", 0),
        },
        {
            "$set": {
                "lines": purchase_order_lines,
                "status": purchase_order_status,
                "updated_at": now,
                "received_at": now if fully_received else purchase_order.get("received_at"),
            },
            "$inc": {"version": 1},
            "$push": {
                "receipts": {
                    "receipt_id": receipt["_id"],
                    "number": receipt["number"],
                    "committed_at": now,
                    "lines": history_lines,
                }
            },
        },
        session=session,
    )
    if result.matched_count == 0:
        raise APIError(
            409,
            "purchase_order_conflict",
            "The purchase order was modified by another request. Retry.",
            retryable=True,
        )

    await database.audit_events.insert_one(
        {
            "_id": new_id(),
            "company_id": receipt["company_id"],
            "actor_id": actor_id,
            "action": "purchase_order.received",
            "entity": "purchase_order",
            "entity_id": purchase_order["_id"],
            "request_id": None,
            "device_id": device_id,
            "reason": None,
            "before": {"status": purchase_order["status"]},
            "after": {
                "status": purchase_order_status,
                "receipt_id": receipt["_id"],
                "receipt_number": receipt["number"],
            },
            "created_at": now,
        },
        session=session,
    )
    await append_sync_event(
        database,
        receipt["company_id"],
        entity_type="purchase_order",
        entity_id=purchase_order["_id"],
        action="purchase_order.received",
        client_id=purchase_order.get("client_id"),
        payload={
            "number": purchase_order["number"],
            "status": purchase_order_status,
            "receipt_id": receipt["_id"],
            "receipt_number": receipt["number"],
        },
        occurred_at=now,
        session=session,
    )


@router.post("/receipts", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
async def create_receipt(
    payload: ReceiptCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=200)],
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> ReceiptOut:
    context.require("stock.receive")
    client_id = await resolve_client_id(database, context, payload.client_id)
    fingerprint = _fingerprint(payload)
    existing = await database.receipts.find_one(
        {"company_id": context.company["_id"], "idempotency_key": idempotency_key}
    )
    if existing is not None:
        if existing.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            )
        return receipt_out(existing)

    warehouse = await database.warehouses.find_one(
        {"_id": payload.warehouse_id, "company_id": context.company["_id"]}
    )
    if warehouse is None or warehouse.get("status") != "active":
        raise APIError(
            422,
            "invalid_warehouse",
            "The selected warehouse was not found or is inactive.",
            {"warehouse_id": "Select an active warehouse."},
        )

    receiving_location = await _ensure_location(
        database,
        context.company["_id"],
        payload.warehouse_id,
        payload.location_id,
        context.location_scope,
    )
    putaway_required = receiving_location.get("type") in PUTAWAY_SOURCE_TYPES

    purchase_order: dict[str, Any] | None = None
    purchase_order_remaining: dict[str, Decimal] | None = None
    if payload.purchase_order_id:
        purchase_order = await _load_purchase_order(
            database,
            context,
            payload.purchase_order_id,
            client_id=client_id,
            warehouse_id=payload.warehouse_id,
        )
        pending = await _draft_purchase_order_quantities(
            database, context.company["_id"], purchase_order["_id"]
        )
        purchase_order_remaining = _purchase_order_remaining(purchase_order, pending)

    supplier_name = payload.supplier
    supplier_id = payload.supplier_id
    if purchase_order is not None:
        po_supplier_id = purchase_order["supplier_id"]
        if supplier_id and supplier_id != po_supplier_id:
            raise APIError(
                422,
                "purchase_order_supplier_mismatch",
                "The selected supplier does not match the purchase order.",
                {"supplier_id": "Use the supplier recorded on the purchase order."},
            )
        supplier_id = po_supplier_id
        supplier_name = purchase_order.get("supplier_name") or supplier_name
    if supplier_id:
        supplier_doc = await database.clients.find_one(
            {"_id": supplier_id, "company_id": context.company["_id"]}
        )
        if supplier_doc and not supplier_name:
            supplier_name = supplier_doc.get("display_name") or supplier_doc.get("name")

    allow_over_receipt = (
        purchase_order is not None
        and await _company_allows_over_receipt(database, context.company["_id"])
    )
    lines = await _prepare_lines(
        database,
        context.company["_id"],
        client_id,
        payload,
        payload.location_id,
        purchase_order,
        purchase_order_remaining,
        supplier_id=supplier_id,
        allow_over_receipt=allow_over_receipt,
    )

    now = utcnow()
    receipt = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "client_id": client_id,
        "number": _receipt_number(now),
        "status": "draft",
        "warehouse_id": payload.warehouse_id,
        "location_id": payload.location_id,
        "supplier_id": supplier_id,
        "supplier": supplier_name,
        "purchase_order": payload.purchase_order
        or (purchase_order["number"] if purchase_order else None),
        "purchase_order_id": purchase_order["_id"] if purchase_order else None,
        "note": payload.note,
        "delivery_note": payload.delivery_note,
        "discrepancy_reason": payload.discrepancy_reason,
        "putaway_required": putaway_required,
        "putaway_completed_at": None,
        "lines": lines,
        "idempotency_key": idempotency_key,
        "request_fingerprint": fingerprint,
        "device_id": device_id,
        "created_by": context.user["_id"],
        "created_at": now,
        "updated_at": now,
        "committed_at": None,
    }
    try:
        await database.receipts.insert_one(receipt)
    except DuplicateKeyError as exc:
        duplicate = await database.receipts.find_one(
            {"company_id": context.company["_id"], "idempotency_key": idempotency_key}
        )
        if duplicate is None:
            raise APIError(
                409,
                "receipt_number_conflict",
                "The receipt could not be saved. Retry the request.",
                retryable=True,
            ) from exc
        if duplicate.get("request_fingerprint") != fingerprint:
            raise APIError(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different request.",
            ) from exc
        return receipt_out(duplicate)

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="receipt.drafted",
        entity="receipt",
        entity_id=receipt["_id"],
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        after={
            "number": receipt["number"],
            "line_count": len(lines),
            "warehouse_id": receipt["warehouse_id"],
            "location_id": receipt["location_id"],
            "purchase_order_id": receipt.get("purchase_order_id"),
        },
    )
    await append_sync_event(
        database,
        context.company["_id"],
        entity_type="receipt",
        entity_id=receipt["_id"],
        action="receipt.created",
        client_id=receipt.get("client_id"),
        payload={
            "number": receipt["number"],
            "status": receipt["status"],
            "warehouse_id": receipt["warehouse_id"],
            "location_id": receipt["location_id"],
            "purchase_order_id": receipt.get("purchase_order_id"),
        },
        occurred_at=now,
    )
    return receipt_out(receipt)


def _receipt_filter_query(
    context: ContextDep,
    *,
    status_filter: str | None = None,
    client_id: str | None = None,
    supplier_id: str | None = None,
    item_id: str | None = None,
    purchase_order_id: str | None = None,
    warehouse_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope)
    if status_filter and status_filter.strip() and status_filter.strip() != "all":
        query["status"] = status_filter.strip()
    if supplier_id:
        query["supplier_id"] = supplier_id
    if item_id:
        query["lines.item_id"] = item_id
    if purchase_order_id:
        query["purchase_order_id"] = purchase_order_id
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    created_range: dict[str, Any] = {}
    if date_from:
        created_range["$gte"] = datetime.combine(date_from, time.min, tzinfo=UTC)
    if date_to:
        created_range["$lte"] = datetime.combine(date_to, time.max, tzinfo=UTC)
    if created_range:
        query["created_at"] = created_range
    if search and search.strip():
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"number": {"$regex": pattern, "$options": "i"}},
            {"supplier": {"$regex": pattern, "$options": "i"}},
            {"purchase_order": {"$regex": pattern, "$options": "i"}},
            {"delivery_note": {"$regex": pattern, "$options": "i"}},
            {"note": {"$regex": pattern, "$options": "i"}},
            {"lines.sku": {"$regex": pattern, "$options": "i"}},
            {"lines.supplier_sku": {"$regex": pattern, "$options": "i"}},
            {"lines.item_name": {"$regex": pattern, "$options": "i"}},
        ]
    return query


@router.get("/receipts", response_model=ReceiptListResponse)
async def list_receipts(
    context: ContextDep,
    database: DbDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
    client_id: str | None = None,
    supplier_id: str | None = None,
    item_id: str | None = None,
    purchase_order_id: str | None = None,
    warehouse_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
) -> ReceiptListResponse:
    context.require("inventory.read")
    query = _receipt_filter_query(
        context,
        status_filter=status_filter,
        client_id=client_id,
        supplier_id=supplier_id,
        item_id=item_id,
        purchase_order_id=purchase_order_id,
        warehouse_id=warehouse_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )
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
        await database.receipts.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["created_at"], documents[-1]["_id"])
    return ReceiptListResponse(
        receipts=[receipt_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/receipts/export")
async def export_receipts_csv(
    context: ContextDep,
    database: DbDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    client_id: str | None = None,
    supplier_id: str | None = None,
    item_id: str | None = None,
    purchase_order_id: str | None = None,
    warehouse_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
) -> Response:
    """Supplier-wise receiving history as one CSV row per committed receipt line.

    Cost columns are intentionally excluded so the export respects the
    ``cost.read`` permission boundary for every role that can read inventory.
    """
    context.require("inventory.read")
    query = _receipt_filter_query(
        context,
        status_filter=status_filter,
        client_id=client_id,
        supplier_id=supplier_id,
        item_id=item_id,
        purchase_order_id=purchase_order_id,
        warehouse_id=warehouse_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )
    documents = (
        await database.receipts.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(5000)
        .to_list(length=5000)
    )
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "receipt_number",
            "status",
            "created_at",
            "committed_at",
            "supplier",
            "supplier_id",
            "purchase_order",
            "purchase_order_id",
            "warehouse_id",
            "location_id",
            "inventory_owner_id",
            "item_sku",
            "supplier_sku",
            "item_name",
            "qty",
            "uom",
            "base_qty",
            "base_uom",
            "lot_no",
            "expiry_date",
            "serial_numbers",
            "discrepancy_reason",
            "delivery_note",
            "receipt_note",
        ]
    )
    for receipt in documents:
        for line in receipt.get("lines", []):
            expiry = line.get("expiry_date")
            writer.writerow(
                [
                    receipt.get("number"),
                    receipt.get("status"),
                    receipt.get("created_at").isoformat()
                    if receipt.get("created_at")
                    else "",
                    receipt.get("committed_at").isoformat()
                    if receipt.get("committed_at")
                    else "",
                    receipt.get("supplier") or "",
                    receipt.get("supplier_id") or "",
                    receipt.get("purchase_order") or "",
                    receipt.get("purchase_order_id") or "",
                    receipt.get("warehouse_id") or "",
                    receipt.get("location_id") or "",
                    receipt.get("client_id") or "",
                    line.get("sku") or "",
                    line.get("supplier_sku") or "",
                    line.get("item_name") or "",
                    str(to_decimal(line.get("qty"))),
                    line.get("uom") or "",
                    str(to_decimal(line.get("base_qty"))),
                    line.get("base_uom") or "",
                    line.get("lot_no") or "",
                    expiry.date().isoformat() if isinstance(expiry, datetime) else (expiry or ""),
                    "|".join(line.get("serial_numbers") or []),
                    line.get("discrepancy_reason") or "",
                    receipt.get("delivery_note") or "",
                    receipt.get("note") or "",
                ]
            )
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="receipt-history.csv"'
        },
    )


@router.get("/receipts/{receipt_id}", response_model=ReceiptOut)
async def get_receipt(receipt_id: str, context: ContextDep, database: DbDep) -> ReceiptOut:
    context.require("inventory.read")
    query: dict[str, Any] = {"_id": receipt_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope)
    receipt = await database.receipts.find_one(query)
    if receipt is None:
        raise APIError(404, "receipt_not_found", "The receipt was not found.")
    return receipt_out(receipt)


@router.post("/receipts/{receipt_id}/commit", response_model=ReceiptOut)
async def commit_receipt(
    receipt_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> ReceiptOut:
    context.require("stock.receive")
    company_id = context.company["_id"]
    now = utcnow()

    async def commit(session: Any) -> dict[str, Any]:
        receipt_query: dict[str, Any] = {"_id": receipt_id, "company_id": company_id}
        apply_client_scope(receipt_query, context.client_scope)
        receipt = await database.receipts.find_one(receipt_query, session=session)
        if receipt is None:
            raise APIError(404, "receipt_not_found", "The receipt was not found.")
        if (
            context.location_scope is not None
            and receipt["location_id"] not in context.location_scope
        ):
            raise APIError(404, "receipt_not_found", "The receipt was not found.")
        if receipt["status"] == "applied":
            return receipt
        if receipt["status"] != "draft":
            raise APIError(
                409,
                "receipt_not_committable",
                "Only draft receipts can be committed.",
            )
        from_location = await database.locations.find_one(
            {
                "_id": receipt["location_id"],
                "company_id": company_id,
                "warehouse_id": receipt["warehouse_id"],
                "status": "active",
            },
            session=session,
        )
        if from_location is None:
            raise APIError(
                422,
                "invalid_location",
                "The receiving location is no longer active.",
                {"location_id": "Select an active receiving location."},
            )
        putaway_required = receipt.get(
            "putaway_required",
            from_location.get("type") in PUTAWAY_SOURCE_TYPES,
        )
        resolved_lines: list[dict[str, Any]] = []
        for line in receipt["lines"]:
            if line.get("lot_no"):
                await _ensure_lot(database, receipt, line, now=now, session=session)
            if line.get("tracking_mode") == "serial":
                await _ensure_serials(database, receipt, line, now=now, session=session)
            await _apply_receipt_line(
                database,
                receipt,
                line,
                now=now,
                actor_id=context.user["_id"],
                device_id=device_id,
                session=session,
            )
            resolved_lines.append(line)
        receipt["lines"] = resolved_lines
        if putaway_required:
            await create_putaway_tasks(
                database,
                receipt,
                from_location,
                session=session,
            )
        await _apply_purchase_order_receipt(
            database,
            receipt,
            now=now,
            actor_id=context.user["_id"],
            device_id=device_id,
            session=session,
            allow_over_receipt=await _company_allows_over_receipt(database, company_id),
        )
        updated = await database.receipts.find_one_and_update(
            {"_id": receipt_id, "company_id": company_id, "status": "draft"},
            {
                "$set": {
                    "status": "applied",
                    "committed_at": now,
                    "updated_at": now,
                    "committed_by": context.user["_id"],
                    "putaway_required": putaway_required,
                    "putaway_completed_at": None,
                    "lines": resolved_lines,
                }
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            raise APIError(
                409,
                "receipt_commit_conflict",
                "The receipt was modified by another request.",
                retryable=True,
            )
        await database.audit_events.insert_one(
            {
                "_id": new_id(),
                "company_id": company_id,
                "actor_id": context.user["_id"],
                "action": "receipt.committed",
                "entity": "receipt",
                "entity_id": receipt_id,
                "request_id": getattr(request.state, "request_id", None),
                "device_id": device_id,
                "reason": None,
                "before": {"status": "draft"},
                "after": {"status": "applied", "line_count": len(receipt["lines"])},
                "created_at": now,
            },
            session=session,
        )
        await append_sync_event(
            database,
            company_id,
            entity_type="receipt",
            entity_id=receipt_id,
            action="receipt.committed",
            client_id=receipt.get("client_id"),
            payload={
                "number": receipt["number"],
                "status": "applied",
                "line_count": len(receipt["lines"]),
                "putaway_required": putaway_required,
            },
            occurred_at=now,
            session=session,
        )
        return updated

    try:
        async with database.client.start_session() as session:
            receipt = await session.with_transaction(commit)
    except DuplicateKeyError as exc:
        receipt = await database.receipts.find_one({"_id": receipt_id, "company_id": company_id})
        if receipt is None or receipt.get("status") != "applied":
            raise APIError(
                409,
                "receipt_commit_conflict",
                "The receipt was modified by another request. Retry.",
                retryable=True,
            ) from exc
    return receipt_out(receipt)


@router.post("/receipts/{receipt_id}/cancel", response_model=ReceiptOut)
async def cancel_receipt(
    receipt_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
) -> ReceiptOut:
    context.require("stock.receive")
    company_id = context.company["_id"]
    now = utcnow()
    receipt_query: dict[str, Any] = {"_id": receipt_id, "company_id": company_id}
    apply_client_scope(receipt_query, context.client_scope)
    _apply_location_scope(receipt_query, context.location_scope)
    receipt = await database.receipts.find_one(receipt_query)
    if receipt is None:
        raise APIError(404, "receipt_not_found", "The receipt was not found.")
    if receipt["status"] != "draft":
        raise APIError(
            409,
            "receipt_not_cancellable",
            f"Cannot cancel a receipt with status '{receipt['status']}'. Only draft receipts can be cancelled.",
        )
    updated = await database.receipts.find_one_and_update(
        {"_id": receipt_id, "company_id": company_id, "status": "draft"},
        {"$set": {"status": "cancelled", "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise APIError(409, "receipt_cancel_conflict", "The receipt was modified by another request.")
    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="receipt.cancelled",
        entity="receipt",
        entity_id=receipt_id,
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        before={"status": "draft"},
        after={"status": "cancelled"},
    )
    await append_sync_event(
        database,
        company_id,
        entity_type="receipt",
        entity_id=receipt_id,
        action="receipt.cancelled",
        client_id=receipt.get("client_id"),
        payload={"number": receipt["number"], "status": "cancelled"},
        occurred_at=now,
    )
    return receipt_out(updated)


@router.get("/reorder-needed", response_model=ReorderNeededResponse)
async def reorder_needed(
    context: ContextDep,
    database: DbDep,
    search: str | None = None,
    warehouse_id: str | None = None,
    client_id: str | None = None,
    supplier_id: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> ReorderNeededResponse:
    """Read-only replenishment list for active items at or below their reorder point.

    Stock is aggregated with the same rules as ``GET /items/{id}/availability``:
    only balances with ``stock_status == "available"`` contribute to available
    stock, where ``available = on_hand - reserved - blocked``. Quarantine and
    blocked balances are reported in ``on_hand`` only. This endpoint never
    writes balances, movements, receipts, or orders.
    """
    context.require("inventory.read")
    company_id = context.company["_id"]

    item_query: dict[str, Any] = {
        "company_id": company_id,
        "status": "active",
        "reorder_point": {"$ne": None},
    }
    if client_id:
        item_query["client_id"] = client_id
    apply_client_scope(item_query, context.client_scope)
    if search and search.strip():
        pattern = re.escape(search.strip())
        item_query["$or"] = [
            {"sku": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
        ]
    items = await database.items.find(item_query).to_list(length=10000)

    assumptions = [
        (
            "Incoming quantity sums ordered minus received quantities from open and "
            "partially received purchase orders for the same inventory owner and warehouse. "
            "Cancelled and fully received orders are excluded."
        ),
        (
            "Items do not store a target stock level; target_stock falls back to "
            "2 x reorder_point and is flagged with target_stock_source = 'fallback'."
        ),
        (
            "Suggested quantity = max(0, target_stock - projected_stock), where projected "
            "stock counts available stock only (on_hand - reserved - blocked for available "
            "balances) plus incoming orders. Quarantine and blocked stock never inflate it."
        ),
    ]

    if not items:
        return ReorderNeededResponse(
            generated_at=utcnow(),
            rows=[],
            assumptions=assumptions,
        )

    item_ids = [item["_id"] for item in items]
    item_map = {item["_id"]: item for item in items}

    balance_query: dict[str, Any] = {
        "company_id": company_id,
        "item_id": {"$in": item_ids},
    }
    if warehouse_id:
        balance_query["warehouse_id"] = warehouse_id
    if client_id:
        balance_query["client_id"] = client_id
    apply_client_scope(balance_query, context.client_scope)
    _apply_location_scope(balance_query, context.location_scope)

    pipeline: list[dict[str, Any]] = [
        {"$match": balance_query},
        {
            "$group": {
                "_id": {
                    "item_id": "$item_id",
                    "warehouse_id": "$warehouse_id",
                },
                "on_hand": {"$sum": "$on_hand"},
                "reserved": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$stock_status", "available"]},
                            {"$ifNull": ["$reserved", 0]},
                            0,
                        ]
                    }
                },
                "blocked": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$stock_status", "available"]},
                            {"$ifNull": ["$blocked", 0]},
                            0,
                        ]
                    }
                },
                "available": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$stock_status", "available"]},
                            {
                                "$subtract": [
                                    {
                                        "$subtract": [
                                            {"$ifNull": ["$on_hand", 0]},
                                            {"$ifNull": ["$reserved", 0]},
                                        ]
                                    },
                                    {"$ifNull": ["$blocked", 0]},
                                ]
                            },
                            0,
                        ]
                    }
                },
            }
        },
    ]
    cursor = await database.balances.aggregate(pipeline)
    aggregates = await cursor.to_list(length=None)

    purchase_order_query: dict[str, Any] = {
        "company_id": company_id,
        "status": {"$in": ["open", "partially_received"]},
    }
    if warehouse_id:
        purchase_order_query["warehouse_id"] = warehouse_id
    if client_id:
        purchase_order_query["client_id"] = client_id
    apply_client_scope(purchase_order_query, context.client_scope)
    if context.location_scope is not None:
        allowed_warehouses = set(
            await database.locations.distinct(
                "warehouse_id",
                {
                    "company_id": company_id,
                    "_id": {"$in": sorted(context.location_scope)},
                },
            )
        )
        if warehouse_id:
            if warehouse_id not in allowed_warehouses:
                purchase_order_query["warehouse_id"] = {"$in": []}
        else:
            purchase_order_query["warehouse_id"] = {"$in": sorted(allowed_warehouses)}

    purchase_order_pipeline: list[dict[str, Any]] = [
        {"$match": purchase_order_query},
        {"$unwind": "$lines"},
        {"$match": {"lines.item_id": {"$in": item_ids}}},
        {
            "$group": {
                "_id": {
                    "item_id": "$lines.item_id",
                    "warehouse_id": "$warehouse_id",
                },
                "incoming": {
                    "$sum": {
                        "$subtract": [
                            "$lines.ordered_qty",
                            {"$ifNull": ["$lines.received_qty", 0]},
                        ]
                    }
                },
            }
        },
    ]
    purchase_order_cursor = await database.purchase_orders.aggregate(purchase_order_pipeline)
    incoming_by_key: dict[tuple[str, str | None], Decimal] = {}
    incoming_by_item: dict[str, Decimal] = {}
    for document in await purchase_order_cursor.to_list(length=None):
        incoming = to_decimal(document.get("incoming"))
        if incoming <= ZERO:
            continue
        incoming_item_id = document["_id"]["item_id"]
        incoming_warehouse_id = document["_id"].get("warehouse_id")
        key = (incoming_item_id, incoming_warehouse_id)
        incoming_by_key[key] = incoming_by_key.get(key, ZERO) + incoming
        incoming_by_item[incoming_item_id] = (
            incoming_by_item.get(incoming_item_id, ZERO) + incoming
        )

    warehouse_ids = {
        document["_id"]["warehouse_id"]
        for document in aggregates
        if document["_id"].get("warehouse_id")
    }
    if warehouse_id:
        warehouse_ids.add(warehouse_id)
    sorted_warehouse_ids = sorted(warehouse_ids)
    warehouses = await database.warehouses.find(
        {"_id": {"$in": sorted_warehouse_ids}, "company_id": company_id}
    ).to_list(length=len(sorted_warehouse_ids) or 1)
    warehouse_names = {
        warehouse["_id"]: warehouse.get("name") or warehouse.get("code")
        for warehouse in warehouses
    }

    warehouse_groups: dict[str, list[str | None]] = {}
    for document in aggregates:
        item_id = document["_id"]["item_id"]
        warehouse_groups.setdefault(item_id, []).append(document["_id"].get("warehouse_id"))

    targets: dict[str, tuple[Decimal, str]] = {}
    for item_id, item in item_map.items():
        reorder_point = to_decimal(item.get("reorder_point"))
        raw_target = item.get("target_stock")
        if raw_target is not None:
            targets[item_id] = (to_decimal(raw_target), "item")
        else:
            targets[item_id] = (reorder_point * Decimal("2"), "fallback")

    rows: list[ReorderNeedRow] = []
    supplier_hints = await supplier_summaries(
        database, context.company["_id"], list(item_map)
    )
    supplier_options = await supplier_options_for_items(
        database,
        context.company["_id"],
        list(item_map),
        include_cost=has_permission(context.permissions, "cost.read"),
    )
    zero = ZERO
    half = Decimal("0.5")
    for document in aggregates:
        item_id = document["_id"]["item_id"]
        item = item_map.get(item_id)
        if item is None:
            continue
        reorder_point = to_decimal(item.get("reorder_point"))
        target_stock, target_source = targets[item_id]
        available = to_decimal(document.get("available"))
        if available > reorder_point:
            continue
        on_hand = to_decimal(document.get("on_hand"))
        reserved = to_decimal(document.get("reserved"))
        blocked = to_decimal(document.get("blocked"))
        wh_id = document["_id"].get("warehouse_id")
        incoming = incoming_by_key.get((item_id, wh_id), zero)
        projected = available + incoming
        suggested = max(zero, target_stock - projected)
        if available <= zero:
            urgency = "stockout"
        elif available <= reorder_point * half:
            urgency = "critical"
        else:
            urgency = "low"
        rows.append(
            ReorderNeedRow(
                item_id=item_id,
                sku=item["sku"],
                item_name=item["name"],
                client_id=item.get("client_id"),
                warehouse_id=wh_id,
                warehouse_name=warehouse_names.get(wh_id) if wh_id else None,
                base_uom=item["base_uom"],
                on_hand=on_hand,
                reserved=reserved,
                blocked=blocked,
                available=available,
                incoming_qty=incoming,
                incoming_source="purchase_order",
                projected_stock=projected,
                reorder_point=reorder_point,
                target_stock=target_stock,
                target_stock_source=target_source,
                suggested_qty=suggested,
                urgency=urgency,
                preferred_supplier_id=supplier_hints.get(item_id, {}).get(
                    "preferred_supplier_id"
                ),
                preferred_supplier_name=supplier_hints.get(item_id, {}).get(
                    "preferred_supplier_name"
                ),
                needs_supplier_assignment=not supplier_options.get(item_id),
                supplier_options=supplier_options.get(item_id, []),
            )
        )

    # Items with no balance at all are genuine stockouts. Attribute them to the
    # requested warehouse when the caller filtered by one; otherwise leave the
    # warehouse unset so the UI can prompt for a receiving destination.
    balanced_items = set(warehouse_groups)
    for item_id, item in item_map.items():
        if item_id in balanced_items:
            continue
        if warehouse_id and warehouse_id not in warehouse_names:
            continue
        if warehouse_id is None and context.location_scope is not None:
            continue
        reorder_point = to_decimal(item.get("reorder_point"))
        target_stock, target_source = targets[item_id]
        incoming = incoming_by_item.get(item_id, zero)
        rows.append(
            ReorderNeedRow(
                item_id=item_id,
                sku=item["sku"],
                item_name=item["name"],
                client_id=item.get("client_id"),
                warehouse_id=warehouse_id,
                warehouse_name=warehouse_names.get(warehouse_id) if warehouse_id else None,
                base_uom=item["base_uom"],
                on_hand=zero,
                reserved=zero,
                blocked=zero,
                available=zero,
                incoming_qty=incoming,
                incoming_source="purchase_order",
                projected_stock=incoming,
                reorder_point=reorder_point,
                target_stock=target_stock,
                target_stock_source=target_source,
                suggested_qty=max(zero, target_stock - incoming),
                urgency="stockout",
                preferred_supplier_id=supplier_hints.get(item_id, {}).get(
                    "preferred_supplier_id"
                ),
                preferred_supplier_name=supplier_hints.get(item_id, {}).get(
                    "preferred_supplier_name"
                ),
                needs_supplier_assignment=not supplier_options.get(item_id),
                supplier_options=supplier_options.get(item_id, []),
            )
        )

    requested_status = (status_filter or "all").strip().lower()
    if requested_status not in ("", "all", "below_reorder"):
        rows = [row for row in rows if row.urgency == requested_status]
    if supplier_id:
        rows = [
            row
            for row in rows
            if any(option.supplier_id == supplier_id for option in row.supplier_options)
        ]

    urgency_rank = {"stockout": 0, "critical": 1, "low": 2}
    rows.sort(
        key=lambda row: (
            urgency_rank[row.urgency],
            (row.available / row.reorder_point) if row.reorder_point > zero else zero,
            row.sku,
        )
    )

    return ReorderNeededResponse(
        generated_at=utcnow(),
        rows=rows[:limit],
        assumptions=assumptions,
    )


@router.get("/balances", response_model=BalanceListResponse)
async def list_balances(
    context: ContextDep,
    database: DbDep,
    item_id: str | None = None,
    location_id: str | None = None,
    client_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    cursor: str | None = None,
) -> BalanceListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if item_id:
        query["item_id"] = item_id
    if location_id:
        query["location_id"] = location_id
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope)
    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        query["$or"] = [
            {"updated_at": {"$lt": timestamp}},
            {"updated_at": timestamp, "_id": {"$lt": identifier}},
        ]
    documents = (
        await database.balances.find(query)
        .sort([("updated_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["updated_at"], documents[-1]["_id"])
    return BalanceListResponse(
        balances=[balance_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/items/{item_id}/balances", response_model=BalanceListResponse)
async def item_balances(
    item_id: str,
    context: ContextDep,
    database: DbDep,
) -> BalanceListResponse:
    context.require("inventory.read")
    item = await database.items.find_one({"_id": item_id, "company_id": context.company["_id"]})
    if item is None:
        raise APIError(404, "item_not_found", "The item was not found.")
    await ensure_client_access(database, context, item.get("client_id"))
    query: dict[str, Any] = {"company_id": context.company["_id"], "item_id": item_id}
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope)
    documents = (
        await database.balances.find(query)
        .sort([("updated_at", -1)])
        .to_list(length=500)
    )
    return BalanceListResponse(balances=[balance_out(document) for document in documents])


@router.get("/items/{item_id}/availability", response_model=AvailabilityOut)
async def item_availability(
    item_id: str,
    context: ContextDep,
    database: DbDep,
) -> AvailabilityOut:
    context.require("inventory.read")
    item = await database.items.find_one({"_id": item_id, "company_id": context.company["_id"]})
    if item is None:
        raise APIError(404, "item_not_found", "The item was not found.")
    await ensure_client_access(database, context, item.get("client_id"))
    query: dict[str, Any] = {"company_id": context.company["_id"], "item_id": item_id}
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope)
    documents = await database.balances.find(query).to_list(length=5000)
    on_hand = sum((to_decimal(document["on_hand"]) for document in documents), ZERO)
    reserved = sum((to_decimal(document["reserved"]) for document in documents), ZERO)
    blocked = sum((to_decimal(document["blocked"]) for document in documents), ZERO)
    return AvailabilityOut(
        item_id=item_id,
        on_hand=on_hand,
        reserved=reserved,
        blocked=blocked,
        available=on_hand - reserved - blocked,
    )


@router.get("/movements", response_model=MovementListResponse)
async def list_movements(
    context: ContextDep,
    database: DbDep,
    item_id: str | None = None,
    client_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    cursor: str | None = None,
) -> MovementListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if item_id:
        query["item_id"] = item_id
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)
    if context.location_scope is not None:
        scoped_ids = sorted(context.location_scope)
        query["$and"] = [
            {
                "$or": [
                    {"from_location_id": {"$in": scoped_ids}},
                    {"to_location_id": {"$in": scoped_ids}},
                ]
            }
        ]
    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        query["$or"] = [
            {"recorded_at": {"$lt": timestamp}},
            {"recorded_at": timestamp, "_id": {"$lt": identifier}},
        ]
    documents = (
        await database.movements.find(query)
        .sort([("recorded_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["recorded_at"], documents[-1]["_id"])
    return MovementListResponse(
        movements=[movement_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/movements/{movement_id}", response_model=MovementOut)
async def get_movement(
    movement_id: str,
    context: ContextDep,
    database: DbDep,
) -> MovementOut:
    context.require("inventory.read")
    query: dict[str, Any] = {"_id": movement_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    if context.location_scope is not None:
        scoped_ids = sorted(context.location_scope)
        query["$or"] = [
            {"from_location_id": {"$in": scoped_ids}},
            {"to_location_id": {"$in": scoped_ids}},
        ]
    document = await database.movements.find_one(query)
    if document is None:
        raise APIError(404, "movement_not_found", "The movement was not found.")
    return movement_out(document)


@router.get("/reports/stock", response_model=BalanceListResponse)
async def stock_report(
    context: ContextDep,
    database: DbDep,
    item_id: str | None = None,
    location_id: str | None = None,
) -> BalanceListResponse:
    context.require("reports.read")
    return await list_balances(
        context=context,
        database=database,
        item_id=item_id,
        location_id=location_id,
        limit=200,
        cursor=None,
    )
