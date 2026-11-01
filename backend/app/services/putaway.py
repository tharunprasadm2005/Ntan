from decimal import Decimal
from typing import Any

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..errors import APIError
from ..utils import new_id, to_decimal, to_decimal128, utcnow
from .clients import apply_client_scope
from .sync import append_sync_event

PUTAWAY_SOURCE_TYPES = frozenset({"receiving", "staging"})


async def create_putaway_tasks(
    database: Any,
    receipt: dict[str, Any],
    from_location: dict[str, Any],
    *,
    session: Any = None,
) -> int:
    if from_location.get("type") not in PUTAWAY_SOURCE_TYPES:
        return 0
    created = 0
    for line in receipt.get("lines", []):
        # Look up item preferred location for this warehouse
        suggested_loc_id = None
        suggested_loc_code = None
        suggested_loc_path = None
        item_doc = await database.items.find_one({
            "_id": line["item_id"],
            "company_id": receipt["company_id"],
        })
        if item_doc:
            wh_prefs = [
                pl for pl in item_doc.get("preferred_locations", [])
                if pl.get("warehouse_id") == receipt["warehouse_id"]
            ]
            primary_pref = next((pl for pl in wh_prefs if pl.get("is_primary")), wh_prefs[0] if wh_prefs else None)
            if primary_pref:
                loc_check = await database.locations.find_one({
                    "_id": primary_pref["location_id"],
                    "warehouse_id": receipt["warehouse_id"],
                    "status": "active",
                })
                if loc_check:
                    suggested_loc_id = loc_check["_id"]
                    suggested_loc_code = loc_check["code"]
                    suggested_loc_path = loc_check.get("path") or loc_check["code"]

        serial_ids = line.get("serial_ids") or []
        serial_numbers = line.get("serial_numbers") or []
        if serial_ids and serial_numbers:
            entries = [
                (serial_id, serial_no, to_decimal128(1), "1")
                for serial_id, serial_no in zip(serial_ids, serial_numbers, strict=True)
            ]
        else:
            entries = [(None, line.get("serial_no"), line["base_qty"], line["qty"])]
        for serial_id, serial_no, base_qty, qty in entries:
            document = {
                "_id": new_id(),
                "company_id": receipt["company_id"],
                "client_id": receipt.get("client_id"),
                "receipt_id": receipt["_id"],
                "receipt_number": receipt["number"],
                "line_id": line["id"],
                "warehouse_id": receipt["warehouse_id"],
                "item_id": line["item_id"],
                "sku": line["sku"],
                "item_name": line["item_name"],
                "qty": qty,
                "uom": line["uom"],
                "base_qty": base_qty,
                "base_uom": line["base_uom"],
                "lot_id": line.get("lot_id"),
                "lot_no": line.get("lot_no"),
                "expiry_date": line.get("expiry_date"),
                "serial_id": serial_id,
                "serial_no": serial_no,
                "tracking_mode": line.get("tracking_mode", "none"),
                "supplier_id": receipt.get("supplier_id"),
                "supplier": receipt.get("supplier"),
                "purchase_order_id": receipt.get("purchase_order_id"),
                "purchase_order": receipt.get("purchase_order"),
                "from_location_id": from_location["_id"],
                "from_location_code": from_location["code"],
                "from_location_path": from_location.get("path") or from_location["code"],
                "to_location_id": None,
                "to_location_code": None,
                "suggested_location_id": suggested_loc_id,
                "suggested_location_code": suggested_loc_code,
                "suggested_location_path": suggested_loc_path,
                "completed_qty": to_decimal128(0),
                "placements": [],
                "version": 0,
                "status": "pending",
                "created_at": utcnow(),
                "updated_at": utcnow(),
                "completed_at": None,
                "completed_by": None,
            }
            try:
                await database.putaway_tasks.update_one(
                    {
                        "company_id": receipt["company_id"],
                        "receipt_id": receipt["_id"],
                        "line_id": line["id"],
                        "serial_id": serial_id,
                    },
                    {"$setOnInsert": document},
                    upsert=True,
                    session=session,
                )
                created += 1
            except DuplicateKeyError:
                continue
    return created


def _source_balance_filter(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "company_id": task["company_id"],
        "client_id": task.get("client_id"),
        "item_id": task["item_id"],
        "location_id": task["from_location_id"],
        "lot_id": task.get("lot_id"),
        "serial_id": task.get("serial_id"),
        "stock_status": "available",
    }


