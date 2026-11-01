from datetime import date, datetime
from decimal import Decimal
from typing import Any

from .permissions import ROLE_LABELS
from .schemas import (
    AuditEventOut,
    BalanceOut,
    ClientOut,
    CompanyOut,
    InvitationOut,
    ItemOut,
    ItemSupplierOut,
    LocationOut,
    LotOut,
    MemberOut,
    MembershipOut,
    MovementOut,
    PartnerAddress,
    PartnerContact,
    PurchaseOrderLineOut,
    PurchaseOrderOut,
    PutawayPlacementOut,
    PutawayTaskOut,
    ReceiptLineOut,
    ReceiptOut,
    RoleDefinitionOut,
    SerialOut,
    SupplierItemOut,
    SyncEventOut,
    TransferLineOut,
    TransferOut,
    UserOut,
    WarehouseOut,
)
from .utils import to_decimal, utcnow


def role_definition_out(
    document: dict[str, Any],
    assigned_count: int = 0,
) -> RoleDefinitionOut:
    return RoleDefinitionOut(
        id=document["_id"],
        slug=document["slug"],
        name=document["name"],
        description=document.get("description"),
        permissions=document.get("permissions", []),
        is_custom=document.get("is_custom", True),
        assigned_members_count=assigned_count,
        created_at=document.get("created_at"),
        updated_at=document.get("updated_at"),
    )


def user_out(document: dict[str, Any]) -> UserOut:
    return UserOut(
        id=document["_id"],
        name=document["name"],
        email=document["email"],
        phone=document.get("phone"),
        status=document.get("status", "active"),
    )


