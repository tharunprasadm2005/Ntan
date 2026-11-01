from datetime import timedelta

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from .errors import APIError
from .utils import utcnow


async def enforce_rate_limit(
    database: AsyncDatabase,
    *,
    key: str,
    limit: int,
    window_seconds: int,
) -> None:
    now = utcnow()
    current = await database.rate_limits.find_one({"_id": key, "expires_at": {"$gt": now}})
    if current is not None and int(current.get("count", 0)) >= limit:
        retry_after = max(1, int((current["expires_at"] - now).total_seconds()))
        raise APIError(
            429,
            "rate_limited",
            f"Too many attempts. Try again in {retry_after} seconds.",
            retryable=True,
        )
    updated = await database.rate_limits.find_one_and_update(
        {"_id": key, "expires_at": {"$gt": now}},
        {"$inc": {"count": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        await database.rate_limits.update_one(
            {"_id": key},
            {
                "$set": {
                    "count": 1,
                    "window_started_at": now,
                    "expires_at": now + timedelta(seconds=window_seconds),
                }
            },
            upsert=True,
        )


async def clear_rate_limit(database: AsyncDatabase, key: str) -> None:
    await database.rate_limits.delete_one({"_id": key})
