import pytest
from httpx import AsyncClient

from .utils import auth, create_item, create_warehouse, default_location, register_company


@pytest.mark.asyncio
async def test_location_crud_and_status(client: AsyncClient) -> None:
    session = await register_company(client, "LocCRUD")
    token = session["access_token"]
    warehouse = await create_warehouse(client, token, "Storage Facility")

    # 1. Create a location with hierarchy components
    res = await client.post(
        "/api/v1/locations",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "code": "RACK-01",
            "type": "main",
            "is_pickable": False,
            "status": "active",
            "aisle": "01",
            "rack": "01",
        },
    )
    assert res.status_code == 201, res.text
    rack_loc = res.json()
    assert rack_loc["code"] == "RACK-01"
    assert rack_loc["path"] == "RACK-01"
    assert rack_loc["status"] == "active"
    assert rack_loc["aisle"] == "01"
    assert rack_loc["rack"] == "01"

    # Create child bin under RACK-01
    res_child = await client.post(
        "/api/v1/locations",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "parent_id": rack_loc["id"],
            "code": "BIN-A",
            "type": "bin",
            "is_pickable": True,
            "status": "active",
            "shelf": "01",
            "bin": "01",
        },
    )
    assert res_child.status_code == 201, res_child.text
    bin_loc = res_child.json()
    assert bin_loc["path"] == "RACK-01/BIN-A"
    assert bin_loc["shelf"] == "01"
    assert bin_loc["bin"] == "01"

    # 2. Get location by ID
    res_get = await client.get(f"/api/v1/locations/{bin_loc['id']}", headers=auth(token))
    assert res_get.status_code == 200
    assert res_get.json()["id"] == bin_loc["id"]

    # 3. Update location: rename code and verify path updates
    res_patch = await client.patch(
        f"/api/v1/locations/{bin_loc['id']}",
        headers=auth(token),
        json={"code": "BIN-B", "is_pickable": False},
    )
    assert res_patch.status_code == 200, res_patch.text
    updated = res_patch.json()
    assert updated["code"] == "BIN-B"
    assert updated["path"] == "RACK-01/BIN-B"
    assert updated["is_pickable"] is False

    # 4. Status update to blocked
    res_block = await client.patch(
        f"/api/v1/locations/{bin_loc['id']}",
        headers=auth(token),
        json={"status": "blocked"},
    )
    assert res_block.status_code == 200
    assert res_block.json()["status"] == "blocked"

    # 5. List locations filter
    res_list = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    assert res_list.status_code == 200
    codes = [l["code"] for l in res_list.json()["locations"]]
    assert "BIN-B" in codes  # Blocked locations are included in default active/blocked list

    res_blocked_only = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"], "status": "blocked"},
    )
    assert res_blocked_only.status_code == 200
    assert len(res_blocked_only.json()["locations"]) == 1
    assert res_blocked_only.json()["locations"][0]["code"] == "BIN-B"


@pytest.mark.asyncio
async def test_blocked_location_operational_restrictions(client: AsyncClient) -> None:
    session = await register_company(client, "BlockedOps")
    token = session["access_token"]
    warehouse = await create_warehouse(client, token, "Ops Warehouse")
    item = await create_item(client, token, "SKU-BLK-1", "Block Item")

    # Create a location and block it
    res = await client.post(
        "/api/v1/locations",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "code": "HOLD-01",
            "type": "bin",
            "is_pickable": False,
            "status": "blocked",
        },
    )
    assert res.status_code == 201
    blocked_loc = res.json()

    # Attempt to receive stock directly into blocked location -> rejected
    res_rcv = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": "rcv-blocked-001"},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": blocked_loc["id"],
            "lines": [{"item_id": item["id"], "qty": "10", "uom": "EA"}],
        },
    )
    assert res_rcv.status_code == 422
    assert "invalid_location" in res_rcv.text

    # Attempt to complete putaway to blocked location -> rejected
    recv_loc = await default_location(client, token, warehouse["id"])
    res_rcv_ok = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": "rcv-putaway-001"},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": recv_loc["id"],
            "lines": [{"item_id": item["id"], "qty": "5", "uom": "EA"}],
        },
    )
    assert res_rcv_ok.status_code == 201
    receipt = res_rcv_ok.json()

    # Commit receipt to generate putaway task
    commit_res = await client.post(
        f"/api/v1/receipts/{receipt['id']}/commit",
        headers=auth(token),
    )
    assert commit_res.status_code == 200

    tasks_res = await client.get("/api/v1/putaway/tasks", headers=auth(token))
    assert tasks_res.status_code == 200
    task = tasks_res.json()["tasks"][0]

    # Try to complete putaway to blocked location -> 404/422 destination rejected
    complete_res = await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": blocked_loc["id"]},
    )
    assert complete_res.status_code in (404, 422)


