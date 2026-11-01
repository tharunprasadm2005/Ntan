# 10 — Gate 0 Management Decision Brief

**Status:** Proposed decision brief for NTAN management
**Date:** 2026-10-22
**Basis:** `09-gate0-resolution.md`; Docs 01–08 by reference
**Purpose:** Convert the Gate 0 resolution into recorded decisions and an executable database validation spike.
**Scope:** Decisions and validation design only. No application code, framework, package, schema, migration or production provisioning.
**Rule:** A recommendation is not an approval. Silence, discussion or an expired deadline is not approval.

---

## 1. Executive summary

- There are **19 Gate 0 decisions**: **10 architecture-critical**, **5 release-critical** and **4 deferrable until later**.
- The critical path is the database decision, the approved 1.0 scope, the lot/serial and stock-status model, offline authority, team/budget/timeline, and hosting/compliance.
- PostgreSQL is conditionally recommended. The recommendation should be tested through a **5-day, correctness-first spike** before schema work.
- NTAN should approve the architecture-critical package first. The development team can then proceed with bounded defaults without waiting for commercial or brand decisions.
- Gate 0 is complete only when every decision has a recorded disposition, the database decision is recorded, and the evidence required in §8 exists.

### 1.1 Recommended sequence

1. Hold one decision meeting for the 10 architecture-critical decisions.
2. Authorize the database spike and name its owner.
3. Record decisions in the Doc 07 decision log and update ADR-004.
4. Approve release-critical decisions before 1.0 scope freeze.
5. Schedule deferrable decisions with named owners and dates.
6. Close Gate 0 only when the acceptance evidence in §8 is complete.

---

## 2. How to read this brief

### 2.1 Decision groups

| Group | Meaning | Count |
|---|---|---:|
| **A — Before architecture implementation** | A wrong or delayed decision changes schema, tenancy, sync, security or delivery capacity. | 10 |
| **B — Before first commercial release** | Can follow architecture start, but must be settled before 1.0 scope freeze or pilot commitments. | 5 |
| **C — Can be deferred until later** | Not architecture-blocking. Must still have an owner, a recorded disposition and a latest decision date. | 4 |

### 2.2 Approval legend

- **Yes — management:** NTAN management must approve, approve with conditions, or reject.
- **Yes — policy:** NTAN approves the policy; implementation details may be delegated.
- **No — delegated:** Product owner or technical lead may decide within the approved scope; the decision must still be logged.

### 2.3 Important rule

A “recommended default” is the proposed answer, not an approved answer. Development may rely on a default only after the decision is recorded as approved or explicitly delegated.

---

## 3. Group A — Must decide before architecture implementation

These decisions define the system boundary. They should be answered together because they interact.

