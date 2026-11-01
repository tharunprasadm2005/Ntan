# 03 — Product Feature Blueprint

**Document status:** Proposed for NTAN approval
**Date:** 2026-10-22
**Related:** `01-product-vision.md`, `02-competitor-research.md`, `04-mobile-blueprint.md`, `06-roadmap.md`

---

## 1. Design principles for the feature set

1. **One engine, many configurations.** The core inventory engine must not know whether the customer
   is a manufacturer, a warehouse or a maintenance contractor.
2. **Industry behaviour is data, not code forks.** Item types, fields, stages, approvals and defaults
   are configuration bundles (templates).
3. **Every feature must survive offline.** If a feature cannot be represented as a draft plus a
   server-validated commit, its offline behaviour must be explicitly defined.
4. **No feature without an owner.** Each capability maps to a role that is accountable for it.
5. **No feature without a measurement.** If value cannot be observed, it is not ready for the roadmap.
6. **Prefer fewer, deeper workflows.** A small number of excellent flows beats a long catalogue of
   half-finished ones.

---

## 2. Product scope model

```
┌──────────────────────────────────────────────────────────────────┐
│                     EXPERIENCE LAYER (mobile)                    │
│  Home · Inventory · Scan · Operations · Projects · Machines      │
│  Reports · Approvals · Admin · Account                           │
├──────────────────────────────────────────────────────────────────┤
│                     CONFIGURATION LAYER                          │
│  Industry templates · Custom fields · Workflow stages            │
│  Approval rules · Numbering · Permissions · UOM/currency         │
├──────────────────────────────────────────────────────────────────┤
│                  COMMON INVENTORY ENGINE                         │
│  Items · Locations · Ledger · Balances · Reservations            │
│  Receiving · Issue · Transfer · Return · Adjustment              │
│  Counts · Lots/Serials · Traceability · Audit                    │
├──────────────────────────────────────────────────────────────────┤
│                  OPTIONAL INDUSTRY MODULES                       │
│  Projects · Machines · Quality · Kanban · Manufacturing          │
│  Maintenance · Component Intelligence · Advanced Insights        │
│  Integrations · Labels · Multi-currency                          │
└──────────────────────────────────────────────────────────────────┘
```

**Rule:** optional modules may read and write through the core engine's transaction APIs. They may
not maintain their own independent stock balances.

---

## 3. Core engine capabilities

Priority: **P0** = first commercial release (MVP), **P1** = next release, **P2** = industrial
specialisation, **P3** = later.

### 3.1 Foundation

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| FND-01 | Company workspace | Tenant record, settings, plan, locale, currency, timezone | P0 | — |
| FND-02 | Authentication | Email/password + OTP, secure session, refresh rotation, logout all devices | P0 | FND-01 |
| FND-03 | Invitations & membership | Invite by email/phone, accept, revoke, company switching | P0 | FND-02 |
| FND-04 | Roles & permissions | Capability-based roles, custom role templates, location scoping | P0 | FND-03 |
| FND-05 | Audit log | Append-only actor/action/entity/before-after/reason/device/time | P0 | FND-01 |
| FND-06 | Notifications | In-app inbox + push; per-user preferences; quiet hours | P0 | FND-01 |
| FND-07 | Attachments | Images, PDFs, datasheets; signed URLs; size/type limits | P0 | FND-01 |
| FND-08 | Subscription & entitlements | Plan limits, feature gates, trial, grace period, manual override | P1 | FND-01 |
| FND-09 | Device management | Device registration, last seen, remote sign-out, offline session policy | P1 | FND-02 |
| FND-10 | Import/export | Guided CSV/XLSX import with mapping, preview, validation, rollback batch | P1 | INV-01 |
| FND-11 | Global search | Items, documents, locations, projects, people, with permission filtering | P0 | multiple |
| FND-12 | Offline sync engine | Local outbox, idempotent push, cursor pull, conflict queue | P0 | all transaction features |
| FND-13 | Localization | Language packs, date/number formats, timezone, currency display | P1 | FND-01 |
| FND-14 | Help & support | Contextual help, FAQ, contact support with diagnostic bundle | P1 | FND-01 |

### 3.2 Item and catalogue

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| INV-01 | Item master | SKU, name, description, type, barcode(s), category, UOM, images, status | P0 | FND-01 |
| INV-02 | Item types | Stocked material, component, spare part, sub-assembly, finished good, consumable | P0 | INV-01 |
| INV-03 | Categories & attributes | Hierarchical categories; typed attributes (text, number, date, boolean, select, multi-select) | P0 | INV-01 |
| INV-04 | Custom fields | Company-defined fields per item type, required/optional, searchable | P0 | INV-02 |
| INV-05 | Units of measure | Base UOM, purchase UOM, issue UOM, conversion factors | P0 | INV-01 |
| INV-06 | Barcodes | Multiple codes per item, internal code generation, GS1/QR support | P0 | INV-01 |
| INV-07 | Item alternatives | Compatible/substitute items with notes and confidence | P2 | INV-01 |
| INV-08 | Component passport | MPN, manufacturer, technical specs, datasheet, supplier, machines, projects | P2 | INV-01, MCH-01 |
| INV-09 | Item lifecycle | Active, inactive, obsolete, blocked; reason and effective date | P1 | INV-01 |
| INV-10 | Cost data | Standard/last/average cost; permission-controlled visibility | P1 | INV-01 |
| INV-11 | Item images & documents | Multiple images, datasheets, certificates, revision history | P1 | FND-07 |

