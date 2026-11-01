import csv
from datetime import date
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
import pymongo

# Connect and get actual active warehouse
client = pymongo.MongoClient('mongodb://127.0.0.1:27017')
db = client['ntan_inventory']
wh = db['warehouses'].find_one({'code': {'$regex': r'WH.*001', '$options': 'i'}}) or db['warehouses'].find_one()
wh_code = (wh.get('code') or 'WH -001') if wh else 'WH -001'

HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
ROW_FONT = Font(name="Calibri", size=10)
CENTER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_ALIGN = Alignment(horizontal="left", vertical="center")
THIN_BORDER = Border(
    left=Side(style="thin", color="CBD5E1"),
    right=Side(style="thin", color="CBD5E1"),
    top=Side(style="thin", color="CBD5E1"),
    bottom=Side(style="thin", color="CBD5E1"),
)


def apply_table_styles(ws, headers, rows):
    ws.views.sheetView[0].showGridLines = True
    ws.row_dimensions[1].height = 28

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER

    for r_idx, row in enumerate(rows, start=2):
        ws.row_dimensions[r_idx].height = 20
        for c_idx, val in enumerate(row, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = ROW_FONT
            cell.alignment = LEFT_ALIGN
            cell.border = THIN_BORDER

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 15)


def generate_team_excel():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Team Import"

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

    team_data = [
        ["Aarav Sharma", "aarav.sharma@ntan-inventory.com", "warehouse_manager", wh_code, "+91 98765 00001", "EMP-001", "General Warehouse Manager", "Operations & Logistics", "2026-01-01", ""],
        ["Vikramaditya Rao", "vikram.rao@ntan-inventory.com", "warehouse_supervisor", wh_code, "+91 98765 00002", "EMP-002", "Senior Floor Supervisor", "Operations", "2026-01-01", ""],
        ["Priya Sundaram", "priya.sundaram@ntan-inventory.com", "warehouse_supervisor", wh_code, "+91 98765 00003", "EMP-003", "Shift Incharge", "Operations", "2026-01-15", ""],
        ["Karthik Subramanian", "karthik.s@ntan-inventory.com", "receiving_operator", wh_code, "+91 98765 00004", "EMP-004", "Inbound Dock Specialist", "Inbound Receiving", "2026-02-01", ""],
        ["Deepa Venkatesh", "deepa.v@ntan-inventory.com", "receiving_operator", wh_code, "+91 98765 00005", "EMP-005", "Receiving Clerk", "Inbound Receiving", "2026-02-01", ""],
        ["Manoj Kumar", "manoj.kumar@ntan-inventory.com", "qc_inspector", wh_code, "+91 98765 00006", "EMP-006", "Quality Control Lead", "Quality Assurance", "2026-01-01", ""],
        ["Ananya Deshmukh", "ananya.d@ntan-inventory.com", "quality_inspector", wh_code, "+91 98765 00007", "EMP-007", "Inbound Inspection Officer", "Quality Assurance", "2026-01-10", ""],
        ["Rohan Pillai", "rohan.pillai@ntan-inventory.com", "putaway_operator", wh_code, "+91 98765 00008", "EMP-008", "High-Reach Reach Truck Operator", "Storage & Putaway", "2026-02-15", ""],
        ["Suresh Babu", "suresh.b@ntan-inventory.com", "putaway_operator", wh_code, "+91 98765 00009", "EMP-009", "Storage Allocation Driver", "Storage & Putaway", "2026-02-15", ""],
        ["Rajesh Kannan", "rajesh.kannan@ntan-inventory.com", "inventory_controller", wh_code, "+91 98765 00010", "EMP-010", "Lead Inventory Auditor", "Inventory Control", "2026-01-01", ""],
        ["Meera Nambiar", "meera.n@ntan-inventory.com", "cycle_counter", wh_code, "+91 98765 00011", "EMP-011", "Cycle Count Specialist", "Inventory Control", "2026-01-15", ""],
        ["Arjun Nair", "arjun.nair@ntan-inventory.com", "order_picker", wh_code, "+91 98765 00012", "EMP-012", "Zone Picker", "Fulfillment", "2026-02-01", ""],
        ["Divya Balaji", "divya.balaji@ntan-inventory.com", "order_picker", wh_code, "+91 98765 00013", "EMP-013", "Wave Picking Operator", "Fulfillment", "2026-02-01", ""],
        ["Sunil Varma", "sunil.varma@ntan-inventory.com", "order_picker", wh_code, "+91 98765 00014", "EMP-014", "Order Picker", "Fulfillment", "2026-02-10", ""],
        ["Kavitha Raman", "kavitha.r@ntan-inventory.com", "packing_operator", wh_code, "+91 98765 00015", "EMP-015", "Pack Station Lead", "Packing & Value Add", "2026-01-01", ""],
        ["Ganesh Moorthy", "ganesh.m@ntan-inventory.com", "packing_operator", wh_code, "+91 98765 00016", "EMP-016", "Carton & Pallet Packer", "Packing & Value Add", "2026-02-01", ""],
        ["Harish Reddy", "harish.reddy@ntan-inventory.com", "dispatch_operator", wh_code, "+91 98765 00017", "EMP-017", "Outbound Shipping Clerk", "Dispatch & Logistics", "2026-01-01", ""],
        ["Pooja Hegde", "pooja.hegde@ntan-inventory.com", "dispatch_operator", wh_code, "+91 98765 00018", "EMP-018", "Loading Dock Dispatcher", "Dispatch & Logistics", "2026-01-10", ""],
        ["Pradeep Joshi", "pradeep.j@ntan-inventory.com", "material_handler", wh_code, "+91 98765 00019", "EMP-019", "Forklift & Bendi Driver", "Internal Logistics", "2026-02-01", ""],
        ["Sneha Kulkarni", "sneha.k@ntan-inventory.com", "logistics_coordinator", wh_code, "+91 98765 00020", "EMP-020", "Freight & Carrier Coordinator", "Supply Chain", "2026-01-01", ""],
        ["Naveen Prasad", "naveen.p@ntan-inventory.com", "replenishment_operator", wh_code, "+91 98765 00021", "EMP-021", "Bin Replenishment Driver", "Internal Logistics", "2026-02-01", ""],
        ["Shalini Menon", "shalini.m@ntan-inventory.com", "returns_operator", wh_code, "+91 98765 00022", "EMP-022", "RMA & Returns Processor", "Reverse Logistics", "2026-01-15", ""],
        ["Gautam Singhania", "gautam.s@ntan-inventory.com", "company_admin", "", "+91 98765 00023", "EMP-023", "IT & Systems Administrator", "Executive / IT", "2026-01-01", ""],
        ["Siddharth Malhotra", "siddharth.m@ntan-inventory.com", "order_picker", wh_code, "+91 98765 00024", "EMP-024", "Temporary Seasonal Picker", "Fulfillment", "2026-03-01", "2026-12-31"],
        ["Tanvi Saxena", "tanvi.s@ntan-inventory.com", "qc_inspector", wh_code, "+91 98765 00025", "EMP-025", "Electronics QC Specialist", "Quality Assurance", "2026-02-01", ""],
    ]

    apply_table_styles(ws, headers, team_data)
    wb.save("test_data/NTAN_Team_and_Access_Bulk_Import.xlsx")
    print("Generated test_data/NTAN_Team_and_Access_Bulk_Import.xlsx")


