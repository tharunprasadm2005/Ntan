import re
from collections import defaultdict
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Request, status
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..schemas import (
    BulkLocationGenerateRequest,
    BulkLocationGenerateResponse,
    BulkLocationPreviewItem,
    InitialLocationCreate,
    LocationCreate,
    LocationListResponse,
    LocationOut,
    LocationUpdate,
    WarehouseCreate,
    WarehouseListResponse,
    WarehouseOut,
    WarehouseTemplateApplyRequest,
    WarehouseTemplateApplyResponse,
    WarehouseTemplateLocationPreview,
    WarehouseUpdate,
)
from ..serializers import location_out, warehouse_out, to_decimal
from ..utils import new_id, utcnow

router = APIRouter(tags=["warehouses"])


async def _ensure_warehouse_scope(
    database: Any,
    company_id: str,
    warehouse_id: str,
    location_scope: frozenset[str] | None,
) -> None:
    if location_scope is None:
        return
    if warehouse_id in location_scope:
        return
    allowed = await database.locations.find_one(
        {
            "_id": {"$in": sorted(location_scope)},
            "company_id": company_id,
            "warehouse_id": warehouse_id,
        }
    )
    if allowed is None:
        raise APIError(404, "warehouse_not_found", "The warehouse was not found.")


@router.get("/warehouses", response_model=WarehouseListResponse)
async def list_warehouses(
    context: ContextDep,
    database: DbDep,
    include_archived: bool = False,
) -> WarehouseListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if context.location_scope is not None:
        scoped_locations = await database.locations.find(
            {
                "company_id": context.company["_id"],
                "_id": {"$in": sorted(context.location_scope)},
            }
        ).to_list(length=len(context.location_scope))
        warehouse_ids = list({location["warehouse_id"] for location in scoped_locations})
        if not warehouse_ids:
            return WarehouseListResponse(warehouses=[])
        query["_id"] = {"$in": warehouse_ids}
    if not include_archived:
        query["status"] = "active"
    documents = await database.warehouses.find(query).sort([("name", 1)]).to_list(length=200)
    return WarehouseListResponse(warehouses=[warehouse_out(item) for item in documents])


