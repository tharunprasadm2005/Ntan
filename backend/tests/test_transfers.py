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


async def _setup_stock(client, label="Transfer"):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"SKU-{uuid.uuid4().hex[:8].upper()}")
    warehouse1 = await create_warehouse(client, token, name="Warehouse North")
    warehouse2 = await create_warehouse(client, token, name="Warehouse South")

    resp1 = await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": warehouse1["id"]})
    assert resp1.status_code == 200
    w1_locs = resp1.json()["locations"]
    w1_recv = next(loc for loc in w1_locs if loc["code"] == "RECV")
    w1_main = next(loc for loc in w1_locs if loc["code"] == "MAIN")

    resp2 = await client.get("/api/v1/locations", headers=auth(token), params={"warehouse_id": warehouse2["id"]})
    assert resp2.status_code == 200
    w2_locs = resp2.json()["locations"]
    w2_main = next(loc for loc in w2_locs if loc["code"] == "MAIN")

    # Inbound receipt to stock w1_recv with 10 units
    receipt_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": f"rcpt-{uuid.uuid4()}"},
        json={
            "warehouse_id": warehouse1["id"],
            "location_id": w1_recv["id"],
            "supplier": "Acme Industrial",
            "lines": [{"item_id": item["id"], "qty": "10"}],
        },
    )
    assert receipt_res.status_code == 201
    rcpt = receipt_res.json()

    commit_res = await client.post(
        f"/api/v1/receipts/{rcpt['id']}/commit",
        headers={**auth(token), "Idempotency-Key": f"commit-{uuid.uuid4()}"},
    )
    assert commit_res.status_code == 200

    return {
        "registration": registration,
        "token": token,
        "item": item,
        "w1": warehouse1,
        "w1_recv": w1_recv,
        "w1_main": w1_main,
        "w2": warehouse2,
        "w2_main": w2_main,
    }


async def test_bin_to_bin_transfer_success(client):
    env = await _setup_stock(client, "BinTransfer")
    token = env["token"]
    item = env["item"]

    # 1. Create draft bin-to-bin transfer (same warehouse)
    create_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "note": "Re-slotting to storage bin",
            "lines": [{"item_id": item["id"], "qty": "4"}],
        },
    )
    assert create_res.status_code == 201, create_res.text
    transfer = create_res.json()
    assert transfer["status"] == "draft"
    assert transfer["transfer_type"] == "bin_to_bin"
    assert len(transfer["lines"]) == 1
    assert transfer["lines"][0]["qty"] == "4"

    # 2. Confirm transfer
    confirm_res = await client.post(
        f"/api/v1/transfers/{transfer['id']}/confirm",
        headers=auth(token),
    )
    assert confirm_res.status_code == 200, confirm_res.text
    completed = confirm_res.json()
    assert completed["status"] == "completed"
    assert completed["completed_at"] is not None

    # 3. Verify balances
    b_res = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item["id"]})
    assert b_res.status_code == 200
    balances = b_res.json()["balances"]

    src_balance = next(b for b in balances if b["location_id"] == env["w1_recv"]["id"])
    dest_balance = next(b for b in balances if b["location_id"] == env["w1_main"]["id"])

    assert Decimal(src_balance["on_hand"]) == Decimal("6")  # 10 - 4
    assert Decimal(dest_balance["on_hand"]) == Decimal("4")  # 0 + 4


async def test_cross_warehouse_transfer_lifecycle(client):
    env = await _setup_stock(client, "CrossWH")
    token = env["token"]
    item = env["item"]

    # 1. Create cross-warehouse transfer draft
    create_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w2"]["id"],
            "to_location_id": env["w2_main"]["id"],
            "note": "Inter-facility replenishment",
            "lines": [{"item_id": item["id"], "qty": "3"}],
        },
    )
    assert create_res.status_code == 201
    transfer = create_res.json()
    assert transfer["status"] == "draft"
    assert transfer["transfer_type"] == "cross_warehouse"

    # 2. Confirm / Dispatch from source
    dispatch_res = await client.post(
        f"/api/v1/transfers/{transfer['id']}/confirm",
        headers=auth(token),
    )
    assert dispatch_res.status_code == 200
    dispatched = dispatch_res.json()
    assert dispatched["status"] == "in_transit"
    assert dispatched["dispatched_at"] is not None

    # Source stock decreased
    b1_res = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item["id"]})
    balances1 = b1_res.json()["balances"]
    src_balance = next(b for b in balances1 if b["location_id"] == env["w1_recv"]["id"])
    assert Decimal(src_balance["on_hand"]) == Decimal("7")  # 10 - 3

    # Destination stock NOT credited yet
    dest_b1 = next((b for b in balances1 if b["location_id"] == env["w2_main"]["id"]), None)
    assert dest_b1 is None or Decimal(dest_b1["on_hand"]) == Decimal("0")

    # 3. Receive at destination warehouse
    receive_res = await client.post(
        f"/api/v1/transfers/{transfer['id']}/receive",
        headers=auth(token),
    )
    assert receive_res.status_code == 200
    received = receive_res.json()
    assert received["status"] == "completed"
    assert received["completed_at"] is not None

    # Destination stock now credited
    b2_res = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item["id"]})
    balances2 = b2_res.json()["balances"]
    dest_b2 = next(b for b in balances2 if b["location_id"] == env["w2_main"]["id"])
    assert Decimal(dest_b2["on_hand"]) == Decimal("3")


