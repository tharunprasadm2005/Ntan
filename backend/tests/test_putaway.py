import asyncio
import uuid
from decimal import Decimal

from app.main import app
from app.utils import to_decimal128

from .utils import (
    accept_invitation,
    auth,
    create_item,
    create_warehouse,
    default_location,
    join_company,
    register_company,
)


def _receipt(warehouse: dict, location: dict, item: dict, qty: str) -> dict:
    return {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "supplier": "Putaway Supply",
        "lines": [{"item_id": item["id"], "qty": qty}],
    }


async def _setup(client, label: str):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"PUT-{uuid.uuid4().hex[:8].upper()}")
    warehouse = await create_warehouse(client, token)
    receiving = await default_location(client, token, warehouse["id"])
    response = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    locations = {location["code"]: location for location in response.json()["locations"]}
    return token, item, warehouse, receiving, locations


async def _create_and_commit(client, token: str, payload: dict) -> dict:
    created = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )
    assert created.status_code == 201, created.text
    committed = await client.post(
        f"/api/v1/receipts/{created.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text
    return committed.json()


async def test_receipt_creates_putaway_tasks_and_completes_to_bin(client):
    token, item, warehouse, receiving, locations = await _setup(client, "Putaway")
    bin_location = locations["BIN-01"]

    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "2.5"),
    )
    assert receipt["status"] == "applied"
    assert receipt["putaway_required"] is True
    assert receipt["putaway_completed_at"] is None

    queue = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": receipt["id"]},
    )
    assert queue.status_code == 200, queue.text
    tasks = queue.json()["tasks"]
    assert len(tasks) == 1
    task = tasks[0]
    assert task["status"] == "pending"
    assert task["from_location_code"] == "RECV"
    assert Decimal(task["base_qty"]) == Decimal("2.5")

    staging_balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": receiving["id"]},
    )
    assert Decimal(staging_balances.json()["balances"][0]["on_hand"]) == Decimal("2.5")

    completed = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": bin_location["id"]},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["to_location_code"] == "BIN-01"

    balances = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    by_location = {
        balance["location_id"]: Decimal(balance["on_hand"])
        for balance in balances.json()["balances"]
    }
    assert by_location[receiving["id"]] == Decimal("0")
    assert by_location[bin_location["id"]] == Decimal("2.5")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert movements.status_code == 200
    movement_rows = movements.json()["movements"]
    assert len(movement_rows) == 2
    putaway_movement = next(row for row in movement_rows if row["type"] == "putaway")
    assert putaway_movement["from_location_id"] == receiving["id"]
    assert putaway_movement["to_location_id"] == bin_location["id"]
    assert Decimal(putaway_movement["quantity_delta"]) == Decimal("0")

    refreshed = await client.get(
        f"/api/v1/receipts/{receipt['id']}",
        headers=auth(token),
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["putaway_completed_at"] is not None

    dashboard = await client.get("/api/v1/dashboard", headers=auth(token))
    assert Decimal(dashboard.json()["today"]["inbound_units"]) == Decimal("2.5")
    assert dashboard.json()["today"]["movement_count"] == 1

    repeated = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": bin_location["id"]},
    )
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "completed"

    conflict = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["MAIN"]["id"]},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "putaway_task_completed"


async def test_putaway_rejects_receiving_destination_and_other_warehouse(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayInvalid")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "4"),
    )
    task = (
        await client.get(
            "/api/v1/putaway/tasks",
            headers=auth(token),
            params={"receipt_id": receipt["id"]},
        )
    ).json()["tasks"][0]

    same_location = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": receiving["id"]},
    )
    assert same_location.status_code == 422
    assert same_location.json()["error"]["code"] == "invalid_putaway_location"

    other_warehouse = await create_warehouse(client, token, name="Other Putaway Warehouse")
    other_location = await default_location(client, token, other_warehouse["id"])
    cross_warehouse = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": other_location["id"]},
    )
    assert cross_warehouse.status_code == 422
    assert cross_warehouse.json()["error"]["code"] == "invalid_putaway_location"


