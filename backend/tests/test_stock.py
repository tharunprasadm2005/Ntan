import asyncio
import uuid
from decimal import Decimal

from .utils import (
    auth,
    create_item,
    create_warehouse,
    default_location,
    join_company,
    register_company,
)


async def _setup(client, label="Stock"):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"SKU-{uuid.uuid4().hex[:8].upper()}")
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    return registration, token, item, warehouse, location


def _receipt(warehouse: dict, location: dict, item: dict, qty: str = "2.5") -> dict:
    return {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "supplier": "Acme Supply",
        "lines": [{"item_id": item["id"], "qty": qty}],
    }


async def test_receive_stock_updates_balance_and_movement(client):
    registration, token, item, warehouse, location = await _setup(client, "Receive")
    key = f"receipt-{uuid.uuid4()}"

    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": key},
        json=_receipt(warehouse, location, item),
    )
    assert draft.status_code == 201, draft.text
    receipt = draft.json()
    assert receipt["status"] == "draft"
    assert receipt["lines"][0]["qty"] == "2.5"

    duplicate = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": key},
        json=_receipt(warehouse, location, item),
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == receipt["id"]

    conflicting = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": key},
        json=_receipt(warehouse, location, item, qty="9"),
    )
    assert conflicting.status_code == 409
    assert conflicting.json()["error"]["code"] == "idempotency_conflict"

    committed = await client.post(
        f"/api/v1/receipts/{receipt['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text
    assert committed.json()["status"] == "applied"

    committed_again = await client.post(
        f"/api/v1/receipts/{receipt['id']}/commit",
        headers=auth(token),
    )
    assert committed_again.status_code == 200
    assert committed_again.json()["status"] == "applied"

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert balances.status_code == 200
    balance = balances.json()["balances"][0]
    assert Decimal(balance["on_hand"]) == Decimal("2.5")
    assert Decimal(balance["available"]) == Decimal("2.5")
    assert balance["location_id"] == location["id"]

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert movements.status_code == 200
    assert len(movements.json()["movements"]) == 1
    assert Decimal(movements.json()["movements"][0]["quantity_delta"]) == Decimal("2.5")

    availability = await client.get(
        f"/api/v1/items/{item['id']}/availability",
        headers=auth(token),
    )
    assert availability.status_code == 200
    assert Decimal(availability.json()["available"]) == Decimal("2.5")


async def test_invalid_quantity_and_uom_are_rejected(client):
    registration, token, item, warehouse, location = await _setup(client, "Validation")

    zero = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, location, item, qty="0"),
    )
    assert zero.status_code == 422
    assert "lines.0.qty" in zero.json()["error"]["field_errors"]

    negative = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, location, item, qty="-1"),
    )
    assert negative.status_code == 422

    wrong_uom_payload = _receipt(warehouse, location, item)
    wrong_uom_payload["lines"][0]["uom"] = "BOX"
    wrong_uom = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=wrong_uom_payload,
    )
    assert wrong_uom.status_code == 422
    assert wrong_uom.json()["error"]["code"] == "uom_conversion_not_supported"


