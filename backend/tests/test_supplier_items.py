import io
import uuid
from decimal import Decimal

import openpyxl

from .utils import (
    accept_invitation,
    auth,
    create_item,
    create_warehouse,
    default_location,
    register_company,
)


async def _create_supplier(
    client,
    token: str,
    code: str,
    name: str,
    *,
    status: str = "active",
) -> dict:
    response = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": code,
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
    **overrides,
):
    payload = {
        "supplier_id": supplier_id,
        "supplier_sku": overrides.pop("supplier_sku", "SUP-SKU-1"),
        "purchase_price": "12.50",
        "currency": "USD",
        "lead_time_days": 7,
        "min_order_qty": "2",
        "is_preferred": True,
        **overrides,
    }
    return await client.post(
        f"/api/v1/items/{item_id}/suppliers",
        headers=auth(token),
        json=payload,
    )


async def test_link_preferred_unlink_filter_and_bidirectional_navigation(client):
    registration = await register_company(client, "SupplierLinks")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"LINK-{uuid.uuid4().hex[:6].upper()}")
    supplier_a = await _create_supplier(client, token, "SUP-A", "Alpha Supply")
    supplier_b = await _create_supplier(client, token, "SUP-B", "Beta Supply")
    supplier_c = await _create_supplier(client, token, "SUP-C", "Gamma Supply")

    linked_a = await _link(client, token, item["id"], supplier_a["id"], supplier_sku="A-100")
    assert linked_a.status_code == 201, linked_a.text
    assert linked_a.json()["supplier_name"] == "Alpha Supply"
    assert linked_a.json()["is_preferred"] is True
    assert Decimal(str(linked_a.json()["purchase_price"])) == Decimal("12.50")

    item_detail = await client.get(f"/api/v1/items/{item['id']}", headers=auth(token))
    assert item_detail.status_code == 200, item_detail.text
    assert item_detail.json()["supplier_count"] == 1
    assert item_detail.json()["preferred_supplier_id"] == supplier_a["id"]
    assert item_detail.json()["preferred_supplier_name"] == "Alpha Supply"

    linked_b = await _link(client, token, item["id"], supplier_b["id"], supplier_sku="B-200")
    assert linked_b.status_code == 201, linked_b.text

    suppliers = await client.get(
        f"/api/v1/items/{item['id']}/suppliers", headers=auth(token)
    )
    assert suppliers.status_code == 200, suppliers.text
    rows = suppliers.json()["suppliers"]
    assert [row["is_preferred"] for row in rows] == [True, False]
    assert rows[0]["supplier_id"] == supplier_b["id"]

    preferred_a = await client.patch(
        f"/api/v1/items/{item['id']}/suppliers/{linked_a.json()['id']}",
        headers=auth(token),
        json={"is_preferred": True},
    )
    assert preferred_a.status_code == 200, preferred_a.text
    rows = (
        await client.get(f"/api/v1/items/{item['id']}/suppliers", headers=auth(token))
    ).json()["suppliers"]
    preferred_flags = {row["supplier_id"]: row["is_preferred"] for row in rows}
    assert preferred_flags == {supplier_a["id"]: True, supplier_b["id"]: False}

    for supplier in (supplier_a, supplier_b):
        filtered = await client.get(
            "/api/v1/items",
            headers=auth(token),
            params={"supplier_id": supplier["id"]},
        )
        assert filtered.status_code == 200, filtered.text
        assert [row["id"] for row in filtered.json()["items"]] == [item["id"]]

    empty_filter = await client.get(
        "/api/v1/items",
        headers=auth(token),
        params={"supplier_id": supplier_c["id"]},
    )
    assert empty_filter.json()["items"] == []

    supplied = await client.get(
        f"/api/v1/clients/{supplier_a['id']}/items", headers=auth(token)
    )
    assert supplied.status_code == 200, supplied.text
    supplied_rows = supplied.json()["items"]
    assert len(supplied_rows) == 1
    assert supplied_rows[0]["item_id"] == item["id"]
    assert supplied_rows[0]["mapping_id"] == linked_a.json()["id"]
    assert supplied_rows[0]["item_sku"] == item["sku"]

    deactivated = await client.patch(
        f"/api/v1/items/{item['id']}/suppliers/{linked_a.json()['id']}",
        headers=auth(token),
        json={"status": "inactive"},
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["status"] == "inactive"
    assert deactivated.json()["is_preferred"] is False

    unlinked = await client.delete(
        f"/api/v1/items/{item['id']}/suppliers/{linked_b.json()['id']}",
        headers=auth(token),
    )
    assert unlinked.status_code == 204, unlinked.text
    remaining = (
        await client.get(f"/api/v1/items/{item['id']}/suppliers", headers=auth(token))
    ).json()["suppliers"]
    assert [row["supplier_id"] for row in remaining] == [supplier_a["id"]]
    assert remaining[0]["status"] == "inactive"


async def test_duplicate_customer_and_archived_suppliers_are_rejected(client):
    registration = await register_company(client, "SupplierValidation")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"VAL-{uuid.uuid4().hex[:6].upper()}")
    supplier = await _create_supplier(client, token, "SUP-V", "Valid Supplier")
    customer = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "CUS-V", "name": "Only Customer", "types": ["customer"]},
    )
    assert customer.status_code == 201, customer.text
    archived = await _create_supplier(
        client, token, "SUP-ARCH", "Archived Supplier", status="archived"
    )

    first = await _link(client, token, item["id"], supplier["id"])
    assert first.status_code == 201, first.text
    duplicate = await _link(client, token, item["id"], supplier["id"])
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["error"]["code"] == "supplier_item_link_exists"

    wrong_type = await _link(client, token, item["id"], customer.json()["id"])
    assert wrong_type.status_code == 422, wrong_type.text
    assert wrong_type.json()["error"]["code"] == "invalid_supplier"

    inactive = await _link(client, token, item["id"], archived["id"])
    assert inactive.status_code == 422, inactive.text
    assert inactive.json()["error"]["code"] == "supplier_inactive"

    # Archiving an already-linked supplier preserves the link but prevents
    # changing commercial terms until the link is deactivated or removed.
    archived_existing = await client.patch(
        f"/api/v1/clients/{supplier['id']}",
        headers=auth(token),
        json={"status": "archived"},
    )
    assert archived_existing.status_code == 200, archived_existing.text
    blocked = await client.patch(
        f"/api/v1/items/{item['id']}/suppliers/{first.json()['id']}",
        headers=auth(token),
        json={"lead_time_days": 10},
    )
    assert blocked.status_code == 422, blocked.text
    assert blocked.json()["error"]["code"] == "supplier_inactive"

    deactivate = await client.patch(
        f"/api/v1/items/{item['id']}/suppliers/{first.json()['id']}",
        headers=auth(token),
        json={"status": "inactive"},
    )
    assert deactivate.status_code == 200, deactivate.text
    assert deactivate.json()["is_preferred"] is False