async def test_multi_line_receipt_completes_after_all_tasks(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayMulti")
    second_item = await create_item(
        client,
        token,
        sku=f"PUT2-{uuid.uuid4().hex[:8].upper()}",
        name="Second Putaway Item",
    )
    created = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": receiving["id"],
            "lines": [
                {"item_id": item["id"], "qty": "2"},
                {"item_id": second_item["id"], "qty": "3"},
            ],
        },
    )
    assert created.status_code == 201, created.text
    receipt = (
        await client.post(
            f"/api/v1/receipts/{created.json()['id']}/commit",
            headers=auth(token),
        )
    ).json()

    tasks = (
        await client.get(
            "/api/v1/putaway/tasks",
            headers=auth(token),
            params={"receipt_id": receipt["id"]},
        )
    ).json()["tasks"]
    assert len(tasks) == 2

    first = await client.post(
        f"/api/v1/putaway/tasks/{tasks[0]['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert first.status_code == 200, first.text
    not_finished = await client.get(
        f"/api/v1/receipts/{receipt['id']}",
        headers=auth(token),
    )
    assert not_finished.json()["putaway_completed_at"] is None

    second = await client.post(
        f"/api/v1/putaway/tasks/{tasks[1]['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert second.status_code == 200, second.text
    finished = await client.get(
        f"/api/v1/receipts/{receipt['id']}",
        headers=auth(token),
    )
    assert finished.json()["putaway_completed_at"] is not None


async def test_direct_bin_receipt_does_not_create_putaway_task(client):
    token, item, warehouse, _, locations = await _setup(client, "DirectBin")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, locations["BIN-01"], item, "3"),
    )
    assert receipt["putaway_required"] is False

    tasks = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": receipt["id"]},
    )
    assert tasks.status_code == 200
    assert tasks.json()["tasks"] == []


async def test_putaway_queue_respects_location_scope(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayScope")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "1"),
    )
    task = (
        await client.get(
            "/api/v1/putaway/tasks",
            headers=auth(token),
            params={"receipt_id": receipt["id"]},
        )
    ).json()["tasks"][0]

    scoped = await join_company(
        client,
        token,
        email=f"putaway-scope-{uuid.uuid4().hex[:8]}@example.com",
        role="warehouse_operator",
        location_ids=[locations["BIN-01"]["id"]],
    )
    queue = await client.get("/api/v1/putaway/tasks", headers=auth(scoped["access_token"]))
    assert queue.status_code == 200
    assert queue.json()["tasks"] == []

    denied = await client.get(
        f"/api/v1/putaway/tasks/{task['id']}",
        headers=auth(scoped["access_token"]),
    )
    assert denied.status_code == 404


async def test_completed_putaway_tasks_are_newest_first(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayOrdering")
    second_item = await create_item(
        client,
        token,
        sku=f"PUT3-{uuid.uuid4().hex[:8].upper()}",
        name="Ordering Putaway Item",
    )
    created = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": receiving["id"],
            "lines": [
                {"item_id": item["id"], "qty": "1"},
                {"item_id": second_item["id"], "qty": "1"},
            ],
        },
    )
    assert created.status_code == 201, created.text
    committed = await client.post(
        f"/api/v1/receipts/{created.json()['id']}/commit",
        headers=auth(token),
    )
    assert committed.status_code == 200, committed.text

    tasks = (
        await client.get(
            "/api/v1/putaway/tasks",
            headers=auth(token),
            params={"receipt_id": committed.json()["id"]},
        )
    ).json()["tasks"]
    assert len(tasks) == 2

    first = await client.post(
        f"/api/v1/putaway/tasks/{tasks[0]['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert first.status_code == 200, first.text
    await asyncio.sleep(0.02)
    second = await client.post(
        f"/api/v1/putaway/tasks/{tasks[1]['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert second.status_code == 200, second.text

    newest = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"status": "completed", "limit": 1},
    )
    assert newest.status_code == 200, newest.text
    assert [task["id"] for task in newest.json()["tasks"]] == [tasks[1]["id"]]
    cursor = newest.json()["next_cursor"]
    assert cursor

    older = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"status": "completed", "limit": 1, "cursor": cursor},
    )
    assert older.status_code == 200, older.text
    assert [task["id"] for task in older.json()["tasks"]] == [tasks[0]["id"]]

    oldest_first = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"status": "completed", "order": "asc", "limit": 2},
    )
    assert oldest_first.status_code == 200, oldest_first.text
    assert [task["id"] for task in oldest_first.json()["tasks"]] == [
        tasks[0]["id"],
        tasks[1]["id"],
    ]


