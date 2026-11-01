# NTAN Inventory — Figma Design Brief & UX/UI Specification Package

**Target Audience:** UI/UX Design Team & Figma Product Designers  
**Project:** NTAN Inventory (Multi-Tenant Mobile & Tablet Inventory Platform)  
**Target Platforms:** Mobile (iOS / Android) & Tablet (Responsive Left Rail)  
**Engineering Stack:** React Native (Expo TypeScript), FastAPI, MongoDB  
**Document Purpose:** Complete functional handoff, user workflows, expected outcomes, screen specifications, and design system tokens to kick off Figma design sprints.

---

## 1. Executive Summary & Product Vision

**NTAN Inventory** is a high-velocity, industrial-grade inventory and logistics mobile application built for modern businesses, warehouses, manufacturing facilities, and service teams. 

Unlike bloated desktop ERPs or generic consumer apps:
- **Scan-First & Fast:** Operators can complete receiving, counting, or stock issues in seconds using barcode/QR scanning.
- **Industrial Usability:** Designed for poor lighting, dusty environments, one-handed mobile use, and glove/stylus touch targets.
- **Truthful & Auditable:** Every stock movement is treated as a ledger transaction with atomic states: `Draft` → `Queued` → `Applied` → `Rejected` / `Conflict`.
- **Offline Resilient:** Operations queue locally when offline with clear sync states; no silent data overwrites.
- **Zero Ambiguity:** Strict differentiation between **On-Hand** (physical warehouse total), **Reserved** (promised to jobs/orders), and **Available** (can be issued right now).

---

## 2. Key Business Outcomes & UX Goals

| Core Goal | Design Consequence & UX Requirement |
|---|---|
| **Sub-5-second stock actions** | Scan-first entry, remembered warehouse/location context, 1 primary action per screen. |
| **Zero warehouse errors** | High visibility of on-hand vs. available; confirmation modals on commit; clear discrepancy alerts. |
| **High contrast in warehouse environments** | WCAG 2.1 AA compliant; deep navy/white contrast; bold status pills (never rely on color alone). |
| **Touch target safety** | Minimum 44×44 pt (preferred 48×48 pt) touch targets; 8 dp spacing minimum between interactive items. |
| **Trustworthy data state** | Clear badge labels on all operational cards: `Draft`, `Queued (Offline)`, `Applied`, `Rejected`, `Conflict`. |
| **Tablet productivity** | Responsive navigation rail (left-docked) on tablets (≥768 dp); master-detail split views. |

---

## 3. User Personas & Role Matrix

The UI must adapt contextually based on the active user’s role and warehouse location scope:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER PERSONAS IN NTAN                          │
├──────────────────────┬─────────────────────────────────────────────────┤
│ 1. Warehouse Operator│ Fast receiving, barcode scan, putaway, picking  │
│ 2. Inv. Supervisor   │ Review receiving queue, cycle count variance    │
│ 3. Inventory Manager │ Item catalogue, stock adjustments, locations    │
│ 4. Field Technician  │ Issue parts to jobs, return spares, offline use │
│ 5. Project Manager   │ Allocate materials, view project shortages      │
│ 6. Company Admin     │ Manage team members, roles, warehouse scope     │
│ 7. Company Owner     │ High-level KPIs, valuation, subscription/audit  │
└──────────────────────┴─────────────────────────────────────────────────┘
```

### Feature Visibility Matrix for Figma Designers:
- **Operators:** Streamlined flow focused on **Home**, **Scan**, **Receive**, **Putaway/Transfer**, and **Counts**. No settings/cost visibility.
- **Managers / Supervisors:** Full access to **Inventory**, **Adjustments**, **Approvals Inbox**, **Stock Value**, and **Audit Ledger**.
- **Admins / Owners:** Team management, role permissions, warehouse setup, and subscription settings.

---

## 4. Navigation Architecture

```
                    ┌────────────────────────────┐
                    │       AUTHENTICATION       │
                    │ Welcome / Sign In / Join   │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │      ONBOARDING FLOW       │
                    │  Company Setup / Location  │
                    └─────────────┬──────────────┘
                                  │
       ┌──────────────────────────┴──────────────────────────┐
       │                 AUTHENTICATED TABS                  │
       │                                                     │
