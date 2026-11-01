from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Request, status
from pymongo import ReturnDocument

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..schemas import (
    ChecklistItemResult,
    InspectionQueueItemOut,
    InspectionRecordOut,
    InspectionSubmitRequest,
)
from ..serializers import to_decimal
from ..services.putaway import PUTAWAY_SOURCE_TYPES
from ..utils import new_id, to_decimal128, utcnow

router = APIRouter(prefix="/inspections", tags=["inspections"])

DEFAULT_CHECKLIST_CATEGORIES = [
    {
        "category": "Product identity",
        "items": [
            "Correct SKU matches PO line and documentation",
            "Barcode scans cleanly and matches catalogue",
            "Physical product model and markings match specifications",
        ],
    },
    {
        "category": "Quantity",
        "items": [
            "Physical piece count matches receipt packing slip",
            "No carton/pack quantity mismatch detected",
            "Zero missing or short-shipped individual units",
        ],
    },
    {
        "category": "Packaging",
        "items": [
            "Outer master cartons intact and undamaged",
            "Dry packaging with zero moisture or water ingress",
            "Tamper-evident seals intact and uncompromised",
        ],
    },
    {
        "category": "Product condition",
        "items": [
            "Zero surface scratches or cosmetic blemishes",
            "Zero physical dents, cracks or impact damage",
            "All structural and loose accessories present",
        ],
    },
    {
        "category": "Functional testing",
        "items": [
            "Power-on / initialization test passed",
            "Core functional and sensor verification successful",
            "Performance and operational tolerance within specification",
        ],
    },
    {
        "category": "Traceability",
        "items": [
            "Batch / lot number clearly stamped on packaging",
            "Serial numbers match manufacturer registry",
            "Manufacturing and expiry dates recorded and verified",
        ],
    },
    {
        "category": "Compliance",
        "items": [
            "Required regulatory compliance certificates present",
            "Country of origin and warning labels applied",
            "Material safety data and handling instructions verified",
        ],
    },
]


@router.get("/templates")
async def get_inspection_templates(context: ContextDep, database: DbDep) -> dict[str, Any]:
    context.require("inventory.read")
    custom_templates = await database.inspection_templates.find(
        {"company_id": context.company["_id"], "status": "active"}
    ).to_list(100)
    return {
        "categories": DEFAULT_CHECKLIST_CATEGORIES,
        "custom_templates": custom_templates,
    }