async def test_insufficient_stock_rejection(client):
    env = await _setup_stock(client, "LowStock")
    token = env["token"]
    item = env["item"]

    # Available is 10, requesting 15
    res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": item["id"], "qty": "15"}],
        },
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "insufficient_available_stock"


async def test_identical_locations_rejection(client):
    env = await _setup_stock(client, "SameLoc")
    token = env["token"]
    item = env["item"]

    res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_recv"]["id"],
            "lines": [{"item_id": item["id"], "qty": "1"}],
        },
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "identical_locations"


async def test_cancel_draft_without_stock_changes(client):
    env = await _setup_stock(client, "CancelDraft")
    token = env["token"]
    item = env["item"]

    create_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": item["id"], "qty": "2"}],
        },
    )
    assert create_res.status_code == 201
    transfer = create_res.json()

    cancel_res = await client.post(
        f"/api/v1/transfers/{transfer['id']}/cancel",
        headers=auth(token),
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "cancelled"

    # Balances are unchanged
    b_res = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": item["id"]})
    src_balance = next(b for b in b_res.json()["balances"] if b["location_id"] == env["w1_recv"]["id"])
    assert Decimal(src_balance["on_hand"]) == Decimal("10")


async def test_transfer_permission_and_warehouse_scoping(client):
    env = await _setup_stock(client, "ScopePerm")
    token = env["token"]
    item = env["item"]

    # Join user with 'viewer' role (lacks stock.transfer)
    joined = await join_company(client, token, email=f"viewer-{uuid.uuid4().hex[:6]}@example.com", role="viewer")
    viewer_token = joined["access_token"]

    # Viewer should be denied creating transfer (403)
    denied_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(viewer_token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": item["id"], "qty": "1"}],
        },
    )
    assert denied_res.status_code == 403
    assert denied_res.json()["error"]["code"] == "forbidden"


async def test_idempotency_and_repeated_confirm(client):
    env = await _setup_stock(client, "IdempTransfer")
    token = env["token"]
    item = env["item"]
    idemp_key = f"tr-key-{uuid.uuid4()}"

    # 1. Create with key
    create_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": idemp_key},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": item["id"], "qty": "2"}],
        },
    )
    assert create_res.status_code == 201
    transfer_id = create_res.json()["id"]

    # 2. Resubmit identical request -> returns same transfer
    dup_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": idemp_key},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": item["id"], "qty": "2"}],
        },
    )
    assert dup_res.status_code == 201
    assert dup_res.json()["id"] == transfer_id

    # 3. Resubmit with same key but different body -> 409 conflict
    conflict_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": idemp_key},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": item["id"], "qty": "5"}],
        },
    )
    assert conflict_res.status_code == 409
    assert conflict_res.json()["error"]["code"] == "idempotency_conflict"

    # 4. Confirm transfer
    confirm_res = await client.post(f"/api/v1/transfers/{transfer_id}/confirm", headers=auth(token))
    assert confirm_res.status_code == 200
    assert confirm_res.json()["status"] == "completed"

    # 5. Repeated confirm on completed transfer returns 200 completed idempotently
    repeat_res = await client.post(f"/api/v1/transfers/{transfer_id}/confirm", headers=auth(token))
    assert repeat_res.status_code == 200
    assert repeat_res.json()["status"] == "completed"


