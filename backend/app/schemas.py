import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Role = str

ItemType = Literal[
    "stocked_material",
    "component",
    "spare",
    "sub_assembly",
    "finished_good",
    "consumable",
]
TrackingMode = Literal["none", "lot", "serial"]
StockStatus = Literal["available", "quarantine", "blocked"]
InventoryModel = Literal["internal", "3pl", "hybrid"]
LocationType = Literal[
    "receiving",
    "staging",
    "main",
    "bin",
    "picking",
    "packing",
    "dispatch",
    "line_side",
    "quarantine",
    "quality_inspection",
    "returns",
    "cold_storage",
    "finished_goods",
    "project_site",
]
WarehouseType = Literal[
    "general",
    "distribution",
    "fulfilment",
    "bulk",
    "cold_storage",
    "cross_dock",
]
WarehouseLayout = Literal[
    "all_in_one",
    "multi_zone",
    "bulk_storage",
]
WarehouseCategory = Literal[
    "all_in_one",
    "multi_zone",
    "main",
    "bin",
    "receiving",
    "project_site",
    "finished_goods",
]

Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
PositiveQuantity = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=6)]
NonNegativeDecimal = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=6)]


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class InitialLocationCreate(APIModel):
    code: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=120)
    type: LocationType = "main"
    is_pickable: bool = True
    parent_code: str | None = Field(default=None, max_length=64)
    zone: str | None = Field(default=None, max_length=64)
    aisle: str | None = Field(default=None, max_length=64)
    rack: str | None = Field(default=None, max_length=64)
    shelf: str | None = Field(default=None, max_length=64)
    bin: str | None = Field(default=None, max_length=64)
    barcode: str | None = Field(default=None, max_length=128)
    status: Literal["active", "blocked", "archived"] = "active"

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("parent_code")
    @classmethod
    def normalize_parent_code(cls, value: str | None) -> str | None:
        return value.strip().upper() if value and value.strip() else None

    @field_validator("name", "zone", "aisle", "rack", "shelf", "bin", "barcode")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None


class RegisterCompanyRequest(APIModel):
    company_name: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: Password
    phone: str | None = Field(default=None, max_length=32)
    warehouse_name: str | None = Field(default=None, min_length=1, max_length=120)
    warehouse_code: str | None = Field(default=None, max_length=32)
    warehouse_address: str | None = Field(default=None, max_length=255)
    warehouse_type: WarehouseType = "general"
    warehouse_layout: WarehouseLayout = "all_in_one"
    warehouse_category: str | None = None
    location_code: str | None = Field(default=None, max_length=64)
    currency: Currency = "USD"
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    inventory_model: InventoryModel = "internal"
    initial_locations: list[InitialLocationCreate] | None = None


class LoginRequest(APIModel):
    email: EmailStr
    password: Password
    company_id: str | None = None


class RefreshRequest(APIModel):
    refresh_token: str = Field(min_length=20, max_length=4096)


class LogoutRequest(APIModel):
    refresh_token: str = Field(min_length=20, max_length=4096)


class ForgotPasswordRequest(APIModel):
    email: EmailStr


class ForgotPasswordResponse(APIModel):
    message: str
    expires_in_minutes: int = 15
    email_sent: bool = False
    dev_code: str | None = None


class UserCheckRequest(APIModel):
    email: EmailStr


class UserCheckResponse(APIModel):
    exists: bool
    is_active: bool
    email: str


class ResetPasswordRequest(APIModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: Password


class ResetPasswordResponse(APIModel):
    message: str


class ChangePasswordRequest(APIModel):
    current_password: Password
    new_password: Password


class CompanyUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    currency: Currency | None = None
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    inventory_model: InventoryModel | None = None
    allow_over_receipt: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "CompanyUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class ItemPreferredLocation(APIModel):
    warehouse_id: str
    warehouse_code: str | None = None
    warehouse_name: str | None = None
    location_id: str
    location_code: str
    location_path: str | None = None
    zone: str | None = None
    aisle: str | None = None
    rack: str | None = None
    shelf: str | None = None
    bin: str | None = None
    storage_type: str | None = None
    is_primary: bool = True


class ItemCreate(APIModel):
    client_id: str | None = None
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    barcode: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=120)
    item_type: ItemType = "stocked_material"
    base_uom: str = Field(default="EA", min_length=1, max_length=16)
    tracking_mode: TrackingMode = "none"
    expiry_tracked: bool = False
    cost: NonNegativeDecimal | None = None
    reorder_point: NonNegativeDecimal | None = None
    status: Literal["active", "archived"] = "active"
    preferred_locations: list[ItemPreferredLocation] = Field(default_factory=list)

    @field_validator("sku")
    @classmethod
    def normalize_sku(cls, value: str) -> str:
        return value.upper()

    @field_validator("barcode", "description", "category")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("base_uom")
    @classmethod
    def normalize_uom(cls, value: str) -> str:
        return value.upper()


class ItemUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    barcode: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=120)
    expiry_tracked: bool | None = None
    cost: NonNegativeDecimal | None = None
    reorder_point: NonNegativeDecimal | None = None
    status: Literal["active", "archived"] | None = None
    preferred_locations: list[ItemPreferredLocation] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "ItemUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class ItemLookupRequest(APIModel):
    code: str = Field(min_length=1, max_length=128)
    client_id: str | None = None


class ScanResolveRequest(APIModel):
    code: str = Field(min_length=1, max_length=128)
    client_id: str | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip()


