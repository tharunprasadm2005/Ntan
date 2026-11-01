from collections import Counter
from datetime import datetime
from typing import Any

from ..errors import APIError
from ..utils import to_decimal, to_decimal128
from .clients import ensure_client_access


async def get_item_document(
    database: Any,
    context: Any,
    item_id: str,
) -> dict[str, Any]:
    document = await database.items.find_one(
        {"_id": item_id, "company_id": context.company["_id"]}
    )
    if document is None:
        raise APIError(404, "item_not_found", "The item was not found.")
    await ensure_client_access(database, context, document.get("client_id"))
    return document


async def get_supplier_document(
    database: Any,
    company_id: str,
    supplier_id: str,
    *,
    require_active: bool = True,
) -> dict[str, Any]:
    supplier = await database.clients.find_one(
        {"_id": supplier_id, "company_id": company_id}
    )
    if supplier is None or "supplier" not in (supplier.get("types") or []):
        raise APIError(
            422,
            "invalid_supplier",
            "Select a supplier-type business partner.",
            {"supplier_id": "Select a supplier-type business partner."},
        )
    if require_active and supplier.get("status") != "active":
        raise APIError(
            422,
            "supplier_inactive",
            "The selected supplier is inactive or archived.",
            {"supplier_id": "Select an active supplier."},
        )
    return supplier


async def get_mapping_document(
    database: Any,
    company_id: str,
    item_id: str,
    mapping_id: str,
    *,
    session: Any = None,
) -> dict[str, Any]:
    mapping = await database.supplier_item_mappings.find_one(
        {
            "_id": mapping_id,
            "company_id": company_id,
            "item_id": item_id,
        },
        session=session,
    )
    if mapping is None:
        raise APIError(
            404,
            "supplier_item_mapping_not_found",
            "The supplier link was not found for this item.",
        )
    return mapping


async def clear_other_preferred(
    database: Any,
    company_id: str,
    item_id: str,
    mapping_id: str,
    now: datetime,
    *,
    session: Any = None,
) -> None:
    await database.supplier_item_mappings.update_many(
        {
            "company_id": company_id,
            "item_id": item_id,
            "_id": {"$ne": mapping_id},
            "is_preferred": True,
        },
        {"$set": {"is_preferred": False, "updated_at": now}},
        session=session,
    )


async def clear_preferred_for_item(
    database: Any,
    company_id: str,
    item_id: str,
    now: datetime,
    *,
    session: Any = None,
) -> None:
    await database.supplier_item_mappings.update_many(
        {
            "company_id": company_id,
            "item_id": item_id,
            "is_preferred": True,
        },
        {"$set": {"is_preferred": False, "updated_at": now}},
        session=session,
    )


