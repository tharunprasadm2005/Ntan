# 08 — Phase 0 Blueprint Review

**Status:** Independent review for NTAN management decision
**Date:** 2026-10-22
**Reviewed:** `README.md` and Docs 01–07
**Decision requested:** Approve the Phase 0 direction with conditions, or return it for revision
**Scope:** Product, scope, architecture, mobile, evidence and brand review. No application code, schema, migration, dependency or existing-document change was made.

---

## 1. Verdict

**Verdict: CONDITIONALLY READY FOR GATE 0. Not ready to build as currently specified.**

The Phase 0 package is substantially better than a typical concept deck. It has a clear wedge, an unusually explicit trust model, a credible ledger design, honest evidence labels and a risk register that names the hard problems. The direction should be preserved.

It is not yet decision-ready because six material gaps would create rework or customer-facing contradictions if Phase 1 started now:

1. The MVP has no coherent purchase-order story, yet receiving and acceptance criteria depend on POs.
2. Lot/serial tracking is deferred, but receiving screens and acceptance criteria already assume it.
3. Approvals are required in P0 acceptance criteria while the approval-rule engine is P1.
4. “Offline execution” and “drafts only” are used interchangeably; the actual authority model needs one definition and an operation-by-operation matrix.
5. The screen catalogue claims 78 screens but contains 81, and it has no priority column or Sync Center screen.
6. The positioning promises machines, component intelligence and maintenance convergence that the roadmap places in 1.2 or later.

### 1.1 What is strong

- The product is aimed at a real, defensible segment rather than “all inventory.”
- The immutable ledger, `available = on-hand − reserved`, server-authoritative stock commits and conflict queue form a coherent trust architecture.
- Mobile-only administration is treated as a product problem, not an afterthought.
- The evidence conventions (`Verified`, `Third-party`, `Assumption`, `Hypothesis`) are the right discipline for a commercial plan.
- The roadmap has explicit go/no-go gates and a stop rule that protects correctness over schedule.
- The brand foundation is based on verified NTAN colours and fonts rather than invented ones.

### 1.2 Readiness assessment

| Area | Assessment | Why |
|---|---|---|
| Product strategy | **Ready with corrections** | Clear ICPs and wedge; positioning overreaches the release plan. |
| Feature scope | **Not ready** | Critical dependency gaps in PO, lot/serial, approvals, valuation and offline. |
| Industrial requirements | **Partially ready** | Core is sound; tracking policy, stock status, project-site stock and returns need decisions. |
| Architecture direction | **Directionally ready** | Ledger and sync model are credible; database decision and contracts remain open. |
| Mobile blueprint | **Directionally ready** | Strong navigation and state model; screen inventory is not reliable yet. |
| Competitive evidence | **Partially ready** | Good sourcing discipline; a few claims and matrix cells need correction. |
| Brand | **Foundation ready** | Colours/fonts verified; logo assets, contrast and app identity incomplete. |
| Commercial readiness | **Not ready** | Design partners, pricing validation and team/budget are still open. |

### 1.3 Recommendation

Approve the **direction**, not the scope exactly as written. Gate 0 should be recorded as a conditional approval with five immediate blockers due within two weeks:

1. Database: PostgreSQL, MongoDB or hybrid.
2. MVP boundary: projects, lots/serials, minimal PO, stock status/quarantine, machines.
3. Offline policy and operation matrix.
4. Target beachhead and named design partners.
5. Team, budget and release window.

Until those are recorded, Phase 1 may proceed only on design-system, navigation-shell, scanning-spike and offline-spike work that does not create a database schema or stock-posting code.

---

## 2. Cross-document consistency audit

Severity:

- **Critical** — would invalidate the MVP boundary, schema or acceptance criteria.
- **High** — would cause rework or customer confusion before pilot.
- **Medium** — should be corrected before external use or Phase 1 design freeze.

### 2.1 Critical findings