@router.get("/queue", response_model=list[InspectionQueueItemOut])
async def list_inspection_queue(
    context: ContextDep,
    database: DbDep,
    warehouse_id: str | None = None,
    supplier_id: str | None = None,
    status_filter: str | None = None,
) -> list[InspectionQueueItemOut]:
    context.require("inventory.read")

    query: dict[str, Any] = {
        "company_id": context.company["_id"],
        "status": {"$in": ["applied", "closed", "draft"]},
    }
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    if supplier_id:
        query["supplier_id"] = supplier_id

    receipts = await database.receipts.find(query).sort([("created_at", -1)]).to_list(200)
    if not receipts:
        return []

    wh_ids = list({r["warehouse_id"] for r in receipts if r.get("warehouse_id")})
    wh_map: dict[str, str] = {}
    if wh_ids:
        wh_cursor = database.warehouses.find({"_id": {"$in": wh_ids}})
        async for w in wh_cursor:
            wh_map[w["_id"]] = w.get("name") or w.get("code") or "Warehouse"

    # Pre-fetch inspection summaries
    receipt_ids = [r["_id"] for r in receipts]
    inspections_cursor = database.inspections.find(
        {"company_id": context.company["_id"], "receipt_id": {"$in": receipt_ids}}
    )
    inspections_by_line: dict[str, list[dict[str, Any]]] = {}
    async for ins in inspections_cursor:
        key = f"{ins['receipt_id']}:{ins['line_id']}"
        inspections_by_line.setdefault(key, []).append(ins)

    # Pre-fetch items to get preferred locations
    item_ids = list({line["item_id"] for r in receipts for line in r.get("lines", [])})
    item_map: dict[str, dict[str, Any]] = {}
    if item_ids:
        item_cursor = database.items.find({"_id": {"$in": item_ids}})
        async for it in item_cursor:
            item_map[it["_id"]] = it

    queue_items: list[InspectionQueueItemOut] = []
    for r in receipts:
        wh_name = wh_map.get(r.get("warehouse_id", ""), "Warehouse")
        for line in r.get("lines", []):
            line_id = line["id"]
            line_key = f"{r['_id']}:{line_id}"
            line_inspections = inspections_by_line.get(line_key, [])

            received_qty = to_decimal(line["qty"]) or Decimal("0")
            passed_qty = sum((to_decimal(i.get("passed_qty", 0)) or Decimal("0") for i in line_inspections), Decimal("0"))
            rejected_qty = sum((to_decimal(i.get("rejected_qty", 0)) or Decimal("0") for i in line_inspections), Decimal("0"))
            on_hold_qty = sum((to_decimal(i.get("on_hold_qty", 0)) or Decimal("0") for i in line_inspections), Decimal("0"))

            inspected_total = passed_qty + rejected_qty + on_hold_qty
            pending_qty = max(Decimal("0"), received_qty - inspected_total)

            if inspected_total == 0:
                insp_status = "pending"
            elif pending_qty == 0:
                if rejected_qty == 0 and on_hold_qty == 0:
                    insp_status = "passed"
                elif passed_qty == 0 and on_hold_qty == 0:
                    insp_status = "rejected"
                elif on_hold_qty > 0 and passed_qty == 0 and rejected_qty == 0:
                    insp_status = "on_hold"
                else:
                    insp_status = "partially_passed"
            else:
                insp_status = "in_progress"

            if status_filter and status_filter != "all" and insp_status != status_filter:
                continue

            # Suggested location from item preferred location
            it_doc = item_map.get(line["item_id"])
            suggested_loc_id = None
            suggested_loc_code = None
            if it_doc:
                wh_id_val = r.get("warehouse_id")
                pref_locs = [
                    pl for pl in it_doc.get("preferred_locations", [])
                    if pl.get("warehouse_id") == wh_id_val
                ]
                primary_pref = next((pl for pl in pref_locs if pl.get("is_primary")), pref_locs[0] if pref_locs else None)
                if primary_pref:
                    suggested_loc_id = primary_pref.get("location_id")
                    suggested_loc_code = primary_pref.get("location_code") or primary_pref.get("bin")

            queue_items.append(
                InspectionQueueItemOut(
                    id=f"{r['_id']}_{line_id}",
                    receipt_id=r["_id"],
                    receipt_number=r["number"],
                    line_id=line_id,
                    supplier_id=r.get("supplier_id"),
                    supplier=r.get("supplier"),
                    purchase_order_id=r.get("purchase_order_id"),
                    purchase_order=r.get("purchase_order"),
                    item_id=line["item_id"],
                    sku=line["sku"],
                    product_name=line["item_name"],
                    warehouse_id=r["warehouse_id"],
                    warehouse_name=wh_name,
                    received_quantity=received_qty,
                    pending_quantity=pending_qty,
                    passed_quantity=passed_qty,
                    rejected_quantity=rejected_qty,
                    on_hold_quantity=on_hold_qty,
                    inspection_status=insp_status,
                    receipt_date=r.get("created_at") or utcnow(),
                    suggested_location_id=suggested_loc_id,
                    suggested_location_code=suggested_loc_code,
                )
            )

    return queue_items


