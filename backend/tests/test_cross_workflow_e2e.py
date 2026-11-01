import uuid
from decimal import Decimal

from .utils import (
    auth,
    create_item,
    create_warehouse,
    default_location,
    register_company,
)


def _make_line(item_id: str, qty: str = "1", **kwargs) -> dict:
    return {"item_id": item_id, "qty": qty, **kwargs}


async def test_scenario_a_internal_inventory_workflow(client):
    """Scenario A: Internal inventory

    1. Create supplier.
    2. Create item.
    3. Create warehouse and receiving/storage locations.
    4. Create receipt using those records.
    5. Commit receipt into staging.
    6. Verify putaway task.
    7. Complete putaway into a valid bin.
    8. Verify final stock quantity and movement history.
    """
    registration = await register_company(client, "ScenA")
    token = registration["access_token"]

    # 1. Create Supplier
    sup_code = f"SUP-{uuid.uuid4().hex[:6].upper()}"
    sup_res = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "name": "Global Fasteners Ltd",
            "code": sup_code,
            "types": ["supplier"],
            "contact_phone": "+1 555 0199",
        },
    )
    assert sup_res.status_code == 201, sup_res.text
    supplier = sup_res.json()
    assert "supplier" in supplier["types"]

    # 2. Create Item
    item_sku = f"BOLT-{uuid.uuid4().hex[:6].upper()}"
    item = await create_item(client, token, sku=item_sku, name="M10 High-Tensile Bolt")

    # 3. Create Warehouse and retrieve locations
    wh = await create_warehouse(client, token, name="Distribution Hub A")
    locs_res = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh["id"]},
    )
    assert locs_res.status_code == 200, locs_res.text
    all_locations = locs_res.json()["locations"]
    staging_loc = next(loc for loc in all_locations if loc["type"] in ("receiving", "staging"))
    storage_loc = next(loc for loc in all_locations if loc["type"] in ("main", "storage", "bin"))

    # 4. Create Receipt into Staging referencing supplier
    key = str(uuid.uuid4())
    create_receipt_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": key},
        json={
            "warehouse_id": wh["id"],
            "location_id": staging_loc["id"],
            "supplier_id": supplier["id"],
            "supplier": supplier["name"],
            "purchase_order": "PO-2026-001",
            "lines": [_make_line(item["id"], "50")],
        },
    )
    assert create_receipt_res.status_code == 201, create_receipt_res.text
    receipt = create_receipt_res.json()
    assert receipt["status"] == "draft"
    assert receipt["supplier_id"] == supplier["id"]
    assert receipt["supplier"] == supplier["name"]

    # 5. Commit Receipt into Staging
    commit_res = await client.post(
        f"/api/v1/receipts/{receipt['id']}/commit",
        headers=auth(token),
    )
    assert commit_res.status_code == 200, commit_res.text
    committed_receipt = commit_res.json()
    assert committed_receipt["status"] == "applied"
    assert committed_receipt["putaway_required"] is True

    # 6. Verify Putaway Task generated
    tasks_res = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": receipt["id"], "status": "pending"},
    )
    assert tasks_res.status_code == 200, tasks_res.text
    tasks = tasks_res.json()["tasks"]
    assert len(tasks) == 1
    task = tasks[0]
    assert task["receipt_id"] == receipt["id"]
    assert task["item_id"] == item["id"]
    assert Decimal(str(task["base_qty"])) == Decimal("50")
    assert task["from_location_id"] == staging_loc["id"]

    # 7. Complete Putaway into valid Storage bin
    complete_res = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": storage_loc["id"]},
    )
    assert complete_res.status_code == 200, complete_res.text
    completed_task = complete_res.json()
    assert completed_task["status"] == "completed"
    assert completed_task["to_location_id"] == storage_loc["id"]

    # 8. Verify final stock quantity and movement history
    bal_res = await client.get("/api/v1/balances", headers=auth(token))
    assert bal_res.status_code == 200, bal_res.text
    balances = bal_res.json()["balances"]

    staging_bal = next(
        (b for b in balances if b["item_id"] == item["id"] and b["location_id"] == staging_loc["id"]),
        None,
    )
    storage_bal = next(
        (b for b in balances if b["item_id"] == item["id"] and b["location_id"] == storage_loc["id"]),
        None,
    )
    assert staging_bal is None or Decimal(str(staging_bal["on_hand"])) == Decimal("0")
    assert storage_bal is not None
    assert Decimal(str(storage_bal["on_hand"])) == Decimal("50")

    # Verify movement history contains both receipt and putaway
    mov_res = await client.get("/api/v1/movements", headers=auth(token))
    assert mov_res.status_code == 200, mov_res.text
    movements = mov_res.json()["movements"]
    item_movements = [m for m in movements if m["item_id"] == item["id"]]
    assert len(item_movements) >= 2
    types = {m["type"] for m in item_movements}
    assert "receipt" in types
    assert "putaway" in types