def generate_partners_excel():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Business Partners"

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

    partner_data = [
        ["SUP-001", "Apex Precision Industrial Supplies Pvt Ltd", "Apex Supplies", "supplier", "Rajesh Kumar", "rajesh@apexsupplies.com", "+91 98765 11001", "27AAPFU0939F1ZV", "Plot 42, MIDC Industrial Area", "Phase 2", "Mumbai", "Maharashtra", "400093", "India", "Plot 42, MIDC Receiving Gate", "Mumbai", "Primary hardware & electrical supplier with 48h SLA."],
        ["SUP-002", "Bharat Semiconductor Components Ltd", "Bharat Semi", "supplier", "Sanjay Aggarwal", "orders@bharatsemi.in", "+91 98765 11002", "29AABCB1234D1ZP", "Electronic City Phase 1", "Hosur Road", "Bengaluru", "Karnataka", "560100", "India", "Gate 3, Tech Park Logistics", "Bengaluru", "Microcontrollers, ICs, and high-frequency crystals."],
        ["SUP-003", "Kaveri Chemical Solvents & Coatings LLP", "Kaveri Chemicals", "supplier", "Murugan Chettiar", "dispatch@kaverichem.com", "+91 98765 11003", "33AAHFK4321E1Z0", "SIDCO Industrial Estate", "Ambattur", "Chennai", "Tamil Nadu", "600058", "India", "Loading Bay 2, SIDCO", "Chennai", "Industrial degreasers, epoxies, and adhesives (Lot tracked)."],
        ["SUP-004", "Om Mega Fasteners & Hardware Corp", "Om Fasteners", "supplier", "Jatin Patel", "sales@omfasteners.co.in", "+91 98765 11004", "24AAGCO9876B1ZK", "GIDC Estate", "Vatva", "Ahmedabad", "Gujarat", "382445", "India", "Central Warehouse Godown 12", "Ahmedabad", "Stainless steel bolts, nuts, rivets, and brackets."],
        ["SUP-005", "Dynamic Servo & Motion Control Pvt Ltd", "Dynamic Motion", "supplier", "Nikhil Chopra", "nikhil@dynamicservo.com", "+91 98765 11005", "06AABCD5678F1ZL", "Udyog Vihar Phase 4", "", "Gurugram", "Haryana", "122016", "India", "Plot 89 Dispatch Wing", "Gurugram", "Industrial BLDC servo motors and encoder modules (Serial tracked)."],
        ["SUP-006", "EcoPack Corrugated Solutions Ltd", "EcoPack", "supplier", "Vandana Rao", "support@ecopack.co.in", "+91 98765 11006", "33AABCE2233G1ZT", "SIPCOT Industrial Complex", "Gummidipoondi", "Thiruvallur", "Tamil Nadu", "601201", "India", "Dock A SIPCOT", "Gummidipoondi", "Master cartons, bubble wraps, and tamper-evident sealing tapes."],
        ["SUP-007", "Schneider Industrial Power & Switchgear", "Schneider Dist", "supplier", "Ashok Shenoy", "quotes@schneiderdist.in", "+91 98765 11007", "29AACCS7788H1ZU", "Peenya Industrial Area", "4th Phase", "Bengaluru", "Karnataka", "560058", "India", "Warehouse 5, Peenya", "Bengaluru", "Contactors, MCBs, industrial relays, and terminal blocks."],
        ["SUP-008", "Precision Tooling & Carbide Dies India", "Precision Carbide", "supplier", "Ramesh Solanki", "sales@precisioncarbide.com", "+91 98765 11008", "27AAACP4455J1ZR", "Bhosari Industrial Area", "Pimpri", "Pune", "Maharashtra", "411026", "India", "Gate 1 Bhosari", "Pune", "CNC end-mills, drill bits, and carbide inserts."],
        ["SUP-009", "Pioneer Polymers & Molding Works", "Pioneer Polymers", "supplier", "Ritu Vashishta", "ritu@pioneerpolymers.in", "+91 98765 11009", "07AABCP8899K1ZS", "Okhla Industrial Area Phase 3", "", "New Delhi", "Delhi", "110020", "India", "Shed 14 Okhla", "New Delhi", "Injection molded ABS housings and terminal caps."],
        ["SUP-010", "Aura Safety Gear & PPE Distributors", "Aura Safety", "supplier", "Deepak Chawla", "deepak@aurasafety.com", "+91 98765 11010", "36AABCA1122M1ZW", "Sanath Nagar Industrial Estate", "", "Hyderabad", "Telangana", "500018", "India", "Godown 4 Sanath Nagar", "Hyderabad", "Certified safety helmets, anti-static gloves, and protective eyewear."],

        ["CUST-101", "Metro Distribution Logistics Hub", "Metro Distributorship", "customer", "Anita Sharma", "orders@metrodist.com", "+91 98765 22001", "27BAPFU0939F1ZW", "12 Linking Road", "Bandra West", "Mumbai", "Maharashtra", "400050", "India", "Central Logistics Hub Dock 4", "Mumbai", "High priority commercial wholesale buyer."],
        ["CUST-102", "Southern Retail Superstores Private Limited", "Southern Superstores", "customer", "Gopalan Nair", "procurement@southernsuperstores.com", "+91 98765 22002", "33AABCS4455N1ZX", "Mount Road 45/2", "Anna Salai", "Chennai", "Tamil Nadu", "600002", "India", "Distribution Center Guindy", "Chennai", "Weekly scheduled dispatch partner."],
        ["CUST-103", "Deccan Heavy Machinery & Engineering Works", "Deccan Heavy Eng", "customer", "Kiran Reddy", "purchase@deccaneng.in", "+91 98765 22003", "36AABCD9988P1ZY", "Balanagar Industrial Area", "", "Hyderabad", "Telangana", "500037", "India", "Factory Main Receiving Yard", "Hyderabad", "Industrial customer for motors, contactors and lubricants."],
        ["CUST-104", "Karnataka Electronics Manufacturing Park", "KEMP Assemblers", "customer", "Srinivas Gowda", "materials@kemp-tech.com", "+91 98765 22004", "29AABCK3344Q1ZZ", "Whitefield Main Road", "ITPL", "Bengaluru", "Karnataka", "560066", "India", "SMT Plant Receiving Bay", "Bengaluru", "Bulk buyer of microcontrollers, passive components and wiring."],
        ["CUST-105", "Eastern Auto Ancillaries Supply Co", "Eastern Ancillaries", "customer", "Debashis Sen", "d.sen@easternauto.co.in", "+91 98765 22005", "19AABCE1122R1ZA", "Taratec Industrial Zone", "Kolkata", "Kolkata", "West Bengal", "700088", "India", "Hub 2, Taratec", "Kolkata", "Monthly batch orders for industrial cables and relays."],
        ["CUST-106", "Prime Solutions Electrical Hardware", "Prime Solutions", "customer", "Hiten Mehta", "hiten@primesolutions.com", "+91 98765 22006", "24AABCP5566S1ZB", "Ring Road Wholesale Market", "", "Surat", "Gujarat", "395002", "India", "Shop 104 Ring Road", "Surat", "Commercial reseller for switchgear and power tools."],
        ["CUST-107", "National Highway Toll & Infraworks Consortia", "NH Toll Infra", "customer", "Virender Tyagi", "contracts@nhtollinfra.in", "+91 98765 22007", "07AABCN7788T1ZC", "Barakhamba Road", "Connaught Place", "New Delhi", "Delhi", "110001", "India", "Site Depot Sector 62", "Noida", "Direct site shipments for safety gear and outdoor cable reels."],
        ["CUST-108", "Apex Care Hospitals Bio-Medical Engineering", "Apex Hospitals", "customer", "Dr. Shalini Roy", "biomedical@apexhospitals.org", "+91 98765 22008", "27AABCA3344U1ZD", "S.V. Road, Santacruz West", "", "Mumbai", "Maharashtra", "400054", "India", "Central Biomedical Stores", "Mumbai", "Specialized medical UPS, power supplies, and sterile gear."],

        ["PART-201", "Global Trading & Cross-Border Logistics", "Global Trade Logistics", "supplier; customer", "Vikramaditya Sengupta", "vikram@globaltradelog.in", "+91 98765 33001", "27AAACG9988V1ZE", "88 Industrial Bypass", "Chakan", "Pune", "Maharashtra", "410501", "India", "Chakan Inbound/Outbound Dock 7", "Pune", "Dual partner: Supplies raw metal stock; buys finished servo sub-assemblies."],
        ["PART-202", "Omni Automation & Component Exchanges", "Omni Automation", "supplier; customer", "Rakesh Singhal", "rakesh@omniauto.in", "+91 98765 33002", "29AABCO6677W1ZF", "Koramangala 8th Block", "", "Bengaluru", "Karnataka", "560095", "India", "Omni R&D Integration Bay", "Bengaluru", "Supplies custom sensor breakout boards; purchases standard enclosures."],
        ["PART-203", "Trident Marine Engineering & Supplies", "Trident Marine", "supplier; customer", "Commander S. Verghese", "supply@tridentmarine.com", "+91 98765 33003", "32AABCT2233X1ZG", "Willingdon Island", "Harbour Road", "Kochi", "Kerala", "682003", "India", "Drydock Berth 3", "Kochi", "Supplies marine-grade anti-corrosive coatings; buys electrical assemblies."],

        ["CLIENT-301", "Zephyr Drones & Autonomous Tech Pvt Ltd", "Zephyr Drones", "customer; 3pl_client", "Rohit Bhargava", "operations@zephyrdrones.com", "+91 98765 44001", "29AABCZ5566Y1ZH", "Indiranagar 100ft Road", "", "Bengaluru", "Karnataka", "560038", "India", "Zephyr Dedicated Storage Bay A", "Bengaluru", "Segregated carbon fiber airframes and drone battery inventory."],
        ["CLIENT-302", "BioMedix Diagnostic Devices India", "BioMedix Diagnostics", "customer; 3pl_client", "Farhan Akhtar", "supplychain@biomedix.in", "+91 98765 44002", "33AABCB8899Z1ZI", "Tidel Park Module 4", "Tharamani", "Chennai", "Tamil Nadu", "600113", "India", "Cold-chain Segregated Cage B", "Chennai", "Temperature-monitored diagnostic cartridges and sensor strips."],
        ["CLIENT-303", "Nova EV Battery Systems India", "Nova EV Systems", "customer; 3pl_client", "Karan Johar", "karan@novaevbattery.com", "+91 98765 44003", "27AABCN1122A1ZJ", "MIDC Industrial Estate", "Talegaon", "Pune", "Maharashtra", "410507", "India", "Hazardous Material Cage C", "Pune", "LFP battery modules and BMS controllers."],
    ]

    apply_table_styles(ws, headers, partner_data)
    wb.save("test_data/NTAN_Business_Partners_Bulk_Import.xlsx")
    print("Generated test_data/NTAN_Business_Partners_Bulk_Import.xlsx")