async def test_putaway_operator_can_read_queue_without_inventory_read(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayOnly")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "1"),
    )
    task = (
        await client.get(
            "/api/v1/putaway/tasks",
            headers=auth(token),
            params={"receipt_id": receipt["id"]},
        )
    ).json()["tasks"][0]

    role = await client.post(
        "/api/v1/members/roles",
        headers=auth(token),
        json={
            "name": "Putaway Only",
            "slug": "putaway_only",
            "description": "Moves received stock to storage",
            "permissions": ["stock.putaway"],
        },
    )
    assert role.status_code == 201, role.text

    member = await join_company(
        client,
        token,
        email=f"putaway-only-{uuid.uuid4().hex[:8]}@example.com",
        role="putaway_only",
    )
    member_token = member["access_token"]

    queue = await client.get("/api/v1/putaway/tasks", headers=auth(member_token))
    assert queue.status_code == 200, queue.text
    assert [entry["id"] for entry in queue.json()["tasks"]] == [task["id"]]

    detail = await client.get(
        f"/api/v1/putaway/tasks/{task['id']}",
        headers=auth(member_token),
    )
    assert detail.status_code == 200, detail.text

    completed = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(member_token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"

    # Put-away permission alone must not grant receipt creation.
    denied = await client.post(
        "/api/v1/receipts",
        headers={**auth(member_token), "Idempotency-Key": str(uuid.uuid4())},
        json=_receipt(warehouse, receiving, item, "1"),
    )
    assert denied.status_code == 403, denied.text


async def test_concurrent_putaway_completion_moves_stock_once(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayConcurrent")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "6"),
    )
    task = (
        await client.get(
            "/api/v1/putaway/tasks",
            headers=auth(token),
            params={"receipt_id": receipt["id"]},
        )
    ).json()["tasks"][0]

    responses = await asyncio.gather(
        *[
            client.post(
                f"/api/v1/putaway/tasks/{task['id']}/complete",
                headers=auth(token),
                json={"location_id": locations["BIN-01"]["id"]},
            )
            for _ in range(4)
        ]
    )
    assert all(response.status_code == 200 for response in responses), [
        response.text for response in responses
    ]
    assert {response.json()["status"] for response in responses} == {"completed"}

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
    assert len([row for row in movements.json()["movements"] if row["type"] == "putaway"]) == 1


async def _create_bin(
    client,
    token: str,
    warehouse_id: str,
    code: str,
    *,
    parent_id: str | None = None,
) -> dict:
    payload: dict = {
        "warehouse_id": warehouse_id,
        "code": code,
        "type": "bin",
        "is_pickable": True,
        "status": "active",
    }
    if parent_id:
        payload["parent_id"] = parent_id
    response = await client.post("/api/v1/locations", headers=auth(token), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _tasks(client, token: str, receipt_id: str, **params) -> list[dict]:
    response = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": receipt_id, **params},
    )
    assert response.status_code == 200, response.text
    return response.json()["tasks"]


async def _balances(client, token: str, item_id: str) -> list[dict]:
    response = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item_id},
    )
    assert response.status_code == 200, response.text
    return response.json()["balances"]


def _balance_at(balances: list[dict], location_id: str) -> Decimal:
    return sum(
        Decimal(balance["on_hand"])
        for balance in balances
        if balance["location_id"] == location_id
    )


class _FailingTaskCollection:
    """Delegate to the real collection but fail every task update."""

    def __init__(self, inner):
        self._inner = inner

    async def find_one_and_update(self, *args, **kwargs):
        return None

    def __getattr__(self, name):
        return getattr(self._inner, name)