def get_layout_template_spec(
    layout: str, selected_zones: list[str] | None = None
) -> list[dict[str, Any]]:
    if layout == "all_in_one":
        all_specs = [
            {
                "code": "FLOOR",
                "path": "FLOOR",
                "type": "main",
                "is_pickable": True,
                "description": "Unified floor storage & picking area (no internal putaway needed)",
                "parent_ref": None,
            }
        ]
    elif layout == "bulk_storage":
        all_specs = [
            {
                "code": "RECV",
                "path": "RECV",
                "type": "receiving",
                "is_pickable": False,
                "description": "Inbound receiving dock for pallet inspection & staging",
                "parent_ref": None,
            },
            {
                "code": "MAIN",
                "path": "MAIN",
                "type": "main",
                "is_pickable": True,
                "description": "Bulk pallet racks for heavy volume storage",
                "parent_ref": None,
            },
            {
                "code": "DISP",
                "path": "DISP",
                "type": "dispatch",
                "is_pickable": False,
                "description": "Outbound shipping dock for carrier dispatch",
                "parent_ref": None,
            },
            {
                "code": "QC",
                "path": "QC",
                "type": "quarantine",
                "is_pickable": False,
                "description": "Quality inspection and damaged goods quarantine area",
                "parent_ref": None,
            },
        ]
    else:  # "multi_zone"
        all_specs = [
            {
                "code": "RECV",
                "path": "RECV",
                "type": "receiving",
                "is_pickable": False,
                "description": "Inbound dock for arriving supplier shipments",
                "parent_ref": None,
            },
            {
                "code": "MAIN",
                "path": "MAIN",
                "type": "main",
                "is_pickable": False,
                "description": "Primary storage racks & reserve stock aisles",
                "parent_ref": None,
            },
            {
                "code": "BIN-01",
                "path": "MAIN/BIN-01",
                "type": "bin",
                "is_pickable": True,
                "description": "Active piece-picking bin under storage rack",
                "parent_ref": "MAIN",
            },
            {
                "code": "PICK",
                "path": "PICK",
                "type": "picking",
                "is_pickable": True,
                "description": "Forward picking zone for fast-moving items",
                "parent_ref": None,
            },
            {
                "code": "PACK",
                "path": "PACK",
                "type": "packing",
                "is_pickable": False,
                "description": "Order packing & consolidation station",
                "parent_ref": None,
            },
            {
                "code": "DISP",
                "path": "DISP",
                "type": "dispatch",
                "is_pickable": False,
                "description": "Outbound shipping dock for carrier dispatch",
                "parent_ref": None,
            },
            {
                "code": "QC",
                "path": "QC",
                "type": "quarantine",
                "is_pickable": False,
                "description": "Quality inspection and hold area",
                "parent_ref": None,
            },
            {
                "code": "LINE-SIDE",
                "path": "LINE-SIDE",
                "type": "line_side",
                "is_pickable": False,
                "description": "Manufacturing line-side supply staging",
                "parent_ref": None,
            },
            {
                "code": "FG",
                "path": "FG",
                "type": "finished_goods",
                "is_pickable": True,
                "description": "Finished goods warehouse area",
                "parent_ref": None,
            },
            {
                "code": "RETURNS",
                "path": "RETURNS",
                "type": "returns",
                "is_pickable": False,
                "description": "Customer returns intake & triage station",
                "parent_ref": None,
            },
            {
                "code": "COLD",
                "path": "COLD",
                "type": "cold_storage",
                "is_pickable": True,
                "description": "Temperature controlled cold storage vault",
                "parent_ref": None,
            },
        ]

    if selected_zones is not None:
        zone_set = set(selected_zones)
        filtered = [s for s in all_specs if s["type"] in zone_set or s["code"] in zone_set]
        present_codes = {s["code"] for s in filtered}
        for s in filtered:
            if s["parent_ref"] and s["parent_ref"] not in present_codes:
                s["parent_ref"] = None
                s["path"] = s["code"]
        return filtered

    # Standard default set if selected_zones not explicitly filtered
    if layout == "bulk_storage":
        return [s for s in all_specs if s["code"] in ("RECV", "MAIN")]
    elif layout == "multi_zone":
        return [s for s in all_specs if s["code"] in ("RECV", "MAIN", "BIN-01")]
    return all_specs


