import uuid

from .utils import auth, register_company


async def test_health(client):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["X-Request-ID"]

    # Root-level probes must not 404 (Docker/load balancers/tunnels use these).
    root = await client.get("/health")
    assert root.status_code == 200
    assert root.json()["status"] == "ok"
    assert (await client.head("/health")).status_code == 200

    ready = await client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"

    # The root aliases stay out of the public OpenAPI schema.
    schema = await client.get("/api/v1/openapi.json")
    assert schema.status_code == 200
    assert "/health" not in schema.json()["paths"]


async def test_register_login_session_refresh_and_logout(client):
    registration = await register_company(client, "Alpha")
    assert registration["membership"]["role"] == "owner"
    assert registration["company"]["name"] == "Alpha Company"
    assert registration["user"]["email"].startswith("alpha-")

    response = await client.get(
        "/api/v1/auth/session",
        headers=auth(registration["access_token"]),
    )
    assert response.status_code == 200
    session = response.json()
    assert session["company"]["id"] == registration["company"]["id"]
    assert session["membership"]["role"] == "owner"
    assert "company.manage" in session["permissions"]
    assert "members.manage" in session["permissions"]
    assert "stock.receive" in session["permissions"]

    refreshed = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": registration["refresh_token"]},
    )
    assert refreshed.status_code == 200, refreshed.text
    new_tokens = refreshed.json()
    assert new_tokens["refresh_token"] != registration["refresh_token"]

    reused = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": registration["refresh_token"]},
    )
    assert reused.status_code == 401
    assert reused.json()["error"]["code"] == "invalid_refresh_token"

    logout = await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": new_tokens["refresh_token"]},
    )
    assert logout.status_code == 204

    after_logout = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": new_tokens["refresh_token"]},
    )
    assert after_logout.status_code == 401


async def test_login_with_wrong_password(client):
    registration = await register_company(client, "Beta")
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": registration["user"]["email"], "password": "WrongPass123!"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"

    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": registration["user"]["email"],
            "password": "StrongPass123!",
            "company_id": registration["company"]["id"],
        },
    )
    assert login.status_code == 200
    assert login.json()["company"]["id"] == registration["company"]["id"]


async def test_cross_tenant_access_is_blocked(client):
    alpha = await register_company(client, "TenantA")
    beta = await register_company(client, "TenantB")

    alpha_item = await client.post(
        "/api/v1/items",
        headers=auth(alpha["access_token"]),
        json={"sku": "SHARED-SKU", "name": "Alpha only"},
    )
    assert alpha_item.status_code == 201
    item_id = alpha_item.json()["id"]

    beta_list = await client.get("/api/v1/items", headers=auth(beta["access_token"]))
    assert beta_list.status_code == 200
    assert beta_list.json()["items"] == []

    beta_read = await client.get(
        f"/api/v1/items/{item_id}",
        headers=auth(beta["access_token"]),
    )
    assert beta_read.status_code == 404

    beta_patch = await client.patch(
        f"/api/v1/items/{item_id}",
        headers=auth(beta["access_token"]),
        json={"name": "Hijacked"},
    )
    assert beta_patch.status_code == 404

    beta_duplicate_sku = await client.post(
        "/api/v1/items",
        headers=auth(beta["access_token"]),
        json={"sku": "SHARED-SKU", "name": "Beta own item"},
    )
    assert beta_duplicate_sku.status_code == 201

    alpha_duplicate_sku = await client.post(
        "/api/v1/items",
        headers=auth(alpha["access_token"]),
        json={"sku": "SHARED-SKU", "name": "Alpha duplicate"},
    )
    assert alpha_duplicate_sku.status_code == 409
    assert alpha_duplicate_sku.json()["error"]["field_errors"]["sku"]


async def test_access_token_tampering_is_rejected(client):
    registration = await register_company(client, "Gamma")
    token = registration["access_token"]
    response = await client.get(
        "/api/v1/items",
        headers=auth(token[:-2] + ("aa" if not token.endswith("aa") else "bb")),
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


async def test_duplicate_email_registration_is_rejected(client):
    email = f"unique-{uuid.uuid4().hex[:8]}@example.com"
    first = await register_company(client, "Delta", email=email)
    assert first["user"]["email"] == email
    second = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": "Other Company",
            "name": "Other Owner",
            "email": email,
            "password": "StrongPass123!",
        },
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "email_already_registered"


async def test_unknown_route_uses_error_envelope(client):
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["request_id"]


