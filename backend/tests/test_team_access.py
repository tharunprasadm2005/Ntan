import io
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.security import normalize_invite_code
from tests.utils import (
    auth,
    create_warehouse,
    default_location,
    join_company,
    register_company,
)


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


async def test_team_overview_and_member_lifecycle(client: httpx.AsyncClient):
    owner = await register_company(client, "OverviewCo")
    owner_token = owner["access_token"]

    # 1. Check initial overview
    overview_resp = await client.get("/api/v1/members/overview", headers=auth(owner_token))
    assert overview_resp.status_code == 200
    overview = overview_resp.json()
    assert overview["total_members"] == 1
    assert overview["active_members"] == 1
    assert overview["pending_invitations"] == 0
    assert overview["suspended_members"] == 0

    # 2. Invite a member
    member_email = _email("member")
    invite_resp = await client.post(
        "/api/v1/members/invitations",
        headers=auth(owner_token),
        json={"email": member_email, "role": "warehouse_operator", "name": "Test Operator"},
    )
    assert invite_resp.status_code == 201
    invite_data = invite_resp.json()
    assert invite_data["email"] == member_email
    assert invite_data["invite_code"] is not None

    # Overview should now have 1 pending invitation
    overview2 = (await client.get("/api/v1/members/overview", headers=auth(owner_token))).json()
    assert overview2["pending_invitations"] == 1

    # Resend invitation
    resend_resp = await client.post(
        f"/api/v1/members/invitations/{invite_data['id']}/resend",
        headers=auth(owner_token),
    )
    assert resend_resp.status_code == 200

    # Replace invitation
    replace_resp = await client.post(
        f"/api/v1/members/invitations/{invite_data['id']}/replace",
        headers=auth(owner_token),
    )
    assert replace_resp.status_code == 200
    replaced_data = replace_resp.json()
    assert replaced_data["id"] != invite_data["id"]

    # Accept the replaced invitation
    accept_resp = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": replaced_data["invitation_token"],
            "name": "Operator One",
            "email": member_email,
            "password": "Password@123",
        },
    )
    assert accept_resp.status_code == 200
    member_token = accept_resp.json()["access_token"]
    membership_id = accept_resp.json()["membership"]["id"]

    # Suspend member
    suspend_resp = await client.post(
        f"/api/v1/members/{membership_id}/suspend",
        headers=auth(owner_token),
    )
    assert suspend_resp.status_code == 200
    assert suspend_resp.json()["status"] == "suspended"

    # Suspended member session must be rejected with 403
    session_check = await client.get("/api/v1/items", headers=auth(member_token))
    assert session_check.status_code == 403
    assert session_check.json()["error"]["code"] == "membership_suspended"

    # Reactivate member
    reactivate_resp = await client.post(
        f"/api/v1/members/{membership_id}/reactivate",
        headers=auth(owner_token),
    )
    assert reactivate_resp.status_code == 200
    assert reactivate_resp.json()["status"] == "active"


async def test_custom_roles_management_and_privilege_escalation(client: httpx.AsyncClient):
    owner = await register_company(client, "CustomRoleCo")
    owner_token = owner["access_token"]

    # 1. List permissions catalogue
    perms_resp = await client.get("/api/v1/members/permissions", headers=auth(owner_token))
    assert perms_resp.status_code == 200
    catalogue = perms_resp.json()
    assert len(catalogue) > 0
    all_perm_keys = [p["key"] for cat in catalogue for p in cat["permissions"]]
    assert "inventory.read" in all_perm_keys
    assert "stock.receive" in all_perm_keys

    # 2. Create custom role as Owner
    create_role_resp = await client.post(
        "/api/v1/members/roles",
        headers=auth(owner_token),
        json={
            "name": "Night Shift Lead",
            "slug": "night_shift_lead",
            "description": "Supervises overnight warehouse putaway and counts",
            "permissions": ["inventory.read", "stock.putaway", "stock.count"],
        },
    )
    assert create_role_resp.status_code == 201
    custom_role = create_role_resp.json()
    assert custom_role["slug"] == "night_shift_lead"
    assert custom_role["is_custom"] is True

    # 3. List roles should include builtins + custom role
    roles_list_resp = await client.get("/api/v1/members/roles", headers=auth(owner_token))
    assert roles_list_resp.status_code == 200
    roles = roles_list_resp.json()
    assert any(r["slug"] == "night_shift_lead" for r in roles)

    # 4. Privilege escalation prevention:
    # A manager who only has stock permissions cannot create a role with company.manage or members.manage
    manager_email = _email("manager")
    manager = await join_company(client, owner_token, manager_email, "receiving_operator")
    manager_token = manager["access_token"]

    escalation_resp = await client.post(
        "/api/v1/members/roles",
        headers=auth(manager_token),
        json={
            "name": "Super Admin Bypass",
            "permissions": ["company.manage", "members.manage"],
        },
    )
    assert escalation_resp.status_code == 403