@router.post("", response_model=InspectionRecordOut, status_code=status.HTTP_201_CREATED)
async def submit_inspection(
    payload: InspectionSubmitRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> InspectionRecordOut:
    context.require("inventory.write")

    receipt = await database.receipts.find_one({
        "_id": payload.receipt_id,
        "company_id": context.company["_id"],
    })
    if not receipt:
        raise APIError(404, "receipt_not_found", "Receipt not found.")

    line = next((l for l in receipt.get("lines", []) if l["id"] == payload.line_id), None)
    if not line:
        raise APIError(404, "line_not_found", "Receipt line not found.")

    passed = payload.passed_qty
    rejected = payload.rejected_qty
    on_hold = payload.on_hold_qty
    total_inspected = passed + rejected + on_hold

    if total_inspected <= Decimal("0"):
        raise APIError(422, "invalid_quantity", "Total inspected quantity must be greater than zero.")

    # Check already inspected
    existing_inspections = await database.inspections.find({
        "company_id": context.company["_id"],
        "receipt_id": payload.receipt_id,
        "line_id": payload.line_id,
    }).to_list(100)

    already_passed = sum((to_decimal(i.get("passed_qty", 0)) or Decimal("0") for i in existing_inspections), Decimal("0"))
    already_rejected = sum((to_decimal(i.get("rejected_qty", 0)) or Decimal("0") for i in existing_inspections), Decimal("0"))
    already_held = sum((to_decimal(i.get("on_hold_qty", 0)) or Decimal("0") for i in existing_inspections), Decimal("0"))
    already_total = already_passed + already_rejected + already_held

    line_received_qty = to_decimal(line["qty"]) or Decimal("0")
    if already_total + total_inspected > line_received_qty:
        raise APIError(
            422,
            "quantity_reconciliation_error",
            f"Total inspected ({already_total + total_inspected}) cannot exceed received quantity ({line_received_qty}).",
        )

    now = utcnow()
    inspection_id = new_id()

    # Determine status
    if rejected == 0 and on_hold == 0:
        record_status = "PASSED"
    elif passed == 0 and on_hold == 0:
        record_status = "REJECTED"
    elif on_hold > 0 and passed == 0 and rejected == 0:
        record_status = "ON_HOLD"
    else:
        record_status = "PARTIALLY_PASSED"

    # ROUTING LOGIC:
    wh_id = receipt["warehouse_id"]

    # 1. PASSED STOCK ROUTING
    if passed > Decimal("0"):
        # Check item preferred location for warehouse
        item_doc = await database.items.find_one({
            "_id": payload.item_id,
            "company_id": context.company["_id"],
        })
        pref_loc = None
        if item_doc:
            wh_prefs = [
                pl for pl in item_doc.get("preferred_locations", [])
                if pl.get("warehouse_id") == wh_id
            ]
            pref_loc = next((pl for pl in wh_prefs if pl.get("is_primary")), wh_prefs[0] if wh_prefs else None)

        # Validate destination or preferred location
        destination_id = payload.destination_location_id or (pref_loc.get("location_id") if pref_loc else None)
        dest_loc = None
        if destination_id:
            dest_loc = await database.locations.find_one({
                "_id": destination_id,
                "warehouse_id": wh_id,
                "company_id": context.company["_id"],
                "status": "active",
            })

        # Update or create putaway task for passed stock
        from_loc_id = line.get("location_id") or receipt.get("location_id")
        from_loc = await database.locations.find_one({"_id": from_loc_id}) if from_loc_id else None

        if from_loc and from_loc.get("type") in PUTAWAY_SOURCE_TYPES:
            # Check existing putaway task for this receipt line
            putaway_task = await database.putaway_tasks.find_one({
                "company_id": context.company["_id"],
                "receipt_id": receipt["_id"],
                "line_id": line["id"],
                "status": "pending",
            })
            if putaway_task:
                # Update suggested destination
                update_putaway: dict[str, Any] = {"updated_at": now}
                if dest_loc:
                    update_putaway["suggested_location_id"] = dest_loc["_id"]
                    update_putaway["suggested_location_code"] = dest_loc["code"]
                    update_putaway["suggested_location_path"] = dest_loc.get("path") or dest_loc["code"]
                await database.putaway_tasks.update_one(
                    {"_id": putaway_task["_id"]},
                    {"$set": update_putaway},
                )

    # 2. REJECTED STOCK ROUTING (Quarantine)
    if rejected > Decimal("0"):
        # Find quarantine location in this warehouse
        quarantine_loc = await database.locations.find_one({
            "warehouse_id": wh_id,
            "company_id": context.company["_id"],
            "type": "quarantine",
            "status": "active",
        })
        if not quarantine_loc:
            quarantine_loc = await database.locations.find_one({
                "warehouse_id": wh_id,
                "company_id": context.company["_id"],
                "code": {"$regex": "^(QUAR|QC)", "$options": "i"},
                "status": "active",
            })

        # Mark rejected quantity as quarantine status in balances
        from_loc_id = line.get("location_id") or receipt.get("location_id")
        if from_loc_id and quarantine_loc:
            # Transfer rejected quantity to quarantine location with quarantine status
            quar_loc_id = quarantine_loc["_id"]
            # Deduct from source staging balance
            await database.balances.update_one(
                {
                    "company_id": context.company["_id"],
                    "client_id": receipt.get("client_id"),
                    "item_id": payload.item_id,
                    "location_id": from_loc_id,
                    "lot_id": line.get("lot_id"),
                },
                {"$inc": {"on_hand": to_decimal128(-rejected), "available": to_decimal128(-rejected)}},
            )
            # Add to quarantine balance with stock_status = 'quarantine'
            await database.balances.update_one(
                {
                    "company_id": context.company["_id"],
                    "client_id": receipt.get("client_id"),
                    "item_id": payload.item_id,
                    "location_id": quar_loc_id,
                    "lot_id": line.get("lot_id"),
                },
                {
                    "$inc": {"on_hand": to_decimal128(rejected)},
                    "$setOnInsert": {
                        "_id": new_id(),
                        "sku": line["sku"],
                        "item_name": line["item_name"],
                        "warehouse_id": wh_id,
                        "stock_status": "quarantine",
                        "available": to_decimal128(0),
                        "reserved": to_decimal128(0),
                        "created_at": now,
                    },
                    "$set": {"updated_at": now, "stock_status": "quarantine"},
                },
                upsert=True,
            )

    # 3. ON HOLD STOCK ROUTING
    if on_hold > Decimal("0"):
        from_loc_id = line.get("location_id") or receipt.get("location_id")
        if from_loc_id:
            # Make sure on-hold portion is held and not available for picking
            await database.balances.update_one(
                {
                    "company_id": context.company["_id"],
                    "client_id": receipt.get("client_id"),
                    "item_id": payload.item_id,
                    "location_id": from_loc_id,
                    "lot_id": line.get("lot_id"),
                },
                {
                    "$inc": {"available": to_decimal128(-on_hold)},
                    "$set": {"stock_status": "hold", "updated_at": now},
                },
            )

    # Insert inspection document
    inspection_doc = {
        "_id": inspection_id,
        "company_id": context.company["_id"],
        "receipt_id": payload.receipt_id,
        "receipt_number": receipt["number"],
        "line_id": payload.line_id,
        "item_id": payload.item_id,
        "sku": line["sku"],
        "product_name": line["item_name"],
        "warehouse_id": wh_id,
        "passed_qty": to_decimal128(passed),
        "rejected_qty": to_decimal128(rejected),
        "on_hold_qty": to_decimal128(on_hold),
        "status": record_status,
        "checklist": [item.model_dump() for item in payload.checklist],
        "defect_photos": payload.defect_photos,
        "notes": payload.notes,
        "inspector_id": context.user["_id"],
        "inspector_name": context.user.get("name") or context.user.get("email"),
        "created_at": now,
        "updated_at": now,
    }
    await database.inspections.insert_one(inspection_doc)

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="inspection.completed",
        entity="inspection",
        entity_id=inspection_id,
        request_id=getattr(request.state, "request_id", None),
        after={
            "receipt_number": receipt["number"],
            "sku": line["sku"],
            "status": record_status,
            "passed": str(passed),
            "rejected": str(rejected),
            "on_hold": str(on_hold),
        },
    )

    return InspectionRecordOut(
        id=inspection_id,
        receipt_id=payload.receipt_id,
        receipt_number=receipt["number"],
        line_id=payload.line_id,
        item_id=payload.item_id,
        sku=line["sku"],
        product_name=line["item_name"],
        warehouse_id=wh_id,
        passed_qty=passed,
        rejected_qty=rejected,
        on_hold_qty=on_hold,
        status=record_status,
        checklist=payload.checklist,
        defect_photos=payload.defect_photos,
        notes=payload.notes,
        inspector_id=context.user["_id"],
        inspector_name=context.user.get("name") or context.user.get("email"),
        created_at=now,
    )