async def test_login_rate_limit_blocks_repeated_failures(client):
    registration = await register_company(client, "RateLimited")

    for _ in range(5):
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": registration["user"]["email"],
                "password": "WrongPass123!",
            },
        )
        assert response.status_code == 401

    blocked = await client.post(
        "/api/v1/auth/login",
        json={
            "email": registration["user"]["email"],
            "password": "WrongPass123!",
        },
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert blocked.json()["error"]["retryable"] is True


async def test_refresh_token_cannot_be_used_as_access_token(client):
    registration = await register_company(client, "TokenType")
    response = await client.get(
        "/api/v1/items",
        headers=auth(registration["refresh_token"]),
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


async def test_weak_password_rejected_on_registration(client):
    response = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": "WeakCo",
            "name": "Weak User",
            "email": "weak-pass@example.com",
            "password": "lowercaseonly1",  # No uppercase
            "currency": "USD",
            "timezone": "UTC",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weak_password"


async def test_forgot_password_and_reset_flow(client):
    registration = await register_company(client, "Reset")
    user_email = registration["user"]["email"]

    # 1. Request forgot password code
    forgot = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user_email},
    )
    assert forgot.status_code == 200
    forgot_data = forgot.json()
    assert "code has been sent" in forgot_data["message"]
    code = forgot_data.get("dev_code")
    assert code is not None
    assert len(code) == 6

    # 2. Reset with wrong code fails
    wrong_reset = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": user_email,
            "code": "000000" if code != "000000" else "111111",
            "new_password": "NewStrongPass456!",
        },
    )
    assert wrong_reset.status_code == 400
    assert wrong_reset.json()["error"]["code"] == "invalid_reset_code"

    # 3. Reset with weak new password fails
    weak_reset = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": user_email,
            "code": code,
            "new_password": "alllowercase1",
        },
    )
    assert weak_reset.status_code == 422
    assert weak_reset.json()["error"]["code"] == "weak_password"

    # 4. Reset with valid code & strong password succeeds
    good_reset = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": user_email,
            "code": code,
            "new_password": "NewStrongPass456!",
        },
    )
    assert good_reset.status_code == 200
    assert "successfully reset" in good_reset.json()["message"]

    # 5. Old password no longer works
    old_login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": user_email,
            "password": "StrongPass123!",
            "company_id": registration["company"]["id"],
        },
    )
    assert old_login.status_code == 401

    # 6. New password works
    new_login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": user_email,
            "password": "NewStrongPass456!",
            "company_id": registration["company"]["id"],
        },
    )
    assert new_login.status_code == 200
    assert new_login.json()["user"]["email"] == user_email


async def test_check_user_and_forgot_password_nonexistent_email(client):
    # Check user endpoint
    check_none = await client.post(
        "/api/v1/auth/check-user",
        json={"email": "nobody-exists@example.com"},
    )
    assert check_none.status_code == 200
    assert check_none.json()["exists"] is False
    assert check_none.json()["is_active"] is False

    # Forgot password should reject nonexistent email with 404
    response = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "nobody-exists@example.com"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "user_not_found"


async def test_register_company_with_warehouse_categories(client):
    from app.main import app

    db = app.state.db

    # 1. All-in-One category
    tag_aio = uuid.uuid4().hex[:6]
    aio_res = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": f"AIO Co {tag_aio}",
            "name": "AIO Admin",
            "email": f"aio-{tag_aio}@example.com",
            "password": "Password123!",
            "warehouse_name": "Dallas Unified Hub",
            "warehouse_address": "1200 Logistics Blvd, Dallas, TX",
            "warehouse_category": "all_in_one",
            "location_code": "FLOOR-1",
        },
    )
    assert aio_res.status_code == 201, aio_res.text
    aio_data = aio_res.json()
    aio_company_id = aio_data["company"]["id"]

    # Verify warehouse and location created in DB
    locations_cursor = db.locations.find({"company_id": aio_company_id})
    aio_locations = await locations_cursor.to_list(length=10)
    assert len(aio_locations) == 1
    assert aio_locations[0]["code"] == "FLOOR-1"
    assert aio_locations[0]["type"] == "main"
    assert aio_locations[0]["path"] == "FLOOR-1"

    warehouse = await db.warehouses.find_one({"company_id": aio_company_id})
    assert warehouse["name"] == "Dallas Unified Hub"
    assert warehouse["address"] == "1200 Logistics Blvd, Dallas, TX"
    assert warehouse["warehouse_layout"] == "all_in_one"

    # 2. Multi-Zone Distribution Centre with Receiving, Storage, Picking & Dispatch
    tag_multi = uuid.uuid4().hex[:6]
    multi_res = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": f"Chennai Hub Co {tag_multi}",
            "name": "Chennai Admin",
            "email": f"chennai-{tag_multi}@example.com",
            "password": "Password123!",
            "warehouse_name": "Chennai Distribution Centre",
            "warehouse_address": "Plot 45, SIPCOT Industrial Park, Chennai",
            "warehouse_type": "distribution",
            "warehouse_layout": "multi_zone",
        },
    )
    assert multi_res.status_code == 201
    multi_company_id = multi_res.json()["company"]["id"]
    multi_locations = await db.locations.find({"company_id": multi_company_id}).to_list(length=10)
    assert len(multi_locations) == 4
    multi_codes = {loc["code"] for loc in multi_locations}
    assert multi_codes == {"RECV", "MAIN", "BIN-01", "DISP"}

    multi_wh = await db.warehouses.find_one({"company_id": multi_company_id})
    assert multi_wh["warehouse_type"] == "distribution"
    assert multi_wh["warehouse_layout"] == "multi_zone"

    # 3. Bulk Storage Warehouse
    tag_bulk = uuid.uuid4().hex[:6]
    bulk_res = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": f"Bulk Depot {tag_bulk}",
            "name": "Bulk Admin",
            "email": f"bulk-{tag_bulk}@example.com",
            "password": "Password123!",
            "warehouse_name": "Bulk Steel Yard",
            "warehouse_type": "bulk",
            "warehouse_layout": "bulk_storage",
        },
    )
    assert bulk_res.status_code == 201
    bulk_company_id = bulk_res.json()["company"]["id"]
    bulk_locations = await db.locations.find({"company_id": bulk_company_id}).to_list(length=10)
    assert len(bulk_locations) == 3
    bulk_codes = {loc["code"] for loc in bulk_locations}
    assert bulk_codes == {"RECV", "MAIN", "DISP"}


