import re
from datetime import date, datetime, time
from typing import Annotated, Any

from fastapi import APIRouter, Query

from ..dependencies import ContextDep, DbDep
from ..schemas import LotListResponse, SerialListResponse
from ..serializers import lot_out, serial_out
from ..services.clients import apply_client_scope
from ..utils import decode_cursor, encode_cursor

router = APIRouter(tags=["traceability"])


def _apply_cursor(query: dict[str, Any], cursor: str | None) -> None:
    if not cursor:
        return
    timestamp, identifier = decode_cursor(cursor)
    query["$or"] = [
        {"created_at": {"$lt": timestamp}},
        {"created_at": timestamp, "_id": {"$lt": identifier}},
    ]


@router.get("/lots", response_model=LotListResponse)
async def list_lots(
    context: ContextDep,
    database: DbDep,
    item_id: str | None = None,
    client_id: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    expiry_before: date | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    cursor: str | None = None,
) -> LotListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if item_id:
        query["item_id"] = item_id
    if client_id:
        query["client_id"] = client_id
    if status_filter:
        query["status"] = status_filter
    if expiry_before:
        query["expiry_date"] = {"$lte": datetime.combine(expiry_before, time.min)}
    if q:
        term = re.escape(q.strip())
        query["$and"] = [
            {
                "$or": [
                    {"lot_no": {"$regex": term, "$options": "i"}},
                    {"sku": {"$regex": term, "$options": "i"}},
                    {"item_name": {"$regex": term, "$options": "i"}},
                ]
            }
        ]
    apply_client_scope(query, context.client_scope)
    _apply_cursor(query, cursor)
    documents = (
        await database.lots.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["created_at"], documents[-1]["_id"])
    return LotListResponse(
        lots=[lot_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/serials", response_model=SerialListResponse)
async def list_serials(
    context: ContextDep,
    database: DbDep,
    item_id: str | None = None,
    client_id: str | None = None,
    lot_id: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    cursor: str | None = None,
) -> SerialListResponse:
    context.require("inventory.read")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if item_id:
        query["item_id"] = item_id
    if client_id:
        query["client_id"] = client_id
    if lot_id:
        query["lot_id"] = lot_id
    if status_filter:
        query["status"] = status_filter
    if q:
        term = re.escape(q.strip())
        query["$and"] = [
            {
                "$or": [
                    {"serial_no": {"$regex": term, "$options": "i"}},
                    {"sku": {"$regex": term, "$options": "i"}},
                    {"item_name": {"$regex": term, "$options": "i"}},
                ]
            }
        ]
    apply_client_scope(query, context.client_scope)
    _apply_cursor(query, cursor)
    documents = (
        await database.serials.find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        next_cursor = encode_cursor(documents[-1]["created_at"], documents[-1]["_id"])
    return SerialListResponse(
        serials=[serial_out(document) for document in documents],
        next_cursor=next_cursor,
    )
