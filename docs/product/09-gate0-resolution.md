# 09 — Gate 0 Resolution and Decision Preparation

**Status:** Proposed resolution for NTAN management decision
**Date:** 2026-10-22
**Basis:** `README.md`, Docs 01–07 and `08-phase0-review.md`
**Scope:** Gate 0 only. No application code, framework initialization, package installation, database schema, migration or UI development.
**Document rule:** This document resolves issues by proposing decisions. It does **not** rewrite Docs 01–08. A separate change-control pass is required after NTAN approval.

---

## 1. Purpose and decision summary

This document closes the Gate 0 review by turning findings into a proposed decision package:

1. One canonical screen inventory.
2. Explicit missing-screen specifications.
3. A conceptual inventory data model.
4. A minimum approval model that supports P0 operations.
5. An offline authority matrix.
6. A MongoDB vs PostgreSQL decision record.
7. A reconciled release-priority register.
8. A management decision checklist.
9. Objective Gate 0 exit criteria.

### 1.1 Resolution at a glance

| Topic | Resolution proposed here | Status |
|---|---|---|
| 78 vs 81 screens | The existing catalogue contains **81** screens. “78” was an arithmetic/phase-summary error, not a defined exclusion. | Resolved for review |
| Canonical inventory | **87 active screens**: 81 existing + 6 mandatory missing screens. | Proposed for approval |
| Missing mandatory screens | `SYNC-01`, `SYNC-02`, `PO-01`, `PO-02`, `CUS-01`, `CUS-02`. | Proposed for 1.0 |
| Optional/future screens | 7 candidates listed separately; not counted in the 87. | Deferred |
| Conceptual data model | Product/variant, UOM, warehouse/location, lot/serial, balance, reservation, movement and allocation model defined conceptually. | Proposed for approval |
| Approvals | Approval becomes a P0 core primitive (`APR-01`), with minimal settings in 1.0 and full rules in 1.1. | Proposed |
| Offline authority | Offline capture/queue only. **No stock-affecting operation is safely offline-executable.** | Proposed |
| Database | PostgreSQL conditionally recommended; final choice remains with NTAN. | Pending NTAN |
| Release priorities | Canonical register: 36 pilot screens, 28 additional at 1.0, 14 at 1.1, 7 at 1.2, 2 at 2.0. | Proposed |
| Gate 0 | Ready for management decisions, not yet exited. | Conditional |

### 1.2 Scope discipline

This document does **not** silently promote P1 features into 1.0. It does three narrower things:

- Adds screens that existing P0 flows already require but the catalogue omitted.
- Adds data-model dimensions that are expensive to retrofit, without automatically adding their 1.x screens.
- Flags optional scope promotions as explicit NTAN decisions.

The 1.0 count rises because the original “48” was an estimate, not a count derived from the 81-screen catalogue. The canonical register makes that visible.

### 1.3 Important counting consequence

The original phase table says `48 + 14 + 16 = 78` (`04-mobile-blueprint.md:299-304`). That is not reproducible from the screen IDs.

The canonical register in this document gives:

- 36 pilot screens (`0.9`).
- 28 additional commercial screens (`1.0`).
- **64 cumulative screens at 1.0**.
- 14 additional screens at 1.1.
- 7 additional screens at 1.2.
- 2 additional screens at 2.0.
- **87 total active screens.**

The earlier 48 was a 1.0 estimate, not a catalogue count. The canonical 1.0 count is 64 cumulative screens (36 pilot + 28 new), which is 16 more than that estimate. The 87 total is the existing 81 plus 6 mandatory dependency screens; the earlier 78 total was a phase-summary bookkeeping error. This is a **counting correction plus dependency completion**, not an unapproved feature expansion. If NTAN requires a hard 48-screen ceiling, a separate scope-cut decision is required.

---

## 2. Canonical screen inventory

### 2.1 Reconciliation of 78 vs 81

The existing catalogue has 81 IDs:

| Group | IDs | Count |
|---|---|---:|
| Authentication/onboarding | AUTH-01..10 | 10 |
| Home | HOME-01..03 | 3 |
| Scan | SCAN-01..03 | 3 |
| Inventory | INV-01..17 | 17 |
| Operations | OPS-01..06 | 6 |
| Projects | PRJ-01..05 | 5 |
| Machines | MCH-01..04 | 4 |
| Reports | REP-01..10 | 10 |
| Administration | ADM-01..23 | 23 |
| **Total** | | **81** |

`04-mobile-blueprint.md:293` says “78 screens.” Section 6 of the same document at `04-mobile-blueprint.md:299-304` totals 78 using approximate phase counts. No three screens are identified as excluded. The difference is therefore a bookkeeping error, not a product decision.

**Resolution:** 81 is the correct count for the existing catalogue. The canonical inventory adds six mandatory missing screens, giving **87 active screens**.

### 2.2 Inventory rules

- Every screen has exactly one ID.
- A screen belongs to exactly one primary navigation area.
- Release labels mean:
  - `R0.9` — pilot / design-partner release.
  - `R1.0` — first commercial release.
  - `R1.1` — operations depth.
  - `R1.2` — industrial specialisation.
  - `R2.0` — intelligence and ecosystem.
- A `1.0` screen is cumulative on top of `R0.9`.
- New mandatory screens are marked **New**.
- Optional/future screens are not included in the 87 count; they are listed in §2.7.

### 2.3 Role and navigation legend

| Code | Role |
|---|---|
| ALL | All authenticated users, permission-filtered |
| UA | Unauthenticated |
| OW | Owner |
| AD | Company Admin |
| IM | Inventory Manager |
| WS | Warehouse Supervisor |
| OP | Warehouse Operator |
| PM | Project Manager |
| TE | Technician |
| PU | Purchasing |
| AU | Auditor |
| AP | Approver |
| SUP | NTAN support (internal, restricted) |

| Navigation label | Meaning |
|---|---|
| Auth | Authentication stack |
| Onboarding | New-company onboarding stack |
| Home | Home tab |
| Scan | Centre Scan tab/modal |
| Inventory | Inventory tab |
| Operations | Operations tab |
| More > Reports | Reports hub under More |
| More > Admin | Administration under More |
| More > Settings | App/user settings |
| More > Sync | Sync Center |
| More > Profile | Personal account |
| Project | Project detail stack |
| Machine | Machine detail stack |

### 2.4 Canonical screen tables

#### Authentication and onboarding — 10 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| AUTH-01 | Bootstrap | ALL | Auth | R0.9 | Session/device/version check |
| AUTH-02 | Welcome | UA | Auth | R0.9 | Value proposition and entry |
| AUTH-03 | Sign In | UA | Auth | R0.9 | Email/phone + OTP/password |
| AUTH-04 | Workspace Select | ALL | Auth | R1.0 | Multi-company membership |
| AUTH-05 | Forgot / Reset | UA | Auth | R0.9 | Recovery |
| AUTH-06 | MFA | OW/AD/opted-in | Auth | R1.0 | Admin MFA required by AC-02 |
| AUTH-07 | Accept Invite | UA invited | Auth | R0.9 | Membership activation |
| AUTH-08 | Onboarding Wizard | OW | Onboarding | R0.9 | Company profile |
| AUTH-09 | Industry Template | OW/AD | Onboarding | R0.9 | Fixed template selection |
| AUTH-10 | Device Trust | ALL | Auth | R1.1 | Device registration/biometrics; FND-09 is P1 |

#### Home and search — 3 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| HOME-01 | Dashboard | ALL | Home | R0.9 | Basic KPI cards; value hidden unless enabled |
| HOME-02 | Notifications | ALL | Home header | R1.0 | In-app inbox + push |
| HOME-03 | Global Search | ALL | Home | R1.0 | Permission-filtered |

#### Scan — 3 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| SCAN-01 | Scanner | ALL with scan capability | Scan | R0.9 | Camera, torch, manual fallback |
| SCAN-02 | Scan Result | ALL | Scan | R0.9 | Permission-filtered actions |
| SCAN-03 | Manual Code Entry | ALL | Scan | R0.9 | Non-camera path |

