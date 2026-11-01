import uuid
from decimal import Decimal

from .utils import auth, create_item, create_warehouse, register_company


def _order(warehouse: dict, item: dict, qty: str = "2") -> dict:
    return {
        "warehouse_id": warehouse["id"],
        "customer_name": "Acme Customer",
        "customer_reference": "PO-7788",
        "lines": [{"item_id": item["id"], "qty": qty}],
    }


async def _setup(client, label: str):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"OUT-{uuid.uuid4().hex[:8].upper()}")
    warehouse = await create_warehouse(client, token)
    locations = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    rows = {row["code"]: row for row in locations.json()["locations"]}
    return registration, token, item, warehouse, rows


async def _receive(client, token: str, warehouse: dict, location: dict, item: dict, qty: str):
    created = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [{"item_id": item["id"], "qty": qty}],
        },
    )
    assert created.status_code == 201, created.text
    committed = await client.post(
        f"/api/v1/receipts/{created.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text


async def _create_order(client, token: str, payload: dict) -> dict:
    response = await client.post(
        "/api/v1/outbound/orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_outbound_order_allocates_picks_and_ships(client):
    _, token, item, warehouse, rows = await _setup(client, "Outbound")
    bin_location = rows["BIN-01"]
    await _receive(client, token, warehouse, bin_location, item, "5")
    order = await _create_order(client, token, _order(warehouse, item, "2"))
    assert order["status"] == "draft"
    assert order["allocations"] == []

    allocated = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert allocated.status_code == 200, allocated.text
    allocated_order = allocated.json()
    assert allocated_order["status"] == "allocated"
    assert len(allocated_order["allocations"]) == 1
    allocation = allocated_order["allocations"][0]
    assert allocation["location_code"] == "BIN-01"
    assert Decimal(allocation["base_qty"]) == Decimal("2")

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": bin_location["id"]},
    )
    assert Decimal(balances.json()["balances"][0]["reserved"]) == Decimal("2")

    picked = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocations/{allocation['id']}/pick",
        headers=auth(token),
    )
    assert picked.status_code == 200, picked.text
    assert picked.json()["allocations"][0]["status"] == "picked"

    shipped = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/ship",
        headers=auth(token),
    )
    assert shipped.status_code == 200, shipped.text
    assert shipped.json()["status"] == "shipped"

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": bin_location["id"]},
    )
    balance = balances.json()["balances"][0]
    assert Decimal(balance["on_hand"]) == Decimal("3")
    assert Decimal(balance["reserved"]) == Decimal("0")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    outbound = [row for row in movements.json()["movements"] if row["type"] == "outbound"]
    assert len(outbound) == 1
    assert Decimal(outbound[0]["quantity_delta"]) == Decimal("-2")
    assert outbound[0]["source_number"] == order["number"]


async def test_outbound_allocation_rejects_insufficient_stock(client):
    _, token, item, warehouse, rows = await _setup(client, "OutboundShort")
    bin_location = rows["BIN-01"]
    await _receive(client, token, warehouse, bin_location, item, "1")
    order = await _create_order(client, token, _order(warehouse, item, "3"))

    response = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "insufficient_stock"

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": bin_location["id"]},
    )
    assert Decimal(balances.json()["balances"][0]["reserved"]) == Decimal("0")
    stored = await client.get(
        f"/api/v1/outbound/orders/{order['id']}",
        headers=auth(token),
    )
    assert stored.json()["status"] == "draft"


async def test_outbound_cancellation_releases_reservation(client):
    _, token, item, warehouse, rows = await _setup(client, "OutboundCancel")
    bin_location = rows["BIN-01"]
    await _receive(client, token, warehouse, bin_location, item, "4")
    order = await _create_order(client, token, _order(warehouse, item, "2"))
    allocated = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert allocated.status_code == 200, allocated.text

    cancelled = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/cancel",
        headers=auth(token),
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": bin_location["id"]},
    )
    assert Decimal(balances.json()["balances"][0]["reserved"]) == Decimal("0")

async def test_outbound_allocation_ignores_non_pickable_stock(client):
    _, token, item, warehouse, rows = await _setup(client, "OutboundStaged")
    await _receive(client, token, warehouse, rows["RECV"], item, "2")
    order = await _create_order(client, token, _order(warehouse, item, "1"))

    response = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "insufficient_stock"