async def test_scenario_b_direct_storage(client):
    """Scenario B: Direct storage

    1. Receive an existing item directly into a storage bin.
    2. Verify no putaway task is created.
    3. Verify correct stock balance immediately on hand.
    """
    registration = await register_company(client, "ScenB")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"DIRECT-{uuid.uuid4().hex[:6].upper()}")
    wh = await create_warehouse(client, token, name="Bulk Facility")

    locs_res = await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": wh["id"]})
    storage_loc = next(l for l in locs_res.json()["locations"] if l["type"] in ("main", "storage", "bin"))

    receipt_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": wh["id"],
            "location_id": storage_loc["id"],
            "supplier": "Direct Vendor",
            "lines": [_make_line(item["id"], "25")],
        },
    )
    assert receipt_res.status_code == 201, receipt_res.text
    receipt = receipt_res.json()

    commit_res = await client.post(f"/api/v1/receipts/{receipt['id']}/commit", headers=auth(token))
    assert commit_res.status_code == 200, commit_res.text
    committed = commit_res.json()
    assert committed["putaway_required"] is False

    # Verify NO putaway tasks exist
    tasks_res = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": receipt["id"]},
    )
    assert tasks_res.status_code == 200, tasks_res.text
    assert len(tasks_res.json()["tasks"]) == 0

    # Verify balance is on hand in storage_loc
    bal_res = await client.get("/api/v1/balances", headers=auth(token))
    storage_bal = next(
        b for b in bal_res.json()["balances"] if b["item_id"] == item["id"] and b["location_id"] == storage_loc["id"]
    )
    assert Decimal(str(storage_bal["on_hand"])) == Decimal("25")


async def test_scenario_c_3pl_owner_isolation(client):
    """Scenario C: 3PL

    1. Select an authorized inventory owner.
    2. Receive owner-specific stock from a supplier.
    3. Complete putaway.
    4. Verify owner isolation and permissions.
    """
    registration = await register_company(client, "ScenC")
    token = registration["access_token"]

    # Configure company as 3PL
    patch_res = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "3pl"},
    )
    assert patch_res.status_code == 200, patch_res.text

    # Create 3PL Client (Inventory Owner)
    owner_res = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"name": "Logistics Client X", "code": "CLX-01", "types": ["3pl_client"]},
    )
    assert owner_res.status_code == 201, owner_res.text
    owner = owner_res.json()

    # Create Item owned by this 3PL client
    item = await create_item(
        client,
        token,
        sku=f"3PL-{uuid.uuid4().hex[:6].upper()}",
        client_id=owner["id"],
    )

    # Create Warehouse
    wh = await create_warehouse(client, token, name="3PL Central")
    locs_res = await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": wh["id"]})
    staging_loc = next(l for l in locs_res.json()["locations"] if l["type"] in ("receiving", "staging"))
    storage_loc = next(l for l in locs_res.json()["locations"] if l["type"] in ("main", "storage", "bin"))

    # Receive stock for specific owner
    receipt_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "client_id": owner["id"],
            "warehouse_id": wh["id"],
            "location_id": staging_loc["id"],
            "supplier": "Third Party Vendor",
            "lines": [_make_line(item["id"], "10")],
        },
    )
    assert receipt_res.status_code == 201, receipt_res.text
    receipt = receipt_res.json()
    assert receipt["client_id"] == owner["id"]

    # Commit receipt
    commit_res = await client.post(f"/api/v1/receipts/{receipt['id']}/commit", headers=auth(token))
    assert commit_res.status_code == 200, commit_res.text

    # Complete putaway
    tasks_res = await client.get("/api/v1/putaway/tasks", headers=auth(token), params={"receipt_id": receipt["id"]})
    task = tasks_res.json()["tasks"][0]
    assert task["client_id"] == owner["id"]

    complete_res = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": storage_loc["id"]},
    )
    assert complete_res.status_code == 200, complete_res.text

    # Verify owner isolation: stock balance carries client_id
    bal_res = await client.get("/api/v1/balances", headers=auth(token), params={"client_id": owner["id"]})
    owner_bals = [b for b in bal_res.json()["balances"] if Decimal(str(b["on_hand"])) > 0]
    assert len(owner_bals) == 1
    assert owner_bals[0]["client_id"] == owner["id"]
    assert owner_bals[0]["location_id"] == storage_loc["id"]
    assert Decimal(str(owner_bals[0]["on_hand"])) == Decimal("10")


