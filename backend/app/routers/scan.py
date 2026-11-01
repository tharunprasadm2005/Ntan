from typing import Any

from fastapi import APIRouter

from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..permissions import has_permission
from ..schemas import ScanResolveRequest, ScanResolveResponse
from ..serializers import item_out, location_out, lot_out, serial_out
from ..services.clients import apply_client_scope

router = APIRouter(prefix="/scan", tags=["scan"])


def _client_required() -> APIError:
    return APIError(
        422,
        "client_required",
        "This code matches records for multiple clients. Select a client.",
        {"client_id": "A client is required."},
    )


def _item_scope(query: dict[str, Any], context: ContextDep, client_id: str | None) -> None:
    if client_id:
        query["client_id"] = client_id
    apply_client_scope(query, context.client_scope)


@router.post("/resolve", response_model=ScanResolveResponse)
async def resolve_scan(
    payload: ScanResolveRequest,
    context: ContextDep,
    database: DbDep,
) -> ScanResolveResponse:
    context.require("inventory.read")
    company_id = context.company["_id"]
    code = payload.code.strip()

    item_query: dict[str, Any] = {
        "company_id": company_id,
        "$or": [{"sku": code.upper()}, {"barcode": code}],
    }
    _item_scope(item_query, context, payload.client_id)
    items = await database.items.find(item_query).limit(2).to_list(length=2)
    if len(items) > 1:
        raise _client_required()
    if items:
        item = items[0]
        return ScanResolveResponse(
            type="item",
            code=code,
            item=item_out(
                item,
                include_cost=has_permission(context.permissions, "cost.read"),
            ),
        )

    location_query: dict[str, Any] = {
        "company_id": company_id,
        "$or": [{"code": code.upper()}, {"barcode": code}],
    }
    if context.location_scope is not None:
        location_query["_id"] = {"$in": sorted(context.location_scope)}
    locations = (
        await database.locations.find(location_query)
        .sort([("warehouse_id", 1), ("code", 1)])
        .limit(2)
        .to_list(length=2)
    )
    if len(locations) > 1:
        raise APIError(
            422,
            "ambiguous_location",
            "This code matches more than one location. Use the location barcode.",
            {"code": "Use a unique location barcode."},
        )
    if locations:
        return ScanResolveResponse(
            type="location",
            code=code,
            location=location_out(locations[0]),
        )

    lot_query: dict[str, Any] = {
        "company_id": company_id,
        "lot_no": code,
    }
    if payload.client_id:
        lot_query["client_id"] = payload.client_id
    apply_client_scope(lot_query, context.client_scope)
    lots = await database.lots.find(lot_query).limit(2).to_list(length=2)
    if len(lots) > 1:
        raise _client_required()
    if lots:
        lot = lots[0]
        item = await database.items.find_one(
            {
                "_id": lot["item_id"],
                "company_id": company_id,
            }
        )
        if item is None:
            raise APIError(404, "scan_not_found", "The scanned lot item was not found.")
        return ScanResolveResponse(
            type="lot",
            code=code,
            item=item_out(
                item,
                include_cost=has_permission(context.permissions, "cost.read"),
            ),
            lot=lot_out(lot),
        )

    serial_query: dict[str, Any] = {
        "company_id": company_id,
        "serial_no": code,
    }
    if payload.client_id:
        serial_query["client_id"] = payload.client_id
    apply_client_scope(serial_query, context.client_scope)
    serials = await database.serials.find(serial_query).limit(2).to_list(length=2)
    if len(serials) > 1:
        raise _client_required()
    if serials:
        serial = serials[0]
        item = await database.items.find_one(
            {
                "_id": serial["item_id"],
                "company_id": company_id,
            }
        )
        if item is None:
            raise APIError(404, "scan_not_found", "The scanned serial item was not found.")
        return ScanResolveResponse(
            type="serial",
            code=code,
            item=item_out(
                item,
                include_cost=has_permission(context.permissions, "cost.read"),
            ),
            serial=serial_out(serial),
        )

    raise APIError(
        404,
        "scan_not_found",
        f"No item, location, lot or serial matches {code}.",
        {"code": "Check the code or choose the right client."},
    )
