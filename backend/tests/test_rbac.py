import uuid
from decimal import Decimal

from .utils import (
    accept_invitation,
    auth,
    create_item,
    create_warehouse,
    default_location,
    invite_member,
    invite_members_bulk,
    join_company,
    register_company,
)


def _email(label: str) -> str:
    return f"{label.lower()}-{uuid.uuid4().hex[:8]}@example.com"


def _receipt(warehouse: dict, location: dict, item: dict, qty: str = "2") -> dict:
    return {
        "warehouse_id": warehouse["id"],
        "location_id": location["id"],
        "lines": [{"item_id": item["id"], "qty": qty}],
    }


async def test_registration_cannot_request_a_privileged_role(client):
    email = _email("role-injection")
    rejected = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": "Role Injection",
            "name": "Injected Owner",
            "email": email,
            "password": "StrongPass123!",
            "role": "owner",
        },
    )
    assert rejected.status_code == 422
    accepted = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": "Role Injection",
            "name": "Injected Owner",
            "email": email,
            "password": "StrongPass123!",
        },
    )
    assert accepted.status_code == 201
    assert accepted.json()["membership"]["role"] == "owner"
    session = await client.get(
        "/api/v1/auth/session",
        headers=auth(accepted.json()["access_token"]),
    )
    assert session.status_code == 200
    assert "members.manage" in session.json()["permissions"]