### 3.3 Locations and parties

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| LOC-01 | Warehouses | Multiple sites, address, contact, active status | P0 | FND-01 |
| LOC-02 | Location tree | Zone → aisle → rack → shelf → bin; parent/child, capacity optional | P0 | LOC-01 |
| LOC-03 | Location restrictions | Allowed/blocked item categories per location | P2 | LOC-02 |
| LOC-04 | Suppliers | Supplier profile, contacts, payment terms, lead time, currency | P0 | FND-01 |
| LOC-05 | Supplier-item link | Supplier part number, MOQ, price, lead time, preferred flag | P1 | LOC-04, INV-01 |
| LOC-06 | Customers/parties | Minimal customer record for issue/dispatch references | P1 | FND-01 |
| LOC-07 | Bin labels | Printable location labels with QR/barcode | P2 | INV-06 |

### 3.4 Stock movements

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| MOV-01 | Immutable stock ledger | Every quantity change recorded; no update/delete; reversal via counter-entry | P0 | INV-01, LOC-02 |
| MOV-02 | Balances | Derived on-hand, reserved, available, in-transit per item/location/lot/serial | P0 | MOV-01 |
| MOV-03 | Goods receiving | Receive against PO or ad hoc; lines, lots/serials, discrepancies, photos | P0 | MOV-01, LOC-04 |
| MOV-04 | Put-away | Assign/confirm destination bin during or after receiving | P0 | MOV-03, LOC-02 |
| MOV-05 | Stock issue | Issue to project/machine/work order/department/customer; reason required | P0 | MOV-01, PRJ-01 |
| MOV-06 | Internal transfer | Two-step or one-step transfer; in-transit state; dispatch/receive | P0 | MOV-01 |
| MOV-07 | Returns | Return to stock from project/machine/customer; condition and disposition | P0 | MOV-05 |
| MOV-08 | Adjustments | Quantity/value correction with reason, evidence and approval | P0 | MOV-01, FND-04 |
| MOV-09 | Reservations | Hold stock for project/machine/work order/customer; release/consume | P0 | MOV-02, PRJ-01 |
| MOV-10 | Damage/quarantine | Move to quarantine, record reason/photos, disposition | P1 | MOV-01, QA-01 |
| MOV-11 | Scrap | Write-off with reason, approval, cost impact | P1 | MOV-01 |
| MOV-12 | Negative stock policy | Company setting: block, warn, or allow with reason and permission | P0 | MOV-02 |
| MOV-13 | Backdating policy | Allowed window, reason, approval, audit | P1 | MOV-01 |
| MOV-14 | Document numbering | Configurable prefixes/sequences per document type per company | P1 | FND-01 |

### 3.5 Traceability

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| TRC-01 | Batch/lot tracking | Lot code, manufacture/expiry dates, supplier lot, quantity by lot | P1 | MOV-01 |
| TRC-02 | Serial tracking | Unique serial per unit; status; location; history | P1 | MOV-01 |
| TRC-03 | Expiry management | FEFO suggestions, near-expiry alerts, blocked expired stock | P2 | TRC-01 |
| TRC-04 | Full traceability | Item → movements → documents → projects/machines → people | P1 | MOV-01 |
| TRC-05 | Recall/query | Find all locations/projects of a lot/serial within a date range | P2 | TRC-01/02 |
| TRC-06 | Chain of custody | Who held/transferred an item, when, with evidence | P1 | MOV-01, FND-05 |

### 3.6 Counts and audits

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| CNT-01 | Cycle count | Count by item/category/location/ABC class; scheduled or ad hoc | P0 | MOV-02 |
| CNT-02 | Count session | Assign counters, freeze scope (optional), count lines, blind count option | P0 | CNT-01 |
| CNT-03 | Variance review | Expected vs counted, value impact, reason codes, evidence | P0 | CNT-02 |
| CNT-04 | Count approval | Multi-level approval, adjustment posting, audit | P0 | CNT-03, FND-04 |
| CNT-05 | Full stock audit | Company/location-wide count with progress and freeze policy | P1 | CNT-01 |
| CNT-06 | Recount | Second count for variance above threshold | P1 | CNT-03 |
| CNT-07 | Count analytics | Accuracy trend, variance by category/counter/location | P2 | CNT-04 |

