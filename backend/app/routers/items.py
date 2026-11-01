import base64
import csv
import io
import re
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

import openpyxl
from fastapi import APIRouter, Query, Request, Response, status
from openpyxl.styles import Alignment, Font, PatternFill
from pymongo import InsertOne, UpdateOne
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..permissions import has_permission
from ..schemas import (
    BulkImportError,
    BulkImportRequest,
    BulkImportResponse,
    ItemCreate,
    ItemListResponse,
    ItemLookupRequest,
    ItemOut,
    ItemSupplierCreate,
    ItemSupplierListResponse,
    ItemSupplierOut,
    ItemSupplierUpdate,
    ItemUpdate,
)
from ..serializers import item_out, item_supplier_out
from ..services.clients import (
    apply_client_scope,
    ensure_client_access,
    resolve_client_id,
)
from ..services.supplier_items import (
    clear_other_preferred,
    clear_preferred_for_item,
    get_item_document,
    get_mapping_document,
    get_supplier_document,
    mapping_cost_value,
    supplier_summaries,
)
from ..utils import decode_cursor, encode_cursor, new_id, to_decimal128, utcnow

router = APIRouter(prefix="/items", tags=["items"])


def _can_read_cost(context: ContextDep) -> bool:
    return has_permission(context.permissions, "cost.read")


@router.get("", response_model=ItemListResponse)
async def list_items(
    context: ContextDep,
    database: DbDep,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
    cursor: str | None = None,
    client_id: str | None = None,
    search: str | None = None,
    category: str | None = None,
    tracking_mode: str | None = None,
    status_filter: str | None = None,
    supplier_id: str | None = None,
) -> ItemListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if client_id:
        query["client_id"] = client_id
    if supplier_id:
        linked_item_ids = await database.supplier_item_mappings.distinct(
            "item_id",
            {
                "company_id": context.company["_id"],
                "client_id": supplier_id,
                "status": "active",
            },
        )
        query["_id"] = {"$in": linked_item_ids}
    if category and category.lower() != "all":
        query["category"] = category
    if tracking_mode and tracking_mode.lower() != "all":
        query["tracking_mode"] = tracking_mode.lower()
    if status_filter and status_filter.lower() != "all":
        query["status"] = status_filter.lower()
    if search and search.strip():
        s = re.escape(search.strip())
        query["$or"] = [
            {"sku": {"$regex": s, "$options": "i"}},
            {"name": {"$regex": s, "$options": "i"}},
            {"barcode": {"$regex": s, "$options": "i"}},
            {"category": {"$regex": s, "$options": "i"}},
            {"description": {"$regex": s, "$options": "i"}},
        ]
    apply_client_scope(query, context.client_scope)
    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        query["$or"] = [
            {"created_at": {"$lt": timestamp}},
            {"created_at": timestamp, "_id": {"$lt": identifier}},
        ]
    documents = (
        await database.items.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        last = documents[-1]
        next_cursor = encode_cursor(last["created_at"], last["_id"])
    summaries = await supplier_summaries(
        database,
        context.company["_id"],
        [document["_id"] for document in documents],
    )
    return ItemListResponse(
        items=[
            item_out(
                document,
                include_cost=_can_read_cost(context),
                **summaries.get(document["_id"], {}),
            )
            for document in documents
        ],
        next_cursor=next_cursor,
    )


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: ItemCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> ItemOut:
    context.require("inventory.write")
    client_id = await resolve_client_id(database, context, payload.client_id)
    now = utcnow()
    document = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "client_id": client_id,
        "sku": payload.sku,
        "name": payload.name,
        "barcode": payload.barcode,
        "description": payload.description,
        "category": payload.category,
        "item_type": payload.item_type,
        "base_uom": payload.base_uom,
        "tracking_mode": payload.tracking_mode,
        "expiry_tracked": payload.expiry_tracked,
        "cost": to_decimal128(payload.cost) if payload.cost is not None else None,
        "reorder_point": (
            to_decimal128(payload.reorder_point) if payload.reorder_point is not None else None
        ),
        "status": payload.status,
        "created_at": now,
        "updated_at": now,
        "created_by": context.user["_id"],
    }
    try:
        await database.items.insert_one(document)
    except DuplicateKeyError as exc:
        if "barcode" in str(exc):
            raise APIError(
                409,
                "duplicate_barcode",
                "An item with this barcode already exists for this client.",
                {"barcode": "Barcode must be unique within the client."},
            ) from exc
        raise APIError(
            409,
            "duplicate_sku",
            "An item with this SKU already exists for this client.",
            {"sku": "SKU must be unique within the client."},
        ) from exc
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="item.created",
        entity="item",
        entity_id=document["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={"sku": document["sku"], "name": document["name"]},
    )
    return item_out(document, include_cost=_can_read_cost(context))


@router.post("/lookup", response_model=ItemOut)
async def lookup_item(
    payload: ItemLookupRequest,
    context: ContextDep,
    database: DbDep,
) -> ItemOut:
    context.require("inventory.read")
    code = payload.code.strip()
    query: dict[str, Any] = {
        "company_id": context.company["_id"],
        "$or": [{"sku": code.upper()}, {"barcode": code}],
    }
    if payload.client_id:
        query["client_id"] = payload.client_id
    apply_client_scope(query, context.client_scope)
    documents = await database.items.find(query).limit(2).to_list(length=2)
    if not documents:
        raise APIError(404, "item_not_found", "No item matches this SKU or barcode.")
    if len(documents) > 1:
        raise APIError(
            422,
            "client_required",
            "The code matches items for multiple clients. Select a client.",
            {"client_id": "A client is required."},
        )
    return item_out(documents[0], include_cost=_can_read_cost(context))