async def test_partial_putaway_splits_across_bins_and_completes_at_zero(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayPartial")
    second_bin = await _create_bin(
        client,
        token,
        warehouse["id"],
        "BIN-02",
        parent_id=locations["MAIN"]["id"],
    )
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "10"),
    )
    task = (await _tasks(client, token, receipt["id"]))[0]
    assert Decimal(task["completed_qty"]) == Decimal("0")
    assert Decimal(task["remaining_qty"]) == Decimal("10")
    assert task["placements"] == []

    first = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"], "quantity": "4"},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["status"] == "pending"
    assert Decimal(first_body["completed_qty"]) == Decimal("4")
    assert Decimal(first_body["remaining_qty"]) == Decimal("6")
    assert first_body["to_location_id"] is None
    assert len(first_body["placements"]) == 1
    assert first_body["placements"][0]["location_code"] == "BIN-01"
    assert Decimal(first_body["placements"][0]["quantity"]) == Decimal("4")

    balances = await _balances(client, token, item["id"])
    assert _balance_at(balances, receiving["id"]) == Decimal("6")
    assert _balance_at(balances, locations["BIN-01"]["id"]) == Decimal("4")
    assert _balance_at(balances, second_bin["id"]) == Decimal("0")

    # The partially completed task remains in the pending queue.
    still_pending = await _tasks(client, token, receipt["id"])
    assert [entry["id"] for entry in still_pending] == [task["id"]]

    second = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": second_bin["id"], "quantity": "6"},
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["status"] == "completed"
    assert Decimal(second_body["completed_qty"]) == Decimal("10")
    assert Decimal(second_body["remaining_qty"]) == Decimal("0")
    assert second_body["to_location_code"] == "BIN-02"
    assert [placement["location_code"] for placement in second_body["placements"]] == [
        "BIN-01",
        "BIN-02",
    ]

    balances = await _balances(client, token, item["id"])
    assert _balance_at(balances, receiving["id"]) == Decimal("0")
    assert _balance_at(balances, locations["BIN-01"]["id"]) == Decimal("4")
    assert _balance_at(balances, second_bin["id"]) == Decimal("6")
    assert sum(Decimal(balance["on_hand"]) for balance in balances) == Decimal("10")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    putaway_movements = [
        row for row in movements.json()["movements"] if row["type"] == "putaway"
    ]
    assert sorted(
        Decimal(row["base_qty"]) for row in putaway_movements
    ) == [
        Decimal("4"),
        Decimal("6"),
    ]

    refreshed = await client.get(
        f"/api/v1/receipts/{receipt['id']}",
        headers=auth(token),
    )
    assert refreshed.json()["putaway_completed_at"] is not None

    audit_actions = await app.state.db.audit_events.distinct(
        "action",
        {"company_id": refreshed.json()["company_id"], "entity_id": task["id"]},
    )
    assert set(audit_actions) == {"putaway.partially_completed", "putaway.completed"}


async def test_partial_putaway_rejects_invalid_quantities(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayInvalidQty")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "10"),
    )
    task = (await _tasks(client, token, receipt["id"]))[0]

    for quantity in ("0", "-1", "10.0000001", "11"):
        response = await client.post(
            f"/api/v1/putaway/tasks/{task['id']}/complete",
            headers=auth(token),
            json={"location_id": locations["BIN-01"]["id"], "quantity": quantity},
        )
        assert response.status_code == 422, (quantity, response.text)

    unchanged = (
        await client.get(
            f"/api/v1/putaway/tasks/{task['id']}",
            headers=auth(token),
        )
    ).json()
    assert unchanged["status"] == "pending"
    assert Decimal(unchanged["completed_qty"]) == Decimal("0")
    assert Decimal(unchanged["remaining_qty"]) == Decimal("10")

    balances = await _balances(client, token, item["id"])
    assert _balance_at(balances, receiving["id"]) == Decimal("10")
    assert _balance_at(balances, locations["BIN-01"]["id"]) == Decimal("0")


