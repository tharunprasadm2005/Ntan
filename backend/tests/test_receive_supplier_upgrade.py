import csv
import io
import uuid
from decimal import Decimal

from .utils import (
    accept_invitation,
    auth,
    create_item,
    create_warehouse,
    default_location,
    register_company,
)


async def _supplier(
    client,
    token: str,
    name: str = "Apex Industrial",
    *,
    code: str | None = None,
    status: str = "active",
) -> dict:
    response = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": code or f"SUP-{uuid.uuid4().hex[:6].upper()}",
            "name": name,
            "types": ["supplier"],
        },
    )
    assert response.status_code == 201, response.text
    supplier = response.json()
    if status != "active":
        patched = await client.patch(
            f"/api/v1/clients/{supplier['id']}",
            headers=auth(token),
            json={"status": status},
        )
        assert patched.status_code == 200, patched.text
        supplier = patched.json()
    return supplier


async def _link(
    client,
    token: str,
    item_id: str,
    supplier_id: str,
    *,
    supplier_sku: str,
    purchase_price: str | None = "12.50",
    is_preferred: bool = True,
):
    response = await client.post(
        f"/api/v1/items/{item_id}/suppliers",
        headers=auth(token),
        json={
            "supplier_id": supplier_id,
            "supplier_sku": supplier_sku,
            "purchase_price": purchase_price,
            "currency": "USD",
            "lead_time_days": 7,
            "min_order_qty": "2",
            "is_preferred": is_preferred,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _setup(client, label: str, *, reorder_point: str | None = None):
    registration = await register_company(client, label)
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"RS-{uuid.uuid4().hex[:8].upper()}")
    if reorder_point is not None:
        updated = await client.patch(
            f"/api/v1/items/{item['id']}",
            headers=auth(token),
            json={"reorder_point": reorder_point},
        )
        assert updated.status_code == 200, updated.text
        item = updated.json()
    warehouse = await create_warehouse(client, token)
    location = await default_location(client, token, warehouse["id"])
    supplier = await _supplier(client, token)
    return registration, token, item, warehouse, location, supplier


async def _create_po(client, token, warehouse, supplier, item, qty="10") -> dict:
    response = await client.post(
        "/api/v1/purchase-orders",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "warehouse_id": warehouse["id"],
            "supplier_id": supplier["id"],
            "lines": [{"item_id": item["id"], "qty": qty}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _draft(
    client,
    token,
    warehouse,
    location,
    item,
    qty,
    *,
    purchase_order: dict | None = None,
    supplier_id: str | None = None,
    delivery_note: str | None = None,
):
    payload: dict = {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "lines": [{"item_id": item["id"], "qty": qty}],
    }
    if purchase_order is not None:
        payload["purchase_order_id"] = purchase_order["id"]
    if supplier_id is not None:
        payload["supplier_id"] = supplier_id
    if delivery_note is not None:
        payload["delivery_note"] = delivery_note
    return await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )


async def _commit(client, token, receipt_id: str):
    return await client.post(f"/api/v1/receipts/{receipt_id}/commit", headers=auth(token))


async def _reorder_rows(client, token, **params) -> list[dict]:
    response = await client.get("/api/v1/reorder-needed", headers=auth(token), params=params)
    assert response.status_code == 200, response.text
    return response.json()["rows"]


def _row_for(rows: list[dict], item_id: str) -> dict:
    matches = [row for row in rows if row["item_id"] == item_id]
    assert len(matches) == 1
    return matches[0]


async def test_supplier_sku_snapshot_history_filters_and_export(client):
    _registration, token, item, warehouse, location, supplier = await _setup(
        client, "SupplierHistory"
    )
    other_supplier = await _supplier(client, token, "Other Supplier")
    mapping = await _link(
        client, token, item["id"], supplier["id"], supplier_sku="A-100"
    )
    await _link(
        client,
        token,
        item["id"],
        other_supplier["id"],
        supplier_sku="B-200",
        is_preferred=False,
    )

    order = await _create_po(client, token, warehouse, supplier, item, "10")
    assert order["lines"][0]["supplier_sku"] == "A-100"

    draft = await _draft(
        client,
        token,
        warehouse,
        location,
        item,
        "4",
        purchase_order=order,
        delivery_note="DN-7781",
    )
    assert draft.status_code == 201, draft.text
    receipt = draft.json()
    assert receipt["delivery_note"] == "DN-7781"
    assert receipt["lines"][0]["supplier_sku"] == "A-100"

    committed = await _commit(client, token, receipt["id"])
    assert committed.status_code == 200, committed.text

    # Editing the mapping must not rewrite the historical receipt or PO line.
    edited = await client.patch(
        f"/api/v1/items/{item['id']}/suppliers/{mapping['id']}",
        headers=auth(token),
        json={"supplier_sku": "A-100-CHANGED"},
    )
    assert edited.status_code == 200, edited.text

    fetched = await client.get(f"/api/v1/receipts/{receipt['id']}", headers=auth(token))
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["lines"][0]["supplier_sku"] == "A-100"
    assert fetched.json()["delivery_note"] == "DN-7781"
    refetched_order = await client.get(
        f"/api/v1/purchase-orders/{order['id']}", headers=auth(token)
    )
    assert refetched_order.json()["lines"][0]["supplier_sku"] == "A-100"

    for params in (
        {"supplier_id": supplier["id"]},
        {"item_id": item["id"]},
        {"purchase_order_id": order["id"]},
        {"warehouse_id": warehouse["id"]},
        {"search": "A-100"},
        {"search": "DN-7781"},
        {"status": "applied"},
    ):
        listed = await client.get("/api/v1/receipts", headers=auth(token), params=params)
        assert listed.status_code == 200, listed.text
        assert [row["id"] for row in listed.json()["receipts"]] == [receipt["id"]], params

    mismatch = await client.get(
        "/api/v1/receipts",
        headers=auth(token),
        params={"supplier_id": other_supplier["id"]},
    )
    assert mismatch.status_code == 200, mismatch.text
    assert mismatch.json()["receipts"] == []

    today = receipt["created_at"][:10]
    dated = await client.get(
        "/api/v1/receipts",
        headers=auth(token),
        params={"date_from": today, "date_to": today},
    )
    assert [row["id"] for row in dated.json()["receipts"]] == [receipt["id"]]
    future = await client.get(
        "/api/v1/receipts",
        headers=auth(token),
        params={"date_from": "2999-01-01"},
    )
    assert future.json()["receipts"] == []

    exported = await client.get(
        "/api/v1/receipts/export",
        headers=auth(token),
        params={"supplier_id": supplier["id"]},
    )
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(exported.text.lstrip("\ufeff"))))
    assert rows[0][0] == "receipt_number"
    assert len(rows) == 2
    assert rows[1][0] == receipt["number"]
    assert rows[1][4] == "Apex Industrial"
    assert rows[1][12] == "A-100"
    assert rows[1][22] == "DN-7781"

    # Archiving the supplier keeps the committed receipt attributable.
    archived = await client.patch(
        f"/api/v1/clients/{supplier['id']}",
        headers=auth(token),
        json={"status": "archived"},
    )
    assert archived.status_code == 200, archived.text
    historical = await client.get(
        f"/api/v1/receipts/{receipt['id']}", headers=auth(token)
    )
    assert historical.status_code == 200, historical.text
    assert historical.json()["supplier_id"] == supplier["id"]
    assert historical.json()["supplier"] == "Apex Industrial"