| ID | Finding | Evidence | Required action |
|---|---|---|---|
| C-01 | **Screen count is wrong.** The catalogue has 81 screens, not 78: Auth 10 + Home 3 + Scan 3 + Inventory 17 + Operations 6 + Projects 5 + Machines 4 + Reports 10 + Admin 23 = 81. | `04-mobile-blueprint.md:293` says “78 screens”; `04-mobile-blueprint.md:299-304` totals 78; IDs at `04-mobile-blueprint.md:169-291`. | Create one screen register; correct the total and phase counts; regenerate all summaries from the register. |
| C-02 | **No Sync Center screen exists.** The Sync Trust Center is a P0 differentiator, and conflicts are a core workflow, but the catalogue has no screen ID for operation status, conflict detail or diagnostics. | `03-feature-blueprint.md:472-485`; `04-mobile-blueprint.md:603-610`; traceability at `03-feature-blueprint.md:636` refers only to “sync status, conflict queue.” | Add `SYNC-01` (operation/outbox list), `SYNC-02` (conflict detail) and optionally `SYNC-03` (diagnostics). Link from Home and Settings. |
| C-03 | **Receiving against PO has no PO source.** `MOV-03`, `INV-06`, `OPS-02` and `AC-05` assume open POs, but there is no PO list, detail, create or import screen. Phase 2 explicitly excludes purchasing/PO depth beyond “receiving against an existing PO reference.” | `03-feature-blueprint.md:111`; `03-feature-blueprint.md:583`; `04-mobile-blueprint.md:207`; `04-mobile-blueprint.md:225`; `06-roadmap.md:120`; `06-roadmap.md:257`. | Either add a minimal PO reference object (list/detail, manual or CSV import, no approvals/landed cost) or remove PO-based receiving from MVP and change `MOV-03`, `INV-06`, `OPS-02` and `AC-05`. |
| C-04 | **Lot/serial is simultaneously deferred and assumed.** `TRC-01/02` are P1 and lots/serials ship in 1.1, but MVP receiving accepts lot/serial “if enabled,” `AC-05` validates it, and the item master has no tracking-policy field. | `03-feature-blueprint.md:128-129`; `03-feature-blueprint.md:583`; `04-mobile-blueprint.md:207`; `04-mobile-blueprint.md:354`; `06-roadmap.md:256`; item fields at `03-feature-blueprint.md:81`. | Add `tracking_mode` (`none`, `lot`, `serial`) to the item model and decide whether lot/serial detail screens are 1.0 or 1.1. Do not leave the ledger shape undecided. |
| C-05 | **Approval engine is a hidden P0 dependency.** Adjustments and count approvals require approval in P0, but configurable approval rules are P1. | `03-feature-blueprint.md:116`; `03-feature-blueprint.md:142`; `03-feature-blueprint.md:586-587`; `03-feature-blueprint.md:153` (`VIS-03` P1); `04-mobile-blueprint.md:280` (`ADM-12`). | Ship a minimal single-step approval primitive in P0; defer the rule editor, escalation and multi-level approval to P1. |
| C-06 | **Offline authority is ambiguous.** “Offline execution,” “offline drafts,” “server-validated commits” and “limit MVP offline to drafts” appear together without an operation-level matrix. | `01-product-vision.md:248-252`; `03-feature-blueprint.md:15`; `04-mobile-blueprint.md:561-567`; `06-roadmap.md:140`; `07-open-questions-risks.md:19`. | Define one rule: offline capture and queue, never offline stock authority. Publish a matrix per action: draftable offline, online-only, or read-only cache. |

### 2.2 High findings

| ID | Finding | Evidence | Required action |
|---|---|---|---|
| C-07 | **CSV import priority conflicts with onboarding.** `FND-10` is P1, but CSV import is in Release 1.0 and Phase 2 onboarding. | `03-feature-blueprint.md:71`; `03-feature-blueprint.md:552`; `06-roadmap.md:116`. | Promote basic item/location/supplier import to P0, or remove it from the 30-minute onboarding promise. |
| C-08 | **Valuation is excluded from MVP but value appears on MVP screens.** `INV-10` and `RPT-03` are P1, while Home and project screens show stock/material value. | `03-feature-blueprint.md:90`; `03-feature-blueprint.md:164`; `04-mobile-blueprint.md:235`; `04-mobile-blueprint.md:313`; `06-roadmap.md:120`. | Either add basic standard/last cost and a simple value report to 1.0, or remove value displays from MVP screens and label them “later.” |
| C-09 | **Issue-to-customer is P0 but customer records are P1.** `MOV-05` and `INV-07` allow issue to a customer, while `LOC-06` is P1 and no customer screen exists. | `03-feature-blueprint.md:113`; `03-feature-blueprint.md:102`; `04-mobile-blueprint.md:208`; `04-mobile-blueprint.md:276`. | Add a minimal customer/party record and screen, or remove customer from MVP destinations. |
| C-10 | **Quarantine/stock status is missing from the balance model.** Returns can create “pending inspection,” damage/quarantine is P1, quality is P2, and balances only track on-hand, reserved and in-transit. | `03-feature-blueprint.md:118`; `03-feature-blueprint.md:219`; `04-mobile-blueprint.md:210`; `05-technical-architecture.md:468`; `05-technical-architecture.md:479`. | Add a `stock_status` dimension (available, quarantine, blocked) or explicitly remove quarantine/pending-inspection behaviour from 1.0. |
| C-11 | **Count freeze rules conflict.** Count sessions say “no overlapping frozen scope,” the open UX decision recommends no freeze by default, and count freeze is “optional.” | `04-mobile-blueprint.md:213`; `04-mobile-blueprint.md:692`; `03-feature-blueprint.md:140`. | Define the default, the override, and how concurrent movements are handled during a count. |
| C-12 | **Recount is an acceptance criterion but a P1 feature.** | `03-feature-blueprint.md:587`; `03-feature-blueprint.md:144` (`CNT-06` P1). | Include recount in P0 or remove it from `AC-09`. |
| C-13 | **Success-metric thresholds disagree.** Offline sync is >99.5% in the vision and >99% in the roadmap; crash-free sessions are >99.5% vs >99%. | `01-product-vision.md:330-336`; `06-roadmap.md:133`; `06-roadmap.md:319`. | Adopt one measurement definition and one target per metric. |
| C-14 | **Release summary disagrees with feature priorities.** Insights are “limited” in 1.1 and integrations in 1.2, while the feature blueprint places both in later releases. | `06-roadmap.md:266-267`; `03-feature-blueprint.md:264-271`; `03-feature-blueprint.md:287-291`; `06-roadmap.md:198`. | Reconcile the release summary against the feature IDs and dates. |
| C-15 | **Positioning overpromises the roadmap.** The product is positioned for “project- and machine-intensive” businesses and component intelligence, but machines are P2/1.2, component passport is P2/1.2, and maintenance convergence is P2. | `01-product-vision.md:18-21`; `01-product-vision.md:258-281`; `03-feature-blueprint.md:194-199`; `06-roadmap.md:260-265`. | Either bring a thin machine/asset reference forward, or narrow launch positioning to project allocation plus conflict-safe mobile inventory. |
| C-16 | **Some competitor evidence is not externally safe.** The MaintainX/Autodesk acquisition claim has no source in the source table; several “not verified” cells use ○ rather than ?; mobile UX assessments were not hands-on. | `02-competitor-research.md:376`; sources at `02-competitor-research.md:581-615`; matrix `02-competitor-research.md:59-78`; limitations `02-competitor-research.md:22-29`. | Add a primary source for the acquisition or remove the claim; use ? for unverified cells; add “not benchmarked” to all mobile UX conclusions used externally. |