### 3.7 Visibility and control

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| VIS-01 | Low-stock alerts | Per-item reorder point/minimum; per-location overrides; digest | P0 | MOV-02 |
| VIS-02 | Reorder suggestions | Suggest quantity based on lead time, consumption, open reservations | P2 | INS-05 |
| VIS-03 | Approval rules | Thresholds by action, value, location, role; escalation; audit | P1 | FND-04 |
| VIS-04 | Saved views | User-defined filters/sorts for lists | P1 | INV-01 |
| VIS-05 | Dashboards | Role-aware KPI cards; drill-down; freshness timestamp | P1 | MOV-02 |
| VIS-06 | Alerts & subscriptions | User can subscribe to item/location/project events | P2 | FND-06 |

### 3.8 Reporting

| ID | Capability | Description | Priority | Dependencies |
|---|---|---|---|---|
| RPT-01 | Stock on hand | By item/location/lot/serial; filter and drill-down | P0 | MOV-02 |
| RPT-02 | Movement ledger | Immutable history with filters; export | P0 | MOV-01 |
| RPT-03 | Valuation | Cost method per company; value by location/category | P1 | INV-10 |
| RPT-04 | Aging | Days in stock buckets; dead-stock candidates | P1 | MOV-01 |
| RPT-05 | Consumption | By item/project/machine/department/period | P1 | MOV-05 |
| RPT-06 | Variance/accuracy | Count variance trends | P1 | CNT-04 |
| RPT-07 | Shortage risk | Items below reorder or reserved beyond on-hand | P2 | INS-07 |
| RPT-08 | Project material variance | Planned vs reserved vs consumed vs returned | P1 | PRJ-06 |
| RPT-09 | Custom report builder | Saved filters, columns, grouping; share/export | P3 | RPT-01..08 |
| RPT-10 | Scheduled reports | Email/PDF/CSV on schedule | P3 | RPT-09 |

---

## 4. Optional industry modules

### 4.1 Projects module (recommended for MVP)

| ID | Capability | Description | Priority |
|---|---|---|---|
| PRJ-01 | Project registry | Code, customer, dates, status, manager, budget (optional) | P0 |
| PRJ-02 | Material plan | Planned items/quantities per project, versioned | P1 |
| PRJ-03 | Allocation | Reserve stock to project; show reserved/available | P0 |
| PRJ-04 | Issue to project | Consume reserved or unreserved stock; reason and reference | P0 |
| PRJ-05 | Returns from project | Return unused material with condition | P0 |
| PRJ-06 | Project variance | Planned vs issued vs returned vs remaining; cost view | P1 |
| PRJ-07 | Project documents | Attachments, approvals, notes | P1 |
| PRJ-08 | Multi-project allocation | Split a reservation across projects | P2 |

### 4.2 Machines / assets module

| ID | Capability | Description | Priority |
|---|---|---|---|
| MCH-01 | Machine registry | Asset code, name, location, manufacturer, model, serial, status | P2 |
| MCH-02 | Machine BOM/spares | Recommended spares and quantities per machine | P2 |
| MCH-03 | Machine history | Parts consumed, jobs, downtime events, documents | P2 |
| MCH-04 | Machine-criticality | Criticality class affecting reservation priority | P2 |
| MCH-05 | QR asset tag | Generate/print machine QR linking to machine detail | P2 |
| MCH-06 | Installation/project link | Machine ↔ project ↔ customer | P2 |

### 4.3 Maintenance module (candidate differentiator)

| ID | Capability | Description | Priority |
|---|---|---|---|
| MNT-01 | Maintenance jobs | Job code, machine, priority, assignee, status, checklist | P2 |
| MNT-02 | Parts requirement | Required parts vs availability before job start | P2 |
| MNT-03 | Parts consumption | Issue parts to job; return unused; cost per job | P2 |
| MNT-04 | Preventive schedule | Time/meter-based recurring jobs | P3 |
| MNT-05 | Downtime capture | Start/stop, reason, duration | P3 |
| MNT-06 | Job history | Searchable history by machine/part/technician | P2 |

### 4.4 Quality module

| ID | Capability | Description | Priority |
|---|---|---|---|
| QA-01 | Inspection templates | Checklist, numeric limits, pass/fail, evidence | P2 |
| QA-02 | Incoming inspection | Trigger on receiving for selected items/suppliers | P2 |
| QA-03 | In-process inspection | Trigger at production stages | P2 |
| QA-04 | Quarantine | Hold stock, block issue, require disposition | P2 |
| QA-05 | Disposition | Accept, reject, rework, return to supplier, scrap | P2 |
| QA-06 | Non-conformance | Record, link to lot/serial/project, corrective action | P3 |

### 4.5 Line-feed / Kanban module