@router.get("/csv-template")
async def get_csv_template(context: ContextDep) -> Response:
    context.require("inventory.read")
    template = (
        "sku,name,barcode,category,item_type,base_uom,tracking_mode,expiry_tracked,reorder_point,cost,description,warehouse_code,zone_code,aisle_code,rack_code,shelf_code,bin_code,storage_type,preferred_location\n"
        "CHG-1001,Charger,8901234001,Electronics,stocked_material,EA,none,false,25.0,45.00,Fast charger,CHN-WH,A,A03,R05,S02,B08,bin,B08\n"
        "ELEC-1001,Copper Multi-Core Cable 50m,8901234002,Electrical,stocked_material,MTR,none,false,20.0,35.50,Industrial heavy duty wiring,,,,,,,,\n"
        "CHEM-2002,Solvent Cleaner Degreaser 5L,8901234003,Chemicals,stocked_material,CAN,lot,true,10.0,42.00,Fast-acting industrial cleaning solvent,,,,,,,,\n"
        "MTR-3003,Precision Servo Motor 24V,8901234004,Robotics,stocked_material,EA,serial,false,5.0,185.00,Brushless high-torque servo motor,,,,,,,,\n"
    )
    return Response(
        content=template,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="items_template.csv"'},
    )


@router.get("/export")
async def export_items_csv(
    context: ContextDep,
    database: DbDep,
    client_id: str | None = None,
    status_filter: str | None = None,
    format: str = "csv",
) -> Response:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if client_id:
        query["client_id"] = client_id
    if status_filter and status_filter != "all":
        query["status"] = status_filter
    apply_client_scope(query, context.client_scope)

    documents = (
        await database.items.find(query)
        .sort([("sku", 1)])
        .to_list(length=10000)
    )

    include_cost = _can_read_cost(context)

    headers = [
        "sku",
        "name",
        "barcode",
        "category",
        "item_type",
        "base_uom",
        "tracking_mode",
        "expiry_tracked",
        "reorder_point",
    ]
    if include_cost:
        headers.append("cost")
    headers.extend([
        "status",
        "description",
        "warehouse_code",
        "zone_code",
        "aisle_code",
        "rack_code",
        "shelf_code",
        "bin_code",
        "storage_type",
        "preferred_location",
    ])

    rows_data: list[list[str]] = []
    for doc in documents:
        row = [
            doc.get("sku", ""),
            doc.get("name", ""),
            doc.get("barcode") or "",
            doc.get("category") or "",
            doc.get("item_type", "stocked_material"),
            doc.get("base_uom", "EA"),
            doc.get("tracking_mode", "none"),
            "true" if doc.get("expiry_tracked") else "false",
            str(doc["reorder_point"].to_decimal()) if doc.get("reorder_point") is not None else "",
        ]
        if include_cost:
            row.append(str(doc["cost"].to_decimal()) if doc.get("cost") is not None else "")
        pref_locs = doc.get("preferred_locations") or []
        primary_loc = next((pl for pl in pref_locs if pl.get("is_primary")), pref_locs[0] if pref_locs else None)
        row.extend([
            doc.get("status", "active"),
            doc.get("description") or "",
            (primary_loc.get("warehouse_code") or "") if primary_loc else "",
            (primary_loc.get("zone") or "") if primary_loc else "",
            (primary_loc.get("aisle") or "") if primary_loc else "",
            (primary_loc.get("rack") or "") if primary_loc else "",
            (primary_loc.get("shelf") or "") if primary_loc else "",
            (primary_loc.get("bin") or primary_loc.get("location_code") or "") if primary_loc else "",
            (primary_loc.get("storage_type") or "") if primary_loc else "",
            (primary_loc.get("location_path") or primary_loc.get("location_code") or "") if primary_loc else "",
        ])
        rows_data.append(row)

    if format.lower() == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Products Catalogue"
        ws.append(headers)
        for r in rows_data:
            ws.append(r)

        header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="items_catalogue_export.xlsx"'},
        )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for r in rows_data:
        writer.writerow(r)

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="items_catalogue_export.csv"'},
    )


