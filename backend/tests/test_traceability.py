from datetime import datetime

from app.main import app
from app.utils import new_id, utcnow

from .utils import auth, create_item, register_company


async def test_lots_and_serials_are_scoped_and_filterable(client):
    owner = await register_company(client, "Trace")
    token = owner["access_token"]
    item = await create_item(client, token, sku="LOT-ITEM", name="Milk Powder")
    other_item = await create_item(client, token, sku="SER-ITEM", name="Pump")

    database = app.state.db
    now = utcnow()
    lot_id = new_id()
    await database.lots.insert_one(
        {
            "_id": lot_id,
            "company_id": owner["company"]["id"],
            "client_id": item["client_id"],
            "item_id": item["id"],
            "sku": item["sku"],
            "item_name": item["name"],
            "lot_no": "LOT-2026-A",
            "expiry_date": datetime(2026, 12, 31),
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
    )
    await database.serials.insert_one(
        {
            "_id": new_id(),
            "company_id": owner["company"]["id"],
            "client_id": other_item["client_id"],
            "item_id": other_item["id"],
            "sku": other_item["sku"],
            "item_name": other_item["name"],
            "serial_no": "SN-1001",
            "lot_id": None,
            "lot_no": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
    )

    response = await client.get(
        "/api/v1/lots",
        headers=auth(token),
        params={"item_id": item["id"], "q": "milk"},
    )
    assert response.status_code == 200, response.text
    lots = response.json()["lots"]
    assert [lot["lot_no"] for lot in lots] == ["LOT-2026-A"]
    assert lots[0]["expiry_date"] == "2026-12-31"

    response = await client.get(
        "/api/v1/lots",
        headers=auth(token),
        params={"expiry_before": "2026-12-30"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["lots"] == []

    response = await client.get("/api/v1/serials", headers=auth(token), params={"q": "SN-10"})
    assert response.status_code == 200, response.text
    serials = response.json()["serials"]
    assert [serial["serial_no"] for serial in serials] == ["SN-1001"]


async def test_traceability_records_are_hidden_from_other_companies(client):
    first = await register_company(client, "TraceOne")
    second = await register_company(client, "TraceTwo")
    first_item = await create_item(client, first["access_token"], sku="LOT-ONE")
    second_item = await create_item(client, second["access_token"], sku="LOT-TWO")

    database = app.state.db
    now = utcnow()
    await database.lots.insert_one(
        {
            "_id": new_id(),
            "company_id": first["company"]["id"],
            "client_id": first_item["client_id"],
            "item_id": first_item["id"],
            "sku": first_item["sku"],
            "item_name": first_item["name"],
            "lot_no": "SECRET-LOT",
            "expiry_date": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
    )
    await database.lots.insert_one(
        {
            "_id": new_id(),
            "company_id": second["company"]["id"],
            "client_id": second_item["client_id"],
            "item_id": second_item["id"],
            "sku": second_item["sku"],
            "item_name": second_item["name"],
            "lot_no": "VISIBLE-LOT",
            "expiry_date": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
    )

    response = await client.get("/api/v1/lots", headers=auth(second["access_token"]))
    assert response.status_code == 200, response.text
    assert [lot["lot_no"] for lot in response.json()["lots"]] == ["VISIBLE-LOT"]
