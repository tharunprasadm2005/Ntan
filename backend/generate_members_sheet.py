import os
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

def generate_members_spreadsheet():
    wb = openpyxl.Workbook()

    # -------------------------------------------------------------
    # Sheet 1: Team Import
    # -------------------------------------------------------------
    ws = wb.active
    ws.title = "Team Import"
    ws.views.sheetView[0].showGridLines = True

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

    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    # Realistic sample members across standard roles
    rows = [
        [
            "Marcus Vance",
            "marcus.vance@example.com",
            "warehouse_manager",
            "MAIN",
            "+1 555-0101",
            "EMP-0101",
            "Warehouse Operations Lead",
            "Logistics",
            "",
            "",
        ],
        [
            "Elena Rostova",
            "elena.rostova@example.com",
            "warehouse_supervisor",
            "MAIN",
            "+1 555-0102",
            "EMP-0102",
            "Floor Supervisor",
            "Operations",
            "",
            "",
        ],
        [
            "Devon Miller",
            "devon.miller@example.com",
            "inventory_controller",
            "MAIN",
            "+1 555-0103",
            "EMP-0103",
            "Cycle Count Analyst",
            "Inventory Control",
            "",
            "",
        ],
        [
            "Chloe Bennett",
            "chloe.bennett@example.com",
            "receiving_operator",
            "RECV",
            "+1 555-0104",
            "EMP-0104",
            "Inbound Receiving Associate",
            "Receiving",
            "",
            "",
        ],
        [
            "Liam Takahashi",
            "liam.takahashi@example.com",
            "order_picker",
            "MAIN",
            "+1 555-0105",
            "EMP-0105",
            "Fulfillment & Picking Associate",
            "Fulfillment",
            "",
            "",
        ],
        [
            "Sofia Rodriguez",
            "sofia.rodriguez@example.com",
            "picker_packer",
            "MAIN",
            "+1 555-0106",
            "EMP-0106",
            "Packing & Dispatch Specialist",
            "Outbound",
            "",
            "",
        ],
        [
            "Aiden Brooks",
            "aiden.brooks@example.com",
            "quality_inspector",
            "MAIN",
            "+1 555-0107",
            "EMP-0107",
            "Quality Assurance Specialist",
            "Quality Control",
            "",
            "",
        ],
        [
            "Grace Thornton",
            "grace.thornton@example.com",
            "viewer",
            "",
            "+1 555-0108",
            "EMP-0108",
            "Operations Auditor",
            "Audit & Compliance",
            "",
            "",
        ],
    ]

    row_font = Font(name="Calibri", size=10)
    for r_idx, r_data in enumerate(rows, 2):
        for c_idx, val in enumerate(r_data, 1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = row_font
            cell.alignment = left_align
            cell.border = thin_border
        ws.row_dimensions[r_idx].height = 20

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 5, 18)

    # -------------------------------------------------------------
    # Sheet 2: Reference Guide
    # -------------------------------------------------------------
    ws_ref = wb.create_sheet(title="Reference Guide")
    ws_ref.views.sheetView[0].showGridLines = True

    title_font = Font(name="Calibri", size=14, bold=True, color="0F172A")
    sub_font = Font(name="Calibri", size=11, bold=True, color="1E293B")
    sec_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    ws_ref.cell(row=1, column=1, value="NTAN Employee Bulk Import Reference").font = title_font
    ws_ref.cell(
        row=2,
        column=1,
        value="Use the exact role slugs and warehouse codes below when filling in the 'Team Import' template.",
    ).font = row_font

    ref_headers = ["Role Slug (Fill in 'Role *')", "Display Name", "Key Permissions & Responsibility"]
    for c_idx, h in enumerate(ref_headers, 1):
        cell = ws_ref.cell(row=4, column=c_idx, value=h)
        cell.font = sub_font
        cell.fill = sec_fill
        cell.border = thin_border
    ws_ref.row_dimensions[4].height = 24

    roles_data = [
        ("warehouse_manager", "Warehouse Manager", "Full operational control, team invites, cycle count approvals, location changes"),
        ("warehouse_supervisor", "Warehouse Supervisor", "Shift supervision, stock receive/issue/pick/pack/dispatch, location tracking"),
        ("inventory_controller", "Inventory Controller", "Cycle counting, stock adjustments, internal transfers, inventory audits"),
        ("receiving_operator", "Receiving Operator", "Purchase order check-in, barcode scanning, initial staging putaway"),
        ("order_picker", "Order Picker", "Order wave fulfillment, cart picking, transfer to pack station"),
        ("picker_packer", "Picker / Packer", "Pick list handling, box packing, label verification, outbound prep"),
        ("putaway_operator", "Putaway Operator", "Inbound goods movement from staging dock to high-bay racking"),
        ("quality_inspector", "Quality Inspector", "Quality inspection, quarantine hold tagging, vendor defect logging"),
        ("viewer", "Viewer (Read-Only)", "Read-only access to view reports and inventory balance screens"),
        ("auditor", "Auditor (Read-Only)", "Access to live audit trail, cost reports, and inventory valuation"),
    ]

    for r_idx, r in enumerate(roles_data, 5):
        for c_idx, val in enumerate(r, 1):
            cell = ws_ref.cell(row=r_idx, column=c_idx, value=val)
            cell.font = row_font
            cell.alignment = left_align
            cell.border = thin_border
        ws_ref.row_dimensions[r_idx].height = 20

    curr_row = 5 + len(roles_data) + 2
    ws_ref.cell(row=curr_row, column=1, value="Warehouse Assignment Guidelines:").font = sub_font
    ws_ref.cell(
        row=curr_row + 1,
        column=1,
        value="1. Enter the facility code (e.g. MAIN, RECV, BIN-01) or leave blank if the member should have access across all facilities.",
    ).font = row_font
    ws_ref.cell(
        row=curr_row + 2,
        column=1,
        value="2. To assign to multiple warehouses, separate with a semicolon (e.g. MAIN; RECV).",
    ).font = row_font

    for col in ws_ref.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_ref.column_dimensions[col_letter].width = max(max_len + 4, 20)

    # Save Excel file
    excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "members_bulk_import_sample.xlsx"))
    wb.save(excel_path)
    print(f"Generated Excel workbook: {excel_path}")

    # Also save CSV version
    csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "members_bulk_import_sample.csv"))
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        import csv
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)
    print(f"Generated CSV spreadsheet: {csv_path}")

if __name__ == "__main__":
    generate_members_spreadsheet()