| ID | Capability | Description | Priority |
|---|---|---|---|
| KAN-01 | Replenishment points | Min/max per item/location/line | P2 |
| KAN-02 | Kanban cards | Card per bin/container; scan to trigger replenishment | P2 |
| KAN-03 | Two-bin / three-bin | Simple visual replenishment policies | P2 |
| KAN-04 | Line-side locations | Consumption locations linked to production line | P2 |
| KAN-05 | Replenishment queue | Pick list and transfer to line | P2 |

### 4.6 Manufacturing module (light, then deeper)

| ID | Capability | Description | Priority |
|---|---|---|---|
| MFG-01 | Bill of materials | Single-level first, multi-level later; components and quantities | P2 |
| MFG-02 | Work orders | Planned quantity, dates, status, component availability | P2 |
| MFG-03 | Material issue | Issue/reserve components to work order | P2 |
| MFG-04 | WIP tracking | Component consumption and partial completion | P2 |
| MFG-05 | Finished goods | Receive finished quantity, by-product/scrap | P2 |
| MFG-06 | Production costing | Material + optional labour/overhead | P3 |
| MFG-07 | Scheduling/MRP | Capacity and demand planning | P3 |

**Decision:** manufacturing is a module, not a core assumption. The core engine must not require a BOM
to function.

### 4.7 Component intelligence module

| ID | Capability | Description | Priority |
|---|---|---|---|
| CMP-01 | MPN & manufacturer | Structured manufacturer part number and brand | P2 |
| CMP-02 | Technical specifications | Typed spec attributes per category (voltage, current, size, etc.) | P2 |
| CMP-03 | Datasheets & documents | Versioned attachments with preview | P2 |
| CMP-04 | Alternates | Compatible/substitute parts with approval status | P2 |
| CMP-05 | Supplier cross-reference | Supplier part numbers and availability | P2 |
| CMP-06 | Machine/project usage | Where a component is used | P2 |
| CMP-07 | Scan-to-spec | Scan a part and see specs/datasheet/alternates | P2 |

### 4.8 Insights module

| ID | Capability | Description | Priority |
|---|---|---|---|
| INS-01 | Consumption trend | Per item/category/project/machine; seasonality-aware | P2 |
| INS-02 | Unusual movement detection | Statistical outlier vs recent baseline, with reason | P3 |
| INS-03 | Reorder recommendation | Lead time + consumption + reservations; explainable | P2 |
| INS-04 | Shortage risk | Reserved > on-hand, below safety stock, long lead time | P2 |
| INS-05 | Dead stock | No movement in N days + value + last movement | P2 |
| INS-06 | Inventory aging | Age buckets by receipt/lot | P2 |
| INS-07 | Project requirement forecast | Planned material vs availability | P3 |
| INS-08 | Insight explanation | "Why" panel with inputs, period, thresholds | P2 |
| INS-09 | Feedback | Useful/not useful; reason; improves rules | P3 |

### 4.9 Labels and scanning

| ID | Capability | Description | Priority |
|---|---|---|---|
| LBL-01 | Label templates | Item, location, lot, serial, machine; configurable fields | P2 |
| LBL-02 | Print/export | PDF/PNG; common label sizes; share to printer app | P2 |
| LBL-03 | Barcode generation | Code 128, EAN, QR; internal codes | P1 |
| LBL-04 | External scanner support | Bluetooth/USB keyboard-wedge scanners | P3 |

### 4.10 Integration module

| ID | Capability | Description | Priority |
|---|---|---|---|
| INT-01 | Public API | Versioned REST API, API keys, rate limits, webhooks | P3 |
| INT-02 | Accounting export | Tally/Zoho Books export formats | P3 |
| INT-03 | GST/e-invoice | India-specific document data (requires legal review) | P3 |
| INT-04 | ERP connectors | Odoo/ERPNext/SAP later | P3 |
| INT-05 | Webhooks | Event subscriptions for stock/project events | P3 |

---

## 5. NTAN five-stage model mapping

The five original stages are preserved as **composable workflow stages**, not mandatory gates.

| Stage | What it means | Core or module? | Configurability |
|---|---|---|---|
| **1. Inbound Receiving** | Supplier delivery, PO reference, quantity/condition check, put-away | Core (MOV-03/04) | Required fields, PO mandatory or optional, inspection trigger |
| **2. Line-Feed / Kanban** | Replenishment of line-side stock; min/max; scan to replenish | Module (KAN) | Enabled per location/line; not required for warehouses |
| **3. Quality Gate** | Inspection, accept/reject/quarantine before stock becomes available | Module (QA) | Trigger by item/supplier/category; can be a simple pass/fail |
| **4. Stock Audit** | Cycle count/full audit, variance approval, adjustment | Core (CNT) | Frequency, blind count, approval thresholds |
| **5. Finished Goods** | Completion of production, finished stock receipt, dispatch prep | Module (MFG) | Only for manufacturing template |

**Workflow engine requirements (P1):**

