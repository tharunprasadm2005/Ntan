import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from bson.decimal128 import Decimal128

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid.uuid4())


def is_uuid(value: str) -> bool:
    return bool(UUID_RE.match(value))


def to_decimal(value: Decimal | Decimal128 | int | float | str | None) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal128):
        return value.to_decimal()
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(value)


def to_decimal128(value: Decimal | int | str) -> Decimal128:
    return Decimal128(Decimal(value))


def quantity_str(value: Decimal | Decimal128 | None) -> str:
    decimal_value = to_decimal(value)
    normalized = decimal_value.normalize()
    if normalized == normalized.to_integral():
        return str(normalized.quantize(Decimal("1")))
    return format(normalized, "f")


def encode_cursor(timestamp: datetime, identifier: str) -> str:
    import base64
    import json

    raw = json.dumps({"ts": timestamp.isoformat(), "id": identifier}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    import base64
    import json

    from .errors import APIError

    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        payload = json.loads(raw)
        timestamp = datetime.fromisoformat(payload["ts"])
        identifier = str(payload["id"])
    except (ValueError, KeyError, TypeError) as exc:
        raise APIError(422, "invalid_cursor", "The pagination cursor is invalid.") from exc
    return timestamp, identifier