async def test_putaway_rejects_when_source_stock_is_short(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayShort")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "3"),
    )
    task = (await _tasks(client, token, receipt["id"]))[0]

    database = app.state.db
    source_balance = await database.balances.find_one(
        {
            "item_id": item["id"],
            "location_id": receiving["id"],
            "stock_status": "available",
        }
    )
    assert source_balance is not None
    trimmed = await database.balances.update_one(
        {"_id": source_balance["_id"]},
        {"$set": {"on_hand": to_decimal128(1)}},
    )
    assert trimmed.modified_count == 1

    response = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"], "quantity": "2"},
    )
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "putaway_stock_unavailable"

    refreshed = (
        await client.get(
            f"/api/v1/putaway/tasks/{task['id']}",
            headers=auth(token),
        )
    ).json()
    assert refreshed["status"] == "pending"
    assert Decimal(refreshed["completed_qty"]) == Decimal("0")
    assert Decimal(refreshed["remaining_qty"]) == Decimal("3")

    balances = await _balances(client, token, item["id"])
    assert _balance_at(balances, receiving["id"]) == Decimal("1")
    assert _balance_at(balances, locations["BIN-01"]["id"]) == Decimal("0")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert [
        row for row in movements.json()["movements"] if row["type"] == "putaway"
    ] == []


async def test_serial_putaway_requires_matching_explicit_serial(client):
    registration = await register_company(client, "PutawaySerial")
    token = registration["access_token"]
    item = await create_item(
        client,
        token,
        sku=f"SER-{uuid.uuid4().hex[:8].upper()}",
        tracking_mode="serial",
    )
    warehouse = await create_warehouse(client, token)
    receiving = await default_location(client, token, warehouse["id"])
    locations = {
        location["code"]: location
        for location in (
            await client.get(
                "/api/v1/locations",
                headers=auth(token),
                params={"warehouse_id": warehouse["id"]},
            )
        ).json()["locations"]
    }
    receipt = await _create_and_commit(
        client,
        token,
        {
            "warehouse_id": warehouse["id"],
            "location_id": receiving["id"],
            "supplier": "Serial Supply",
            "lines": [
                {
                    "item_id": item["id"],
                    "qty": "2",
                    "serial_numbers": ["SN-A", "SN-B"],
                }
            ],
        },
    )
    tasks = await _tasks(client, token, receipt["id"])
    assert len(tasks) == 2
    task = next(entry for entry in tasks if entry["serial_no"] == "SN-A")
    other = next(entry for entry in tasks if entry["serial_no"] == "SN-B")

    missing = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "serial_selection_required"

    wrong = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={
            "location_id": locations["BIN-01"]["id"],
            "serial_ids": [other["serial_id"]],
        },
    )
    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "invalid_putaway_serial"

    completed = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={
            "location_id": locations["BIN-01"]["id"],
            "serial_ids": [task["serial_id"]],
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["serial_no"] == "SN-A"

    balances = await _balances(client, token, item["id"])
    destination_balance = next(
        balance
        for balance in balances
        if balance["location_id"] == locations["BIN-01"]["id"]
        and balance["serial_id"] == task["serial_id"]
    )
    assert Decimal(destination_balance["on_hand"]) == Decimal("1")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    putaway_movement = next(
        row for row in movements.json()["movements"] if row["type"] == "putaway"
    )
    assert putaway_movement["serial_id"] == task["serial_id"]
    assert putaway_movement["serial_no"] == "SN-A"

    receipt_before_second = await client.get(
        f"/api/v1/receipts/{receipt['id']}",
        headers=auth(token),
    )
    assert receipt_before_second.json()["putaway_completed_at"] is None

    second = await client.post(
        f"/api/v1/putaway/tasks/{other['id']}/complete",
        headers=auth(token),
        json={
            "location_id": locations["BIN-01"]["id"],
            "serial_ids": [other["serial_id"]],
        },
    )
    assert second.status_code == 200, second.text
    receipt_after_second = await client.get(
        f"/api/v1/receipts/{receipt['id']}",
        headers=auth(token),
    )
    assert receipt_after_second.json()["putaway_completed_at"] is not None


async def test_partial_putaway_preserves_lot_and_expiry(client):
    registration = await register_company(client, "PutawayLot")
    token = registration["access_token"]
    item = await create_item(
        client,
        token,
        sku=f"LOT-{uuid.uuid4().hex[:8].upper()}",
        tracking_mode="lot",
        expiry_tracked=True,
    )
    warehouse = await create_warehouse(client, token)
    receiving = await default_location(client, token, warehouse["id"])
    locations = {
        location["code"]: location
        for location in (
            await client.get(
                "/api/v1/locations",
                headers=auth(token),
                params={"warehouse_id": warehouse["id"]},
            )
        ).json()["locations"]
    }
    second_bin = await _create_bin(
        client,
        token,
        warehouse["id"],
        "LOT-BIN",
        parent_id=locations["MAIN"]["id"],
    )
    receipt = await _create_and_commit(
        client,
        token,
        {
            "warehouse_id": warehouse["id"],
            "location_id": receiving["id"],
            "supplier": "Lot Supply",
            "lines": [
                {
                    "item_id": item["id"],
                    "qty": "3",
                    "lot_no": "LOT-EXP-1",
                    "expiry_date": "2027-01-31",
                }
            ],
        },
    )
    task = (await _tasks(client, token, receipt["id"]))[0]
    assert task["lot_no"] == "LOT-EXP-1"
    assert task["expiry_date"] == "2027-01-31"

    first = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"], "quantity": "1"},
    )
    assert first.status_code == 200, first.text
    second = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": second_bin["id"], "quantity": "2"},
    )
    assert second.status_code == 200, second.text

    balances = await _balances(client, token, item["id"])
    for location_id in (locations["BIN-01"]["id"], second_bin["id"]):
        balance = next(
            row for row in balances if row["location_id"] == location_id
        )
        assert balance["lot_no"] == "LOT-EXP-1"
        assert balance["expiry_date"] == "2027-01-31"

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    putaway_movements = [
        row for row in movements.json()["movements"] if row["type"] == "putaway"
    ]
    assert len(putaway_movements) == 2
    assert all(row["lot_no"] == "LOT-EXP-1" for row in putaway_movements)
    assert all(row["expiry_date"] == "2027-01-31" for row in putaway_movements)