- Named stages with order and optional skip.
- Per-item-type or per-template stage sets.
- Entry/exit conditions expressed as rules (e.g., "quality required if item.qa_required").
- Stage owner role and SLA (optional).
- Stage history on the document and in the audit log.
- Stage reordering without code changes.

**Anti-pattern to avoid:** a single global pipeline that forces a warehouse to run a quality gate or a
maintenance contractor to run finished goods.

---

## 6. Configuration model

### 6.1 Industry templates

A template is a versioned bundle containing:

- Item types and default categories.
- Custom field definitions per item type.
- Default locations (Receiving, Quarantine, Main Store, Line-side, Finished Goods).
- Optional workflow stages and their order.
- Document types and numbering prefixes.
- Approval defaults.
- Dashboard cards and default reports.
- Sample (clearly labelled) demo data for onboarding only.

Initial templates:

| Template | Default stages | Default modules | Notes |
|---|---|---|---|
| Manufacturing | Receiving → Quality → Stock → Line-feed → Finished Goods | Quality, Kanban, Manufacturing, Projects | Optional stages |
| Industrial Automation | Receiving → Quality → Stock → Project allocation | Projects, Machines, Component Intelligence | Specs/MPN emphasis |
| Warehousing | Receiving → Put-away → Stock → Dispatch | Labels, Counts | No quality/mfg by default |
| Maintenance | Receiving → Stock → Job consumption → Returns | Machines, Maintenance | Spare-parts emphasis |
| Engineering & Assembly | Receiving → Quality → Stock → Project/WO → Finished Goods | Projects, Manufacturing (light) | Project-centric |

**Templates are starting points, not constraints.** Every element must be editable after onboarding.

### 6.2 Custom fields

- Field types: text, long text, number, decimal, date, date-time, boolean, single select, multi select,
  barcode, image, file, URL.
- Scoped to company, optional per item type/category.
- Validation: required, min/max, regex, unique.
- Searchable/filterable flag.
- Display order and grouping.
- Import/export support.
- No destructive deletion; archive instead.

### 6.3 Roles and permissions

Capabilities are atomic. Roles are named bundles. Suggested defaults:

| Role | Typical capabilities |
|---|---|
| Owner | All, including billing and company deletion |
| Company Admin | Users, roles, settings, warehouses, imports; no billing unless granted |
| Inventory Manager | Items, receiving, issue, transfer, counts, adjustments (approval limits), reports |
| Warehouse Supervisor | Receiving, issue, transfer, counts; approve within limits |
| Warehouse Operator | Scan, receive, issue, transfer, count entry; no approvals, no cost visibility |
| Project Manager | Projects, reservations, project issue/return, project reports |
| Technician | Scan, view stock, consume parts to jobs, return parts |
| Purchasing | Suppliers, POs, receiving; no stock adjustment |
| Auditor | Read-only across ledger, counts, audit; export |

**Rules:** least privilege; location scoping; monetary/cost fields separately gated; approval cannot
be granted to the same user who created the document (configurable, default enforced).

---

## 7. Differentiator deep-dives

### D1. Scan-to-Action

| Dimension | Detail |
|---|---|
| Customer problem | Operators know the item but not the app. Finding the right action takes many taps, so they delay or skip recording. |
| Proposed solution | Scan → resolve item/context → show a short, role-filtered action sheet (view stock, receive, issue, transfer, return, reserve, damage, history). Remember last-used action. One-tap start. |
| Target users | Operators, technicians, supervisors |
| Competitor comparison | Scanning is table stakes (Odoo, Zoho, Sortly, MaintainX). Zoho's app is a web supplement; ERP flows are form-heavy. The proposed advantage is action discovery + offline capture, not scanning itself. |
| Business value | Faster transactions, higher scan adoption, fewer missed movements, cleaner data |
| Technical feasibility | High: camera scanning, item resolution API, permission-filtered actions |
| Complexity | Medium |
| Dependencies | INV-01/06, FND-04, MOV-03..09, LBL-03, sync engine |
| Priority | P0 |
| Evidence status | [Hypothesis] — validate in usability tests |

### D2. Project / machine / work-order allocation ledger

| Dimension | Detail |
|---|---|
| Customer problem | Material is issued to "the project" informally. Nobody can distinguish reserved, available, consumed and returned stock. Project costs and shortages are discovered late. |
| Proposed solution | First-class allocation entity linked to project/machine/work order. Every reservation, issue, return and adjustment is traceable to an allocation. One screen shows on-hand, reserved, available, consumed, returned, variance. |
| Target users | Project managers, inventory managers, owners, finance |
| Competitor comparison | Odoo/ERPNext can model projects and reservations but require ERP setup; SMB tools have jobs/asset links but not a full allocation ledger. |
| Business value | Project margin control, fewer shortages, defensible customer billing, less emergency purchasing |
| Technical feasibility | High: core ledger + allocation tables + reservation invariants |
| Complexity | Medium–High |
| Dependencies | MOV-01/02/09, PRJ-01..06, MCH-01 |
| Priority | P0 for projects, P2 for machines/work orders |
| Evidence status | [Hypothesis] — validate with 5+ project-based businesses |

