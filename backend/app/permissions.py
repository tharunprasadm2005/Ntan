from collections.abc import Iterable
from typing import Any

from .errors import APIError

PERMISSIONS = frozenset(
    {
        "company.manage",
        "members.read",
        "members.manage",
        "invitations.read",
        "invitations.manage",
        "roles.assign",
        "roles.manage",
        "audit.read",
        "inventory.read",
        "inventory.write",
        "warehouses.manage",
        "stock.receive",
        "stock.putaway",
        "stock.pick",
        "stock.dispatch",
        "stock.issue",
        "stock.transfer",
        "stock.adjust",
        "stock.count",
        "clients.read",
        "clients.manage",
        "purchasing.manage",
        "sync.write",
        "cost.read",
        "reports.read",
    }
)

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    # Organization-Level Access Roles
    "owner": PERMISSIONS,
    "company_admin": frozenset(p for p in PERMISSIONS if p != "company.ownership_transfer"),

    # 14 Warehouse & Logistics Operational Roles
    "warehouse_manager": frozenset(
        {
            "members.read",
            "invitations.read",
            "invitations.manage",
            "roles.assign",
            "audit.read",
            "inventory.read",
            "inventory.write",
            "warehouses.manage",
            "stock.receive",
            "stock.putaway",
            "stock.pick",
            "stock.dispatch",
            "stock.issue",
            "stock.transfer",
            "stock.adjust",
            "stock.count",
            "clients.read",
            "purchasing.manage",
            "sync.write",
            "cost.read",
            "reports.read",
        }
    ),
    "warehouse_supervisor": frozenset(
        {
            "inventory.read",
            "inventory.write",
            "warehouses.manage",
            "stock.receive",
            "stock.issue",
            "stock.transfer",
            "stock.adjust",
            "stock.putaway",
            "stock.pick",
            "stock.dispatch",
            "stock.count",
            "clients.read",
            "purchasing.manage",
            "sync.write",
            "reports.read",
        }
    ),
    "receiving_operator": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.putaway",
            "sync.write",
        }
    ),
    "quality_inspector": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
            "reports.read",
        }
    ),
    "qc_inspector": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
            "reports.read",
        }
    ),
    "putaway_operator": frozenset(
        {
            "inventory.read",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
        }
    ),
    "material_handler": frozenset(
        {
            "inventory.read",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
        }
    ),
    "material_handling_operator": frozenset(
        {
            "inventory.read",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
        }
    ),
    "inventory_controller": frozenset(
        {
            "inventory.read",
            "inventory.write",
            "stock.adjust",
            "stock.count",
            "stock.transfer",
            "cost.read",
            "reports.read",
            "audit.read",
        }
    ),
    "replenishment_operator": frozenset(
        {
            "inventory.read",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
        }
    ),
    "order_picker": frozenset(
        {
            "inventory.read",
            "stock.pick",
            "stock.transfer",
            "sync.write",
        }
    ),
    "packing_operator": frozenset(
        {
            "inventory.read",
            "stock.pick",
            "stock.transfer",
            "sync.write",
        }
    ),
    "dispatch_operator": frozenset(
        {
            "inventory.read",
            "stock.dispatch",
            "stock.transfer",
            "sync.write",
        }
    ),
    "logistics_coordinator": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.dispatch",
            "clients.read",
            "reports.read",
            "sync.write",
        }
    ),
    "cycle_counter": frozenset(
        {
            "inventory.read",
            "stock.count",
            "sync.write",
        }
    ),
    "returns_operator": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.putaway",
            "stock.transfer",
            "sync.write",
        }
    ),

    # Read-Only Access Profiles
    "viewer": frozenset({"inventory.read", "reports.read"}),
    "auditor": frozenset(
        {"inventory.read", "cost.read", "reports.read", "audit.read"}
    ),

    # Compatible / Legacy Roles
    "picker_packer": frozenset(
        {
            "inventory.read",
            "stock.pick",
            "stock.transfer",
            "sync.write",
        }
    ),
    "warehouse_operator": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.issue",
            "stock.transfer",
            "stock.putaway",
            "stock.pick",
            "stock.dispatch",
            "stock.count",
            "sync.write",
        }
    ),
    "inventory_manager": frozenset(
        {
            "members.read",
            "audit.read",
            "inventory.read",
            "inventory.write",
            "stock.receive",
            "stock.issue",
            "stock.transfer",
            "stock.adjust",
            "stock.putaway",
            "stock.pick",
            "stock.dispatch",
            "stock.count",
            "clients.read",
            "sync.write",
            "cost.read",
            "reports.read",
        }
    ),
    "inventory_operator": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "stock.issue",
            "stock.transfer",
            "stock.putaway",
            "stock.pick",
            "stock.dispatch",
            "stock.count",
            "sync.write",
        }
    ),
    "project_manager": frozenset({"inventory.read", "reports.read"}),
    "technician": frozenset({"inventory.read"}),
    "purchasing": frozenset(
        {
            "inventory.read",
            "stock.receive",
            "purchasing.manage",
            "cost.read",
            "reports.read",
        }
    ),
}