def _build_initial_locations(
    company_id: str,
    warehouse_id: str,
    user_id: str,
    initial_locations: list[InitialLocationCreate],
    now: Any,
    existing_parent_map: dict[str, tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    if len(initial_locations) > 1000:
        raise APIError(
            422,
            "batch_too_large",
            f"Cannot process more than 1000 initial locations in a single batch (got {len(initial_locations)}).",
        )

    seen_keys: set[tuple[str | None, str]] = set()
    for loc in initial_locations:
        pair = (loc.parent_code, loc.code)
        if pair in seen_keys:
            raise APIError(
                409,
                "duplicate_location_code",
                f"Duplicate location code '{loc.code}' under parent '{loc.parent_code or 'root'}'.",
                {"code": f"Location code '{loc.code}' is duplicated."},
            )
        seen_keys.add(pair)

    parent_map: dict[str, tuple[str, str]] = dict(existing_parent_map or {})
    built: list[dict[str, Any]] = []

    root_locs = [l for l in initial_locations if not l.parent_code]
    child_locs = [l for l in initial_locations if l.parent_code]

    for loc in root_locs:
        loc_id = new_id()
        path = loc.code
        parent_map[loc.code] = (loc_id, path)
        built.append(
            {
                "_id": loc_id,
                "company_id": company_id,
                "warehouse_id": warehouse_id,
                "parent_id": None,
                "code": loc.code,
                "name": loc.name,
                "path": path,
                "barcode": loc.barcode,
                "type": loc.type,
                "is_pickable": loc.is_pickable,
                "status": loc.status,
                "zone": loc.zone,
                "aisle": loc.aisle,
                "rack": loc.rack,
                "shelf": loc.shelf,
                "bin": loc.bin,
                "created_at": now,
                "updated_at": now,
                "created_by": user_id,
            }
        )

    for loc in child_locs:
        if loc.parent_code not in parent_map:
            raise APIError(
                422,
                "invalid_parent_code",
                f"Parent location '{loc.parent_code}' not found in configured locations.",
                {"parent_code": f"Parent location '{loc.parent_code}' does not exist."},
            )
        p_id, p_path = parent_map[loc.parent_code]
        loc_id = new_id()
        path = f"{p_path}/{loc.code}"
        parent_map[loc.code] = (loc_id, path)
        built.append(
            {
                "_id": loc_id,
                "company_id": company_id,
                "warehouse_id": warehouse_id,
                "parent_id": p_id,
                "code": loc.code,
                "name": loc.name,
                "path": path,
                "barcode": loc.barcode,
                "type": loc.type,
                "is_pickable": loc.is_pickable,
                "status": loc.status,
                "zone": loc.zone,
                "aisle": loc.aisle,
                "rack": loc.rack,
                "shelf": loc.shelf,
                "bin": loc.bin,
                "created_at": now,
                "updated_at": now,
                "created_by": user_id,
            }
        )

    return built


@router.post("/warehouses", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED)
async def create_warehouse(
    payload: WarehouseCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> WarehouseOut:
    context.require("warehouses.manage")
    if context.location_scope is not None and not context.is_owner:
        raise APIError(
            403,
            "organization_authorization_required",
            "Creating new facilities requires organization-wide authorization.",
        )
    now = utcnow()
    code = (payload.code or "").strip().upper()
    if not code:
        count = await database.warehouses.count_documents({"company_id": context.company["_id"]})
        code = f"WH-{count + 1:02d}"
    else:
        existing_code = await database.warehouses.find_one(
            {"company_id": context.company["_id"], "code": code}
        )
        if existing_code:
            raise APIError(
                409,
                "warehouse_code_exists",
                f"A warehouse with code '{code}' already exists in your company.",
                {"code": f"Code '{code}' is already in use."},
            )

    warehouse = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "code": code,
        "name": payload.name,
        "name_key": payload.name.casefold(),
        "address": payload.address,
        "warehouse_type": payload.warehouse_type,
        "warehouse_layout": payload.warehouse_layout,
        "status": payload.status,
        "created_at": now,
        "updated_at": now,
        "created_by": context.user["_id"],
    }

    default_locations: list[dict[str, Any]] = []
    if payload.initial_locations is not None:
        default_locations = _build_initial_locations(
            company_id=context.company["_id"],
            warehouse_id=warehouse["_id"],
            user_id=context.user["_id"],
            initial_locations=payload.initial_locations,
            now=now,
        )
    elif payload.apply_default_locations:
        specs = get_layout_template_spec(payload.warehouse_layout, payload.selected_zones)
        parent_map: dict[str, str] = {}
        for spec in specs:
            loc_id = new_id()
            parent_id = parent_map.get(spec["parent_ref"]) if spec["parent_ref"] else None
            parent_map[spec["code"]] = loc_id
            default_locations.append(
                {
                    "_id": loc_id,
                    "company_id": context.company["_id"],
                    "warehouse_id": warehouse["_id"],
                    "parent_id": parent_id,
                    "code": spec["code"],
                    "path": spec["path"],
                    "barcode": None,
                    "type": spec["type"],
                    "is_pickable": spec["is_pickable"],
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                    "created_by": context.user["_id"],
                }
            )

    async def create(session: Any) -> None:
        await database.warehouses.insert_one(warehouse, session=session)
        if default_locations:
            await database.locations.insert_many(default_locations, session=session)

    try:
        async with database.client.start_session() as session:
            await session.with_transaction(create)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "duplicate_warehouse",
            "A warehouse with this name already exists.",
            {"name": "Warehouse name must be unique within the company."},
        ) from exc

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="warehouse.created",
        entity="warehouse",
        entity_id=warehouse["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={
            "name": warehouse["name"],
            "code": warehouse["code"],
            "warehouse_type": warehouse["warehouse_type"],
            "warehouse_layout": warehouse["warehouse_layout"],
            "default_locations": [loc["code"] for loc in default_locations],
        },
    )
    return warehouse_out(warehouse)


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseOut)
async def update_warehouse(
    warehouse_id: str,
    payload: WarehouseUpdate,
    context: ContextDep,
    database: DbDep,
) -> WarehouseOut:
    context.require("warehouses.manage")
    existing = await database.warehouses.find_one(
        {"_id": warehouse_id, "company_id": context.company["_id"]}
    )
    if existing is None:
        raise APIError(404, "warehouse_not_found", "The warehouse was not found.")
    await _ensure_warehouse_scope(
        database,
        context.company["_id"],
        warehouse_id,
        context.location_scope,
    )
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name_key"] = changes["name"].casefold()
    changes["updated_at"] = utcnow()
    try:
        await database.warehouses.update_one(
            {"_id": warehouse_id, "company_id": context.company["_id"]},
            {"$set": changes},
        )
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "duplicate_warehouse",
            "A warehouse with this name already exists.",
        ) from exc
    updated = await database.warehouses.find_one(
        {"_id": warehouse_id, "company_id": context.company["_id"]}
    )
    return warehouse_out(updated)


