import uuid
from decimal import Decimal

from .utils import (
    accept_invitation,
    auth,
    create_item,
    create_warehouse,
    default_location,
    join_company,
    register_company,
)


async def _supplier(client, token: str, name: str = "Apex Industrial") -> dict:
    response = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": f"SUP-{uuid.uuid4().hex[:6].upper()}",
            "name": name,
            "types": ["supplier"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _setup(client, label: str = "Purchasing", reorder_point: str = "10"):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"PO-{uuid.uuid4().hex[:8].upper()}")
    updated = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(token),
        json={"reorder_point": reorder_point},
    )
    assert updated.status_code == 200, updated.text
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    supplier = await _supplier(client, token)
    return registration, token, item, warehouse, location, supplier


def _po_payload(warehouse: dict, supplier: dict, item: dict, qty: str = "10") -> dict:
    return {
        "warehouse_id": warehouse["id"],
        "supplier_id": supplier["id"],
        "lines": [{"item_id": item["id"], "qty": qty}],
    }


async def _create_po(
    client,
    token: str,
    warehouse: dict,
    supplier: dict,
    item: dict,
    qty: str = "10",
) -> dict:
    response = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_po_payload(warehouse, supplier, item, qty),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _draft_receipt(
    client,
    token: str,
    warehouse: dict,
    location: dict,
    purchase_order: dict,
    lines: list[dict],
    supplier_id: str | None = None,
):
    payload = {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "purchase_order_id": purchase_order["id"],
        "lines": lines,
    }
    if supplier_id:
        payload["supplier_id"] = supplier_id
    return await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )


async def _stock_snapshot(client, token: str, item_id: str) -> tuple[list, list]:
    balances = await client.get(
        "/api/v1/balances", headers=auth(token), params={"item_id": item_id, "limit": 200}
    )
    movements = await client.get(
        "/api/v1/movements", headers=auth(token), params={"item_id": item_id, "limit": 200}
    )
    assert balances.status_code == 200, balances.text
    assert movements.status_code == 200, movements.text
    return balances.json()["balances"], movements.json()["movements"]


async def _reorder_row(client, token: str, item_id: str, warehouse_id: str) -> dict:
    response = await client.get(
        "/api/v1/reorder-needed",
        headers=auth(token),
        params={"warehouse_id": warehouse_id},
    )
    assert response.status_code == 200, response.text
    rows = [row for row in response.json()["rows"] if row["item_id"] == item_id]
    assert len(rows) == 1, response.text
    return rows[0]


async def test_purchase_order_creation_does_not_change_stock(client):
    _, token, item, warehouse, _location, supplier = await _setup(client)
    balances_before, movements_before = await _stock_snapshot(client, token, item["id"])

    order = await _create_po(client, token, warehouse, supplier, item, "10")

    assert order["status"] == "open"
    assert order["supplier_id"] == supplier["id"]
    assert order["supplier_name"] == supplier["name"]
    assert order["warehouse_id"] == warehouse["id"]
    assert order["ordered_qty"] == "10"
    assert order["received_qty"] == "0"
    assert order["remaining_qty"] == "10"
    assert order["line_count"] == 1
    assert order["lines"][0]["item_id"] == item["id"]
    assert order["lines"][0]["sku"] == item["sku"]
    assert order["lines"][0]["remaining_qty"] == "10"

    balances_after, movements_after = await _stock_snapshot(client, token, item["id"])
    assert balances_after == balances_before
    assert movements_after == movements_before

    row = await _reorder_row(client, token, item["id"], warehouse["id"])
    assert Decimal(row["incoming_qty"]) == Decimal("10")
    assert row["incoming_source"] == "purchase_order"
    assert Decimal(row["projected_stock"]) == Decimal("10")
    assert Decimal(row["suggested_qty"]) == Decimal("10")

    listed = await client.get("/api/v1/purchase-orders", headers=auth(token))
    assert listed.status_code == 200, listed.text
    assert [entry["id"] for entry in listed.json()["orders"]] == [order["id"]]

    fetched = await client.get(
        f"/api/v1/purchase-orders/{order['id']}", headers=auth(token)
    )
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["number"] == order["number"]