async def test_excel_bulk_import_workflow(client: httpx.AsyncClient):
    owner = await register_company(client, "ExcelImportCo")
    owner_token = owner["access_token"]

    # Download Excel template
    template_resp = await client.get("/api/v1/members/import/template", headers=auth(owner_token))
    assert template_resp.status_code == 200
    assert "spreadsheetml" in template_resp.headers["content-type"]
    template_bytes = template_resp.content
    assert len(template_bytes) > 1000

    # Test CSV upload preview
    csv_content = (
        "Full Name,Email,Role,Warehouse Codes,Phone Number,Employee ID\n"
        "Alice Smith,alice@example.com,warehouse_operator,WH-01,+919876543210,EMP-001\n"
        "Bob Jones,bob@example.com,viewer,WH-01,,EMP-002\n"
        "=1+1 Formula Injection,hacker@example.com,viewer,WH-01,,EMP-003\n"
    ).encode("utf-8")

    files = {"file": ("test_import.csv", io.BytesIO(csv_content), "text/csv")}
    preview_resp = await client.post(
        "/api/v1/members/import/preview",
        headers=auth(owner_token),
        files=files,
    )
    assert preview_resp.status_code == 200
    preview_data = preview_resp.json()
    assert preview_data["total_rows"] == 3

    # Check formula injection neutralization
    hacker_row = [r for r in preview_data["rows"] if r["email"] == "hacker@example.com"][0]
    assert hacker_row["name"].startswith("'")

    # Confirm bulk import
    confirm_resp = await client.post(
        "/api/v1/members/import/confirm",
        headers=auth(owner_token),
        json={
            "rows": [
                {
                    "name": "Alice Smith",
                    "email": _email("alice-imported"),
                    "role": "warehouse_operator",
                    "warehouse_codes": [],
                    "phone": "+919876543210",
                    "employee_id": "EMP-001",
                },
                {
                    "name": "Bob Jones",
                    "email": _email("bob-imported"),
                    "role": "viewer",
                    "warehouse_codes": [],
                    "employee_id": "EMP-002",
                },
            ],
            "send_emails": False,
        },
    )
    assert confirm_resp.status_code == 200
    confirm_data = confirm_resp.json()
    assert confirm_data["created_count"] == 2
    assert len(confirm_data["results"]) == 2


async def test_invitation_security_cases(client: httpx.AsyncClient):
    owner = await register_company(client, "SecurityCo")
    owner_token = owner["access_token"]

    target_email = _email("security-target")
    invite_resp = await client.post(
        "/api/v1/members/invitations",
        headers=auth(owner_token),
        json={"email": target_email, "role": "viewer", "name": "Security Target"},
    )
    assert invite_resp.status_code == 201
    invite_info = invite_resp.json()
    raw_token = invite_info["invitation_token"]
    invitation_id = invite_info["id"]

    # 1. Acceptance with mismatched email fails
    bad_email_resp = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": raw_token,
            "name": "Intruder",
            "email": _email("wrong-email"),
            "password": "Password@123",
        },
    )
    assert bad_email_resp.status_code in (400, 403, 404, 422)

    # 2. Revoke invitation
    revoke_resp = await client.delete(
        f"/api/v1/members/invitations/{invitation_id}",
        headers=auth(owner_token),
    )
    assert revoke_resp.status_code in (200, 204)

    # 3. Acceptance after revocation fails
    revoked_accept = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": raw_token,
            "name": "Security Target",
            "email": target_email,
            "password": "Password@123",
        },
    )
    assert revoked_accept.status_code in (400, 404)

    # 4. Protection of Last Active Owner
    # Attempting to suspend or remove the last active owner must be blocked
    owner_membership_id = owner["membership"]["id"]
    suspend_owner = await client.post(
        f"/api/v1/members/{owner_membership_id}/suspend",
        headers=auth(owner_token),
    )
    assert suspend_owner.status_code in (400, 409)
    assert "owner" in suspend_owner.json()["error"]["message"].lower()

    remove_owner = await client.delete(
        f"/api/v1/members/{owner_membership_id}",
        headers=auth(owner_token),
    )
    assert remove_owner.status_code in (400, 409)
    assert "owner" in remove_owner.json()["error"]["message"].lower()


