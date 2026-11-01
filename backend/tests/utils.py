import uuid
from typing import Any

from httpx import AsyncClient


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register_company(
    client: AsyncClient,
    label: str,
    email: str | None = None,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/auth/register-company",
        json={
            "company_name": f"{label} Company",
            "name": f"{label} Owner",
            "email": email or f"{label.lower()}-{uuid.uuid4().hex[:8]}@example.com",
            "password": "StrongPass123!",
            "currency": "USD",
            "timezone": "UTC",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def create_item(
    client: AsyncClient,
    token: str,
    sku: str = "SKU-001",
    name: str = "Steel Bolt",
    client_id: str | None = None,
    tracking_mode: str = "none",
    expiry_tracked: bool = False,
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": name,
        "base_uom": "EA",
        "item_type": "stocked_material",
        "tracking_mode": tracking_mode,
        "expiry_tracked": expiry_tracked,
    }
    if client_id:
        payload["client_id"] = client_id
    response = await client.post(
        "/api/v1/items",
        headers=auth(token),
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def create_warehouse(client: AsyncClient, token: str, name: str = "Main Warehouse") -> dict:
    response = await client.post(
        "/api/v1/warehouses",
        headers=auth(token),
        json={"name": name},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def default_location(client: AsyncClient, token: str, warehouse_id: str) -> dict:
    response = await client.get(
        "/api/v1/locations",
        headers=auth(token),
        params={"warehouse_id": warehouse_id},
    )
    assert response.status_code == 200, response.text
    locations = response.json()["locations"]
    return next(location for location in locations if location["code"] == "RECV")


async def invite_member(
    client: AsyncClient,
    token: str,
    email: str,
    role: str = "viewer",
    location_ids: list[str] | None = None,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/members/invitations",
        headers=auth(token),
        json={
            "email": email,
            "role": role,
            "location_ids": location_ids or [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def invite_members_bulk(
    client: AsyncClient,
    token: str,
    emails: list[str],
    role: str = "viewer",
    location_ids: list[str] | None = None,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/members/invitations/bulk",
        headers=auth(token),
        json={
            "emails": emails,
            "role": role,
            "location_ids": location_ids or [],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def accept_invitation(
    client: AsyncClient,
    invitation_token: str,
    email: str,
    name: str = "Invited Member",
    password: str = "MemberPass123!",
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "invitation_token": invitation_token,
            "email": email,
            "name": name,
            "password": password,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def join_company(
    client: AsyncClient,
    owner_token: str,
    email: str,
    role: str,
    location_ids: list[str] | None = None,
    name: str = "Invited Member",
    password: str = "MemberPass123!",
) -> dict[str, Any]:
    invitation = await invite_member(
        client,
        owner_token,
        email,
        role=role,
        location_ids=location_ids,
    )
    return await accept_invitation(
        client,
        invitation["invitation_token"],
        email,
        name=name,
        password=password,
    )