### D3. Industrial component intelligence

| Dimension | Detail |
|---|---|
| Customer problem | Technicians and storekeepers need specs, datasheets and alternatives at the shelf, but the knowledge lives in PDFs, emails or one expert's head. |
| Proposed solution | Component passport attached to the item: MPN, manufacturer, typed specs, datasheet, images, supplier cross-reference, approved alternates, machines/projects used. Reachable by scan. |
| Target users | Technicians, maintenance engineers, storekeepers, project engineers |
| Competitor comparison | PLM/ERP store some data; Sortly/MaintainX store photos/docs; mobile-native industrial spec lookup is underserved. |
| Business value | Faster repairs, fewer wrong-part purchases, reduced downtime, knowledge retention |
| Technical feasibility | High: structured attributes + attachments; search |
| Complexity | Medium |
| Dependencies | INV-01/03/08, FND-07, MCH-01, scan |
| Priority | P2 |
| Evidence status | [Hypothesis] — validate with automation/maintenance buyers |

### D4. Industry-template configuration engine

| Dimension | Detail |
|---|---|
| Customer problem | Generic software forces one workflow on every industry; custom software is expensive and brittle. |
| Proposed solution | Versioned templates configure fields, locations, stages, approvals, numbering and reports. All editable. No code fork. |
| Target users | Owner/admin during onboarding; NTAN implementation/support |
| Competitor comparison | Odoo/ERPNext are configurable but consultant-heavy; SMB tools are simple but rigid. Productised configuration is the gap. |
| Business value | Faster onboarding, lower support cost, expansion into new verticals without a new codebase |
| Technical feasibility | High, if the core model is generic from day one |
| Complexity | High (discipline more than technology) |
| Dependencies | INV-02/04, workflow engine, templates |
| Priority | P0 foundation; P1 full editor |
| Evidence status | [Proposed] |

### D5. Explainable inventory insight

| Dimension | Detail |
|---|---|
| Customer problem | Reports show what happened, not what to do. AI claims are distrusted when unexplained. |
| Proposed solution | Rule/statistics-based insights with a "why" panel: inputs, period, threshold, last movement, open reservations, lead time. Recommendations are advisory; human commits. |
| Target users | Owners, inventory managers, purchasing |
| Competitor comparison | Forecasting exists (Cin7, Odoo); AI exists (MaintainX); explanation and transparency are inconsistent. |
| Business value | Less dead stock, fewer stockouts, better cash use, trust in recommendations |
| Technical feasibility | High for rules; medium for anomaly detection |
| Complexity | Medium |
| Dependencies | MOV-01, RPT-04/05, supplier lead times, reservations |
| Priority | P2 |
| Evidence status | [Hypothesis] |

### D6. Maintenance + spare-parts convergence

| Dimension | Detail |
|---|---|
| Customer problem | Maintenance software tracks jobs but not the warehouse; WMS tracks stock but not why a part is needed. Technicians shuttle between systems. |
| Proposed solution | Job → required parts → availability check → issue/return → machine history. Same ledger as inventory. |
| Target users | Technicians, maintenance supervisors, storekeepers |
| Competitor comparison | MaintainX/Limble strong on jobs, lighter on inventory depth; WMS ignore jobs. |
| Business value | Uptime, fewer duplicate purchases, job costing, accountability |
| Technical feasibility | Medium: module on core ledger |
| Complexity | High |
| Dependencies | MCH-01/03, MNT-01..03, MOV-05/07 |
| Priority | P2 (after MVP proves core inventory) |
| Evidence status | [Hypothesis] |

### D7. Sync Trust Center (supporting differentiator)

| Dimension | Detail |
|---|---|
| Customer problem | Offline users do not know whether an action was saved, synced, applied or rejected. Supervisors cannot diagnose. |
| Proposed solution | Per-operation status timeline, conflict queue with side-by-side values, retry/cancel, device sync history, diagnostic export. |
| Target users | Operators, supervisors, admins, NTAN support |
| Competitor comparison | Offline is claimed widely; explicit conflict UX is rarely documented. |
| Business value | Trust, fewer support calls, safer adoption in poor connectivity |
| Technical feasibility | High with a well-designed outbox |
| Complexity | High |
| Dependencies | FND-12, MOV-01, audit |
| Priority | P0 (minimum status), P1 (full center) |
| Evidence status | [Proposed] |

---

## 8. Prioritisation

### 8.1 Scoring method

`RICE = (Reach × Impact × Confidence) / Effort`

- Reach 1–5 (share of target users affected)
- Impact 1–5 (value when it works)
- Confidence 0.5–1.0
- Effort 1–5 (higher = harder)