#### Inventory — 17 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| INV-01 | Inventory List | ALL | Inventory | R0.9 | Stock/available/low-stock |
| INV-02 | Item Detail | ALL | Inventory > Item | R0.9 | Single item truth |
| INV-03 | Item Editor | IM/AD | Inventory > Item | R0.9 | Includes tracking policy |
| INV-04 | Stock by Location | ALL | Inventory > Item | R0.9 | Location/status filter |
| INV-05 | Movement History | ALL (cost gated) | Inventory > Item | R0.9 | Immutable trail |
| INV-06 | Receive | OP/WS/IM/PU | Inventory/Scan | R0.9 | Ad hoc at pilot; PO at 1.0 |
| INV-07 | Issue | OP/WS/IM/PM/TE | Inventory/Scan | R0.9 | Destination and reason |
| INV-08 | Transfer | OP/WS/IM | Inventory/Scan | R0.9 | Dispatch/receive |
| INV-09 | Return | OP/WS/IM/PM/TE | Inventory/Scan | R1.0 | Restock/scrap at 1.0; quarantine UI in 1.1 |
| INV-10 | Adjust | IM/WS | Inventory | R1.0 | Approval above threshold |
| INV-11 | Reserve | IM/PM/WS | Inventory/Project | R1.0 | Project reservations |
| INV-12 | Count List | IM/WS | Inventory > Counts | R1.0 | Sessions and progress |
| INV-13 | Count Session | OP/WS/IM | Inventory > Counts | R1.0 | Entry, scan, blind mode |
| INV-14 | Variance Review | IM/WS/AU | Inventory > Counts | R1.0 | Approval and adjustment |
| INV-15 | Batch/Lot Detail | ALL | Inventory > Lots | R1.1 | Model exists earlier; screen at 1.1 |
| INV-16 | Serial Detail | ALL | Inventory > Serials | R1.1 | Model exists earlier; screen at 1.1 |
| INV-17 | Labels | IM/AD | Inventory > Labels | R1.1 | Generation/printing later |

#### Operations and purchasing — 8 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| OPS-01 | Operations Hub | WS/IM/PM | Operations | R0.9 | Queues and today |
| OPS-02 | Receiving Queue | OP/WS/IM/PU | Operations | R0.9 | Ad hoc only until PO-01/02 |
| OPS-03 | Issue Queue | WS/IM | Operations | R1.0 | Pending issues |
| OPS-04 | Transfer Queue | WS/IM | Operations | R0.9 | In-transit |
| OPS-05 | Approval Inbox | AP/OW/AD/IM/WS | Operations | R1.0 | One decision queue |
| OPS-06 | Approval Detail | AP | Operations | R1.0 | Context and decision |
| PO-01 | Purchase Orders | PU/IM/WS/OW/AD | Operations > Purchase Orders | R1.0 | **New**, minimal list |
| PO-02 | Purchase Order Detail | PU/IM/WS/OW/AD | Operations > Purchase Orders | R1.0 | **New**, header/lines/import; no procurement approvals |

#### Projects — 5 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| PRJ-01 | Projects List | PM/IM/OW | Operations > Projects | R1.0 | Registry and status |
| PRJ-02 | Project Detail | PM/IM/OW/AU | Project | R1.0 | Material summary |
| PRJ-03 | Material Plan | PM/IM | Project | R1.2 | Versioned planned quantities |
| PRJ-04 | Reserve for Project | IM/PM | Project | R1.0 | Reservation flow |
| PRJ-05 | Project Variance | PM/IM/AU | Project | R1.2 | Planned vs issued vs returned |

#### Machines and maintenance — 4 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| MCH-01 | Machines List | ALL operational | Operations > Machines | R1.2 | Asset registry |
| MCH-02 | Machine Detail | ALL operational | Machine | R1.2 | Context and spares |
| MCH-03 | Maintenance Job | TE/WS/IM | Machine > Job | R1.2 | Job execution |
| MCH-04 | Job Parts | TE/WS/IM | Machine > Job | R1.2 | Part consumption/return |

#### Reports — 10 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| REP-01 | Reports Hub | ALL with report cap | More > Reports | R0.9 | Discover reports |
| REP-02 | Stock on Hand | ALL | More > Reports | R0.9 | Quantity; cost gated |
| REP-03 | Movement Ledger | ALL | More > Reports | R0.9 | Auditable trail |
| REP-04 | Valuation | OW/IM/AU | More > Reports | R1.1 | Cost method; value hidden in 1.0 |
| REP-05 | Aging | OW/IM | More > Reports | R1.1 | Age buckets |
| REP-06 | Consumption | OW/IM/PM | More > Reports | R1.1 | Usage analysis |
| REP-07 | Dead Stock | OW/IM | More > Reports | R1.2 | No-movement analysis |
| REP-08 | Shortage Risk | IM/PM/PU | More > Reports | R2.0 | Reorder/lead-time risk |
| REP-09 | Traceability | AU/IM | More > Reports | R1.1 | Lot/serial trace |
| REP-10 | Export / Share | OW/AD/IM/AU | More > Reports | R1.0 | Basic CSV/PDF export |

#### Sync Trust Center — 2 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| SYNC-01 | Sync Center | ALL (own); WS/AD (company) | Home sync banner / More > Sync | R1.0 | **New**, operation/outbox list |
| SYNC-02 | Conflict Detail | ALL (own); WS/AD (company) | More > Sync > Conflict | R1.0 | **New**, side-by-side resolution |

#### Customers — 2 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| CUS-01 | Customers | PM/IM/OW/PU | Operations > Customers | R1.0 | **New**, minimal list |
| CUS-02 | Customer Detail | PM/IM/OW/PU | Operations > Customers | R1.0 | **New**, profile/projects/issues |

#### Administration — 23 screens

| ID | Screen | Access | Navigation | Release | Note |
|---|---|---|---|---|---|
| ADM-01 | More Menu | ALL | More | R0.9 | Secondary areas |
| ADM-02 | Company Profile | OW/AD | More > Admin | R0.9 | Identity/defaults |
| ADM-03 | Users | OW/AD | More > Admin | R0.9 | Team list |
| ADM-04 | User Detail / Invite | OW/AD | More > Admin | R0.9 | Invite/edit |
| ADM-05 | Roles & Permissions | OW/AD | More > Admin | R0.9 | Capability bundles |
| ADM-06 | Warehouses | OW/AD | More > Admin | R0.9 | Sites |
| ADM-07 | Locations | OW/AD/IM | More > Admin | R0.9 | Location tree |
| ADM-08 | Suppliers | AD/PU | More > Admin | R0.9 | Supplier profiles |
| ADM-09 | Categories & Attributes | AD/IM | More > Admin | R1.0 | Catalogue structure |
| ADM-10 | Custom Fields | AD | More > Admin | R1.0 | Item extensions |
| ADM-11 | Workflow Templates | OW/AD | More > Admin | R1.1 | Templates applied during onboarding at 1.0; this screen/editor at 1.1 |
| ADM-12 | Approval Rules | OW/AD | More > Admin | R1.0 | Minimal thresholds/settings at 1.0; full rule editor 1.1 |
| ADM-13 | Label & Scan Settings | AD | More > Admin | R1.1 | Barcode/label config |
| ADM-14 | Subscription & Billing | OW | More > Admin | R1.1 | Manual invoicing at 1.0 |
| ADM-15 | Usage & Limits | OW/AD | More > Admin | R1.1 | Plan consumption |
| ADM-16 | Integrations | OW/AD | More > Admin | R2.0 | Limited connector at 1.2 only by decision |
| ADM-17 | Data Import | AD/IM | More > Admin | R1.0 | Basic CSV at 1.0; guided 1.1 |
| ADM-18 | Data Export | OW/AD/AU | More > Admin | R1.0 | Basic export; scheduled later |
| ADM-19 | Audit Log | OW/AD/AU | More > Admin | R0.9 | Immutable audit |
| ADM-20 | Security Settings | OW/AD | More > Admin | R1.1 | Session/device policy |
| ADM-21 | Help Desk | ALL | More > Help | R1.1 | FAQ/contact/diagnostics |
| ADM-22 | Settings | ALL | More > Settings | R0.9 | App preferences |
| ADM-23 | Profile / Account | ALL | More > Profile | R0.9 | Personal account |

### 2.5 Count summary

| Group | R0.9 | R1.0 | R1.1 | R1.2 | R2.0 | Total |
|---|---:|---:|---:|---:|---:|---:|
| Auth | 7 | 2 | 1 | 0 | 0 | 10 |
| Home | 1 | 2 | 0 | 0 | 0 | 3 |
| Scan | 3 | 0 | 0 | 0 | 0 | 3 |
| Inventory | 8 | 6 | 3 | 0 | 0 | 17 |
| Operations + PO | 3 | 5 | 0 | 0 | 0 | 8 |
| Projects | 0 | 3 | 0 | 2 | 0 | 5 |
| Machines | 0 | 0 | 0 | 4 | 0 | 4 |
| Reports | 3 | 1 | 4 | 1 | 1 | 10 |
| Sync | 0 | 2 | 0 | 0 | 0 | 2 |
| Customers | 0 | 2 | 0 | 0 | 0 | 2 |
| Administration | 11 | 5 | 6 | 0 | 1 | 23 |
| **Total** | **36** | **28** | **14** | **7** | **2** | **87** |

