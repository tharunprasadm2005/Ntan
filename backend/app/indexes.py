from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure


async def _drop_if_exists(database: AsyncDatabase, collection: str, name: str) -> None:
    try:
        await database[collection].drop_index(name)
    except OperationFailure as exc:
        if exc.code != 27:
            raise


async def create_indexes(database: AsyncDatabase) -> None:
    for collection, name in (
        ("items", "items_company_sku_unique"),
        ("items", "items_company_barcode_unique"),
        ("balances", "balances_stock_key_unique"),
        ("putaway_tasks", "putaway_tasks_receipt_line_unique"),
        ("movements", "movements_receipt_line_unique"),
        ("movements", "movements_putaway_task_unique"),
    ):
        await _drop_if_exists(database, collection, name)

    await database.users.create_indexes(
        [
            IndexModel([("email", ASCENDING)], unique=True, name="users_email_unique"),
            IndexModel(
                [("phone", ASCENDING)],
                unique=True,
                partialFilterExpression={"phone": {"$type": "string"}},
                name="users_phone_unique",
            ),
        ]
    )
    await database.memberships.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("user_id", ASCENDING)],
                unique=True,
                name="memberships_company_user_unique",
            ),
            IndexModel(
                [("user_id", ASCENDING), ("status", ASCENDING)],
                name="memberships_user_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("role", ASCENDING), ("status", ASCENDING)],
                name="memberships_company_role_status",
            ),
        ]
    )
    await database.invitations.create_indexes(
        [
            IndexModel(
                [("token_hash", ASCENDING)],
                unique=True,
                name="invitations_token_hash_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("created_at", DESCENDING)],
                name="invitations_company_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("email", ASCENDING)],
                name="invitations_company_email",
            ),
            IndexModel(
                [("active_key", ASCENDING)],
                unique=True,
                partialFilterExpression={"active_key": {"$type": "string"}},
                name="invitations_active_key_unique",
            ),
            IndexModel(
                [("normalized_invite_code", ASCENDING)],
                unique=True,
                partialFilterExpression={"normalized_invite_code": {"$type": "string"}},
                name="invitations_normalized_invite_code_unique",
            ),
        ]
    )
    await database.custom_roles.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("slug", ASCENDING)],
                unique=True,
                name="custom_roles_company_slug_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING)],
                name="custom_roles_company_status",
            ),
        ]
    )
    await database.password_resets.create_indexes(
        [
            IndexModel(
                [("email", ASCENDING), ("expires_at", DESCENDING)],
                name="password_resets_email_expires",
            ),
            IndexModel(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0,
                name="password_resets_ttl",
            ),
        ]
    )
    await database.clients.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("code", ASCENDING)],
                unique=True,
                name="clients_company_code_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("is_internal", ASCENDING)],
                unique=True,
                partialFilterExpression={"is_internal": True},
                name="clients_company_internal_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("name", ASCENDING)],
                name="clients_company_status_name",
            ),
        ]
    )
    await database.lots.create_indexes(
        [
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("client_id", ASCENDING),
                    ("item_id", ASCENDING),
                    ("lot_no", ASCENDING),
                ],
                unique=True,
                name="lots_company_client_item_number_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("expiry_date", ASCENDING)],
                name="lots_company_expiry",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("item_id", ASCENDING), ("created_at", DESCENDING)],
                name="lots_company_item_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="lots_company_client_created",
            ),
        ]
    )
    await database.serials.create_indexes(
        [
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("client_id", ASCENDING),
                    ("item_id", ASCENDING),
                    ("serial_no", ASCENDING),
                ],
                unique=True,
                name="serials_company_client_item_number_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING)],
                name="serials_company_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("item_id", ASCENDING), ("created_at", DESCENDING)],
                name="serials_company_item_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="serials_company_client_created",
            ),
        ]
    )
    await database.rate_limits.create_indexes(
        [
            IndexModel(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0,
                name="rate_limits_expiry_ttl",
            ),
        ]
    )
    await database.refresh_tokens.create_indexes(
        [
            IndexModel(
                [("user_id", ASCENDING), ("company_id", ASCENDING)],
                name="refresh_tokens_user_company",
            ),
            IndexModel(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0,
                name="refresh_tokens_expiry_ttl",
            ),
        ]
    )
    await database.items.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("sku", ASCENDING)],
                unique=True,
                name="items_company_client_sku_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("barcode", ASCENDING)],
                unique=True,
                partialFilterExpression={"barcode": {"$type": "string"}},
                name="items_company_client_barcode_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="items_company_client_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
                name="items_company_created",
            ),
        ]
    )
    await database.supplier_item_mappings.create_indexes(
        [
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("item_id", ASCENDING),
                    ("client_id", ASCENDING),
                ],
                unique=True,
                name="supplier_item_mappings_company_item_supplier_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("item_id", ASCENDING)],
                unique=True,
                partialFilterExpression={
                    "is_preferred": True,
                    "status": "active",
                },
                name="supplier_item_mappings_company_item_preferred_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("status", ASCENDING)],
                name="supplier_item_mappings_company_supplier_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("item_id", ASCENDING), ("status", ASCENDING)],
                name="supplier_item_mappings_company_item_status",
            ),
        ]
    )
    await database.warehouses.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("name_key", ASCENDING)],
                unique=True,
                name="warehouses_company_name_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("code", ASCENDING)],
                unique=True,
                partialFilterExpression={"code": {"$type": "string"}},
                name="warehouses_company_code_unique",
            ),
        ]
    )
    await database.locations.create_indexes(
        [
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("warehouse_id", ASCENDING),
                    ("parent_id", ASCENDING),
                    ("code", ASCENDING),
                ],
                unique=True,
                name="locations_scope_code_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("warehouse_id", ASCENDING), ("status", ASCENDING)],
                name="locations_company_warehouse_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("warehouse_id", ASCENDING), ("path", ASCENDING)],
                unique=True,
                partialFilterExpression={"path": {"$type": "string"}},
                name="locations_company_warehouse_path_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("barcode", ASCENDING)],
                unique=True,
                partialFilterExpression={"barcode": {"$type": "string"}},
                name="locations_company_barcode_unique",
            ),
        ]
    )
    await database.receipts.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("idempotency_key", ASCENDING)],
                unique=True,
                name="receipts_company_idempotency_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("number", ASCENDING)],
                unique=True,
                name="receipts_company_number_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
                name="receipts_company_status_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="receipts_company_client_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("supplier_id", ASCENDING), ("created_at", DESCENDING)],
                name="receipts_company_supplier_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("warehouse_id", ASCENDING), ("created_at", DESCENDING)],
                name="receipts_company_warehouse_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("purchase_order_id", ASCENDING)],
                name="receipts_company_purchase_order",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("lines.item_id", ASCENDING)],
                name="receipts_company_item",
            ),
        ]
    )
    await database.putaway_tasks.create_indexes(
        [
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("receipt_id", ASCENDING),
                    ("line_id", ASCENDING),
                    ("serial_id", ASCENDING),
                ],
                unique=True,
                name="putaway_tasks_receipt_line_serial_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", ASCENDING)],
                name="putaway_tasks_company_status_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("warehouse_id", ASCENDING), ("status", ASCENDING)],
                name="putaway_tasks_company_warehouse_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("status", ASCENDING)],
                name="putaway_tasks_company_client_status",
            ),
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("from_location_id", ASCENDING),
                    ("status", ASCENDING),
                ],
                name="putaway_tasks_company_location_status",
            ),
        ]
    )
    await database.balances.create_indexes(
        [
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("client_id", ASCENDING),
                    ("item_id", ASCENDING),
                    ("location_id", ASCENDING),
                    ("lot_id", ASCENDING),
                    ("serial_id", ASCENDING),
                    ("stock_status", ASCENDING),
                ],
                unique=True,
                name="balances_client_stock_key_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("item_id", ASCENDING), ("updated_at", DESCENDING)],
                name="balances_company_item",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("location_id", ASCENDING), ("updated_at", DESCENDING)],
                name="balances_company_location",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("updated_at", DESCENDING)],
                name="balances_company_client",
            ),
        ]
    )

    await database.purchase_orders.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("idempotency_key", ASCENDING)],
                unique=True,
                name="purchase_orders_company_idempotency_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("number", ASCENDING)],
                unique=True,
                name="purchase_orders_company_number_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
                name="purchase_orders_company_status_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="purchase_orders_company_client_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("supplier_id", ASCENDING), ("status", ASCENDING)],
                name="purchase_orders_company_supplier_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("warehouse_id", ASCENDING), ("status", ASCENDING)],
                name="purchase_orders_company_warehouse_status",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("lines.item_id", ASCENDING)],
                name="purchase_orders_company_item",
            ),
        ]
    )
    await database.outbound_orders.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("idempotency_key", ASCENDING)],
                unique=True,
                name="outbound_orders_company_idempotency_unique",
            ),            IndexModel(
                [("company_id", ASCENDING), ("number", ASCENDING)],
                unique=True,
                name="outbound_orders_company_number_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
                name="outbound_orders_company_status_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="outbound_orders_company_client_created",
            ),
        ]
    )
    await database.transfers.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("idempotency_key", ASCENDING)],
                unique=True,
                name="transfers_company_idempotency_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("number", ASCENDING)],
                unique=True,
                name="transfers_company_number_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
                name="transfers_company_status_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("created_at", DESCENDING)],
                name="transfers_company_client_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("from_warehouse_id", ASCENDING)],
                name="transfers_company_from_warehouse",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("to_warehouse_id", ASCENDING)],
                name="transfers_company_to_warehouse",
            ),
        ]
    )
    await database.movements.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("item_id", ASCENDING), ("recorded_at", DESCENDING)],
                name="movements_company_item_recorded",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("recorded_at", DESCENDING)],
                name="movements_company_recorded",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("client_id", ASCENDING), ("recorded_at", DESCENDING)],
                name="movements_company_client_recorded",
            ),
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("receipt_id", ASCENDING),
                    ("line_id", ASCENDING),
                    ("serial_id", ASCENDING),
                ],
                unique=True,
                partialFilterExpression={"receipt_id": {"$type": "string"}},
                name="movements_receipt_line_serial_unique",
            ),
            IndexModel(
                [
                    ("company_id", ASCENDING),
                    ("putaway_task_id", ASCENDING),
                    ("recorded_at", ASCENDING),
                ],
                name="movements_company_putaway_task",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("putaway_request_key", ASCENDING)],
                unique=True,
                partialFilterExpression={"putaway_request_key": {"$type": "string"}},
                name="movements_putaway_request_unique",
            ),
        ]
    )
    await database.sync_events.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("sequence", ASCENDING)],
                unique=True,
                name="sync_events_company_sequence_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("occurred_at", DESCENDING)],
                name="sync_events_company_occurred",
            ),
        ]
    )
    await database.sync_operations.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("operation_id", ASCENDING)],
                unique=True,
                name="sync_operations_company_operation_unique",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
                name="sync_operations_company_status_created",
            ),
        ]
    )
    await database.audit_events.create_indexes(
        [
            IndexModel(
                [("company_id", ASCENDING), ("created_at", DESCENDING)],
                name="audit_company_created",
            ),
            IndexModel(
                [("company_id", ASCENDING), ("entity", ASCENDING), ("entity_id", ASCENDING)],
                name="audit_company_entity",
            ),
        ]
    )