async def test_lot_tracked_transfer(client):
    env = await _setup_stock(client, "LotTransfer")
    token = env["token"]

    # 1. Create a lot-tracked item
    lot_item = await create_item(
        client,
        token,
        sku=f"LOT-SKU-{uuid.uuid4().hex[:6].upper()}",
        tracking_mode="lot",
    )

    # 2. Inbound receive 5 units into LOT-A and 5 units into LOT-B at w1_recv
    rcpt_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": f"rcpt-{uuid.uuid4()}"},
        json={
            "warehouse_id": env["w1"]["id"],
            "location_id": env["w1_recv"]["id"],
            "supplier": "Batch supplier",
            "lines": [
                {"item_id": lot_item["id"], "qty": "5", "lot_no": "LOT-ALPHA"},
                {"item_id": lot_item["id"], "qty": "5", "lot_no": "LOT-BETA"},
            ],
        },
    )
    assert rcpt_res.status_code == 201
    rcpt_id = rcpt_res.json()["id"]
    commit_res = await client.post(f"/api/v1/receipts/{rcpt_id}/commit", headers=auth(token))
    assert commit_res.status_code == 200

    # 3. Attempt transfer without specifying lot_no -> 422 lot_required
    missing_lot_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": lot_item["id"], "qty": "3"}],
        },
    )
    assert missing_lot_res.status_code == 422
    assert missing_lot_res.json()["error"]["code"] == "lot_required"

    # 4. Transfer 3 units of LOT-ALPHA to w1_main
    valid_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": lot_item["id"], "qty": "3", "lot_no": "LOT-ALPHA"}],
        },
    )
    assert valid_res.status_code == 201
    transfer = valid_res.json()
    assert transfer["lines"][0]["lot_no"] == "LOT-ALPHA"

    confirm_res = await client.post(f"/api/v1/transfers/{transfer['id']}/confirm", headers=auth(token))
    assert confirm_res.status_code == 200
    assert confirm_res.json()["status"] == "completed"

    # 5. Verify balances: LOT-ALPHA at recv has 2, LOT-ALPHA at main has 3, LOT-BETA at recv has 5
    b_res = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": lot_item["id"]})
    assert b_res.status_code == 200
    balances = b_res.json()["balances"]
    alpha_recv = next(b for b in balances if b["location_id"] == env["w1_recv"]["id"] and b.get("lot_no") == "LOT-ALPHA")
    alpha_main = next(b for b in balances if b["location_id"] == env["w1_main"]["id"] and b.get("lot_no") == "LOT-ALPHA")
    beta_recv = next(b for b in balances if b["location_id"] == env["w1_recv"]["id"] and b.get("lot_no") == "LOT-BETA")

    assert Decimal(alpha_recv["on_hand"]) == Decimal("2")
    assert Decimal(alpha_main["on_hand"]) == Decimal("3")
    assert Decimal(beta_recv["on_hand"]) == Decimal("5")


async def test_serial_tracked_transfer(client):
    env = await _setup_stock(client, "SerialTransfer")
    token = env["token"]

    # 1. Create a serial-tracked item
    serial_item = await create_item(
        client,
        token,
        sku=f"SER-SKU-{uuid.uuid4().hex[:6].upper()}",
        tracking_mode="serial",
    )

    # 2. Inbound receive 2 units with serials SN-101 and SN-102 at w1_recv
    rcpt_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": f"rcpt-{uuid.uuid4()}"},
        json={
            "warehouse_id": env["w1"]["id"],
            "location_id": env["w1_recv"]["id"],
            "supplier": "Serial supplier",
            "lines": [
                {"item_id": serial_item["id"], "qty": "2", "serial_numbers": ["SN-101", "SN-102"]},
            ],
        },
    )
    assert rcpt_res.status_code == 201
    rcpt_id = rcpt_res.json()["id"]
    commit_res = await client.post(f"/api/v1/receipts/{rcpt_id}/commit", headers=auth(token))
    assert commit_res.status_code == 200

    # 3. Attempt transfer with mismatched serial count (qty 2, but 1 serial) -> 422 serial_quantity_mismatch
    mismatch_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": serial_item["id"], "qty": "2", "serial_numbers": ["SN-101"]}],
        },
    )
    assert mismatch_res.status_code == 422
    assert mismatch_res.json()["error"]["code"] == "serial_quantity_mismatch"

    # 4. Attempt transfer with serial not at source location -> 422 serial_not_available_at_source
    missing_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": serial_item["id"], "qty": "1", "serial_numbers": ["SN-999"]}],
        },
    )
    assert missing_res.status_code == 422
    assert missing_res.json()["error"]["code"] == "serial_not_available_at_source"

    # 5. Valid transfer of SN-101 to w1_main
    valid_res = await client.post(
        "/api/v1/transfers",
        headers={**auth(token), "Idempotency-Key": f"tr-{uuid.uuid4()}"},
        json={
            "from_warehouse_id": env["w1"]["id"],
            "from_location_id": env["w1_recv"]["id"],
            "to_warehouse_id": env["w1"]["id"],
            "to_location_id": env["w1_main"]["id"],
            "lines": [{"item_id": serial_item["id"], "qty": "1", "serial_numbers": ["SN-101"]}],
        },
    )
    assert valid_res.status_code == 201
    transfer = valid_res.json()
    assert transfer["lines"][0]["serial_numbers"] == ["SN-101"]

    confirm_res = await client.post(f"/api/v1/transfers/{transfer['id']}/confirm", headers=auth(token))
    assert confirm_res.status_code == 200
    assert confirm_res.json()["status"] == "completed"

    # 6. Verify balances: w1_recv has 1 unit total (SN-102), w1_main has 1 unit total (SN-101)
    b_res = await client.get("/api/v1/balances", headers=auth(token), params={"item_id": serial_item["id"]})
    assert b_res.status_code == 200
    balances = b_res.json()["balances"]
    recv_total = sum(Decimal(b["on_hand"]) for b in balances if b["location_id"] == env["w1_recv"]["id"])
    main_total = sum(Decimal(b["on_hand"]) for b in balances if b["location_id"] == env["w1_main"]["id"])
    assert recv_total == Decimal("1")
    assert main_total == Decimal("1")