async def test_role_permission_matrix_and_member_management(client):
    owner = await register_company(client, "RbacA")
    owner_token = owner["access_token"]

    viewer_email = _email("viewer")
    viewer = await join_company(client, owner_token, viewer_email, "viewer")
    viewer_token = viewer["access_token"]
    assert viewer["membership"]["role"] == "viewer"

    session = await client.get("/api/v1/auth/session", headers=auth(viewer_token))
    assert session.status_code == 200
    assert "inventory.read" in session.json()["permissions"]
    assert "inventory.write" not in session.json()["permissions"]

    assert (await client.get("/api/v1/items", headers=auth(viewer_token))).status_code == 200
    denied_item = await client.post(
        "/api/v1/items",
        headers=auth(viewer_token),
        json={"sku": "VIEW-1", "name": "Viewer item"},
    )
    assert denied_item.status_code == 403
    assert (await client.get("/api/v1/members", headers=auth(viewer_token))).status_code == 403
    denied_invite = await client.post(
        "/api/v1/members/invitations",
        headers=auth(viewer_token),
        json={"email": _email("denied"), "role": "viewer"},
    )
    assert denied_invite.status_code == 403

    members = await client.get("/api/v1/members", headers=auth(owner_token))
    assert members.status_code == 200
    assert len(members.json()["members"]) == 2

    promoted = await client.patch(
        f"/api/v1/members/{viewer['membership']['id']}",
        headers=auth(owner_token),
        json={"role": "inventory_operator"},
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["role"] == "inventory_operator"

    manager_email = _email("manager")
    manager = await join_company(client, owner_token, manager_email, "inventory_manager")
    manager_token = manager["access_token"]
    manager_item = await client.post(
        "/api/v1/items",
        headers=auth(manager_token),
        json={"sku": f"MGR-{uuid.uuid4().hex[:6]}", "name": "Manager item"},
    )
    assert manager_item.status_code == 201
    report = await client.get("/api/v1/reports/stock", headers=auth(manager_token))
    assert report.status_code == 200
    assert (await client.get("/api/v1/members", headers=auth(manager_token))).status_code == 200
    assert (
        await client.patch(
            "/api/v1/company",
            headers=auth(manager_token),
            json={"name": "Manager Rename"},
        )
    ).status_code == 403
    assert (
        await client.post(
            "/api/v1/members/invitations",
            headers=auth(manager_token),
            json={"email": _email("manager-invite"), "role": "viewer"},
        )
    ).status_code == 403

    admin = await join_company(client, owner_token, _email("admin"), "company_admin")
    admin_token = admin["access_token"]
    created_invite = await client.post(
        "/api/v1/members/invitations",
        headers=auth(admin_token),
        json={"email": _email("admin-invite"), "role": "viewer"},
    )
    assert created_invite.status_code == 201
    assert (
        await client.patch(
            "/api/v1/company",
            headers=auth(admin_token),
            json={"name": "Admin Renamed Company"},
        )
    ).status_code == 200

    item = await create_item(client, owner_token, sku=f"OPS-{uuid.uuid4().hex[:8]}")
    warehouse = await create_warehouse(client, owner_token, "Operator Warehouse")
    location = await default_location(client, owner_token, warehouse["id"])
    operator_receipt = await client.post(
        "/api/v1/receipts",
        headers={
            **auth(viewer_token),
            "Idempotency-Key": f"operator-{uuid.uuid4()}",
        },
        json=_receipt(warehouse, location, item),
    )
    assert operator_receipt.status_code == 201, operator_receipt.text
    assert (
        await client.post(
            "/api/v1/items",
            headers=auth(viewer_token),
            json={"sku": f"OPS-ITEM-{uuid.uuid4().hex[:6]}", "name": "Denied"},
        )
    ).status_code == 403


async def test_cost_visibility_and_location_scope(client):
    owner = await register_company(client, "Scoped")
    owner_token = owner["access_token"]
    item = await create_item(client, owner_token, sku=f"COST-{uuid.uuid4().hex[:8]}")
    updated = await client.patch(
        f"/api/v1/items/{item['id']}",
        headers=auth(owner_token),
        json={"cost": "12.50"},
    )
    assert updated.status_code == 200

    warehouse_one = await create_warehouse(client, owner_token, "Scope One")
    location_one = await default_location(client, owner_token, warehouse_one["id"])
    warehouse_two = await create_warehouse(client, owner_token, "Scope Two")
    location_two = await default_location(client, owner_token, warehouse_two["id"])

    viewer = await join_company(client, owner_token, _email("cost-viewer"), "viewer")
    viewer_item = await client.get(
        f"/api/v1/items/{item['id']}",
        headers=auth(viewer["access_token"]),
    )
    assert viewer_item.status_code == 200
    assert viewer_item.json()["cost"] is None

    manager = await join_company(client, owner_token, _email("cost-manager"), "inventory_manager")
    manager_item = await client.get(
        f"/api/v1/items/{item['id']}",
        headers=auth(manager["access_token"]),
    )
    assert manager_item.status_code == 200
    assert Decimal(manager_item.json()["cost"]) == Decimal("12.50")

    receipt = await client.post(
        "/api/v1/receipts",
        headers={**auth(owner_token), "Idempotency-Key": f"scope-{uuid.uuid4()}"},
        json=_receipt(warehouse_two, location_two, item, qty="5"),
    )
    assert receipt.status_code == 201
    assert (
        await client.post(
            f"/api/v1/receipts/{receipt.json()['id']}/commit",
            headers=auth(owner_token),
        )
    ).status_code == 200

    scoped = await join_company(
        client,
        owner_token,
        _email("scoped-operator"),
        "inventory_operator",
        location_ids=[location_one["id"]],
    )
    scoped_token = scoped["access_token"]
    scoped_locations = await client.get("/api/v1/locations", headers=auth(scoped_token))
    assert [location["id"] for location in scoped_locations.json()["locations"]] == [
        location_one["id"]
    ]
    scoped_warehouses = await client.get("/api/v1/warehouses", headers=auth(scoped_token))
    assert [warehouse["id"] for warehouse in scoped_warehouses.json()["warehouses"]] == [
        warehouse_one["id"]
    ]

    visible_balances = await client.get("/api/v1/balances", headers=auth(scoped_token))
    assert visible_balances.status_code == 200
    assert visible_balances.json()["balances"] == []
    availability = await client.get(
        f"/api/v1/items/{item['id']}/availability",
        headers=auth(scoped_token),
    )
    assert availability.status_code == 200
    assert Decimal(availability.json()["available"]) == Decimal("0")

    outside_receipt = await client.post(
        "/api/v1/receipts",
        headers={**auth(scoped_token), "Idempotency-Key": f"outside-{uuid.uuid4()}"},
        json=_receipt(warehouse_two, location_two, item),
    )
    assert outside_receipt.status_code == 403
    assert outside_receipt.json()["error"]["code"] == "location_forbidden"

    inside_receipt = await client.post(
        "/api/v1/receipts",
        headers={**auth(scoped_token), "Idempotency-Key": f"inside-{uuid.uuid4()}"},
        json=_receipt(warehouse_one, location_one, item),
    )
    assert inside_receipt.status_code == 201, inside_receipt.text

    scoped_supervisor = await join_company(
        client,
        owner_token,
        _email("scoped-supervisor"),
        "warehouse_supervisor",
        location_ids=[location_one["id"]],
    )
    supervisor_token = scoped_supervisor["access_token"]
    allowed_update = await client.patch(
        f"/api/v1/warehouses/{warehouse_one['id']}",
        headers=auth(supervisor_token),
        json={"name": "Scope One Updated"},
    )
    assert allowed_update.status_code == 200
    hidden_update = await client.patch(
        f"/api/v1/warehouses/{warehouse_two['id']}",
        headers=auth(supervisor_token),
        json={"name": "Scope Two Updated"},
    )
    assert hidden_update.status_code == 404
    hidden_location = await client.post(
        "/api/v1/locations",
        headers=auth(supervisor_token),
        json={
            "warehouse_id": warehouse_two["id"],
            "code": "HIDDEN",
            "type": "main",
        },
    )
    assert hidden_location.status_code == 404


async def test_invitation_security_self_promotion_and_owner_protection(client):
    owner = await register_company(client, "OwnerGuard")
    owner_token = owner["access_token"]
    admin = await join_company(client, owner_token, _email("guard-admin"), "company_admin")
    admin_token = admin["access_token"]

    self_promotion = await client.patch(
        f"/api/v1/members/{admin['membership']['id']}",
        headers=auth(admin_token),
        json={"role": "owner"},
    )
    assert self_promotion.status_code == 403
    assert self_promotion.json()["error"]["code"] == "owner_role_required"

    demote_owner = await client.patch(
        f"/api/v1/members/{owner['membership']['id']}",
        headers=auth(admin_token),
        json={"role": "viewer"},
    )
    assert demote_owner.status_code == 403

    invite_owner = await client.post(
        "/api/v1/members/invitations",
        headers=auth(admin_token),
        json={"email": _email("second-owner-denied"), "role": "owner"},
    )
    assert invite_owner.status_code == 403

    last_owner_demotion = await client.patch(
        f"/api/v1/members/{owner['membership']['id']}",
        headers=auth(owner_token),
        json={"role": "viewer"},
    )
    assert last_owner_demotion.status_code == 409
    assert last_owner_demotion.json()["error"]["code"] == "last_owner_required"

    last_owner_deactivation = await client.patch(
        f"/api/v1/members/{owner['membership']['id']}",
        headers=auth(owner_token),
        json={"status": "inactive"},
    )
    assert last_owner_deactivation.status_code == 409

    second_owner = await join_company(
        client,
        owner_token,
        _email("second-owner"),
        "owner",
    )
    assert second_owner["membership"]["role"] == "owner"
    admin_deactivate = await client.patch(
        f"/api/v1/members/{second_owner['membership']['id']}",
        headers=auth(admin_token),
        json={"status": "inactive"},
    )
    assert admin_deactivate.status_code == 403
    assert admin_deactivate.json()["error"]["code"] == "owner_role_required"
    admin_scope = await client.patch(
        f"/api/v1/members/{owner['membership']['id']}",
        headers=auth(admin_token),
        json={"location_ids": []},
    )
    assert admin_scope.status_code == 403
    demoted = await client.patch(
        f"/api/v1/members/{owner['membership']['id']}",
        headers=auth(owner_token),
        json={"role": "viewer"},
    )
    assert demoted.status_code == 200
    assert demoted.json()["role"] == "viewer"
    owner_session = await client.get("/api/v1/auth/session", headers=auth(owner_token))
    assert owner_session.json()["membership"]["role"] == "viewer"


async def test_invitation_listing_and_revocation_do_not_expose_tokens(client):
    owner = await register_company(client, "InviteLifecycle")
    owner_token = owner["access_token"]
    invitee_email = _email("listed")
    created = await invite_member(client, owner_token, invitee_email, "inventory_operator")

    listing = await client.get("/api/v1/members/invitations", headers=auth(owner_token))
    assert listing.status_code == 200
    listed = next(item for item in listing.json()["invitations"] if item["id"] == created["id"])
    assert listed["status"] == "pending"
    assert listed["email"] == invitee_email
    assert "invitation_token" not in listed
    assert "token_hash" not in listed
    assert created["invitation_token"] not in listing.text

    viewer = await join_company(client, owner_token, _email("list-viewer"), "viewer")
    denied = await client.get(
        "/api/v1/members/invitations",
        headers=auth(viewer["access_token"]),
    )
    assert denied.status_code == 403

    revoked = await client.delete(
        f"/api/v1/members/invitations/{created['id']}",
        headers=auth(owner_token),
    )
    assert revoked.status_code == 204

    after = await client.get("/api/v1/members/invitations", headers=auth(owner_token))
    assert after.status_code == 200
    revoked_item = next(item for item in after.json()["invitations"] if item["id"] == created["id"])
    assert revoked_item["status"] == "revoked"
    assert created["invitation_token"] not in after.text

    accepted = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": created["invitation_token"],
            "email": invitee_email,
            "name": "Revoked Invitee",
            "password": "MemberPass123!",
        },
    )
    assert accepted.status_code == 404
    assert accepted.json()["error"]["code"] == "invalid_invitation"

    events = await client.get("/api/v1/audit-events", headers=auth(owner_token))
    assert events.status_code == 200
    assert "invitation.revoked" in {event["action"] for event in events.json()["events"]}
    assert created["invitation_token"] not in events.text


