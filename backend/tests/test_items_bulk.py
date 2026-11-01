import pytest
from httpx import AsyncClient

from .utils import auth, register_company


@pytest.mark.asyncio
async def test_csv_template_endpoint(client: AsyncClient):
    reg = await register_company(client, "Template")
    token = reg["access_token"]

    resp = await client.get("/api/v1/items/csv-template", headers=auth(token))
    assert resp.status_code == 200
    assert "sku,name,barcode,category" in resp.text
    assert "ELEC-1001" in resp.text


@pytest.mark.asyncio
async def test_bulk_import_csv_and_upsert(client: AsyncClient):
    reg = await register_company(client, "BulkImport")
    token = reg["access_token"]

    csv_content = (
        "sku,name,barcode,category,tracking_mode,expiry_tracked,base_uom,reorder_point,cost,description\n"
        "BULK-001,Power Supply 500W,7001001,Electronics,none,false,EA,10,45.50,Standard ATX power supply\n"
        "BULK-002,Thermal Grease 50g,7001002,Consumables,lot,true,TUBE,25,8.00,Heat sink compound lot tracked\n"
        "BULK-003,Industrial Controller,7001003,Robotics,serial,false,EA,2,350.00,Serial tracked programmable controller\n"
    )

    # 1. Initial import with create_only
    import_resp = await client.post(
        "/api/v1/items/bulk-import",
        headers=auth(token),
        json={
            "mode": "create_only",
            "csv_data": csv_content,
        },
    )
    assert import_resp.status_code == 200, import_resp.text
    data = import_resp.json()
    assert data["total_rows"] == 3
    assert data["created_count"] == 3
    assert data["updated_count"] == 0
    assert data["error_count"] == 0

    # Verify items exist via list
    list_resp = await client.get("/api/v1/items", headers=auth(token))
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) == 3
    sku_map = {i["sku"]: i for i in items}
    assert "BULK-001" in sku_map
    assert sku_map["BULK-002"]["tracking_mode"] == "lot"
    assert sku_map["BULK-002"]["expiry_tracked"] is True
    assert sku_map["BULK-003"]["tracking_mode"] == "serial"

    # 2. Re-import with create_only -> should skip all 3
    reimport_resp = await client.post(
        "/api/v1/items/bulk-import",
        headers=auth(token),
        json={
            "mode": "create_only",
            "csv_data": csv_content,
        },
    )
    assert reimport_resp.status_code == 200
    reimport_data = reimport_resp.json()
    assert reimport_data["created_count"] == 0
    assert reimport_data["skipped_count"] == 3

    # 3. Re-import with upsert and modified details
    modified_csv = (
        "sku,name,barcode,category,tracking_mode,expiry_tracked,base_uom,reorder_point,cost,description\n"
        "BULK-001,Power Supply 650W Gold,7001001,Electronics,none,false,EA,15,55.00,Updated upgraded power supply\n"
        "BULK-004,New Product 4,7001004,NewCategory,none,false,EA,5,12.00,Brand new line item\n"
    )
    upsert_resp = await client.post(
        "/api/v1/items/bulk-import",
        headers=auth(token),
        json={
            "mode": "upsert",
            "csv_data": modified_csv,
        },
    )
    assert upsert_resp.status_code == 200
    upsert_data = upsert_resp.json()
    assert upsert_data["total_rows"] == 2
    assert upsert_data["updated_count"] == 1  # BULK-001 updated
    assert upsert_data["created_count"] == 1  # BULK-004 inserted

    # Check updated item
    get_item_resp = await client.post(
        "/api/v1/items/lookup",
        headers=auth(token),
        json={"code": "BULK-001"},
    )
    assert get_item_resp.status_code == 200
    assert get_item_resp.json()["name"] == "Power Supply 650W Gold"


@pytest.mark.asyncio
async def test_bulk_import_validation_and_errors(client: AsyncClient):
    reg = await register_company(client, "BulkVal")
    token = reg["access_token"]

    faulty_csv = (
        "sku,name,barcode,category,tracking_mode,reorder_point,cost\n"
        ",Missing SKU Item,1111,Cat1,none,5,10.0\n"
        "ERR-01,,2222,Cat1,none,5,10.0\n"
        "ERR-02,Invalid Tracking,3333,Cat1,invalid_mode,5,10.0\n"
        "ERR-03,Negative Reorder,4444,Cat1,none,-10,10.0\n"
        "DUP-01,First Dup,5555,Cat1,none,5,10.0\n"
        "DUP-01,Second Dup,6666,Cat1,none,5,10.0\n"
        "VALID-01,Good Item,7777,Cat1,none,5,10.0\n"
    )

    resp = await client.post(
        "/api/v1/items/bulk-import",
        headers=auth(token),
        json={
            "mode": "upsert",
            "csv_data": faulty_csv,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_rows"] == 7
    assert data["created_count"] == 2  # first DUP-01 and VALID-01
    assert data["error_count"] >= 5

    # Check error fields
    error_messages = [e["message"] for e in data["errors"]]
    assert any("SKU is required" in m for m in error_messages)
    assert any("Item name is required" in m for m in error_messages)
    assert any("tracking_mode must be" in m for m in error_messages)
    assert any("Reorder point must be >= 0" in m for m in error_messages)
    assert any("Duplicate SKU 'DUP-01'" in m for m in error_messages)


@pytest.mark.asyncio
async def test_bulk_export_csv(client: AsyncClient):
    reg = await register_company(client, "BulkExp")
    token = reg["access_token"]

    # Import one item first
    await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={
            "sku": "EXP-001",
            "name": "Exported Gearbox",
            "base_uom": "EA",
            "category": "Mechanical",
        },
    )

    # Export CSV
    export_resp = await client.get("/api/v1/items/export", headers=auth(token))
    assert export_resp.status_code == 200
    assert "text/csv" in export_resp.headers["content-type"]
    assert "sku,name,barcode,category" in export_resp.text
    assert "EXP-001" in export_resp.text
    assert "Exported Gearbox" in export_resp.text

    # Export Excel (.xlsx)
    xlsx_resp = await client.get("/api/v1/items/export?format=xlsx", headers=auth(token))
    assert xlsx_resp.status_code == 200
    assert "openxmlformats" in xlsx_resp.headers["content-type"]
    assert len(xlsx_resp.content) > 100


@pytest.mark.asyncio
async def test_bulk_import_excel_file(client: AsyncClient):
    import base64
    import io
    import openpyxl

    reg = await register_company(client, "ExcelBulk")
    token = reg["access_token"]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["sku", "name", "category", "base_uom", "tracking_mode", "reorder_point"])
    ws.append(["XLS-001", "Precision Ball Bearing", "Bearings", "PCS", "none", "10"])
    ws.append(["XLS-002", "Special Grease 100g", "Chemicals", "CAN", "lot", "5"])
    ws.append(["XLS-003", "Servo Motor 400W", "Motors", "EA", "serial", "2"])

    buf = io.BytesIO()
    wb.save(buf)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    resp = await client.post(
        "/api/v1/items/bulk-import",
        headers=auth(token),
        json={
            "mode": "upsert",
            "file_base64": b64,
            "file_name": "products.xlsx",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total_rows"] == 3
    assert data["created_count"] == 3
    assert data["error_count"] == 0

    # Verify items list
    list_resp = await client.get("/api/v1/items?tracking_mode=lot", headers=auth(token))
    assert list_resp.status_code == 200
    lot_items = list_resp.json()["items"]
    assert len(lot_items) == 1
    assert lot_items[0]["sku"] == "XLS-002"