Cumulative totals: pilot 36; commercial 64; 1.1 78; 1.2 85; 2.0 87.

The pilot count includes four shell/account screens (`AUTH-01`, `ADM-01`, `ADM-22`, `ADM-23`); the substantive workflow count is 32. This is why the 36 pilot total is compatible with the earlier 30–35 workflow estimate.

### 2.6 Mandatory missing screen specifications

#### SYNC-01 — Sync Center (R1.0)

- **Purpose:** give users and supervisors one truthful view of drafts, queued operations, applied operations, rejected operations and conflicts.
- **Roles:** all users see their own operations; WS/AD/IM see company/location scope; support read-only with consent.
- **Navigation:** Home sync banner and More > Sync.
- **Content:** status counts; operation type; created/applied time; device; source document; error reason; retry/cancel where safe.
- **Actions:** filter; open conflict; retry transient failure; cancel a queued operation before application; export diagnostics (admin).
- **States:** empty, draft, queued, syncing, applied, rejected, conflict, expired.
- **Forbidden:** bulk override of stock conflicts; editing applied operations; hiding rejected operations.
- **Dependencies:** FND-12, SYNC-02, audit, offline outbox.

#### SYNC-02 — Conflict Detail (R1.0)

- **Purpose:** resolve a server/device mismatch without silent overwrite.
- **Roles:** operation owner; supervisor/admin for company scope; no self-approval of privileged overrides.
- **Navigation:** Sync Center > conflict.
- **Content:** device value, server value, timestamps, actor, source document, current stock, suggested options.
- **Actions:** accept server; reduce quantity; choose another location/lot; transfer stock; cancel; re-authenticate; escalate.
- **States:** pending, resolved, cancelled, escalated, expired.
- **Forbidden:** last-write-wins; bulk stock override; resolution without audit.
- **Dependencies:** inventory invariants, approval engine for privileged override, audit.

#### PO-01 — Purchase Orders (R1.0, minimal)

- **Purpose:** provide the open PO source that receiving already assumes.
- **Roles:** PU/IM/WS/OW/AD; read scope by location.
- **Navigation:** Operations > Purchase Orders.
- **Content:** PO number, supplier, date, status, line count, ordered/received/remaining, expected date.
- **Actions:** search/filter; open; create/import (minimal); start receiving.
- **States:** empty, open, partially received, closed, cancelled.
- **Scope limit:** no RFQ, supplier portal, landed cost, multi-level approval or accounting integration in 1.0.
- **Dependencies:** supplier, item, receipt, location.

#### PO-02 — Purchase Order Detail (R1.0, minimal)

- **Purpose:** show and edit the minimum PO header and lines needed for receiving.
- **Roles:** PU/IM/WS/OW/AD.
- **Navigation:** Operations > Purchase Orders > Detail.
- **Content:** supplier, PO number, dates, lines, item/UOM/ordered/received/remaining, notes.
- **Actions:** create/edit draft; add/edit/remove lines; import lines; open receive; close/cancel if allowed.
- **States:** draft, open, partial, closed, cancelled, rejected.
- **Validations:** supplier required; item active; qty > 0; no over-receipt unless policy; location scope.
- **Dependencies:** PO-01, INV-06, ADM-08.

#### CUS-01 — Customers (R1.0, minimal)

- **Purpose:** provide the customer record required by issue-to-customer and project context.
- **Roles:** PM/IM/OW/PU; technician read via project only.
- **Navigation:** Operations > Customers.
- **Content:** name, code, contact, status, open projects, recent issues/returns.
- **Actions:** search/filter; create/edit; archive if unused.
- **States:** empty, active, archived.
- **Scope limit:** not a CRM; no sales pipeline, billing or portal.
- **Dependencies:** party model, project, issue, return.

#### CUS-02 — Customer Detail (R1.0, minimal)

- **Purpose:** show customer context without turning the product into a CRM.
- **Roles:** PM/IM/OW/PU.
- **Navigation:** Operations > Customers > Detail.
- **Content:** identity, contacts, projects, issues, returns, notes.
- **Actions:** edit; open project; issue/return; archive.
- **States:** active, archived, no projects.
- **Dependencies:** CUS-01, PRJ-01, INV-07, INV-09.

### 2.7 Optional and future screens

These are **not** included in the 87 active screens. They are candidates for later releases or conditional scope.

| ID | Screen | Proposed release | Why optional |
|---|---|---|---|
| SYNC-03 | Sync Diagnostics | R1.1 | Advanced support bundle; SYNC-01/02 satisfy user trust. |
| PO-03 | PO Import/Export | R1.1 | Basic CSV import can cover 1.0; procurement depth is 1.1. |
| CUS-03 | Customer Sites | R1.2 | Needed for project-site/consignment stock only if validated. |
| ADM-24 | Devices & Sessions | R1.1 | FND-09; minimal device registration can be implicit earlier. |
| ADM-25 | Reason Codes | R1.1 | Seed codes at launch; editor later. |
| ADM-26 | Document Numbering | R1.1 | Fixed prefixes at launch; configurable later. |
| INV-18 | Quarantine / Stock Status | R1.1 | Status dimension in model at 1.0; dedicated management screen later. |

Machine/quality/kanban/manufacturing/maintenance modules will add further screens in 1.2 and 2.0; they are not enumerated here because their current IDs are feature IDs, not screen IDs.

---

## 3. Conceptual inventory data model

This is a conceptual model for decisions and API design. It is **not** a database schema and must not be implemented until the database decision is recorded.

### 3.1 Entity overview

| Entity | Purpose | Key attributes | Key rules |
|---|---|---|---|
| Company / Tenant | Isolation boundary | id, name, currency, timezone, status | Every business entity carries company scope. |
| Product | Catalogue parent, not stockable | id, name, category, brand, attributes, status | Optional grouping; does not hold stock. |
| Item / Variant | Stockable SKU | id, product_id, SKU, name, item_type, base_uom, tracking_mode, cost, status | Unique SKU per company; stock is always against an Item. |
| Item Type | Behaviour class | stocked material, component, spare, sub-assembly, finished good, consumable | Determines defaults, not hardcoded vertical behaviour. |
| Category / Attribute | Catalogue structure | tree, typed attributes, validation | Attributes may be custom; no destructive delete. |
| UOM | Unit definition | code, name, precision, status | Base UOM per item. |
| UOM Conversion | Purchase/issue conversion | item_id, from_uom, to_uom, factor, version, effective dates | Historical movements retain the factor used. |
| Warehouse | Physical site | id, name, address, status | A company may have many warehouses. |
| Location | Tree node inside a warehouse | id, warehouse_id, parent_id, code, type, status, restrictions | Types include receiving, main, line-side, quarantine, finished goods. |
| Party | Supplier/customer identity | id, type, name, contacts, terms, status | Minimal customer and supplier records; no CRM. |
| Lot / Batch | Traceability group | id, item_id, lot_code, supplier_lot, manufacture_date, expiry_date, status | Unique per company/item/lot code. |
| Serial | Unique unit | id, item_id, serial_no, lot_id, status, current_location_id | Unique per company/item; one active location/state. |
| Stock Balance | Quantity projection | company, item, location, lot, serial, stock_status, on_hand, reserved, in_transit, available, version | Derived from movements and reservation events; never directly edited. |
| Stock Movement | Immutable quantity change | id, type, item, quantity_delta, uom, base_qty, from/to location, lot, serial, status, source, actor, occurred_at, recorded_at, reason, reversal_of, idempotency_key | Append-only; correction by counter-entry. |
| Reservation | Hold against stock | id, item, location, lot, serial, quantity, target, type, state, expires_at, priority, requester | Reduces available, not on-hand; cannot be consumed twice. |
| Reservation Event | Reservation history | reservation_id, event_type, quantity, actor, time, reason | Created, consumed, released, expired, adjusted. |
| Allocation | Link to project/machine/work order/department/customer | id, target_type, target_id, quantity, source_reservation/movement | One ledger; modules read/write through core. |
| Source Document | Business document | type, number, status, party, dates, lines, actor | Receipt, issue, transfer, return, adjustment, count, PO. |
| Approval Request | Decision request | action, source document, threshold, requester, status, approver | Separate from stock movement. |
| Approval Decision | Approver action | request_id, approver, decision, reason, time | Immutable; audited. |
| Audit Event | Who changed what | actor, device, entity, before/after, reason, request_id, time | Append-only; retention policy. |
| Sync Operation | Client intent/idempotency | client_operation_id, idempotency_key, aggregate, payload, state, attempts | Server applies at most once. |
| Attachment | Evidence/document | owner, type, storage key, checksum, status | Tenant-scoped; signed URLs. |