async def test_putaway_rejects_inactive_destination_and_unauthorized_location(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayDestScope")
    inactive_bin = await _create_bin(
        client,
        token,
        warehouse["id"],
        "INACTIVE-BIN",
        parent_id=locations["MAIN"]["id"],
    )
    blocked = await client.patch(
        f"/api/v1/locations/{inactive_bin['id']}",
        headers=auth(token),
        json={"status": "blocked"},
    )
    assert blocked.status_code == 200, blocked.text

    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "2"),
    )
    task = (await _tasks(client, token, receipt["id"]))[0]

    inactive = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": inactive_bin["id"], "quantity": "1"},
    )
    assert inactive.status_code == 422
    assert inactive.json()["error"]["code"] == "invalid_putaway_location"

    scoped = await join_company(
        client,
        token,
        email=f"putaway-dest-{uuid.uuid4().hex[:8]}@example.com",
        role="warehouse_operator",
        location_ids=[receiving["id"]],
    )
    unauthorized = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(scoped["access_token"]),
        json={"location_id": locations["BIN-01"]["id"], "quantity": "1"},
    )
    assert unauthorized.status_code == 403
    assert unauthorized.json()["error"]["code"] == "location_forbidden"


async def test_putaway_rolls_back_when_task_update_fails(client, monkeypatch):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayRollback")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "5"),
    )
    task = (await _tasks(client, token, receipt["id"]))[0]

    database = app.state.db
    failing = _FailingTaskCollection(database.putaway_tasks)
    monkeypatch.setattr(database, "putaway_tasks", failing)
    try:
        response = await client.post(
            f"/api/v1/putaway/tasks/{task['id']}/complete",
            headers=auth(token),
            json={"location_id": locations["BIN-01"]["id"], "quantity": "2"},
        )
    finally:
        monkeypatch.undo()

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "putaway_task_conflict"

    refreshed = (
        await client.get(
            f"/api/v1/putaway/tasks/{task['id']}",
            headers=auth(token),
        )
    ).json()
    assert refreshed["status"] == "pending"
    assert Decimal(refreshed["completed_qty"]) == Decimal("0")
    assert Decimal(refreshed["remaining_qty"]) == Decimal("5")

    balances = await _balances(client, token, item["id"])
    assert _balance_at(balances, receiving["id"]) == Decimal("5")
    assert _balance_at(balances, locations["BIN-01"]["id"]) == Decimal("0")

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert [
        row for row in movements.json()["movements"] if row["type"] == "putaway"
    ] == []