@router.post("/bulk-import", response_model=BulkImportResponse)
async def bulk_import_items(
    payload: BulkImportRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> BulkImportResponse:
    context.require("inventory.write")
    client_id = await resolve_client_id(database, context, payload.client_id)
    include_cost = _can_read_cost(context)

    raw_rows: list[dict[str, Any]] = []

    # Handle file_base64 (.xlsx, .xls, .csv)
    if payload.file_base64:
        try:
            file_bytes = base64.b64decode(payload.file_base64)
        except Exception as exc:
            raise APIError(400, "invalid_base64", f"Could not decode file: {exc}")

        file_name = (payload.file_name or "").lower()
        if file_name.endswith((".xlsx", ".xls")):
            try:
                wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
                ws = wb.active
                sheet_rows = list(ws.iter_rows(values_only=True))
            except Exception as exc:
                raise APIError(400, "invalid_excel", f"Could not read Excel file: {exc}")

            if not sheet_rows or not any(sheet_rows):
                return BulkImportResponse(
                    total_rows=0,
                    created_count=0,
                    updated_count=0,
                    skipped_count=0,
                    error_count=0,
                    errors=[],
                )

            raw_headers = [str(cell or "").strip() for cell in sheet_rows[0]]
            col_map: dict[str, int] = {}
            for idx, h in enumerate(raw_headers):
                clean_h = h.strip().lower().replace(" ", "_").replace("-", "_")
                col_map[clean_h] = idx

            def get_col_excel(row_list: tuple[Any, ...], *aliases: str) -> str | None:
                for alias in aliases:
                    if alias in col_map and col_map[alias] < len(row_list):
                        val = row_list[col_map[alias]]
                        if val is not None:
                            val_str = str(val).strip()
                            if val_str:
                                return val_str
                return None

            for line_num, row_tuple in enumerate(sheet_rows[1:], start=2):
                if not row_tuple or not any(c is not None for c in row_tuple):
                    continue
                sku_val = get_col_excel(row_tuple, "sku", "product_sku", "item_code", "code")
                name_val = get_col_excel(row_tuple, "name", "item_name", "product_name", "title")
                barcode_val = get_col_excel(row_tuple, "barcode", "upc", "ean", "gtin")
                category_val = get_col_excel(row_tuple, "category", "group", "item_category")
                item_type_val = get_col_excel(row_tuple, "item_type", "type") or "stocked_material"
                base_uom_val = get_col_excel(row_tuple, "base_uom", "uom", "unit") or "EA"
                tracking_val = get_col_excel(row_tuple, "tracking_mode", "tracking") or "none"
                expiry_val_str = get_col_excel(row_tuple, "expiry_tracked", "expiry") or "false"
                cost_val_str = get_col_excel(row_tuple, "cost", "unit_cost", "purchase_cost")
                reorder_val_str = get_col_excel(row_tuple, "reorder_point", "min_stock", "reorder_level")
                status_val = get_col_excel(row_tuple, "status") or "active"
                desc_val = get_col_excel(row_tuple, "description", "desc", "details")
                wh_val = get_col_excel(row_tuple, "warehouse_code", "warehouse", "wh_code", "wh")
                zone_val = get_col_excel(row_tuple, "zone_code", "zone")
                aisle_val = get_col_excel(row_tuple, "aisle_code", "aisle")
                rack_val = get_col_excel(row_tuple, "rack_code", "rack")
                shelf_val = get_col_excel(row_tuple, "shelf_code", "shelf")
                bin_val = get_col_excel(row_tuple, "bin_code", "bin", "bin_number")
                storage_type_val = get_col_excel(row_tuple, "storage_type", "location_type", "type_of_storage")
                pref_loc_val = get_col_excel(row_tuple, "preferred_location", "preferred_loc", "preferred_bin", "location")

                raw_rows.append(
                    {
                        "row_index": line_num,
                        "sku": sku_val,
                        "name": name_val,
                        "barcode": barcode_val,
                        "category": category_val,
                        "item_type": item_type_val,
                        "base_uom": base_uom_val,
                        "tracking_mode": tracking_val.lower(),
                        "expiry_tracked": expiry_val_str.lower() in ("true", "1", "yes", "y"),
                        "cost": cost_val_str,
                        "reorder_point": reorder_val_str,
                        "status": status_val.lower(),
                        "description": desc_val,
                        "warehouse_code": wh_val,
                        "zone_code": zone_val,
                        "aisle_code": aisle_val,
                        "rack_code": rack_val,
                        "shelf_code": shelf_val,
                        "bin_code": bin_val,
                        "storage_type": storage_type_val,
                        "preferred_location": pref_loc_val,
                    }
                )
        else:
            try:
                payload.csv_data = file_bytes.decode("utf-8-sig")
            except UnicodeDecodeError:
                payload.csv_data = file_bytes.decode("latin1")

    # If csv_data provided, parse it
    if payload.csv_data and payload.csv_data.strip():
        f = io.StringIO(payload.csv_data.strip())
        reader = csv.reader(f)
        try:
            raw_headers = next(reader, None)
        except Exception as exc:
            raise APIError(400, "invalid_csv", f"Could not parse CSV: {exc}")
        if not raw_headers:
            return BulkImportResponse(
                total_rows=0,
                created_count=0,
                updated_count=0,
                skipped_count=0,
                error_count=0,
                errors=[],
            )

        col_map: dict[str, int] = {}
        for idx, h in enumerate(raw_headers):
            clean_h = h.strip().lower().replace(" ", "_").replace("-", "_")
            col_map[clean_h] = idx

        def get_col(row_list: list[str], *aliases: str) -> str | None:
            for alias in aliases:
                if alias in col_map and col_map[alias] < len(row_list):
                    val = row_list[col_map[alias]].strip()
                    if val:
                        return val
            return None

        line_num = 1
        for row_list in reader:
            line_num += 1
            if not row_list or not any(row_list):
                continue
            sku_val = get_col(row_list, "sku", "product_sku", "item_code", "code")
            name_val = get_col(row_list, "name", "item_name", "product_name", "title")
            barcode_val = get_col(row_list, "barcode", "upc", "ean", "gtin")
            category_val = get_col(row_list, "category", "group", "item_category")
            item_type_val = get_col(row_list, "item_type", "type") or "stocked_material"
            base_uom_val = get_col(row_list, "base_uom", "uom", "unit") or "EA"
            tracking_val = get_col(row_list, "tracking_mode", "tracking") or "none"
            expiry_val_str = get_col(row_list, "expiry_tracked", "expiry") or "false"
            cost_val_str = get_col(row_list, "cost", "unit_cost", "purchase_cost")
            reorder_val_str = get_col(row_list, "reorder_point", "min_stock", "reorder_level")
            status_val = get_col(row_list, "status") or "active"
            desc_val = get_col(row_list, "description", "desc", "details")
            wh_val = get_col(row_list, "warehouse_code", "warehouse", "wh_code", "wh")
            zone_val = get_col(row_list, "zone_code", "zone")
            aisle_val = get_col(row_list, "aisle_code", "aisle")
            rack_val = get_col(row_list, "rack_code", "rack")
            shelf_val = get_col(row_list, "shelf_code", "shelf")
            bin_val = get_col(row_list, "bin_code", "bin", "bin_number")
            storage_type_val = get_col(row_list, "storage_type", "location_type", "type_of_storage")
            pref_loc_val = get_col(row_list, "preferred_location", "preferred_loc", "preferred_bin", "location")

            raw_rows.append(
                {
                    "row_index": line_num,
                    "sku": sku_val,
                    "name": name_val,
                    "barcode": barcode_val,
                    "category": category_val,
                    "item_type": item_type_val,
                    "base_uom": base_uom_val,
                    "tracking_mode": tracking_val.lower(),
                    "expiry_tracked": expiry_val_str.lower() in ("true", "1", "yes", "y"),
                    "cost": cost_val_str,
                    "reorder_point": reorder_val_str,
                    "status": status_val.lower(),
                    "description": desc_val,
                    "warehouse_code": wh_val,
                    "zone_code": zone_val,
                    "aisle_code": aisle_val,
                    "rack_code": rack_val,
                    "shelf_code": shelf_val,
                    "bin_code": bin_val,
                    "storage_type": storage_type_val,
                    "preferred_location": pref_loc_val,
                }
            )
    elif payload.items:
        for idx, item in enumerate(payload.items):
            raw_rows.append(
                {
                    "row_index": idx + 1,
                    "sku": item.sku,
                    "name": item.name,
                    "barcode": item.barcode,
                    "category": item.category,
                    "item_type": item.item_type,
                    "base_uom": item.base_uom,
                    "tracking_mode": item.tracking_mode,
                    "expiry_tracked": item.expiry_tracked,
                    "cost": str(item.cost) if item.cost is not None else None,
                    "reorder_point": str(item.reorder_point) if item.reorder_point is not None else None,
                    "status": item.status,
                    "description": item.description,
                    "warehouse_code": item.warehouse_code,
                    "zone_code": item.zone_code,
                    "aisle_code": item.aisle_code,
                    "rack_code": item.rack_code,
                    "shelf_code": item.shelf_code,
                    "bin_code": item.bin_code,
                    "storage_type": item.storage_type,
                    "preferred_location": item.preferred_location,
                }
            )

    errors: list[BulkImportError] = []
    validated_rows: list[dict[str, Any]] = []
    validated_by_sku: dict[str, dict[str, Any]] = {}
    seen_sku_wh: set[tuple[str, str | None]] = set()
    seen_barcodes: dict[str, str] = {}

    # Pre-index warehouses and locations if any row specifies location info
    has_any_location_data = any(
        any(r.get(k) for k in ("warehouse_code", "zone_code", "aisle_code", "rack_code", "shelf_code", "bin_code", "preferred_location"))
        for r in raw_rows
    )

    wh_map: dict[str, dict[str, Any]] = {}
    loc_by_code: dict[tuple[str, str], dict[str, Any]] = {}
    loc_by_path: dict[tuple[str, str], dict[str, Any]] = {}
    loc_by_bin: dict[tuple[str, str], dict[str, Any]] = {}
    loc_by_hier: dict[tuple[str, str, str, str, str, str], dict[str, Any]] = {}
    all_wh_list: list[dict[str, Any]] = []

    if has_any_location_data:
        all_wh_list = await database.warehouses.find(
            {"company_id": context.company["_id"], "status": {"$ne": "archived"}}
        ).to_list(1000)
        for w in all_wh_list:
            if w.get("code"):
                c_str = str(w["code"]).strip().upper()
                wh_map[c_str] = w
                norm_c = re.sub(r"[\s\-_]", "", c_str)
                wh_map[norm_c] = w
            if w.get("name"):
                n_str = str(w["name"]).strip().lower()
                wh_map[n_str] = w
                norm_n = re.sub(r"[\s\-_]", "", n_str)
                wh_map[norm_n] = w
            wh_map[w["_id"]] = w

        loc_cursor = database.locations.find(
            {"company_id": context.company["_id"], "status": {"$ne": "archived"}}
        )
        async for loc in loc_cursor:
            wh_id = loc["warehouse_id"]
            code_u = (loc.get("code") or "").strip().upper()
            if code_u:
                loc_by_code[(wh_id, code_u)] = loc
            path_u = (loc.get("path") or "").strip().upper()
            if path_u:
                loc_by_path[(wh_id, path_u)] = loc
            bin_u = (loc.get("bin") or "").strip().upper()
            if bin_u:
                loc_by_bin[(wh_id, bin_u)] = loc

            z = (loc.get("zone") or "").strip().upper()
            a = (loc.get("aisle") or "").strip().upper()
            rk = (loc.get("rack") or "").strip().upper()
            s = (loc.get("shelf") or "").strip().upper()
            b = (loc.get("bin") or "").strip().upper()
            if b:
                loc_by_hier[(wh_id, z, a, rk, s, b)] = loc

    for r in raw_rows:
        row_idx = r["row_index"]
        sku = (r.get("sku") or "").strip().upper()
        name = (r.get("name") or "").strip()

        if not sku:
            errors.append(BulkImportError(row=row_idx, sku=None, field="sku", message="SKU is required"))
            continue
        if len(sku) > 64:
            errors.append(BulkImportError(row=row_idx, sku=sku, field="sku", message="SKU must be <= 64 characters"))
            continue
        if not name:
            errors.append(BulkImportError(row=row_idx, sku=sku, field="name", message="Item name is required"))
            continue
        if len(name) > 200:
            errors.append(BulkImportError(row=row_idx, sku=sku, field="name", message="Name must be <= 200 characters"))
            continue

        wh_val = (r.get("warehouse_code") or "").strip()
        sku_wh_key = (sku, wh_val.upper() if wh_val else None)
        if sku_wh_key in seen_sku_wh:
            errors.append(BulkImportError(row=row_idx, sku=sku, field="sku", message=f"Duplicate SKU '{sku}' in import dataset"))
            continue
        seen_sku_wh.add(sku_wh_key)

        barcode = (r.get("barcode") or "").strip() or None
        if barcode:
            if barcode in seen_barcodes and seen_barcodes[barcode] != sku:
                errors.append(BulkImportError(row=row_idx, sku=sku, field="barcode", message=f"Duplicate barcode '{barcode}' in import dataset"))
                continue
            seen_barcodes[barcode] = sku

        tracking_mode = r.get("tracking_mode", "none").strip().lower()
        if tracking_mode not in ("none", "lot", "serial"):
            errors.append(BulkImportError(row=row_idx, sku=sku, field="tracking_mode", message="tracking_mode must be 'none', 'lot', or 'serial'"))
            continue

        cost_dec: Decimal | None = None
        if r.get("cost") is not None and str(r["cost"]).strip():
            try:
                cost_dec = Decimal(str(r["cost"]).strip().replace(",", "."))
                if cost_dec < 0:
                    errors.append(BulkImportError(row=row_idx, sku=sku, field="cost", message="Cost must be >= 0"))
                    continue
            except InvalidOperation:
                errors.append(BulkImportError(row=row_idx, sku=sku, field="cost", message="Invalid cost number"))
                continue

        reorder_dec: Decimal | None = None
        if r.get("reorder_point") is not None and str(r["reorder_point"]).strip():
            try:
                reorder_dec = Decimal(str(r["reorder_point"]).strip().replace(",", "."))
                if reorder_dec < 0:
                    errors.append(BulkImportError(row=row_idx, sku=sku, field="reorder_point", message="Reorder point must be >= 0"))
                    continue
            except InvalidOperation:
                errors.append(BulkImportError(row=row_idx, sku=sku, field="reorder_point", message="Invalid reorder point number"))
                continue

        # Location validation
        wh_val = (r.get("warehouse_code") or "").strip()
        bin_val = (r.get("bin_code") or "").strip()
        pref_loc_val = (r.get("preferred_location") or "").strip()
        zone_val = (r.get("zone_code") or "").strip()
        aisle_val = (r.get("aisle_code") or "").strip()
        rack_val = (r.get("rack_code") or "").strip()
        shelf_val = (r.get("shelf_code") or "").strip()
        storage_type_val = (r.get("storage_type") or "").strip()

        preferred_loc_payload: dict[str, Any] | None = None

        if wh_val or bin_val or pref_loc_val or zone_val or aisle_val or rack_val or shelf_val:
            matched_wh: dict[str, Any] | None = None
            if wh_val:
                norm_wh = re.sub(r"[\s\-_]", "", wh_val.upper())
                matched_wh = (
                    wh_map.get(wh_val.upper())
                    or wh_map.get(wh_val.lower())
                    or wh_map.get(wh_val)
                    or wh_map.get(norm_wh)
                )
                if not matched_wh and len(all_wh_list) == 1:
                    matched_wh = all_wh_list[0]
                if not matched_wh:
                    errors.append(BulkImportError(row=row_idx, sku=sku, field="warehouse_code", message=f"Warehouse '{wh_val}' not found in Warehouses & Bins"))
                    continue
            else:
                if len(all_wh_list) == 1:
                    matched_wh = all_wh_list[0]
                else:
                    errors.append(BulkImportError(row=row_idx, sku=sku, field="warehouse_code", message="warehouse_code is required to assign storage location"))
                    continue

            wh_id = matched_wh["_id"]
            matched_loc: dict[str, Any] | None = None

            # 1. Hierarchical match
            if bin_val and (zone_val or aisle_val or rack_val or shelf_val):
                matched_loc = loc_by_hier.get((
                    wh_id,
                    zone_val.upper(),
                    aisle_val.upper(),
                    rack_val.upper(),
                    shelf_val.upper(),
                    bin_val.upper(),
                ))

            # 2. Code, path, or bin match
            if not matched_loc:
                for candidate in [bin_val, pref_loc_val]:
                    if candidate:
                        cu = candidate.upper()
                        matched_loc = (
                            loc_by_code.get((wh_id, cu))
                            or loc_by_path.get((wh_id, cu))
                            or loc_by_bin.get((wh_id, cu))
                        )
                        if matched_loc:
                            break

            if not matched_loc:
                target_str = bin_val or pref_loc_val or f"{zone_val}-{aisle_val}-{rack_val}-{shelf_val}"
                errors.append(
                    BulkImportError(
                        row=row_idx,
                        sku=sku,
                        field="bin_code",
                        message=f"Location '{target_str}' not found in warehouse '{matched_wh.get('code') or matched_wh['name']}'. Locations must be created in Warehouses & Bins first.",
                    )
                )
                continue

            if matched_loc.get("status") == "archived":
                errors.append(
                    BulkImportError(
                        row=row_idx,
                        sku=sku,
                        field="bin_code",
                        message=f"Location '{matched_loc['code']}' in warehouse '{matched_wh.get('code') or matched_wh['name']}' is archived.",
                    )
                )
                continue

            preferred_loc_payload = {
                "warehouse_id": wh_id,
                "warehouse_code": matched_wh.get("code") or matched_wh.get("name"),
                "warehouse_name": matched_wh.get("name"),
                "location_id": matched_loc["_id"],
                "location_code": matched_loc["code"],
                "location_path": matched_loc.get("path") or matched_loc["code"],
                "zone": matched_loc.get("zone") or (zone_val or None),
                "aisle": matched_loc.get("aisle") or (aisle_val or None),
                "rack": matched_loc.get("rack") or (rack_val or None),
                "shelf": matched_loc.get("shelf") or (shelf_val or None),
                "bin": matched_loc.get("bin") or (bin_val or None),
                "storage_type": storage_type_val or matched_loc.get("type"),
                "is_primary": True,
            }

        if sku in validated_by_sku:
            # Multi-warehouse preferred location for the same SKU in the same import batch
            if preferred_loc_payload:
                existing_item = validated_by_sku[sku]
                existing_locs = existing_item["preferred_locations_list"]
                if not any(pl["warehouse_id"] == preferred_loc_payload["warehouse_id"] for pl in existing_locs):
                    existing_locs.append(preferred_loc_payload)
            continue

        item_row = {
            "row_index": row_idx,
            "sku": sku,
            "name": name,
            "barcode": barcode,
            "category": (r.get("category") or "").strip() or None,
            "item_type": (r.get("item_type") or "stocked_material").strip(),
            "base_uom": (r.get("base_uom") or "EA").strip().upper(),
            "tracking_mode": tracking_mode,
            "expiry_tracked": bool(r.get("expiry_tracked")),
            "cost": cost_dec,
            "reorder_point": reorder_dec,
            "status": "archived" if r.get("status") == "archived" else "active",
            "description": (r.get("description") or "").strip() or None,
            "preferred_locations_list": [preferred_loc_payload] if preferred_loc_payload else [],
        }
        validated_by_sku[sku] = item_row
        validated_rows.append(item_row)

    if not validated_rows:
        return BulkImportResponse(
            total_rows=len(raw_rows),
            created_count=0,
            updated_count=0,
            skipped_count=0,
            error_count=len(errors),
            errors=errors,
        )

    # Check existing items in database
    skus_to_check = [vr["sku"] for vr in validated_rows]
    existing_items_cursor = database.items.find(
        {"company_id": context.company["_id"], "client_id": client_id, "sku": {"$in": skus_to_check}},
        {"_id": 1, "sku": 1, "tracking_mode": 1, "preferred_locations": 1},
    )
    existing_by_sku = {doc["sku"]: doc async for doc in existing_items_cursor}

    now = utcnow()
    operations = []
    created_count = 0
    updated_count = 0
    skipped_count = 0

    for vr in validated_rows:
        sku = vr["sku"]
        existing = existing_by_sku.get(sku)

        if existing:
            if payload.mode == "create_only":
                skipped_count += 1
                continue
            update_fields: dict[str, Any] = {
                "name": vr["name"],
                "barcode": vr["barcode"],
                "description": vr["description"],
                "category": vr["category"],
                "base_uom": vr["base_uom"],
                "expiry_tracked": vr["expiry_tracked"],
                "status": vr["status"],
                "updated_at": now,
            }
            if vr["cost"] is not None and include_cost:
                update_fields["cost"] = to_decimal128(vr["cost"])
            if vr["reorder_point"] is not None:
                update_fields["reorder_point"] = to_decimal128(vr["reorder_point"])
            if vr.get("preferred_locations_list"):
                existing_locs = existing.get("preferred_locations") or []
                new_wh_ids = {pl["warehouse_id"] for pl in vr["preferred_locations_list"]}
                # Preserve preferred locations in other warehouses, update/add for incoming warehouses
                updated_locs = [pl for pl in existing_locs if pl.get("warehouse_id") not in new_wh_ids]
                updated_locs.extend(vr["preferred_locations_list"])
                update_fields["preferred_locations"] = updated_locs

            operations.append(
                UpdateOne(
                    {"_id": existing["_id"], "company_id": context.company["_id"]},
                    {"$set": update_fields},
                )
            )
            updated_count += 1
        else:
            new_doc = {
                "_id": new_id(),
                "company_id": context.company["_id"],
                "client_id": client_id,
                "sku": sku,
                "name": vr["name"],
                "barcode": vr["barcode"],
                "description": vr["description"],
                "category": vr["category"],
                "item_type": vr["item_type"],
                "base_uom": vr["base_uom"],
                "tracking_mode": vr["tracking_mode"],
                "expiry_tracked": vr["expiry_tracked"],
                "cost": to_decimal128(vr["cost"]) if (vr["cost"] is not None and include_cost) else None,
                "reorder_point": to_decimal128(vr["reorder_point"]) if vr["reorder_point"] is not None else None,
                "status": vr["status"],
                "preferred_locations": vr.get("preferred_locations_list") or [],
                "created_at": now,
                "updated_at": now,
                "created_by": context.user["_id"],
            }
            operations.append(InsertOne(new_doc))
            created_count += 1

    if operations:
        try:
            await database.items.bulk_write(operations, ordered=False)
        except DuplicateKeyError as exc:
            raise APIError(409, "duplicate_barcode", f"A barcode conflict occurred during bulk import: {exc}")

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="items.bulk_imported",
        entity="item",
        entity_id=context.company["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={
            "mode": payload.mode,
            "total_rows": len(raw_rows),
            "created": created_count,
            "updated": updated_count,
            "skipped": skipped_count,
        },
    )

    return BulkImportResponse(
        total_rows=len(raw_rows),
        created_count=created_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        error_count=len(errors),
        errors=errors,
    )