### 3.2 Relationship sketch

```text
Company
  ├── Product 1──n Item/Variant
  ├── Item 1──n UOM Conversion
  ├── Item 1──n Lot
  ├── Item 1──n Serial
  ├── Warehouse 1──n Location
  ├── Party (Supplier/Customer)
  ├── Allocation Target (Project/Machine/Work Order/Department/Customer)
  ├── Source Document 1──n Source Document Line
  └── Stock Movement ──> Stock Balance projection
        ├── Reservation ──> Reservation Event
        └── Allocation ──> Allocation Target
```

### 3.3 Product and variant model

- **Product** is an optional catalogue parent: a family, brand or specification grouping.
- **Item/Variant** is the stockable SKU. All stock, reservations, costs and movements attach to an Item.
- A flat catalogue is allowed: `product_id` may be null. This avoids forcing every SMB to maintain a two-level catalogue.
- A variant cannot be converted into a different tracking mode after it has stock or movement history. Create a new item instead.
- Services are out of scope; they are not stockable Items.

### 3.4 Units of measure

- Each item has one base UOM used for ledger quantities.
- Purchase and issue UOMs convert to the base UOM through versioned, item-specific factors.
- A movement stores:
  - entered quantity and UOM;
  - converted base quantity;
  - conversion factor/version used.
- Quantity precision is per item or category; define decimal places and rounding.
- Historical movements must never be reinterpreted by changing a conversion factor.
- Rounding rules must be explicit for fractional issue (for example, cable length or weight).

### 3.5 Warehouses and locations

- A warehouse is a physical site.
- Locations form a tree beneath a warehouse.
- Location types include receiving, main store, line-side, quarantine, finished goods and project site.
- `in_transit` is a transfer state/balance bucket, not a fake physical bin.
- Location restrictions (allowed categories) are future/P2.
- Archiving a location with stock is forbidden.
- Project-site stock and consignment are **not** modelled by default in 1.0; they require a validated decision (see CUS-03 and the data-model decisions).

### 3.6 Lots and serials

- `tracking_mode` on Item: `none`, `lot`, `serial`.
- Lot:
  - belongs to one item;
  - has a lot code unique per company/item;
  - may have supplier lot, manufacture date and expiry;
  - quantity is tracked per location and status.
- Serial:
  - belongs to one item;
  - has a serial number unique per company/item;
  - may belong to a lot;
  - has one active location/state at a time;
  - quantity is effectively 1 per active serial balance.
- Lot/serial validation is server-authoritative. Local checks are advisory.
- The data model includes lot/serial dimensions from the start; the dedicated detail screens remain 1.1 unless NTAN explicitly promotes them.

### 3.7 Stock balances

A balance is a projection with a unique dimension:

`company + item + location + lot + serial + stock_status`

Quantities:

- `on_hand` — physically present and owned.
- `reserved` — active reservation quantity.
- `in_transit` — dispatched but not received.
- `blocked` — held out of available (quarantine/inspection/quality).
- `available = on_hand − reserved − blocked`.

Rules:

- Balances are never edited directly.
- Every balance change is caused by a movement or reservation event.
- Balances have a version for optimistic concurrency.
- Reconciliation compares movement sums with projected balances and alerts on drift.
- Serialized balances have quantity 0 or 1 per serial.
- A balance may not go negative unless the company policy explicitly allows it and records a reason and permission.

### 3.8 Reservations and allocation

A reservation is an intent, not a movement:

- It reduces `available`, not `on_hand`.
- It targets an item/location/lot/serial and an allocation target.
- It has a state: active, partially consumed, consumed, released, expired, cancelled.
- It may be hard (committed allocation) or soft (recommended allocation); the default for project reservations should be hard.
- It must not be consumed twice.
- It must not exceed available unless a privileged override is recorded and audited.
- Expiry is optional; stale reservations require review rather than silent release.

Allocation targets:

- project (1.0);
- department (1.0);
- customer (1.0);
- machine (1.2);
- work order (1.2).

Use a generic target type/id so the core ledger does not depend on the machine or manufacturing modules.

### 3.9 Immutable stock movements

A movement is one immutable ledger line. Required fields:

- movement id;
- company;
- movement type;
- item;
- quantity delta in base UOM;
- entered quantity/UOM and conversion version;
- from location and/or to location;
- lot/serial where applicable;
- stock status;
- allocation target where applicable;
- source document type/id/line;
- actor, device, occurred_at, recorded_at;
- reason code where required;
- idempotency key;
- reversal_of movement id where applicable;
- optional cost data (permission-gated).

Movement types:

- opening balance;
- receipt;
- put-away;
- issue/consumption;
- transfer out;
- transfer in;
- project/customer return;
- supplier return;
- adjustment increase/decrease;
- count adjustment;
- scrap;
- quarantine/release;
- reversal.

Rules:

- No update or delete after posting.
- Corrections are counter-entries linked to the original.
- A transfer produces two location movements linked by the transfer document, so each location reconciles independently.
- A movement always has a source document, actor and recorded time.
- Business time (`occurred_at`) and system time (`recorded_at`) are separate.

### 3.10 Source documents

Minimum document types:

| Document | Purpose | Minimum statuses |
|---|---|---|
| Purchase Order | Expected supply | draft, open, partial, closed, cancelled |
| Goods Receipt | Inbound stock | draft, queued, applied, rejected |
| Put-away | Destination assignment | pending, applied |
| Issue | Consumption to allocation target | draft, queued, applied, rejected |
| Transfer | Location movement | draft, dispatched, partially received, received, cancelled |
| Return | Return from project/customer | draft, queued, applied, rejected |
| Adjustment | Quantity correction | draft, pending approval, approved, rejected, applied |
| Count Session | Physical count | draft, counting, submitted, review, approved, rejected, closed |

### 3.11 Data-model invariants

1. Every stock change is a movement; balances are projections.
2. `on_hand = sum(signed movements)` for the same dimension.
3. `reserved = sum(active reservation quantities)`.
4. `available = on_hand − reserved − blocked`.
5. A serial has at most one active location/state.
6. A reservation cannot be consumed twice.
7. A posted movement cannot be edited or deleted.
8. Every movement has an actor, source document and recorded time.
9. Every mutation is idempotent by client operation key.
10. Historical UOM conversions are never reinterpreted.
11. No tenant can read or mutate another tenant’s data.
12. Negative stock requires an explicit policy, permission, reason and audit.

### 3.12 Data-model decisions requiring approval

| Decision | Recommended default | Alternative | Risk if unresolved |
|---|---|---|---|
| Product vs flat item | Flat item with optional product parent | Mandatory two-level product/variant | Catalogue migration and UX complexity |
| Serial uniqueness | Company + item | Global company serial | Cross-item collisions or false rejection |
| Lot uniqueness | Company + item + lot code | Company-wide lot code | Supplier lot collisions |
| Tracking-mode change | Forbidden after stock/history | Allow with migration | Ledger ambiguity |
| Stock status values | available, quarantine, blocked | More granular QA states | Availability ambiguity |
| In-transit model | Transfer state, not location | Virtual in-transit location | Fake bins and reconciliation drift |
| Reservation default | Hard for projects; soft for planning | All soft | Oversell or over-hold |
| Reservation expiry | Optional; review stale | Auto-expire | Silent release of committed material |
| Project-site stock | Not in 1.0; validate | Project-site location/consignment | Incorrect on-hand and ownership |
| Negative stock | Block by default | Warn or allow | Unreconciled shortages |
| Cost at 1.0 | Hidden; valuation at 1.1 | Basic standard/last cost at 1.0 | Owner value gap or scope growth |
| UOM precision | Per item; explicit rounding | Global precision | Fractional-unit errors |
| Opening balance | Explicit source document | Direct balance import | Unauditable starting stock |

---

## 4. Approvals: minimum infrastructure for 1.0

### 4.1 The dependency problem

