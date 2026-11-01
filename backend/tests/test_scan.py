import uuid

from app.main import app
from app.utils import new_id, utcnow

from .utils import auth, create_warehouse, register_company


async def _create_item(client, token, barcode: str, sku: str = "SCAN-ITEM"):
    response = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={
            "sku": sku,
            "name": "Scannable item",
            "base_uom": "EA",
            "barcode": barcode,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_scan_resolves_item_by_barcode_and_sku(client):
    registration = await register_company(client, "ScanItem")
    token = registration["access_token"]
    item = await _create_item(client, token, "8901234567890", "SCAN-001")

    by_barcode = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "8901234567890"},
    )
    assert by_barcode.status_code == 200, by_barcode.text
    result = by_barcode.json()
    assert result["type"] == "item"
    assert result["item"]["id"] == item["id"]
    assert result["item"]["barcode"] == "8901234567890"

    by_sku = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "scan-001"},
    )
    assert by_sku.status_code == 200, by_sku.text
    assert by_sku.json()["item"]["id"] == item["id"]


async def test_scan_resolves_location_barcode(client):
    registration = await register_company(client, "ScanLocation")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token)
    created = await client.post(
        "/api/v1/locations",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "code": "A-01",
            "type": "bin",
            "barcode": "LOC-A-01",
        },
    )
    assert created.status_code == 201, created.text
    location = created.json()

    response = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "LOC-A-01"},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["type"] == "location"
    assert result["location"]["id"] == location["id"]
    assert result["location"]["code"] == "A-01"


async def test_scan_resolves_lot_and_serial_with_item_context(client):
    registration = await register_company(client, "ScanTrace")
    token = registration["access_token"]
    item = await _create_item(client, token, "SCAN-LOT-ITEM", "LOT-SCAN")
    database = app.state.db
    now = utcnow()
    lot_id = new_id()
    await database.lots.insert_one(
        {
            "_id": lot_id,
            "company_id": registration["company"]["id"],
            "client_id": item["client_id"],
            "item_id": item["id"],
            "sku": item["sku"],
            "item_name": item["name"],
            "lot_no": "LOT-SCAN-2026",
            "expiry_date": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
    )
    serial_id = new_id()
    await database.serials.insert_one(
        {
            "_id": serial_id,
            "company_id": registration["company"]["id"],
            "client_id": item["client_id"],
            "item_id": item["id"],
            "sku": item["sku"],
            "item_name": item["name"],
            "serial_no": "SER-SCAN-001",
            "lot_id": lot_id,
            "lot_no": "LOT-SCAN-2026",
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
    )

    lot_response = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "LOT-SCAN-2026", "client_id": item["client_id"]},
    )
    assert lot_response.status_code == 200, lot_response.text
    lot_result = lot_response.json()
    assert lot_result["type"] == "lot"
    assert lot_result["lot"]["id"] == lot_id
    assert lot_result["item"]["id"] == item["id"]

    serial_response = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "SER-SCAN-001"},
    )
    assert serial_response.status_code == 200, serial_response.text
    serial_result = serial_response.json()
    assert serial_result["type"] == "serial"
    assert serial_result["serial"]["id"] == serial_id
    assert serial_result["serial"]["lot_id"] == lot_id


async def test_scan_requires_client_when_code_is_ambiguous(client):
    registration = await register_company(client, "ScanAmbiguous")
    token = registration["access_token"]
    first = await _create_item(client, token, "DUP-BARCODE", "DUP-ONE")
    enabled = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "hybrid"},
    )
    assert enabled.status_code == 200, enabled.text
    second_client = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "ACME", "name": "Acme"},
    )
    assert second_client.status_code == 201, second_client.text
    second = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={
            "client_id": second_client.json()["id"],
            "sku": "DUP-TWO",
            "name": "Second scannable item",
            "barcode": "DUP-BARCODE",
        },
    )
    assert second.status_code == 201, second.text

    ambiguous = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "DUP-BARCODE"},
    )
    assert ambiguous.status_code == 422
    assert ambiguous.json()["error"]["code"] == "client_required"

    resolved = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "DUP-BARCODE", "client_id": first["client_id"]},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["item"]["id"] == first["id"]


async def test_scan_is_scoped_and_returns_not_found(client):
    registration = await register_company(client, "ScanScope")
    token = registration["access_token"]
    other = await register_company(client, "ScanOther")
    other_item = await _create_item(
        client,
        other["access_token"],
        f"OTHER-{uuid.uuid4().hex[:8]}",
        "OTHER-SCAN",
    )

    hidden = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": other_item["barcode"]},
    )
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "scan_not_found"

    missing = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "NOT-A-REAL-CODE"},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "scan_not_found"

    unauthenticated = await client.post(
        "/api/v1/scan/resolve",
        json={"code": "ANY"},
    )
    assert unauthenticated.status_code == 401