async def test_over_receipt_policy_is_company_scoped_and_enforced(client):
    _registration, token, item, warehouse, location, supplier = await _setup(
        client, "OverReceipt"
    )
    await _link(client, token, item["id"], supplier["id"], supplier_sku="OR-1")
    order = await _create_po(client, token, warehouse, supplier, item, "5")

    rejected = await _draft(
        client, token, warehouse, location, item, "6", purchase_order=order
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["error"]["code"] == "purchase_order_over_receipt"

    company = await client.get("/api/v1/company", headers=auth(token))
    assert company.json()["allow_over_receipt"] is False

    enabled = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"allow_over_receipt": True},
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["allow_over_receipt"] is True

    allowed = await _draft(
        client, token, warehouse, location, item, "7", purchase_order=order
    )
    assert allowed.status_code == 201, allowed.text
    posted = await _commit(client, token, allowed.json()["id"])
    assert posted.status_code == 200, posted.text

    body = (
        await client.get(f"/api/v1/purchase-orders/{order['id']}", headers=auth(token))
    ).json()
    assert body["status"] == "received"
    assert Decimal(body["received_qty"]) == Decimal("7")
    assert body["remaining_qty"] == "0"

    balances = await client.get(
        "/api/v1/balances", headers=auth(token), params={"item_id": item["id"]}
    )
    assert sum(Decimal(row["on_hand"]) for row in balances.json()["balances"]) == Decimal("7")

    blocked = await _draft(
        client, token, warehouse, location, item, "1", purchase_order=order
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "purchase_order_not_receivable"


async def test_reorder_supplier_options_grouping_filter_and_cost_gating(client):
    _registration, token, item, warehouse, _location, supplier = await _setup(
        client, "ReorderSuppliers", reorder_point="10"
    )
    alternative = await _supplier(client, token, "Alternative Supply")
    await _link(
        client, token, item["id"], supplier["id"], supplier_sku="R-100", is_preferred=True
    )
    await _link(
        client,
        token,
        item["id"],
        alternative["id"],
        supplier_sku="R-200",
        purchase_price="9.75",
        is_preferred=False,
    )
    unmapped = await create_item(client, token, sku=f"UNMAPPED-{uuid.uuid4().hex[:6]}")
    patched = await client.patch(
        f"/api/v1/items/{unmapped['id']}",
        headers=auth(token),
        json={"reorder_point": "5"},
    )
    assert patched.status_code == 200, patched.text

    rows = await _reorder_rows(client, token, warehouse_id=warehouse["id"])
    mapped_row = _row_for(rows, item["id"])
    assert mapped_row["needs_supplier_assignment"] is False
    assert mapped_row["preferred_supplier_id"] == supplier["id"]
    assert [option["supplier_id"] for option in mapped_row["supplier_options"]] == [
        supplier["id"],
        alternative["id"],
    ]
    assert mapped_row["supplier_options"][0]["is_preferred"] is True
    assert Decimal(mapped_row["supplier_options"][0]["purchase_price"]) == Decimal("12.50")
    assert mapped_row["supplier_options"][0]["lead_time_days"] == 7
    assert Decimal(mapped_row["supplier_options"][0]["min_order_qty"]) == Decimal("2")

    unmapped_row = _row_for(rows, unmapped["id"])
    assert unmapped_row["needs_supplier_assignment"] is True
    assert unmapped_row["supplier_options"] == []

    filtered = await _reorder_rows(
        client, token, warehouse_id=warehouse["id"], supplier_id=alternative["id"]
    )
    assert [row["item_id"] for row in filtered] == [item["id"]]

    # Archived suppliers disappear from replenishment options.
    archived = await client.patch(
        f"/api/v1/clients/{alternative['id']}",
        headers=auth(token),
        json={"status": "archived"},
    )
    assert archived.status_code == 200, archived.text
    rows = await _reorder_rows(client, token, warehouse_id=warehouse["id"])
    mapped_row = _row_for(rows, item["id"])
    assert [option["supplier_id"] for option in mapped_row["supplier_options"]] == [
        supplier["id"]
    ]

    # A viewer can see the supplier list but never purchase prices.
    email = f"reorder-cost-{uuid.uuid4().hex[:8]}@example.com"
    invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={"email": email, "role": "viewer"},
    )
    assert invitation.status_code == 201, invitation.text
    viewer = await accept_invitation(
        client, invitation.json()["invitation_token"], email
    )
    viewer_rows = await _reorder_rows(
        client, viewer["access_token"], warehouse_id=warehouse["id"]
    )
    viewer_row = _row_for(viewer_rows, item["id"])
    assert viewer_row["supplier_options"][0]["supplier_sku"] == "R-100"
    assert viewer_row["supplier_options"][0]["purchase_price"] is None