async def test_role_changes_and_deactivation_take_effect_immediately(client):
    owner = await register_company(client, "SessionGuard")
    owner_token = owner["access_token"]
    operator = await join_company(
        client,
        owner_token,
        _email("session-operator"),
        "inventory_operator",
    )
    operator_token = operator["access_token"]
    operator_refresh = operator["refresh_token"]

    changed = await client.patch(
        f"/api/v1/members/{operator['membership']['id']}",
        headers=auth(owner_token),
        json={"role": "viewer"},
    )
    assert changed.status_code == 200
    session = await client.get("/api/v1/auth/session", headers=auth(operator_token))
    assert session.status_code == 200
    assert session.json()["membership"]["role"] == "viewer"
    assert "stock.receive" not in session.json()["permissions"]

    deactivated = await client.patch(
        f"/api/v1/members/{operator['membership']['id']}",
        headers=auth(owner_token),
        json={"status": "inactive"},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "inactive"

    denied = await client.get("/api/v1/items", headers=auth(operator_token))
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "membership_inactive"
    refresh_denied = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": operator_refresh},
    )
    assert refresh_denied.status_code == 401
    login_denied = await client.post(
        "/api/v1/auth/login",
        json={
            "email": operator["user"]["email"],
            "password": "MemberPass123!",
            "company_id": operator["company"]["id"],
        },
    )
    assert login_denied.status_code == 401

    reactivated = await client.patch(
        f"/api/v1/members/{operator['membership']['id']}",
        headers=auth(owner_token),
        json={"status": "active"},
    )
    assert reactivated.status_code == 200
    login_allowed = await client.post(
        "/api/v1/auth/login",
        json={
            "email": operator["user"]["email"],
            "password": "MemberPass123!",
            "company_id": operator["company"]["id"],
        },
    )
    assert login_allowed.status_code == 200
    assert login_allowed.json()["membership"]["role"] == "viewer"