async def test_receipt_rejects_another_tenants_item(client):
    alpha = await register_company(client, "AlphaStock")
    beta = await register_company(client, "BetaStock")
    beta_item = await create_item(
        client,
        beta["access_token"],
        sku=f"BETA-{uuid.uuid4().hex[:8].upper()}",
    )
    alpha_warehouse = await create_warehouse(client, alpha["access_token"], "Alpha Warehouse")
    alpha_location = await default_location(
        client,
        alpha["access_token"],
        alpha_warehouse["id"],
    )
    response = await client.post(
        "/api/v1/receipts",
        headers={**auth(alpha["access_token"]), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(alpha_warehouse, alpha_location, beta_item),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_item"


async def test_concurrent_receipts_apply_once_and_preserve_stock(client):
    registration, token, item, warehouse, location = await _setup(client, "Concurrent")
    key = f"same-{uuid.uuid4()}"
    payload = _receipt(warehouse, location, item, qty="3")

    responses = await asyncio.gather(
        *[
            client.post(
                "/api/v1/receipts",
                headers={**auth(token), "Idempotency-Key": key},
                json=payload,
            )
            for _ in range(5)
        ]
    )
    assert all(response.status_code == 201 for response in responses)
    ids = {response.json()["id"] for response in responses}
    assert len(ids) == 1
    receipt_id = next(iter(ids))

    commits = await asyncio.gather(
        *[
            client.post(f"/api/v1/receipts/{receipt_id}/commit", headers=auth(token))
            for _ in range(4)
        ]
    )
    assert all(response.status_code == 200 for response in commits), [
        response.text for response in commits
    ]

    availability = await client.get(
        f"/api/v1/items/{item['id']}/availability",
        headers=auth(token),
    )
    assert availability.status_code == 200
    assert Decimal(availability.json()["on_hand"]) == Decimal("3")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert len(movements.json()["movements"]) == 1


async def test_two_receipts_commit_concurrently(client):
    registration, token, item, warehouse, location = await _setup(client, "Parallel")
    receipts = []
    for qty in ("2", "4"):
        response = await client.post(
            "/api/v1/receipts",
            headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
            json=_receipt(warehouse, location, item, qty=qty),
        )
        assert response.status_code == 201, response.text
        receipts.append(response.json())

    commits = await asyncio.gather(
        *[
            client.post(f"/api/v1/receipts/{receipt['id']}/commit", headers=auth(token))
            for receipt in receipts
        ]
    )
    assert all(response.status_code == 200 for response in commits)
    availability = await client.get(
        f"/api/v1/items/{item['id']}/availability",
        headers=auth(token),
    )
    assert Decimal(availability.json()["on_hand"]) == Decimal("6")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert len(movements.json()["movements"]) == 2


async def test_warehouse_creates_default_locations(client):
    registration = await register_company(client, "Locations")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token, "Secondary")
    response = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    assert response.status_code == 200
    locations = response.json()["locations"]
    codes = {location["code"] for location in locations}
    assert codes == {"RECV", "MAIN", "BIN-01"}
    bin_location = next(location for location in locations if location["code"] == "BIN-01")
    assert bin_location["path"] == "MAIN/BIN-01"
    assert bin_location["type"] == "bin"

    duplicate = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={"name": "Secondary"},
    )
    assert duplicate.status_code == 409


async def test_warehouse_address_can_be_created_and_updated(client):
    registration = await register_company(client, "Address")
    token = registration["access_token"]
    created = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={
            "name": "Coimbatore Warehouse",
            "address": "12 Avinashi Road, Coimbatore 641018",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["address"] == "12 Avinashi Road, Coimbatore 641018"

    updated = await client.patch(
        f"/api/v1/warehouses/{created.json()['id']}",
        headers=auth(token),
        json={
            "name": "Coimbatore Main",
            "address": "45 Trichy Road, Coimbatore 641018",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Coimbatore Main"
    assert updated.json()["address"] == "45 Trichy Road, Coimbatore 641018"

    cleared = await client.patch(
        f"/api/v1/warehouses/{created.json()['id']}",
        headers=auth(token),
        json={"address": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["address"] is None


async def test_item_reorder_point_round_trips(client):
    registration = await register_company(client, "Reorder")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"REORDER-{uuid.uuid4().hex[:8].upper()}")

    updated = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(token),
        json={"reorder_point": "12.5"},
    )
    assert updated.status_code == 200, updated.text
    assert Decimal(updated.json()["reorder_point"]) == Decimal("12.5")

    listed = await client.get("/api/v1/items", headers=auth(token))
    assert listed.status_code == 200
    stored = next(entry for entry in listed.json()["items"] if entry["id"] == item["id"])
    assert Decimal(stored["reorder_point"]) == Decimal("12.5")

    cleared = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(token),
        json={"reorder_point": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["reorder_point"] is None


async def test_item_cost_update_is_encoded_as_decimal(client):
    registration = await register_company(client, "CostUpdate")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"COST-{uuid.uuid4().hex[:8].upper()}")

    response = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(token),
        json={"cost": "12.3456"},
    )
    assert response.status_code == 200, response.text
    assert Decimal(response.json()["cost"]) == Decimal("12.3456")


async def test_dashboard_reports_warehouse_activity_and_receiving_queue(client):
    registration, token, item, warehouse, location = await _setup(client, "Dashboard")

    applied = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, location, item, qty="4"),
    )
    assert applied.status_code == 201, applied.text
    committed = await client.post(
        f"/api/v1/receipts/{applied.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text

    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, location, item, qty="3.5"),
    )
    assert draft.status_code == 201, draft.text

    response = await client.get("/api/v1/dashboard", headers=auth(token))
    assert response.status_code == 200, response.text
    dashboard = response.json()
    assert dashboard["timezone"] == "UTC"
    assert Decimal(dashboard["today"]["inbound_units"]) == Decimal("4")
    assert Decimal(dashboard["today"]["outbound_units"]) == Decimal("0")
    assert Decimal(dashboard["today"]["net_units"]) == Decimal("4")
    assert dashboard["today"]["movement_count"] == 1
    assert Decimal(dashboard["last_7_days"]["inbound_units"]) == Decimal("4")
    assert dashboard["receiving_queue"]["draft_count"] == 1
    assert Decimal(dashboard["receiving_queue"]["draft_units"]) == Decimal("3.5")
    assert dashboard["receiving_queue"]["oldest_draft_at"] is not None