async def test_warehouse_scoping_and_temporary_access(client: httpx.AsyncClient):
    owner = await register_company(client, "WarehouseScopeCo")
    owner_token = owner["access_token"]

    # Create two warehouses
    wh1 = await create_warehouse(client, owner_token, "Warehouse North")
    wh2 = await create_warehouse(client, owner_token, "Warehouse South")

    # Invite a temporary worker assigned ONLY to wh1 with past expiration
    worker_email = _email("temp-worker")
    expired_time = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    invite_resp = await client.post(
        "/api/v1/members/invitations",
        headers=auth(owner_token),
        json={
            "email": worker_email,
            "role": "warehouse_operator",
            "name": "Temp Operator",
            "location_ids": [wh1["id"]],
            "warehouse_ids": [wh1["id"]],
            "valid_until": expired_time,
        },
    )
    assert invite_resp.status_code == 201
    invite_info = invite_resp.json()

    accept_resp = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": invite_info["invitation_token"],
            "name": "Temp Operator",
            "email": worker_email,
            "password": "Password@123",
        },
    )
    assert accept_resp.status_code == 200
    worker_token = accept_resp.json()["access_token"]

    # Since valid_until is in the past, requests should be rejected with membership_expired (403)
    expired_check = await client.get("/api/v1/items", headers=auth(worker_token))
    assert expired_check.status_code == 403
    assert expired_check.json()["error"]["code"] == "membership_expired"


async def test_fourteen_operational_roles_catalogue_and_delegation(client: httpx.AsyncClient):
    owner = await register_company(client, "RolesCatalogCo")
    owner_token = owner["access_token"]

    # 1. Fetch system roles from backend
    roles_resp = await client.get("/api/v1/members/roles", headers=auth(owner_token))
    assert roles_resp.status_code == 200
    roles_list = roles_resp.json()
    roles_by_slug = {r["slug"]: r for r in roles_list}

    # 14 Operational Roles required by NTAN
    operational_14_roles = [
        "warehouse_manager",
        "warehouse_supervisor",
        "receiving_operator",
        "quality_inspector",
        "putaway_operator",
        "material_handler",
        "inventory_controller",
        "replenishment_operator",
        "order_picker",
        "packing_operator",
        "dispatch_operator",
        "logistics_coordinator",
        "cycle_counter",
        "returns_operator",
    ]

    for role_slug in operational_14_roles:
        assert role_slug in roles_by_slug, f"Role {role_slug} must be present in system roles"
        role_def = roles_by_slug[role_slug]
        assert role_def["is_system"] is True
        assert role_def["is_custom"] is False
        assert len(role_def["name"]) > 0
        assert len(role_def["description"]) > 0
        assert isinstance(role_def["permissions"], list)

    # Organization-level roles preserved
    assert "owner" in roles_by_slug
    assert "company_admin" in roles_by_slug

    # Read-only access profiles preserved
    assert "viewer" in roles_by_slug
    assert "auditor" in roles_by_slug

    # 2. Invite an Order Picker
    picker_email = _email("order-picker")
    picker = await join_company(client, owner_token, picker_email, "order_picker")
    picker_token = picker["access_token"]
    assert picker["membership"]["role"] == "order_picker"

    picker_session = await client.get("/api/v1/auth/session", headers=auth(picker_token))
    assert picker_session.status_code == 200
    picker_perms = set(picker_session.json()["permissions"])
    assert "stock.pick" in picker_perms
    assert "inventory.read" in picker_perms
    # Operational worker must not have sensitive permissions
    assert "stock.adjust" not in picker_perms
    assert "members.manage" not in picker_perms
    assert "roles.manage" not in picker_perms
    assert "company.manage" not in picker_perms

    # 3. Invite a Cycle Counter
    counter_email = _email("cycle-counter")
    counter = await join_company(client, owner_token, counter_email, "cycle_counter")
    counter_token = counter["access_token"]
    assert counter["membership"]["role"] == "cycle_counter"

    counter_session = await client.get("/api/v1/auth/session", headers=auth(counter_token))
    assert counter_session.status_code == 200
    counter_perms = set(counter_session.json()["permissions"])
    assert "stock.count" in counter_perms
    assert "stock.adjust" not in counter_perms
    assert "stock.dispatch" not in counter_perms

    # 4. Invite a Quality Control Inspector
    qc_email = _email("qc-inspector")
    qc = await join_company(client, owner_token, qc_email, "quality_inspector")
    assert qc["membership"]["role"] == "quality_inspector"