### 2.3 Medium findings

| ID | Finding | Evidence | Required action |
|---|---|---|---|
| C-17 | **The screen catalogue has no priority or release column.** Phase counts are approximate and cannot be reproduced. | `04-mobile-blueprint.md:169-291`; `04-mobile-blueprint.md:299-304`. | Add `Priority` and `Release` columns; make the register the single source of truth. |
| C-18 | **Workflow templates are P0 but the workflow engine is P1.** | `03-feature-blueprint.md:307-314`; `03-feature-blueprint.md:338-345`; `04-mobile-blueprint.md:279`. | Ship fixed templates in P0; make the template editor P1. |
| C-19 | **Currency-change behaviour is unresolved inside the catalogue.** `AUTH-08` asks “currency immutable after stock?” | `04-mobile-blueprint.md:178`; `04-mobile-blueprint.md:270`. | Decide before company settings are built. |
| C-20 | **Minor priority drift:** item images are in P0 item master but P1 as `INV-11`; dashboards are P1 but Home is P0. | `03-feature-blueprint.md:81`; `03-feature-blueprint.md:91`; `03-feature-blueprint.md:155`; `04-mobile-blueprint.md:186`. | Clarify “single image at launch, document library later” and “basic KPI cards at launch, configurable dashboards later.” |

### 2.4 Audit conclusion

The inconsistencies are not random typos. They cluster around five design decisions that were not fully closed:

1. What is the smallest procurement object the product needs?
2. Is lot/serial part of the inventory data model from day one?
3. Is approval a primitive or a module?
4. What exactly is allowed offline?
5. Which promises belong to launch and which belong to the roadmap?

Resolve those five, and most of the smaller inconsistencies disappear.

---

## 3. Feature scope and prioritisation review

### 3.1 The scope test

A feature belongs in the first commercial release only if all four answers are yes:

1. Does it make the stock record more trustworthy?
2. Does it support the beachhead’s daily operator workflow?
3. Can it survive the offline/conflict model without a new authority rule?
4. Can NTAN support it in the pilot without bespoke services?

Using that test, the current P0 list is close but not coherent. Projects and reservations pass. Machines, full quality, kanban, BOM and maintenance do not. Several “small” dependencies, however, are mislabelled as later work.

### 3.2 Recommended release boundary

This is a recommendation for NTAN decision, not a change already applied to Docs 03–06.

| Capability | 0.9 Pilot | 1.0 Commercial | Later | Rationale |
|---|---|---|---|---|
| Auth, tenancy, RBAC, audit | Yes | Yes | — | Non-negotiable foundation. |
| Item master, categories, UOM, barcodes | Yes | Yes | — | Core catalogue. |
| Item tracking policy (`none`/`lot`/`serial`) | Yes, data model | Yes | — | Retrofitting lot/serial into the ledger is expensive. |
| Warehouses and location tree | Yes | Yes | — | Core. |
| Immutable ledger and balances | Yes | Yes | — | Core trust promise. |
| Receive, issue, transfer, return, adjust | Yes | Yes | — | Core loop. |
| Scan-to-Action and manual entry | Yes | Yes | — | Core operator path. |
| Offline drafts, outbox, status, conflict queue | Yes | Yes | — | Core trust promise. |
| Cycle counts and variance | Limited | Yes | — | Start with one location/category. |
| Projects and reservations | No, unless a design partner requires | Yes | — | The main differentiator; pilot can be project-free only if the pilot cohort agrees. |
| Batch/lot tracking | No | Yes | — | Industrial table stakes; at least receive/issue/trace. |
| Serial tracking | No | Yes for selected items | — | Heavy but necessary for installed components; scope by item type. |
| Stock status / quarantine | No | Minimal | Full QA later | Supports returns and quality holds without a full QA module. |
| Purchase-order reference | No | Minimal | Full procurement later | Needed because receiving already assumes POs. |
| Customer/party record | No | Minimal | — | Needed for issue-to-customer and project context. |
| Basic cost and inventory value | No | Yes, permission-gated | FIFO/AVCO later | Owner-facing value is part of the buying case. |
| CSV import | Yes, limited | Yes | — | Onboarding cannot be credible without it. |
| Minimal approvals | No | Yes | Rule editor later | P0 adjustments/counts need a decision primitive. |
| Mobile admin core | Yes | Yes | — | Company, users, roles, warehouses, locations, suppliers. |
| Core reports | Yes | Yes | — | Stock, movements, low stock, project allocation. |
| Labels and printing | No | No | 1.1 | Barcode generation can be P1; printing is not launch-critical. |
| Machines / assets | No | No | 1.2 | Use a generic allocation target in 1.0. |
| Full quality inspections | No | No | 1.2 | Minimal stock status only. |
| Kanban | No | No | 1.2 | Not needed to prove the wedge. |
| BOM/work orders | No | No | 1.2 | Avoid ERP pull. |
| Maintenance | No | No | 1.2 | Strong future differentiator, not launch scope. |
| Component passport | No | No | 1.2 | Either move a thin version to 1.1 or soften launch positioning. |
| Advanced insights | No | No | 2.0 | Reports first; recommendations later. |
| Integrations/API | No | No | 2.0 | Not needed for pilot. |
| Multi-currency/localisation | No | No | 2.0 | INR/English first. |
| Web dashboard | No | No | Separate decision | Preserve mobile-only focus. |

