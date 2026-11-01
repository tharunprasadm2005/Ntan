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


def _make_line(item_id: str, qty: str = "1", **kwargs) -> dict:
    return {"item_id": item_id, "qty": qty, **kwargs}


async def test_single_and_multi_item_receiving(client):
    registration = await register_company(client, "SingleMulti")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])

    item1 = await create_item(client, token, sku=f"IT1-{uuid.uuid4().hex[:6].upper()}")
    item2 = await create_item(client, token, sku=f"IT2-{uuid.uuid4().hex[:6].upper()}")

    # 1. Single-item receiving
    single_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "supplier": "Apex Distribution",
            "lines": [_make_line(item1["id"], "5")],
        },
    )
    assert single_res.status_code == 201, single_res.text
    single_draft = single_res.json()
    assert single_draft["status"] == "draft"
    assert len(single_draft["lines"]) == 1

    single_commit = await client.post(
        f"/api/v1/receipts/{single_draft['id']}/commit",
        headers=auth(token),
    )
    assert single_commit.status_code == 200, single_commit.text
    assert single_commit.json()["status"] == "applied"

    # Verify balance
    b1 = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item1["id"]})
    assert Decimal(b1.json()["balances"][0]["on_hand"]) == Decimal("5")

    # 2. Multi-item receiving with discrepancy note
    multi_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "supplier": "Apex Distribution",
            "purchase_order": "PO-9912",
            "lines": [
                _make_line(item1["id"], "3", discrepancy_reason="Checked and verified"),
                _make_line(item2["id"], "10", discrepancy_reason="Full carton"),
            ],
        },
    )
    assert multi_res.status_code == 201, multi_res.text
    multi_draft = multi_res.json()
    assert len(multi_draft["lines"]) == 2

    multi_commit = await client.post(
        f"/api/v1/receipts/{multi_draft['id']}/commit",
        headers=auth(token),
    )
    assert multi_commit.status_code == 200, multi_commit.text
    assert multi_commit.json()["status"] == "applied"

    # Total item1 should now be 5 + 3 = 8
    b1_updated = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item1["id"]})
    assert Decimal(b1_updated.json()["balances"][0]["on_hand"]) == Decimal("8")

    # Item2 balance should be 10
    b2 = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item2["id"]})
    assert Decimal(b2.json()["balances"][0]["on_hand"]) == Decimal("10")


async def test_draft_lifecycle_and_cancellation(client):
    registration = await register_company(client, "DraftLifecycle")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    item = await create_item(client, token, sku=f"DRF-{uuid.uuid4().hex[:6].upper()}")

    # Create draft
    draft_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "supplier": "Cancel Supply",
            "lines": [_make_line(item["id"], "4")],
        },
    )
    assert draft_res.status_code == 201
    draft = draft_res.json()
    assert draft["status"] == "draft"

    # Cancel draft
    cancel_res = await client.post(
        f"/api/v1/receipts/{draft['id']}/cancel",
        headers=auth(token),
    )
    assert cancel_res.status_code == 200, cancel_res.text
    assert cancel_res.json()["status"] == "cancelled"

    # Verify cancelled draft cannot be committed
    commit_attempt = await client.post(
        f"/api/v1/receipts/{draft['id']}/commit",
        headers=auth(token),
    )
    assert commit_attempt.status_code == 409
    assert commit_attempt.json()["error"]["code"] == "receipt_not_committable"

    # Balances must remain 0
    balances = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item["id"]})
    assert len(balances.json()["balances"]) == 0


async def test_duplicate_serial_rejection(client):
    registration = await register_company(client, "DupSerials")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    item = await create_item(
        client,
        token,
        sku=f"SER-{uuid.uuid4().hex[:6].upper()}",
        tracking_mode="serial",
    )

    # 1. Duplicate within the same line
    dup_within_line = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [
                {
                    "item_id": item["id"],
                    "qty": "2",
                    "serial_numbers": ["SN-100", "SN-100"],
                }
            ],
        },
    )
    assert dup_within_line.status_code == 422
    assert dup_within_line.json()["error"]["code"] == "duplicate_serial"

    # 2. Duplicate across different lines in the same receipt
    dup_across_lines = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [
                {
                    "item_id": item["id"],
                    "qty": "1",
                    "serial_numbers": ["SN-200"],
                },
                {
                    "item_id": item["id"],
                    "qty": "1",
                    "serial_numbers": ["SN-200"],
                },
            ],
        },
    )
    assert dup_across_lines.status_code == 422
    assert dup_across_lines.json()["error"]["code"] == "duplicate_serial"

    # 3. Successful receive of SN-200
    valid_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [
                {
                    "item_id": item["id"],
                    "qty": "1",
                    "serial_numbers": ["SN-200"],
                }
            ],
        },
    )
    assert valid_res.status_code == 201
    await client.post(f"/api/v1/receipts/{valid_res.json()['id']}/commit", headers=auth(token))

    # 4. Attempt to receive existing serial SN-200 again in a new receipt
    existing_serial_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [
                {
                    "item_id": item["id"],
                    "qty": "1",
                    "serial_numbers": ["SN-200"],
                }
            ],
        },
    )
    assert existing_serial_res.status_code == 422
    assert existing_serial_res.json()["error"]["code"] == "duplicate_serial"