def company_out(document: dict[str, Any]) -> CompanyOut:
    return CompanyOut(
        id=document["_id"],
        name=document["name"],
        currency=document["currency"],
        timezone=document["timezone"],
        status=document.get("status", "active"),
        inventory_model=document.get("inventory_model", "internal"),
        allow_over_receipt=document.get("allow_over_receipt", False),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def client_out(document: dict[str, Any]) -> ClientOut:
    raw_types = document.get("types")
    if not raw_types:
        types = ["3pl_client"]
    else:
        types = list(raw_types)

    billing = document.get("billing_address")
    billing_obj = PartnerAddress(**billing) if isinstance(billing, dict) else None

    addresses_list: list[PartnerAddress] = []
    for addr in document.get("addresses") or []:
        if isinstance(addr, dict):
            addresses_list.append(PartnerAddress(**addr))

    contacts_list: list[PartnerContact] = []
    for contact in document.get("contacts") or []:
        if isinstance(contact, dict):
            contacts_list.append(PartnerContact(**contact))

    return ClientOut(
        id=document["_id"],
        company_id=document["company_id"],
        code=document["code"],
        name=document["name"],
        display_name=document.get("display_name"),
        types=types,
        contact_name=document.get("contact_name"),
        contact_email=document.get("contact_email"),
        contact_phone=document.get("contact_phone"),
        contacts=contacts_list,
        tax_id=document.get("tax_id"),
        billing_address=billing_obj,
        addresses=addresses_list,
        notes=document.get("notes"),
        is_internal=document.get("is_internal", False),
        status=document.get("status", "active"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def membership_out(document: dict[str, Any], company_name: str | None = None) -> MembershipOut:
    return MembershipOut(
        id=document["_id"],
        company_id=document["company_id"],
        user_id=document["user_id"],
        company_name=company_name,
        role=document["role"],
        location_ids=document.get("location_ids", []),
        client_ids=document.get("client_ids", []),
        status=document.get("status", "active"),
    )


def member_out(document: dict[str, Any], user: dict[str, Any]) -> MemberOut:
    role = document["role"]
    return MemberOut(
        id=document["_id"],
        user_id=document["user_id"],
        name=user["name"],
        email=user["email"],
        phone=user.get("phone"),
        role=role,
        role_label=ROLE_LABELS.get(role, role.replace("_", " ").title()),
        is_custom_role=role not in ROLE_LABELS,
        location_ids=document.get("location_ids", []),
        warehouse_ids=document.get("warehouse_ids", []),
        client_ids=document.get("client_ids", []),
        status=document.get("status", "active"),
        valid_from=document.get("valid_from"),
        valid_until=document.get("valid_until"),
        department=document.get("department"),
        job_title=document.get("job_title"),
        employee_id=document.get("employee_id"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def invitation_status(document: dict[str, Any]) -> str:
    if document.get("accepted_at") is not None:
        return "accepted"
    if document.get("revoked_at") is not None:
        return "revoked"
    if document["expires_at"] <= utcnow():
        return "expired"
    return "pending"


def invitation_out(document: dict[str, Any]) -> InvitationOut:
    role = document["role"]
    return InvitationOut(
        id=document["_id"],
        email=document["email"],
        name=document.get("name"),
        phone=document.get("phone"),
        role=role,
        role_label=ROLE_LABELS.get(role, role.replace("_", " ").title()),
        is_custom_role=role not in ROLE_LABELS,
        warehouse_ids=document.get("warehouse_ids", []),
        location_ids=document.get("location_ids", []),
        client_ids=document.get("client_ids", []),
        status=invitation_status(document),
        invite_code=document.get("invite_code"),
        email_delivery_status=document.get("email_delivery_status", "pending"),
        email_delivery_error=document.get("email_delivery_error"),
        valid_from=document.get("valid_from"),
        valid_until=document.get("valid_until"),
        department=document.get("department"),
        job_title=document.get("job_title"),
        employee_id=document.get("employee_id"),
        expires_at=document["expires_at"],
        created_at=document["created_at"],
        accepted_at=document.get("accepted_at"),
        revoked_at=document.get("revoked_at"),
    )


def audit_event_out(document: dict[str, Any]) -> AuditEventOut:
    return AuditEventOut(
        id=document["_id"],
        actor_id=document.get("actor_id"),
        action=document["action"],
        entity=document["entity"],
        entity_id=document["entity_id"],
        reason=document.get("reason"),
        before=document.get("before"),
        after=document.get("after"),
        created_at=document["created_at"],
    )


def item_out(
    document: dict[str, Any],
    include_cost: bool = True,
    *,
    supplier_count: int = 0,
    preferred_supplier_id: str | None = None,
    preferred_supplier_name: str | None = None,
) -> ItemOut:
    cost = document.get("cost") if include_cost else None
    return ItemOut(
        id=document["_id"],
        company_id=document.get("company_id"),
        client_id=document.get("client_id"),
        sku=document["sku"],
        name=document["name"],
        barcode=document.get("barcode"),
        description=document.get("description"),
        category=document.get("category"),
        item_type=document["item_type"],
        base_uom=document["base_uom"],
        tracking_mode=document["tracking_mode"],
        expiry_tracked=document.get("expiry_tracked", False),
        cost=to_decimal(cost) if cost is not None else None,
        reorder_point=(
            to_decimal(document["reorder_point"])
            if document.get("reorder_point") is not None
            else None
        ),
        status=document.get("status", "active"),
        supplier_count=supplier_count,
        preferred_supplier_id=preferred_supplier_id,
        preferred_supplier_name=preferred_supplier_name,
        preferred_locations=document.get("preferred_locations") or [],
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def item_supplier_out(
    document: dict[str, Any],
    supplier: dict[str, Any] | None,
    include_cost: bool = True,
) -> ItemSupplierOut:
    supplier_status = (supplier or {}).get("status", "deleted")
    return ItemSupplierOut(
        id=document["_id"],
        company_id=document["company_id"],
        item_id=document["item_id"],
        supplier_id=document["client_id"],
        supplier_name=(supplier or {}).get("display_name")
        or (supplier or {}).get("name")
        or "Unknown supplier",
        supplier_code=(supplier or {}).get("code"),
        supplier_status=supplier_status,
        supplier_is_active=supplier_status == "active",
        supplier_types=list((supplier or {}).get("types") or []),
        supplier_sku=document["supplier_sku"],
        purchase_price=(
            to_decimal(document["purchase_price"])
            if include_cost and document.get("purchase_price") is not None
            else None
        ),
        currency=document["currency"],
        lead_time_days=document.get("lead_time_days"),
        min_order_qty=(
            to_decimal(document["min_order_qty"])
            if document.get("min_order_qty") is not None
            else None
        ),
        is_preferred=document.get("is_preferred", False),
        status=document.get("status", "active"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def supplier_item_out(
    mapping: dict[str, Any],
    item: dict[str, Any],
    include_cost: bool = True,
    delivery: dict[str, Any] | None = None,
) -> SupplierItemOut:
    delivery = delivery or {}
    return SupplierItemOut(
        mapping_id=mapping["_id"],
        item_id=item["_id"],
        item_sku=item["sku"],
        item_name=item["name"],
        item_category=item.get("category"),
        item_base_uom=item["base_uom"],
        item_status=item.get("status", "active"),
        item_client_id=item.get("client_id"),
        supplier_sku=mapping["supplier_sku"],
        purchase_price=(
            to_decimal(mapping["purchase_price"])
            if include_cost and mapping.get("purchase_price") is not None
            else None
        ),
        currency=mapping["currency"],
        lead_time_days=mapping.get("lead_time_days"),
        min_order_qty=(
            to_decimal(mapping["min_order_qty"])
            if mapping.get("min_order_qty") is not None
            else None
        ),
        is_preferred=mapping.get("is_preferred", False),
        status=mapping.get("status", "active"),
        last_delivery_at=delivery.get("last_delivery_at"),
        delivered_qty=to_decimal(delivery.get("delivered_qty", 0)),
        delivery_count=int(delivery.get("delivery_count", 0)),
        last_receipt_id=delivery.get("last_receipt_id"),
        last_receipt_number=delivery.get("last_receipt_number"),
        created_at=mapping["created_at"],
        updated_at=mapping["updated_at"],
    )


def lot_out(document: dict[str, Any]) -> LotOut:
    return LotOut(
        id=document["_id"],
        company_id=document["company_id"],
        client_id=document.get("client_id"),
        item_id=document["item_id"],
        sku=document.get("sku"),
        item_name=document.get("item_name"),
        lot_no=document["lot_no"],
        expiry_date=document.get("expiry_date"),
        status=document.get("status", "active"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def serial_out(document: dict[str, Any]) -> SerialOut:
    return SerialOut(
        id=document["_id"],
        company_id=document["company_id"],
        client_id=document.get("client_id"),
        item_id=document["item_id"],
        sku=document.get("sku"),
        item_name=document.get("item_name"),
        serial_no=document["serial_no"],
        lot_id=document.get("lot_id"),
        lot_no=document.get("lot_no"),
        status=document.get("status", "active"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def warehouse_out(document: dict[str, Any]) -> WarehouseOut:
    return WarehouseOut(
        id=document["_id"],
        code=document.get("code"),
        name=document["name"],
        address=document.get("address"),
        warehouse_type=document.get("warehouse_type"),
        warehouse_layout=document.get("warehouse_layout"),
        status=document.get("status", "active"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def location_out(
    document: dict[str, Any],
    *,
    preferred_items: list[dict[str, Any]] | None = None,
    actual_stock_qty: Decimal | None = None,
) -> LocationOut:
    return LocationOut(
        id=document["_id"],
        warehouse_id=document["warehouse_id"],
        parent_id=document.get("parent_id"),
        code=document["code"],
        name=document.get("name"),
        path=document.get("path"),
        barcode=document.get("barcode"),
        type=document["type"],
        is_pickable=document.get("is_pickable", True),
        status=document.get("status", "active"),
        zone=document.get("zone"),
        aisle=document.get("aisle"),
        rack=document.get("rack"),
        shelf=document.get("shelf"),
        bin=document.get("bin"),
        capacity=to_decimal(document["capacity"]) if document.get("capacity") is not None else None,
        preferred_items=preferred_items or document.get("preferred_items") or [],
        actual_stock_qty=actual_stock_qty if actual_stock_qty is not None else to_decimal(document.get("actual_stock_qty")),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


def receipt_line_out(document: dict[str, Any]) -> ReceiptLineOut:
    return ReceiptLineOut(
        id=document["id"],
        item_id=document["item_id"],
        sku=document["sku"],
        supplier_sku=document.get("supplier_sku"),
        item_name=document["item_name"],
        qty=to_decimal(document["qty"]),
        uom=document["uom"],
        base_qty=to_decimal(document["base_qty"]),
        base_uom=document["base_uom"],
        location_id=document["location_id"],
        lot_id=document.get("lot_id"),
        lot_no=document.get("lot_no"),
        expiry_date=document.get("expiry_date"),
        serial_no=document.get("serial_no"),
        serial_numbers=document.get("serial_numbers", []),
        discrepancy_reason=document.get("discrepancy_reason"),
        purchase_order_line_id=document.get("purchase_order_line_id"),
    )


def receipt_out(document: dict[str, Any]) -> ReceiptOut:
    return ReceiptOut(
        id=document["_id"],
        company_id=document.get("company_id"),
        client_id=document.get("client_id"),
        number=document["number"],
        status=document["status"],
        warehouse_id=document["warehouse_id"],
        location_id=document["location_id"],
        supplier_id=document.get("supplier_id"),
        supplier=document.get("supplier"),
        purchase_order=document.get("purchase_order"),
        purchase_order_id=document.get("purchase_order_id"),
        note=document.get("note"),
        delivery_note=document.get("delivery_note"),
        discrepancy_reason=document.get("discrepancy_reason"),
        putaway_required=document.get("putaway_required", False),
        putaway_completed_at=document.get("putaway_completed_at"),
        lines=[receipt_line_out(line) for line in document.get("lines", [])],
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        committed_at=document.get("committed_at"),
    )


def purchase_order_line_out(document: dict[str, Any]) -> PurchaseOrderLineOut:
    ordered = to_decimal(document.get("ordered_qty"))
    received = to_decimal(document.get("received_qty"))
    return PurchaseOrderLineOut(
        id=document["id"],
        item_id=document["item_id"],
        sku=document.get("sku", ""),
        supplier_sku=document.get("supplier_sku"),
        item_name=document.get("item_name", ""),
        uom=document.get("uom", ""),
        base_uom=document.get("base_uom", ""),
        ordered_qty=ordered,
        received_qty=received,
        remaining_qty=max(ordered - received, to_decimal(0)),
    )


def purchase_order_out(document: dict[str, Any]) -> PurchaseOrderOut:
    lines = [purchase_order_line_out(line) for line in document.get("lines", [])]
    ordered_total = sum((line.ordered_qty for line in lines), to_decimal(0))
    received_total = sum((line.received_qty for line in lines), to_decimal(0))
    expected_date = document.get("expected_date")
    if isinstance(expected_date, datetime):
        expected_date = expected_date.date()
    elif isinstance(expected_date, str):
        expected_date = date.fromisoformat(expected_date)
    return PurchaseOrderOut(
        id=document["_id"],
        company_id=document["company_id"],
        client_id=document.get("client_id"),
        number=document["number"],
        status=document["status"],
        warehouse_id=document["warehouse_id"],
        supplier_id=document["supplier_id"],
        supplier_name=document.get("supplier_name", ""),
        expected_date=expected_date,
        note=document.get("note"),
        line_count=len(lines),
        ordered_qty=ordered_total,
        received_qty=received_total,
        remaining_qty=max(ordered_total - received_total, to_decimal(0)),
        lines=lines,
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        received_at=document.get("received_at"),
        cancelled_at=document.get("cancelled_at"),
    )


def putaway_task_out(document: dict[str, Any]) -> PutawayTaskOut:
    base_qty = to_decimal(document["base_qty"])
    completed_qty = to_decimal(document.get("completed_qty") or 0)
    remaining_qty = max(base_qty - completed_qty, Decimal("0"))
    placements = [
        PutawayPlacementOut(
            location_id=placement["location_id"],
            location_code=placement.get("location_code", ""),
            quantity=to_decimal(placement.get("quantity", 0)),
            moved_at=placement["moved_at"],
            moved_by=placement.get("moved_by"),
        )
        for placement in document.get("placements") or []
    ]
    return PutawayTaskOut(
        id=document["_id"],
        company_id=document["company_id"],
        client_id=document.get("client_id"),
        receipt_id=document["receipt_id"],
        receipt_number=document["receipt_number"],
        line_id=document["line_id"],
        warehouse_id=document["warehouse_id"],
        item_id=document["item_id"],
        sku=document["sku"],
        item_name=document["item_name"],
        qty=to_decimal(document["qty"]),
        uom=document["uom"],
        base_qty=base_qty,
        base_uom=document["base_uom"],
        lot_id=document.get("lot_id"),
        lot_no=document.get("lot_no"),
        expiry_date=document.get("expiry_date"),
        serial_id=document.get("serial_id"),
        serial_no=document.get("serial_no"),
        tracking_mode=document.get("tracking_mode", "none"),
        supplier_id=document.get("supplier_id"),
        supplier_name=document.get("supplier"),
        purchase_order_id=document.get("purchase_order_id"),
        purchase_order=document.get("purchase_order"),
        from_location_id=document["from_location_id"],
        from_location_code=document.get("from_location_code", ""),
        to_location_id=document.get("to_location_id"),
        to_location_code=document.get("to_location_code"),
        suggested_location_id=document.get("suggested_location_id"),
        suggested_location_code=document.get("suggested_location_code"),
        completed_qty=completed_qty,
        remaining_qty=remaining_qty,
        placements=placements,
        status=document["status"],
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        completed_at=document.get("completed_at"),
        completed_by=document.get("completed_by"),
    )


def balance_out(document: dict[str, Any]) -> BalanceOut:
    on_hand = to_decimal(document["on_hand"])
    reserved = to_decimal(document["reserved"])
    blocked = to_decimal(document["blocked"])
    return BalanceOut(
        id=document["_id"],
        company_id=document.get("company_id"),
        client_id=document.get("client_id"),
        item_id=document["item_id"],
        sku=document.get("sku"),
        item_name=document.get("item_name"),
        warehouse_id=document["warehouse_id"],
        location_id=document["location_id"],
        lot_id=document.get("lot_id"),
        lot_no=document.get("lot_no"),
        serial_id=document.get("serial_id"),
        serial_no=document.get("serial_no"),
        expiry_date=document.get("expiry_date"),
        stock_status=document["stock_status"],
        on_hand=on_hand,
        reserved=reserved,
        blocked=blocked,
        available=on_hand - reserved - blocked,
        version=document.get("version", 0),
        updated_at=document["updated_at"],
    )


def movement_out(document: dict[str, Any]) -> MovementOut:
    return MovementOut(
        id=document["_id"],
        company_id=document.get("company_id"),
        client_id=document.get("client_id"),
        type=document["type"],
        item_id=document["item_id"],
        sku=document.get("sku"),
        item_name=document.get("item_name"),
        quantity_delta=to_decimal(document["quantity_delta"]),
        uom=document["uom"],
        base_qty=to_decimal(document["base_qty"]),
        from_location_id=document.get("from_location_id"),
        to_location_id=document.get("to_location_id"),
        lot_id=document.get("lot_id"),
        lot_no=document.get("lot_no"),
        serial_id=document.get("serial_id"),
        serial_no=document.get("serial_no"),
        expiry_date=document.get("expiry_date"),
        stock_status=document["stock_status"],
        source_type=document["source_type"],
        source_id=document["source_id"],
        source_number=document["source_number"],
        actor_id=document["actor_id"],
        device_id=document.get("device_id"),
        occurred_at=document["occurred_at"],
        recorded_at=document["recorded_at"],
        reason=document.get("reason"),
        reversal_of=document.get("reversal_of"),
        idempotency_key=document["idempotency_key"],
    )


def sync_event_out(document: dict[str, Any]) -> SyncEventOut:
    return SyncEventOut(
        sequence=document["sequence"],
        entity_type=document["entity_type"],
        entity_id=document["entity_id"],
        action=document["action"],
        client_id=document.get("client_id"),
        payload=document.get("payload", {}),
        occurred_at=document["occurred_at"],
    )


def transfer_line_out(document: dict[str, Any]) -> TransferLineOut:
    return TransferLineOut(
        id=document["id"],
        item_id=document["item_id"],
        sku=document["sku"],
        item_name=document["item_name"],
        qty=to_decimal(document["qty"]),
        uom=document["uom"],
        base_qty=to_decimal(document["base_qty"]),
        base_uom=document["base_uom"],
        lot_id=document.get("lot_id"),
        lot_no=document.get("lot_no"),
        expiry_date=document.get("expiry_date"),
        serial_id=document.get("serial_id"),
        serial_no=document.get("serial_no"),
        serial_numbers=document.get("serial_numbers", []),
    )


def transfer_out(document: dict[str, Any]) -> TransferOut:
    return TransferOut(
        id=document["_id"],
        company_id=document["company_id"],
        client_id=document.get("client_id"),
        number=document["number"],
        status=document["status"],
        transfer_type=document.get("transfer_type", "bin_to_bin"),
        from_warehouse_id=document["from_warehouse_id"],
        from_location_id=document["from_location_id"],
        to_warehouse_id=document["to_warehouse_id"],
        to_location_id=document["to_location_id"],
        note=document.get("note"),
        reason=document.get("reason"),
        lines=[transfer_line_out(line) for line in document.get("lines", [])],
        created_by=document.get("created_by"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        dispatched_at=document.get("dispatched_at"),
        dispatched_by=document.get("dispatched_by"),
        completed_at=document.get("completed_at"),
        completed_by=document.get("completed_by"),
        cancelled_at=document.get("cancelled_at"),
        cancelled_by=document.get("cancelled_by"),
    )