class BulkImportItemRow(APIModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    barcode: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=120)
    item_type: ItemType = "stocked_material"
    base_uom: str = Field(default="EA", min_length=1, max_length=16)
    tracking_mode: TrackingMode = "none"
    expiry_tracked: bool = False
    cost: NonNegativeDecimal | None = None
    reorder_point: NonNegativeDecimal | None = None
    status: Literal["active", "archived"] = "active"
    warehouse_code: str | None = None
    zone_code: str | None = None
    aisle_code: str | None = None
    rack_code: str | None = None
    shelf_code: str | None = None
    bin_code: str | None = None
    storage_type: str | None = None
    preferred_location: str | None = None

    @field_validator("sku")
    @classmethod
    def normalize_sku(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator(
        "barcode",
        "description",
        "category",
        "warehouse_code",
        "zone_code",
        "aisle_code",
        "rack_code",
        "shelf_code",
        "bin_code",
        "storage_type",
        "preferred_location",
    )
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("base_uom")
    @classmethod
    def normalize_uom(cls, value: str) -> str:
        return value.strip().upper() if value and value.strip() else "EA"


class BulkImportRequest(APIModel):
    client_id: str | None = None
    mode: Literal["upsert", "create_only"] = "upsert"
    csv_data: str | None = None
    file_base64: str | None = None
    file_name: str | None = None
    items: list[BulkImportItemRow] | None = None


class BulkImportError(APIModel):
    row: int
    sku: str | None = None
    field: str | None = None
    message: str


class BulkImportResponse(APIModel):
    total_rows: int
    created_count: int
    updated_count: int
    skipped_count: int
    error_count: int
    errors: list[BulkImportError]


class WarehouseCreate(APIModel):
    name: str = Field(min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=500)
    warehouse_type: WarehouseType = "general"
    warehouse_layout: WarehouseLayout = "multi_zone"
    apply_default_locations: bool = True
    selected_zones: list[str] | None = None
    status: Literal["active", "archived"] = "active"
    initial_locations: list[InitialLocationCreate] | None = None


class WarehouseTemplateLocationPreview(APIModel):
    code: str
    path: str
    type: LocationType
    is_pickable: bool
    description: str


class WarehouseTemplateApplyRequest(APIModel):
    preview_only: bool = False
    selected_zones: list[str] | None = None
    initial_locations: list[InitialLocationCreate] | None = None


class WarehouseTemplateApplyResponse(APIModel):
    warehouse_id: str
    warehouse_layout: WarehouseLayout
    preview_only: bool
    locations: list[WarehouseTemplateLocationPreview]
    created_count: int


class WarehouseUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=500)
    warehouse_type: WarehouseType | None = None
    warehouse_layout: WarehouseLayout | None = None
    status: Literal["active", "archived"] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "WarehouseUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class LocationCreate(APIModel):
    warehouse_id: str
    parent_id: str | None = None
    code: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=120)
    path: str | None = Field(default=None, max_length=256)
    barcode: str | None = Field(default=None, max_length=128)
    type: LocationType = "main"
    is_pickable: bool = True
    status: Literal["active", "blocked", "archived"] = "active"
    zone: str | None = Field(default=None, max_length=64)
    aisle: str | None = Field(default=None, max_length=64)
    rack: str | None = Field(default=None, max_length=64)
    shelf: str | None = Field(default=None, max_length=64)
    bin: str | None = Field(default=None, max_length=64)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.upper()

    @field_validator("name", "path", "barcode", "zone", "aisle", "rack", "shelf", "bin")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value or None


class LocationUpdate(APIModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=120)
    path: str | None = Field(default=None, max_length=256)
    barcode: str | None = Field(default=None, max_length=128)
    type: LocationType | None = None
    is_pickable: bool | None = None
    status: Literal["active", "blocked", "archived"] | None = None
    zone: str | None = Field(default=None, max_length=64)
    aisle: str | None = Field(default=None, max_length=64)
    rack: str | None = Field(default=None, max_length=64)
    shelf: str | None = Field(default=None, max_length=64)
    bin: str | None = Field(default=None, max_length=64)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator("path", "barcode", "zone", "aisle", "rack", "shelf", "bin")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def require_change(self) -> "LocationUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class BulkLocationGenerateRequest(APIModel):
    warehouse_id: str
    parent_id: str | None = None
    prefix: str | None = Field(default=None, max_length=16)
    aisle_start: int = Field(default=1, ge=1, le=99)
    aisle_end: int = Field(default=1, ge=1, le=99)
    rack_start: int = Field(default=1, ge=1, le=99)
    rack_end: int = Field(default=1, ge=1, le=99)
    shelf_start: int = Field(default=1, ge=1, le=99)
    shelf_end: int = Field(default=1, ge=1, le=99)
    bin_start: int = Field(default=1, ge=1, le=99)
    bin_end: int = Field(default=1, ge=1, le=99)
    separator: str = Field(default="-", max_length=4)
    zero_pad: int = Field(default=2, ge=1, le=4)
    type: LocationType = "bin"
    is_pickable: bool = True
    preview_only: bool = True

    @field_validator("prefix")
    @classmethod
    def normalize_prefix(cls, value: str | None) -> str | None:
        return value.strip().upper() if value and value.strip() else None


class BulkLocationPreviewItem(APIModel):
    code: str
    path: str
    aisle: str
    rack: str
    shelf: str
    bin: str
    is_duplicate: bool = False
    status: Literal["ready", "duplicate", "error"] = "ready"
    error: str | None = None


class BulkLocationGenerateResponse(APIModel):
    preview_only: bool
    total_generated: int
    new_count: int
    duplicate_count: int
    locations: list[BulkLocationPreviewItem]
    created_count: int = 0


