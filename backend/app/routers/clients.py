import io
import re
from typing import Any

from fastapi import APIRouter, File, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..permissions import has_permission
from ..schemas import (
    ClientCreate,
    ClientListResponse,
    ClientOut,
    ClientUpdate,
    PartnerAddress,
    PartnerImportConfirmRequest,
    PartnerImportConfirmResponse,
    PartnerImportPreviewResponse,
    PartnerImportRow,
    SupplierItemListResponse,
)
from ..serializers import client_out, supplier_item_out
from ..services.clients import apply_client_scope
from ..services.excel_import import (
    export_partners_excel,
    generate_partner_excel_template,
    parse_partner_import_file,
)
from ..services.supplier_items import (
    get_supplier_document,
    supplier_delivery_stats,
)
from ..utils import new_id, utcnow

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("", response_model=ClientListResponse)
async def list_clients(
    context: ContextDep,
    database: DbDep,
    type: str | None = None,
    search: str | None = None,
    include_archived: bool = False,
) -> ClientListResponse:
    context.require("clients.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    norm_type = type.strip().lower() if type else None

    if context.client_scope is not None:
        if norm_type == "supplier":
            # Suppliers are company-wide purchasing partners and are deliberately
            # not constrained by inventory-owner access scope.
            pass
        elif norm_type:
            query["_id"] = {"$in": sorted(context.client_scope)}
        else:
            query["$or"] = [
                {"_id": {"$in": sorted(context.client_scope)}},
                {"types": "supplier"},
            ]

    if not include_archived:
        query["status"] = "active"

    if type:
        if norm_type == "3pl_client":
            query["$or"] = [
                {"types": "3pl_client"},
                {"types": {"$exists": False}},
                {"is_internal": True},
            ]
        else:
            query["types"] = norm_type

    if search:
        s = search.strip()
        escaped = re.escape(s)
        search_or = [
            {"name": {"$regex": escaped, "$options": "i"}},
            {"code": {"$regex": escaped, "$options": "i"}},
            {"display_name": {"$regex": escaped, "$options": "i"}},
            {"contact_name": {"$regex": escaped, "$options": "i"}},
            {"contact_phone": {"$regex": escaped, "$options": "i"}},
            {"contacts.name": {"$regex": escaped, "$options": "i"}},
            {"contacts.phone": {"$regex": escaped, "$options": "i"}},
            {"tax_id": {"$regex": escaped, "$options": "i"}},
        ]
        if "$or" in query:
            query = {"$and": [query, {"$or": search_or}]}
        else:
            query["$or"] = search_or

    documents = (
        await database.clients.find(query)
        .sort([("is_internal", -1), ("name", 1)])
        .to_list(length=1000)
    )
    return ClientListResponse(clients=[client_out(document) for document in documents])


@router.get("/import/template")
async def download_import_template(
    context: ContextDep,
) -> StreamingResponse:
    context.require("clients.manage")
    company_name = context.company.get("name", "NTAN Inventory")
    inventory_model = context.company.get("inventory_model", "internal")
    excel_bytes = generate_partner_excel_template(
        company_name=company_name,
        inventory_model=inventory_model,
    )
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=NTAN_Business_Partners_Template.xlsx"},
    )


@router.get("/export")
async def export_partners(
    context: ContextDep,
    database: DbDep,
) -> StreamingResponse:
    context.require("clients.read")
    company_id = context.company["_id"]
    company_name = context.company.get("name", "NTAN Inventory")

    query: dict[str, Any] = {"company_id": company_id}
    if context.client_scope is not None:
        # Suppliers are company-wide purchasing partners and are visible
        # regardless of inventory-owner scope, matching the list endpoint.
        query["$or"] = [
            {"_id": {"$in": sorted(context.client_scope)}},
            {"types": "supplier"},
        ]

    documents = (
        await database.clients.find(query)
        .sort([("is_internal", -1), ("name", 1)])
        .to_list(length=2000)
    )
    excel_bytes = export_partners_excel(company_name, documents)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=NTAN_Business_Partners_Export.xlsx"},
    )