async def test_dashboard_requires_authentication(client):
    response = await client.get("/api/v1/dashboard")
    assert response.status_code == 401


async def test_dashboard_respects_location_scope(client):
    registration, token, item, warehouse, location = await _setup(client, "DashboardScope")
    other_warehouse = await create_warehouse(client, token, name="Secondary Warehouse")
    other_location = await default_location(client, token, other_warehouse["id"])

    applied = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, location, item, qty="2"),
    )
    assert applied.status_code == 201, applied.text
    committed = await client.post(
        f"/api/v1/receipts/{applied.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text

    other_applied = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(other_warehouse, other_location, item, qty="5"),
    )
    assert other_applied.status_code == 201, other_applied.text
    other_committed = await client.post(
        f"/api/v1/receipts/{other_applied.json()['id']}/commit",
        headers=auth(token),
    )
    assert other_committed.status_code == 200, other_committed.text

    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, location, item, qty="1"),
    )
    assert draft.status_code == 201, draft.text

    other_draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(other_warehouse, other_location, item, qty="3"),
    )
    assert other_draft.status_code == 201, other_draft.text

    owner_dashboard = await client.get("/api/v1/dashboard", headers=auth(token))
    assert owner_dashboard.status_code == 200, owner_dashboard.text
    owner_summary = owner_dashboard.json()
    assert Decimal(owner_summary["today"]["inbound_units"]) == Decimal("7")
    assert owner_summary["today"]["movement_count"] == 2
    assert owner_summary["receiving_queue"]["draft_count"] == 2
    assert Decimal(owner_summary["receiving_queue"]["draft_units"]) == Decimal("4")

    scoped = await join_company(
        client,
        token,
        email=f"scoped-{uuid.uuid4().hex[:8]}@example.com",
        role="viewer",
        location_ids=[location["id"]],
    )
    scoped_dashboard = await client.get(
        "/api/v1/dashboard",
        headers=auth(scoped["access_token"]),
    )
    assert scoped_dashboard.status_code == 200, scoped_dashboard.text
    scoped_summary = scoped_dashboard.json()
    assert Decimal(scoped_summary["today"]["inbound_units"]) == Decimal("2")
    assert scoped_summary["today"]["movement_count"] == 1
    assert scoped_summary["receiving_queue"]["draft_count"] == 1
    assert Decimal(scoped_summary["receiving_queue"]["draft_units"]) == Decimal("1")