async def test_putaway_duplicate_request_key_moves_stock_once(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawayIdempotent")
    receipt = await _create_and_commit(
        client,
        token,
        _receipt(warehouse, receiving, item, "4"),
    )
    task = (await _tasks(client, token, receipt["id"]))[0]
    key = f"putaway-{uuid.uuid4()}"
    payload = {"location_id": locations["BIN-01"]["id"], "quantity": "2"}
    headers = {**auth(token), "Idempotency-Key": key}

    first = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=headers,
        json=payload,
    )
    assert first.status_code == 200, first.text
    repeated = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=headers,
        json=payload,
    )
    assert repeated.status_code == 200, repeated.text
    assert Decimal(repeated.json()["completed_qty"]) == Decimal("2")
    assert Decimal(repeated.json()["remaining_qty"]) == Decimal("2")

    conflict = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=headers,
        json={"location_id": locations["BIN-01"]["id"], "quantity": "3"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "putaway_idempotency_conflict"

    movements = await client.get(
        "/api/v1/movements",
        headers=auth(token),
        params={"item_id": item["id"]},
    )
    assert len([row for row in movements.json()["movements"] if row["type"] == "putaway"]) == 1


async def test_putaway_queue_search_and_filters(client):
    token, item, warehouse, receiving, locations = await _setup(client, "PutawaySearch")
    second_item = await create_item(
        client,
        token,
        sku=f"PUT-SEARCH-{uuid.uuid4().hex[:8].upper()}",
        name="Copper Coil",
    )
    barcode = f"BC-{uuid.uuid4().hex[:8].upper()}"
    patched = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(token),
        json={"barcode": barcode},
    )
    assert patched.status_code == 200, patched.text
    receipt = await _create_and_commit(
        client,
        token,
        {
            "warehouse_id": warehouse["id"],
            "location_id": receiving["id"],
            "supplier": "Search Supply",
            "lines": [
                {"item_id": item["id"], "qty": "2"},
                {"item_id": second_item["id"], "qty": "3"},
            ],
        },
    )
    tasks = await _tasks(client, token, receipt["id"])
    assert len(tasks) == 2
    target = next(entry for entry in tasks if entry["item_id"] == item["id"])

    by_receipt = await _tasks(client, token, receipt["id"], search=receipt["number"])
    assert len(by_receipt) == 2

    by_sku = await _tasks(client, token, receipt["id"], search=item["sku"])
    assert [entry["id"] for entry in by_sku] == [target["id"]]

    by_name = await _tasks(client, token, receipt["id"], search="Copper Coil")
    assert [entry["item_id"] for entry in by_name] == [second_item["id"]]

    by_barcode = await _tasks(client, token, receipt["id"], search=barcode)
    assert [entry["id"] for entry in by_barcode] == [target["id"]]

    by_source = await _tasks(client, token, receipt["id"], search="RECV")
    assert len(by_source) == 2

    by_warehouse = await _tasks(
        client, token, receipt["id"], warehouse_id=warehouse["id"]
    )
    assert len(by_warehouse) == 2
    other_warehouse = await create_warehouse(client, token, "Empty Warehouse")
    empty = await _tasks(
        client, token, receipt["id"], warehouse_id=other_warehouse["id"]
    )
    assert empty == []

    by_source_location = await _tasks(
        client, token, receipt["id"], from_location_id=receiving["id"]
    )
    assert len(by_source_location) == 2

    completed = await client.post(
        f"/api/v1/putaway/tasks/{target['id']}/complete",
        headers=auth(token),
        json={"location_id": locations["BIN-01"]["id"]},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"

    by_destination = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={
            "receipt_id": receipt["id"],
            "status": "completed",
            "search": "BIN-01",
        },
    )
    assert by_destination.status_code == 200, by_destination.text
    assert [entry["id"] for entry in by_destination.json()["tasks"]] == [target["id"]]

    remaining_pending = await _tasks(client, token, receipt["id"])
    assert len(remaining_pending) == 1
    assert remaining_pending[0]["id"] != target["id"]