async def test_supplier_deliveries_come_from_committed_receipts_not_mappings(client):
    registration = await register_company(client, "SupplierDelivery")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"DEL-{uuid.uuid4().hex[:6].upper()}")
    supplier = await _create_supplier(client, token, "SUP-D", "Delivery Supplier")
    linked = await _link(client, token, item["id"], supplier["id"])
    assert linked.status_code == 201, linked.text

    warehouse = await create_warehouse(client, token)
    receiving = await default_location(client, token, warehouse["id"])
    payload = {
        "warehouse_id": warehouse["id"],
        "location_id": receiving["id"],
        "supplier_id": supplier["id"],
        "supplier": "Delivery Supplier",
        "lines": [{"item_id": item["id"], "qty": "3"}],
    }

    draft = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json=payload,
    )
    assert draft.status_code == 201, draft.text

    before = await client.get(
        f"/api/v1/clients/{supplier['id']}/items", headers=auth(token)
    )
    assert before.json()["items"][0]["delivered_qty"] == "0"
    assert before.json()["items"][0]["delivery_count"] == 0

    committed = await client.post(
        f"/api/v1/receipts/{draft.json()['id']}/commit", headers=auth(token)
    )
    assert committed.status_code == 200, committed.text

    after = await client.get(
        f"/api/v1/clients/{supplier['id']}/items", headers=auth(token)
    )
    row = after.json()["items"][0]
    assert Decimal(str(row["delivered_qty"])) == Decimal("3")
    assert row["delivery_count"] == 1
    assert row["last_receipt_id"] == draft.json()["id"]
    assert row["last_receipt_number"] == committed.json()["number"]
    assert row["last_delivery_at"] is not None

    # Delivery facts are derived, not written back onto the mapping.
    suppliers = await client.get(
        f"/api/v1/items/{item['id']}/suppliers", headers=auth(token)
    )
    mapping = suppliers.json()["suppliers"][0]
    assert "delivered_qty" not in mapping
    assert mapping["supplier_sku"] == linked.json()["supplier_sku"]