async def test_partial_receipts_advance_purchase_order_and_stock(client):
    _, token, item, warehouse, location, supplier = await _setup(client)
    order = await _create_po(client, token, warehouse, supplier, item, "10")

    draft = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "4"}],
    )
    assert draft.status_code == 201, draft.text
    receipt = draft.json()
    assert receipt["purchase_order_id"] == order["id"]
    assert receipt["purchase_order"] == order["number"]
    assert receipt["supplier_id"] == supplier["id"]
    assert receipt["lines"][0]["purchase_order_line_id"] == order["lines"][0]["id"]

    # Drafting does not change on-hand quantities or the purchase order.
    balances, _movements = await _stock_snapshot(client, token, item["id"])
    assert balances == []
    still_open = await client.get(
        f"/api/v1/purchase-orders/{order['id']}", headers=auth(token)
    )
    assert still_open.json()["status"] == "open"
    assert still_open.json()["received_qty"] == "0"

    committed = await client.post(
        f"/api/v1/receipts/{receipt['id']}/commit", headers=auth(token)
    )
    assert committed.status_code == 200, committed.text

    partially = await client.get(
        f"/api/v1/purchase-orders/{order['id']}", headers=auth(token)
    )
    assert partially.status_code == 200, partially.text
    body = partially.json()
    assert body["status"] == "partially_received"
    assert body["received_qty"] == "4"
    assert body["remaining_qty"] == "6"
    assert body["lines"][0]["received_qty"] == "4"
    assert body["lines"][0]["remaining_qty"] == "6"

    balances, movements = await _stock_snapshot(client, token, item["id"])
    assert sum(Decimal(row["on_hand"]) for row in balances) == Decimal("4")
    assert len(movements) == 1

    row = await _reorder_row(client, token, item["id"], warehouse["id"])
    assert Decimal(row["available"]) == Decimal("4")
    assert Decimal(row["incoming_qty"]) == Decimal("6")
    assert Decimal(row["projected_stock"]) == Decimal("10")

    final = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "6"}],
    )
    assert final.status_code == 201, final.text
    posted = await client.post(
        f"/api/v1/receipts/{final.json()['id']}/commit", headers=auth(token)
    )
    assert posted.status_code == 200, posted.text

    completed = await client.get(
        f"/api/v1/purchase-orders/{order['id']}", headers=auth(token)
    )
    assert completed.json()["status"] == "received"
    assert completed.json()["remaining_qty"] == "0"
    assert completed.json()["received_at"] is not None

    over = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "1"}],
    )
    assert over.status_code == 409
    assert over.json()["error"]["code"] == "purchase_order_not_receivable"


async def test_receipt_quantities_are_validated_against_purchase_order(client):
    _, token, item, warehouse, location, supplier = await _setup(client)
    other_item = await create_item(
        client, token, sku=f"EXTRA-{uuid.uuid4().hex[:8].upper()}"
    )
    order = await _create_po(client, token, warehouse, supplier, item, "10")

    over = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "11"}],
    )
    assert over.status_code == 422, over.text
    assert over.json()["error"]["code"] == "purchase_order_over_receipt"

    mismatched = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": other_item["id"], "qty": "1"}],
    )
    assert mismatched.status_code == 422, mismatched.text
    assert mismatched.json()["error"]["code"] == "purchase_order_item_mismatch"

    duplicate = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [
            {"item_id": item["id"], "qty": "1"},
            {"item_id": item["id"], "qty": "1"},
        ],
    )
    assert duplicate.status_code == 422, duplicate.text
    assert duplicate.json()["error"]["code"] == "duplicate_item"

    another_supplier = await _supplier(client, token, "Other Supplier")
    wrong_supplier = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "1"}],
        supplier_id=another_supplier["id"],
    )
    assert wrong_supplier.status_code == 422, wrong_supplier.text
    assert wrong_supplier.json()["error"]["code"] == "purchase_order_supplier_mismatch"

    first = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "5"}],
    )
    assert first.status_code == 201, first.text

    # An outstanding draft reserves its quantity so a second draft cannot
    # promise stock the purchase order no longer has available.
    overbooked = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "6"}],
    )
    assert overbooked.status_code == 422, overbooked.text
    assert overbooked.json()["error"]["code"] == "purchase_order_over_receipt"

    allowed = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "5"}],
    )
    assert allowed.status_code == 201, allowed.text

    # Cancelling the first draft frees its reserved quantity again.
    cancelled = await client.post(
        f"/api/v1/receipts/{first.json()['id']}/cancel", headers=auth(token)
    )
    assert cancelled.status_code == 200, cancelled.text
    retried = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "5"}],
    )
    assert retried.status_code == 201, retried.text