@router.post("/warehouses/{warehouse_id}/apply-template", response_model=WarehouseTemplateApplyResponse)
async def apply_warehouse_template(
    warehouse_id: str,
    payload: WarehouseTemplateApplyRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> WarehouseTemplateApplyResponse:
    context.require("warehouses.manage")
    warehouse = await database.warehouses.find_one(
        {"_id": warehouse_id, "company_id": context.company["_id"]}
    )
    if warehouse is None:
        raise APIError(404, "warehouse_not_found", "The warehouse was not found.")
    await _ensure_warehouse_scope(
        database,
        context.company["_id"],
        warehouse_id,
        context.location_scope,
    )
    layout = warehouse.get("warehouse_layout") or "multi_zone"
    now = utcnow()
    existing_locs = await database.locations.find(
        {"company_id": context.company["_id"], "warehouse_id": warehouse_id}
    ).to_list(length=1000)
    existing_codes = {l["code"] for l in existing_locs}

    if payload.initial_locations is not None:
        preview_items = [
            WarehouseTemplateLocationPreview(
                code=l.code,
                path=f"{l.parent_code}/{l.code}" if l.parent_code else l.code,
                type=l.type,
                is_pickable=l.is_pickable,
                description=l.name or f"{l.type} location",
            )
            for l in payload.initial_locations
        ]
        if payload.preview_only:
            return WarehouseTemplateApplyResponse(
                warehouse_id=warehouse_id,
                warehouse_layout=layout,
                preview_only=True,
                locations=preview_items,
                created_count=0,
            )

        existing_parent_map: dict[str, tuple[str, str]] = {}
        for loc in existing_locs:
            existing_parent_map[loc["code"]] = (loc["_id"], loc.get("path") or loc["code"])

        non_dups = [l for l in payload.initial_locations if l.code not in existing_codes]
        created_locations = _build_initial_locations(
            company_id=context.company["_id"],
            warehouse_id=warehouse_id,
            user_id=context.user["_id"],
            initial_locations=non_dups,
            now=now,
            existing_parent_map=existing_parent_map,
        )
    else:
        specs = get_layout_template_spec(layout, payload.selected_zones)
        preview_items = [
            WarehouseTemplateLocationPreview(
                code=s["code"],
                path=s["path"],
                type=s["type"],
                is_pickable=s["is_pickable"],
                description=s["description"],
            )
            for s in specs
        ]
        if payload.preview_only:
            return WarehouseTemplateApplyResponse(
                warehouse_id=warehouse_id,
                warehouse_layout=layout,
                preview_only=True,
                locations=preview_items,
                created_count=0,
            )

        created_locations = []
        parent_map: dict[str, str] = {}
        # First map existing codes to IDs if any exist
        for loc in existing_locs:
            parent_map[loc["code"]] = loc["_id"]

        for spec in specs:
            if spec["code"] in existing_codes:
                continue
            loc_id = new_id()
            parent_id = parent_map.get(spec["parent_ref"]) if spec["parent_ref"] else None
            parent_map[spec["code"]] = loc_id
            created_locations.append(
                {
                    "_id": loc_id,
                    "company_id": context.company["_id"],
                    "warehouse_id": warehouse_id,
                    "parent_id": parent_id,
                    "code": spec["code"],
                    "path": spec["path"],
                    "barcode": None,
                    "type": spec["type"],
                    "is_pickable": spec["is_pickable"],
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                    "created_by": context.user["_id"],
                }
            )

    if created_locations:
        await database.locations.insert_many(created_locations)
        await record_audit(
            database,
            company_id=context.company["_id"],
            actor_id=context.user["_id"],
            action="warehouse.template_applied",
            entity="warehouse",
            entity_id=warehouse_id,
            request_id=getattr(request.state, "request_id", None),
            after={
                "warehouse_layout": layout,
                "created_locations": [l["code"] for l in created_locations],
            },
        )

    return WarehouseTemplateApplyResponse(
        warehouse_id=warehouse_id,
        warehouse_layout=layout,
        preview_only=False,
        locations=preview_items,
        created_count=len(created_locations),
    )


@router.get("/locations", response_model=LocationListResponse)
async def list_locations(
    context: ContextDep,
    database: DbDep,
    warehouse_id: str | None = None,
    include_archived: bool = False,
    status: str | None = None,
) -> LocationListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if context.location_scope is not None:
        query["_id"] = {"$in": sorted(context.location_scope)}
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    if status:
        query["status"] = status
    elif not include_archived:
        query["status"] = {"$ne": "archived"}
    documents = (
        await database.locations.find(query)
        .sort([("warehouse_id", 1), ("code", 1)])
        .to_list(length=1000)
    )
    loc_ids = [d["_id"] for d in documents]

    pref_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if loc_ids:
        items_cursor = database.items.find(
            {"company_id": context.company["_id"], "preferred_locations.location_id": {"$in": loc_ids}},
            {"_id": 1, "sku": 1, "name": 1, "preferred_locations": 1},
        )
        async for item_doc in items_cursor:
            for pl in item_doc.get("preferred_locations") or []:
                target_loc_id = pl.get("location_id")
                if target_loc_id in loc_ids:
                    pref_map[target_loc_id].append({
                        "item_id": item_doc["_id"],
                        "sku": item_doc.get("sku"),
                        "name": item_doc.get("name"),
                        "is_primary": pl.get("is_primary", True),
                    })

    stock_map: dict[str, Decimal] = defaultdict(Decimal)
    if loc_ids:
        balance_cursor = await database.balances.aggregate([
            {"$match": {"company_id": context.company["_id"], "location_id": {"$in": loc_ids}}},
            {"$group": {"_id": "$location_id", "total_on_hand": {"$sum": "$on_hand"}}},
        ])
        for row in await balance_cursor.to_list(length=len(loc_ids)):
            stock_map[row["_id"]] = to_decimal(row["total_on_hand"]) or Decimal("0")

    return LocationListResponse(
        locations=[
            location_out(
                item,
                preferred_items=pref_map.get(item["_id"], []),
                actual_stock_qty=stock_map.get(item["_id"], Decimal("0")),
            )
            for item in documents
        ]
    )


@router.get("/locations/{location_id}", response_model=LocationOut)
async def get_location(
    location_id: str,
    context: ContextDep,
    database: DbDep,
) -> LocationOut:
    context.require("inventory.read")
    query: dict[str, Any] = {
        "_id": location_id,
        "company_id": context.company["_id"],
    }
    if context.location_scope is not None and location_id not in context.location_scope:
        raise APIError(404, "location_not_found", "The location was not found.")
    location = await database.locations.find_one(query)
    if location is None:
        raise APIError(404, "location_not_found", "The location was not found.")
    await _ensure_warehouse_scope(
        database,
        context.company["_id"],
        location["warehouse_id"],
        context.location_scope,
    )

    pref_items: list[dict[str, Any]] = []
    items_cursor = database.items.find(
        {"company_id": context.company["_id"], "preferred_locations.location_id": location_id},
        {"_id": 1, "sku": 1, "name": 1, "preferred_locations": 1},
    )
    async for item_doc in items_cursor:
        for pl in item_doc.get("preferred_locations") or []:
            if pl.get("location_id") == location_id:
                pref_items.append({
                    "item_id": item_doc["_id"],
                    "sku": item_doc.get("sku"),
                    "name": item_doc.get("name"),
                    "is_primary": pl.get("is_primary", True),
                })

    balance_cursor = await database.balances.aggregate([
        {"$match": {"company_id": context.company["_id"], "location_id": location_id}},
        {"$group": {"_id": "$location_id", "total_on_hand": {"$sum": "$on_hand"}}},
    ])
    actual_stock_qty = Decimal("0")
    for row in await balance_cursor.to_list(length=1):
        actual_stock_qty = to_decimal(row["total_on_hand"]) or Decimal("0")

    return location_out(
        location,
        preferred_items=pref_items,
        actual_stock_qty=actual_stock_qty,
    )


@router.post("/locations", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
async def create_location(
    payload: LocationCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> LocationOut:
    context.require("inventory.write")
    warehouse = await database.warehouses.find_one(
        {
            "_id": payload.warehouse_id,
            "company_id": context.company["_id"],
            "status": "active",
        }
    )
    if warehouse is None:
        raise APIError(
            422,
            "invalid_warehouse",
            "The warehouse does not exist or is inactive.",
            {"warehouse_id": "Select an active warehouse."},
        )
    await _ensure_warehouse_scope(
        database,
        context.company["_id"],
        payload.warehouse_id,
        context.location_scope,
    )
    parent = None
    if payload.parent_id:
        parent = await database.locations.find_one(
            {
                "_id": payload.parent_id,
                "company_id": context.company["_id"],
                "warehouse_id": payload.warehouse_id,
            }
        )
        if parent is None:
            raise APIError(
                422,
                "invalid_parent_location",
                "The parent location was not found in this warehouse.",
                {"parent_id": "Select a parent location in the same warehouse."},
            )
    path = payload.path
    if not path:
        parent_path = (parent.get("path") or parent["code"]) if parent else None
        path = f"{parent_path}/{payload.code}" if parent_path else payload.code
    now = utcnow()
    document = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "warehouse_id": payload.warehouse_id,
        "parent_id": payload.parent_id,
        "code": payload.code,
        "name": payload.name,
        "path": path,
        "barcode": payload.barcode,
        "type": payload.type,
        "is_pickable": payload.is_pickable,
        "status": payload.status,
        "zone": payload.zone,
        "aisle": payload.aisle,
        "rack": payload.rack,
        "shelf": payload.shelf,
        "bin": payload.bin,
        "created_at": now,
        "updated_at": now,
        "created_by": context.user["_id"],
    }
    try:
        await database.locations.insert_one(document)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "duplicate_location_code",
            "A location with this code already exists at this level.",
            {"code": "Location code must be unique within its parent."},
        ) from exc
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="location.created",
        entity="location",
        entity_id=document["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={
            "code": document["code"],
            "path": document["path"],
            "type": document["type"],
            "status": document["status"],
        },
    )
    return location_out(document)