async def test_putaway_queue_and_completion_respect_inventory_owner_scope(client):
    registration = await register_company(client, "PutawayOwners")
    token = registration["access_token"]
    hybrid = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "hybrid"},
    )
    assert hybrid.status_code == 200, hybrid.text

    def create_client(code: str, name: str):
        return client.post(
            "/api/v1/clients",
            headers=auth(token),
            json={"code": code, "name": name},
        )

    owner_a = (await create_client("OWN-A", "Owner Alpha")).json()
    owner_b = (await create_client("OWN-B", "Owner Beta")).json()
    item_a = await create_item(
        client,
        token,
        sku=f"OWN-A-{uuid.uuid4().hex[:6].upper()}",
        client_id=owner_a["id"],
    )
    item_b = await create_item(
        client,
        token,
        sku=f"OWN-B-{uuid.uuid4().hex[:6].upper()}",
        client_id=owner_b["id"],
    )
    warehouse = await create_warehouse(client, token)
    receiving = await default_location(client, token, warehouse["id"])
    locations = {
        location["code"]: location
        for location in (
            await client.get(
                "/api/v1/locations",
                headers=auth(token),
                params={"warehouse_id": warehouse["id"]},
            )
        ).json()["locations"]
    }
    receipt_a = await _create_and_commit(
        client,
        token,
        {**_receipt(warehouse, receiving, item_a, "2"), "client_id": owner_a["id"]},
    )
    receipt_b = await _create_and_commit(
        client,
        token,
        {**_receipt(warehouse, receiving, item_b, "2"), "client_id": owner_b["id"]},
    )
    task_a = (await _tasks(client, token, receipt_a["id"]))[0]
    task_b = (await _tasks(client, token, receipt_b["id"]))[0]

    email = f"putaway-owner-{uuid.uuid4().hex[:8]}@example.com"
    invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={
            "email": email,
            "role": "warehouse_operator",
            "client_ids": [owner_a["id"]],
        },
    )
    assert invitation.status_code == 201, invitation.text
    member = await accept_invitation(
        client,
        invitation.json()["invitation_token"],
        email,
    )
    member_token = member["access_token"]

    scoped_queue = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(member_token),
    )
    assert scoped_queue.status_code == 200, scoped_queue.text
    assert {entry["id"] for entry in scoped_queue.json()["tasks"]} == {task_a["id"]}

    other_owner_filter = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(member_token),
        params={"client_id": owner_b["id"]},
    )
    assert other_owner_filter.status_code == 200, other_owner_filter.text
    assert other_owner_filter.json()["tasks"] == []

    all_owner_literal = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(member_token),
        params={"client_id": "all"},
    )
    assert all_owner_literal.status_code == 200, all_owner_literal.text
    assert all_owner_literal.json()["tasks"] == []

    denied = await client.post(
        f"/api/v1/putaway/tasks/{task_b['id']}/complete",
        headers=auth(member_token),
        json={"location_id": locations["BIN-01"]["id"], "quantity": "1"},
    )
    assert denied.status_code == 404, denied.text
    assert denied.json()["error"]["code"] == "putaway_task_not_found"

    allowed = await client.post(
        f"/api/v1/putaway/tasks/{task_a['id']}/complete",
        headers=auth(member_token),
        json={"location_id": locations["BIN-01"]["id"], "quantity": "1"},
    )
    assert allowed.status_code == 200, allowed.text
    assert Decimal(allowed.json()["remaining_qty"]) == Decimal("1")

    balances_a = await _balances(client, token, item_a["id"])
    assert _balance_at(balances_a, locations["BIN-01"]["id"]) == Decimal("1")
    balances_b = await _balances(client, token, item_b["id"])
    assert _balance_at(balances_b, locations["BIN-01"]["id"]) == Decimal("0")