@pytest.mark.asyncio
async def test_bulk_location_generation(client: AsyncClient) -> None:
    session = await register_company(client, "BulkGen")
    token = session["access_token"]
    warehouse = await create_warehouse(client, token, "Bulk Warehouse")

    # 1. Preview generation of 4 bins: Aisle 1, Rack 1, Shelf 1..2, Bin 1..2
    preview_res = await client.post(
        "/api/v1/locations/bulk",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "prefix": "ZN1",
            "aisle_start": 1,
            "aisle_end": 1,
            "rack_start": 1,
            "rack_end": 1,
            "shelf_start": 1,
            "shelf_end": 2,
            "bin_start": 1,
            "bin_end": 2,
            "separator": "-",
            "zero_pad": 2,
            "type": "bin",
            "is_pickable": True,
            "preview_only": True,
        },
    )
    assert preview_res.status_code == 200, preview_res.text
    preview_data = preview_res.json()
    assert preview_data["preview_only"] is True
    assert preview_data["total_generated"] == 4
    assert preview_data["new_count"] == 4
    assert preview_data["duplicate_count"] == 0
    assert preview_data["created_count"] == 0
    assert len(preview_data["locations"]) == 4

    expected_codes = [
        "ZN1-01-01-01-01",
        "ZN1-01-01-01-02",
        "ZN1-01-01-02-01",
        "ZN1-01-01-02-02",
    ]
    actual_codes = [loc["code"] for loc in preview_data["locations"]]
    assert actual_codes == expected_codes

    # 2. Commit creation (preview_only = False)
    create_res = await client.post(
        "/api/v1/locations/bulk",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "prefix": "ZN1",
            "aisle_start": 1,
            "aisle_end": 1,
            "rack_start": 1,
            "rack_end": 1,
            "shelf_start": 1,
            "shelf_end": 2,
            "bin_start": 1,
            "bin_end": 2,
            "separator": "-",
            "zero_pad": 2,
            "type": "bin",
            "is_pickable": True,
            "preview_only": False,
        },
    )
    assert create_res.status_code == 200, create_res.text
    create_data = create_res.json()
    assert create_data["created_count"] == 4
    assert create_data["new_count"] == 4
    assert create_data["duplicate_count"] == 0

    # 3. Run again: all 4 should now be detected as duplicates
    second_res = await client.post(
        "/api/v1/locations/bulk",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "prefix": "ZN1",
            "aisle_start": 1,
            "aisle_end": 1,
            "rack_start": 1,
            "rack_end": 1,
            "shelf_start": 1,
            "shelf_end": 2,
            "bin_start": 1,
            "bin_end": 2,
            "separator": "-",
            "zero_pad": 2,
            "type": "bin",
            "is_pickable": True,
            "preview_only": True,
        },
    )
    assert second_res.status_code == 200
    second_data = second_res.json()
    assert second_data["new_count"] == 0
    assert second_data["duplicate_count"] == 4
    assert all(loc["is_duplicate"] for loc in second_data["locations"])

    # 4. Limit exceeded rejection
    large_res = await client.post(
        "/api/v1/locations/bulk",
        headers=auth(token),
        json={
            "warehouse_id": warehouse["id"],
            "aisle_start": 1,
            "aisle_end": 10,
            "rack_start": 1,
            "rack_end": 10,
            "shelf_start": 1,
            "shelf_end": 10,
            "bin_start": 1,
            "bin_end": 10,
            "preview_only": True,
        },
    )
    assert large_res.status_code == 422
    assert "batch_too_large" in large_res.text


