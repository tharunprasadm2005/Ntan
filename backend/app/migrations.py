from typing import Any

from pymongo.errors import DuplicateKeyError

from .config import get_settings
from .security import hash_password
from .services.clients import ensure_internal_client
from .services.putaway import PUTAWAY_SOURCE_TYPES, create_putaway_tasks
from .utils import new_id, utcnow


async def _ensure_default_bin(database: Any, company_id: str, warehouse: dict[str, Any]) -> None:
    main = await database.locations.find_one(
        {
            "company_id": company_id,
            "warehouse_id": warehouse["_id"],
            "parent_id": None,
            "type": "main",
        }
    )
    if main is None:
        return
    existing = await database.locations.find_one(
        {
            "company_id": company_id,
            "warehouse_id": warehouse["_id"],
            "parent_id": main["_id"],
            "code": "BIN-01",
        }
    )
    if existing is not None:
        updates = {}
        if not existing.get("path"):
            updates["path"] = f"{main.get('path') or 'MAIN'}/BIN-01"
        if existing.get("is_pickable") is None:
            updates["is_pickable"] = True
        if updates:
            updates["updated_at"] = utcnow()
            await database.locations.update_one({"_id": existing["_id"]}, {"$set": updates})
        return
    now = utcnow()
    try:
        await database.locations.insert_one(
            {
                "_id": new_id(),
                "company_id": company_id,
                "warehouse_id": warehouse["_id"],
                "parent_id": main["_id"],
                "code": "BIN-01",
                "path": f"{main.get('path') or 'MAIN'}/BIN-01",
                "barcode": None,
                "type": "bin",
                "is_pickable": True,
                "status": "active",
                "created_at": now,
                "updated_at": now,
            }
        )
    except DuplicateKeyError:
        return


async def backfill_foundation(database: Any) -> None:
    companies = await database.companies.find({}).to_list(length=10000)
    for company in companies:
        company_id = company["_id"]
        if not company.get("inventory_model"):
            await database.companies.update_one(
                {"_id": company_id},
                {"$set": {"inventory_model": "internal", "updated_at": utcnow()}},
            )
        internal_client = await ensure_internal_client(database, company_id)
        client_id = internal_client["_id"]

        for collection in ("items", "receipts", "balances", "movements"):
            await database[collection].update_many(
                {"company_id": company_id, "client_id": None},
                {"$set": {"client_id": client_id}},
            )

        await database.memberships.update_many(
            {"company_id": company_id, "client_ids": {"$exists": False}},
            {"$set": {"client_ids": []}},
        )
        await database.invitations.update_many(
            {"company_id": company_id, "client_ids": {"$exists": False}},
            {"$set": {"client_ids": []}},
        )

        locations = await database.locations.find(
            {
                "company_id": company_id,
                "$or": [
                    {"path": None},
                    {"path": {"$exists": False}},
                    {"is_pickable": {"$exists": False}},
                ],
            }
        ).to_list(length=10000)
        location_map = {
            location["_id"]: location
            for location in await database.locations.find(
                {"company_id": company_id}
            ).to_list(length=10000)
        }
        for location in locations:
            parent = location_map.get(location.get("parent_id"))
            parent_path = (
                (parent.get("path") or parent.get("code")) if parent is not None else None
            )
            updates = {
                "path": (
                    location.get("path")
                    or (
                        f"{parent_path}/{location['code']}"
                        if parent_path
                        else location["code"]
                    )
                ),
                "is_pickable": location.get(
                    "is_pickable",
                    location.get("type") in {"bin", "main", "line_side"},
                ),
                "updated_at": utcnow(),
            }
            await database.locations.update_one({"_id": location["_id"]}, {"$set": updates})

        warehouses = await database.warehouses.find(
            {"company_id": company_id}
        ).to_list(length=5000)
        for warehouse in warehouses:
            await _ensure_default_bin(database, company_id, warehouse)

        receipts = await database.receipts.find(
            {
                "company_id": company_id,
                "putaway_required": {"$exists": False},
            }
        ).to_list(length=10000)
        for receipt in receipts:
            location = await database.locations.find_one(
                {
                    "_id": receipt["location_id"],
                    "company_id": company_id,
                }
            )
            putaway_required = (
                location is not None
                and location.get("type") in PUTAWAY_SOURCE_TYPES
            )
            await database.receipts.update_one(
                {"_id": receipt["_id"], "company_id": company_id},
                {
                    "$set": {
                        "putaway_required": putaway_required,
                        "putaway_completed_at": receipt.get("putaway_completed_at"),
                    }
                },
            )
            if receipt.get("status") == "applied" and putaway_required and location:
                await create_putaway_tasks(database, receipt, location)

    await ensure_default_seed(database)


async def ensure_default_seed(database: Any) -> None:
    settings = get_settings()
    if settings.app_env == "test":
        return

    admin_email = "services@ntan.in"
    user = await database.users.find_one({"email": admin_email})
    now = utcnow()

    if user is None:
        user_id = new_id()
        user = {
            "_id": user_id,
            "name": "ntan",
            "email": admin_email,
            "phone": None,
            "password_hash": hash_password("ntan@123"),
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        await database.users.insert_one(user)
    else:
        await database.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "password_hash": hash_password("ntan@123"),
                    "status": "active",
                    "updated_at": now,
                }
            },
        )

    membership = await database.memberships.find_one({"user_id": user["_id"], "status": "active"})
    if membership is None:
        company = await database.companies.find_one({"name": "NTAN"})
        if company is None:
            company_id = new_id()
            company = {
                "_id": company_id,
                "name": "NTAN",
                "currency": "USD",
                "timezone": "UTC",
                "inventory_model": "internal",
                "status": "active",
                "created_at": now,
                "updated_at": now,
            }
            await database.companies.insert_one(company)
        else:
            company_id = company["_id"]

        warehouse = await database.warehouses.find_one({"company_id": company_id})
        if warehouse is None:
            warehouse_id = new_id()
            warehouse = {
                "_id": warehouse_id,
                "company_id": company_id,
                "name": "Main Warehouse",
                "name_key": "main warehouse",
                "address": "NTAN Central Hub",
                "status": "active",
                "created_at": now,
                "updated_at": now,
                "created_by": user["_id"],
            }
            await database.warehouses.insert_one(warehouse)

            main_location_id = new_id()
            default_locations = [
                {
                    "_id": new_id(),
                    "company_id": company_id,
                    "warehouse_id": warehouse_id,
                    "parent_id": None,
                    "code": "RECV",
                    "path": "RECV",
                    "barcode": None,
                    "type": "receiving",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": main_location_id,
                    "company_id": company_id,
                    "warehouse_id": warehouse_id,
                    "parent_id": None,
                    "code": "MAIN",
                    "path": "MAIN",
                    "barcode": None,
                    "type": "main",
                    "is_pickable": False,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "_id": new_id(),
                    "company_id": company_id,
                    "warehouse_id": warehouse_id,
                    "parent_id": main_location_id,
                    "code": "BIN-01",
                    "path": "MAIN/BIN-01",
                    "barcode": None,
                    "type": "bin",
                    "is_pickable": True,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                },
            ]
            await database.locations.insert_many(default_locations)

        await ensure_internal_client(database, company_id)

        new_membership = {
            "_id": new_id(),
            "company_id": company_id,
            "user_id": user["_id"],
            "role": "owner",
            "location_ids": [],
            "client_ids": [],
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        await database.memberships.insert_one(new_membership)

