from fastapi import APIRouter, Response, status

from ..db import ping
from ..dependencies import DbDep, SettingsDep
from ..schemas import HealthResponse

router = APIRouter(tags=["health"])
# Infrastructure probes (Docker, load balancers, tunnels) usually call /health
# at the server root rather than under the API prefix.
root_router = APIRouter(tags=["health"], include_in_schema=False)


@router.get("/health", response_model=HealthResponse)
async def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
    )


@router.get("/health/ready", response_model=HealthResponse)
async def ready(database: DbDep, settings: SettingsDep, response: Response) -> HealthResponse:
    if not await ping(database):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(
            status="unavailable", app=settings.app_name, version=settings.app_version
        )
    return HealthResponse(status="ready", app=settings.app_name, version=settings.app_version)


root_router.add_api_route(
    "/health",
    health,
    methods=["GET", "HEAD"],
    response_model=HealthResponse,
    include_in_schema=False,
)
root_router.add_api_route(
    "/health/ready",
    ready,
    methods=["GET", "HEAD"],
    response_model=HealthResponse,
    include_in_schema=False,
)