async def test_cross_tenant_members_invitations_and_scopes_are_isolated(client):
    alpha = await register_company(client, "TenantAlpha")
    beta = await register_company(client, "TenantBeta")
    alpha_token = alpha["access_token"]
    beta_token = beta["access_token"]

    invitation = await invite_member(client, alpha_token, _email("alpha-invite"), "viewer")
    wrong_email = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": invitation["invitation_token"],
            "email": beta["user"]["email"],
            "name": "Beta User",
            "password": "StrongPass123!",
        },
    )
    assert wrong_email.status_code == 403
    assert wrong_email.json()["error"]["code"] == "invitation_email_mismatch"

    cross_member = await client.patch(
        f"/api/v1/members/{alpha['membership']['id']}",
        headers=auth(beta_token),
        json={"role": "viewer"},
    )
    assert cross_member.status_code == 404
    cross_invitation = await client.delete(
        f"/api/v1/members/invitations/{invitation['id']}",
        headers=auth(beta_token),
    )
    assert cross_invitation.status_code == 404

    beta_warehouse = await create_warehouse(client, beta_token, "Beta Scope")
    beta_location = await default_location(client, beta_token, beta_warehouse["id"])
    foreign_scope = await client.post(
        "/api/v1/members/invitations",
        headers=auth(alpha_token),
        json={
            "email": _email("foreign-scope"),
            "role": "inventory_operator",
            "location_ids": [beta_location["id"]],
        },
    )
    assert foreign_scope.status_code == 422
    assert foreign_scope.json()["error"]["code"] == "invalid_location_scope"


