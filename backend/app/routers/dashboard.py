from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter
from pymongo.asynchronous.database import AsyncDatabase

from ..dependencies import ContextDep, DbDep
from ..schemas import (
    DashboardReceivingQueueOut,
    DashboardSummaryOut,
    DashboardWindowOut,
)
from ..utils import to_decimal, utcnow

router = APIRouter(tags=["dashboard"])

ZERO = Decimal("0")


def _company_timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _day_start(now: datetime, zone: ZoneInfo) -> datetime:
    local = now.astimezone(zone)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def _scope_movements(query: dict[str, Any], location_scope: frozenset[str] | None) -> None:
    if location_scope is None:
        return
    scoped_ids = sorted(location_scope)
    query["$or"] = [
        {"from_location_id": {"$in": scoped_ids}},
        {"to_location_id": {"$in": scoped_ids}},
    ]


def _window(rows: list[dict[str, Any]]) -> DashboardWindowOut:
    inbound = ZERO
    outbound = ZERO
    movement_count = 0
    for row in rows:
        units = to_decimal(row.get("units"))
        if row["_id"].get("direction") == "in":
            inbound += units
        else:
            outbound += units
        movement_count += int(row.get("count", 0))
    return DashboardWindowOut(
        inbound_units=inbound,
        outbound_units=outbound,
        net_units=inbound - outbound,
        movement_count=movement_count,
    )


async def _movement_windows(
    database: AsyncDatabase,
    company_id: str,
    location_scope: frozenset[str] | None,
    today_start: datetime,
    week_start: datetime,
) -> tuple[DashboardWindowOut, DashboardWindowOut]:
    query: dict[str, Any] = {
        "company_id": company_id,
        "recorded_at": {"$gte": week_start},
        "type": {"$ne": "putaway"},
    }
    _scope_movements(query, location_scope)
    group = {
        "_id": {
            "type": "$type",
            "direction": {"$cond": [{"$gte": ["$quantity_delta", 0]}, "in", "out"]},
        },
        "units": {"$sum": "$base_qty"},
        "count": {"$sum": 1},
    }
    cursor = await database.movements.aggregate(
        [
            {"$match": query},
            {
                "$facet": {
                    "today": [
                        {"$match": {"recorded_at": {"$gte": today_start}}},
                        {"$group": group},
                    ],
                    "week": [{"$group": group}],
                }
            },
        ]
    )
    documents = await cursor.to_list(length=1)
    if not documents:
        empty = DashboardWindowOut(
            inbound_units=ZERO,
            outbound_units=ZERO,
            net_units=ZERO,
            movement_count=0,
        )
        return empty, empty
    facets = documents[0]
    return _window(facets.get("today", [])), _window(facets.get("week", []))


async def _receiving_queue(
    database: AsyncDatabase,
    company_id: str,
    location_scope: frozenset[str] | None,
) -> DashboardReceivingQueueOut:
    query: dict[str, Any] = {"company_id": company_id, "status": "draft"}
    if location_scope is not None:
        query["location_id"] = {"$in": sorted(location_scope)}
    documents = await database.receipts.find(
        query,
        {"lines.base_qty": 1, "created_at": 1},
    ).to_list(length=None)
    units = ZERO
    oldest: datetime | None = None
    for document in documents:
        for line in document.get("lines", []):
            units += to_decimal(line.get("base_qty"))
        created_at = document.get("created_at")
        if created_at is not None and (oldest is None or created_at < oldest):
            oldest = created_at
    return DashboardReceivingQueueOut(
        draft_count=len(documents),
        draft_units=units,
        oldest_draft_at=oldest,
    )


@router.get("/dashboard", response_model=DashboardSummaryOut)
async def dashboard_summary(
    context: ContextDep,
    database: DbDep,
) -> DashboardSummaryOut:
    context.require("inventory.read")
    company_id = context.company["_id"]
    zone = _company_timezone(context.company.get("timezone"))
    now = utcnow()
    today_start = _day_start(now, zone)
    week_start = _day_start(now - timedelta(days=6), zone)
    today, week = await _movement_windows(
        database,
        company_id,
        context.location_scope,
        today_start,
        week_start,
    )
    receiving = await _receiving_queue(database, company_id, context.location_scope)
    return DashboardSummaryOut(
        as_of=now,
        timezone=zone.key,
        today=today,
        last_7_days=week,
        receiving_queue=receiving,
    )