### 3.3 Recommended adjustments to the current plan

**Promote into 1.0, not necessarily the pilot:**

- Lot/batch tracking as a first-class ledger dimension.
- Serial tracking for selected item types, with uniqueness scope defined.
- Minimal purchase-order reference (manual/imported), without procurement approvals or landed cost.
- Minimal customer/party record.
- Basic permission-gated cost and inventory value.
- Stock status/quarantine as a balance dimension.
- Basic CSV import.
- A minimal approval primitive.

**Defer out of 1.0:**

- Workflow-template editor and approval-rule editor.
- Billing automation (manual invoicing is acceptable for the first cohort).
- Integrations and public API.
- Advanced dashboards and custom report builder.
- Machine registry, maintenance, full quality, kanban, BOM/work orders.
- Label printing.
- Multi-currency and additional languages.

**Do not defer the data-model decisions** even if the screens are deferred. `tracking_mode`, stock status, allocation target and cost fields are cheap to include in the initial model and expensive to retrofit.

### 3.4 Project allocation is the wedge; make it concrete

“Projects + reservations” is the right P0 differentiator, but the current definition is still high-level. Before build, specify:

- Reservation type: hard allocation versus soft recommendation.
- Reservation expiry and release behaviour.
- Whether a reservation can be partially consumed.
- Whether over-reservation is ever allowed and who can approve it.
- Reallocation across projects and priority rules.
- Cancellation of a project with open reservations.
- Whether project material held at a customer site is on-hand, in-transit or consumed.
- Variance definition: planned vs reserved vs issued vs returned vs remaining.

If these are not defined, the project module will produce disputes rather than trust.

### 3.5 RICE table caution

The RICE scores are useful conversation aids, not a prioritisation algorithm. “Push notifications” scores 15.0 and “warehouses + location tree” scores 10.0, while the differentiators score lower because their effort is higher. Do not let arithmetic demote the capabilities that create the wedge. Use RICE only after the must-have boundary is fixed.

---

## 4. Industrial requirements review

The package understands industrial inventory better than most SMB products, but several requirements are implicit rather than modelled.

| Requirement | Current treatment | Gap | Recommendation |
|---|---|---|---|
| Lot/batch traceability | `TRC-01` P1; lot detail screen P1 | No item tracking policy; no lot dimension in balance | Add `tracking_mode` and nullable lot/serial references to the initial model. |
| Serial traceability | `TRC-02` P1; serial detail screen P1 | Uniqueness scope (company/item/lot) undefined | Define uniqueness and state transitions before schema. |
| Quality hold / quarantine | `MOV-10` P1; `QA-04` P2; return “pending inspection” P0-ish | Balance has no status dimension | Add `available`, `quarantine`, `blocked` status now; full inspection templates later. |
| Incoming quality gate | Five-stage model; `QA-02` P2 | No lightweight pass/fail path in 1.0 | Add an optional receive-to-quarantine step if a design partner requires it. |
| Project allocation | `PRJ-01..05` P0 | Reservation semantics and project-site stock undefined | Define the reservation contract and project-site stock policy. |
| Machine/asset context | `MCH-01..06` P2 | Positioning promises machines before the module exists | Use a generic allocation target in 1.0; add the registry in 1.2. |
| Supplier/PO traceability | `MOV-03` assumes PO; purchasing P1 | No PO object or supplier-return flow | Add minimal PO reference; add supplier returns when procurement is built. |
| Returns/RMA | `MOV-07` return to stock; `PRJ-05` | Supplier return, repair, warranty and disposition are not modelled | Define return types and disposition codes before building returns. |
| UOM precision | `INV-05` P0; conversion factors versioned | No rounding, decimal-precision or fractional-unit policy | Add quantity precision and rounding rules to the item/UOM model. |
| Reason codes | Reasons required in movements | No controlled taxonomy | Define a seeded reason-code list per action; allow company extension later. |
| Approvals and segregation | Adjustments/counts require approval | No approval entity or delegation model | Add a generic approval request/decision model. |
| Negative stock | `MOV-12` P0; default block recommended | Invariant `reserved ≤ on_hand` conflicts with “allow negative” | Define the exception explicitly and test it. |
| Consignment/customer-owned stock | Not modelled | Common in automation and site work | Validate with design partners; if required, add ownership dimension. |
| Calibration/regulatory records | Not modelled | May be required in quality-sensitive segments | Keep out of scope for launch; validate before selling there. |
| Barcode standards | GS1/QR support | No label-quality or damaged-label acceptance criteria | Add scanner field tests with real industrial labels. |