┌──────▼─────┐  ┌────────────┐  ┌─────────────┐  ┌───────────▼─┐  ┌───────────┐
│ 1. HOME    │  │ 2. ITEMS   │  │ 3. SCAN     │  │ 4. RECEIVE  │  │ 5. MORE   │
│ Dashboard, │  │ Stock,     │  │ Modal View, │  │ Inbound,    │  │ Team,     │
│ Alerts,    │  │ Balances,  │  │ Barcode/QR, │  │ PO Queue,   │  │ Locations,│
│ Activity   │  │ Details    │  │ Fast Action │  │ Putaway     │  │ Settings  │
└────────────┘  └────────────┘  └─────────────┘  └─────────────┘  └───────────┘
```

> **Tablet layout note:** On tablets (≥768 dp width), the bottom tab bar shifts into a persistent left navigation rail with master-detail side-by-side screens.

---

## 5. Detailed End-to-End User Workflows

### Flow 1: Authentication & Team Onboarding
1. **Welcome Screen:** Clear value proposition, "Create Company" (Owner) and "Join with Code" (Invited team).
2. **Company Creation:** Name, Currency, Timezone, Primary Warehouse.
3. **Join Flow:** Paste 8-character single-use code, preview inviter name/company/role, confirm password.
4. **Outcome:** User lands on role-tailored dashboard with first-use checklist cards.

### Flow 2: Inbound Goods Receiving & Putaway (Scan-First)
1. **Queue:** Operator opens **Receive** tab → views expected delivery or starts Ad-Hoc.
2. **Scan / Select:** Camera opens (or manual SKU entry) → scans delivery barcode.
3. **Item Verified:** Item card slides up with SKU, Name, Standard Unit (e.g., PCS, KG, BOX).
4. **Quantity & Inspection:** 
   - Enter received quantity via large numeric keypad.
   - Enter Lot/Batch or Serial number (if tracking enabled).
   - Flag discrepancy (e.g., "Short delivery", "Damaged goods") + optional photo upload.
5. **Draft & Commit:** 
   - Save as draft (resumable) or press **Commit to Ledger**.
   - Immediate feedback: stock enters "Receiving Dock".
6. **Putaway Prompt:** App prompts: *"Move to permanent storage location now?"* → Scan target bin (e.g. `WH1-Aisle2-ShelfB`).

### Flow 3: Fast Barcode/QR Scanner & Action Sheet
1. User taps the prominent center **Scan** button from anywhere in the app.
2. Camera activates with flashlight/torch toggle, reticle guide, and continuous-scanning mode.
3. **Decoded Barcode:** Triggers immediate haptic feedback + bottom sheet preview:
   - Item Name & SKU
   - On-hand, Reserved, and Available quantities
   - Location breakdown
   - Quick Action Grid: **[Receive]**, **[Issue to Job]**, **[Transfer Bin]**, **[Cycle Count]**, **[View History]**.
4. **Fallback:** Prominent *"Enter barcode manually"* button for damaged labels or low-light scenarios.

### Flow 4: Stock Outbound / Issue to Project or Job
1. Operator or Field Technician initiates **Issue Stock**.
2. Select destination: Project, Machine, Department, or Customer.
3. Quantity selection: Validates `Available >= Requested`. If insufficient, displays:
   - Current physical On-Hand
   - Already Reserved stock (with who reserved it)
   - Alternative warehouse bins
4. Confirmation shows pre-and-post balance (e.g., `Available: 15 → 10`).
5. Commit posts movement to ledger with instantaneous audit trail.

### Flow 5: Warehouse & Location Hierarchy (Bin Management)
1. Warehouse multi-tier tree: `Warehouse` → `Zone / Aisle` → `Rack / Shelf` → `Bin`.
2. Clean visual breakdown showing occupancy, capacity, and items assigned per bin.
3. One-tap **Transfer Stock** between bins with from/to selector and immediate balance update.

### Flow 6: Cycle Counting & Variance Approval
1. Manager initiates count for specific warehouse zone or category.
2. Operator counts via scanning with blind-mode (expected quantities hidden to prevent bias).
3. System computes discrepancies automatically:
   - `Green`: Match
   - `Amber`: Minor discrepancy within tolerance
   - `Red`: Significant discrepancy requiring supervisor approval
4. Supervisor approves with mandatory reason code (`Damaged`, `Misplaced`, `Theft`, `Unit error`).

### Flow 7: Offline Mode & Conflict Resolution
1. When network drops, persistent top banner: *"Offline Mode — Actions will queue locally"*.
2. User can still scan cached items, create drafts, and record movements.
3. Once back online, outbox badge displays sync progress (`3 of 3 syncing`).
4. **Conflict Screen (if concurrent change occurred):** Side-by-side comparison showing local edit vs. server record with clear resolution buttons: *"Keep Local"*, *"Accept Server"*, or *"Adjust Quantity"*.

### Flow 8: Team Access & Location Scoping
1. Admin opens **Account → Team & Access**.
2. Member list shows name, email, badge for Role, and assigned Warehouses.
3. Invite Modal: Multi-email input (comma/line separated), Role selector, and Warehouse location checkbox group.
4. Generates single-use invite link/code with 1-tap copy & share sheet.

---

## 6. Complete Screen Catalogue for Figma

```
📁 01_AUTH_AND_ONBOARDING
  ├── 01_Splash_Bootstrap (Logo, session check, offline alert)
  ├── 02_Welcome (Value cards, Sign In, Create Company, Join)
  ├── 03_Sign_In (Email/Password, Remember me, Forgot password)
  ├── 04_Register_Company (Owner name, company, currency, timezone)
  ├── 05_Join_Company (Invite code entry, preview role & inviter)
  └── 06_Workspace_Switcher (For multi-company accounts)