@router.get("/history", response_model=list[InspectionRecordOut])
async def list_inspection_history(
    context: ContextDep,
    database: DbDep,
    warehouse_id: str | None = None,
    item_id: str | None = None,
) -> list[InspectionRecordOut]:
    context.require("inventory.read")

    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    if item_id:
        query["item_id"] = item_id

    documents = await database.inspections.find(query).sort([("created_at", -1)]).to_list(100)

    records: list[InspectionRecordOut] = []
    for doc in documents:
        checklist_items = [
            ChecklistItemResult(
                category=c.get("category", "General"),
                item=c.get("item", "Item check"),
                status=c.get("status", "passed"),
                measurement=c.get("measurement"),
                notes=c.get("notes"),
            )
            for c in doc.get("checklist", [])
        ]
        records.append(
            InspectionRecordOut(
                id=doc["_id"],
                receipt_id=doc["receipt_id"],
                receipt_number=doc["receipt_number"],
                line_id=doc["line_id"],
                item_id=doc["item_id"],
                sku=doc["sku"],
                product_name=doc["product_name"],
                warehouse_id=doc["warehouse_id"],
                passed_qty=to_decimal(doc["passed_qty"]) or Decimal("0"),
                rejected_qty=to_decimal(doc["rejected_qty"]) or Decimal("0"),
                on_hold_qty=to_decimal(doc["on_hold_qty"]) or Decimal("0"),
                status=doc.get("status", "PASSED"),
                checklist=checklist_items,
                defect_photos=doc.get("defect_photos") or [],
                notes=doc.get("notes"),
                inspector_id=doc.get("inspector_id", ""),
                inspector_name=doc.get("inspector_name"),
                created_at=doc.get("created_at") or utcnow(),
            )
        )

    return records