### 4.1 Industrial release gate

Before claiming industrial readiness, the product should demonstrate:

- Receive a lot or serial into a bin, quarantine it, release it, issue it to a project, return it, and trace the full history.
- Reserve material for a project, issue part of it, return unused material, and explain the variance.
- Handle a unit of measure that is bought in one unit and issued in another, with no silent rounding.
- Show why a movement was blocked or overridden, with actor, device, reason and source document.
- Survive a two-week pilot without spreadsheet reconciliation.

If any of these cannot be shown, the product is a mobile stock tracker, not an industrial inventory system.

---

## 5. Database decision review

### 5.1 Assessment

The analysis in Doc 05 is directionally correct: PostgreSQL is the stronger default for an inventory system of record. The document correctly identifies transactions, concurrency, reporting, tenant isolation and schema flexibility as the deciding criteria.

However, the decision is still marked open, and the weighted score creates false precision:

- The weights are judgement calls, not measured requirements.
- “Transaction correctness” and “concurrency control” overlap heavily.
- There is no workload benchmark, cost estimate, team-skill assessment or managed-service comparison.
- The scores are not reproducible from the scenarios.
- Hybrid is listed as an option without a concrete use case that justifies the operational overhead.

The recommendation should be treated as a **structured argument for PostgreSQL**, not a benchmark result.

### 5.2 Recommendation

**Approve PostgreSQL as the provisional system of record at Gate 1, subject to a short validation spike.**

Conditions:

1. Run a one-week spike covering concurrent receive/reserve, row locking, RLS, JSONB custom fields, a 10k-item/100k-movement report query, and backup/restore.
2. Confirm managed PostgreSQL availability and cost in the required India region.
3. Confirm the team can operate PostgreSQL, or budget for managed support.
4. Use RLS plus an application-level tenant guard; the application role must not bypass RLS.
5. Make the ledger append-only through privileges and triggers; the application role must not have `UPDATE`/`DELETE` on posted movements.
6. Partition large movement/audit tables by company and time.
7. Use a read replica or materialised views for reporting; measure freshness.
8. Record the decision in Doc 07 and ADR-004. “Open” must not mean “undecided during schema work.”

Do not choose hybrid for the initial product without a validated need. It adds operational complexity before the core is proven.

### 5.3 If MongoDB is selected instead

The existing MongoDB safeguards are reasonable, but they should be strengthened with:

- A named engineer accountable for transaction and retry correctness.
- A reconciliation job that runs daily and alerts on balance drift.
- Database-per-tenant or a rigorously tested tenant guard; no query without tenant scope.
- Read models for reporting from day one.
- A documented index and schema-validation strategy.
- A migration/exit plan if the decision proves wrong.

MongoDB is defensible if NTAN has proven operational expertise and accepts the extra discipline. It is not the lower-risk default for this product.

### 5.4 What can proceed before the database decision

- Domain model and invariants.
- API contract design.
- Screen and workflow design.
- Design system and navigation shell.
- Scanner and offline spike using local storage.
- Customer validation.

Schema, migrations, RLS implementation, ledger tables and production provisioning should wait.

---

## 6. Modular architecture review

### 6.1 What is sound

- Modular monolith is the right initial shape for a small team.
- The ledger is the source of truth; balances are projections.
- Idempotency keys and a transactional outbox are the right patterns.
- The server is authoritative for stock; the client is not trusted.
- The module boundary rule — optional modules may not keep independent stock balances — is essential.
- Audit, tenant isolation and reporting are treated as first-class concerns.

### 6.2 What needs a contract before build