async def test_purchase_order_creation_is_idempotent(client):
    _, token, item, warehouse, _location, supplier = await _setup(client)
    key = str(uuid.uuid4())
    payload = _po_payload(warehouse, supplier, item, "8")
    headers = {**auth(token), "Idempotency-Key": key}

    first = await client.post("/api/v1/purchase-orders", headers=headers, json=payload)
    assert first.status_code == 201, first.text
    second = await client.post("/api/v1/purchase-orders", headers=headers, json=payload)
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first.json()["id"]

    conflict_payload = _po_payload(warehouse, supplier, item, "9")
    conflict = await client.post(
        "/api/v1/purchase-orders", headers=headers, json=conflict_payload
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"

    duplicate_lines = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "supplier_id": supplier["id"],
            "lines": [
                {"item_id": item["id"], "qty": "1"},
                {"item_id": item["id"], "qty": "2"},
            ],
        },
    )
    assert duplicate_lines.status_code == 422
    assert duplicate_lines.json()["error"]["code"] == "duplicate_item"


async def test_purchase_order_validation_and_cancellation(client):
    reg, token, item, warehouse, _location, supplier = await _setup(client)

    invalid_supplier = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "supplier_id": warehouse["id"],
            "lines": [{"item_id": item["id"], "qty": "1"}],
        },
    )
    assert invalid_supplier.status_code == 422, invalid_supplier.text
    assert invalid_supplier.json()["error"]["code"] == "invalid_supplier"

    zero_qty = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "supplier_id": supplier["id"],
            "lines": [{"item_id": item["id"], "qty": "0"}],
        },
    )
    assert zero_qty.status_code == 422

    order = await _create_po(client, token, warehouse, supplier, item, "3")
    cancelled = await client.post(
        f"/api/v1/purchase-orders/{order['id']}/cancel", headers=auth(token)
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    again = await client.post(
        f"/api/v1/purchase-orders/{order['id']}/cancel", headers=auth(token)
    )
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "cancelled"

    first = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=_po_payload(warehouse, supplier, item, "2"),
    )
    assert first.status_code == 201, first.text
    receipt = await _draft_receipt(
        client,
        token,
        warehouse,
        _location,
        first.json(),
        [{"item_id": item["id"], "qty": "1"}],
    )
    assert receipt.status_code == 201, receipt.text
    posted = await client.post(
        f"/api/v1/receipts/{receipt.json()['id']}/commit", headers=auth(token)
    )
    assert posted.status_code == 200, posted.text
    blocked = await client.post(
        f"/api/v1/purchase-orders/{first.json()['id']}/cancel", headers=auth(token)
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "purchase_order_not_cancellable"


async def test_purchase_order_cancellation_waits_for_draft_receipts(client):
    _, token, item, warehouse, location, supplier = await _setup(client, "DraftCancel")
    order = await _create_po(client, token, warehouse, supplier, item, "4")
    draft = await _draft_receipt(
        client,
        token,
        warehouse,
        location,
        order,
        [{"item_id": item["id"], "qty": "1"}],
    )
    assert draft.status_code == 201, draft.text

    blocked = await client.post(
        f"/api/v1/purchase-orders/{order['id']}/cancel", headers=auth(token)
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "purchase_order_has_drafts"

    discarded = await client.post(
        f"/api/v1/receipts/{draft.json()['id']}/cancel", headers=auth(token)
    )
    assert discarded.status_code == 200, discarded.text

    cancelled = await client.post(
        f"/api/v1/purchase-orders/{order['id']}/cancel", headers=auth(token)
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"


async def test_purchase_order_list_respects_member_client_scope(client):
    registration = await register_company(client, "POScope")
    token = registration["access_token"]
    enabled = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "hybrid"},
    )
    assert enabled.status_code == 200, enabled.text

    owners = []
    for code, name in (("ALPHA", "Alpha Owner"), ("BETA", "Beta Owner")):
        created = await client.post(
            "/api/v1/clients",
            headers=auth(token),
            json={"code": code, "name": name},
        )
        assert created.status_code == 201, created.text
        owners.append(created.json())
    alpha, beta = owners

    warehouse = await create_warehouse(client, token)
    supplier = await _supplier(client, token)
    orders = {}
    for owner in (alpha, beta):
        item = await create_item(
            client,
            token,
            sku=f"SCOPE-{owner['code']}",
            client_id=owner["id"],
        )
        created_order = await client.post(
            "/api/v1/purchase-orders",
            headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
            json={
                **_po_payload(warehouse, supplier, item, "3"),
                "client_id": owner["id"],
            },
        )
        assert created_order.status_code == 201, created_order.text
        orders[owner["id"]] = created_order.json()

    email = f"po-scope-{uuid.uuid4().hex[:8]}@example.com"
    invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={"email": email, "role": "viewer", "client_ids": [alpha["id"]]},
    )
    assert invitation.status_code == 201, invitation.text
    member = await accept_invitation(
        client,
        invitation.json()["invitation_token"],
        email,
    )
    member_token = member["access_token"]

    listed = await client.get("/api/v1/purchase-orders", headers=auth(member_token))
    assert listed.status_code == 200, listed.text
    assert [order["id"] for order in listed.json()["orders"]] == [orders[alpha["id"]]["id"]]

    allowed = await client.get(
        "/api/v1/purchase-orders",
        headers=auth(member_token),
        params={"client_id": alpha["id"]},
    )
    assert allowed.status_code == 200, allowed.text
    assert [order["id"] for order in allowed.json()["orders"]] == [orders[alpha["id"]]["id"]]

    # Supplying another owner's id must narrow the result, not widen the scope.
    forbidden = await client.get(
        "/api/v1/purchase-orders",
        headers=auth(member_token),
        params={"client_id": beta["id"]},
    )
    assert forbidden.status_code == 200, forbidden.text
    assert forbidden.json()["orders"] == []


