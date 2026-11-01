from typing import Annotated

from fastapi import APIRouter, Query, Request

from ..audit import record_audit
from ..dependencies import ContextDep, DbDep
from ..schemas import AuditEventListResponse, CompanyOut, CompanyUpdate
from ..serializers import audit_event_out, company_out
from ..utils import utcnow

router = APIRouter(tags=["company"])


@router.get("/company", response_model=CompanyOut)
async def get_company(context: ContextDep) -> CompanyOut:
    return company_out(context.company)


@router.patch("/company", response_model=CompanyOut)
async def update_company(
    payload: CompanyUpdate,
    request: Request,
    context: ContextDep,
    database: DbDep,
) -> CompanyOut:
    context.require("company.manage")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        changes = {}
    changes["updated_at"] = utcnow()
    await database.companies.update_one({"_id": context.company["_id"]}, {"$set": changes})
    updated = await database.companies.find_one({"_id": context.company["_id"]})
    await record_audit(
        database,
        company_id=context.company["_id"],
        actor_id=context.user["_id"],
        action="company.updated",
        entity="company",
        entity_id=context.company["_id"],
        request_id=getattr(request.state, "request_id", None),
        before={
            "name": context.company["name"],
            "currency": context.company["currency"],
            "timezone": context.company["timezone"],
        },
        after={key: value for key, value in changes.items() if key != "updated_at"},
    )
    return company_out(updated)


@router.get("/audit-events", response_model=AuditEventListResponse)
async def list_audit_events(
    context: ContextDep,
    database: DbDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> AuditEventListResponse:
    context.require("audit.read")
    documents = (
        await database.audit_events.find({"company_id": context.company["_id"]})
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
        .to_list(length=limit)
    )
    return AuditEventListResponse(events=[audit_event_out(item) for item in documents])