The existing documents require approval for P0 adjustments and counts (`03-feature-blueprint.md:116`, `03-feature-blueprint.md:142`, `03-feature-blueprint.md:586-587`) while placing configurable approval rules at P1 (`03-feature-blueprint.md:153`, `04-mobile-blueprint.md:280`). That cannot work: a P0 acceptance criterion cannot depend on a P1 engine.

### 4.2 Resolution

Introduce a core approval primitive:

- **`APR-01` — Approval Request Engine (P0).** Single-step request, decision, audit and notification.
- **`APR-02` — Approval Settings (P0 minimal).** Threshold and approver-role configuration for inventory actions.
- **`VIS-03` — Full Approval Rules (P1).** Multi-level, escalation, delegation, conditions and templates.
- **`ADM-12` — Approval Rules screen.** Minimal settings at 1.0; full editor at 1.1.

This is a dependency correction, not a new module. The primitive is small and is required by existing P0 acceptance criteria.

### 4.3 Minimum 1.0 approval scope

Supported actions:

- Adjustment above a company threshold.
- Count variance above a company threshold.
- Negative-stock override, if negative stock is ever allowed.
- Privileged issue override, if configured.
- Stock-status release from quarantine, if quarantine UI is enabled (otherwise 1.1).

Minimum configuration:

- action type;
- threshold (value and/or quantity/percentage);
- required approver capability or role;
- location scope;
- active/inactive;
- default fallback when no approver is available.

Minimum behaviour:

- Requester submits; request enters `pending`.
- Eligible approver sees it in `OPS-05`.
- Approver opens `OPS-06`, sees source document, before/after, evidence and reason.
- Approve posts the underlying movement exactly once.
- Reject posts nothing and records the reason.
- Requester cannot approve their own request by default.
- If no eligible approver exists, the request escalates to the owner with an explicit, audited override; it must not auto-approve silently.
- Decisions are online-only.
- Every request and decision is audited.
- Idempotency prevents double posting.

### 4.4 Approval states

`not_required` → `pending` → `approved` / `rejected` / `cancelled` / `expired`.

A request may also be `escalated` if no eligible approver exists.

### 4.5 Threshold fallback when cost is unavailable

If 1.0 hides valuation and stores no usable cost:

- Use quantity or percentage thresholds for adjustments/counts.
- Or require approval for every adjustment above a low quantity.
- Do not invent a monetary threshold without a cost basis.

### 4.6 Deferred to 1.1

- Multi-level approval.
- Delegation and out-of-office.
- Escalation timers.
- Parallel approvers.
- Conditional rules by item/category/project/supplier.
- Purchase-order approvals.
- Approval templates.
- Approval of role/security changes through the same engine.

### 4.7 Approval acceptance criteria

- An adjustment above threshold cannot post without an approved request.
- A count variance above threshold cannot post without an approved request.
- The creator cannot approve their own request by default.
- A rejected request produces no stock movement.
- An approved request produces exactly one movement/audit pair.
- Offline approval decisions are blocked with a clear message.
- Location scope and capability checks are enforced server-side.
- Every request/decision is visible in the audit log.

---

## 5. Offline authority matrix

### 5.1 Authority classes

| Class | Meaning | Stock authority |
|---|---|---|
| **Online-required (OR)** | Cannot complete without the server. | Server only |
| **Offline-draft (OD)** | Captured locally as an editable draft; not submitted. | None |
| **Offline-queued (OQ)** | Submitted locally to the outbox; server validates later. | None until applied |
| **Safely offline-executable (SO)** | Local, non-authoritative action that does not change stock. | None over stock |

**Critical rule:** no stock-affecting operation is `SO`. “Safely offline-executable” covers cached reads, local notes, local label generation and local preferences only.

### 5.2 Operation matrix

| Operation | Class | Offline behaviour | Server validation | Conflict handling |
|---|---|---|---|---|
| Sign in / refresh session | OR | Cached session may continue until expiry; re-auth when expired | Credentials, session, device | Re-authenticate; no silent session extension |
| Scan known item / cached lookup | SO | Resolve from cache with “as of” timestamp | None for read; server refresh later | Stale item warning; no stock authority |
| Global search | SO | Cache-only results | Permission filter on refresh | Show stale label |
| Scan unknown code / create item | OD → OQ | Capture code/photo/notes; create item draft | SKU/barcode uniqueness, permissions | Duplicate item; show existing |
| Item create/edit | OD → OQ | Draft locally; queue on submit | Uniqueness, custom fields, tracking policy | Validation drift; edit and retry |
| Item image/attachment | OD → OQ | Capture/compress locally; queue upload | Type/size/virus policy | Retry; reject unsafe file |
| Receive draft | OD | Add lines, qty, lot/serial if enabled, photos | — | Local advisory only |
| Receive submit | OQ | Queue; show “Queued — not applied” | PO status, over-receipt, lot/serial, location | PO closed, qty mismatch, duplicate receipt |
| Put-away | OQ | Queue destination | Location validity, capacity policy | Location changed; choose again |
| Issue draft | OD | Destination, qty, reason | — | Local advisory only |
| Issue submit | OQ | Queue | Availability, reservation, lot/serial, permission | Insufficient stock, reservation lost, project closed |
| Transfer draft | OD | From/to, lines, qty | — | Local advisory only |
| Transfer dispatch | OQ | Queue dispatch | Source available, state | Source consumed; reduce/cancel |
| Transfer receive | OQ | Queue receipt | In-transit quantity, destination | Partial/over-receipt; discrepancy |
| Return | OD → OQ | Queue return, condition, disposition | Returnable qty, condition, status | Already returned; quantity mismatch |
| Adjustment | OD → OQ | Queue request | Threshold, permission, approval | Approval required; reject |
| Reservation create/release | OD → OQ | Queue intent | Available, target, expiry | Reservation race; re-reserve |
| Count session create | OR | Server creates session/scope | Scope overlap, permission | Overlapping session; choose another |
| Count line entry | OQ | Queue counted lines | Item in scope, duplicate line | Item moved; conflict at review |
| Count submit | OQ | Queue submission | Completeness, scope | Scope changed; new session |
| Count variance approval | OR | Not allowed offline | Threshold, segregation, permission | Decision conflict; re-open |
| Approval decision | OR | Not allowed offline | Approver capability, state, segregation | Already decided; show final |
| Negative-stock override | OR | Not allowed offline | Permission, reason, policy | Reject; no offline authority |
| PO create/edit/import | OD → OQ | Draft/import locally; queue | Supplier, item, qty, numbering | Duplicate PO; validation drift |
| Customer create/edit | OD → OQ | Draft locally; queue | Uniqueness, required fields | Duplicate; merge/correct |
| Project create/edit | OD → OQ | Draft locally; queue | Code unique, manager, dates | Duplicate code; project closed |
| Stock status/quarantine change | OQ | Queue status change | Permission, current status, reason | Status changed; re-review |
| Label generation | SO | Generate local PDF/PNG | None for local generation | Printer unavailable; share later |
| Report view | SO | Cached snapshot with “as of” | Permission on refresh | Stale banner |
| Export | OR | Not allowed offline | Permission, row limits, audit | Retry online |
| Sync conflict resolution | OR | Not allowed offline | Permission, current state | Re-open; no bulk override |
| Notifications | SO | Cached inbox | Permission on refresh | Stale notification |
| User/role/security/billing/integration changes | OR | Blocked offline | Capability, policy | Re-auth; no local change |
| Device registration | OR | Blocked offline | Device/session policy | Retry online |
| App settings | SO | Local preferences | Sync user preference later | Local only |
| Audit log view | SO | Cached; export online | Permission | Stale label; export online |
| File upload | OD → OQ | Compress and queue | Type/size/scanning | Retry; quarantine unsafe file |
| Project summary view | SO | Cached | Permission on refresh | Stale banner |

### 5.3 Synchronization states

| State | Meaning | UI label |
|---|---|---|
| `draft` | Local editable, not submitted | Draft |
| `queued` | Submitted to outbox, not sent/applied | Queued — not applied |
| `syncing` | In flight | Syncing |
| `applied` | Server accepted and posted | Applied |
| `rejected` | Server refused; no stock effect | Rejected |
| `conflict` | Human decision required | Conflict |
| `cancelled` | User cancelled before application | Cancelled |
| `expired` | Operation/attachment/session expired | Expired |
| `needs_attention` | Retry failed or validation requires review | Needs attention |

Allowed transitions:

`draft → queued → syncing → applied`
`draft → cancelled`
`queued → cancelled` (before server acceptance)
`queued → syncing → rejected`
`queued → syncing → conflict → resolved/rejected/cancelled`
`queued → expired`

### 5.4 Conflict taxonomy

| Conflict | Detection | Resolution options | Who resolves |
|---|---|---|---|
| Duplicate retry | Idempotency key exists | Return original result | System |
| Insufficient stock | Server availability check | Reduce, transfer, cancel, privileged override | Owner/authorised supervisor |
| Stale item/location | Version mismatch | Accept server, reapply, choose another | Operation owner |
| Reservation race | Available changed | Re-reserve, reduce, cancel | Owner/supervisor |
| Serial received twice | Unique serial violation | Show existing receipt; choose another | Operator/supervisor |
| Lot/expiry rule | Lot invalid/expired | Choose another lot or request override | Supervisor |
| Count scope conflict | Scope changed/overlap | New session or review | Inventory manager |
| PO closed/over-receipt | PO state violation | Link to another PO, reduce, cancel | Purchasing/manager |
| Project closed | Project state violation | Reallocate, cancel, reopen if permitted | Project manager |
| Permission changed | 403 at sync | Re-authenticate; reject | User/admin |
| Validation drift | Schema/custom field changed | Edit and retry | User |
| Approval race | Request already decided | Show final state | Approver |

Rules:

- No last-write-wins on stock.
- No bulk stock-conflict override.
- Both device and server values are retained.
- Resolution is audited.
- Server time is authoritative; device time is recorded but not trusted for ordering.

### 5.5 Offline data and session rules

- Local storage: SQLite or equivalent; encrypted at rest where supported.
- Tokens in Keychain/Keystore; never in the bundle.
- Offline session default: 7 days; revocable remotely.
- Cache is scoped per company; sign-out warns if drafts exist.
- Drafts survive app kill/restart.
- Attachments are compressed and queued; storage warnings at a defined threshold.
- Remote sign-out invalidates refresh tokens and clears cache on next launch.
- Idempotency keys retained at least 90 days; audit retention follows company policy.
- No sensitive payloads in logs, analytics or diagnostics.

---

## 6. Database decision record

### 6.1 ADR-004 — Primary database

| Field | Value |
|---|---|
| Status | **Proposed — subject to NTAN management approval** |
| Date | 2026-10-22 |
| Decision owner | NTAN management |
| Technical owner | Backend/architecture lead |
| Related | `05-technical-architecture.md`, D-01 |
| Decision | PostgreSQL is conditionally recommended as the transactional system of record. |
| Not decided | Final approval, hosting vendor, region and budget. |

### 6.2 Context

The product is an inventory system of record with:

- concurrent receipts, issues, transfers and reservations;
- an immutable ledger and derived balances;
- multi-tenant isolation;
- project allocation and audit;
- operational and financial reporting;
- custom fields and industry templates;
- offline clients that retry operations.

The hard problems are transactions, concurrency, tenant isolation, reconciliation and reporting, not document storage.

### 6.3 Trade-off summary

| Criterion | PostgreSQL | MongoDB | Inventory implication |
|---|---|---|---|
| Multi-row transactions | Native, mature | Supported, requires replica set and disciplined retries | Receipt/transfer/count posting is simpler in PostgreSQL |
| Reservation race | Conditional update/row lock | Single-document atomic guard, but multi-document set needs transaction | PostgreSQL has the clearer default |
| Reporting | Joins, CTEs, window functions, materialised views, read replicas | Aggregation pipeline or separate read models | PostgreSQL fits stock/valuation/project reports better |
| Tenant isolation | RLS plus app guard | App-enforced filters or database-per-tenant | PostgreSQL provides defense in depth |
| Custom fields | JSONB + GIN indexes | Native flexible documents | Both work; PostgreSQL is sufficient |
| Schema evolution | Migrations | Application-managed validation/migrations | PostgreSQL is more constrained but more predictable |
| Horizontal write scale | Vertical/read replicas; Citus if needed | Native sharding | MongoDB stronger at extreme scale; not the initial constraint |
| Operational familiarity | Broad managed services and SQL talent | Strong if team has MongoDB operations experience | Depends on NTAN team |
| Audit/append-only | Privileges, triggers, partitioning | Application enforcement, indexes | PostgreSQL easier to enforce |
| Backup/PITR | Mature managed options | Mature Atlas options | Both viable; cost/region must be checked |

### 6.4 Scenario comparison

| Scenario | PostgreSQL | MongoDB | Risk judgment |
|---|---|---|---|
| Two operators receive the same SKU simultaneously | One transaction updates receipt, movement, balance, PO and audit | Multi-document transaction or compensation | PostgreSQL lower risk |
| Reservation races with issue | `UPDATE ... WHERE available >= qty` or serializable transaction | Atomic balance update plus transaction for reservation/ledger/audit | PostgreSQL lower risk |
| Warehouse transfer dispatch/receive | Multi-row transaction and explicit state machine | Transaction per step or saga | PostgreSQL lower risk |
| Count approval posts adjustments | One transaction for approval, lines, movements, audit, outbox | Multi-document transaction with unique decision index | PostgreSQL lower risk |
| Duplicate offline retry | Unique `(company_id, idempotency_key)` | Unique compound index | Equivalent |
| Stock value/aging/project variance | SQL joins/CTEs/window functions | Aggregation or read models | PostgreSQL lower risk |
| Tenant isolation | RLS + app guard + tests | App guard or database-per-tenant | PostgreSQL lower risk |
| Custom fields/templates | JSONB + typed validation | Native documents | MongoDB advantage, not decisive |
| Extreme write scale | Partition/read replicas; Citus later | Native sharding | MongoDB advantage, not initial need |
| Backup/restore | Managed PITR and SQL tooling | Atlas PITR | Both viable |

### 6.5 Recommendation

**Conditional recommendation: PostgreSQL.**

Conditions:

1. One-week spike covering concurrency, reservations, RLS, JSONB custom fields, a 10k-item/100k-movement report query and restore.
2. Confirmed managed PostgreSQL availability, latency and cost in the required India region.
3. Confirmed team capability or managed support budget.
4. RLS plus application-level tenant guard; the application role must not bypass RLS.
5. Append-only ledger enforced through privileges/triggers; no `UPDATE`/`DELETE` on posted movements.
6. Partitioning strategy for movement/audit tables.
7. Read replica or materialised views for reporting, with freshness indicators.
8. Decision recorded in Doc 07 and ADR-004 before schema work.

### 6.6 When MongoDB would be the better choice

MongoDB is defensible if all of the following are true:

- NTAN has proven MongoDB operational expertise.
- The team commits to multi-document transactions for every stock path.
- A daily reconciliation job and drift alerts are funded.
- Tenant isolation is database-per-tenant or rigorously tested.
- Reporting is offloaded to read models from day one.
- The expected scale genuinely requires horizontal sharding.

Without those conditions, MongoDB shifts too much correctness work into application discipline.

### 6.7 Hybrid

Hybrid is not recommended for the initial product. It adds operational complexity before the core is proven. Revisit only if a concrete document/telemetry workload emerges that PostgreSQL cannot serve economically.

### 6.8 Final approval

The final choice remains **subject to NTAN management approval**. No schema, migration or production database provisioning may begin before that approval is recorded.

---

## 7. Release-priority reconciliation

### 7.1 Release model

| Release | Intent | Included in canonical register |
|---|---|---|
| R0.9 | Design-partner pilot; single company/warehouse; core loop | 36 screens |
| R1.0 | First commercial release; projects, counts, approvals, minimal PO/customer/sync | 64 cumulative (28 new) |
| R1.1 | Operations depth; lot/serial screens, valuation/aging, labels, full approval rules, guided import, devices, billing | 78 cumulative (14 new) |
| R1.2 | Industrial specialisation; machines, maintenance, quality, kanban, light manufacturing, component passport, project plans/variance | 85 cumulative (7 new) |
| R2.0 | Intelligence and ecosystem; insights, integrations, advanced reporting, multi-currency, localisation | 87 cumulative (2 new) |

### 7.2 Dependency and conflict register