async def test_purchase_orders_are_tenant_scoped_and_permission_checked(client):
    reg, token, item, warehouse, _location, supplier = await _setup(client)
    order = await _create_po(client, token, warehouse, supplier, item, "5")

    other = await register_company(client, "OtherBuyer")
    other_token = other["access_token"]
    hidden = await client.get(
        f"/api/v1/purchase-orders/{order['id']}", headers=auth(other_token)
    )
    assert hidden.status_code == 404
    other_list = await client.get("/api/v1/purchase-orders", headers=auth(other_token))
    assert other_list.status_code == 200, other_list.text
    assert other_list.json()["orders"] == []

    other_warehouse = await create_warehouse(client, token, name="Second Warehouse")
    mismatched = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": other_warehouse["id"],
            "location_id": (await default_location(client, token, other_warehouse["id"]))["id"],
            "purchase_order_id": order["id"],
            "lines": [{"item_id": item["id"], "qty": "1"}],
        },
    )
    assert mismatched.status_code == 422, mismatched.text
    assert mismatched.json()["error"]["code"] == "purchase_order_warehouse_mismatch"

    viewer = await join_company(
        client,
        token,
        f"viewer-{uuid.uuid4().hex[:8]}@example.com",
        role="viewer",
        name="Read Only",
    )
    viewer_token = viewer["access_token"]
    readable = await client.get("/api/v1/purchase-orders", headers=auth(viewer_token))
    assert readable.status_code == 200, readable.text
    forbidden = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(viewer_token), "Idempotency-Key": str(uuid.uuid4())},
        json=_po_payload(warehouse, supplier, item, "1"),
    )
    assert forbidden.status_code == 403, forbidden.text

    assert reg["access_token"]