def generate_item_catalogue_excel_and_csv():
    headers = [
        "sku",
        "name",
        "barcode",
        "category",
        "type",
        "unit",
        "tracking_mode",
        "has_expiry",
        "reorder_point",
        "cost",
        "notes",
        "warehouse_code",
        "zone_code",
        "aisle_code",
        "rack_code",
        "shelf_code",
        "bin_code",
        "storage_type",
        "preferred_location",
    ]

    items_data = [
        ["CHG-1001", "65W USB-C GaN Fast Power Charger", "890123400101", "Electronics", "stocked_material", "EA", "none", "false", "25.0", "45.00", "High efficiency dual-port GaN power adapter", wh_code, "A", "A01", "R01", "S01", "B01", "bin", "B01"],
        ["CHG-1002", "100W Desktop Fast Charging Station 4-Port", "890123400102", "Electronics", "stocked_material", "EA", "none", "false", "20.0", "68.00", "Multi-device desktop charging hub with PD 3.0", wh_code, "A", "A01", "R01", "S02", "B02", "bin", "B02"],
        ["MCU-2001", "32-bit Cortex M4 Microcontroller Board", "890123400201", "Electronics", "stocked_material", "EA", "none", "false", "50.0", "12.50", "High performance ARM Cortex industrial MCU board", wh_code, "A", "A01", "R02", "S01", "B03", "bin", "B03"],
        ["MCU-2002", "Dual Core Wireless IoT Gateway Module", "890123400202", "Electronics", "stocked_material", "EA", "none", "false", "35.0", "16.80", "Wi-Fi & BLE 5.0 industrial embedded controller", wh_code, "A", "A02", "R02", "S02", "B04", "bin", "B04"],
        ["MTR-3001", "Precision Brushless Servo Motor 24V 200W", "890123400301", "Robotics", "stocked_material", "EA", "serial", "false", "8.0", "185.00", "High-torque industrial servo with optical encoder", wh_code, "A", "A02", "R03", "S01", "B05", "bin", "B05"],
        ["MTR-3002", "Planetary Gear Stepper Motor NEMA 23 10:1", "890123400302", "Robotics", "stocked_material", "EA", "serial", "false", "12.0", "92.00", "Low backlash precision reduction gear motor", wh_code, "A", "A02", "R03", "S02", "B06", "bin", "B06"],
        ["MTR-3003", "High-Speed Micro Linear Actuator 50mm Stroke", "890123400303", "Robotics", "stocked_material", "EA", "serial", "false", "15.0", "64.50", "12V DC compact actuator with integrated limit switch", wh_code, "A", "A03", "R04", "S01", "B07", "bin", "B07"],
        ["SEN-4001", "Industrial LiDAR Distance Sensor Module 12m", "890123400401", "Sensors", "stocked_material", "EA", "serial", "false", "10.0", "120.00", "Time-of-flight laser rangefinder with UART/CAN", wh_code, "A", "A03", "R05", "S01", "B08", "bin", "B08"],
        ["SEN-4002", "Digital Temperature & Relative Humidity Sensor", "890123400402", "Sensors", "stocked_material", "EA", "none", "false", "100.0", "4.20", "Calibrated I2C humidity and temperature probe", wh_code, "B", "B01", "R09", "S01", "B09", "bin", "B09"],
        ["SEN-4003", "Ultrasonic Obstacle Detection Module IP67", "890123400403", "Sensors", "stocked_material", "EA", "none", "false", "30.0", "18.50", "Weatherproof ultrasonic transceiver with waterproof horn", wh_code, "B", "B01", "R10", "S01", "B10", "bin", "B10"],
        ["CBL-5001", "Flexible Industrial Copper Cable 3-Core 2.5mm 100m", "890123400501", "Electrical", "stocked_material", "MTR", "lot", "false", "200.0", "1.85", "FR-PVC insulated high-conductivity copper flexible cable", wh_code, "B", "B01", "R11", "S01", "B11", "bin", "B11"],
        ["CBL-5002", "High Voltage Shielded Power Cable 4-Core 4mm 50m", "890123400502", "Electrical", "stocked_material", "MTR", "lot", "false", "150.0", "3.40", "XLPE insulated armored industrial power feeder cable", wh_code, "B", "B02", "R12", "S01", "B12", "bin", "B12"],
        ["SWG-6001", "Three Phase AC Contactor 32A 230V Coil", "890123400601", "Electrical", "stocked_material", "EA", "none", "false", "20.0", "28.50", "Heavy duty motor control magnetic contactor", wh_code, "B", "B02", "R13", "S01", "B13", "bin", "B13"],
        ["SWG-6002", "Miniature Circuit Breaker MCB 3-Pole C16 10kA", "890123400602", "Electrical", "stocked_material", "EA", "none", "false", "40.0", "14.20", "DIN rail mounted electrical distribution circuit breaker", wh_code, "B", "B02", "R14", "S01", "B14", "bin", "B14"],
        ["SWG-6003", "Emergency Stop Pushbutton Switch IP65 Box", "890123400603", "Electrical", "stocked_material", "EA", "none", "false", "25.0", "11.00", "Twist-to-reset mushroom emergency stop button with enclosure", wh_code, "B", "B03", "R15", "S01", "B15", "bin", "B15"],
        ["CHM-7001", "Industrial Precision Solvent Degreaser 5L", "890123400701", "Chemicals", "stocked_material", "CAN", "lot", "true", "15.0", "38.50", "Fast-drying heavy duty machinery cleaner and degreaser", wh_code, "B", "B03", "R16", "S01", "B16", "bin", "B16"],
        ["CHM-7002", "High Temperature Bearing Grease 1kg Cartridge", "890123400702", "Chemicals", "stocked_material", "KG", "lot", "true", "30.0", "14.80", "Synthetic lithium complex extreme pressure grease", wh_code, "B", "B03", "R17", "S01", "B17", "bin", "B17"],
        ["CHM-7003", "Structural Epoxy Adhesive 2-Part 500ml Set", "890123400703", "Chemicals", "stocked_material", "SET", "lot", "true", "20.0", "22.00", "High-strength metal and composite bonding resin system", wh_code, "B", "B04", "R18", "S01", "B18", "bin", "B18"],
        ["CHM-7004", "Anti-Corrosion Moisture Displacing Spray 400ml", "890123400704", "Chemicals", "stocked_material", "CAN", "lot", "true", "50.0", "6.20", "Multi-purpose protective lubrication and rust inhibitor spray", wh_code, "B", "B04", "R19", "S01", "B19", "bin", "B19"],
        ["FST-8001", "M6 Stainless Steel Hex Socket Cap Screws Pack of 100", "890123400801", "Hardware", "stocked_material", "PK", "none", "false", "50.0", "8.50", "A2-70 grade stainless steel hex drive machine screws", wh_code, "B", "B04", "R20", "S01", "B20", "bin", "B20"],
        ["FST-8002", "M8 High Tensile Flange Lock Nuts Pack of 100", "890123400802", "Hardware", "stocked_material", "PK", "none", "false", "40.0", "9.80", "Grade 8.8 zinc plated serrated flange locking nuts", wh_code, "B", "B05", "R21", "S01", "B21", "bin", "B21"],
        ["FST-8003", "Aluminum Extrusion T-Nut Spring Ball M5 Pack of 50", "890123400803", "Hardware", "stocked_material", "PK", "none", "false", "60.0", "7.20", "Roll-in spring loaded T-nuts for 2020 aluminum profiles", wh_code, "B", "B05", "R22", "S01", "B22", "bin", "B22"],
        ["TOL-9001", "Solid Carbide 4-Flute End Mill 6mm TiAlN", "890123400901", "Tooling", "stocked_material", "EA", "none", "false", "15.0", "24.00", "Micro-grain carbide cutter for stainless and alloy steel", wh_code, "C", "C01", "R23", "S01", "B23", "bin", "B23"],
        ["TOL-9002", "Cobalt HSS Jobber Drill Bit Set 1mm-13mm (25 Pcs)", "890123400902", "Tooling", "stocked_material", "SET", "none", "false", "10.0", "52.00", "Heavy duty M35 5% cobalt steel metal drill bit kit", wh_code, "C", "C01", "R24", "S01", "B24", "bin", "B24"],
        ["TOL-9003", "Precision Digital Vernier Caliper 150mm Stainless", "890123400903", "Tooling", "stocked_material", "EA", "serial", "false", "8.0", "36.00", "High accuracy 0.01mm resolution digital caliper with LCD", wh_code, "C", "C01", "R25", "S01", "B25", "bin", "B25"],
        ["PPE-1001", "Industrial Safety Helmet with Ratchet Suspension", "890123401001", "Safety", "stocked_material", "EA", "none", "false", "30.0", "7.50", "High impact ABS vented hard hat EN397 compliant", wh_code, "E", "E01", "R26", "S01", "B26", "bin", "B26"],
        ["PPE-1002", "Nitrile Coated Work Safety Gloves (10 Pairs Pack)", "890123401002", "Safety", "stocked_material", "PK", "none", "false", "40.0", "12.00", "Abrasion resistant breathable micro-foam grip gloves", wh_code, "E", "E01", "R27", "S01", "B27", "bin", "B27"],
        ["PPE-1003", "Anti-Scratch Polycarbonate Eye Protection Goggles", "890123401003", "Safety", "stocked_material", "EA", "none", "false", "50.0", "3.80", "UV400 rated wrap-around safety glasses with side shields", wh_code, "E", "E01", "R28", "S01", "B28", "bin", "B28"],
        ["PKG-1101", "Heavy Duty Corrugated Shipping Box 400x300x250mm", "890123401101", "Packaging", "stocked_material", "EA", "none", "false", "200.0", "1.10", "3-ply kraft paper shipping carton with self-locking flaps", wh_code, "F", "F01", "R29", "S01", "B29", "bin", "B29"],
        ["PKG-1102", "Self-Adhesive Packing Sealing Tape 48mm x 65m Roll", "890123401102", "Packaging", "stocked_material", "ROLL", "none", "false", "100.0", "0.95", "High tack BOPP transparent box sealing carton tape", wh_code, "F", "F01", "R30", "S01", "B30", "bin", "B30"],
        ["PKG-1103", "Air Bubble Protective Cushioning Roll 1m x 50m", "890123401103", "Packaging", "stocked_material", "ROLL", "none", "false", "25.0", "14.50", "Dual-layer low-density polyethylene shock absorbing wrap", wh_code, "F", "F01", "R31", "S01", "B31", "bin", "B31"],
    ]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Items Template"
    apply_table_styles(ws, headers, items_data)
    wb.save("test_data/NTAN_Item_Catalogue_Bulk_Import.xlsx")
    print("Generated test_data/NTAN_Item_Catalogue_Bulk_Import.xlsx")

    with open("test_data/NTAN_Item_Catalogue_Bulk_Import.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(items_data)
    print("Generated test_data/NTAN_Item_Catalogue_Bulk_Import.csv")


if __name__ == "__main__":
    generate_team_excel()
    generate_partners_excel()
    generate_item_catalogue_excel_and_csv()
    print("\nAll 3 test datasets successfully generated in D:\\Projects\\Ntane\\test_data\\")