@router.post("/import/preview", response_model=PartnerImportPreviewResponse)
async def preview_partner_import(
    context: ContextDep,
    database: DbDep,
    file: UploadFile = File(...),
) -> PartnerImportPreviewResponse:
    context.require("clients.manage")
    company_id = context.company["_id"]
    inventory_model = context.company.get("inventory_model", "internal")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise APIError(413, "file_too_large", "Import file size exceeds 10MB limit.")

    parsed_rows, parse_errors = parse_partner_import_file(file.filename or "upload.xlsx", content)
    if parse_errors:
        raise APIError(422, "import_file_invalid", parse_errors[0])
    if not parsed_rows:
        raise APIError(422, "empty_file", "The spreadsheet contains no data rows.")
    if len(parsed_rows) > 500:
        raise APIError(422, "row_limit_exceeded", "Maximum 500 rows allowed per import.")

    existing_docs = await database.clients.find({"company_id": company_id}).to_list(length=2000)
    existing_by_code: dict[str, dict[str, Any]] = {
        doc["code"].upper(): doc for doc in existing_docs if doc.get("code")
    }

    seen_codes_in_file: set[str] = set()
    rows_preview: list[PartnerImportRow] = []

    valid_count = 0
    invalid_count = 0
    duplicate_count = 0
    warnings_count = 0

    valid_type_set = {"supplier", "customer", "3pl_client"}

    for r in parsed_rows:
        row_idx = r.get("row_number") or r.get("row_index") or 0
        raw_code = (r.get("code") or "").strip().upper()
        raw_name = (r.get("name") or "").strip()
        display_name = (r.get("display_name") or "").strip() or None
        contact_name = (r.get("contact_name") or "").strip() or None
        contact_email = (r.get("contact_email") or "").strip().lower() or None
        contact_phone = (r.get("contact_phone") or "").strip() or None
        tax_id = (r.get("tax_id") or "").strip().upper() or None
        notes = (r.get("notes") or "").strip() or None

        raw_types = r.get("parsed_types", ["supplier"])
        cleaned_types = [t for t in raw_types if t in valid_type_set]
        if not cleaned_types:
            cleaned_types = ["supplier"]

        # Build billing address
        b_line1 = (r.get("billing_line1") or "").strip()
        b_city = (r.get("billing_city") or "").strip()
        billing_addr = None
        if b_line1 or b_city:
            billing_addr = PartnerAddress(
                name="Billing",
                line1=b_line1 or "Address Line 1",
                line2=(r.get("billing_line2") or "").strip() or None,
                city=b_city or "City",
                state=(r.get("billing_state") or "").strip() or None,
                postal_code=(r.get("billing_postal_code") or "").strip() or None,
                country=(r.get("billing_country") or "").strip() or "IN",
            )

        # Build shipping address
        s_line1 = (r.get("shipping_line1") or "").strip()
        s_city = (r.get("shipping_city") or "").strip()
        addresses_list = []
        if s_line1 or s_city:
            addresses_list.append(
                PartnerAddress(
                    name="Shipping",
                    line1=s_line1 or "Shipping Line 1",
                    city=s_city or "City",
                    country="IN",
                )
            )

        errors: list[str] = []
        warnings: list[str] = []
        is_duplicate = False
        existing_partner_id: str | None = None

        if not raw_code:
            errors.append("Partner code is required.")
        elif len(raw_code) > 64:
            errors.append("Partner code cannot exceed 64 characters.")

        if not raw_name:
            errors.append("Partner legal/business name is required.")

        # Check for 3PL requirement
        if "3pl_client" in cleaned_types and inventory_model == "internal":
            cleaned_types = [t for t in cleaned_types if t != "3pl_client"]
            if not cleaned_types:
                cleaned_types = ["customer"]
            warnings.append("Company is in internal inventory mode; 3PL client role adjusted to customer.")

        if contact_email and ("@" not in contact_email or "." not in contact_email):
            errors.append("Invalid email address format.")

        if tax_id and len(tax_id) == 15:
            if not re.match(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", tax_id):
                warnings.append("Tax ID is 15 characters but does not match standard Indian GSTIN format.")

        # Duplicate checking within file
        if raw_code in seen_codes_in_file:
            errors.append(f"Duplicate partner code '{raw_code}' within this file.")
        else:
            seen_codes_in_file.add(raw_code)

        # Duplicate checking against database
        if raw_code in existing_by_code:
            is_duplicate = True
            existing_doc = existing_by_code[raw_code]
            existing_partner_id = existing_doc["_id"]
            duplicate_count += 1
            warnings.append(f"Partner code '{raw_code}' already exists ({existing_doc['name']}). Will update or skip based on selection.")

        is_valid = len(errors) == 0
        if is_valid:
            valid_count += 1
            status_tag = "duplicate" if is_duplicate else "valid"
        else:
            invalid_count += 1
            status_tag = "invalid"

        warnings_count += len(warnings)

        rows_preview.append(
            PartnerImportRow(
                row_number=row_idx,
                code=raw_code,
                name=raw_name,
                display_name=display_name,
                types=cleaned_types,
                contact_name=contact_name,
                contact_email=contact_email,
                contact_phone=contact_phone,
                tax_id=tax_id,
                billing_address=billing_addr,
                addresses=addresses_list,
                notes=notes,
                status=status_tag,
                is_valid=is_valid,
                is_duplicate=is_duplicate,
                existing_partner_id=existing_partner_id,
                errors=errors,
                warnings=warnings,
            )
        )

    return PartnerImportPreviewResponse(
        total_rows=len(parsed_rows),
        valid_count=valid_count,
        invalid_count=invalid_count,
        duplicate_count=duplicate_count,
        warnings_count=warnings_count,
        rows=rows_preview,
    )


@router.post("/import/confirm", response_model=PartnerImportConfirmResponse)
async def confirm_partner_import(
    payload: PartnerImportConfirmRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> PartnerImportConfirmResponse:
    context.require("clients.manage")
    company_id = context.company["_id"]
    inventory_model = context.company.get("inventory_model", "internal")

    created_count = 0
    updated_count = 0
    skipped_count = 0
    failed_count = 0
    import_errors: list[str] = []

    now = utcnow()

    for item in payload.rows:
        if not item.is_valid:
            failed_count += 1
            continue

        if "3pl_client" in item.types and inventory_model == "internal":
            item.types = [t for t in item.types if t != "3pl_client"] or ["customer"]

        existing = await database.clients.find_one(
            {"company_id": company_id, "code": item.code.upper()}
        )

        billing_dict = item.billing_address.model_dump() if item.billing_address else None
        addresses_list = [a.model_dump() for a in item.addresses] if item.addresses else []

        if existing:
            if payload.duplicate_strategy == "skip":
                skipped_count += 1
                continue

            if existing.get("is_internal"):
                skipped_count += 1
                continue

            # Safe non-destructive update: only overwrite fields that have non-empty values in the spreadsheet
            update_data: dict[str, Any] = {"updated_at": now}
            if item.name:
                update_data["name"] = item.name
            if item.display_name:
                update_data["display_name"] = item.display_name
            if item.types:
                merged_types = list(dict.fromkeys(existing.get("types", []) + item.types))
                update_data["types"] = merged_types
            if item.contact_name:
                update_data["contact_name"] = item.contact_name
            if item.contact_email:
                update_data["contact_email"] = item.contact_email
            if item.contact_phone:
                update_data["contact_phone"] = item.contact_phone
            if item.tax_id:
                update_data["tax_id"] = item.tax_id
            if billing_dict:
                update_data["billing_address"] = billing_dict
            if addresses_list:
                update_data["addresses"] = addresses_list
            if item.notes:
                update_data["notes"] = item.notes

            await database.clients.update_one(
                {"_id": existing["_id"], "company_id": company_id},
                {"$set": update_data},
            )
            updated_count += 1
        else:
            # Create new partner
            doc = {
                "_id": new_id(),
                "company_id": company_id,
                "code": item.code.upper(),
                "name": item.name,
                "display_name": item.display_name,
                "types": item.types,
                "contact_name": item.contact_name,
                "contact_email": item.contact_email,
                "contact_phone": item.contact_phone,
                "tax_id": item.tax_id,
                "billing_address": billing_dict,
                "addresses": addresses_list,
                "notes": item.notes,
                "is_internal": False,
                "status": "active",
                "created_at": now,
                "updated_at": now,
                "created_by": context.user["_id"],
            }
            try:
                await database.clients.insert_one(doc)
                created_count += 1
            except DuplicateKeyError:
                skipped_count += 1

    await record_audit(
        database,
        company_id=company_id,
        actor_id=context.user["_id"],
        action="partner.bulk_imported",
        entity="partner",
        entity_id=company_id,
        request_id=getattr(request.state, "request_id", None),
        after={
            "created_count": created_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "failed_count": failed_count,
        },
    )

    return PartnerImportConfirmResponse(
        created_count=created_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        errors=import_errors,
    )


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
async def create_client(
    payload: ClientCreate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> ClientOut:
    context.require("clients.manage")
    types = payload.types or ["3pl_client"]

    # 3PL client check: if 3pl_client is among types, requires hybrid or 3pl
    if "3pl_client" in types and context.company.get("inventory_model", "internal") == "internal":
        raise APIError(
            409,
            "client_inventory_model_required",
            "Enable hybrid or 3PL inventory before adding 3PL clients.",
        )

    now = utcnow()
    billing_dict = payload.billing_address.model_dump() if payload.billing_address else None
    addresses_list = [a.model_dump() for a in payload.addresses] if payload.addresses else []
    contacts_list = [c.model_dump() for c in payload.contacts] if payload.contacts else []

    contact_name = payload.contact_name
    contact_email = str(payload.contact_email) if payload.contact_email else None
    contact_phone = payload.contact_phone
    if contacts_list and not contact_name:
        primary = next((c for c in contacts_list if c.get("is_primary")), contacts_list[0])
        contact_name = primary.get("name")
        contact_email = primary.get("email") or contact_email
        contact_phone = primary.get("phone") or contact_phone

    document = {
        "_id": new_id(),
        "company_id": context.company["_id"],
        "code": payload.code.upper(),
        "name": payload.name,
        "display_name": payload.display_name,
        "types": types,
        "contact_name": contact_name,
        "contact_email": contact_email,
        "contact_phone": contact_phone,
        "contacts": contacts_list,
        "tax_id": payload.tax_id,
        "billing_address": billing_dict,
        "addresses": addresses_list,
        "notes": payload.notes,
        "is_internal": False,
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "created_by": context.user["_id"],
    }
    try:
        await database.clients.insert_one(document)
    except DuplicateKeyError as exc:
        raise APIError(
            409,
            "duplicate_client_code",
            "A business partner with this code already exists.",
            {"code": "Partner code must be unique within the company."},
        ) from exc

    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="client.created",
        entity="client",
        entity_id=document["_id"],
        request_id=getattr(request.state, "request_id", None),
        after={"code": document["code"], "name": document["name"], "types": types},
    )
    return client_out(document)


@router.get("/{client_id}", response_model=ClientOut)
async def get_client(
    client_id: str,
    context: ContextDep,
    database: DbDep,
) -> ClientOut:
    context.require("clients.read")
    query: dict[str, Any] = {"_id": client_id, "company_id": context.company["_id"]}
    doc = await database.clients.find_one(query)
    if doc is None:
        raise APIError(404, "client_not_found", "The business partner was not found.")
    if (
        context.client_scope is not None
        and client_id not in context.client_scope
        and "supplier" not in (doc.get("types") or [])
    ):
        raise APIError(404, "client_not_found", "The business partner was not found.")
    return client_out(doc)


@router.get("/{client_id}/items", response_model=SupplierItemListResponse)
async def list_supplier_items(
    client_id: str,
    context: ContextDep,
    database: DbDep,
    include_inactive: bool = True,
) -> SupplierItemListResponse:
    context.require("clients.read")
    context.require("inventory.read")
    await get_supplier_document(
        database,
        context.company["_id"],
        client_id,
        require_active=False,
    )
    query: dict[str, Any] = {
        "company_id": context.company["_id"],
        "client_id": client_id,
    }
    if not include_inactive:
        query["status"] = "active"
    mappings = (
        await database.supplier_item_mappings.find(query)
        .sort([("is_preferred", -1), ("created_at", 1)])
        .to_list(length=500)
    )
    item_ids = [mapping["item_id"] for mapping in mappings]
    item_query: dict[str, Any] = {
        "company_id": context.company["_id"],
        "_id": {"$in": item_ids},
    }
    apply_client_scope(item_query, context.client_scope)
    items = (
        await database.items.find(item_query).to_list(length=len(item_ids))
        if item_ids
        else []
    )
    by_id = {item["_id"]: item for item in items}
    deliveries = await supplier_delivery_stats(
        database,
        context.company["_id"],
        client_id,
        list(by_id),
    )
    include_cost = has_permission(context.permissions, "cost.read")
    return SupplierItemListResponse(
        supplier_id=client_id,
        items=[
            supplier_item_out(
                mapping,
                by_id[mapping["item_id"]],
                include_cost,
                deliveries.get(mapping["item_id"]),
            )
            for mapping in mappings
            if mapping["item_id"] in by_id
        ],
    )


@router.patch("/{client_id}", response_model=ClientOut)
async def update_client(
    client_id: str,
    payload: ClientUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> ClientOut:
    context.require("clients.manage")
    existing = await database.clients.find_one(
        {"_id": client_id, "company_id": context.company["_id"]}
    )
    if existing is None:
        raise APIError(404, "client_not_found", "The business partner was not found.")

    if existing.get("is_internal") and payload.status == "archived":
        raise APIError(
            409,
            "internal_client_required",
            "The internal inventory client cannot be archived.",
        )

    changes = payload.model_dump(exclude_unset=True)

    if "types" in changes and changes["types"]:
        if "3pl_client" in changes["types"] and context.company.get("inventory_model", "internal") == "internal":
            raise APIError(
                409,
                "client_inventory_model_required",
                "Enable hybrid or 3PL inventory before adding the 3PL client role.",
            )

    if "contact_email" in changes and changes["contact_email"] is not None:
        changes["contact_email"] = str(changes["contact_email"])

    if "contacts" in changes and changes["contacts"] is not None:
        contacts_list = [c.model_dump() if hasattr(c, "model_dump") else c for c in changes["contacts"]]
        changes["contacts"] = contacts_list
        if contacts_list and not changes.get("contact_name"):
            primary = next((c for c in contacts_list if c.get("is_primary")), contacts_list[0])
            if primary.get("name"):
                changes["contact_name"] = primary.get("name")
            if primary.get("email"):
                changes["contact_email"] = primary.get("email")
            if primary.get("phone"):
                changes["contact_phone"] = primary.get("phone")

    changes["updated_at"] = utcnow()
    await database.clients.update_one(
        {"_id": client_id, "company_id": context.company["_id"]} ,
        {"$set": changes},
    )
    updated = await database.clients.find_one(
        {"_id": client_id, "company_id": context.company["_id"]}
    )
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="client.updated",
        entity="client",
        entity_id=client_id,
        request_id=getattr(request.state, "request_id", None),
        before={
            "name": existing.get("name"),
            "status": existing.get("status"),
            "types": existing.get("types"),
        },
        after={key: value for key, value in changes.items() if key != "updated_at"},
    )
    return client_out(updated)