@pytest.mark.asyncio
async def test_warehouse_manager_scoped_security_corrections(
    client: httpx.AsyncClient,
) -> None:
    owner = await register_company(client, "SecCo")
    owner_token = owner["access_token"]

    # 1. Create two separate warehouses
    wh1_res = await client.post(
        "/api/v1/warehouses",
        headers=auth(owner_token),
        json={"name": "North Hub", "code": "WH-NH", "address": "100 North Way"},
    )
    assert wh1_res.status_code == 201
    wh1_id = wh1_res.json()["id"]

    wh2_res = await client.post(
        "/api/v1/warehouses",
        headers=auth(owner_token),
        json={"name": "South Hub", "code": "WH-SH", "address": "200 South Way"},
    )
    assert wh2_res.status_code == 201
    wh2_id = wh2_res.json()["id"]

    # 2. Invite a warehouse manager scoped ONLY to wh1
    wm_email = _email("wh1-manager")
    wm = await join_company(
        client,
        owner_token,
        wm_email,
        "warehouse_manager",
        location_ids=[wh1_id],
    )
    wm_token = wm["access_token"]
    wm_membership_id = wm["membership"]["id"]

    # Also create a South Hub operator scoped to wh2
    sh_email = _email("sh-operator")
    sh_member = await join_company(
        client,
        owner_token,
        sh_email,
        "putaway_operator",
        location_ids=[wh2_id],
    )
    sh_membership_id = sh_member["membership"]["id"]

    # 3. Check role descriptions for QC and Returns Operator match actual implementation
    roles_res = await client.get("/api/v1/members/roles", headers=auth(owner_token))
    assert roles_res.status_code == 200
    roles = {r["slug"]: r for r in roles_res.json()}
    qc_desc = roles["quality_inspector"]["description"]
    returns_desc = roles["returns_operator"]["description"]
    assert "quarantine hold" not in qc_desc.lower()
    assert "rma" not in returns_desc.lower()
    assert "inspect inbound shipments" in qc_desc.lower()
    assert "receive returned shipments" in returns_desc.lower()

    # 4. Scoped warehouse manager CANNOT create an unscoped (org-wide) invitation
    unscoped_inv = await client.post(
        "/api/v1/members/invitations",
        headers=auth(wm_token),
        json={
            "email": _email("unscoped-invite"),
            "role": "order_picker",
            "warehouse_ids": [],
        },
    )
    assert unscoped_inv.status_code == 403
    assert unscoped_inv.json()["error"]["code"] == "delegation_scope_exceeded"

    # 5. Scoped warehouse manager CANNOT invite to a warehouse outside their scope (wh2)
    cross_wh_inv = await client.post(
        "/api/v1/members/invitations",
        headers=auth(wm_token),
        json={
            "email": _email("cross-wh-invite"),
            "role": "order_picker",
            "warehouse_ids": [wh2_id],
        },
    )
    assert cross_wh_inv.status_code == 403
    assert cross_wh_inv.json()["error"]["code"] == "delegation_scope_exceeded"

    # 6. Scoped warehouse manager CANNOT create custom roles (requires roles.manage and unscoped org auth)
    custom_role_res = await client.post(
        "/api/v1/members/roles",
        headers=auth(wm_token),
        json={
            "name": "Super Picker",
            "description": "Attempted privilege escalation",
            "permissions": ["inventory.read", "stock.pick"],
        },
    )
    assert custom_role_res.status_code in (401, 403)

    # 7. Scoped warehouse manager CANNOT create new company-level warehouse facilities
    create_wh_res = await client.post(
        "/api/v1/warehouses",
        headers=auth(wm_token),
        json={"name": "Rogue Hub", "code": "WH-ROGUE", "address": "300 Rogue St"},
    )
    assert create_wh_res.status_code == 403
    assert create_wh_res.json()["error"]["code"] == "organization_authorization_required"

    # 8. Scoped warehouse manager CANNOT modify a member in another warehouse (wh2)
    update_member_res = await client.patch(
        f"/api/v1/members/{sh_membership_id}",
        headers=auth(wm_token),
        json={"department": "Cross-management attempt"},
    )
    assert update_member_res.status_code == 403
    assert update_member_res.json()["error"]["code"] in ("forbidden", "delegation_scope_exceeded")

    # 9. Scoped warehouse manager calling list_members is scoped to wh1
    list_mem_res = await client.get("/api/v1/members", headers=auth(wm_token))
    assert list_mem_res.status_code == 200
    listed_ids = [m["id"] for m in list_mem_res.json()["members"]]
    assert wm_membership_id in listed_ids
    assert sh_membership_id not in listed_ids