@router.patch("/locations/{location_id}", response_model=LocationOut)
async def update_location(
    location_id: str,
    payload: LocationUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> LocationOut:
    context.require("inventory.write")
    company_id = context.company["_id"]
    existing = await database.locations.find_one({"_id": location_id, "company_id": company_id})
    if existing is None:
        raise APIError(404, "location_not_found", "The location was not found.")
    await _ensure_warehouse_scope(
        database,
        company_id,
        existing["warehouse_id"],
        context.location_scope,
    )
    if context.location_scope is not None and location_id not in context.location_scope:
        raise APIError(403, "location_forbidden", "You do not have access to this warehouse location.")

    changes = payload.model_dump(exclude_unset=True)
    now = utcnow()

    # If code changed, check duplicate and recompute path
    old_code = existing["code"]
    old_path = existing.get("path") or old_code
    new_path = None
    if "code" in changes and changes["code"] != old_code:
        duplicate = await database.locations.find_one(
            {
                "company_id": company_id,
                "warehouse_id": existing["warehouse_id"],
                "parent_id": existing.get("parent_id"),
                "code": changes["code"],
                "_id": {"$ne": location_id},
            }
        )
        if duplicate:
            raise APIError(
                409,
                "duplicate_location_code",
                f"A location with code '{changes['code']}' already exists under this parent.",
                {"code": f"Code '{changes['code']}' is already in use."},
            )
        if existing.get("parent_id"):
            parent = await database.locations.find_one(
                {"_id": existing["parent_id"], "company_id": company_id}
            )
            parent_path = (parent.get("path") or parent["code"]) if parent else None
            new_path = f"{parent_path}/{changes['code']}" if parent_path else changes["code"]
        else:
            new_path = changes["code"]
        changes["path"] = new_path

    if "barcode" in changes and changes["barcode"]:
        dup_barcode = await database.locations.find_one(
            {
                "company_id": company_id,
                "barcode": changes["barcode"],
                "_id": {"$ne": location_id},
            }
        )
        if dup_barcode:
            raise APIError(
                409,
                "duplicate_barcode",
                f"A location with barcode '{changes['barcode']}' already exists.",
                {"barcode": "Barcode must be unique."},
            )

    if changes.get("status") in ("blocked", "archived"):
        pending_putaway = await database.putaway_tasks.find_one(
            {
                "company_id": company_id,
                "to_location_id": location_id,
                "status": "pending",
            }
        )
        if pending_putaway:
            raise APIError(
                409,
                "location_has_pending_putaway",
                "Cannot block or archive location because a pending put-away task targets it.",
            )

    if changes.get("status") == "archived":
        has_stock = await database.balances.find_one(
            {"company_id": company_id, "location_id": location_id, "on_hand": {"$gt": 0}}
        )
        if has_stock:
            raise APIError(
                409,
                "location_has_stock",
                "Cannot archive location while inventory stock is on hand.",
            )

    changes["updated_at"] = now
    try:
        await database.locations.update_one(
            {"_id": location_id, "company_id": company_id},
            {"$set": changes},
        )
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "duplicate_location_code",
            "A duplicate location conflict occurred.",
        ) from exc

    if new_path and new_path != old_path:
        old_prefix = f"{old_path}/"
        children = await database.locations.find(
            {
                "company_id": company_id,
                "warehouse_id": existing["warehouse_id"],
                "path": {"$regex": f"^{re.escape(old_prefix)}"},
            }
        ).to_list(length=1000)
        for child in children:
            child_old_path = child["path"]
            child_new_path = new_path + child_old_path[len(old_path):]
            await database.locations.update_one(
                {"_id": child["_id"]},
                {"$set": {"path": child_new_path, "updated_at": now}},
            )

    updated = await database.locations.find_one({"_id": location_id, "company_id": company_id})
    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="location.updated",
        entity="location",
        entity_id=location_id,
        request_id=getattr(request.state, "request_id", None),
        before={
            "code": old_code,
            "status": existing.get("status"),
            "is_pickable": existing.get("is_pickable"),
        },
        after=changes,
    )
    return location_out(updated)