async def test_receipt_history_and_reorder_respect_owner_scope(client):
    registration = await register_company(client, "ReceiptScope")
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
    location = await default_location(client, token, warehouse["id"])
    supplier = await _supplier(client, token)

    receipts = {}
    for owner in (alpha, beta):
        item = await create_item(
            client,
            token,
            sku=f"SCOPE-{owner['code']}",
            client_id=owner["id"],
        )
        patched = await client.patch(
            f"/api/v1/items/{item['id']}",
            headers=auth(token),
            json={"reorder_point": "5"},
        )
        assert patched.status_code == 200, patched.text
        owned = await client.post(
            "/api/v1/receipts",
            headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
            json={
                "client_id": owner["id"],
                "warehouse_id": warehouse["id"],
                "location_id": location["id"],
                "supplier_id": supplier["id"],
                "lines": [{"item_id": item["id"], "qty": "2"}],
            },
        )
        assert owned.status_code == 201, owned.text
        committed = await _commit(client, token, owned.json()["id"])
        assert committed.status_code == 200, committed.text
        receipts[owner["id"]] = committed.json()

    email = f"receipt-scope-{uuid.uuid4().hex[:8]}@example.com"
    invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={"email": email, "role": "viewer", "client_ids": [alpha["id"]]},
    )
    assert invitation.status_code == 201, invitation.text
    member = await accept_invitation(
        client, invitation.json()["invitation_token"], email
    )
    member_token = member["access_token"]

    listed = await client.get("/api/v1/receipts", headers=auth(member_token))
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json()["receipts"]] == [receipts[alpha["id"]]["id"]]

    forbidden = await client.get(
        f"/api/v1/receipts/{receipts[beta['id']]['id']}", headers=auth(member_token)
    )
    assert forbidden.status_code == 404, forbidden.text

    widened = await client.get(
        "/api/v1/receipts",
        headers=auth(member_token),
        params={"client_id": beta["id"]},
    )
    assert widened.status_code == 200, widened.text
    assert widened.json()["receipts"] == []

    reorder_rows = await _reorder_rows(
        client, member_token, warehouse_id=warehouse["id"]
    )
    assert {row["client_id"] for row in reorder_rows} == {alpha["id"]}