async def test_register_company_with_phone_and_warehouse_code(client):
    from app.main import app
    db = app.state.db
    tag = uuid.uuid4().hex[:6]
    res = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": f"Global Cargo {tag}",
            "name": "Cargo Admin",
            "email": f"cargo-{tag}@example.com",
            "phone": "+91 98765 43210",
            "password": "Password123!",
            "warehouse_name": "Chennai Port Facility",
            "warehouse_code": "CHN-01",
            "warehouse_address": "Gate 4, Chennai Port, TN",
            "warehouse_type": "distribution",
            "warehouse_layout": "multi_zone",
        },
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["user"]["phone"] == "+91 98765 43210"

    company_id = data["company"]["id"]
    wh = await db.warehouses.find_one({"company_id": company_id})
    assert wh is not None
    assert wh["code"] == "CHN-01"
    assert wh["name"] == "Chennai Port Facility"
    assert wh["address"] == "Gate 4, Chennai Port, TN"


async def test_change_password(client):
    reg = await register_company(client, "PwdTest")
    token = reg["access_token"]
    user_email = reg["user"]["email"]

    # Wrong current password
    fail_res = await client.post(
        "/api/v1/auth/change-password",
        headers=auth(token),
        json={"current_password": "WrongPassword123!", "new_password": "NewSecret456!"},
    )
    assert fail_res.status_code == 400
    assert fail_res.json()["error"]["code"] == "invalid_current_password"

    # Same password
    same_res = await client.post(
        "/api/v1/auth/change-password",
        headers=auth(token),
        json={"current_password": "StrongPass123!", "new_password": "StrongPass123!"},
    )
    assert same_res.status_code == 400
    assert same_res.json()["error"]["code"] == "password_unchanged"

    # Successful change
    ok_res = await client.post(
        "/api/v1/auth/change-password",
        headers=auth(token),
        json={"current_password": "StrongPass123!", "new_password": "NewSecret456!"},
    )
    assert ok_res.status_code == 200
    assert "successfully" in ok_res.json()["message"]

    # Verify login with new password works
    login_res = await client.post(
        "/api/v1/auth/login",
        json={"email": user_email, "password": "NewSecret456!"},
    )
    assert login_res.status_code == 200


async def test_update_me(client):
    reg = await register_company(client, "ProfileTest")
    token = reg["access_token"]

    # Update profile name and phone
    patch_res = await client.patch(
        "/api/v1/auth/me",
        headers=auth(token),
        json={"name": "Updated Profile Name", "phone": "+1 555 123 4567"},
    )
    assert patch_res.status_code == 200, patch_res.text
    user_data = patch_res.json()
    assert user_data["name"] == "Updated Profile Name"
    assert user_data["phone"] == "+1 555 123 4567"

    # Verify session reflects updated name
    session_res = await client.get("/api/v1/auth/session", headers=auth(token))
    assert session_res.status_code == 200
    assert session_res.json()["user"]["name"] == "Updated Profile Name"


