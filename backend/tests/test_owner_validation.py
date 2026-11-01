import pytest

from .utils import auth, register_company


@pytest.mark.asyncio
async def test_owner_validation_rejects_all_as_transaction_owner(client):
    reg = await register_company(client, "OwnerValCo")
    token = reg["access_token"]

    # 1. Try creating an item with client_id="all"
    res_item = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={"sku": "TEST-SKU", "name": "Test Item", "base_uom": "EA", "client_id": "all"},
    )
    assert res_item.status_code == 422, res_item.text
    assert res_item.json()["error"]["code"] == "invalid_client"

    # 2. Try creating receipt with client_id="all"
    res_rcpt = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": "test-idemp-all-1"},
        json={
            "client_id": "all",
            "warehouse_id": "wh-1",
            "location_id": "loc-1",
            "lines": [{"item_id": "item-1", "qty": "10"}],
        },
    )
    assert res_rcpt.status_code == 422, res_rcpt.text
    assert res_rcpt.json()["error"]["code"] == "invalid_client"

    # 3. Try creating outbound order with client_id="all"
    res_order = await client.post(
        "/api/v1/outbound/orders",
        headers={**auth(token), "Idempotency-Key": "test-idemp-all-2"},
        json={
            "client_id": "all",
            "warehouse_id": "wh-1",
            "customer_name": "Test Customer",
            "lines": [{"item_id": "item-1", "qty": "5"}],
        },
    )
    assert res_order.status_code == 422, res_order.text
    assert res_order.json()["error"]["code"] == "invalid_client"


@pytest.mark.asyncio
async def test_owner_validation_rejects_supplier_as_inventory_owner(client):
    reg = await register_company(client, "SupplierOwnerCo")
    token = reg["access_token"]

    # Create supplier partner
    res_sup = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "SUP-99", "name": "Raw Supplier Inc", "types": ["supplier"]},
    )
    assert res_sup.status_code == 201, res_sup.text
    sup_id = res_sup.json()["id"]

    # Attempt to use supplier as inventory owner on item creation
    res_item = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={"sku": "SUP-ITEM", "name": "Supplier Item", "base_uom": "EA", "client_id": sup_id},
    )
    assert res_item.status_code == 422, res_item.text
    assert res_item.json()["error"]["code"] == "invalid_client"
    assert "not configured as a 3PL inventory client" in res_item.json()["error"]["message"]


@pytest.mark.asyncio
async def test_owner_validation_3pl_mode_requires_explicit_client(client):
    reg = await register_company(client, "ThreePLModeCo")
    token = reg["access_token"]

    # Switch company to 3pl mode
    patch_res = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "3pl"},
    )
    assert patch_res.status_code == 200, patch_res.text

    # Attempt to create item without client_id in 3pl mode
    res_item = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={"sku": "3PL-ITEM", "name": "3PL Item", "base_uom": "EA"},
    )
    assert res_item.status_code == 422, res_item.text
    assert res_item.json()["error"]["code"] == "client_required"