class ReceiptLineCreate(APIModel):
    item_id: str
    qty: PositiveQuantity
    uom: str | None = Field(default=None, min_length=1, max_length=16)
    lot_id: str | None = None
    lot_no: str | None = Field(default=None, max_length=128)
    expiry_date: date | None = None
    serial_no: str | None = Field(default=None, max_length=128)
    serial_numbers: list[str] = Field(default_factory=list, max_length=500)
    discrepancy_reason: str | None = Field(default=None, max_length=500)

    @field_validator("uom")
    @classmethod
    def normalize_uom(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator("lot_id", "lot_no", "serial_no", "discrepancy_reason")
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        return value or None


class ReceiptCreate(APIModel):
    client_id: str | None = None
    supplier_id: str | None = None
    warehouse_id: str
    location_id: str
    supplier: str | None = Field(default=None, max_length=200)
    purchase_order: str | None = Field(default=None, max_length=120)
    purchase_order_id: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)
    delivery_note: str | None = Field(default=None, max_length=200)
    discrepancy_reason: str | None = Field(default=None, max_length=500)
    lines: list[ReceiptLineCreate] = Field(min_length=1, max_length=200)

    @field_validator(
        "supplier",
        "purchase_order",
        "purchase_order_id",
        "note",
        "delivery_note",
        "discrepancy_reason",
    )
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def supplier_for_purchase_order(self) -> "ReceiptCreate":
        if self.purchase_order and not self.supplier and not self.purchase_order_id:
            raise ValueError("supplier is required when purchase_order is provided")
        return self