| Area | Current state | Required clarification |
|---|---|---|
| Core transaction API | Described conceptually | Define commands (`receive`, `issue`, `transfer`, `reserve`, `consume`, `return`, `adjust`) with idempotency key, expected version, source document, reason and actor. |
| Module boundaries | Folder-level modules | Define which module owns which table and which service interface other modules may call. No direct cross-module table access. |
| Balance projection | On-hand/reserved/in-transit | Specify whether projection updates are in the same transaction as the movement; define rebuild and drift-alert procedures. |
| Allocation | Polymorphic project/machine/work order | Define allocation target types, cardinality and lifecycle. Avoid a hard dependency on the machine module. |
| Lot/serial | Deferred but referenced | Add nullable lot/serial references and tracking policy now; define uniqueness scope. |
| Stock status | Missing | Add status or explicitly document that quarantine is not in 1.0. |
| Reservations | Described at feature level | Define hard/soft, expiry, priority, partial consumption, release and over-reservation policy. |
| Counts | Session/variance model | Define snapshot vs live count, freeze policy, concurrent movement handling and recount. |
| Transfers | In-transit state | Define state machine, partial receipt, cancellation after dispatch, discrepancy and ownership of in-transit stock. |
| Returns | Return-to-stock | Define return types: project return, customer return, supplier return, repair, warranty, scrap; condition and disposition. |
| Approvals | Required in P0 | Define approval request, decision, delegation, thresholds and segregation of duties. |
| Sync aggregate | Per item/location | Transfers and project issues span multiple aggregates; define document-level idempotency and server-side transaction boundaries. |
| Idempotency retention | Not specified | Define retention window, key scope and replay behaviour. |
| Tenant deletion/export | Mentioned | Define workflow, retention, legal hold and backup implications. |
| Reporting freshness | Read models proposed | Define which reports are real-time, which are cached, and how “as of” is displayed. |

### 6.3 Non-negotiable invariants

1. No posted movement is edited or deleted.
2. Sum of movements reconciles to on-hand.
3. `reserved ≥ 0`; `available = on_hand − reserved − blocked/quarantine` if stock status exists.
4. A serial exists in at most one active state/location.
5. A reservation cannot be consumed twice.
6. Every movement has an actor, source document, reason where required, business time and recorded time.
7. Every mutation is idempotent by client operation key.
8. No tenant can read or mutate another tenant’s data through any route, export, file URL or search path.

### 6.4 What not to build

- Microservices for their own sake.
- Per-tenant code forks.
- Independent stock balances inside projects, machines or quality.
- Client-side stock authority.
- Event sourcing as a dogma; an append-only ledger plus projections is sufficient.
- A generic workflow engine before the first three workflows are proven.

---

## 7. Mobile UX and screen review

### 7.1 What is strong

- Five-tab maximum, with Scan at the centre, is the right information architecture.
- The Draft / Queued / Syncing / Applied / Rejected / Conflict state model is excellent and should be treated as a product requirement, not a UI detail.
- Offline classification into safe drafts, server-validated transactions, read-only cache and online-only actions is the correct framing.
- The accessibility baseline (44 dp targets, dynamic type, non-colour status, manual scan fallback) is appropriate.
- The performance and device targets are concrete enough to test.

### 7.2 What must change

1. **Build the screen register first.** The catalogue cannot be planned or estimated until every screen has an ID, priority, release, primary roles and dependencies. Fix the 81/78 discrepancy in the same pass.
2. **Add Sync Center screens.** A P0 differentiator without a screen is not a feature.
3. **Resolve the PO, customer and lot/serial screen gaps.** Do not ship forms that require objects the product cannot create.
4. **Reduce MVP admin scope.** Roles, custom fields, workflow templates, approval rules, billing, integrations, security policy and audit exports are too much for a phone-first 1.0. Keep company, users, roles, warehouses, locations, suppliers and basic settings; defer the rest.
5. **Define the offline action matrix.** For each screen/action, state: draftable offline, online-only, or read-only. Replace “offline execution” with “offline capture; server-validated commit.”
6. **Clarify stale balance language.** “Resulting balance before commit” is useful online but misleading offline. Show “estimated; server will validate” when cached.
7. **Add industrial usability tests.** Gloves, wet hands, low light, noise, one-handed use, shared devices and landscape/tablet use are not yet explicit test scenarios.
8. **Validate language earlier.** English-only launch may be acceptable for admins but not for floor operators in the beachhead. Test Hindi/Marathi need before committing to 1.1.

### 7.3 Screen-count recommendation

- **Pilot 0.9:** 30–35 screens, focused on auth, item/location setup, receive/issue/transfer, scan, ledger, counts, core reports, minimal admin and sync status.
- **Release 1.0:** approximately 45 screens, adding projects/reservations, lot/serial detail, minimal PO, customer, stock status and basic valuation.
- **Full catalogue:** 81 screens plus Sync Center, PO and customer screens; do not use “78” again.

These are planning caps, not targets. A smaller, complete workflow is better than a broad, half-finished catalogue.

### 7.4 Mobile-only administration risk

The product’s decision to be mobile-only is defensible for the operator. It is not yet proven for the administrator. The riskiest admin tasks are:

- Editing a capability matrix.
- Building custom fields.
- Reordering workflow stages.
- Configuring approval rules.
- Reviewing an audit trail with before/after values.
- Reconciling a sync conflict.

Test these with at least three real admins on phones and tablets. If they fail, either simplify the workflow or reconsider a future read-only web console. Do not discover this during the pilot.

---

## 8. Differentiation and evidence review

### 8.1 What is credible

- **Project/allocation ledger:** the clearest gap between ERP depth and SMB mobile simplicity.
- **Conflict-safe offline trust:** genuinely underserved, and hard for competitors to copy superficially.
- **Scan-to-action speed:** valuable, but table stakes as a concept; execution and offline state are the differentiators.
- **India-first support and pricing:** credible if NTAN actually staffs it.

### 8.2 What is overclaimed or premature