async def test_scoped_members_only_see_supplied_items_for_their_owners(client):
    registration = await register_company(client, "SupplierScope")
    token = registration["access_token"]
    await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "3pl"},
    )
    owner_a = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "OWN-A", "name": "Owner A", "types": ["3pl_client"]},
    )
    owner_b = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "OWN-B", "name": "Owner B", "types": ["3pl_client"]},
    )
    assert owner_a.status_code == 201, owner_a.text
    assert owner_b.status_code == 201, owner_b.text
    item_a = await create_item(
        client, token, sku=f"OWN-A-{uuid.uuid4().hex[:6].upper()}", client_id=owner_a.json()["id"]
    )
    item_b = await create_item(
        client, token, sku=f"OWN-B-{uuid.uuid4().hex[:6].upper()}", client_id=owner_b.json()["id"]
    )
    supplier = await _create_supplier(client, token, "SUP-S", "Shared Supplier")
    assert (await _link(client, token, item_a["id"], supplier["id"])).status_code == 201
    assert (await _link(client, token, item_b["id"], supplier["id"])).status_code == 201

    member_email = f"scoped-{uuid.uuid4().hex[:8]}@example.com"
    invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={
            "email": member_email,
            "role": "inventory_manager",
            "client_ids": [owner_a.json()["id"]],
        },
    )
    assert invitation.status_code == 201, invitation.text
    member = await accept_invitation(
        client, invitation.json()["invitation_token"], member_email
    )
    member_token = member["access_token"]

    supplied = await client.get(
        f"/api/v1/clients/{supplier['id']}/items", headers=auth(member_token)
    )
    assert supplied.status_code == 200, supplied.text
    assert [row["item_id"] for row in supplied.json()["items"]] == [item_a["id"]]

    filtered = await client.get(
        "/api/v1/items",
        headers=auth(member_token),
        params={"supplier_id": supplier["id"]},
    )
    assert filtered.status_code == 200, filtered.text
    assert [row["id"] for row in filtered.json()["items"]] == [item_a["id"]]

    # Supplier selection is not constrained by inventory-owner scope.
    partners = await client.get(
        "/api/v1/clients", headers=auth(member_token), params={"type": "supplier"}
    )
    assert partners.status_code == 200, partners.text
    assert any(row["id"] == supplier["id"] for row in partners.json()["clients"])
    supplier_detail = await client.get(
        f"/api/v1/clients/{supplier['id']}", headers=auth(member_token)
    )
    assert supplier_detail.status_code == 200, supplier_detail.text

    # Supplier visibility is company-wide, so scoped exports keep suppliers too.
    export = await client.get("/api/v1/clients/export", headers=auth(member_token))
    assert export.status_code == 200, export.text
    workbook = openpyxl.load_workbook(io.BytesIO(export.content))
    exported_values = {
        str(value)
        for row in workbook["Business Partners"].iter_rows(values_only=True)
        for value in row
        if value is not None
    }
    assert "Shared Supplier" in exported_values
    assert "Owner B" not in exported_values


