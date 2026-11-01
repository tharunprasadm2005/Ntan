import csv
import io
import re
from datetime import date, datetime
from typing import Any

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from ..permissions import ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS


def sanitize_formula_injection(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return value
    trimmed = value.strip()
    if trimmed and trimmed[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + trimmed
    return trimmed


def generate_excel_template(
    company_name: str,
    available_roles: list[dict[str, Any]],
    available_warehouses: list[dict[str, Any]],
) -> bytes:
    wb = openpyxl.Workbook()

    # Sheet 1: Import Template
    ws = wb.active
    ws.title = "Team Import"
    ws.views.sheetView[0].showGridLines = True

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    headers = [
        "Full Name *",
        "Email *",
        "Role *",
        "Warehouse Codes",
        "Phone Number",
        "Employee ID",
        "Job Title",
        "Department",
        "Access Start (YYYY-MM-DD)",
        "Access End (YYYY-MM-DD)",
    ]

    for col_idx, text in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=text)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        ws.row_dimensions[1].height = 28

    sample_wh = available_warehouses[0]["code"] if available_warehouses else "WH-01"
    sample_rows = [
        [
            "Alexander Morgan",
            "alex.morgan@example.com",
            "warehouse_supervisor",
            sample_wh,
            "+91 98765 43210",
            "EMP-101",
            "Shift Supervisor",
            "Warehouse Operations",
            "",
            "",
        ],
        [
            "Sarah Jenkins",
            "sarah.jenkins@example.com",
            "picker_packer",
            sample_wh,
            "+91 98765 43211",
            "EMP-102",
            "Order Fulfillment Specialist",
            "Fulfillment & Dispatch",
            date.today().isoformat(),
            date(date.today().year + 1, 12, 31).isoformat(),
        ],
    ]

    row_font = Font(name="Calibri", size=10)
    for r_idx, row_data in enumerate(sample_rows, start=2):
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = row_font
            cell.alignment = left_align
            cell.border = thin_border
        ws.row_dimensions[r_idx].height = 20

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 16)

    # Sheet 2: Reference Guide
    ws_ref = wb.create_sheet(title="Reference Guide")
    ws_ref.views.sheetView[0].showGridLines = True

    title_font = Font(name="Calibri", size=14, bold=True, color="0F172A")
    sub_font = Font(name="Calibri", size=11, bold=True, color="1E293B")
    sec_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    ws_ref.cell(row=1, column=1, value=f"{company_name} — Team Import Reference").font = title_font
    ws_ref.cell(row=2, column=1, value="Use the exact identifiers listed below when filling in the template.").font = row_font

    ws_ref.cell(row=4, column=1, value="Valid Role Slugs").font = sub_font
    ws_ref.cell(row=4, column=2, value="Role Name").font = sub_font
    ws_ref.cell(row=4, column=3, value="Description").font = sub_font
    for c in range(1, 4):
        ws_ref.cell(row=4, column=c).fill = sec_fill
        ws_ref.cell(row=4, column=c).border = thin_border

    curr_row = 5
    for r in available_roles:
        ws_ref.cell(row=curr_row, column=1, value=r["slug"]).border = thin_border
        ws_ref.cell(row=curr_row, column=2, value=r["name"]).border = thin_border
        ws_ref.cell(row=curr_row, column=3, value=r.get("description") or "").border = thin_border
        curr_row += 1

    curr_row += 2
    ws_ref.cell(row=curr_row, column=1, value="Warehouse Code").font = sub_font
    ws_ref.cell(row=curr_row, column=2, value="Facility Name").font = sub_font
    ws_ref.cell(row=curr_row, column=3, value="Physical Address").font = sub_font
    for c in range(1, 4):
        ws_ref.cell(row=curr_row, column=c).fill = sec_fill
        ws_ref.cell(row=curr_row, column=c).border = thin_border
    curr_row += 1

    if available_warehouses:
        for wh in available_warehouses:
            ws_ref.cell(row=curr_row, column=1, value=wh.get("code") or "WH-01").border = thin_border
            ws_ref.cell(row=curr_row, column=2, value=wh["name"]).border = thin_border
            ws_ref.cell(row=curr_row, column=3, value=wh.get("address") or "").border = thin_border
            curr_row += 1
    else:
        ws_ref.cell(row=curr_row, column=1, value="WH-01").border = thin_border
        ws_ref.cell(row=curr_row, column=2, value="Primary Facility").border = thin_border
        curr_row += 1

    curr_row += 2
    ws_ref.cell(row=curr_row, column=1, value="Multi-Warehouse Assignment Note:").font = sub_font
    ws_ref.cell(
        row=curr_row + 1,
        column=1,
        value="To assign an employee to multiple warehouses, separate codes with a semicolon (;). Example: WH-01; CHN-01",
    ).font = row_font

    for col in ws_ref.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_ref.column_dimensions[col_letter].width = max(max_len + 4, 18)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def parse_import_file(arg1: Any, arg2: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if isinstance(arg1, (bytes, bytearray)):
        content = bytes(arg1)
        filename = str(arg2)
    else:
        filename = str(arg1)
        content = bytes(arg2)

    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    lower_filename = filename.lower()

    try:
        if lower_filename.endswith(".csv"):
            text = content.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            header_row = next(reader, None)
            if not header_row:
                return [], ["Spreadsheet has no header row."]
            norm_headers = [_normalize_header(h) for h in header_row]
            for row_num, row_cells in enumerate(reader, start=2):
                if not any(c.strip() for c in row_cells):
                    continue
                item = _map_row_dict(norm_headers, row_cells, row_num)
                rows.append(item)
        else:
            # Default to .xlsx
            wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
            ws = wb.active
            header_row = None
            for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                if r_idx == 1:
                    header_row = [_normalize_header(str(c or "")) for c in row]
                    continue
                if not header_row or not any(row):
                    continue
                cells = [str(c).strip() if c is not None else "" for c in row]
                if not any(cells):
                    continue
                item = _map_row_dict(header_row, cells, r_idx)
                rows.append(item)
    except Exception as exc:
        return [], [f"Failed to parse spreadsheet file: {exc}"]

    if len(rows) > 500:
        errors.append("Spreadsheet exceeds the maximum limit of 500 rows per import job.")
    return rows, errors


def _normalize_header(val: str) -> str:
    cleaned = re.sub(r"[\*\(\)\-\_]", " ", val).strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if "full name" in cleaned or "name" in cleaned:
        return "name"
    if "email" in cleaned:
        return "email"
    if "role" in cleaned:
        return "role"
    if "warehouse" in cleaned or "facility" in cleaned:
        return "warehouses"
    if "phone" in cleaned or "mobile" in cleaned:
        return "phone"
    if "emp" in cleaned or "badge" in cleaned:
        return "employee_id"
    if "title" in cleaned or "designation" in cleaned:
        return "job_title"
    if "dept" in cleaned or "department" in cleaned:
        return "department"
    if "start" in cleaned or "from" in cleaned:
        return "valid_from"
    if "end" in cleaned or "until" in cleaned or "expiry" in cleaned:
        return "valid_until"
    return cleaned


def _map_row_dict(headers: list[str], cells: list[str], row_number: int) -> dict[str, Any]:
    mapped: dict[str, Any] = {"row_number": row_number, "row_index": row_number}
    for idx, header in enumerate(headers):
        if idx < len(cells):
            raw = cells[idx]
            clean = sanitize_formula_injection(raw)
            mapped[header] = clean if clean is not None else ""

    # Normalize warehouse codes
    wh_raw = mapped.get("warehouses", "")
    wh_codes = [c.strip().upper() for c in re.split(r"[;,/]", wh_raw) if c.strip()]
    mapped["warehouse_codes"] = wh_codes
    return mapped


sanitize_for_spreadsheet = sanitize_formula_injection


def create_excel_template(
    company_name: str = "NTAN Inventory",
    warehouses: list[Any] | None = None,
    custom_roles: list[Any] | None = None,
) -> bytes:
    roles_list = []
    for slug, label in ROLE_LABELS.items():
        roles_list.append({"slug": slug, "name": label, "description": ROLE_DESCRIPTIONS.get(slug, "")})
    if custom_roles:
        for r in custom_roles:
            if isinstance(r, (tuple, list)):
                roles_list.append({"slug": r[0], "name": r[1], "description": "Custom Organization Role"})
            elif isinstance(r, dict):
                roles_list.append(r)
    wh_list = []
    if warehouses:
        for w in warehouses:
            if isinstance(w, (tuple, list)):
                wh_list.append({"code": w[0], "name": w[1]})
            elif isinstance(w, dict):
                wh_list.append(w)
    return generate_excel_template(company_name, roles_list, wh_list)


def generate_partner_excel_template(
    company_name: str = "NTAN Inventory",
    inventory_model: str = "internal",
) -> bytes:
    wb = openpyxl.Workbook()

    # Sheet 1: Partners Import Template
    ws = wb.active
    ws.title = "Partners Import"
    ws.views.sheetView[0].showGridLines = True

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    headers = [
        "Partner Code *",
        "Legal / Business Name *",
        "Display Name",
        "Relationship Types * (supplier; customer; 3pl_client)",
        "Contact Person",
        "Contact Email",
        "Contact Phone",
        "GSTIN / Tax ID",
        "Billing Address Line 1",
        "Billing Address Line 2",
        "Billing City",
        "Billing State",
        "Billing Postal Code",
        "Billing Country",
        "Shipping Address Line 1",
        "Shipping City",
        "Notes",
    ]

    for col_idx, text in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=text)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        ws.row_dimensions[1].height = 28

    sample_rows = [
        [
            "SUP-001",
            "Apex Industrial Supplies Pvt Ltd",
            "Apex Supplies",
            "supplier",
            "Rajesh Kumar",
            "rajesh@apexsupplies.com",
            "+91 98765 43210",
            "27AAPFU0939F1ZV",
            "Plot 42, MIDC Industrial Area",
            "Andheri East",
            "Mumbai",
            "Maharashtra",
            "400093",
            "India",
            "Plot 42, MIDC Receiving Gate",
            "Mumbai",
            "Primary raw materials and packaging vendor",
        ],
        [
            "CUST-101",
            "Metro Retail Distributorship",
            "Metro Retail",
            "customer",
            "Anita Sharma",
            "orders@metroretail.com",
            "+91 98765 43211",
            "27BAPFU0939F1ZW",
            "12 Linking Road",
            "Bandra West",
            "Mumbai",
            "Maharashtra",
            "400050",
            "India",
            "Central Logistics Hub Dock 4",
            "Mumbai",
            "High-priority dispatch customer",
        ],
        [
            "PART-201",
            "Global Trading & Logistics",
            "Global Trade",
            "supplier; customer",
            "Vikram Singh",
            "vikram@globaltrade.in",
            "+91 98765 43212",
            "",
            "88 Industrial Bypass",
            "",
            "Pune",
            "Maharashtra",
            "411018",
            "India",
            "",
            "",
            "Dual role partner: raw material vendor and finished goods buyer",
        ],
    ]

    row_font = Font(name="Calibri", size=10)
    for r_idx, row_data in enumerate(sample_rows, start=2):
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = row_font
            cell.alignment = left_align
            cell.border = thin_border
        ws.row_dimensions[r_idx].height = 20

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 16)

    # Sheet 2: Reference Guide
    ws_ref = wb.create_sheet(title="Reference Guide")
    ws_ref.views.sheetView[0].showGridLines = True

    title_font = Font(name="Calibri", size=14, bold=True, color="0F172A")
    sub_font = Font(name="Calibri", size=11, bold=True, color="1E293B")
    sec_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    ws_ref.cell(row=1, column=1, value=f"{company_name} — Business Partners Import Reference").font = title_font
    ws_ref.cell(row=2, column=1, value="Review the valid relationship types and formatting requirements before uploading.").font = row_font

    ws_ref.cell(row=4, column=1, value="Relationship Type").font = sub_font
    ws_ref.cell(row=4, column=2, value="Role").font = sub_font
    ws_ref.cell(row=4, column=3, value="Description & Restrictions").font = sub_font
    for c in range(1, 4):
        ws_ref.cell(row=4, column=c).fill = sec_fill
        ws_ref.cell(row=4, column=c).border = thin_border

    roles_data = [
        ("supplier", "Supplier / Vendor", "Partner where we purchase or receive goods into warehouse (Inbound receipts). Allowed in all inventory modes."),
        ("customer", "Customer / Buyer", "Partner who receives or purchases products dispatched from our warehouse (Outbound orders). Allowed in all inventory modes."),
        ("3pl_client", "3PL Stock Owner", "Third-party company whose inventory is stored and segregated in our facility. Requires Hybrid or 3PL inventory mode."),
    ]
    for idx, (code_val, name_val, desc_val) in enumerate(roles_data, start=5):
        ws_ref.cell(row=idx, column=1, value=code_val).border = thin_border
        ws_ref.cell(row=idx, column=2, value=name_val).border = thin_border
        ws_ref.cell(row=idx, column=3, value=desc_val).border = thin_border

    ws_ref.cell(row=9, column=1, value="Multi-Role Partners:").font = sub_font
    ws_ref.cell(
        row=10,
        column=1,
        value="A partner can have multiple roles (e.g. both a supplier and customer). Separate types with a semicolon (;). Example: supplier; customer",
    ).font = row_font

    ws_ref.cell(row=12, column=1, value="GSTIN / Tax ID Format:").font = sub_font
    ws_ref.cell(
        row=13,
        column=1,
        value="Indian GSTIN must be 15 characters (e.g., 27AAPFU0939F1ZV). Leave blank if non-registered or international.",
    ).font = row_font

    for col in ws_ref.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_ref.column_dimensions[col_letter].width = max(max_len + 4, 18)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def parse_partner_import_file(
    filename: str,
    content: bytes,
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    lower_filename = filename.lower()

    try:
        if lower_filename.endswith(".csv"):
            text = content.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            header_row = next(reader, None)
            if not header_row:
                return [], ["Spreadsheet has no header row."]
            norm_headers = [_normalize_partner_header(h) for h in header_row]
            for row_num, row_cells in enumerate(reader, start=2):
                if not any(c.strip() for c in row_cells):
                    continue
                item = _map_partner_row_dict(norm_headers, row_cells, row_num)
                rows.append(item)
        else:
            wb = openpyxl.load_workbook(io.BytesIO(content), data_only=False, read_only=True)
            ws = wb.active
            header_row = None
            for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                if r_idx == 1:
                    header_row = [_normalize_partner_header(str(c or "")) for c in row]
                    continue
                if not header_row or not any(row):
                    continue
                cells = [str(c).strip() if c is not None else "" for c in row]
                if not any(cells):
                    continue
                item = _map_partner_row_dict(header_row, cells, r_idx)
                rows.append(item)
    except Exception as exc:
        return [], [f"Failed to parse spreadsheet file: {exc}"]

    if len(rows) > 500:
        errors.append("Spreadsheet exceeds the maximum limit of 500 rows per import job.")
    return rows, errors


def _normalize_partner_header(val: str) -> str:
    cleaned = re.sub(r"[\*\(\)\-\_]", " ", val).strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if "postal" in cleaned or "pincode" in cleaned or "zip" in cleaned:
        return "billing_postal_code"
    if "partner code" in cleaned or "code" in cleaned:
        return "code"
    if "display" in cleaned:
        return "display_name"
    if "legal" in cleaned or "business name" in cleaned or "company" in cleaned or "name" in cleaned:
        return "name"
    if "type" in cleaned or "relationship" in cleaned or "role" in cleaned:
        return "types"
    if "contact person" in cleaned or "contact name" in cleaned or "contact" in cleaned:
        return "contact_name"
    if "email" in cleaned:
        return "contact_email"
    if "phone" in cleaned or "mobile" in cleaned:
        return "contact_phone"
    if "gstin" in cleaned or "tax" in cleaned or "gst" in cleaned or "vat" in cleaned:
        return "tax_id"
    if "billing address line 1" in cleaned or "billing line 1" in cleaned:
        return "billing_line1"
    if "billing address line 2" in cleaned or "billing line 2" in cleaned:
        return "billing_line2"
    if "shipping city" in cleaned:
        return "shipping_city"
    if "billing city" in cleaned or ("city" in cleaned and "shipping" not in cleaned):
        return "billing_city"
    if "billing state" in cleaned or ("state" in cleaned and "shipping" not in cleaned):
        return "billing_state"
    if "billing country" in cleaned or "country" in cleaned:
        return "billing_country"
    if "shipping address line 1" in cleaned or "shipping line 1" in cleaned or "shipping" in cleaned:
        return "shipping_line1"
    if "note" in cleaned:
        return "notes"
    return cleaned


def _map_partner_row_dict(headers: list[str], cells: list[str], row_number: int) -> dict[str, Any]:
    mapped: dict[str, Any] = {"row_number": row_number, "row_index": row_number}
    for idx, header in enumerate(headers):
        if idx < len(cells):
            raw = cells[idx]
            clean = sanitize_formula_injection(raw)
            mapped[header] = clean if clean is not None else ""

    # Parse types
    raw_types = mapped.get("types", "")
    types_list = [t.strip().lower() for t in re.split(r"[;,/]", raw_types) if t.strip()]
    if not types_list:
        types_list = ["supplier"]
    mapped["parsed_types"] = types_list
    return mapped


def export_partners_excel(
    company_name: str,
    partners: list[dict[str, Any]],
) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Business Partners"
    ws.views.sheetView[0].showGridLines = True

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    headers = [
        "Partner Code",
        "Legal Name",
        "Display Name",
        "Relationship Types",
        "Contact Person",
        "Contact Email",
        "Contact Phone",
        "GSTIN / Tax ID",
        "Billing Address",
        "Shipping Address",
        "Notes",
        "Status",
    ]

    for col_idx, text in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=text)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        ws.row_dimensions[1].height = 28

    row_font = Font(name="Calibri", size=10)
    for r_idx, p in enumerate(partners, start=2):
        billing = p.get("billing_address") or {}
        b_str = ", ".join(filter(None, [
            billing.get("line1"),
            billing.get("city"),
            billing.get("state"),
            billing.get("postal_code"),
        ])) if isinstance(billing, dict) else ""

        shipping_list = p.get("addresses") or []
        s_str = ""
        if shipping_list and isinstance(shipping_list[0], dict):
            s_first = shipping_list[0]
            s_str = ", ".join(filter(None, [s_first.get("line1"), s_first.get("city")]))

        types_str = ", ".join(p.get("types") or ["3pl_client"])
        row_vals = [
            sanitize_formula_injection(p.get("code")),
            sanitize_formula_injection(p.get("name")),
            sanitize_formula_injection(p.get("display_name") or ""),
            types_str,
            sanitize_formula_injection(p.get("contact_name") or ""),
            sanitize_formula_injection(p.get("contact_email") or ""),
            sanitize_formula_injection(p.get("contact_phone") or ""),
            sanitize_formula_injection(p.get("tax_id") or ""),
            sanitize_formula_injection(b_str),
            sanitize_formula_injection(s_str),
            sanitize_formula_injection(p.get("notes") or ""),
            p.get("status", "active"),
        ]

        for c_idx, val in enumerate(row_vals, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = row_font
            cell.alignment = left_align
            cell.border = thin_border
        ws.row_dimensions[r_idx].height = 20

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 16)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()

