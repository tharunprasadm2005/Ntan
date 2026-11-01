import uuid

from .utils import (
    auth,
    create_item,
    create_warehouse,
    default_location,
    register_company,
)


async def _setup(client, label: str = "Reorder", reorder_point: str = "10"):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"SKU-{uuid.uuid4().hex[:8].upper()}")
    updated = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(token),
        json={"reorder_point": reorder_point},
    )
    assert updated.status_code == 200, updated.text
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    return registration, token, item, warehouse, location


async def _receive(client, token: str, warehouse: dict, location: dict, item: dict, qty: str):
    key = f"receipt-{uuid.uuid4()}"
    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": key},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "supplier": "Reorder Supply",
            "lines": [{"item_id": item["id"], "qty": qty}],
        },
    )
    assert draft.status_code == 201, draft.text
    committed = await client.post(
        f"/api/v1/receipts/{draft.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text
    return committed.json()


def _row(response, item_id: str) -> dict:
    rows = [row for row in response.json()["rows"] if row["item_id"] == item_id]
    assert len(rows) == 1, response.text
    return rows[0]


async def test_reorder_needed_calculates_projected_stock_and_fallback_target(client):
    _, token, item, warehouse, location = await _setup(client)
    await _receive(client, token, warehouse, location, item, "4")

    response = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    row = _row(response, item["id"])

    assert float(row["available"]) == 4
    assert float(row["on_hand"]) == 4
    assert float(row["reorder_point"]) == 10
    assert float(row["target_stock"]) == 20
    assert row["target_stock_source"] == "fallback"
    assert float(row["incoming_qty"]) == 0
    assert row["incoming_source"] == "purchase_order"
    assert float(row["projected_stock"]) == 4
    assert float(row["suggested_qty"]) == 16
    assert row["urgency"] == "critical"
    assert row["warehouse_id"] == warehouse["id"]
    assert row["warehouse_name"] == warehouse["name"]
    assert body["assumptions"]


async def test_reorder_needed_excludes_stock_above_reorder_point(client):
    _, token, item, warehouse, location = await _setup(client, reorder_point="10")
    await _receive(client, token, warehouse, location, item, "12")

    response = await client.get("/api/v1/reorder-needed", headers=auth(token))
    assert response.status_code == 200, response.text
    rows = [row for row in response.json()["rows"] if row["item_id"] == item["id"]]
    assert rows == []


async def test_reorder_needed_includes_stockout_without_balances(client):
    _, token, item, warehouse, _location = await _setup(client, reorder_point="6")

    response = await client.get("/api/v1/reorder-needed", headers=auth(token))
    assert response.status_code == 200, response.text
    row = _row(response, item["id"])

    assert float(row["available"]) == 0
    assert float(row["suggested_qty"]) == 12
    assert row["urgency"] == "stockout"
    assert row["warehouse_id"] is None

    attributed = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    assert attributed.status_code == 200, attributed.text
    attributed_row = _row(attributed, item["id"])
    assert attributed_row["warehouse_id"] == warehouse["id"]
    assert attributed_row["warehouse_name"] == warehouse["name"]

    filtered = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(token),
        params={"status": "low"},
    )
    assert filtered.status_code == 200, filtered.text
    assert all(entry["urgency"] == "low" for entry in filtered.json()["rows"])


async def test_reorder_needed_is_tenant_warehouse_and_client_scoped(client):
    _, token, item, warehouse, location = await _setup(client, "Scoped")
    other_warehouse = await create_warehouse(client, token, name="Overstock Warehouse")
    other_location = await default_location(client, token, other_warehouse["id"])
    await _receive(client, token, warehouse, location, item, "4")
    await _receive(client, token, other_warehouse, other_location, item, "50")

    scoped = await client.get("/api/v1/reorder-needed", headers=auth(token))
    assert scoped.status_code == 200, scoped.text
    rows = [row for row in scoped.json()["rows"] if row["item_id"] == item["id"]]
    assert len(rows) == 1
    assert rows[0]["warehouse_id"] == warehouse["id"]

    overstock = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(token),
        params={"warehouse_id": other_warehouse["id"]},
    )
    assert overstock.status_code == 200, overstock.text
    assert [row for row in overstock.json()["rows"] if row["item_id"] == item["id"]] == []

    other_company = await register_company(client, "OtherTenant")
    isolated = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(other_company["access_token"]),
    )
    assert isolated.status_code == 200, isolated.text
    assert [row for row in isolated.json()["rows"] if row["item_id"] == item["id"]] == []

    unknown_client = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(token),
        params={"client_id": str(uuid.uuid4())},
    )
    assert unknown_client.status_code == 200, unknown_client.text
    assert unknown_client.json()["rows"] == []


async def test_reorder_needed_is_read_only_and_receiving_still_works(client):
    _, token, item, warehouse, location = await _setup(client, reorder_point="10")
    await _receive(client, token, warehouse, location, item, "4")

    balances_before = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "limit": 200},
    )
    movements_before = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"], "limit": 200},
    )
    assert balances_before.status_code == 200, balances_before.text
    assert movements_before.status_code == 200, movements_before.text

    for _ in range(2):
        response = await client.get("/api/v1/reorder-needed", headers=auth(token))
        assert response.status_code == 200, response.text
        assert float(_row(response, item["id"])["available"]) == 4

    balances_after = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "limit": 200},
    )
    movements_after = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"], "limit": 200},
    )
    assert balances_after.json()["balances"] == balances_before.json()["balances"]
    assert movements_after.json()["movements"] == movements_before.json()["movements"]

    # The existing receive-and-commit workflow remains the only stock increase.
    await _receive(client, token, warehouse, location, item, "1")
    refreshed = await client.get("/api/v1/reorder-needed", headers=auth(token))
    assert refreshed.status_code == 200, refreshed.text
    assert float(_row(refreshed, item["id"])["available"]) == 5


async def test_reorder_needed_requires_authentication(client):
    response = await client.get("/api/v1/reorder-needed")
    assert response.status_code == 401
