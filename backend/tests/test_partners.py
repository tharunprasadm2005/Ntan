import io
import openpyxl
import pytest

from .utils import auth, register_company


@pytest.mark.asyncio
async def test_create_supplier_and_customer_in_internal_inventory_mode(client):
    reg = await register_company(client, "PartnerTestCo")
    token = reg["access_token"]

    # In internal mode, 3pl_client is blocked
    res_blocked = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "3PL-01", "name": "3PL Client A", "types": ["3pl_client"]},
    )
    assert res_blocked.status_code == 409, res_blocked.text
    assert res_blocked.json()["error"]["code"] == "client_inventory_model_required"

    # But supplier is allowed!
    res_supplier = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": "SUP-01",
            "name": "Apex Industrial Supplies",
            "display_name": "Apex Supplies",
            "types": ["supplier"],
            "contact_name": "Rajesh Kumar",
            "contact_email": "rajesh@apex.com",
            "contact_phone": "+91 98765 43210",
            "tax_id": "27AAPFU0939F1ZV",
            "billing_address": {
                "name": "HQ",
                "line1": "Plot 42 MIDC",
                "city": "Mumbai",
                "state": "Maharashtra",
                "postal_code": "400093",
                "country": "IN",
            },
            "notes": "Primary supplier",
        },
    )
    assert res_supplier.status_code == 201, res_supplier.text
    sup = res_supplier.json()
    assert sup["code"] == "SUP-01"
    assert sup["name"] == "Apex Industrial Supplies"
    assert sup["display_name"] == "Apex Supplies"
    assert sup["types"] == ["supplier"]
    assert sup["tax_id"] == "27AAPFU0939F1ZV"
    assert sup["billing_address"]["city"] == "Mumbai"

    # Customer is also allowed!
    res_cust = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": "CUST-01",
            "name": "Metro Retailers Ltd",
            "types": ["customer"],
            "contact_name": "Anita Sharma",
        },
    )
    assert res_cust.status_code == 201, res_cust.text
    cust = res_cust.json()
    assert cust["code"] == "CUST-01"
    assert cust["types"] == ["customer"]

    # Dual role partner: both supplier and customer!
    res_dual = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": "DUAL-01",
            "name": "Global Trade Logistics",
            "types": ["supplier", "customer"],
            "contact_name": "Vikram Singh",
        },
    )
    assert res_dual.status_code == 201, res_dual.text
    dual = res_dual.json()
    assert "supplier" in dual["types"]
    assert "customer" in dual["types"]


@pytest.mark.asyncio
async def test_filter_and_search_partners(client):
    reg = await register_company(client, "SearchTestCo")
    token = reg["access_token"]

    await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "SUP-ALPHA", "name": "Alpha Polymers", "types": ["supplier"], "contact_phone": "+91 99999 11111"},
    )
    await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": "CUST-BETA", "name": "Beta Electronics", "types": ["customer"], "tax_id": "27BAPFU0939F1ZW"},
    )

    # Filter by type=supplier
    res_sup = await client.get("/api/v1/clients?type=supplier", headers=auth(token))
    assert res_sup.status_code == 200
    suppliers = res_sup.json()["clients"]
    assert any(s["code"] == "SUP-ALPHA" for s in suppliers)
    assert not any(s["code"] == "CUST-BETA" for s in suppliers)

    # Filter by type=customer
    res_cust = await client.get("/api/v1/clients?type=customer", headers=auth(token))
    assert res_cust.status_code == 200
    customers = res_cust.json()["clients"]
    assert any(c["code"] == "CUST-BETA" for c in customers)
    assert not any(c["code"] == "SUP-ALPHA" for c in customers)

    # Search by code
    res_search_code = await client.get("/api/v1/clients?search=ALPHA", headers=auth(token))
    assert len(res_search_code.json()["clients"]) == 1
    assert res_search_code.json()["clients"][0]["code"] == "SUP-ALPHA"

    # Search by phone
    res_search_phone = await client.get("/api/v1/clients?search=99999", headers=auth(token))
    assert len(res_search_phone.json()["clients"]) == 1
    assert res_search_phone.json()["clients"][0]["code"] == "SUP-ALPHA"

    # Search by tax_id
    res_search_tax = await client.get("/api/v1/clients?search=BAPFU0939", headers=auth(token))
    assert len(res_search_tax.json()["clients"]) == 1
    assert res_search_tax.json()["clients"][0]["code"] == "CUST-BETA"