| ID | Exact question | Recommended default | Alternatives | Business consequences | Technical consequences | NTAN approval |
|---|---|---|---|---|---|---|
| **G0-01** | Which database will be the transactional system of record for stock, reservations, ledger, audit and tenant data? | PostgreSQL, conditional on the §6 spike. | MongoDB with multi-document transactions; hybrid PostgreSQL ledger plus MongoDB documents. | PostgreSQL lowers oversell, reconciliation and audit risk. MongoDB may reduce document-model friction and scale horizontally, but shifts correctness work into application discipline. | PostgreSQL provides multi-row ACID, RLS and SQL reporting. MongoDB requires transactions on every stock path, persisted availability guards, reconciliation and rigorous tenant filtering. | **Yes — management** |
| **G0-02** | Do we approve the 87-screen register and 64 cumulative 1.0 screens, or enforce the old 48-screen ceiling? | Approve 87 total; 36 pilot, 64 cumulative at 1.0; no unapproved P1 promotion. | Hard 48-screen 1.0 with a 16-screen cut to 1.1; reduce the pilot instead. | 64 preserves P0 completeness and avoids hidden dependencies. 48 shortens 1.0 but removes workflow completeness and can break acceptance criteria. | 64 sets the API, UI, permission and test surface. 48 requires explicit removal from the data model, permissions and acceptance criteria, not just a smaller list. | **Yes — management** |
| **G0-03** | Do we model lot/serial now and keep detail screens at 1.1, or promote lot/serial into 1.0? | Model now; keep `INV-15/16` at 1.1; remove lot/serial validation from 1.0 acceptance where unsupported. | Promote screens and validation to 1.0; defer the model entirely. | Model-now avoids an expensive retrofit and supports traceability. Promotion adds 1.0 scope, training and support load. | Adds `tracking_mode` and lot/serial dimensions to balance, movement and allocation. Promotion also adds screens, scanning and validation paths. | **Yes — management** |
| **G0-04** | Does 1.0 include minimal purchase-order screens `PO-01/02`, or ad hoc receiving only? | Minimal PO list/detail in 1.0; full procurement depth in 1.1. | Ad hoc receiving only with no PO; full PO in 1.0. | Minimal PO closes the receiving traceability gap. No PO risks adoption and audit gaps. Full PO expands scope. | Adds PO header/line and source-document links. No PO keeps receipts standalone but weakens traceability. | **Yes — management** |
| **G0-05** | Does 1.0 include minimal customer records `CUS-01/02`, or remove customer as an issue destination? | Minimal customer list/detail in 1.0. | Free-text customer only; remove customer destination; full CRM-lite. | Preserves issue-to-customer and customer/project reporting. Free text creates dirty data and weak reporting. Full CRM is scope creep. | Adds a customer party type and optional customer reference on issues/allocations. Free text weakens validation and reporting. | **Yes — management** |
| **G0-06** | Should stock status be a first-class balance dimension now, with quarantine management deferred to 1.1, or should minimal quarantine UI be in 1.0? | Add `available`, `quarantine` and `blocked` now; no dedicated quarantine UI at 1.0. | Minimal quarantine UI at 1.0; defer the status dimension to 1.1. | Supports truthful returns and quality handling without expanding 1.0. No UI limits quarantine workflows; adding UI expands scope. | Adds `stock_status` to the unique balance dimension, availability math, movement and APIs. UI adds screens, permissions and workflow. | **Yes — management** |
| **G0-07** | Do we approve a single-step P0 approval primitive in 1.0, with thresholds and approver roles, no self-approval by default, and full rules at 1.1? | `APR-01` plus minimal settings in 1.0; full rules, delegation and escalation at 1.1; owner override only with audit when no approver exists. | Fixed thresholds with no settings; full rule engine in 1.0; no approvals. | Unblocks adjustment and count governance. A full engine adds cost. Fixed thresholds reduce flexibility. No approvals would fail P0 acceptance criteria. | Adds approval request/decision models, state machine, segregation and idempotent posting. A rule engine adds conditions, escalation and template complexity. | **Yes — policy** |
| **G0-08** | Will all stock-affecting operations be server-authoritative, with offline limited to capture and queue and no offline stock execution? | Approve offline draft/queue only; no stock-affecting offline execution; approval decisions and conflict resolution are online-only. | Allow selected offline commits; drafts only with no queue; online-only. | Protects trust and prevents oversell and silent data loss. Online-only weakens field use; offline commits create hard conflict and liability problems. | Requires idempotent outbox, sync state machine, server validation and conflict handling. Offline commits require distributed conflict resolution and stronger reconciliation. | **Yes — management** |
| **G0-11** | Is the team, budget and 22-week timeline approved, or must scope or time change? | Confirm named team and budget; keep 22 weeks only if capacity is confirmed; otherwise extend or reduce scope. | Extend timeline; reduce 1.0 scope; add contractors. | Protects pilot quality and partner commitments. An unrealistic plan risks burnout, missed dates and a weak release. | Determines parallel workstreams, environment capacity, QA and review bandwidth. Under-staffing forces shortcuts in schema, security and testing. | **Yes — management** |
| **G0-13** | Is India-region hosting, DPDP readiness and seven-year default retention approved? | India region; DPDP-aligned controls; seven-year audit retention default unless a customer contract differs. | Other region; shorter retention; customer-specific retention. | Meets likely customer and legal expectations. Other regions add latency and compliance risk. Short retention may fail audits. | Affects vendor, region, encryption, backup, partitioning, deletion and data residency. Retention affects table growth and archive design. | **Yes — management** |

---

## 4. Group B — Must decide before the first commercial release

These decisions can follow the architecture start, but must be settled before 1.0 scope freeze, pilot recruitment or release commitments. Latest points: G0-09 before UX freeze; G0-10 before pilot recruitment; G0-17, G0-18 and G0-19 before 1.0 scope freeze.

