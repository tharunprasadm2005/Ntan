from typing import Any

from pymongo import ReturnDocument

from ..utils import new_id, utcnow


async def append_sync_event(
    database: Any,
    company_id: str,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    client_id: str | None = None,
    payload: dict[str, Any] | None = None,
    occurred_at: Any = None,
    session: Any = None,
) -> int:
    now = utcnow()
    counter = await database.sync_counters.find_one_and_update(
        {"_id": company_id},
        {"$inc": {"sequence": 1}, "$set": {"updated_at": now}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    sequence = counter["sequence"]
    await database.sync_events.insert_one(
        {
            "_id": new_id(),
            "company_id": company_id,
            "sequence": sequence,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "action": action,
            "client_id": client_id,
            "payload": payload or {},
            "occurred_at": occurred_at or now,
        },
        session=session,
    )
    return sequence


async def latest_sequence(database: Any, company_id: str) -> int:
    counter = await database.sync_counters.find_one({"_id": company_id})
    return int(counter["sequence"]) if counter else 0