@pytest.mark.asyncio
async def test_outbound_allocation_skips_blocked_and_non_pickable(client: AsyncClient) -> None:
    session = await register_company(client, "PickCheck")
    token = session["access_token"]
    warehouse = await create_warehouse(client, token, "Pick Warehouse")
    item = await create_item(client, token, "SKU-PICK-1", "Pick Item")

    locations_res = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse["id"]},
    )
    locations = {loc["code"]: loc for loc in locations_res.json()["locations"]}
    recv_loc = locations["RECV"]
    bin_loc = locations["BIN-01"]

    # 1. Receive stock into RECV and put away to BIN-01
    rcv_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": "rcv-pick-001"},
        json={
            "warehouse_id": warehouse["id"],
            "location_id": recv_loc["id"],
            "lines": [{"item_id": item["id"], "qty": "10", "uom": "EA"}],
        },
    )
    assert rcv_res.status_code == 201
    rcv = rcv_res.json()
    await client.post(f"/api/v1/receipts/{rcv['id']}/commit", headers=auth(token))

    tasks_res = await client.get("/api/v1/putaway/tasks", headers=auth(token))
    task = tasks_res.json()["tasks"][0]
    await client.post(
        f"/api/v1/putaway/tasks/{task['id']}/complete",
        headers=auth(token),
        json={"location_id": bin_loc["id"]},
    )

    # 2. Create outbound order for 5 units
    order_res = await client.post(
        "/api/v1/outbound/orders",
        headers={**auth(token), "Idempotency-Key": "out-pick-001"},
        json={
            "warehouse_id": warehouse["id"],
            "customer_name": "Acme Customer",
            "lines": [{"item_id": item["id"], "qty": "5"}],
        },
    )
    assert order_res.status_code == 201, order_res.text
    order = order_res.json()

    # Set BIN-01 to is_pickable = False
    await client.patch(
        f"/api/v1/locations/{bin_loc['id']}",
        headers=auth(token),
        json={"is_pickable": False},
    )

    # Attempt allocation -> 409 insufficient_stock (non-pickable location skipped)
    alloc_res_1 = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert alloc_res_1.status_code == 409
    assert "insufficient_stock" in alloc_res_1.text

    # Set BIN-01 to is_pickable = True, but status = "blocked"
    await client.patch(
        f"/api/v1/locations/{bin_loc['id']}",
        headers=auth(token),
        json={"is_pickable": True, "status": "blocked"},
    )

    # Attempt allocation -> 409 insufficient_stock (blocked location skipped)
    alloc_res_2 = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert alloc_res_2.status_code == 409
    assert "insufficient_stock" in alloc_res_2.text

    # Set BIN-01 back to status = "active"
    await client.patch(
        f"/api/v1/locations/{bin_loc['id']}",
        headers=auth(token),
        json={"status": "active"},
    )

    # Attempt allocation -> succeeds!
    alloc_res_3 = await client.post(
        f"/api/v1/outbound/orders/{order['id']}/allocate",
        headers=auth(token),
    )
    assert alloc_res_3.status_code == 200
    allocated_order = alloc_res_3.json()
    assert allocated_order["status"] == "allocated"
    assert len(allocated_order["allocations"]) == 1
    assert allocated_order["allocations"][0]["location_id"] == bin_loc["id"]