| Area | Baseline problem | Gate 0 resolution | Approval needed |
|---|---|---|---|
| Screen count | 78 stated; 81 actual | Adopt 87-screen canonical register; 78 was an error | Yes |
| 1.0 size | 48 estimated; actual P0 mapping is larger | Publish 64 cumulative; if 48 is a hard cap, run a cut workshop | Yes |
| PO | P1 feature; P0 receiving assumes it | Minimal `PO-01/02` in 1.0; full procurement 1.1 | Yes |
| Customer | P1 record; P0 issue-to-customer | Minimal `CUS-01/02` in 1.0 | Yes |
| Sync Center | P0 concept; no screens | `SYNC-01/02` in 1.0 | Yes |
| Lot/serial | P1 feature; P0 receiving/AC assume it | Add model now; keep screens 1.1; remove 1.0 validation or approve promotion | Yes |
| Approvals | P0 AC; P1 rules | `APR-01` + minimal settings in 1.0; full rules 1.1 | Yes |
| Stock status | P1/P2 features; P0 return mentions inspection | Add status dimension; remove pending-inspection UI from 1.0; quarantine UI 1.1 | Yes |
| Valuation | P1; value appears on P0 screens | Hide value in 1.0; valuation 1.1; optional basic cost decision | Yes |
| CSV import | P1; 1.0 onboarding assumes it | Basic import 1.0; guided import 1.1 | Yes |
| Workflow templates | P0 template selection; P1 engine/editor | Fixed templates 1.0; editor 1.1 | Yes |
| Count recount | AC-09 includes it; `CNT-06` is P1 | Remove recount from AC-09 for 1.0; add in 1.1; count review still requires a new count | Yes |
| Count freeze | Optional freeze vs “no overlapping frozen scope” vs no-freeze default | Default no freeze; reject overlapping sessions; warn on conflict | Yes |
| Metrics | 99% vs 99.5% | Pilot exit 99%; product target 99.5% | Yes |
| Release summary | Insights/integrations appear earlier than feature priorities | Align summary to feature IDs | No (correction) |
| Mobile admin | Full admin on phone | Keep mobile-only; defer complex editors; test on phone/tablet | Yes |
| Positioning | Machines/component/maintenance promised early | Narrow launch position to project allocation + offline trust | Yes |
| Item images | P0 image vs P1 document library | One image at launch; documents later | No (clarification) |
| Dashboards | P1 configurable dashboards vs P0 Home | Basic KPI cards at launch; configurable later | No (clarification) |
| Device trust | Auth screen vs P1 device management | Minimal registration at 1.0 if needed; full device screen 1.1 | Yes |
| Labels | P1; barcode generation mentioned at launch | Keep label screen 1.1; item barcodes at launch | Yes |
| Machines | Positioning implies machines; module 1.2 | Generic allocation target at 1.0; machine registry 1.2 | Yes |
| Integrations | 1.2 limited vs 2.0 full | 2.0 baseline; 1.2 only by explicit partner decision | Yes |

### 7.3 Release guardrails

1. R0.9 remains a narrow pilot. It does not include projects, counts, approvals, PO, lot/serial screens, valuation, labels, machines or integrations.
2. R1.0 adds only P0 capabilities and the dependency screens needed to make them truthful.
3. No P1 module is promoted into R1.0 without an explicit decision in §8.
4. No screen is moved between releases merely to hit a count.
5. Every release must preserve the same ledger and authority model.
6. A feature is not “in” a release unless its screen, data model, permissions and acceptance criteria are all present.

### 7.4 Recommended corrections to existing documents

These are recommendations only. Existing documents are preserved.

1. Replace the “78 screens” total in Doc 04 with the canonical 87-screen register.
2. Add priority/release/navigation columns and the six mandatory screens.
3. Add `tracking_mode` to the item master in Doc 03.
4. Add `stock_status` to the balance concept in Doc 05.
5. Replace the P1 approval-rule dependency with `APR-01` P0.
6. Add minimal PO and customer dependency notes to Docs 03, 04 and 06.
7. Remove lot/serial from 1.0 receiving/AC-05 or explicitly promote it.
8. Remove “pending inspection” from 1.0 return or add minimal stock status.
9. Hide value displays in 1.0 or explicitly add basic cost.
10. Promote basic CSV import to P0.
11. Clarify count freeze and recount.
12. Reconcile 99%/99.5% metrics.
13. Align the release summary with feature priorities.
14. Separate fixed templates from the template editor.
15. Narrow the launch positioning or add a thin asset reference.
16. Correct competitor evidence and unsourced claims.
17. Update the brand section with contrast findings and asset requirements.
18. Add Docs 08 and 09 to the README document map after approval.
19. Record all Gate 0 decisions in Doc 07 using the decision-log format.
20. Keep Docs 01–08 unchanged until the change-control pass is approved.

---

## 8. Management-ready Gate 0 decision checklist

### 8.1 Decisions requiring explicit approval

| ID | Decision | Recommended default | Alternative | Risk if wrong or deferred | Owner | Due |
|---|---|---|---|---|---|---|
| G0-01 | Primary database (D-01) | PostgreSQL, conditional on a one-week spike | MongoDB or hybrid | Schema rework, integrity incidents, reporting cost | NTAN management | 1 week |
| G0-02 | Canonical screen inventory and 1.0 size | Approve 87-screen register; 36 pilot, 64 cumulative at 1.0 | Enforce 48-screen cap by moving 16 screens to 1.1 | Capacity overrun or reduced 1.0 completeness | NTAN/product | 2 weeks |
| G0-03 | Lot/serial release | Model now; screens 1.1; remove 1.0 validation | Promote lot/serial screens to 1.0 | Schema rework or scope growth | NTAN/product | 2 weeks |
| G0-04 | Purchase-order scope | Minimal `PO-01/02` in 1.0; full procurement 1.1 | Ad hoc receiving only; no PO | Missing PO traceability or receiving gap | NTAN/product | 2 weeks |
| G0-05 | Customer scope | Minimal `CUS-01/02` in 1.0 | Remove customer from issue destinations | Broken issue-to-customer flow | NTAN/product | 2 weeks |
| G0-06 | Stock status/quarantine | Add `stock_status`; no quarantine UI at 1.0 | Minimal quarantine UI at 1.0 | Return/quality ambiguity | NTAN/product | 2 weeks |
| G0-07 | Minimum approvals | `APR-01` + minimal settings in 1.0; full rules 1.1 | Fixed thresholds with no settings | AC-08/09 cannot pass | NTAN/product | 2 weeks |
| G0-08 | Offline authority | Offline capture/queue only; no stock authority offline | Selected offline commits | Data loss, oversell, trust damage | NTAN/engineering | 2 weeks |
| G0-09 | Mobile-only administration | Keep mobile-only for v1; test admin tasks | Plan a future read-only web console | Admin rejection or scope cut | NTAN/product | Before UX freeze |
| G0-10 | Beachhead and design partners (D-03, D-23) | Automation + precision manufacturing; name 5 to keep 3 | Start with 3 direct partners | Weak validation and no pilot | NTAN commercial | 2 weeks |
| G0-11 | Team, budget, timeline (D-24) | Confirm capacity or extend the 22-week estimate | Reduce 1.0 scope | Late, under-tested release | NTAN management | 2 weeks |
| G0-12 | Brand assets and tokens | Approve verified tokens; obtain vector logo/app icon | Temporary wordmark and system icon | Store rejection or brand rework | NTAN/brand | Before Phase 1 design |
| G0-13 | Hosting, compliance, retention (D-12, D-13, D-17) | India region; DPDP readiness; 7-year default | Other region/retention | Legal and cost exposure | NTAN/legal | Before Phase 1 build |
| G0-14 | Pricing and pilot model (D-06) | Paid pilot + tier hypothesis; validate before publishing | Subscription-only or services-led | Commercial mismatch | NTAN commercial | Before pilot recruitment |
| G0-15 | Success metrics (D-25) | Pilot exit 99%; product target 99.5%; accuracy ≥98%; scan-to-issue <30 s; conflict <1% | Single threshold for all stages | Unclear pilot success | NTAN/product | Before Gate 2 |
| G0-16 | Product name and store ownership | “NTAN Inventory” working title; NTAN owns store accounts | Alternate name | Store/legal rework | NTAN | Before store submission |
| G0-17 | Value display and valuation | Hide value in 1.0; valuation at 1.1 | Basic standard/last cost at 1.0 | Cost/reporting gap or scope growth | NTAN/product | 2 weeks |
| G0-18 | Count governance | No freeze; recount at 1.1; remove recount from AC-09 | Recount and/or freeze in 1.0 | Count disputes or 1.0 scope growth | NTAN/product | 2 weeks |
| G0-19 | Onboarding baseline | Basic CSV import and fixed workflow templates at 1.0; editors at 1.1 | Defer import or build template editor at 1.0 | Onboarding friction or scope growth | NTAN/product | 2 weeks |