| ID | Exact question | Recommended default | Alternatives | Business consequences | Technical consequences | NTAN approval |
|---|---|---|---|---|---|---|
| **G0-09** | Will v1 administration remain mobile-only, with a web console deferred? | Mobile-only for v1; test admin tasks on phone and tablet; defer a web console. | Read-only web console in 1.0; full web admin; desktop-only admin. | Keeps scope and the mobile promise. May frustrate heavy admin users. A console adds cost and a second product surface. | Avoids a second UI surface. Mobile admin constrains dense tables and editors. A console adds authentication, responsive design and deployment work. | **Yes — policy** |
| **G0-10** | Which beachhead and which 3–5 design partners will validate the pilot? | Automation plus precision manufacturing; name five to retain three, with named operational owners. | Warehousing-first; maintenance-first; three direct partners; broad multi-industry pilot. | A focused wedge improves validation and references. A broad pilot fragments feedback and support. | Drives device mix, data quality, integration and offline test coverage. A broad mix expands the test matrix. | **Yes — management** |
| **G0-17** | Should 1.0 hide monetary value and defer valuation to 1.1, or include basic standard/last-cost value? | Hide value in 1.0; valuation and aging at 1.1; use quantity or percentage approval thresholds. | Basic standard/last-cost value in 1.0; full valuation in 1.0. | Avoids false financial precision and scope growth. May disappoint owners who expect value. Basic cost adds value but requires cost governance. | No exposed cost fields or valuation reports; quantity/percentage thresholds. Valuation adds cost layers, permissions, reports and audit. | **Yes — policy** |
| **G0-18** | Should 1.0 use no stock freeze and no in-session recount, deferring both to 1.1? | No freeze; reject overlapping sessions; no recount in `AC-09`; a re-count requires a new session. | Recount in 1.0; freeze scope in 1.0; both. | Simpler pilot counts and fewer states. Some auditors may expect freeze or recount; adding them slows counts. | No freeze state or in-session recount workflow; overlap detection only. Adding them requires session state, permissions and UI. | **No — delegated** |
| **G0-19** | Should 1.0 include basic CSV import and fixed workflow templates, with editors deferred to 1.1? | Basic CSV item/opening-balance import and fixed templates at 1.0; guided import and template editor at 1.1. | Defer import; build full import or template editor in 1.0; manual onboarding only. | Reduces onboarding friction and partner setup time. Manual-only risks pilot delays. Full editors add scope. | Adds import validation, column mapping and template seed data. Full editors add workflow configuration UI and validation. | **No — delegated** |

---

## 5. Group C — Can be deferred until later

These decisions are not architecture-blocking. They still need an owner, a recorded disposition and a latest decision date. Latest points: G0-12 before design lock; G0-14 before pilot recruitment; G0-15 before pilot start; G0-16 before store submission.

| ID | Exact question | Recommended default | Alternatives | Business consequences | Technical consequences | NTAN approval |
|---|---|---|---|---|---|---|
| **G0-12** | Are the proposed brand tokens approved and will NTAN provide vector logo and app-icon assets? | Approve verified tokens; obtain vector logo, app icon, adaptive icon and store assets; fix the muted-text contrast. | Temporary wordmark and system icon; revise palette; defer brand work. | Affects store readiness, trust and brand consistency. Temporary assets risk rejection and rework. | Affects design tokens, theme, asset pipeline and accessibility contrast. | **Yes — management** |
| **G0-14** | Will the pilot be paid, and which pricing and tier hypothesis will be tested? | Paid pilot with a tier hypothesis; validate willingness to pay before publishing prices. | Free pilot; subscription-only; services-led; usage-based. | A paid pilot tests value and filters poor-fit partners. A free pilot speeds recruitment but weakens the signal. | No billing engine at 1.0; manual invoicing. The model may later affect plan limits and usage metering. | **Yes — management** |
| **G0-15** | Are the success thresholds approved: 99% pilot exit, 99.5% product target, at least 98% accuracy, under 30 seconds scan-to-issue, and under 1% conflict rate? | Approve staged metrics; instrument before the pilot; report by cohort and warehouse. | One threshold for all stages; different targets; defer metrics. | Defines pilot success and go/no-go. Unrealistic targets distort behavior and partner expectations. | Requires event instrumentation, dashboards and data-quality checks. | **Yes — management** |
| **G0-16** | Will “NTAN Inventory” remain the working name and will NTAN own the app-store accounts? | Keep the working title; NTAN owns Apple and Google accounts; finalise the name before store submission. | Alternate name; developer-owned accounts; rebrand later. | Avoids store and legal ownership risk. A late rebrand costs marketing and trust. | Bundle IDs, signing, store metadata, deep links and analytics identity depend on it. | **Yes — management** |

---

## 6. Database validation spike

### 6.1 Purpose

Test whether PostgreSQL or MongoDB is the lower-risk system of record for the five hard inventory problems. This is a **correctness test**, not a feature bake-off or a general database benchmark.

**Authorization required before the spike starts.** The spike may create a disposable benchmark harness and synthetic data only after written approval; it must not create the product schema, migrations or production resources. No spike code or packages are created by this brief.