@pytest.mark.asyncio
async def test_warehouse_metadata_and_empty_creation(client: AsyncClient) -> None:
    session = await register_company(client, "WhMetaCo")
    token = session["access_token"]

    # 1. Create warehouse with custom type, layout, and apply_default_locations = False
    res = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={
            "name": "Cold Chain Central",
            "code": "COLD-01",
            "address": "123 Arctic Way, Industrial Area",
            "warehouse_type": "cold_storage",
            "warehouse_layout": "all_in_one",
            "apply_default_locations": False,
        },
    )
    assert res.status_code == 201, res.text
    wh = res.json()
    assert wh["name"] == "Cold Chain Central"
    assert wh["code"] == "COLD-01"
    assert wh["address"] == "123 Arctic Way, Industrial Area"
    assert wh["warehouse_type"] == "cold_storage"
    assert wh["warehouse_layout"] == "all_in_one"

    # 2. Check no default locations were created
    locs_res = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh["id"]},
    )
    assert locs_res.status_code == 200
    assert len(locs_res.json()["locations"]) == 0

    # 3. Create a flat-floor location without aisle/rack/shelf coordinates
    loc_res = await client.post(
        "/api/v1/locations",
        headers=auth(token),
        json={
            "warehouse_id": wh["id"],
            "code": "FREEZER-ZONE-A",
            "type": "main",
            "is_pickable": True,
        },
    )
    assert loc_res.status_code == 201
    loc_data = loc_res.json()
    assert loc_data["code"] == "FREEZER-ZONE-A"
    assert loc_data["aisle"] is None
    assert loc_data["rack"] is None


@pytest.mark.asyncio
async def test_warehouse_template_preview_and_apply(client: AsyncClient) -> None:
    session = await register_company(client, "TemplateCo")
    token = session["access_token"]

    # Create empty bulk storage warehouse
    wh_res = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={
            "name": "Bulk Pallet Depot",
            "code": "DEPOT-01",
            "warehouse_type": "bulk",
            "warehouse_layout": "bulk_storage",
            "apply_default_locations": False,
        },
    )
    assert wh_res.status_code == 201
    wh = wh_res.json()

    # 1. Preview template
    prev_res = await client.post(
        f"/api/v1/warehouses/{wh['id']}/apply-template",
        headers=auth(token),
        json={"preview_only": True},
    )
    assert prev_res.status_code == 200
    prev_data = prev_res.json()
    assert prev_data["preview_only"] is True
    assert prev_data["warehouse_layout"] == "bulk_storage"
    assert len(prev_data["locations"]) == 2
    codes = [l["code"] for l in prev_data["locations"]]
    assert "RECV" in codes
    assert "MAIN" in codes
    assert prev_data["created_count"] == 0

    # Verify no records actually inserted
    check_empty = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh["id"]},
    )
    assert len(check_empty.json()["locations"]) == 0

    # 2. Confirm and apply template
    apply_res = await client.post(
        f"/api/v1/warehouses/{wh['id']}/apply-template",
        headers=auth(token),
        json={"preview_only": False},
    )
    assert apply_res.status_code == 200
    apply_data = apply_res.json()
    assert apply_data["preview_only"] is False
    assert apply_data["created_count"] == 2

    # Verify records in database
    locs_res = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh["id"]},
    )
    assert len(locs_res.json()["locations"]) == 2