### 8.2 Decisions that can be delegated

| Decision | Recommended delegate | Constraint |
|---|---|---|
| Exact screen layout and navigation labels | Product/design | Must not change release membership |
| Reason-code seed list | Product/operations | Must remain extensible |
| Approval threshold defaults | Product/operations | Must be recorded and configurable |
| Brand token implementation | Design | Must use approved palette and contrast |
| Device test matrix | Engineering | Must include low-end Android and iPhone |
| Support severity definitions | Operations | Must match SLA decision |

### 8.3 Decisions that must not be delegated

- Database choice.
- 1.0 scope and screen count.
- Offline stock authority.
- Lot/serial promotion.
- Design-partner commitments.
- Team/budget/timeline.
- Hosting region and compliance posture.
- Pricing and commercial terms.

### 8.4 Gate 0 sign-off block

| Role | Name | Decision | Date |
|---|---|---|---|
| NTAN management | | Approve / approve with conditions / reject | |
| Product owner | | | |
| Technical owner | | | |
| Commercial owner | | | |

---

## 9. Proposed Gate 0 exit checklist

Gate 0 exits only when every required item has objective evidence. “Discussed” is not evidence.

### 9.1 Canonical inventory

- [ ] The 87-screen register is approved as the single source of truth.
- [ ] The 78 vs 81 discrepancy is recorded as an arithmetic error, with 81 existing IDs confirmed.
- [ ] The six mandatory missing screens are specified with ID, roles, navigation, release and dependencies.
- [ ] Optional/future screens are listed separately and not counted in 87.
- [ ] Every screen has a release label and a primary navigation location.
- [ ] The 0.9/1.0/1.1/1.2/2.0 counts reconcile to 87.

### 9.2 Conceptual data model

- [ ] Product/variant, UOM, warehouse/location, lot, serial, balance, reservation, movement and allocation concepts are approved.
- [ ] The unique balance dimension is agreed.
- [ ] The immutability, reversal and audit rules are agreed.
- [ ] The reservation lifecycle is agreed.
- [ ] The stock-status model is agreed.
- [ ] The UOM precision/rounding rule is agreed.
- [ ] The serial and lot uniqueness scopes are agreed.
- [ ] No database schema or migration has been created.

### 9.3 Approvals

- [ ] `APR-01` is accepted as a P0 core primitive.
- [ ] Minimal approval settings are in 1.0; full rules are 1.1.
- [ ] Self-approval default and owner-override policy are approved.
- [ ] Threshold fallback when cost is unavailable is approved.
- [ ] AC-08, AC-09 and the approval dependency are reconciled.
- [ ] Offline approval decisions are explicitly blocked.

### 9.4 Offline authority

- [ ] The four authority classes are approved.
- [ ] Every stock-affecting operation is classified.
- [ ] No stock-affecting operation is marked safely offline-executable.
- [ ] Sync states and transitions are approved.
- [ ] Conflict taxonomy and resolution ownership are approved.
- [ ] Idempotency, ordering, retention and remote-wipe rules are approved.
- [ ] The UI wording “Queued — not applied” is accepted.

### 9.5 Database

- [ ] NTAN has selected PostgreSQL, MongoDB or hybrid.
- [ ] If PostgreSQL, the conditional spike and safeguards are approved.
- [ ] If MongoDB, the transaction, reconciliation and tenant safeguards are approved.
- [ ] The decision is recorded in Doc 07 and ADR-004.
- [ ] No schema, migration or production provisioning has begun.

### 9.6 Release priorities

- [ ] The release register reconciles Docs 03, 04, 06 and 07.
- [ ] No P1 module has been silently promoted into 1.0.
- [ ] The six mandatory screens are accepted as dependency completion, not scope expansion.
- [ ] If a 48-screen cap is retained, the cut list is approved and recorded.
- [ ] Project allocation is in 1.0; machines remain 1.2 unless explicitly changed.
- [ ] Lot/serial screens remain 1.1 unless explicitly promoted.
- [ ] Valuation, labels and full approval rules remain 1.1 unless explicitly promoted.

### 9.7 Commercial and organizational readiness

- [ ] 3–5 design partners are named, with operational owners.
- [ ] Team, budget and release window are approved.
- [ ] Pricing/pilot model is approved for pilot use.
- [ ] Mobile-only admin has a usability test plan.
- [ ] Device baseline is confirmed.
- [ ] Brand tokens and required assets are approved.
- [ ] Hosting region, DPDP posture and retention are approved.
- [ ] Support model and SLA are approved.
- [ ] Success metrics are reconciled and approved.

### 9.8 Documentation and governance

- [ ] The recommended-corrections list in §7.4 is approved for change control.
- [ ] Docs 01–08 are updated only through an approved change pass.
- [ ] Docs 08 and 09 are added to the README map.
- [ ] Gate 0 decisions are recorded in Doc 07.
- [ ] Gate 0 sign-off is recorded.
- [ ] Phase 1 authorization is explicit and limited to approved non-schema work until the database decision is effective.

### 9.9 Gate 0 exit statement

Gate 0 may exit when:

1. The canonical inventory is approved.
2. The conceptual data model is approved.
3. The approval and offline authority models are approved.
4. The database decision is recorded.
5. Release priorities are reconciled with no unapproved scope expansion.
6. Design partners, team/budget, brand and hosting decisions are recorded.
7. The change-control list is accepted.

Until then, the product remains **conditionally ready for Gate 0**, not build-ready.

---

## 10. Unresolved blockers

These are not document defects; they are decisions or evidence that only NTAN can close.

| Blocker | Why it blocks | Recommended action |
|---|---|---|
| Database choice | Blocks schema, migrations and core storage design | Approve PostgreSQL conditional on spike, or choose alternative |
| 1.0 screen ceiling | The canonical register shows 64 cumulative screens vs the old 48 estimate | Approve 64 or run an explicit 48-screen cut workshop |
| Lot/serial release | Model is ready, but 1.0 screens are not | Approve model-now/screens-1.1 or promote screens |
| PO and customer scope | Existing P0 flows depend on objects that were not in the screen plan | Approve minimal 1.0 screens |
| Stock status/quarantine | Return and quality behaviour are ambiguous without it | Approve model-now/UI-1.1 or add minimal UI |
| Approval settings/self-approval | P0 operations cannot be governed without a policy | Approve `APR-01`, thresholds and owner-override rule |
| Offline authority | Ambiguity risks data loss and oversell | Approve offline capture/queue only and the operation matrix |
| Design partners | No real-site validation yet | Name 5 to keep 3 |
| Team/budget/timeline | The 22-week estimate is aggressive for the listed scope | Confirm capacity or extend/reduce scope |
| Brand assets | JPEG logo and missing app identity block design/store work | Obtain vector assets and approve tokens |
| Pricing/pilot model | Commercial terms are unvalidated | Approve paid-pilot hypothesis |
| Hosting/compliance | Region, DPDP and retention affect architecture and cost | Approve India-first posture |
| Value, count and import defaults | The 1.0 boundary for value display, recount/freeze and CSV import is ambiguous | Approve hide-value, no-recount/no-freeze, basic-CSV defaults |

### 10.1 What is resolved by this document

- The 78 vs 81 count is explained.
- A canonical 87-screen inventory exists.
- Mandatory missing screens are specified.
- The conceptual inventory model is defined.
- Approvals have a P0 primitive and a minimal scope.
- Offline authority has one rule and an operation matrix.
- The database choice has a conditional decision record.
- Release priorities have a reconciliation register.
- Gate 0 has a decision checklist and exit criteria.

### 10.2 What is not resolved

- NTAN has not approved the decisions in §8.
- No design partners are named.
- No database spike has been run.
- No technical feasibility spike has been run.
- No vector brand assets are in hand.
- No pricing validation has been completed.
- No existing document has been rewritten; correction remains a change-control task.

---

## 11. Recommended immediate next actions

1. Hold a Gate 0 decision workshop using §8.
2. Record decisions in Doc 07 using the existing decision-log format.
3. Approve or amend the canonical 87-screen register.
4. Approve the data model, approval model and offline matrix.
5. Approve the database decision or authorize the one-week spike.
6. Name design partners and confirm the team/budget.
7. Run the change-control pass on Docs 01–08.
8. Only then authorize Phase 1 foundation work.

No application code, framework, package, schema, migration or UI implementation should begin before these steps are complete.

---

**End of Gate 0 resolution document.**