| Claim | Problem | Recommendation |
|---|---|---|
| “Project- and machine-intensive” | Machines are P2/1.2; the launch product is project-intensive. | Say “project-intensive inventory with asset-ready allocation”; add machines when real. |
| Industrial component intelligence | Strong idea, but P2/1.2 and not in the MVP. | Move a thin MPN/spec/datasheet view to 1.1, or present it as roadmap. |
| Maintenance + spare-parts convergence | Compelling, but P2 and unvalidated. | Keep as a future wedge; do not use it in launch sales. |
| “Scan-to-Action” as unique | Competitors scan; the doc already admits this. | Compete on action discovery, speed and offline state, not scanning alone. |
| “Configurable industry templates” | Templates are named, but their content is not specified. | Define one complete beachhead template before build; otherwise this is slideware. |
| Best-in-class mobile UX | Not benchmarked hands-on. | Use “mobile-first by design”; validate against Sortly/MaintainX in usability tests. |

### 8.3 Recommended launch position

> **Mobile-first inventory for project-based industrial businesses: every scan becomes a permitted, auditable action, and every allocation is visible even when the network is not.**

This is narrower, provable in the pilot, and still leaves room for machines, component intelligence and maintenance as expansion stories.

### 8.4 Proof plan for differentiators

| Differentiator | Proof in pilot | Metric |
|---|---|---|
| Scan-to-Action | Operator completes issue/receive from scan without navigation help | Median scan-to-commit < 30 s |
| Conflict-safe offline | Queued operation survives restart; conflict is visible and resolvable | Sync success > 99%; conflict rate < 1% |
| Project allocation | Manager can explain reserved vs issued vs returned | Variance reconciled for every pilot project |
| Industrial traceability | Lot/serial can be traced from receipt to project/return | 100% of tracked movements traceable |
| Template onboarding | New company receives first real item within 30 minutes | Time-to-first-receipt |

### 8.5 Evidence hygiene

Before any external deck, website or sales conversation:

- Source or remove the MaintainX/Autodesk acquisition claim.
- Use `?` for unverified matrix cells.
- Date-stamp every price and state the region.
- Do not call any capability “unique.”
- Do not present mobile UX ratings as hands-on benchmarks.
- Re-verify all competitor claims within 30 days of external use.

---

## 9. Branding and design-system review

### 9.1 Verified foundation

The verified NTAN palette and typography are a good starting point:

- Primary `#2E5BBF`
- Deep blue `#1C5C93`
- Navy `#213767`
- Secondary navy `#364F86`
- Dark navy `#1F3548`
- Accent yellow `#FBCC00`
- Surface `#F5F9FC`
- Link `#428BCA`
- Hover `#9ECCF4`
- Body `#444444`
- Muted `#5C768D`
- Raleway headings, Open Sans body

### 9.2 Gaps

- The logo is a JPEG. A product needs vector/SVG, transparent PNG, monochrome, high-resolution and app-icon variants.
- No clear-space, minimum-size or misuse rules are documented.
- No app icon, adaptive icon, splash screen, notification icon or store-listing visual system exists.
- No documented type scale, spacing scale, radius, elevation, motion or icon style.
- Status colours are still “proposed green/amber/red” without accessible values.
- Dark mode is deferred, but its token structure is not defined.
- No brand-approval checklist for the app store or external collateral.

### 9.3 Contrast and accessibility findings

Calculated from the sRGB values (confirm with an accessibility tool):

- `#5C768D` on `#F5F9FC` is approximately **4.48:1**, just below WCAG AA 4.5:1 for normal text. Darken the muted text or reserve it for large text.
- `#FBCC00` on white is approximately **1.53:1**. It is an accent, not a text colour. Use dark text on yellow, and never use yellow alone to signal a status.
- `#2E5BBF` on white is approximately **6.2:1** and is suitable for primary text/buttons, subject to state testing.

### 9.4 Typography and performance

Raleway and Open Sans are appropriate for brand consistency, but custom fonts add bundle size and startup work. Limit the app to a small set of weights (for example, Raleway 600/700 and Open Sans 400/600), subset the fonts, and define system-font fallbacks. Confirm licensing and test cold-start impact on low-end Android.

### 9.5 Brand approval checklist

- [ ] Vector logo and monochrome version received.
- [ ] Clear-space and minimum-size rules approved.
- [ ] App icon, adaptive icon, splash and notification icon approved.
- [ ] Type scale and font weights approved.
- [ ] Spacing, radius, elevation and motion tokens approved.
- [ ] Functional status colours and contrast verified.
- [ ] Icon and illustration style approved.
- [ ] Product name and store-listing name approved.
- [ ] Brand voice and error-message tone approved.
- [ ] External-use rights for logo and colours confirmed.

The design system can start with the verified tokens; these items should not block a Phase 1 design spike, but they must be closed before store submission.

---

## 10. Readiness, ranked decisions and next-stage sequence

### 10.1 Gate 0 readiness