async def test_scenario_d_validation_and_integrity(client):
    """Scenario D: Validation and navigation constraints

    - Invalid / all-owners rejected as transaction owner.
    - Inactive items are rejected.
    - Repeated commits do not duplicate stock.
    - Putaway destination cannot be staging/receiving.
    """
    registration = await register_company(client, "ScenD")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"VAL-{uuid.uuid4().hex[:6].upper()}")
    wh = await create_warehouse(client, token, name="Validation WH")
    locs = (await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": wh["id"]})).json()["locations"]
    staging_loc = next(l for l in locs if l["type"] in ("receiving", "staging"))
    storage_loc = next(l for l in locs if l["type"] in ("main", "storage", "bin"))

    # 1. "all" as client_id is rejected
    bad_owner_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "client_id": "all",
            "warehouse_id": wh["id"],
            "location_id": staging_loc["id"],
            "lines": [_make_line(item["id"], "5")],
        },
    )
    assert bad_owner_res.status_code in (404, 422), bad_owner_res.text

    # 2. Archive item and verify receiving is rejected
    archive_res = await client.patch(f"/api/v1/items/{item['id']}", headers=auth(token), json={"status": "archived"})
    assert archive_res.status_code == 200, archive_res.text

    archived_receive_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": wh["id"],
            "location_id": staging_loc["id"],
            "lines": [_make_line(item["id"], "5")],
        },
    )
    assert archived_receive_res.status_code in (404, 422), archived_receive_res.text

    # Reactivate item
    await client.patch(f"/api/v1/items/{item['id']}", headers=auth(token), json={"status": "active"})

    # 3. Create valid receipt and test repeated commits idempotency
    key = str(uuid.uuid4())
    rcv_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": key},
        json={
            "warehouse_id": wh["id"],
            "location_id": staging_loc["id"],
            "lines": [_make_line(item["id"], "10")],
        },
    )
    receipt_id = rcv_res.json()["id"]

    commit1 = await client.post(f"/api/v1/receipts/{receipt_id}/commit", headers=auth(token))
    assert commit1.status_code == 200, commit1.text

    # Repeated commit should be idempotent and not create duplicate balance or tasks
    commit2 = await client.post(f"/api/v1/receipts/{receipt_id}/commit", headers=auth(token))
    assert commit2.status_code in (200, 409), commit2.text

    bal_res = await client.get("/api/v1/balances", headers=auth(token))
    item_bals = [b for b in bal_res.json()["balances"] if b["item_id"] == item["id"]]
    total_on_hand = sum(Decimal(str(b["on_hand"])) for b in item_bals)
    assert total_on_hand == Decimal("10")  # Exactly 10, not 20!

    # 4. Putaway task cannot be put away back into receiving or staging
    tasks = (await client.get("/api/v1/putaway/tasks", headers=auth(token), params={"receipt_id": receipt_id})).json()["tasks"]
    assert len(tasks) == 1
    task_id = tasks[0]["id"]

    bad_putaway = await client.post(
        f"/api/v1/putaway/tasks/{task_id}/complete",
        headers=auth(token),
        json={"location_id": staging_loc["id"]},
    )
    assert bad_putaway.status_code == 422