📁 02_HOME_DASHBOARD
  ├── 01_Home_Supervisor (KPI cards: Inbound today, Low stock, Pending approvals, Movements)
  ├── 02_Home_Operator (Queue-first view: Receiving queue, Putaway tasks, Quick scan)
  ├── 03_Notification_Center (Activity stream, approvals needed, low stock alerts)
  └── 04_Global_Search (Search items, SKUs, locations, movements)

📁 03_SCANNER_EXPERIENCE
  ├── 01_Scanner_Viewfinder (Torch, flip camera, multi-scan toggle, manual code trigger)
  ├── 02_Manual_Code_Entry (Large input, recently scanned codes, keyboard focus)
  ├── 03_Scan_Result_BottomSheet (Item snapshot, on-hand/reserved/available, action buttons)
  └── 04_Unknown_Barcode_Modal (Create new item or link to existing SKU)

📁 04_INVENTORY_MANAGEMENT
  ├── 01_Items_List (Virtual list, SKU, category filter, stock status pill, search bar)
  ├── 02_Item_Detail (360° view: specs, stock by warehouse/bin, movements, reservations)
  ├── 03_Create_Edit_Item (SKU, barcode, name, unit, category, min reorder point)
  └── 04_Stock_Balances (Warehouse breakdown, bin location tree)

📁 05_RECEIVING_AND_PUTAWAY
  ├── 01_Receive_Hub (Active drafts, expected shipments, new receipt CTA)
  ├── 02_Receive_Item_Form (Quantity keypad, UOM, lot/serial, discrepancy checkbox)
  ├── 03_Receipt_Summary_Commit (Pre-commit review, line items, ledger confirm)
  └── 04_Putaway_Move (Source receiving dock → Target warehouse bin)

📁 06_OUTBOUND_AND_OPERATIONS
  ├── 01_Operations_Hub (Queues: Receiving, Picking, Transfers, Approvals)
  ├── 02_Issue_Stock (Select job/project/machine, enter qty, reason code)
  ├── 03_Transfer_Stock (Origin bin → Destination bin, in-transit state)
  ├── 04_Cycle_Count_Session (Blind counting screen, counter progress bar)
  └── 05_Variance_Review (Discrepancy table, supervisor approval)

📁 07_WAREHOUSES_AND_LOCATIONS
  ├── 01_Warehouses_List (Warehouse cards, location counts, active stock value)
  ├── 02_Location_Hierarchy_Tree (Aisles, racks, shelves, bins)
  └── 03_Add_Location_Modal (Type selector: Dock, Storage, Quarantine, Staging)

📁 08_TEAM_AND_ADMIN
  ├── 01_Account_Profile (Current user details, active warehouse scope, sign out)
  ├── 02_Team_Members (Members list, roles, status, location permissions)
  ├── 03_Invite_Team_Modal (Bulk email input, role picker, warehouse restrictions)
  └── 04_Pending_Invitations (Active codes, expiry dates, revoke action)

📁 09_SYSTEM_STATES_AND_EDGE_CASES
  ├── 01_Empty_States (No items, no receipts, all caught up)
  ├── 02_Offline_Sync_Banner_And_Outbox (Queue drawer, sync status)
  ├── 03_Conflict_Resolution_Screen (Side-by-side version comparison)
  └── 04_Error_States (Network error, barcode unrecognized, permission denied)