Scores are relative, not financial. They are a conversation aid, not an algorithm.

### 8.2 Priority table (selected)

| Feature set | Reach | Impact | Confidence | Effort | RICE | Priority |
|---|---|---|---|---|---|---|
| Auth, tenancy, RBAC, audit | 5 | 5 | 1.0 | 3 | 8.3 | P0 |
| Item master + UOM + custom fields | 5 | 5 | 1.0 | 3 | 8.3 | P0 |
| Warehouses + location tree | 5 | 4 | 1.0 | 2 | 10.0 | P0 |
| Receive / issue / transfer / return / adjust | 5 | 5 | 1.0 | 4 | 6.25 | P0 |
| Immutable ledger + balances | 5 | 5 | 1.0 | 4 | 6.25 | P0 |
| Scan-to-Action + manual entry | 5 | 5 | 0.8 | 3 | 6.7 | P0 |
| Offline drafts + safe sync | 5 | 5 | 0.7 | 5 | 3.5 | P0 |
| Cycle count + variance + approval | 4 | 4 | 0.9 | 3 | 4.8 | P0 |
| Projects + reservations | 4 | 5 | 0.8 | 3 | 5.3 | P0 |
| Mobile admin (users/roles/warehouses) | 4 | 4 | 0.9 | 3 | 4.8 | P0 |
| Reports: stock, movement, low stock | 5 | 4 | 1.0 | 3 | 6.7 | P0 |
| Push notifications | 5 | 3 | 1.0 | 1 | 15.0 | P0 |
| Labels/barcode generation | 4 | 3 | 0.9 | 2 | 5.4 | P1 |
| Batch/lot + serial | 3 | 4 | 0.9 | 3 | 3.6 | P1 |
| Purchasing/PO | 4 | 4 | 0.9 | 3 | 4.8 | P1 |
| Valuation/aging | 3 | 4 | 0.9 | 2 | 5.4 | P1 |
| Machines registry | 3 | 4 | 0.7 | 2 | 4.2 | P2 |
| Component passport | 3 | 4 | 0.6 | 3 | 2.4 | P2 |
| Maintenance jobs | 3 | 5 | 0.6 | 4 | 2.25 | P2 |
| Quality module | 3 | 4 | 0.7 | 3 | 2.8 | P2 |
| Kanban | 3 | 3 | 0.7 | 2 | 3.15 | P2 |
| BOM/work orders | 2 | 5 | 0.7 | 5 | 1.4 | P2 |
| Insights (aging/dead stock/shortage) | 4 | 4 | 0.7 | 3 | 3.7 | P2 |
| Explainable anomaly detection | 3 | 3 | 0.5 | 4 | 1.1 | P3 |
| Integrations/API | 3 | 4 | 0.7 | 4 | 2.1 | P3 |
| Multi-currency | 2 | 3 | 0.8 | 3 | 1.6 | P3 |

**Interpretation:** the MVP must earn the right to build differentiators by first making the core
ledger, scanning and offline trust excellent. Project allocation is the one differentiator pulled
into MVP because it changes the data model and is hard to retrofit.

---

## 9. Release mapping

### Release 0.9 — Pilot (internal / design partners)

- Auth, single company, roles, item master, locations, receive/issue/transfer, ledger, scan, offline
  drafts, stock report, audit.
- Manual onboarding by NTAN.
- English only; INR; single warehouse; no projects.

### Release 1.0 — First commercial release

- All P0 items above, including projects/reservations, cycle counts, mobile admin, low-stock alerts,
  notifications, basic reports, sync status.
- Multi-warehouse, multi-location, custom fields, CSV import.
- Pilot-hardened; support playbook; onboarding checklist.

### Release 1.1 — Operations depth

- Lots/serials, purchasing/PO, valuation/aging, labels, approval rules, saved views, dashboards,
  returns/dispositions, guided import, device management, subscription gating.

### Release 1.2 — Industrial specialisation

- Machines, component passport, quality gates, kanban, light BOM/work orders, maintenance jobs,
  project material plans, variance reports.

### Release 2.0 — Intelligence and ecosystem

- Insights and recommendations, anomaly detection, project forecasting, integrations/API, advanced
  reporting, external scanners, multi-currency, localization.

---

## 10. Acceptance criteria (MVP epics)

These are product-level exit criteria, not test scripts. Each must be refined into automated and
manual tests during delivery.