@router.post("/locations/bulk", response_model=BulkLocationGenerateResponse)
async def generate_bulk_locations(
    payload: BulkLocationGenerateRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> BulkLocationGenerateResponse:
    context.require("inventory.write")
    company_id = context.company["_id"]
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
            "The warehouse does not exist or is inactive.",
            {"warehouse_id": "Select an active warehouse."},
        )
    await _ensure_warehouse_scope(database, company_id, payload.warehouse_id, context.location_scope)

    parent = None
    parent_path = None
    if payload.parent_id:
        parent = await database.locations.find_one(
            {
                "_id": payload.parent_id,
                "company_id": company_id,
                "warehouse_id": payload.warehouse_id,
            }
        )
        if parent is None:
            raise APIError(
                422,
                "invalid_parent_location",
                "The parent location was not found in this warehouse.",
                {"parent_id": "Select a parent location in the same warehouse."},
            )
        parent_path = parent.get("path") or parent["code"]

    aisle_count = payload.aisle_end - payload.aisle_start + 1
    rack_count = payload.rack_end - payload.rack_start + 1
    shelf_count = payload.shelf_end - payload.shelf_start + 1
    bin_count = payload.bin_end - payload.bin_start + 1

    if aisle_count < 1 or rack_count < 1 or shelf_count < 1 or bin_count < 1:
        raise APIError(422, "invalid_range", "Start values cannot be greater than end values.")

    total = aisle_count * rack_count * shelf_count * bin_count
    if total > 500:
        raise APIError(
            422,
            "batch_too_large",
            f"Generated {total} locations, which exceeds the maximum batch size of 500. Adjust your ranges.",
        )

    sep = payload.separator
    pad = payload.zero_pad
    prefix = payload.prefix.strip().upper() if payload.prefix else None

    generated_items: list[dict[str, Any]] = []
    generated_codes: list[str] = []

    for a in range(payload.aisle_start, payload.aisle_end + 1):
        a_str = f"{a:0{pad}d}"
        for r in range(payload.rack_start, payload.rack_end + 1):
            r_str = f"{r:0{pad}d}"
            for s in range(payload.shelf_start, payload.shelf_end + 1):
                s_str = f"{s:0{pad}d}"
                for b in range(payload.bin_start, payload.bin_end + 1):
                    b_str = f"{b:0{pad}d}"
                    if aisle_count == 1 and rack_count == 1 and shelf_count == 1:
                        if prefix:
                            code = f"{prefix}{sep}{b_str}"
                        else:
                            code = f"BIN{sep}{b_str}"
                    else:
                        parts = [a_str, r_str, s_str, b_str]
                        code_body = sep.join(parts)
                        code = f"{prefix}{sep}{code_body}" if prefix else code_body

                    code = code.upper()
                    path = f"{parent_path}/{code}" if parent_path else code
                    generated_codes.append(code)
                    generated_items.append({
                        "code": code,
                        "path": path,
                        "aisle": a_str,
                        "rack": r_str,
                        "shelf": s_str,
                        "bin": b_str,
                    })

    existing_docs = await database.locations.find(
        {
            "company_id": company_id,
            "warehouse_id": payload.warehouse_id,
            "parent_id": payload.parent_id,
            "code": {"$in": generated_codes},
        }
    ).to_list(length=len(generated_codes))
    existing_codes = {doc["code"] for doc in existing_docs}

    preview_items: list[BulkLocationPreviewItem] = []
    duplicate_count = 0
    new_count = 0

    for item in generated_items:
        is_dup = item["code"] in existing_codes
        if is_dup:
            duplicate_count += 1
            preview_items.append(
                BulkLocationPreviewItem(
                    code=item["code"],
                    path=item["path"],
                    aisle=item["aisle"],
                    rack=item["rack"],
                    shelf=item["shelf"],
                    bin=item["bin"],
                    is_duplicate=True,
                    status="duplicate",
                    error="Location code already exists under this parent",
                )
            )
        else:
            new_count += 1
            preview_items.append(
                BulkLocationPreviewItem(
                    code=item["code"],
                    path=item["path"],
                    aisle=item["aisle"],
                    rack=item["rack"],
                    shelf=item["shelf"],
                    bin=item["bin"],
                    is_duplicate=False,
                    status="ready",
                )
            )

    if payload.preview_only:
        return BulkLocationGenerateResponse(
            preview_only=True,
            total_generated=total,
            new_count=new_count,
            duplicate_count=duplicate_count,
            locations=preview_items,
            created_count=0,
        )

    now = utcnow()
    wh_code = (warehouse.get("code") or "WH").strip().upper()
    docs_to_insert = [
        {
            "_id": new_id(),
            "company_id": company_id,
            "warehouse_id": payload.warehouse_id,
            "parent_id": payload.parent_id,
            "code": item["code"],
            "path": item["path"],
            "barcode": f"{wh_code}:{item['code']}",
            "type": payload.type,
            "is_pickable": payload.is_pickable,
            "status": "active",
            "zone": None,
            "aisle": item["aisle"],
            "rack": item["rack"],
            "shelf": item["shelf"],
            "bin": item["bin"],
            "created_at": now,
            "updated_at": now,
            "created_by": context.user["_id"],
        }
        for item in generated_items
        if item["code"] not in existing_codes
    ]

    created_count = 0
    if docs_to_insert:
        try:
            await database.locations.insert_many(docs_to_insert, ordered=False)
            created_count = len(docs_to_insert)
        except DuplicateKeyError:
            created_count = len(docs_to_insert)

        await record_audit(
            database,
            company_id=company_id,
            actor_id=context.user["_id"],
            action="location.bulk_created",
            entity="location",
            entity_id=payload.warehouse_id,
            request_id=getattr(request.state, "request_id", None),
            after={
                "warehouse_id": payload.warehouse_id,
                "created_count": created_count,
                "type": payload.type,
            },
        )

    return BulkLocationGenerateResponse(
        preview_only=False,
        total_generated=total,
        new_count=new_count,
        duplicate_count=duplicate_count,
        locations=preview_items,
        created_count=created_count,
    )