@router.get("/{item_id}/suppliers", response_model=ItemSupplierListResponse)
async def list_item_suppliers(
    item_id: str,
    context: ContextDep,
    database: DbDep,
    include_inactive: bool = True,
) -> ItemSupplierListResponse:
    context.require("inventory.read")
    await get_item_document(database, context, item_id)
    query: dict[str, Any] = {
        "company_id": context.company["_id"],
        "item_id": item_id,
    }
    if not include_inactive:
        query["status"] = "active"
    mappings = (
        await database.supplier_item_mappings.find(query)
        .sort([("is_preferred", -1), ("created_at", 1)])
        .to_list(length=200)
    )
    supplier_ids = list({mapping["client_id"] for mapping in mappings})
    suppliers = (
        await database.clients.find(
            {"company_id": context.company["_id"], "_id": {"$in": supplier_ids}}
        ).to_list(length=len(supplier_ids))
        if supplier_ids
        else []
    )
    by_id = {supplier["_id"]: supplier for supplier in suppliers}
    include_cost = _can_read_cost(context)
    return ItemSupplierListResponse(
        item_id=item_id,
        suppliers=[
            item_supplier_out(mapping, by_id.get(mapping["client_id"]), include_cost)
            for mapping in mappings
        ],
    )


@router.post(
    "/{item_id}/suppliers",
    response_model=ItemSupplierOut,
    status_code=status.HTTP_201_CREATED,
)
async def link_item_supplier(
    item_id: str,
    payload: ItemSupplierCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> ItemSupplierOut:
    context.require("inventory.write")
    if payload.purchase_price is not None:
        context.require("cost.read")
    await get_item_document(database, context, item_id)
    supplier = await get_supplier_document(
        database, context.company["_id"], payload.supplier_id
    )
    now = utcnow()
    document = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "item_id": item_id,
        "client_id": payload.supplier_id,
        "supplier_sku": payload.supplier_sku,
        "purchase_price": mapping_cost_value(payload.purchase_price),
        "currency": payload.currency or context.company.get("currency", "USD"),
        "lead_time_days": payload.lead_time_days,
        "min_order_qty": mapping_cost_value(payload.min_order_qty),
        "is_preferred": payload.is_preferred and payload.status == "active",
        "status": payload.status,
        "created_at": now,
        "updated_at": now,
        "created_by": context.user["_id"],
    }

    async def persist(session: Any) -> None:
        if document["is_preferred"]:
            await clear_preferred_for_item(
                database,
                context.company["_id"],
                item_id,
                now,
                session=session,
            )
        await database.supplier_item_mappings.insert_one(document, session=session)

    try:
        async with database.client.start_session() as session:
            await session.with_transaction(persist)
    except DuplicateKeyError as exc:
        if "preferred" in str(exc).lower():
            raise APIError(
                409,
                "preferred_supplier_conflict",
                "Another supplier is already preferred for this item. Retry the request.",
                retryable=True,
            ) from exc
        raise APIError(
            409,
            "supplier_item_link_exists",
            "This supplier is already linked to the item.",
            {"supplier_id": "This supplier is already linked to the item."},
        ) from exc

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="item.supplier_linked",
        entity="supplier_item_mapping",
        entity_id=document["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={
            "item_id": item_id,
            "supplier_id": payload.supplier_id,
            "supplier_sku": payload.supplier_sku,
            "is_preferred": document["is_preferred"],
            "status": payload.status,
        },
    )
    return item_supplier_out(document, supplier, _can_read_cost(context))