DEFAULT_ROLES: tuple[str, ...] = (
    # Organization-Level Access Roles
    "owner",
    "company_admin",

    # 14 Operational Roles
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

    # Read-Only Access Profiles
    "viewer",
    "auditor",

    # Compatible / Legacy Roles
    "picker_packer",
    "warehouse_operator",
    "inventory_manager",
    "inventory_operator",
    "project_manager",
    "technician",
    "purchasing",
)

ALL_ROLES = frozenset(ROLE_PERMISSIONS.keys())

ROLE_LABELS: dict[str, str] = {
    # Organization-Level
    "owner": "Owner",
    "company_admin": "Company Admin",

    # 14 Operational Roles
    "warehouse_manager": "Warehouse Manager",
    "warehouse_supervisor": "Warehouse Supervisor",
    "receiving_operator": "Receiving Operator",
    "quality_inspector": "Quality Control Inspector",
    "qc_inspector": "Quality Control Inspector",
    "putaway_operator": "Put-away Operator",
    "material_handler": "Material Handling Operator",
    "material_handling_operator": "Material Handling Operator",
    "inventory_controller": "Inventory Controller",
    "replenishment_operator": "Replenishment Operator",
    "order_picker": "Order Picker",
    "packing_operator": "Packing Operator",
    "dispatch_operator": "Dispatch Operator",
    "logistics_coordinator": "Logistics Coordinator",
    "cycle_counter": "Cycle Counter",
    "returns_operator": "Returns Operator",

    # Read-Only
    "viewer": "Viewer",
    "auditor": "Auditor",

    # Legacy / Compatible
    "picker_packer": "Picker / Packer",
    "warehouse_operator": "Warehouse Operator",
    "inventory_manager": "Inventory Manager",
    "inventory_operator": "Inventory Operator",
    "project_manager": "Project Manager",
    "technician": "Technician",
    "purchasing": "Purchasing",
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    # Organization-Level
    "owner": "Full control over organization, members, warehouses, billing, and settings",
    "company_admin": "Manage workspaces, team members, warehouses, and operations",

    # 14 Operational Roles
    "warehouse_manager": "Supervise multi-facility warehouse flows, audits, and assignments",
    "warehouse_supervisor": "Manage shift operations, staff execution, stock movements, and count reviews",
    "receiving_operator": "Unload inbound shipments, verify manifests, inspect deliveries, and stage inbound freight",
    "quality_inspector": "Inspect inbound shipments, verify goods on arrival, track batch details, and transfer stock",
    "qc_inspector": "Inspect inbound shipments, verify goods on arrival, track batch details, and transfer stock",
    "putaway_operator": "Direct received stock to racks, bins, reserve locations, and primary storage",
    "material_handler": "Operate handling equipment, transfer pallets, and move stock between warehouse zones",
    "material_handling_operator": "Operate handling equipment, transfer pallets, and move stock between warehouse zones",
    "inventory_controller": "Perform stock adjustments, counts, cycle audits, and reconciliations",
    "replenishment_operator": "Replenish pick bins from reserve bulk storage and monitor forward pick levels",
    "order_picker": "Pick customer orders from bin locations accurately according to pick lists",
    "packing_operator": "Verify picked orders, package goods into cartons, apply shipping labels, and seal containers",
    "dispatch_operator": "Verify outbound loads, process carrier transfers, and record shipping exits",
    "logistics_coordinator": "Coordinate dock appointments, track inbound/outbound freight, and generate manifests",
    "cycle_counter": "Conduct scheduled physical cycle counts, verify bin balances, and report count variances",
    "returns_operator": "Receive returned shipments, verify returned items, and transfer stock to storage or inspection bays",

    # Read-Only
    "viewer": "Read-only access to inventory availability and stock levels",
    "auditor": "Inspect inventory movements, unit costs, counts, and security audit logs",

    # Legacy / Compatible
    "picker_packer": "Pick customer orders from bins, pack shipments, and stage dispatch",
    "warehouse_operator": "Record receipts, barcode scans, counts, and bin transfers",
    "inventory_manager": "Oversee stock balances, catalog items, adjustments, and receipts",
    "inventory_operator": "Record warehouse receipts, internal transfers, and bin counts",
    "project_manager": "View project-allocated stock, reservations, and inventory status",
    "technician": "Look up available parts, components, and tools",
    "purchasing": "Monitor low-stock items, supplier receipts, and procurement costs",
}

