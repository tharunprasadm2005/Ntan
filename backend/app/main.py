import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .db import create_client, get_database
from .errors import (
    APIError,
    api_error_handler,
    http_error_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from .indexes import create_indexes
from .migrations import backfill_foundation
from .routers import (
    auth,
    clients,
    company,
    dashboard,
    health,
    inspections,
    items,
    members,
    outbound,
    purchasing,
    putaway,
    scan,
    stock,
    sync,
    traceability,
    transfers,
    warehouses,
)

settings = get_settings()
logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    active_settings = get_settings()
    client = create_client(active_settings)
    database = get_database(client, active_settings)
    await client.admin.command("ping")
    await backfill_foundation(database)
    await create_indexes(database)
    app.state.client = client
    app.state.db = database
    try:
        yield
    finally:
        await client.aclose()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    docs_url=f"{settings.api_v1_prefix}/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(StarletteHTTPException, http_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(health.router, prefix=settings.api_v1_prefix)
app.include_router(health.root_router)
app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(clients.router, prefix=settings.api_v1_prefix)
app.include_router(company.router, prefix=settings.api_v1_prefix)
app.include_router(members.router, prefix=settings.api_v1_prefix)
app.include_router(items.router, prefix=settings.api_v1_prefix)
app.include_router(inspections.router, prefix=settings.api_v1_prefix)
app.include_router(warehouses.router, prefix=settings.api_v1_prefix)
app.include_router(stock.router, prefix=settings.api_v1_prefix)
app.include_router(outbound.router, prefix=settings.api_v1_prefix)
app.include_router(putaway.router, prefix=settings.api_v1_prefix)
app.include_router(purchasing.router, prefix=settings.api_v1_prefix)
app.include_router(scan.router, prefix=settings.api_v1_prefix)
app.include_router(traceability.router, prefix=settings.api_v1_prefix)
app.include_router(dashboard.router, prefix=settings.api_v1_prefix)
app.include_router(transfers.router, prefix=settings.api_v1_prefix)
app.include_router(sync.router, prefix=settings.api_v1_prefix)


@app.get("/", include_in_schema=False)
async def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": settings.app_name,
            "version": settings.app_version,
            "docs": f"{settings.api_v1_prefix}/docs",
        }
    )
