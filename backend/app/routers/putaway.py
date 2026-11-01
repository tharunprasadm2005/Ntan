import re
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request

from ..dependencies import ContextDep, DbDep
from ..errors import APIError
from ..schemas import (
    PutawayCompleteRequest,
    PutawayTaskListResponse,
    PutawayTaskOut,
)
from ..serializers import putaway_task_out
from ..services.clients import apply_client_scope
from ..services.putaway import complete_putaway_task
from ..utils import decode_cursor, encode_cursor

router = APIRouter(prefix="/putaway", tags=["putaway"])


def _apply_location_scope(
    query: dict[str, Any],
    location_scope: frozenset[str] | None,
    requested_location_id: str | None = None,
) -> None:
    if requested_location_id:
        if location_scope is None:
            query["from_location_id"] = requested_location_id
        else:
            query["from_location_id"] = {
                "$in": [requested_location_id] if requested_location_id in location_scope else []
            }
        return
    if location_scope is None:
        return
    query["from_location_id"] = {"$in": sorted(location_scope)}


@router.get("/tasks", response_model=PutawayTaskListResponse)
async def list_putaway_tasks(
    context: ContextDep,
    database: DbDep,
    status_filter: Annotated[str | None, Query(alias="status")] = "pending",
    receipt_id: str | None = None,
    client_id: str | None = None,
    warehouse_id: str | None = None,
    from_location_id: str | None = None,
    search: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    cursor: str | None = None,
    order: Annotated[str | None, Query(pattern="^(asc|desc)$")] = None,
) -> PutawayTaskListResponse:
    context.require_any("inventory.read", "stock.putaway")
    query: dict[str, Any] = {"company_id": context.company["_id"]}
    if status_filter:
        if status_filter in ("pending", "active"):
            query["status"] = {"$in": ["pending", "in_progress"]}
        else:
            query["status"] = status_filter
    if receipt_id:
        query["receipt_id"] = receipt_id
    if client_id:
        query["client_id"] = client_id
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope, from_location_id)

    filters: list[dict[str, Any]] = []
    if search and search.strip():
        pattern = re.escape(search.strip())
        item_ids = [
            document["_id"]
            for document in await database.items.find(
                {
                    "company_id": context.company["_id"],
                    "barcode": {"$regex": pattern, "$options": "i"},
                },
                {"_id": 1},
            )
            .limit(50)
            .to_list(length=50)
        ]
        search_filters: list[dict[str, Any]] = [
            {"receipt_number": {"$regex": pattern, "$options": "i"}},
            {"sku": {"$regex": pattern, "$options": "i"}},
            {"item_name": {"$regex": pattern, "$options": "i"}},
            {"supplier": {"$regex": pattern, "$options": "i"}},
            {"purchase_order": {"$regex": pattern, "$options": "i"}},
            {"from_location_code": {"$regex": pattern, "$options": "i"}},
            {"from_location_path": {"$regex": pattern, "$options": "i"}},
            {"to_location_code": {"$regex": pattern, "$options": "i"}},
            {"to_location_path": {"$regex": pattern, "$options": "i"}},
        ]
        if item_ids:
            search_filters.append({"item_id": {"$in": item_ids}})
        filters.append({"$or": search_filters})

    completed_view = status_filter == "completed"
    sort_field = "completed_at" if completed_view else "created_at"
    # Completed work reads newest-first by default; active queues stay oldest-first.
    descending = order == "desc" or (order is None and completed_view)
    direction = -1 if descending else 1
    if cursor:
        timestamp, identifier = decode_cursor(cursor)
        comparison = "$lt" if descending else "$gt"
        filters.append(
            {
                "$or": [
                    {sort_field: {comparison: timestamp}},
                    {sort_field: timestamp, "_id": {comparison: identifier}},
                ]
            }
        )
    if filters:
        query["$and"] = filters
    documents = (
        await database.putaway_tasks.find(query)
        .sort([(sort_field, direction), ("_id", direction)])
        .limit(limit)
        .to_list(length=limit)
    )
    next_cursor = None
    if len(documents) == limit:
        last = documents[-1]
        next_cursor = encode_cursor(last.get(sort_field) or last["created_at"], last["_id"])
    return PutawayTaskListResponse(
        tasks=[putaway_task_out(document) for document in documents],
        next_cursor=next_cursor,
    )


@router.get("/tasks/{task_id}", response_model=PutawayTaskOut)
async def get_putaway_task(
    task_id: str,
    context: ContextDep,
    database: DbDep,
) -> PutawayTaskOut:
    context.require_any("inventory.read", "stock.putaway")
    query: dict[str, Any] = {"_id": task_id, "company_id": context.company["_id"]}
    apply_client_scope(query, context.client_scope)
    _apply_location_scope(query, context.location_scope)
    document = await database.putaway_tasks.find_one(query)
    if document is None:
        raise APIError(404, "putaway_task_not_found", "The put-away task was not found.")
    return putaway_task_out(document)


@router.post("/tasks/{task_id}/complete", response_model=PutawayTaskOut)
async def complete_putaway(
    task_id: str,
    payload: PutawayCompleteRequest,
    request: Request,
    context: ContextDep,
    database: DbDep,
    device_id: Annotated[str | None, Header(alias="X-Device-ID", max_length=200)] = None,
    idempotency_key: Annotated[
        str | None, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ] = None,
) -> PutawayTaskOut:
    context.require("stock.putaway")
    task = await complete_putaway_task(
        database,
        task_id=task_id,
        destination_id=payload.location_id,
        company_id=context.company["_id"],
        client_scope=context.client_scope,
        location_scope=context.location_scope,
        actor_id=context.user["_id"],
        request_id=getattr(request.state, "request_id", None),
        device_id=device_id,
        quantity=payload.quantity,
        serial_ids=payload.serial_ids,
        idempotency_key=idempotency_key,
    )
    return putaway_task_out(task)