PERMISSION_CATALOGUE: list[dict[str, Any]] = [
    {
        "category": "Team & Access",
        "description": "User invitations, role assignments, and audit trails",
        "permissions": [
            {"key": "members.read", "label": "View Team", "description": "View team members, assignments, and statuses"},
            {"key": "members.manage", "label": "Manage Members", "description": "Suspend, reactivate, or remove members"},
            {"key": "invitations.read", "label": "View Invitations", "description": "View pending and historical invitations"},
            {"key": "invitations.manage", "label": "Manage Invitations", "description": "Create, resend, revoke, and bulk-import invitations"},
            {"key": "roles.assign", "label": "Assign Roles", "description": "Assign roles and warehouse scopes to members"},
            {"key": "roles.manage", "label": "Manage Custom Roles", "description": "Create, edit, and deactivate custom company roles"},
            {"key": "audit.read", "label": "View Audit History", "description": "Inspect access and stock security audit trails"},
        ],
    },
    {
        "category": "Inventory & Locations",
        "description": "Stock catalog, pricing, and facility layout",
        "permissions": [
            {"key": "inventory.read", "label": "View Inventory", "description": "View items, locations, stock balances, and lots"},
            {"key": "inventory.write", "label": "Manage Items", "description": "Create and edit items, SKUs, and categories"},
            {"key": "cost.read", "label": "View Item Costs", "description": "View purchase costs and valuation figures"},
            {"key": "warehouses.manage", "label": "Manage Warehouses", "description": "Create and update warehouses and storage bins"},
        ],
    },
    {
        "category": "Warehouse Operations",
        "description": "Receiving, movement, counting, and outbound logistics",
        "permissions": [
            {"key": "stock.receive", "label": "Inbound Receiving", "description": "Receive POs, check shipments, and record inbound stock"},
            {"key": "stock.putaway", "label": "Put-Away", "description": "Move goods from receiving docks to storage racks"},
            {"key": "stock.pick", "label": "Picking & Packing", "description": "Pick materials for outbound orders and packing"},
            {"key": "stock.dispatch", "label": "Outbound Dispatch", "description": "Ship orders and transfer materials out of the warehouse"},
            {"key": "stock.transfer", "label": "Internal Transfers", "description": "Transfer inventory between bins and facilities"},
            {"key": "stock.adjust", "label": "Stock Adjustments", "description": "Adjust quantities for damage, scrap, or write-offs"},
            {"key": "stock.count", "label": "Cycle Counting", "description": "Perform physical stock counts and audit reconciliations"},
            {"key": "purchasing.manage", "label": "Manage Purchase Orders", "description": "Create suppliers' purchase orders and monitor inbound quantities"},
            {"key": "sync.write", "label": "Offline Sync", "description": "Submit offline movements and scan reconciliations"},
        ],
    },
    {
        "category": "Company & 3PL Clients",
        "description": "Organizational settings and multi-client tenancy",
        "permissions": [
            {"key": "company.manage", "label": "Manage Organization", "description": "Update company profile, currency, and settings"},
            {"key": "clients.read", "label": "View 3PL Clients", "description": "View client accounts and consigned inventories"},
            {"key": "clients.manage", "label": "Manage 3PL Clients", "description": "Create and configure 3PL client accounts"},
            {"key": "reports.read", "label": "Reports & Analytics", "description": "Export inventory reports and operational analytics"},
        ],
    },
]


def permissions_for(role: str, custom_permissions: list[str] | None = None) -> list[str]:
    if custom_permissions:
        return sorted(set(custom_permissions))
    return sorted(ROLE_PERMISSIONS.get(role, frozenset()))


def has_permission(permissions: Iterable[str], permission: str) -> bool:
    return permission in set(permissions)


def ensure_permissions(permissions: Iterable[str], *required: str) -> None:
    values = set(permissions)
    missing = [permission for permission in required if permission not in values]
    if missing:
        raise APIError(
            403,
            "forbidden",
            "You do not have permission to perform this action.",
        )