async def test_audit_history_and_existing_user_invitation_acceptance(client):
    alpha = await register_company(client, "AuditAlpha")
    alpha_token = alpha["access_token"]
    invitation = await invite_member(client, alpha_token, _email("audit-admin"), "company_admin")
    invitee = await accept_invitation(
        client,
        invitation["invitation_token"],
        invitation["email"],
        name="Audit Admin",
    )
    changed = await client.patch(
        f"/api/v1/members/{invitee['membership']['id']}",
        headers=auth(alpha_token),
        json={"role": "viewer"},
    )
    assert changed.status_code == 200

    events = await client.get("/api/v1/audit-events", headers=auth(alpha_token))
    assert events.status_code == 200
    actions = {event["action"] for event in events.json()["events"]}
    assert {
        "company.registered",
        "membership.role_assigned",
        "invitation.created",
        "invitation.accepted",
        "membership.role_changed",
    } <= actions
    assert invitation["invitation_token"] not in str(events.json())

    viewer_audit = await client.get(
        "/api/v1/audit-events",
        headers=auth(invitee["access_token"]),
    )
    assert viewer_audit.status_code == 403

    beta = await register_company(client, "AuditBeta")
    beta_invitation = await invite_member(
        client,
        beta["access_token"],
        alpha["user"]["email"],
        "viewer",
    )
    existing_user_join = await accept_invitation(
        client,
        beta_invitation["invitation_token"],
        alpha["user"]["email"],
        name="Ignored Existing Name",
        password="StrongPass123!",
    )
    assert existing_user_join["membership"]["role"] == "viewer"
    assert existing_user_join["company"]["id"] == beta["company"]["id"]

    reused = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": beta_invitation["invitation_token"],
            "email": alpha["user"]["email"],
            "name": "Ignored Existing Name",
            "password": "StrongPass123!",
        },
    )
    assert reused.status_code == 404
    assert reused.json()["error"]["code"] == "invalid_invitation"

    ambiguous_login = await client.post(
        "/api/v1/auth/login",
        json={"email": alpha["user"]["email"], "password": "StrongPass123!"},
    )
    assert ambiguous_login.status_code == 400
    assert ambiguous_login.json()["error"]["code"] == "company_selection_required"