@pytest.mark.asyncio
async def test_location_archive_prevented_when_stock_on_hand(client: AsyncClient) -> None:
    session = await register_company(client, "ArchiveStockCo")
    token = session["access_token"]
    wh = await create_warehouse(client, token, "Archive Facility")
    item = await create_item(client, token, "SKU-ARCHIVE-1", "Stock Item")

    # Get locations
    locs_res = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh["id"]},
    )
    locations = {l["code"]: l for l in locs_res.json()["locations"]}
    recv_loc = locations["RECV"]

    # Receive stock into RECV
    rcv_res = await client.post(
        "/api/v1/receipts",
        headers={**auth(token), "Idempotency-Key": "rcv-arch-001"},
        json={
            "warehouse_id": wh["id"],
            "location_id": recv_loc["id"],
            "lines": [{"item_id": item["id"], "qty": "25", "uom": "EA"}],
        },
    )
    assert rcv_res.status_code == 201
    rcv = rcv_res.json()
    commit_res = await client.post(f"/api/v1/receipts/{rcv['id']}/commit", headers=auth(token))
    assert commit_res.status_code == 200

    # Attempt to archive RECV location while positive stock exists -> 409 location_has_stock
    archive_res = await client.patch(
        f"/api/v1/locations/{recv_loc['id']}",
        headers=auth(token),
        json={"status": "archived"},
    )
    assert archive_res.status_code == 409
    assert "location_has_stock" in archive_res.text


@pytest.mark.asyncio
async def test_warehouse_creation_with_custom_initial_locations(client: AsyncClient) -> None:
    session = await register_company(client, "CustomLocWH")
    token = session["access_token"]

    # 1. Create a warehouse with custom configured areas & rack-bin hierarchy
    res_custom = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={
            "name": "Distribution Center Alpha",
            "code": "DC-ALPHA",
            "warehouse_type": "distribution",
            "warehouse_layout": "multi_zone",
            "initial_locations": [
                {"code": "INBOUND-DOCK", "type": "receiving", "is_pickable": False},
                {"code": "MAIN-STORAGE", "type": "main", "is_pickable": False},
                {"code": "OUTBOUND-DOCK", "type": "dispatch", "is_pickable": False},
                {"code": "QC-HOLD", "type": "quarantine", "is_pickable": False},
                {
                    "code": "BIN-A01",
                    "type": "bin",
                    "parent_code": "MAIN-STORAGE",
                    "aisle": "01",
                    "rack": "01",
                    "shelf": "01",
                    "bin": "01",
                    "is_pickable": True,
                },
            ],
        },
    )
    assert res_custom.status_code == 201, res_custom.text
    wh_custom = res_custom.json()
    assert wh_custom["code"] == "DC-ALPHA"

    # Verify persisted locations
    locs_res = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh_custom["id"]},
    )
    assert locs_res.status_code == 200
    locations = locs_res.json()["locations"]
    loc_by_code = {l["code"]: l for l in locations}

    assert len(locations) == 5
    assert "INBOUND-DOCK" in loc_by_code
    assert loc_by_code["INBOUND-DOCK"]["type"] == "receiving"
    assert loc_by_code["MAIN-STORAGE"]["type"] == "main"
    assert loc_by_code["BIN-A01"]["parent_id"] == loc_by_code["MAIN-STORAGE"]["id"]
    assert loc_by_code["BIN-A01"]["path"] == "MAIN-STORAGE/BIN-A01"
    assert loc_by_code["BIN-A01"]["aisle"] == "01"

    # 2. Create a blank warehouse with initial_locations=[] (skip location creation)
    res_blank = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={
            "name": "Blank Facility",
            "code": "BLANK-WH",
            "warehouse_type": "bulk",
            "warehouse_layout": "bulk_storage",
            "initial_locations": [],
        },
    )
    assert res_blank.status_code == 201, res_blank.text
    wh_blank = res_blank.json()

    blank_locs = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": wh_blank["id"]},
    )
    assert blank_locs.status_code == 200
    assert len(blank_locs.json()["locations"]) == 0

    # 3. Duplicate code validation under same parent fails safely
    res_dup = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={
            "name": "Bad Duplicate WH",
            "code": "BAD-WH",
            "initial_locations": [
                {"code": "RECV", "type": "receiving"},
                {"code": "RECV", "type": "receiving"},
            ],
        },
    )
    assert res_dup.status_code == 409
    assert "duplicate_location_code" in res_dup.text