@router.patch("/{item_id}/suppliers/{mapping_id}", response_model=ItemSupplierOut)
async def update_item_supplier(
    item_id: str,
    mapping_id: str,
    payload: ItemSupplierUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> ItemSupplierOut:
    context.require("inventory.write")
    await get_item_document(database, context, item_id)
    mapping = await get_mapping_document(
        database, context.company["_id"], item_id, mapping_id
    )
    supplier = await get_supplier_document(
        database,
        context.company["_id"],
        mapping["client_id"],
        require_active=False,
    )
    changes = payload.model_dump(exclude_unset=True)
    if "purchase_price" in changes:
        context.require("cost.read")
    if "supplier_sku" in changes and changes["supplier_sku"] is None:
        raise APIError(
            422,
            "invalid_supplier_sku",
            "Supplier SKU cannot be empty.",
            {"supplier_sku": "Supplier SKU is required."},
        )

    final_status = changes.get("status", mapping.get("status", "active"))
    final_preferred = changes.get("is_preferred", mapping.get("is_preferred", False))
    if final_status != "active":
        final_preferred = False
        changes["is_preferred"] = False
    if final_preferred and supplier.get("status") != "active":
        raise APIError(
            422,
            "supplier_inactive",
            "An inactive supplier cannot be preferred for an item.",
        )
    if supplier.get("status") != "active" and not (
        set(changes).issubset({"status", "is_preferred"}) and final_status == "inactive"
    ):
        raise APIError(
            422,
            "supplier_inactive",
            "This supplier is inactive. The existing link can only be deactivated or removed.",
        )

    if "purchase_price" in changes:
        changes["purchase_price"] = mapping_cost_value(changes["purchase_price"])
    if "min_order_qty" in changes:
        changes["min_order_qty"] = mapping_cost_value(changes["min_order_qty"])
    changes["updated_at"] = utcnow()

    async def persist(session: Any) -> None:
        if final_preferred:
            await clear_other_preferred(
                database,
                context.company["_id"],
                item_id,
                mapping_id,
                changes["updated_at"],
                session=session,
            )
        await database.supplier_item_mappings.update_one(
            {
                "_id": mapping_id,
                "company_id": context.company["_id"],
                "item_id": item_id,
            },
            {"$set": changes},
            session=session,
        )

    try:
        async with database.client.start_session() as session:
            await session.with_transaction(persist)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "preferred_supplier_conflict",
            "Another supplier is already preferred for this item. Retry the request.",
            retryable=True,
        ) from exc

    updated = await get_mapping_document(
        database, context.company["_id"], item_id, mapping_id
    )
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="item.supplier_updated",
        entity="supplier_item_mapping",
        entity_id=mapping_id,
        request_id=getattr(request.state, "request_id", None),
        before={
            "supplier_sku": mapping.get("supplier_sku"),
            "purchase_price": str(mapping["purchase_price"])
            if mapping.get("purchase_price") is not None
            else None,
            "is_preferred": mapping.get("is_preferred", False),
            "status": mapping.get("status", "active"),
        },
        after={
            "supplier_sku": updated.get("supplier_sku"),
            "purchase_price": str(updated["purchase_price"])
            if updated.get("purchase_price") is not None
            else None,
            "is_preferred": updated.get("is_preferred", False),
            "status": updated.get("status", "active"),
        },
    )
    return item_supplier_out(updated, supplier, _can_read_cost(context))