| Gate 0 item | Status | Comment |
|---|---|---|
| Product vision and ICPs | Ready | Narrow the launch positioning. |
| Competitor evidence | Ready with corrections | Fix unsourced acquisition and unverified cells. |
| Feature scope | Not ready | Resolve PO, lot/serial, approvals, valuation, stock status. |
| Mobile blueprint | Not ready | Fix count, add Sync Center/PO/customer, add priority register. |
| Architecture direction | Ready with conditions | PostgreSQL recommendation is sound; decision not recorded. |
| Database decision | Blocking | Must be recorded before schema work. |
| Roadmap and team | Not ready | 22-week estimate needs capacity validation. |
| Risks and assumptions | Ready | Good register; add owners and review dates. |
| Brand | Partially ready | Tokens verified; assets and contrast incomplete. |
| Design partners | Blocking for pilot | No named cohort. |

### 10.2 Ranked management decisions

| Rank | Decision | Recommendation | Why now | Deadline |
|---|---|---|---|---|
| 1 | Primary database (D-01) | PostgreSQL, conditional on a one-week spike | Blocks schema, migrations and core build | Within 1 week |
| 2 | MVP boundary (D-07, D-08, D-22) | Projects in 1.0; lot/serial in 1.0 model; minimal PO; stock status; machines 1.2 | Determines screens, schema and 22-week estimate | Within 2 weeks |
| 3 | Offline policy (D-05) | Offline capture and queue only; server-authoritative commits | Determines sync design and acceptance tests | Within 2 weeks |
| 4 | Beachhead and design partners (D-03, D-23) | Automation + precision manufacturing; name 5 to keep 3 | Without real sites, the MVP is unvalidated | Within 2 weeks |
| 5 | Team, budget, timeline (D-24) | Confirm capacity or extend the 22-week estimate | The current scope is aggressive for the stated team | Within 2 weeks |
| 6 | Mobile-only admin (D-04) | Keep mobile-only for v1; test admin tasks on phone/tablet | Could force a web console or scope cut | Before UX freeze |
| 7 | Brand assets and tokens | Approve verified tokens; obtain vector logo/app icon | Needed before design-system and store work | Before Phase 1 design |
| 8 | Hosting, compliance, retention (D-12, D-13, D-17) | India region; DPDP readiness; 7-year default | Affects infrastructure, cost and legal | Before Phase 1 build |
| 9 | Pricing and pilot model (D-06) | Paid pilot + tier hypothesis; validate before publishing | Needed for commercial terms, not for code | Before pilot recruitment |
| 10 | Success metrics (D-25) | Adopt one definition per metric and reconcile 99%/99.5% | Needed for pilot exit criteria | Before Gate 2 |

### 10.3 Recommended next-stage sequence

**Step 0 — Decision workshop (1 week, no code)**

- NTAN management reviews this document and the ten ranked decisions, starting with the five immediate blockers.
- Record decisions in Doc 07 using the existing decision-log format.
- Do not start schema or stock-posting code.

**Step 1 — Blueprint correction (1 week)**

- Build the screen register; correct 81/78 and phase counts.
- Add Sync Center, PO-reference and customer screens, or explicitly remove those flows.
- Resolve PO, lot/serial, approval, valuation and offline contradictions.
- Align positioning with the release plan.
- Update Docs 03–07 under change control.

**Step 2 — Customer validation (2–3 weeks)**

- 8–12 structured interviews across automation, manufacturing and maintenance.
- Shadow at least two sites for receiving, issue, count and project return.
- Validate lot/serial, quality hold, project-site stock, PO/ERP reality, shared devices, language and connectivity.
- Validate willingness to pay and the paid-pilot model.

**Step 3 — Technical spikes (1–2 weeks)**

- Database spike: concurrent receive/reserve, RLS, JSONB, report query, backup/restore.
- Scanner spike: low-end Android, iPhone, low light, damaged labels, duplicate suppression.
- Offline spike: SQLite outbox, restart survival, replay, conflict queue.
- Auth/tenancy spike: invite, workspace select, cross-tenant denial.
- No production schema or feature build.

**Step 4 — Scope freeze and Gate 1 (1 week)**

- Approve the MVP register and acceptance criteria.
- Record ADRs and the database decision.
- Confirm pilot cohort, team and budget.
- Only then start Phase 1 foundation.

**Step 5 — Phase 1 foundation (6 weeks)**

- Design system, navigation shell, auth, tenancy, core model, scanning/offline spikes, CI/CD and staging.
- Exit Gate 1 only when the technical spine is proven.

### 10.4 What can start immediately

- Design tokens and component primitives.
- Navigation shell and screen-flow prototypes.
- Scanner field tests.
- Offline outbox prototype.
- Customer interviews and site shadowing.
- Brand asset collection.

### 10.5 What must not start yet

- Database schema, migrations or production provisioning.
- Stock-posting code.
- Final screen implementation.
- App-store submission.
- Pricing publication.
- External competitor claims that have not been re-verified.

### 10.6 Final recommendation

**Approve Phase 0 direction conditionally.** Preserve the ledger, mobile-first, offline-trust and project-allocation strategy. Do not approve the current scope as build-ready. Close the five critical design decisions, correct the screen register, validate the industrial requirements with real sites, and record the database decision before Phase 1 creates schema or stock-posting code.

A late, trustworthy release is recoverable. A product that promises industrial traceability but cannot explain a lot, a project return or an offline conflict is not.