| ID | Epic | Acceptance criteria |
|---|---|---|
| AC-01 | Company isolation | A user in Company A can never read or mutate Company B data via UI, API, export, search, or file URL. Automated cross-tenant tests pass. |
| AC-02 | Authentication | Sign-in, refresh, logout-all, session expiry, and MFA for admins work on Android and iOS. No secret is stored in the app bundle. |
| AC-03 | Roles | A custom role can be created with a subset of capabilities; the UI hides unavailable actions and the API rejects them with 403. Location scoping is enforced server-side. |
| AC-04 | Item master | Create/edit/archive item with SKU, UOM, barcode, category, custom fields, image. Duplicate SKU/barcode is rejected with a clear message. |
| AC-05 | Receiving | Receive against a PO or ad hoc, with multiple lines, partial quantities, location, lot/serial if enabled, discrepancy reason, and photo. Stock becomes available only after commit. |
| AC-06 | Issue | Issue stock to a project/machine/department with reason; reservation is consumed first where applicable; negative stock follows policy; insufficient stock is blocked or requires permission. |
| AC-07 | Transfer | Transfer between locations shows in-transit state; dispatch and receive are separate audit events; cancellation reverses safely. |
| AC-08 | Adjustment | Adjustment requires reason; above threshold requires approval; the approver cannot be the creator; the ledger records both request and posting. |
| AC-09 | Count | Create a count session, count by scan/manual, submit variance, approve, and post an adjustment. Recount is possible above threshold. |
| AC-10 | Ledger | No API or UI path can update/delete a posted movement. Corrections are counter-entries. History is exportable. |
| AC-11 | Scan-to-Action | Scanning a known barcode resolves the item in < 1.5 s on a mid-range device and shows only permitted actions. Unknown code offers create-item or manual search. Duplicate scans within 2 s are ignored unless confirmed. |
| AC-12 | Offline draft | With the network disabled, a user can capture a receipt/issue/transfer/count line; the operation shows "queued"; restarting the app preserves it; reconnecting syncs it exactly once. |
| AC-13 | Conflict | A stale or invalid queued operation is not silently applied. It appears in a conflict queue with server vs device values and explicit resolve/cancel actions. |
| AC-14 | Project allocation | Reserve stock to a project; available decreases, on-hand does not. Issue consumes reservation. Return increases on-hand and releases/updates allocation. Variance report reconciles. |
| AC-15 | Reports | Stock on hand, movement history, low stock, and project allocation reports load in < 2 s for 10k items/100k movements in the pilot dataset and export to CSV. |
| AC-16 | Admin | An admin can invite a user, assign a role, create a warehouse and a location, and edit company settings entirely on a phone. |
| AC-17 | Audit | Every stock-affecting action has an audit event with actor, device, timestamp, before/after, reason, and source document. |
| AC-18 | Offline clarity | Every queued item displays one of: Draft, Queued, Syncing, Applied, Rejected, Conflict. No ambiguous spinner-only state. |
| AC-19 | Notifications | Low-stock and approval notifications arrive in-app and via push; preferences are respected; deep links open the correct screen. |
| AC-20 | Performance | Cold start < 3 s on a mid-range Android device; list scroll at 60 fps for 1,000 rows with virtualization; no ANRs in the pilot. |

---

## 11. Explicitly out of scope

- Full accounting, ledgers, tax filing, payroll.
- POS, ecommerce checkout, marketplace sync.
- Public customer/vendor portals.
- Web dashboard/desktop app.
- Autonomous purchasing.
- Custom code per tenant.
- RFID hardware, industrial label printer drivers (integration later).
- Fleet/route management, transport scheduling.
- Full MRP/capacity planning in the first two releases.
- AI-generated decisions without human approval.

---

## 12. Traceability to screens

| Feature group | Primary screens (see Doc 04) |
|---|---|
| Auth/onboarding | AUTH-01..10 |
| Item/catalogue | INV-01..03, INV-15..17 |
| Locations/parties | ADM-06..08 |
| Receiving | INV-06, OPS-02 |
| Issue | INV-07 |
| Transfer | INV-08 |
| Return | INV-09 |
| Adjustment | INV-10 |
| Reservation | INV-11, PRJ-04 |
| Counts | INV-12..14 |
| Scan | SCAN-01..03 |
| Projects | PRJ-01..04 |
| Machines | MCH-01..02 |
| Reports | REP-01..10 |
| Admin | ADM-01..23 |
| Offline/conflict | HOME-01, sync status, conflict queue |

---

## 13. Open feature decisions

1. Is purchasing/PO in the first commercial release or Release 1.1? (Recommendation: 1.1, unless
   design partners require it.)
2. Are lots/serials required for the first two target industries? (Recommendation: 1.1 unless
   regulated customers say otherwise.)
3. Should project costing be included with allocation, or deferred? (Recommendation: defer detailed
   costing; show quantity variance first.)
4. Is label printing a launch requirement? (Recommendation: barcode generation at launch, printing in
   1.1.)
5. Does the first release need multi-currency? (Recommendation: no; INR-first.)
6. Should machines be part of MVP for automation customers? (Recommendation: projects yes, machines
   1.2 unless a design partner requires it.)
7. What is the negative-stock default? (Recommendation: block by default; configurable warning.)
8. What is the default count approval threshold? (Recommendation: configurable, no approval below a
   low value threshold; always reason-coded.)