async def test_reorder_suggestions_use_preferred_supplier_without_blocking(client):
    registration = await register_company(client, "SupplierReorder")
    token = registration["access_token"]
    preferred_item = await create_item(
        client, token, sku=f"REO-A-{uuid.uuid4().hex[:6].upper()}"
    )
    other_item = await create_item(
        client, token, sku=f"REO-B-{uuid.uuid4().hex[:6].upper()}"
    )
    supplier = await _create_supplier(client, token, "SUP-REO", "Reorder Supply")
    other_supplier = await _create_supplier(
        client, token, "SUP-REO-2", "Secondary Supply"
    )
    assert (
        await _link(
            client, token, preferred_item["id"], supplier["id"], is_preferred=True
        )
    ).status_code == 201
    assert (
        await _link(
            client, token, other_item["id"], other_supplier["id"], is_preferred=False
        )
    ).status_code == 201

    for item in (preferred_item, other_item):
        patched = await client.patch(
            f"/api/v1/items/{item['id']}",
            headers=auth(token),
            json={"reorder_point": "10"},
        )
        assert patched.status_code == 200, patched.text

    response = await client.get("/api/v1/reorder-needed", headers=auth(token))
    assert response.status_code == 200, response.text
    rows = {row["item_id"]: row for row in response.json()["rows"]}
    assert rows[preferred_item["id"]]["preferred_supplier_id"] == supplier["id"]
    assert rows[preferred_item["id"]]["preferred_supplier_name"] == "Reorder Supply"
    assert rows[other_item["id"]]["preferred_supplier_id"] is None
    assert rows[other_item["id"]]["preferred_supplier_name"] is None


async def test_cost_visibility_and_write_permissions(client):
    registration = await register_company(client, "SupplierCost")
    token = registration["access_token"]
    item = await create_item(client, token, sku=f"COST-{uuid.uuid4().hex[:6].upper()}")
    supplier = await _create_supplier(client, token, "SUP-COST", "Cost Supplier")
    linked = await _link(client, token, item["id"], supplier["id"])
    assert linked.status_code == 201, linked.text

    viewer_email = f"viewer-{uuid.uuid4().hex[:8]}@example.com"
    invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={"email": viewer_email, "role": "viewer"},
    )
    assert invitation.status_code == 201, invitation.text
    viewer = await accept_invitation(
        client, invitation.json()["invitation_token"], viewer_email
    )
    viewer_token = viewer["access_token"]

    view = await client.get(
        f"/api/v1/items/{item['id']}/suppliers", headers=auth(viewer_token)
    )
    assert view.status_code == 200, view.text
    assert view.json()["suppliers"][0]["purchase_price"] is None
    assert view.json()["suppliers"][0]["supplier_sku"] == "SUP-SKU-1"

    denied = await _link(
        client,
        viewer_token,
        item["id"],
        supplier["id"],
        supplier_sku="VIEWER-LINK",
    )
    assert denied.status_code == 403, denied.text

    # A user with write access but no cost permission cannot set a price.
    role = await client.post(
        "/api/v1/members/roles",
        headers=auth(token),
        json={
            "name": "Supplier Editor",
            "slug": "supplier_editor",
            "description": "Maintains supplier links without commercial cost access",
            "permissions": ["inventory.read", "inventory.write", "clients.read"],
        },
    )
    assert role.status_code == 201, role.text
    manager_email = f"manager-{uuid.uuid4().hex[:8]}@example.com"
    manager_invite = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={"email": manager_email, "role": "supplier_editor"},
    )
    manager = await accept_invitation(
        client, manager_invite.json()["invitation_token"], manager_email
    )
    priced = await _link(
        client,
        manager["access_token"],
        item["id"],
        supplier["id"],
        supplier_sku="NO-COST",
        purchase_price="99.00",
    )
    assert priced.status_code == 403, priced.text

    # The same user can link a supplier as long as no purchase price is supplied.
    new_supplier = await _create_supplier(client, token, "SUP-NOCOST", "No Cost Supplier")
    unpriced = await _link(
        client,
        manager["access_token"],
        item["id"],
        new_supplier["id"],
        supplier_sku="NO-COST-2",
        purchase_price=None,
        is_preferred=False,
    )
    assert unpriced.status_code == 201, unpriced.text
    assert unpriced.json()["purchase_price"] is None