async def supplier_summaries(
    database: Any,
    company_id: str,
    item_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Return active mapping counts and preferred supplier names keyed by item id."""
    if not item_ids:
        return {}
    mappings = (
        await database.supplier_item_mappings.find(
            {
                "company_id": company_id,
                "item_id": {"$in": item_ids},
                "status": "active",
            }
        )
        .to_list(length=len(item_ids) * 50)
    )
    if not mappings:
        return {}

    counts = Counter(mapping["item_id"] for mapping in mappings)
    preferred = {
        mapping["item_id"]: mapping["client_id"]
        for mapping in mappings
        if mapping.get("is_preferred")
    }
    supplier_names: dict[str, str] = {}
    if preferred:
        suppliers = await database.clients.find(
            {
                "company_id": company_id,
                "_id": {"$in": list(set(preferred.values()))},
            }
        ).to_list(length=len(preferred))
        supplier_names = {
            supplier["_id"]: supplier.get("display_name") or supplier.get("name") or "Supplier"
            for supplier in suppliers
        }

    return {
        item_id: {
            "supplier_count": count,
            "preferred_supplier_id": preferred.get(item_id),
            "preferred_supplier_name": supplier_names.get(preferred.get(item_id, "")),
        }
        for item_id, count in counts.items()
    }


async def supplier_sku_snapshot(
    database: Any,
    company_id: str,
    supplier_id: str | None,
    item_ids: list[str],
) -> dict[str, str]:
    """Snapshot the active supplier SKU for each item at document creation time.

    Historical receipts and purchase orders keep the value even if the mapping is
    later edited or archived, so no per-read mapping query is required.
    """
    if not supplier_id or not item_ids:
        return {}
    mappings = (
        await database.supplier_item_mappings.find(
            {
                "company_id": company_id,
                "client_id": supplier_id,
                "item_id": {"$in": item_ids},
                "status": "active",
            }
        )
        .to_list(length=len(item_ids))
    )
    return {
        mapping["item_id"]: mapping["supplier_sku"]
        for mapping in mappings
        if mapping.get("supplier_sku")
    }


async def supplier_options_for_items(
    database: Any,
    company_id: str,
    item_ids: list[str],
    *,
    include_cost: bool,
) -> dict[str, list[dict[str, Any]]]:
    """Return active supplier alternatives per item, preferred mapping first.

    Only active supplier-type partners are offered as options. Archived suppliers
    remain visible through historical receipts, never through reorder suggestions.
    """
    if not item_ids:
        return {}
    mappings = (
        await database.supplier_item_mappings.find(
            {
                "company_id": company_id,
                "item_id": {"$in": item_ids},
                "status": "active",
            }
        )
        .sort([("is_preferred", -1), ("supplier_sku", 1)])
        .to_list(length=len(item_ids) * 50)
    )
    if not mappings:
        return {}
    supplier_ids = list({mapping["client_id"] for mapping in mappings})
    suppliers = await database.clients.find(
        {
            "company_id": company_id,
            "_id": {"$in": supplier_ids},
            "status": "active",
            "types": "supplier",
        }
    ).to_list(length=len(supplier_ids))
    supplier_map = {supplier["_id"]: supplier for supplier in suppliers}
    options: dict[str, list[dict[str, Any]]] = {}
    for mapping in mappings:
        supplier = supplier_map.get(mapping["client_id"])
        if supplier is None:
            continue
        options.setdefault(mapping["item_id"], []).append(
            {
                "supplier_id": supplier["_id"],
                "supplier_name": supplier.get("display_name")
                or supplier.get("name")
                or "Supplier",
                "supplier_sku": mapping.get("supplier_sku"),
                "is_preferred": bool(mapping.get("is_preferred")),
                "purchase_price": to_decimal(mapping.get("purchase_price"))
                if include_cost and mapping.get("purchase_price") is not None
                else None,
                "currency": mapping.get("currency"),
                "lead_time_days": mapping.get("lead_time_days"),
                "min_order_qty": to_decimal(mapping.get("min_order_qty"))
                if mapping.get("min_order_qty") is not None
                else None,
            }
        )
    return options


async def supplier_delivery_stats(
    database: Any,
    company_id: str,
    supplier_id: str,
    item_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Aggregate committed (applied) receipt lines separately from approved mappings."""
    if not item_ids:
        return {}
    pipeline = [
        {
            "$match": {
                "company_id": company_id,
                "supplier_id": supplier_id,
                "status": "applied",
                "lines.item_id": {"$in": item_ids},
            }
        },
        {"$unwind": "$lines"},
        {"$match": {"lines.item_id": {"$in": item_ids}}},
        {"$sort": {"committed_at": 1, "created_at": 1}},
        {
            "$group": {
                "_id": "$lines.item_id",
                "last_delivery_at": {"$last": "$committed_at"},
                "last_receipt_id": {"$last": "$_id"},
                "last_receipt_number": {"$last": "$number"},
                "delivered_qty": {"$sum": "$lines.base_qty"},
                "receipt_ids": {"$addToSet": "$_id"},
            }
        },
        {
            "$project": {
                "last_delivery_at": 1,
                "last_receipt_id": 1,
                "last_receipt_number": 1,
                "delivered_qty": 1,
                "delivery_count": {"$size": "$receipt_ids"},
            }
        },
    ]
    cursor = await database.receipts.aggregate(pipeline)
    rows = await cursor.to_list(length=len(item_ids))
    return {
        row["_id"]: {
            "last_delivery_at": row.get("last_delivery_at"),
            "last_receipt_id": row.get("last_receipt_id"),
            "last_receipt_number": row.get("last_receipt_number"),
            "delivered_qty": row.get("delivered_qty", 0),
            "delivery_count": row.get("delivery_count", 0),
        }
        for row in rows
    }


def mapping_cost_value(value: Any) -> Any:
    return to_decimal128(value) if value is not None else None