```

---

## 7. Design System Guidelines & Token Specifications

To ensure seamless implementation in our React Native codebase, please align Figma styles to our existing design tokens:

### 7.1 Color Tokens
```json
{
  "colors": {
    "primary": "#2E5BBF",      /* Energetic industrial blue for primary actions */
    "navy": "#213767",         /* Dark headers, cards, prominent text */
    "dark": "#1F3548",         /* Deep contrast accents */
    "deep": "#1C5C93",         /* Interactive secondary highlights */
    "accent": "#FBCC00",       /* High-visibility yellow for scan frame / highlights */
    "surface": "#F5F9FC",      /* Clean, soft warehouse screen background */
    "white": "#FFFFFF",        /* Card surfaces, input backgrounds */
    "text": "#1F2933",         /* High-contrast body text */
    "muted": "#5C768D",        /* Secondary labels, helper text */
    "border": "#D6E2EC",       /* Dividers, input outlines */
    "success": "#1F7A5C",      /* Stock applied, in-stock badge */
    "successSoft": "#E6F4EE",  /* Success pill background */
    "warning": "#9A6A00",      /* Low stock alert, draft state */
    "warningSoft": "#FFF5D6",  /* Warning pill background */
    "danger": "#B42318",       /* Out of stock, discrepancy, rejected */
    "dangerSoft": "#FDECEA"    /* Danger pill background */
  }
}
```

### 7.2 Typography Tokens
- **Headings (Screen Titles, Modal Titles, Section Headers):**  
  Font Family: `Raleway` (Weights: `700 Bold`, `600 SemiBold`)
- **Body & Data Inputs (Labels, Descriptions, Form Fields):**  
  Font Family: `Open Sans` (Weights: `400 Regular`, `600 SemiBold`)
- **Numbers, SKUs, Barcodes, Quantities, Currency:**  
  Use a clear tabular figure/monospace font (e.g. `JetBrains Mono` or `Roboto Mono`) to ensure numerical alignment.

### 7.3 Spacing & Layout Grid
- **Base Grid:** 4pt / 8pt grid system.
- **Spacing Scale:**
  - `xs`: 4px
  - `sm`: 8px
  - `md`: 12px
  - `lg`: 16px (Standard screen side padding)
  - `xl`: 24px
  - `xxl`: 32px
- **Touch Target Rules:** Any button, checkbox, chip, or list row must have at least **44×44 pt** tap area (Apple/Android Accessibility standard).

### 7.4 Corner Radii & Elevation
- **Card / Input Radius:** `12px` (Medium)
- **Modal / Bottom Sheet Top Radius:** `26px` (Extra Large)
- **Tag / Badge / Pill Radius:** `999px` (Full Pill)
- **Elevation / Shadow:** Soft diffused navy shadow: `offset: (0, 6)`, `opacity: 0.08`, `radius: 14`.

### 7.5 Status Pill Component Spec
Every inventory status must be rendered with an **Icon + Text + Soft Tint**:
- `Draft`: Yellow clock icon + `#FFF5D6` background + `#9A6A00` text
- `Applied / In Stock`: Green checkmark + `#E6F4EE` background + `#1F7A5C` text
- `Queued (Offline)`: Blue upload icon + `#EAF2FD` background + `#2E5BBF` text
- `Low Stock`: Orange warning triangle + `#FFF5D6` background + `#9A6A00` text
- `Discrepancy / Out of Stock`: Red exclamation + `#FDECEA` background + `#B42318` text

---

## 8. Expected Figma Deliverables Checklist

When handing off designs to the development team, please provide:

- [ ] **Figma Design System / UI Kit:**
  - Color & typography variables mapped to tokens above.
  - Component library with Auto-Layout (Buttons, Inputs, Metric Cards, Status Badges, Tab Bar, App Header).
  - Light mode baseline (Dark mode tokens defined for future phase).
- [ ] **Mobile Screens (390×844 dp baseline - iPhone 14/15 & Pixel 7/8):**
  - All 9 screen groups specified in Section 6.
  - Interactive bottom sheets for Scanner Result and Putaway.
- [ ] **Edge Cases & Interactive States:**
  - Loading skeletons (no plain blank spinners).
  - Empty states with illustrative SVG / clean icons and primary action buttons.
  - Form validation states (inline error, field focused, disabled submit).
  - Offline banner & sync center badge.
- [ ] **Tablet Adaptation (768×1024 dp iPad/Android Tablet):**
  - Master-detail view for Item Catalogue & Operations.
  - Left navigation rail.
- [ ] **Prototype Links:**
  - Prototype 1: Onboarding & First Company Setup.
  - Prototype 2: Scanner to Goods Receipt & Putaway Flow.
  - Prototype 3: Stock Issue & Location Transfer Flow.

---

## 9. Direct Collaboration & Questions

- **Engineering Lead / Backend Contact:** Antigravity Team
- **API Swagger Documentation:** `http://localhost:8000/api/v1/docs` (available when running backend locally)
- **Existing Mobile Codebase Reference:** `mobile/src/screens/` and `mobile/src/theme.ts`