async def test_lot_receipt_records_lot_expiry_and_putaway(client):
    registration = await register_company(client, "LotReceive")
    token = registration["access_token"]
    item = await create_item(
        client,
        token,
        sku=f"LOT-{uuid.uuid4().hex[:8].upper()}",
        tracking_mode="lot",
        expiry_tracked=True,
    )
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    payload = {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "lines": [
            {
                "item_id": item["id"],
                "qty": "4",
                "lot_no": "LOT-2027-A",
                "expiry_date": "2027-06-30",
            }
        ],
    }
    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )
    assert draft.status_code == 201, draft.text
    receipt = draft.json()
    assert receipt["lines"][0]["lot_no"] == "LOT-2027-A"
    assert receipt["lines"][0]["lot_id"] is None

    committed = await client.post(
        f"/api/v1/receipts/{receipt['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text
    line = committed.json()["lines"][0]
    assert line["lot_id"]
    assert line["expiry_date"] == "2027-06-30"

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert balances.status_code == 200, balances.text
    balance = balances.json()["balances"][0]
    assert balance["lot_no"] == "LOT-2027-A"
    assert balance["expiry_date"] == "2027-06-30"
    assert Decimal(balance["on_hand"]) == Decimal("4")

    tasks = await client.get("/api/v1/putaway/tasks", headers=auth(token))
    assert tasks.status_code == 200, tasks.text
    task = tasks.json()["tasks"][0]
    assert task["lot_no"] == "LOT-2027-A"
    assert task["expiry_date"] == "2027-06-30"


async def test_serial_receipt_creates_one_balance_and_task_per_serial(client):
    registration = await register_company(client, "SerialReceive")
    token = registration["access_token"]
    item = await create_item(
        client,
        token,
        sku=f"SER-{uuid.uuid4().hex[:8].upper()}",
        tracking_mode="serial",
    )
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    payload = {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "lines": [
            {
                "item_id": item["id"],
                "qty": "2",
                "serial_numbers": ["SN-ALPHA", "SN-BETA"],
            }
        ],
    }
    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )
    assert draft.status_code == 201, draft.text
    committed = await client.post(
        f"/api/v1/receipts/{draft.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert balances.status_code == 200, balances.text
    rows = balances.json()["balances"]
    assert sorted(row["serial_no"] for row in rows) == ["SN-ALPHA", "SN-BETA"]
    assert all(Decimal(row["on_hand"]) == Decimal("1") for row in rows)

    tasks = await client.get("/api/v1/putaway/tasks", headers=auth(token))
    assert tasks.status_code == 200, tasks.text
    task_rows = tasks.json()["tasks"]
    assert sorted(row["serial_no"] for row in task_rows) == ["SN-ALPHA", "SN-BETA"]
    assert all(Decimal(row["base_qty"]) == Decimal("1") for row in task_rows)

    scanned = await client.post(
        "/api/v1/scan/resolve",
        headers=auth(token),
        json={"code": "SN-BETA"},
    )
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["type"] == "serial"
    assert scanned.json()["serial"]["serial_no"] == "SN-BETA"

    locations = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    bin_location = next(
        location for location in locations.json()["locations"] if location["code"] == "BIN-01"
    )
    first_task = next(row for row in task_rows if row["serial_no"] == "SN-ALPHA")
    completed = await client.post(
        f"/api/v1/putaway/tasks/{first_task['id']}/complete",
        headers=auth(token),
        json={
            "location_id": bin_location["id"],
            "serial_ids": [first_task["serial_id"]],
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["serial_no"] == "SN-ALPHA"

    bin_balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": bin_location["id"]},
    )
    assert bin_balances.status_code == 200, bin_balances.text
    assert [row["serial_no"] for row in bin_balances.json()["balances"]] == ["SN-ALPHA"]


async def test_serial_receipt_requires_matching_new_serials(client):
    registration = await register_company(client, "SerialRules")
    token = registration["access_token"]
    item = await create_item(
        client,
        token,
        sku=f"SERR-{uuid.uuid4().hex[:8].upper()}",
        tracking_mode="serial",
    )
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])

    mismatch = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [
                {"item_id": item["id"], "qty": "2", "serial_numbers": ["SN-ONE"]}
            ],
        },
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "serial_quantity_mismatch"

    missing = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [{"item_id": item["id"], "qty": "1"}],
        },
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "serial_required"