async def test_insufficient_permissions(client):
    registration = await register_company(client, "PermCheck")
    owner_token = registration["access_token"]
    warehouse = await create_warehouse(client, owner_token)
    location = await default_location(client, owner_token, warehouse["id"])
    item = await create_item(client, owner_token, sku=f"NOAUTH-{uuid.uuid4().hex[:6].upper()}")

    # Join as viewer (only inventory.read, not stock.receive)
    viewer = await join_company(
        client,
        owner_token,
        email=f"viewer-{uuid.uuid4().hex[:6]}@example.com",
        role="viewer",
    )
    viewer_token = viewer["access_token"]

    response = await client.post(
        "/api/v1/receipts",
        headers={**auth(viewer_token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "lines": [_make_line(item["id"], "1")],
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


async def test_invalid_warehouse_and_inventory_owner(client):
    registration = await register_company(client, "ScopeCheck")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"SCP-{uuid.uuid4().hex[:6].upper()}")

    # Non-existent warehouse
    invalid_wh = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": f"wh-{uuid.uuid4().hex[:8]}",
            "location_id": f"loc-{uuid.uuid4().hex[:8]}",
            "lines": [_make_line(item["id"], "1")],
        },
    )
    assert invalid_wh.status_code == 422
    assert invalid_wh.json()["error"]["code"] == "invalid_warehouse"

    # Non-existent client / inventory owner
    real_wh = await create_warehouse(client, token)
    real_loc = await default_location(client, token, real_wh["id"])

    invalid_owner = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "client_id": f"cli-{uuid.uuid4().hex[:8]}",
            "warehouse_id": real_wh["id"],
            "location_id": real_loc["id"],
            "lines": [_make_line(item["id"], "1")],
        },
    )
    assert invalid_owner.status_code == 422
    assert invalid_owner.json()["error"]["code"] == "invalid_client"


async def test_staging_receipt_creates_putaway(client):
    registration = await register_company(client, "StagingPutaway")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token)

    # Fetch locations: RECV is receiving/staging type
    loc_res = await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": warehouse["id"]})
    recv_loc = next(l for l in loc_res.json()["locations"] if l["type"] == "receiving")
    item = await create_item(client, token, sku=f"STG-{uuid.uuid4().hex[:6].upper()}")

    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": recv_loc["id"],
            "lines": [_make_line(item["id"], "7")],
        },
    )
    assert draft.status_code == 201
    assert draft.json()["putaway_required"] is True

    committed = await client.post(f"/api/v1/receipts/{draft.json()['id']}/commit", headers=auth(token))
    assert committed.status_code == 200
    assert committed.json()["putaway_required"] is True
    assert committed.json()["putaway_completed_at"] is None

    # Verify putaway task was generated
    tasks_res = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": draft.json()["id"]},
    )
    assert tasks_res.status_code == 200
    tasks = tasks_res.json()["tasks"]
    assert len(tasks) == 1
    assert Decimal(tasks[0]["base_qty"]) == Decimal("7")
    assert tasks[0]["status"] == "pending"


async def test_direct_storage_receipt_no_putaway(client):
    registration = await register_company(client, "DirectStorage")
    token = registration["access_token"]
    warehouse = await create_warehouse(client, token)

    # Fetch locations: BIN-01 is bin type (not receiving/staging)
    loc_res = await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": warehouse["id"]})
    bin_loc = next(l for l in loc_res.json()["locations"] if l["type"] == "bin")
    item = await create_item(client, token, sku=f"DIR-{uuid.uuid4().hex[:6].upper()}")

    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": bin_loc["id"],
            "lines": [_make_line(item["id"], "12")],
        },
    )
    assert draft.status_code == 201
    assert draft.json()["putaway_required"] is False

    committed = await client.post(f"/api/v1/receipts/{draft.json()['id']}/commit", headers=auth(token))
    assert committed.status_code == 200
    assert committed.json()["putaway_required"] is False

    # Verify NO putaway tasks exist
    tasks_res = await client.get(
        "/api/v1/putaway/tasks",
        headers=auth(token),
        params={"receipt_id": draft.json()["id"]},
    )
    assert tasks_res.status_code == 200
    assert len(tasks_res.json()["tasks"]) == 0

    # Stock is directly on hand in BIN-01
    bal_res = await client.get(
        "/api/v1/balances",
        headers=auth(token),
        params={"item_id": item["id"], "location_id": bin_loc["id"]},
    )
    assert bal_res.status_code == 200
    assert Decimal(bal_res.json()["balances"][0]["on_hand"]) == Decimal("12")
    assert Decimal(bal_res.json()["balances"][0]["available"]) == Decimal("12")