@router.delete(
    "/{item_id}/suppliers/{mapping_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unlink_item_supplier(
    item_id: str,
    mapping_id: str,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> Response:
    context.require("inventory.write")
    await get_item_document(database, context, item_id)
    mapping = await get_mapping_document(
        database, context.company["_id"], item_id, mapping_id
    )
    await database.supplier_item_mappings.delete_one(
        {
            "_id": mapping_id,
            "company_id": context.company["_id"],
            "item_id": item_id,
        }
    )
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="item.supplier_unlinked",
        entity="supplier_item_mapping",
        entity_id=mapping_id,
        request_id=getattr(request.state, "request_id", None),
        before={
            "item_id": item_id,
            "supplier_id": mapping.get("client_id"),
            "supplier_sku": mapping.get("supplier_sku"),
            "is_preferred": mapping.get("is_preferred", False),
            "status": mapping.get("status", "active"),
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{item_id}", response_model=ItemOut)
async def get_item(item_id: str, context: ContextDep, database: DbDep) -> ItemOut:
    context.require("inventory.read")
    document = await get_item_document(database, context, item_id)
    summaries = await supplier_summaries(
        database, context.company["_id"], [document["_id"]]
    )
    return item_out(
        document,
        include_cost=_can_read_cost(context),
        **summaries.get(document["_id"], {}),
    )


@router.patch("/{item_id}", response_model=ItemOut)
async def update_item(
    item_id: str,
    payload: ItemUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> ItemOut:
    context.require("inventory.write")
    if "cost" in payload.model_fields_set:
        context.require("cost.read")
    existing = await database.items.find_one({"_id": item_id, "company_id": context.company["_id"]})
    if existing is None:
        raise APIError(404, "item_not_found", "The item was not found.")
    await ensure_client_access(database, context, existing.get("client_id"))
    changes = payload.model_dump(exclude_unset=True)
    if payload.preferred_locations is not None:
        validated_pref_locs: list[dict[str, Any]] = []
        for pl in payload.preferred_locations:
            wh = await database.warehouses.find_one({
                "_id": pl.warehouse_id,
                "company_id": context.company["_id"],
                "status": {"$ne": "archived"},
            })
            if not wh:
                raise APIError(422, "invalid_warehouse", f"Warehouse '{pl.warehouse_id}' not found or archived.")
            loc = await database.locations.find_one({
                "_id": pl.location_id,
                "warehouse_id": pl.warehouse_id,
                "company_id": context.company["_id"],
                "status": {"$ne": "archived"},
            })
            if not loc:
                raise APIError(422, "invalid_location", f"Location '{pl.location_id}' not found in warehouse.")
            validated_pref_locs.append({
                "warehouse_id": wh["_id"],
                "warehouse_code": wh.get("code") or wh.get("name"),
                "warehouse_name": wh.get("name"),
                "location_id": loc["_id"],
                "location_code": loc["code"],
                "location_path": loc.get("path") or loc["code"],
                "zone": loc.get("zone") or pl.zone,
                "aisle": loc.get("aisle") or pl.aisle,
                "rack": loc.get("rack") or pl.rack,
                "shelf": loc.get("shelf") or pl.shelf,
                "bin": loc.get("bin") or pl.bin,
                "storage_type": pl.storage_type or loc.get("type"),
                "is_primary": pl.is_primary,
            })
        changes["preferred_locations"] = validated_pref_locs
    for decimal_field in ("cost", "reorder_point"):
        if decimal_field in changes:
            changes[decimal_field] = (
                to_decimal128(changes[decimal_field])
                if changes[decimal_field] is not None
                else None
            )
    changes["updated_at"] = utcnow()
    try:
        await database.items.update_one(
            {"_id": item_id, "company_id": context.company["_id"]},
            {"$set": changes},
        )
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "duplicate_barcode",
            "An item with this barcode already exists for this client.",
            {"barcode": "Barcode must be unique within the client."},
        ) from exc
    updated = await database.items.find_one({"_id": item_id, "company_id": context.company["_id"]})
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="item.updated",
        entity="item",
        entity_id=item_id,
        request_id=getattr(request.state, "request_id", None),
        before={
            "name": existing.get("name"),
            "barcode": existing.get("barcode"),
            "status": existing.get("status"),
        },
        after={key: value for key, value in changes.items() if key != "updated_at"},
    )
    return item_out(updated, include_cost=_can_read_cost(context))