async def test_bulk_invitations_validate_dedupe_and_report_per_recipient(client):
    owner = await register_company(client, "BulkInvite")
    owner_token = owner["access_token"]
    first = _email("bulk-first")
    second = _email("bulk-second")
    existing = await join_company(client, owner_token, _email("bulk-existing"), "viewer")
    existing_email = existing["user"]["email"]

    response = await client.post(
        "/api/v1/members/invitations/bulk",
        headers=auth(owner_token),
        json={
            "emails": [first.upper(), second, first, existing_email],
            "role": "inventory_operator",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_count"] == 3
    assert body["created_count"] == 2
    assert body["skipped_count"] == 1
    by_email = {item["email"]: item for item in body["results"]}
    assert by_email[first]["status"] == "created"
    assert by_email[second]["status"] == "created"
    assert by_email[existing_email]["status"] == "already_member"
    assert by_email[existing_email]["invitation"] is None
    tokens = [
        by_email[first]["invitation"]["invitation_token"],
        by_email[second]["invitation"]["invitation_token"],
    ]
    assert len(set(tokens)) == 2

    repeat = await client.post(
        "/api/v1/members/invitations/bulk",
        headers=auth(owner_token),
        json={"emails": [first, second], "role": "viewer"},
    )
    assert repeat.status_code == 200
    repeat_body = repeat.json()
    assert repeat_body["created_count"] == 0
    assert repeat_body["skipped_count"] == 2
    assert {item["status"] for item in repeat_body["results"]} == {"pending_invitation"}
    assert repeat_body["results"][0]["invitation"] is None

    listing = await client.get("/api/v1/members/invitations", headers=auth(owner_token))
    assert listing.status_code == 200
    assert all(token not in listing.text for token in tokens)
    events = await client.get("/api/v1/audit-events", headers=auth(owner_token))
    assert events.status_code == 200
    assert all(token not in events.text for token in tokens)
    actions = {event["action"] for event in events.json()["events"]}
    assert "invitation.bulk_created" in actions


async def test_bulk_invitations_enforce_role_scope_and_permissions(client):
    owner = await register_company(client, "BulkGuards")
    owner_token = owner["access_token"]
    admin = await join_company(client, owner_token, _email("bulk-admin"), "company_admin")
    viewer = await join_company(client, owner_token, _email("bulk-viewer"), "viewer")

    denied_viewer = await client.post(
        "/api/v1/members/invitations/bulk",
        headers=auth(viewer["access_token"]),
        json={"emails": [_email("bulk-denied")]},
    )
    assert denied_viewer.status_code == 403

    denied_owner = await client.post(
        "/api/v1/members/invitations/bulk",
        headers=auth(admin["access_token"]),
        json={"emails": [_email("bulk-owner")], "role": "owner"},
    )
    assert denied_owner.status_code == 403
    assert denied_owner.json()["error"]["code"] == "owner_role_required"

    beta = await register_company(client, "BulkBeta")
    warehouse = await create_warehouse(client, beta["access_token"], "Foreign Bulk")
    location = await default_location(client, beta["access_token"], warehouse["id"])
    foreign_scope = await client.post(
        "/api/v1/members/invitations/bulk",
        headers=auth(owner_token),
        json={
            "emails": [_email("bulk-foreign")],
            "role": "viewer",
            "location_ids": [location["id"]],
        },
    )
    assert foreign_scope.status_code == 422
    assert foreign_scope.json()["error"]["code"] == "invalid_location_scope"


async def test_bulk_invitations_can_be_reissued_after_revoke_and_acceptance(client):
    owner = await register_company(client, "BulkReissue")
    owner_token = owner["access_token"]
    email = _email("bulk-reissue")

    first = await invite_members_bulk(client, owner_token, [email], "viewer")
    token = first["results"][0]["invitation"]["invitation_token"]
    invitation_id = first["results"][0]["invitation"]["id"]
    revoked = await client.delete(
        f"/api/v1/members/invitations/{invitation_id}",
        headers=auth(owner_token),
    )
    assert revoked.status_code == 204

    second = await invite_members_bulk(client, owner_token, [email], "viewer")
    second_invitation = second["results"][0]["invitation"]
    assert second["created_count"] == 1
    assert second_invitation["invitation_token"] != token

    joined = await accept_invitation(client, second_invitation["invitation_token"], email)
    assert joined["membership"]["role"] == "viewer"

    third = await invite_members_bulk(client, owner_token, [email], "viewer")
    assert third["created_count"] == 0
    assert third["results"][0]["status"] == "already_member"
