from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from .utils import new_id, utcnow


async def record_audit(
    database: AsyncDatabase,
    *,
    company_id: str,
    actor_id: str | None,
    action: str,
    entity: str,
    entity_id: str,
    request_id: str | None = None,
    device_id: str | None = None,
    reason: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    await database.audit_events.insert_one(
        {
            "_id": new_id(),
            "company_id": company_id,
            "actor_id": actor_id,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "request_id": request_id,
            "device_id": device_id,
            "reason": reason,
            "before": before,
            "after": after,
            "created_at": utcnow(),
        }
    )