class TokenResponse(APIModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(APIModel):
    id: str
    name: str
    email: str
    phone: str | None = None
    status: str


class UserUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def require_change(self) -> "UserUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class CompanyOut(APIModel):
    id: str
    name: str
    currency: str
    timezone: str
    status: str
    inventory_model: InventoryModel = "internal"
    allow_over_receipt: bool = False
    created_at: datetime
    updated_at: datetime


class PartnerAddress(APIModel):
    name: str | None = Field(default=None, max_length=100)
    type: Literal["shipping", "billing", "delivery", "pickup", "receiving", "returns", "operational"] = "shipping"
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=30)
    country: str = Field(default="IN", max_length=100)

    @field_validator("name", "line2", "state", "postal_code")
    @classmethod
    def clean_empty_strings(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None


class PartnerContact(APIModel):
    name: str = Field(min_length=1, max_length=120)
    department: str | None = Field(default=None, max_length=100)
    role: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=50)
    is_primary: bool = False

    @field_validator("name", "department", "role", "phone")
    @classmethod
    def clean_empty_strings(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None


class ClientCreate(APIModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    display_name: str | None = Field(default=None, max_length=200)
    types: list[Literal["supplier", "customer", "3pl_client"]] = Field(
        default_factory=lambda: ["3pl_client"]
    )
    contact_name: str | None = Field(default=None, max_length=200)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=50)
    contacts: list[PartnerContact] = Field(default_factory=list)
    tax_id: str | None = Field(default=None, max_length=30)
    billing_address: PartnerAddress | None = None
    addresses: list[PartnerAddress] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("name", "display_name", "contact_name", "contact_phone", "tax_id", "notes")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("types")
    @classmethod
    def validate_types(cls, value: list[str]) -> list[str]:
        cleaned = [t.strip().lower() for t in value if t and t.strip()]
        if not cleaned:
            raise ValueError("At least one partner type must be selected.")
        valid = {"supplier", "customer", "3pl_client"}
        for t in cleaned:
            if t not in valid:
                raise ValueError(f"Invalid partner type '{t}'. Must be one of: supplier, customer, 3pl_client.")
        return sorted(list(set(cleaned)))

    @field_validator("tax_id")
    @classmethod
    def validate_tax_id(cls, value: str | None) -> str | None:
        if not value:
            return None
        cleaned = value.strip().upper()
        if len(cleaned) == 15 and not re.match(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", cleaned):
            raise ValueError("Invalid 15-character GSTIN format. Example: 27AAPFU0939F1ZV")
        return cleaned


class ClientUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    display_name: str | None = Field(default=None, max_length=200)
    types: list[Literal["supplier", "customer", "3pl_client"]] | None = None
    contact_name: str | None = Field(default=None, max_length=200)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=50)
    contacts: list[PartnerContact] | None = None
    tax_id: str | None = Field(default=None, max_length=30)
    billing_address: PartnerAddress | None = None
    addresses: list[PartnerAddress] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    status: Literal["active", "archived"] | None = None

    @field_validator("name", "display_name", "contact_name", "contact_phone", "tax_id", "notes")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("types")
    @classmethod
    def validate_types(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [t.strip().lower() for t in value if t and t.strip()]
        if not cleaned:
            raise ValueError("At least one partner type must be selected.")
        valid = {"supplier", "customer", "3pl_client"}
        for t in cleaned:
            if t not in valid:
                raise ValueError(f"Invalid partner type '{t}'. Must be one of: supplier, customer, 3pl_client.")
        return sorted(list(set(cleaned)))

    @field_validator("tax_id")
    @classmethod
    def validate_tax_id(cls, value: str | None) -> str | None:
        if not value:
            return None
        cleaned = value.strip().upper()
        if len(cleaned) == 15 and not re.match(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", cleaned):
            raise ValueError("Invalid 15-character GSTIN format. Example: 27AAPFU0939F1ZV")
        return cleaned

    @model_validator(mode="after")
    def require_change(self) -> "ClientUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class ClientOut(APIModel):
    id: str
    company_id: str
    code: str
    name: str
    display_name: str | None = None
    types: list[str] = Field(default_factory=lambda: ["3pl_client"])
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    contacts: list[PartnerContact] = Field(default_factory=list)
    tax_id: str | None = None
    billing_address: PartnerAddress | None = None
    addresses: list[PartnerAddress] = Field(default_factory=list)
    notes: str | None = None
    is_internal: bool = False
    status: str
    created_at: datetime
    updated_at: datetime


class ClientListResponse(APIModel):
    clients: list[ClientOut]


class PartnerImportRow(APIModel):
    row_number: int
    code: str
    name: str
    display_name: str | None = None
    types: list[str] = Field(default_factory=lambda: ["supplier"])
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    contacts: list[PartnerContact] = Field(default_factory=list)
    tax_id: str | None = None
    billing_address: PartnerAddress | None = None
    addresses: list[PartnerAddress] = Field(default_factory=list)
    notes: str | None = None
    status: str = "valid"
    is_valid: bool = True
    is_duplicate: bool = False
    existing_partner_id: str | None = None
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PartnerImportPreviewResponse(APIModel):
    total_rows: int
    valid_count: int
    invalid_count: int
    duplicate_count: int
    warnings_count: int
    rows: list[PartnerImportRow]


class PartnerImportConfirmRequest(APIModel):
    rows: list[PartnerImportRow] = Field(min_length=1, max_length=500)
    duplicate_strategy: Literal["skip", "update"] = "skip"


class PartnerImportConfirmResponse(APIModel):
    created_count: int
    updated_count: int
    skipped_count: int
    failed_count: int
    errors: list[str] = Field(default_factory=list)


class MembershipOut(APIModel):
    id: str
    company_id: str
    user_id: str
    company_name: str | None = None
    role: Role
    location_ids: list[str] = Field(default_factory=list)
    client_ids: list[str] = Field(default_factory=list)
    status: str


class AuthResponse(TokenResponse):
    user: UserOut
    company: CompanyOut
    membership: MembershipOut


class SessionResponse(APIModel):
    user: UserOut
    company: CompanyOut
    membership: MembershipOut
    clients: list[ClientOut] = Field(default_factory=list)
    permissions: list[str]


class PermissionItemOut(APIModel):
    key: str
    label: str
    description: str


class PermissionCategoryOut(APIModel):
    category: str
    description: str
    permissions: list[PermissionItemOut]


class RoleDefinitionOut(APIModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    permissions: list[str] = Field(default_factory=list)
    is_custom: bool = False
    is_system: bool = False
    assigned_count: int = 0
    assigned_members_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CustomRoleCreate(APIModel):
    name: str = Field(min_length=2, max_length=64)
    slug: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    permissions: list[str] = Field(min_length=1)


class CustomRoleUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    permissions: list[str] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "CustomRoleUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class MemberOut(APIModel):
    id: str
    user_id: str
    name: str
    email: str
    phone: str | None = None
    role: str
    role_label: str
    is_custom_role: bool = False
    location_ids: list[str] = Field(default_factory=list)
    warehouse_ids: list[str] = Field(default_factory=list)
    client_ids: list[str] = Field(default_factory=list)
    status: str
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    department: str | None = None
    job_title: str | None = None
    employee_id: str | None = None
    created_at: datetime
    updated_at: datetime


class MemberListResponse(APIModel):
    members: list[MemberOut]
    total: int | None = None
    total_count: int | None = None


class MemberUpdate(APIModel):
    role: str | None = None
    status: Literal["active", "suspended", "inactive", "deactivated"] | None = None
    location_ids: list[str] | None = None
    warehouse_ids: list[str] | None = None
    client_ids: list[str] | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    department: str | None = None
    job_title: str | None = None
    employee_id: str | None = None

    @model_validator(mode="after")
    def require_change(self) -> "MemberUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class MemberSuspendRequest(APIModel):
    reason: str | None = Field(default=None, max_length=255)


class InvitationCreate(APIModel):
    email: EmailStr
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    role: str = "viewer"
    warehouse_ids: list[str] = Field(default_factory=list, max_length=100)
    location_ids: list[str] = Field(default_factory=list, max_length=500)
    client_ids: list[str] = Field(default_factory=list, max_length=500)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    department: str | None = Field(default=None, max_length=100)
    job_title: str | None = Field(default=None, max_length=100)
    employee_id: str | None = Field(default=None, max_length=64)


class InvitationBulkCreate(APIModel):
    emails: list[EmailStr] = Field(min_length=1, max_length=50)
    role: str = "viewer"
    warehouse_ids: list[str] = Field(default_factory=list, max_length=100)
    location_ids: list[str] = Field(default_factory=list, max_length=500)
    client_ids: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("emails")
    @classmethod
    def normalize_emails(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized: list[str] = []
        for email in value:
            lowered = str(email).strip().lower()
            if lowered not in seen:
                seen.add(lowered)
                normalized.append(lowered)
        return normalized


class InvitationOut(APIModel):
    id: str
    email: str
    name: str | None = None
    phone: str | None = None
    role: str
    role_label: str
    is_custom_role: bool = False
    warehouse_ids: list[str] = Field(default_factory=list)
    location_ids: list[str] = Field(default_factory=list)
    client_ids: list[str] = Field(default_factory=list)
    status: str
    invite_code: str | None = None
    email_delivery_status: Literal["pending", "sent", "delivered", "failed"] = "pending"
    email_delivery_error: str | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    department: str | None = None
    job_title: str | None = None
    employee_id: str | None = None
    expires_at: datetime
    created_at: datetime
    accepted_at: datetime | None = None
    revoked_at: datetime | None = None


class InvitationCreated(InvitationOut):
    invitation_token: str | None = None
    invite_code: str | None = None


class InvitationListResponse(APIModel):
    invitations: list[InvitationOut]


class InvitationBulkResult(APIModel):
    email: str
    status: Literal["created", "already_member", "pending_invitation", "failed"]
    message: str | None = None
    invitation: InvitationCreated | None = None


class InvitationBulkResponse(APIModel):
    results: list[InvitationBulkResult]
    total_count: int
    created_count: int
    skipped_count: int


class RecentActivityItem(APIModel):
    id: str
    action: str
    actor_id: str | None = None
    actor_name: str | None = None
    target_entity: str | None = None
    target_id: str | None = None
    created_at: datetime
    summary: str


class TeamOverviewResponse(APIModel):
    total_members: int = 0
    active_members: int = 0
    suspended_members: int = 0
    deactivated_members: int = 0
    pending_invitations: int = 0
    attention_invitations: int = 0
    warehouses_represented: int = 0
    custom_roles_count: int = 0
    active_members_count: int = 0
    suspended_members_count: int = 0
    pending_invitations_count: int = 0
    attention_invitations_count: int = 0
    warehouses_count: int = 0
    recent_activity: list[RecentActivityItem] = Field(default_factory=list)


class ExcelImportRowPreview(APIModel):
    row_number: int = 0
    name: str
    email: str
    role: str
    role_label: str | None = None
    warehouse_codes: list[str] = Field(default_factory=list)
    warehouse_names: list[str] = Field(default_factory=list)
    phone: str | None = None
    department: str | None = None
    job_title: str | None = None
    employee_id: str | None = None
    status: Literal["valid", "invalid", "duplicate_file", "already_member", "pending_invitation"] = "valid"
    is_valid: bool = True
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ExcelImportPreviewResponse(APIModel):
    total_rows: int
    valid_count: int
    invalid_count: int
    duplicate_count: int
    existing_member_count: int
    pending_invitation_count: int
    warnings_count: int = 0
    rows: list[ExcelImportRowPreview]
    # Aliases for frontend compatibility
    valid_rows: int | None = None
    invalid_rows: int | None = None
    duplicate_rows: int | None = None
    existing_members: int | None = None
    pending_invitations: int | None = None
    warnings: list[str] = Field(default_factory=list)

    def model_post_init(self, __context: Any) -> None:
        if self.valid_rows is None:
            self.valid_rows = self.valid_count
        if self.invalid_rows is None:
            self.invalid_rows = self.invalid_count
        if self.duplicate_rows is None:
            self.duplicate_rows = self.duplicate_count
        if self.existing_members is None:
            self.existing_members = self.existing_member_count
        if self.pending_invitations is None:
            self.pending_invitations = self.pending_invitation_count


class ExcelImportConfirmRow(APIModel):
    row_number: int = 0
    name: str
    email: EmailStr
    role: str = "viewer"
    warehouse_codes: list[str] = Field(default_factory=list)
    phone: str | None = None
    department: str | None = None
    job_title: str | None = None
    employee_id: str | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class ExcelImportConfirmRequest(APIModel):
    rows: list[ExcelImportConfirmRow] = Field(min_length=1, max_length=500)
    send_emails: bool = True


class ExcelImportResultItem(APIModel):
    email: str
    name: str
    status: Literal["created", "skipped", "failed"]
    row_number: int | None = None
    invitation_id: str | None = None
    invite_code: str | None = None
    message: str | None = None
    delivery_status: str | None = None
    email_delivery_status: str | None = None


class ExcelImportConfirmResponse(APIModel):
    total_processed: int
    created_count: int
    skipped_count: int
    failed_count: int
    results: list[ExcelImportResultItem]



class InvitationPreviewRequest(APIModel):
    invitation_token: str = Field(min_length=4, max_length=512)


class InvitationPreviewResponse(APIModel):
    company_name: str
    email: str
    role: Role
    role_label: str
    expires_at: datetime
    inviter_name: str | None = None
    name: str | None = None
    phone: str | None = None
    department: str | None = None
    job_title: str | None = None
    employee_id: str | None = None


class InvitationAcceptRequest(APIModel):
    invitation_token: str = Field(min_length=4, max_length=512)
    email: EmailStr
    name: str | None = Field(default=None, max_length=120)
    password: Password
    phone: str | None = Field(default=None, max_length=32)


class AuditEventOut(APIModel):
    id: str
    actor_id: str | None = None
    action: str
    entity: str
    entity_id: str
    reason: str | None = None
    before: dict[str, object] | None = None
    after: dict[str, object] | None = None
    created_at: datetime


class AuditEventListResponse(APIModel):
    events: list[AuditEventOut]


class ItemOut(APIModel):
    id: str
    company_id: str | None = None
    client_id: str | None = None
    sku: str
    name: str
    barcode: str | None = None
    description: str | None = None
    category: str | None = None
    item_type: str
    base_uom: str
    tracking_mode: str
    expiry_tracked: bool = False
    cost: Decimal | None = None
    reorder_point: Decimal | None = None
    status: str
    supplier_count: int = 0
    preferred_supplier_id: str | None = None
    preferred_supplier_name: str | None = None
    preferred_locations: list[ItemPreferredLocation] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ItemListResponse(APIModel):
    items: list[ItemOut]
    next_cursor: str | None = None


class ItemSupplierCreate(APIModel):
    supplier_id: str = Field(min_length=1, max_length=64)
    supplier_sku: str = Field(min_length=1, max_length=64)
    purchase_price: NonNegativeDecimal | None = None
    currency: Currency | None = None
    lead_time_days: int | None = Field(default=None, ge=0, le=3650)
    min_order_qty: PositiveQuantity | None = None
    is_preferred: bool = False
    status: Literal["active", "inactive"] = "active"

    @field_validator("supplier_sku")
    @classmethod
    def normalize_supplier_sku(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def preferred_requires_active(self) -> "ItemSupplierCreate":
        if self.is_preferred and self.status != "active":
            raise ValueError("An inactive supplier mapping cannot be preferred.")
        return self


class ItemSupplierUpdate(APIModel):
    supplier_sku: str | None = Field(default=None, min_length=1, max_length=64)
    purchase_price: NonNegativeDecimal | None = None
    currency: Currency | None = None
    lead_time_days: int | None = Field(default=None, ge=0, le=3650)
    min_order_qty: PositiveQuantity | None = None
    is_preferred: bool | None = None
    status: Literal["active", "inactive"] | None = None

    @field_validator("supplier_sku")
    @classmethod
    def normalize_supplier_sku(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else None

    @model_validator(mode="after")
    def require_change(self) -> "ItemSupplierUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required.")
        return self


class ItemSupplierOut(APIModel):
    id: str
    company_id: str
    item_id: str
    supplier_id: str
    supplier_name: str
    supplier_code: str | None = None
    supplier_status: str
    supplier_is_active: bool
    supplier_types: list[str] = Field(default_factory=list)
    supplier_sku: str
    purchase_price: Decimal | None = None
    currency: str
    lead_time_days: int | None = None
    min_order_qty: Decimal | None = None
    is_preferred: bool = False
    status: str
    created_at: datetime
    updated_at: datetime


class ItemSupplierListResponse(APIModel):
    item_id: str
    suppliers: list[ItemSupplierOut]


class SupplierItemOut(APIModel):
    mapping_id: str
    item_id: str
    item_sku: str
    item_name: str
    item_category: str | None = None
    item_base_uom: str
    item_status: str
    item_client_id: str | None = None
    supplier_sku: str
    purchase_price: Decimal | None = None
    currency: str
    lead_time_days: int | None = None
    min_order_qty: Decimal | None = None
    is_preferred: bool = False
    status: str
    last_delivery_at: datetime | None = None
    delivered_qty: Decimal = Decimal("0")
    delivery_count: int = 0
    last_receipt_id: str | None = None
    last_receipt_number: str | None = None
    created_at: datetime
    updated_at: datetime


class SupplierItemListResponse(APIModel):
    supplier_id: str
    items: list[SupplierItemOut]


class LotOut(APIModel):
    id: str
    company_id: str
    client_id: str | None = None
    item_id: str
    sku: str | None = None
    item_name: str | None = None
    lot_no: str
    expiry_date: date | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class LotListResponse(APIModel):
    lots: list[LotOut]
    next_cursor: str | None = None


class SerialOut(APIModel):
    id: str
    company_id: str
    client_id: str | None = None
    item_id: str
    sku: str | None = None
    item_name: str | None = None
    serial_no: str
    lot_id: str | None = None
    lot_no: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class SerialListResponse(APIModel):
    serials: list[SerialOut]
    next_cursor: str | None = None


class WarehouseOut(APIModel):
    id: str
    code: str | None = None
    name: str
    address: str | None = None
    warehouse_type: str | None = None
    warehouse_layout: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class WarehouseListResponse(APIModel):
    warehouses: list[WarehouseOut]


class LocationOut(APIModel):
    id: str
    warehouse_id: str
    parent_id: str | None = None
    code: str
    name: str | None = None
    path: str | None = None
    barcode: str | None = None
    type: str
    is_pickable: bool = True
    status: str
    zone: str | None = None
    aisle: str | None = None
    rack: str | None = None
    shelf: str | None = None
    bin: str | None = None
    capacity: Decimal | None = None
    preferred_items: list[dict[str, Any]] = Field(default_factory=list)
    actual_stock_qty: Decimal | None = None
    created_at: datetime
    updated_at: datetime


class LocationListResponse(APIModel):
    locations: list[LocationOut]


class ReceiptLineOut(APIModel):
    id: str
    item_id: str
    sku: str
    supplier_sku: str | None = None
    item_name: str
    qty: Decimal
    uom: str
    base_qty: Decimal
    base_uom: str
    location_id: str
    lot_id: str | None = None
    lot_no: str | None = None
    expiry_date: date | None = None
    serial_no: str | None = None
    serial_numbers: list[str] = Field(default_factory=list)
    discrepancy_reason: str | None = None
    purchase_order_line_id: str | None = None


class ReceiptOut(APIModel):
    id: str
    company_id: str | None = None
    client_id: str | None = None
    number: str
    status: str
    warehouse_id: str
    location_id: str
    supplier_id: str | None = None
    supplier: str | None = None
    purchase_order: str | None = None
    purchase_order_id: str | None = None
    note: str | None = None
    delivery_note: str | None = None
    discrepancy_reason: str | None = None
    putaway_required: bool = False
    putaway_completed_at: datetime | None = None
    lines: list[ReceiptLineOut]
    created_at: datetime
    updated_at: datetime
    committed_at: datetime | None = None


class ReceiptListResponse(APIModel):
    receipts: list[ReceiptOut]
    next_cursor: str | None = None


class PutawayPlacementOut(APIModel):
    location_id: str
    location_code: str
    quantity: Decimal
    moved_at: datetime
    moved_by: str | None = None


class PutawayTaskOut(APIModel):
    id: str
    company_id: str
    client_id: str | None = None
    receipt_id: str
    receipt_number: str
    line_id: str
    warehouse_id: str
    item_id: str
    sku: str
    item_name: str
    qty: Decimal
    uom: str
    base_qty: Decimal
    base_uom: str
    lot_id: str | None = None
    lot_no: str | None = None
    expiry_date: date | None = None
    serial_id: str | None = None
    serial_no: str | None = None
    tracking_mode: str = "none"
    supplier_id: str | None = None
    supplier_name: str | None = None
    purchase_order_id: str | None = None
    purchase_order: str | None = None
    from_location_id: str
    from_location_code: str
    to_location_id: str | None = None
    to_location_code: str | None = None
    suggested_location_id: str | None = None
    suggested_location_code: str | None = None
    completed_qty: Decimal = Decimal("0")
    remaining_qty: Decimal
    placements: list[PutawayPlacementOut] = Field(default_factory=list)
    status: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    completed_by: str | None = None


class PutawayTaskListResponse(APIModel):
    tasks: list[PutawayTaskOut]
    next_cursor: str | None = None


class PutawayCompleteRequest(APIModel):
    location_id: str = Field(min_length=1, max_length=64)
    quantity: PositiveQuantity | None = None
    serial_ids: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("serial_ids")
    @classmethod
    def unique_serial_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Serial numbers must be unique.")
        return value


class BalanceOut(APIModel):
    id: str
    company_id: str | None = None
    client_id: str | None = None
    item_id: str
    sku: str | None = None
    item_name: str | None = None
    warehouse_id: str
    location_id: str
    lot_id: str | None = None
    lot_no: str | None = None
    serial_id: str | None = None
    serial_no: str | None = None
    expiry_date: date | None = None
    stock_status: str
    on_hand: Decimal
    reserved: Decimal
    blocked: Decimal
    available: Decimal
    version: int
    updated_at: datetime


class BalanceListResponse(APIModel):
    balances: list[BalanceOut]
    next_cursor: str | None = None


class AvailabilityOut(APIModel):
    item_id: str
    on_hand: Decimal
    reserved: Decimal
    blocked: Decimal
    available: Decimal


class ReorderSupplierOption(APIModel):
    supplier_id: str
    supplier_name: str
    supplier_sku: str | None = None
    is_preferred: bool = False
    purchase_price: Decimal | None = None
    currency: str | None = None
    lead_time_days: int | None = None
    min_order_qty: Decimal | None = None


class ReorderNeedRow(APIModel):
    item_id: str
    sku: str
    item_name: str
    client_id: str | None = None
    warehouse_id: str | None = None
    warehouse_name: str | None = None
    base_uom: str
    on_hand: Decimal
    reserved: Decimal
    blocked: Decimal
    available: Decimal
    incoming_qty: Decimal
    incoming_source: Literal["purchase_order", "unsupported"]
    projected_stock: Decimal
    reorder_point: Decimal
    target_stock: Decimal
    target_stock_source: Literal["item", "fallback"]
    suggested_qty: Decimal
    urgency: Literal["stockout", "critical", "low"]
    preferred_supplier_id: str | None = None
    preferred_supplier_name: str | None = None
    needs_supplier_assignment: bool = True
    supplier_options: list[ReorderSupplierOption] = Field(default_factory=list)


class ReorderNeededResponse(APIModel):
    generated_at: datetime
    rows: list[ReorderNeedRow]
    assumptions: list[str]


class PurchaseOrderLineCreate(APIModel):
    item_id: str = Field(min_length=1, max_length=64)
    qty: PositiveQuantity


class PurchaseOrderCreate(APIModel):
    client_id: str | None = None
    supplier_id: str = Field(min_length=1, max_length=64)
    warehouse_id: str = Field(min_length=1, max_length=64)
    expected_date: date | None = None
    note: str | None = Field(default=None, max_length=2000)
    lines: list[PurchaseOrderLineCreate] = Field(min_length=1, max_length=200)

    @field_validator("note")
    @classmethod
    def empty_note_to_none(cls, value: str | None) -> str | None:
        return value or None


class PurchaseOrderLineOut(APIModel):
    id: str
    item_id: str
    sku: str
    supplier_sku: str | None = None
    item_name: str
    uom: str
    base_uom: str
    ordered_qty: Decimal
    received_qty: Decimal
    remaining_qty: Decimal


class PurchaseOrderOut(APIModel):
    id: str
    company_id: str
    client_id: str | None = None
    number: str
    status: Literal["open", "partially_received", "received", "cancelled"]
    warehouse_id: str
    supplier_id: str
    supplier_name: str
    expected_date: date | None = None
    note: str | None = None
    line_count: int
    ordered_qty: Decimal
    received_qty: Decimal
    remaining_qty: Decimal
    lines: list[PurchaseOrderLineOut]
    created_at: datetime
    updated_at: datetime
    received_at: datetime | None = None
    cancelled_at: datetime | None = None


class PurchaseOrderListResponse(APIModel):
    orders: list[PurchaseOrderOut]
    next_cursor: str | None = None


class MovementOut(APIModel):
    id: str
    company_id: str | None = None
    client_id: str | None = None
    type: str
    item_id: str
    sku: str | None = None
    item_name: str | None = None
    quantity_delta: Decimal
    uom: str
    base_qty: Decimal
    from_location_id: str | None = None
    to_location_id: str | None = None
    lot_id: str | None = None
    lot_no: str | None = None
    serial_id: str | None = None
    serial_no: str | None = None
    expiry_date: date | None = None
    stock_status: str
    source_type: str
    source_id: str
    source_number: str
    actor_id: str
    device_id: str | None = None
    occurred_at: datetime
    recorded_at: datetime
    reason: str | None = None
    reversal_of: str | None = None
    idempotency_key: str


class MovementListResponse(APIModel):
    movements: list[MovementOut]
    next_cursor: str | None = None


class DashboardWindowOut(APIModel):
    inbound_units: Decimal
    outbound_units: Decimal
    net_units: Decimal
    movement_count: int


class DashboardReceivingQueueOut(APIModel):
    draft_count: int
    draft_units: Decimal
    oldest_draft_at: datetime | None = None


class DashboardSummaryOut(APIModel):
    as_of: datetime
    timezone: str
    today: DashboardWindowOut
    last_7_days: DashboardWindowOut
    receiving_queue: DashboardReceivingQueueOut


class SyncOperation(APIModel):
    operation_id: str = Field(min_length=8, max_length=200)
    type: str = Field(min_length=1, max_length=80)
    client_id: str | None = None
    entity_id: str | None = None
    occurred_at: datetime | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncPushRequest(APIModel):
    device_id: str | None = Field(default=None, max_length=200)
    operations: list[SyncOperation] = Field(min_length=1, max_length=100)


class SyncOperationResult(APIModel):
    operation_id: str
    status: Literal["applied", "duplicate", "rejected"]
    event_sequence: int | None = None
    error_code: str | None = None
    message: str | None = None


class SyncPushResponse(APIModel):
    results: list[SyncOperationResult]
    latest_sequence: int
    server_time: datetime


class SyncEventOut(APIModel):
    sequence: int
    entity_type: str
    entity_id: str
    action: str
    client_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime


class SyncPullResponse(APIModel):
    events: list[SyncEventOut]
    next_cursor: int
    latest_sequence: int
    has_more: bool


class ScanResolveResponse(APIModel):
    type: Literal["item", "location", "lot", "serial"]
    code: str
    item: ItemOut | None = None
    location: LocationOut | None = None
    lot: LotOut | None = None
    serial: SerialOut | None = None


class HealthResponse(APIModel):
    status: str
    app: str
    version: str


class OutboundLineCreate(APIModel):
    item_id: str = Field(min_length=1, max_length=64)
    qty: PositiveQuantity


class OutboundOrderCreate(APIModel):
    client_id: str | None = None
    customer_id: str | None = None
    warehouse_id: str = Field(min_length=1, max_length=64)
    customer_name: str = Field(min_length=1, max_length=200)
    customer_reference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=2000)
    lines: list[OutboundLineCreate] = Field(min_length=1, max_length=100)

    @field_validator("customer_reference", "note")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value or None


class OutboundLineOut(APIModel):
    id: str
    item_id: str
    sku: str
    item_name: str
    qty: Decimal
    uom: str
    base_qty: Decimal
    base_uom: str


class OutboundAllocationOut(APIModel):
    id: str
    line_id: str
    item_id: str
    sku: str
    item_name: str
    location_id: str
    location_code: str
    lot_id: str | None = None
    lot_no: str | None = None
    expiry_date: date | None = None
    serial_id: str | None = None
    serial_no: str | None = None
    qty: Decimal
    base_qty: Decimal
    base_uom: str
    status: str
    picked_at: datetime | None = None
    picked_by: str | None = None


class OutboundOrderOut(APIModel):
    id: str
    company_id: str
    client_id: str | None = None
    number: str
    status: str
    warehouse_id: str
    customer_name: str
    customer_reference: str | None = None
    note: str | None = None
    lines: list[OutboundLineOut]
    allocations: list[OutboundAllocationOut]
    created_at: datetime
    updated_at: datetime
    allocated_at: datetime | None = None
    shipped_at: datetime | None = None
    cancelled_at: datetime | None = None


class OutboundOrderListResponse(APIModel):
    orders: list[OutboundOrderOut]
    next_cursor: str | None = None


class TransferLineCreate(APIModel):
    item_id: str
    qty: PositiveQuantity
    uom: str | None = Field(default=None, max_length=16)
    lot_id: str | None = None
    lot_no: str | None = None
    expiry_date: date | None = None
    serial_numbers: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("lot_no")
    @classmethod
    def normalize_lot(cls, value: str | None) -> str | None:
        return value.strip().upper() if value and value.strip() else None


class TransferCreate(APIModel):
    client_id: str | None = None
    from_warehouse_id: str
    from_location_id: str
    to_warehouse_id: str
    to_location_id: str
    note: str | None = Field(default=None, max_length=500)
    reason: str | None = Field(default=None, max_length=200)
    lines: list[TransferLineCreate] = Field(min_length=1, max_length=100)

    @field_validator("note", "reason")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value or None


class TransferLineOut(APIModel):
    id: str
    item_id: str
    sku: str
    item_name: str
    qty: Decimal
    uom: str
    base_qty: Decimal
    base_uom: str
    lot_id: str | None = None
    lot_no: str | None = None
    expiry_date: date | None = None
    serial_id: str | None = None
    serial_no: str | None = None
    serial_numbers: list[str] = Field(default_factory=list)


class TransferOut(APIModel):
    id: str
    company_id: str
    client_id: str | None = None
    number: str
    status: str
    transfer_type: str
    from_warehouse_id: str
    from_location_id: str
    to_warehouse_id: str
    to_location_id: str
    note: str | None = None
    reason: str | None = None
    lines: list[TransferLineOut]
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime
    dispatched_at: datetime | None = None
    dispatched_by: str | None = None
    completed_at: datetime | None = None
    completed_by: str | None = None
    cancelled_at: datetime | None = None
    cancelled_by: str | None = None


class TransferListResponse(APIModel):
    transfers: list[TransferOut]
    next_cursor: str | None = None


class ChecklistItemResult(APIModel):
    category: str
    item: str
    status: Literal["passed", "failed", "na"] = "passed"
    measurement: str | None = None
    notes: str | None = None


class InspectionSubmitRequest(APIModel):
    receipt_id: str
    line_id: str
    item_id: str
    passed_qty: NonNegativeDecimal
    rejected_qty: NonNegativeDecimal = Decimal("0")
    on_hold_qty: NonNegativeDecimal = Decimal("0")
    destination_location_id: str | None = None
    quarantine_location_id: str | None = None
    checklist: list[ChecklistItemResult] = Field(default_factory=list)
    defect_photos: list[str] = Field(default_factory=list)
    notes: str | None = None


class InspectionQueueItemOut(APIModel):
    id: str
    receipt_id: str
    receipt_number: str
    line_id: str
    supplier_id: str | None = None
    supplier: str | None = None
    purchase_order_id: str | None = None
    purchase_order: str | None = None
    item_id: str
    sku: str
    product_name: str
    warehouse_id: str
    warehouse_name: str | None = None
    received_quantity: Decimal
    pending_quantity: Decimal
    passed_quantity: Decimal = Decimal("0")
    rejected_quantity: Decimal = Decimal("0")
    on_hold_quantity: Decimal = Decimal("0")
    inspection_status: Literal["pending", "in_progress", "passed", "rejected", "on_hold", "partially_passed"] = "pending"
    receipt_date: datetime
    suggested_location_id: str | None = None
    suggested_location_code: str | None = None


class InspectionRecordOut(APIModel):
    id: str
    receipt_id: str
    receipt_number: str
    line_id: str
    item_id: str
    sku: str
    product_name: str
    warehouse_id: str
    passed_qty: Decimal
    rejected_qty: Decimal
    on_hold_qty: Decimal
    status: str
    checklist: list[ChecklistItemResult]
    defect_photos: list[str] = Field(default_factory=list)
    notes: str | None = None
    inspector_id: str
    inspector_name: str | None = None
    created_at: datetime


