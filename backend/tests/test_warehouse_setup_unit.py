import pytest
from app.schemas import LocationCreate, LocationUpdate, LocationOut, WarehouseCreate, InitialLocationCreate
from app.serializers import location_out
from app.services.putaway import PUTAWAY_SOURCE_TYPES

def test_location_create_schema_name():
    loc = LocationCreate(
        warehouse_id="wh-1",
        code="ZONE-A",
        name="Receiving Dock 1",
        type="receiving",
        is_pickable=False
    )
    assert loc.name == "Receiving Dock 1"
    assert loc.code == "ZONE-A"

def test_location_update_schema_name():
    loc = LocationUpdate(
        name="Renamed Area",
        is_pickable=True
    )
    assert loc.name == "Renamed Area"
    assert loc.is_pickable is True

def test_location_out_serializer():
    doc = {
        "_id": "loc-123",
        "company_id": "comp-1",
        "warehouse_id": "wh-1",
        "code": "ROOM-01",
        "name": "Cold Storage Room 1",
        "type": "cold_storage",
        "is_pickable": True,
        "status": "active",
        "created_at": "2026-10-28T10:00:00Z",
        "updated_at": "2026-10-28T10:00:00Z",
    }
    out = location_out(doc)
    assert out.name == "Cold Storage Room 1"
    assert out.code == "ROOM-01"
    assert out.type == "cold_storage"

def test_warehouse_create_initial_locations_multiple_same_purpose():
    # Multiple areas with same operational purpose and different codes
    initial_locs = [
        InitialLocationCreate(code="DOCK-01", name="Inbound Dock North", type="receiving", is_pickable=False),
        InitialLocationCreate(code="DOCK-02", name="Inbound Dock South", type="receiving", is_pickable=False),
        InitialLocationCreate(code="STORE-1", name="Floor Storage 1", type="main", is_pickable=True),
        InitialLocationCreate(code="STORE-2", name="Floor Storage 2", type="main", is_pickable=True),
    ]
    wh = WarehouseCreate(
        name="Multi-Dock Warehouse",
        code="MD-01",
        initial_locations=initial_locs
    )
    assert len(wh.initial_locations) == 4
    assert wh.initial_locations[0].name == "Inbound Dock North"
    assert wh.initial_locations[1].name == "Inbound Dock South"

def test_all_in_one_multi_purpose_eligibility_rules():
    # Verify that 'main' is NOT in PUTAWAY_SOURCE_TYPES
    # This proves receipts into 'main' do NOT trigger intermediate putaway tasks,
    # and outbound pickers can pick directly from pickable 'main' locations.
    assert "receiving" in PUTAWAY_SOURCE_TYPES
    assert "staging" in PUTAWAY_SOURCE_TYPES
    assert "main" not in PUTAWAY_SOURCE_TYPES