### 6.2 Timebox and setup

| Item | Proposal |
|---|---|
| Duration | 5 working days |
| Team | One backend engineer; part-time architecture/DBA review |
| Environment | Managed PostgreSQL and MongoDB in the approved India region, equivalent instance classes, disposable accounts |
| Dataset | 10,000 items, 100 locations, 100,000 movements, 5,000 reservations, 1,000 lots/serials, 2 tenants |
| Source data | The same synthetic fixtures loaded into both databases |
| Guardrail | Both implementations use their documented safeguards; no hand-tuned unfair advantage |
| Non-goals | UI, production provisioning, product schema, migration, full-scale load test, vendor lock-in analysis |

### 6.3 Test cases and objective measures

#### S1 — Concurrent stock issues

- Run 200 concurrent clients against 100 SKUs with limited stock and 5,000 issue attempts, including duplicate idempotency keys and retries.
- **Hard gates:** zero oversells, zero negative stock unless policy explicitly allows it, ledger sum equals balance, duplicate retry returns the original result.
- **Measures:** throughput; p50/p95/p99 latency; transient retry rate; lock waits; correctness failures.

#### S2 — Reservations

- Run 100 concurrent reserve, consume, release and issue operations on 20 contested items, with 2,000 operations.
- **Hard gates:** no double consumption, `reserved <= on_hand`, `available = on_hand - reserved - blocked`, no orphan reservations.
- **Measures:** p95 latency, conflict rate, retry rate, reservation drift.

#### S3 — Stock movement and audit history

- Load 100,000 movements and 100,000 audit events; append at 1,000 events per second for 10 minutes; query item history, project trace and audit by actor/date.
- **Hard gates:** zero lost writes; posted movements cannot be updated or deleted; history totals match the ledger; restore produces matching counts.
- **Measures:** append throughput, history p95 latency, index size, restore time.

#### S4 — Tenant isolation

- Use two tenants and 10,000 adversarial queries or operations with forged tenant identifiers.
- **Hard gate:** zero cross-tenant reads or writes.
- **Measures:** isolation mechanism tested, policy coverage, bypass attempts, query-plan/index coverage.

#### S5 — Reporting

- Run stock on hand, valuation, aging and project-variance queries against 10,000 items and 100,000 movements.
- **Hard gate:** totals match golden fixtures.
- **Measures:** p95 query latency under 10 concurrent reports; effect on concurrent writes; freshness if a read replica or materialised view is used.
- Target for core reports: **p95 under 2 seconds**, consistent with `AC-15`.

### 6.4 Pass/fail and scoring

Hard gates must pass before scoring:

- zero oversells;
- zero double-consumed reservations;
- zero unresolved ledger/balance drift;
- zero cross-tenant leakage;
- immutable posted movements and audit events;
- no lost acknowledged write.

If the hard gates pass, compare:

| Criterion | Weight |
|---|---:|
| Concurrency and latency | 25% |
| Reporting fit | 25% |
| Tenant isolation and audit enforceability | 20% |
| Operational effort, restore and cost | 20% |
| Schema flexibility and team familiarity | 10% |

### 6.5 Decision rule

1. If only one database passes all hard gates, select it.
2. If both pass, select the higher weighted score with lower operational risk; do not choose MongoDB on flexibility alone.
3. If PostgreSQL passes, adopt PostgreSQL unless MongoDB is materially better on scale, cost and proven team capability.
4. If MongoDB is selected, the safeguards in `05-technical-architecture.md` §5.4 are mandatory.
5. If neither passes, pause architecture work and fix the test design or product invariants before choosing.
6. Hybrid is not a fallback for unresolved correctness; it requires a concrete document or telemetry workload.

### 6.6 Deliverables

- A spike report with environment, dataset, queries, raw results, cost and limitations.
- An updated ADR-004 recommendation for NTAN approval.
- A decision-log entry in Doc 07.
- A reproducible fixture and test plan for later regression use.
- A clear statement of what the spike did **not** prove.

---

## 7. What the development team can decide without delaying progress

### 7.1 Not development-team decisions

None of the 19 decisions is a bare development-team decision. They change scope, policy, commercial terms, legal posture or architecture. The team cannot approve them on NTAN’s behalf.

### 7.2 Safe parallel work

The development team can proceed on the following **sub-decisions** without waiting for Group B or C, provided Group A is approved and the work remains paper/design-only until authorization:

- Exact schema, index and partitioning design after the database decision.
- API contracts, idempotency-key format and transaction boundaries.
- Screen layout, navigation labels, component states and error copy within the approved register.
- Approval threshold seed values, role mapping and reason-code list within the approved policy.
- Offline retry, backoff and conflict-state UX within the approved authority matrix.
- Synthetic fixtures, benchmark harness design and the device test matrix.
- Import column mapping and fixed-template content within the approved 1.0 scope.
- Report query and read-model design within the approved value-visibility rule.

### 7.3 Decisions that must not be delegated

- Database choice.
- 1.0 scope and screen count.
- Lot/serial promotion.
- Stock-status dimension.
- Offline stock authority.
- Team, budget and timeline.
- Hosting region, DPDP posture and retention.
- Design partners and pricing.
- Brand/name/store ownership.

### 7.4 Practical effect on the 19 decisions

- **Delegated outright:** G0-18 and G0-19. Product/engineering may decide within the approved 1.0 scope and must log the decision.
- **Architecture can start after Group A without waiting for:** G0-09, G0-10, G0-12, G0-14, G0-15, G0-16 and G0-17. These can remain pending while foundation work proceeds.
- **Architecture must not start while these remain open:** G0-01, G0-02, G0-03, G0-06, G0-08, G0-11 and G0-13. G0-04, G0-05 and G0-07 are part of the same architecture package and must be approved with it.

---

## 8. Objective Gate 0 acceptance criteria

Gate 0 is complete only when all of the following are evidenced. “Discussed,” “verbal agreement” or an expired deadline does not count.

### 8.1 Decision record

- [ ] All 19 decisions have a recorded disposition: approved, approved with conditions, delegated, or deferred with owner and date.
- [ ] Every Group A decision is approved or approved with a dated closure condition.
- [ ] No decision has a blank owner, date or rationale.
- [ ] The decision log uses the existing Doc 07 format.

### 8.2 Architecture evidence

- [ ] The 87-screen register is approved; 36 pilot and 64 cumulative 1.0 screens reconcile.
- [ ] The 48-screen alternative, if retained, has an approved cut list.
- [ ] The conceptual data model is approved, including lot/serial and stock-status dimensions.
- [ ] The approval model and no-self-approval default are approved.
- [ ] The offline authority matrix and conflict taxonomy are approved.
- [ ] The database spike is complete and ADR-004 is signed by NTAN.
- [ ] No product schema, migration or production database has been created.

### 8.3 Release and commercial evidence

- [ ] Design partners are named, with 3–5 committed and operational owners identified.
- [ ] Team, budget and release window are approved.
- [ ] Hosting region, DPDP posture and retention are approved.
- [ ] Pricing and pilot model are approved for pilot use.
- [ ] Success metrics and instrumentation ownership are approved.
- [ ] Brand tokens, vector assets and app-store ownership are approved or have a dated deferral.
- [ ] Mobile-only admin has an accepted usability test plan.

### 8.4 Governance evidence

- [ ] The change-control list for Docs 01–08 is approved.
- [ ] Docs 08, 09 and 10 are added to the README map only during the approved change pass.
- [ ] Gate 0 sign-off is signed by management, product, technical and commercial owners.
- [ ] Phase 1 authorization is explicit and limited to approved non-schema work until the database decision is effective.

### 8.5 Completion rule

Gate 0 closes when the decision record and architecture evidence are complete, and every release or commercial item has either approval or a dated deferral with no architecture dependency. A deferral without a date is an open blocker.

---

## 9. Decisions NTAN must answer first

### 9.1 Absolute first wave

1. **G0-01 — Database:** approve PostgreSQL for a spike, or select MongoDB or hybrid.
2. **G0-02 — Scope:** approve 87 total and 64 cumulative 1.0 screens, or approve a cut list.
3. **G0-08 — Offline authority:** confirm server-authoritative stock and offline queue-only.
4. **G0-11 — Team, budget and timeline:** confirm capacity for 22 weeks, or change scope/time.
5. **G0-13 — Hosting, compliance and retention:** approve India-first DPDP posture and seven-year default.

### 9.2 Same architecture package

- **G0-03 — Lot/serial:** model now, screens 1.1.
- **G0-04 — Purchase orders:** minimal `PO-01/02` in 1.0.
- **G0-05 — Customers:** minimal `CUS-01/02` in 1.0.
- **G0-06 — Stock status:** dimension now, quarantine UI 1.1.
- **G0-07 — Approvals:** single-step primitive now, full rules 1.1.

These five should be decided in the same meeting because they change the same conceptual data model and 1.0 scope boundary.

---

**End of Gate 0 management decision brief.**
