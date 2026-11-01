from typing import Annotated, Any

from fastapi import APIRouter, Query
from pymongo.errors import DuplicateKeyError

from ..dependencies import ContextDep, DbDep
from ..schemas import (
    SyncEventOut,
    SyncOperationResult,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
)
from ..serializers import sync_event_out
from ..services.sync import append_sync_event, latest_sequence
from ..utils import utcnow

router = APIRouter(prefix="/sync", tags=["sync"])

SUPPORTED_OPERATIONS = frozenset({"sync.heartbeat"})


@router.post("/push", response_model=SyncPushResponse)
async def push(
    payload: SyncPushRequest,
    context: ContextDep,
    database: DbDep,
) -> SyncPushResponse:
    context.require("sync.write")
    company_id = context.company["_id"]
    now = utcnow()
    results: list[SyncOperationResult] = []

    for operation in payload.operations:
        existing = await database.sync_operations.find_one(
            {"company_id": company_id, "operation_id": operation.operation_id}
        )
        if existing is not None:
            results.append(
                SyncOperationResult(
                    operation_id=operation.operation_id,
                    status="duplicate",
                    event_sequence=existing.get("event_sequence"),
                    error_code=existing.get("error_code"),
                    message=existing.get("message"),
                )
            )
            continue

        status = "applied"
        event_sequence = None
        error_code = None
        message = None
        if operation.type in SUPPORTED_OPERATIONS:
            event_sequence = await append_sync_event(
                database,
                company_id,
                entity_type="sync",
                entity_id=operation.operation_id,
                action=operation.type,
                client_id=operation.client_id,
                payload=operation.payload,
                occurred_at=operation.occurred_at,
            )
        else:
            status = "rejected"
            error_code = "unsupported_sync_operation"
            message = "This operation type is not supported yet."

        try:
            await database.sync_operations.insert_one(
                {
                    "_id": f"{company_id}:{operation.operation_id}",
                    "company_id": company_id,
                    "operation_id": operation.operation_id,
                    "type": operation.type,
                    "status": status,
                    "event_sequence": event_sequence,
                    "error_code": error_code,
                    "message": message,
                    "device_id": payload.device_id,
                    "created_at": now,
                }
            )
        except DuplicateKeyError:
            existing = await database.sync_operations.find_one(
                {"company_id": company_id, "operation_id": operation.operation_id}
            )
            if existing is not None:
                results.append(
                    SyncOperationResult(
                        operation_id=operation.operation_id,
                        status="duplicate",
                        event_sequence=existing.get("event_sequence"),
                        error_code=existing.get("error_code"),
                        message=existing.get("message"),
                    )
                )
                continue

        results.append(
            SyncOperationResult(
                operation_id=operation.operation_id,
                status=status,
                event_sequence=event_sequence,
                error_code=error_code,
                message=message,
            )
        )

    return SyncPushResponse(
        results=results,
        latest_sequence=await latest_sequence(database, company_id),
        server_time=utcnow(),
    )


@router.get("/pull", response_model=SyncPullResponse)
async def pull(
    context: ContextDep,
    database: DbDep,
    after: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> SyncPullResponse:
    context.require("inventory.read")
    company_id = context.company["_id"]
    query: dict[str, Any] = {
        "company_id": company_id,
        "sequence": {"$gt": after},
    }
    if context.client_scope is not None:
        query["client_id"] = {"$in": sorted(context.client_scope)}
    documents = (
        await database.sync_events.find(query)
        .sort([("sequence", 1)])
        .limit(limit)
        .to_list(length=limit)
    )
    events: list[SyncEventOut] = [sync_event_out(document) for document in documents]
    next_cursor = documents[-1]["sequence"] if documents else after
    latest = await latest_sequence(database, company_id)
    return SyncPullResponse(
        events=events,
        next_cursor=next_cursor,
        latest_sequence=latest,
        has_more=len(documents) == limit and next_cursor < latest,
    )