@pytest.mark.asyncio
async def test_update_archive_and_tenant_isolation(client):
    reg1 = await register_company(client, "CompanyOne")
    token1 = reg1["access_token"]

    reg2 = await register_company(client, "CompanyTwo")
    token2 = reg2["access_token"]

    res_p1 = await client.post(
        "/api/v1/clients",
        headers=auth(token1),
        json={"code": "P-01", "name": "Partner One", "types": ["supplier"]},
    )
    p1 = res_p1.json()

    # Company 2 cannot see Company 1's partner
    res_tenant = await client.get(f"/api/v1/clients/{p1['id']}", headers=auth(token2))
    assert res_tenant.status_code == 404

    # Duplicate code across different companies is allowed
    res_p2 = await client.post(
        "/api/v1/clients",
        headers=auth(token2),
        json={"code": "P-01", "name": "Partner in Company 2", "types": ["supplier"]},
    )
    assert res_p2.status_code == 201

    # But duplicate code within Company 1 is rejected
    res_dup = await client.post(
        "/api/v1/clients",
        headers=auth(token1),
        json={"code": "P-01", "name": "Duplicate Partner", "types": ["customer"]},
    )
    assert res_dup.status_code == 409
    assert res_dup.json()["error"]["code"] == "duplicate_client_code"

    # Archive partner
    res_archive = await client.patch(
        f"/api/v1/clients/{p1['id']}",
        headers=auth(token1),
        json={"status": "archived"},
    )
    assert res_archive.status_code == 200
    assert res_archive.json()["status"] == "archived"

    # Archived partner is hidden by default from active list
    res_list = await client.get("/api/v1/clients", headers=auth(token1))
    assert not any(p["id"] == p1["id"] for p in res_list.json()["clients"])

    # Visible when include_archived=true
    res_all = await client.get("/api/v1/clients?include_archived=true", headers=auth(token1))
    assert any(p["id"] == p1["id"] for p in res_all.json()["clients"])

    # Internal client cannot be archived
    internal = next(p for p in res_all.json()["clients"] if p["is_internal"])
    res_arch_internal = await client.patch(
        f"/api/v1/clients/{internal['id']}",
        headers=auth(token1),
        json={"status": "archived"},
    )
    assert res_arch_internal.status_code == 409
    assert res_arch_internal.json()["error"]["code"] == "internal_client_required"


@pytest.mark.asyncio
async def test_excel_template_preview_and_confirm_import(client):
    reg = await register_company(client, "ExcelImportCo")
    token = reg["access_token"]

    # 1. Download template
    res_tmpl = await client.get("/api/v1/clients/import/template", headers=auth(token))
    assert res_tmpl.status_code == 200
    assert "openxmlformats" in res_tmpl.headers["content-type"]
    wb = openpyxl.load_workbook(io.BytesIO(res_tmpl.content))
    assert "Partners Import" in wb.sheetnames
    assert "Reference Guide" in wb.sheetnames

    # 2. Build test spreadsheet with 1 valid new partner, 1 duplicate code within file, 1 valid supplier
    import_wb = openpyxl.Workbook()
    ws = import_wb.active
    ws.title = "Partners Import"
    ws.append(["Partner Code *", "Legal Name *", "Display Name", "Relationship Types *", "Contact Person", "Phone", "Notes"])
    ws.append(["EX-SUP-1", "Excel Supplier Inc", "Excel Sup", "supplier", "John Doe", "+91 91234 56789", "=SUM(A1:A2)"]) # with formula to test sanitization
    ws.append(["EX-CUST-1", "Excel Customer Corp", "", "customer", "Jane Smith", "", ""])
    ws.append(["EX-SUP-1", "Duplicate Row in File", "", "supplier", "", "", ""])

    buf = io.BytesIO()
    import_wb.save(buf)
    file_bytes = buf.getvalue()

    # 3. Preview import
    preview_res = await client.post(
        "/api/v1/clients/import/preview",
        headers=auth(token),
        files={"file": ("test_import.xlsx", file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert preview_res.status_code == 200, preview_res.text
    p_data = preview_res.json()
    assert p_data["total_rows"] == 3
    assert p_data["valid_count"] == 2
    assert p_data["invalid_count"] == 1
    assert any("Duplicate partner code" in err for err in p_data["rows"][2]["errors"])

    # Verify formula injection was sanitized
    assert p_data["rows"][0]["notes"].startswith("'=SUM")

    # 4. Confirm import
    confirm_res = await client.post(
        "/api/v1/clients/import/confirm",
        headers=auth(token),
        json={
            "rows": p_data["rows"],
            "duplicate_strategy": "skip",
        },
    )
    assert confirm_res.status_code == 200, confirm_res.text
    c_data = confirm_res.json()
    assert c_data["created_count"] == 2
    assert c_data["failed_count"] == 1 # the invalid row

    # Verify imported partners exist
    list_res = await client.get("/api/v1/clients", headers=auth(token))
    codes = [p["code"] for p in list_res.json()["clients"]]
    assert "EX-SUP-1" in codes
    assert "EX-CUST-1" in codes

    # 5. Export partners
    export_res = await client.get("/api/v1/clients/export", headers=auth(token))
    assert export_res.status_code == 200
    export_wb = openpyxl.load_workbook(io.BytesIO(export_res.content))
    assert "Business Partners" in export_wb.sheetnames


@pytest.mark.asyncio
async def test_partner_integrations_and_3pl_protection(client):
    reg = await register_company(client, "IntegrationCo")
    token = reg["access_token"]

    # Create supplier partner
    res_sup = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={
            "code": "SUP-INTEG",
            "name": "Integration Supplies Pvt Ltd",
            "display_name": "Integ Supply",
            "types": ["supplier"],
        },
    )
    assert res_sup.status_code == 201
    supplier = res_sup.json()

    # Attempt to scope an inventory item to this supplier (which lacks 3pl_client role) -> MUST BE REJECTED!
    res_item = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json={
            "sku": "ITEM-NON3PL",
            "name": "Non 3PL Item",
            "client_id": supplier["id"],
            "base_uom": "EA",
            "item_type": "stocked_material",
        },
    )
    assert res_item.status_code == 422, res_item.text
    assert res_item.json()["error"]["code"] == "invalid_client"