def _completed_qty(task: dict[str, Any]) -> Decimal:
    return to_decimal(task.get("completed_qty") or 0)


def _remaining_qty(task: dict[str, Any]) -> Decimal:
    return max(to_decimal(task["base_qty"]) - _completed_qty(task), Decimal("0"))


async def complete_putaway_task(
    database: Any,
    *,
    task_id: str,
    destination_id: str,
    company_id: str,
    client_scope: frozenset[str] | None,
    location_scope: frozenset[str] | None,
    actor_id: str,
    request_id: str | None,
    device_id: str | None,
    quantity: Decimal | None = None,
    serial_ids: list[str] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    now = utcnow()
    request_key = f"{task_id}:{idempotency_key}" if idempotency_key else None

    async def complete(session: Any) -> dict[str, Any]:
        task_query: dict[str, Any] = {"_id": task_id, "company_id": company_id}
        apply_client_scope(task_query, client_scope)
        task = await database.putaway_tasks.find_one(task_query, session=session)
        if task is None:
            raise APIError(404, "putaway_task_not_found", "The put-away task was not found.")
        if location_scope is not None and task["from_location_id"] not in location_scope:
            raise APIError(404, "putaway_task_not_found", "The put-away task was not found.")
        if task["status"] == "completed":
            if task.get("to_location_id") == destination_id:
                return task
            raise APIError(
                409,
                "putaway_task_completed",
                "This put-away task was already completed at another location.",
            )
        if task["status"] != "pending":
            raise APIError(
                409,
                "putaway_task_not_completable",
                "Only pending put-away tasks can be completed.",
            )

        completed_qty = _completed_qty(task)
        remaining_qty = _remaining_qty(task)
        requested_qty = remaining_qty if quantity is None else to_decimal(quantity)

        selected_serials = serial_ids or []
        task_serial_id = task.get("serial_id")
        if task_serial_id:
            if not selected_serials:
                raise APIError(
                    422,
                    "serial_selection_required",
                    "Select the serial number recorded on this task before putting it away.",
                    {"serial_ids": "Select the eligible serial number."},
                )
            if selected_serials != [task_serial_id]:
                raise APIError(
                    422,
                    "invalid_putaway_serial",
                    "Only the serial number recorded on this task can be moved.",
                    {"serial_ids": "Select the eligible serial number for this task."},
                )
            if requested_qty != 1:
                raise APIError(
                    422,
                    "invalid_putaway_quantity",
                    "Serial-tracked stock must be put away one unit at a time.",
                    {"quantity": "A serial task moves exactly one unit."},
                )
        elif selected_serials:
            raise APIError(
                422,
                "invalid_putaway_serial",
                "This put-away task is not serial-tracked.",
                {"serial_ids": "Remove the serial selection for this task."},
            )

        # Replayed requests are resolved before quantity bounds so a reused key always
        # reports a conflict (or the original result) even after stock has moved on.
        if request_key:
            existing_movement = await database.movements.find_one(
                {"company_id": company_id, "putaway_request_key": request_key},
                session=session,
            )
            if existing_movement is not None:
                matches_request = (
                    existing_movement.get("putaway_task_id") == task_id
                    and existing_movement.get("to_location_id") == destination_id
                    and to_decimal(existing_movement.get("base_qty")) == requested_qty
                )
                if not matches_request:
                    raise APIError(
                        409,
                        "putaway_idempotency_conflict",
                        "This Idempotency-Key was already used for a different put-away movement.",
                    )
                return task

        if requested_qty <= 0:
            raise APIError(
                422,
                "invalid_putaway_quantity",
                "The put-away quantity must be greater than zero.",
                {"quantity": "Enter a quantity greater than zero."},
            )
        if requested_qty > remaining_qty:
            raise APIError(
                422,
                "putaway_quantity_exceeds_remaining",
                "The put-away quantity exceeds the quantity still staged for this task.",
                {"quantity": f"Enter {remaining_qty} or less."},
            )

        # ``with_transaction`` may rerun the callback after an aborted attempt. Aborted
        # writes are never applied, so the callback can safely re-read the task and
        # re-validate before moving stock again.

        destination = await database.locations.find_one(
            {
                "_id": destination_id,
                "company_id": company_id,
                "warehouse_id": task["warehouse_id"],
                "status": "active",
            },
            session=session,
        )
        if destination is None:
            raise APIError(
                422,
                "invalid_putaway_location",
                "The destination location was not found in this warehouse.",
                {"location_id": "Select an active destination in the warehouse."},
            )
        if location_scope is not None and destination_id not in location_scope:
            raise APIError(
                403,
                "location_forbidden",
                "You do not have access to this destination location.",
            )
        if destination_id == task["from_location_id"]:
            raise APIError(
                422,
                "invalid_putaway_location",
                "The destination must differ from the receiving location.",
                {"location_id": "Choose a different destination location."},
            )
        if destination.get("type") in PUTAWAY_SOURCE_TYPES:
            raise APIError(
                422,
                "invalid_putaway_location",
                "Stock cannot be put away into a receiving or staging location.",
                {"location_id": "Choose a storage location."},
            )

        if destination.get("capacity"):
            dest_cap = to_decimal(destination["capacity"])
            dest_cursor = await database.balances.aggregate([
                {"$match": {"company_id": company_id, "location_id": destination_id}},
                {"$group": {"_id": "$location_id", "total": {"$sum": "$on_hand"}}},
            ])
            dest_stock = await dest_cursor.to_list(1)
            current_dest_qty = to_decimal(dest_stock[0]["total"]) if dest_stock else Decimal("0")
            if current_dest_qty + requested_qty > dest_cap:
                raise APIError(
                    422,
                    "bin_capacity_exceeded",
                    f"Placing {requested_qty} units exceeds bin capacity limit ({dest_cap} units; currently holding {current_dest_qty}).",
                )

        quantity_128 = to_decimal128(requested_qty)
        source_filter = _source_balance_filter(task)
        source_filter["on_hand"] = {"$gte": quantity_128}
        source = await database.balances.find_one_and_update(
            source_filter,
            {
                "$inc": {"on_hand": to_decimal128(-requested_qty), "version": 1},
                "$set": {"updated_at": now},
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if source is None:
            raise APIError(
                409,
                "putaway_stock_unavailable",
                "The stock is no longer available at the receiving location.",
                retryable=True,
            )

        destination_filter = {
            "company_id": company_id,
            "client_id": task.get("client_id"),
            "item_id": task["item_id"],
            "location_id": destination_id,
            "lot_id": task.get("lot_id"),
            "serial_id": task.get("serial_id"),
            "stock_status": "available",
        }
        await database.balances.find_one_and_update(
            destination_filter,
            {
                "$inc": {"on_hand": quantity_128, "version": 1},
                "$setOnInsert": {
                    "_id": new_id(),
                    "company_id": company_id,
                    "client_id": task.get("client_id"),
                    "item_id": task["item_id"],
                    "sku": task["sku"],
                    "item_name": task["item_name"],
                    "warehouse_id": task["warehouse_id"],
                    "location_id": destination_id,
                    "lot_id": task.get("lot_id"),
                    "lot_no": task.get("lot_no"),
                    "expiry_date": task.get("expiry_date"),
                    "serial_id": task.get("serial_id"),
                    "serial_no": task.get("serial_no"),
                    "stock_status": "available",
                    "reserved": to_decimal128(0),
                    "blocked": to_decimal128(0),
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
            session=session,
        )

        movement = {
            "_id": new_id(),
            "company_id": company_id,
            "client_id": task.get("client_id"),
            "type": "putaway",
            "item_id": task["item_id"],
            "sku": task["sku"],
            "item_name": task["item_name"],
            "quantity_delta": to_decimal128(0),
            "uom": task["base_uom"],
            "base_qty": quantity_128,
            "from_location_id": task["from_location_id"],
            "to_location_id": destination_id,
            "lot_id": task.get("lot_id"),
            "lot_no": task.get("lot_no"),
            "expiry_date": task.get("expiry_date"),
            "serial_id": task.get("serial_id"),
            "serial_no": task.get("serial_no"),
            "stock_status": "available",
            "source_type": "putaway_task",
            "source_id": task["_id"],
            "source_number": task["receipt_number"],
            "putaway_task_id": task["_id"],
            "actor_id": actor_id,
            "device_id": device_id,
            "occurred_at": now,
            "recorded_at": now,
            "reason": None,
            "reversal_of": None,
            "idempotency_key": (
                f"putaway:{request_key}" if request_key else f"putaway:{new_id()}"
            ),
        }
        if request_key:
            movement["putaway_request_key"] = request_key
        await database.movements.insert_one(movement, session=session)

        updated_completed_qty = completed_qty + requested_qty
        is_complete = updated_completed_qty >= to_decimal(task["base_qty"])
        task_updates: dict[str, Any] = {
            "updated_at": now,
            "last_to_location_id": destination_id,
            "last_to_location_code": destination["code"],
            "last_to_location_path": destination.get("path") or destination["code"],
            "last_moved_at": now,
            "last_moved_by": actor_id,
        }
        if is_complete:
            task_updates.update(
                {
                    "status": "completed",
                    "to_location_id": destination_id,
                    "to_location_code": destination["code"],
                    "to_location_path": destination.get("path") or destination["code"],
                    "completed_at": now,
                    "completed_by": actor_id,
                }
            )
        else:
            task_updates["status"] = "in_progress"

        task_filter: dict[str, Any] = {
            "_id": task_id,
            "company_id": company_id,
            "status": {"$in": ["pending", "in_progress"]},
        }
        if "version" in task:
            task_filter["version"] = task["version"]
        else:
            task_filter["version"] = {"$exists": False}
        updated = await database.putaway_tasks.find_one_and_update(
            task_filter,
            {
                "$inc": {"completed_qty": quantity_128, "version": 1},
                "$set": task_updates,
                "$push": {
                    "placements": {
                        "location_id": destination_id,
                        "location_code": destination["code"],
                        "quantity": quantity_128,
                        "moved_at": now,
                        "moved_by": actor_id,
                    }
                },
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            raise APIError(
                409,
                "putaway_task_conflict",
                "The put-away task was modified by another request.",
                retryable=True,
            )

        if is_complete:
            remaining_tasks = await database.putaway_tasks.count_documents(
                {
                    "company_id": company_id,
                    "receipt_id": task["receipt_id"],
                    "status": "pending",
                },
                session=session,
            )
            if remaining_tasks == 0:
                await database.receipts.update_one(
                    {"_id": task["receipt_id"], "company_id": company_id},
                    {
                        "$set": {
                            "putaway_completed_at": now,
                            "updated_at": now,
                        }
                    },
                    session=session,
                )

        action = "putaway.completed" if is_complete else "putaway.partially_completed"
        updated_remaining = max(
            to_decimal(task["base_qty"]) - updated_completed_qty, Decimal("0")
        )
        await database.audit_events.insert_one(
            {
                "_id": new_id(),
                "company_id": company_id,
                "actor_id": actor_id,
                "action": action,
                "entity": "putaway_task",
                "entity_id": task_id,
                "request_id": request_id,
                "device_id": device_id,
                "reason": None,
                "before": {
                    "status": "pending",
                    "completed_qty": str(completed_qty),
                    "remaining_qty": str(remaining_qty),
                },
                "after": {
                    "status": updated["status"],
                    "receipt_id": task["receipt_id"],
                    "to_location_id": destination_id,
                    "moved_qty": str(requested_qty),
                    "completed_qty": str(updated_completed_qty),
                    "remaining_qty": str(updated_remaining),
                    "base_qty": str(to_decimal(task["base_qty"])),
                },
                "created_at": now,
            },
            session=session,
        )
        await append_sync_event(
            database,
            company_id,
            entity_type="putaway_task",
            entity_id=task_id,
            action=action,
            client_id=task.get("client_id"),
            payload={
                "receipt_id": task["receipt_id"],
                "receipt_number": task["receipt_number"],
                "item_id": task["item_id"],
                "to_location_id": destination_id,
                "to_location_code": destination["code"],
                "moved_qty": str(requested_qty),
                "completed_qty": str(updated_completed_qty),
                "remaining_qty": str(updated_remaining),
                "base_qty": str(to_decimal(task["base_qty"])),
            },
            occurred_at=now,
            session=session,
        )
        return updated

    try:
        async with database.client.start_session() as session:
            return await session.with_transaction(complete)
    except DuplicateKeyError as exc:
        if request_key:
            movement = await database.movements.find_one(
                {"company_id": company_id, "putaway_request_key": request_key}
            )
            if movement is not None:
                task = await database.putaway_tasks.find_one(
                    {"_id": task_id, "company_id": company_id}
                )
                if task is not None:
                    return task
        task = await database.putaway_tasks.find_one(
            {"_id": task_id, "company_id": company_id}
        )
        if task is not None and task.get("status") == "completed":
            return task
        raise APIError(
            409,
            "putaway_task_conflict",
            "The put-away task was modified by another request. Retry.",
            retryable=True,
        ) from exc
