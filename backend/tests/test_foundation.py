import uuid

from .utils import accept_invitation, auth, create_item, register_company


async def _enable_clients(client, token: str) -> None:
    response = await client.patch(
        "/api/v1/company",
        headers=auth(token),
        json={"inventory_model": "hybrid"},
    )
    assert response.status_code == 200, response.text


async def _create_client(client, token: str, code: str, name: str) -> dict:
    response = await client.post(
        "/api/v1/clients",
        headers=auth(token),
        json={"code": code, "name": name},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_registration_creates_internal_client_and_session_clients(client):
    registration = await register_company(client, "Foundation")

    session = await client.get(
        "/api/v1/auth/session",
        headers=auth(registration["access_token"]),
    )
    assert session.status_code == 200, session.text
    body = session.json()
    assert body["company"]["inventory_model"] == "internal"
    assert body["membership"]["client_ids"] == []
    assert len(body["clients"]) == 1
    internal = body["clients"][0]
    assert internal["code"] == "INTERNAL"
    assert internal["is_internal"] is True


async def test_items_are_unique_within_each_client(client):
    registration = await register_company(client, "ClientItems")
    token = registration["access_token"]
    await _enable_clients(client, token)
    external = await _create_client(client, token, "ACME", "Acme Corp")
    sku = f"SHARED-{uuid.uuid4().hex[:8].upper()}"

    internal_item = await create_item(client, token, sku=sku, name="Internal Item")
    external_item = await create_item(
        client,
        token,
        sku=sku,
        name="Client Item",
        client_id=external["id"],
    )
    assert internal_item["client_id"] != external_item["client_id"]

    internal_list = await client.get(
        "/api/v1/items",
        headers=auth(token),
        params={"client_id": internal_item["client_id"]},
    )
    assert [item["id"] for item in internal_list.json()["items"]] == [internal_item["id"]]

    ambiguous = await client.post(
        "/api/v1/items/lookup",
        headers=auth(token),
        json={"code": sku},
    )
    assert ambiguous.status_code == 422
    assert ambiguous.json()["error"]["code"] == "client_required"

    resolved = await client.post(
        "/api/v1/items/lookup",
        headers=auth(token),
        json={"code": sku, "client_id": external["id"]},
    )
    assert resolved.status_code == 200
    assert resolved.json()["id"] == external_item["id"]


async def test_cross_tenant_client_id_is_rejected(client):
    alpha = await register_company(client, "AlphaClient")
    beta = await register_company(client, "BetaClient")
    await _enable_clients(client, beta["access_token"])
    beta_client = await _create_client(client, beta["access_token"], "BETA", "Beta Corp")

    response = await client.post(
        "/api/v1/items",
        headers=auth(alpha["access_token"]),
        json={
            "client_id": beta_client["id"],
            "sku": "CROSS-TENANT",
            "name": "Invalid Item",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_client"


async def test_member_client_scope_filters_session_and_items(client):
    registration = await register_company(client, "ClientScope")
    token = registration["access_token"]
    await _enable_clients(client, token)
    internal = (
        await client.get("/api/v1/auth/session", headers=auth(token))
    ).json()["clients"][0]
    external = await _create_client(client, token, "SCOPED", "Scoped Client")
    await create_item(client, token, sku="INTERNAL-SCOPE", name="Internal Scope")
    external_item = await create_item(
        client,
        token,
        sku="EXTERNAL-SCOPE",
        name="External Scope",
        client_id=external["id"],
    )

    email = f"client-scope-{uuid.uuid4().hex[:8]}@example.com"
    member_invitation = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={
            "email": email,
            "role": "viewer",
            "client_ids": [external["id"]],
        },
    )
    assert member_invitation.status_code == 201, member_invitation.text
    accepted = await accept_invitation(
        client,
        member_invitation.json()["invitation_token"],
        email,
    )

    member_session = await client.get(
        "/api/v1/auth/session",
        headers=auth(accepted["access_token"]),
    )
    assert member_session.status_code == 200
    clients = member_session.json()["clients"]
    assert [entry["id"] for entry in clients] == [external["id"]]
    assert internal["id"] not in {entry["id"] for entry in clients}

    items = await client.get("/api/v1/items", headers=auth(accepted["access_token"]))
    assert [item["id"] for item in items.json()["items"]] == [external_item["id"]]


async def test_sync_push_is_idempotent_and_pull_is_ordered(client):
    registration = await register_company(client, "Sync")
    token = registration["access_token"]
    operation_id = f"op-{uuid.uuid4()}"
    payload = {
        "device_id": "test-device",
        "operations": [
            {
                "operation_id": operation_id,
                "type": "sync.heartbeat",
                "payload": {"app_version": "1.0.0"},
            }
        ],
    }

    pushed = await client.post("/api/v1/sync/push", headers=auth(token), json=payload)
    assert pushed.status_code == 200, pushed.text
    result = pushed.json()["results"][0]
    assert result["status"] == "applied"
    assert result["event_sequence"] == 1

    duplicate = await client.post("/api/v1/sync/push", headers=auth(token), json=payload)
    assert duplicate.status_code == 200
    duplicate_result = duplicate.json()["results"][0]
    assert duplicate_result["status"] == "duplicate"
    assert duplicate_result["event_sequence"] == 1

    unsupported = await client.post(
        "/api/v1/sync/push",
        headers=auth(token),
        json={
            "operations": [
                {
                    "operation_id": f"op-{uuid.uuid4()}",
                    "type": "receipt.create",
                    "payload": {},
                }
            ]
        },
    )
    assert unsupported.status_code == 200
    unsupported_result = unsupported.json()["results"][0]
    assert unsupported_result["status"] == "rejected"
    assert unsupported_result["error_code"] == "unsupported_sync_operation"

    pulled = await client.get("/api/v1/sync/pull", headers=auth(token))
    assert pulled.status_code == 200, pulled.text
    body = pulled.json()
    assert [event["sequence"] for event in body["events"]] == [1]
    assert body["next_cursor"] == 1
    assert body["latest_sequence"] == 1
    assert body["has_more"] is False
