import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        field_errors: dict[str, str] | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field_errors = field_errors
        self.retryable = retryable


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, str] | None = None,
    retryable: bool = False,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "field_errors": field_errors or {},
            "request_id": request_id,
            "retryable": retryable,
        }
    }
    return JSONResponse(
        status_code=status_code,
        content=body,
        headers=headers,
    )


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    return error_response(
        request,
        exc.status_code,
        exc.code,
        exc.message,
        exc.field_errors,
        exc.retryable,
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    field_errors: dict[str, str] = {}
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"] if part != "body")
        field_errors[location or "body"] = error["msg"]
    return error_response(
        request,
        422,
        "validation_error",
        "The request contains invalid fields.",
        field_errors,
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    codes = {404: "not_found", 405: "method_not_allowed"}
    return error_response(
        request,
        exc.status_code,
        codes.get(exc.status_code, "http_error"),
        str(exc.detail),
        headers=exc.headers,
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled error for request %s",
        getattr(request.state, "request_id", "unknown"),
        exc_info=exc,
    )
    return error_response(
        request,
        500,
        "internal_error",
        "An unexpected error occurred.",
        retryable=True,
    )
