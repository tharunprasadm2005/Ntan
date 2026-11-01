# 06 — Product Roadmap

**Document status:** Proposed for NTAN approval
**Date:** 2026-10-22
**Basis:** Phase 0 research and blueprints
**Related:** `03-feature-blueprint.md`, `05-technical-architecture.md`, `07-open-questions-risks.md`

---

## 1. Roadmap principles

1. **Earn trust before adding breadth.** The first release must make stock, scanning and offline
   unquestionably reliable.
2. **Prove one wedge, then expand.** Industrial SMBs with projects/machines first; other industries via
   templates, not forks.
3. **Ship with design partners.** No release is "done" without use on a real floor with real stock.
4. **Keep the core generic.** Industry modules sit on the same ledger and transaction engine.
5. **No date promises without capacity.** Timelines below assume a specific team; they are planning
   estimates, not commitments.
6. **Every phase has an exit gate.** If the gate fails, fix before expanding scope.

---

## 2. Team assumption

| Role | Assumption |
|---|---|
| Product/design | 1 person (product + UX), supported by NTAN domain input |
| Mobile | 2 React Native engineers |
| Backend | 1–2 Python/FastAPI engineers |
| QA/automation | 0.5–1 engineer |
| DevOps/security | 0.5 engineer (shared) |
| Domain/validation | NTAN operations lead + 3–5 design partners |
| Project management | NTAN product owner |

**If the team is smaller, extend the timeline rather than reduce testing, offline correctness or
security.**

---

## 3. Phase overview

| Phase | Duration | Outcome | Gate |
|---|---|---|---|
| **0. Discovery** | Complete | Research, blueprint, architecture, roadmap | NTAN approval to build |
| **1. Foundation** | 6 weeks | Technical spine + design system + scan/offline spikes | Architecture and spike gate |
| **2. MVP build** | 10 weeks | End-to-end core inventory with scan, projects, offline | Internal demo + data-integrity gate |
| **3. Pilot & Release 1.0** | 6 weeks | 3–5 design partners live; commercial release | Pilot success + go-to-market gate |
| **4. Industrial specialisation** | 12 weeks | Machines, quality, kanban, light manufacturing, component passport | Module fit gate |
| **5. Intelligence & ecosystem** | Ongoing | Insights, integrations, scale, internationalisation | Revenue/retention gate |

**Estimated Release 1.0:** ~22 weeks after Phase 1 starts, assuming the team above. Treat as an
estimate until the database decision and pilot scope are fixed.

---

## 4. Phase 1 — Foundation (6 weeks)

### Objective
Build the technical and design spine so that core inventory can be delivered without rework.

### Scope

| Workstream | Deliverables |
|---|---|
| Architecture | Approved DB decision, tenancy model, module boundaries, ADRs, threat model |
| Mobile shell | App bootstrap, navigation, design tokens, primitives, auth flow, secure storage |
| Backend shell | FastAPI skeleton, config, health, error envelope, OpenAPI, CI, local dev |
| Identity | Sign-in/OTP, refresh, logout, workspace select, invite accept, RBAC skeleton |
| Tenancy | Company creation, isolation enforcement, cross-tenant tests |
| Core model | Item, location, warehouse, supplier, stock movement, balance (design + migrations if DB approved) |
| Scanning spike | Camera scan on low-end Android + iPhone, low light/damaged labels, duplicate suppression |
| Offline spike | SQLite cache, outbox, one end-to-end queued operation, conflict simulation |
| Quality | Test harness (unit, integration, E2E), lint/typecheck, crash reporting, staging |
| Design | Figma flows for MVP screens, usability test with 3 operators |

### Exit criteria (Gate 1)

- A user can sign in, create/select a company, and see a permission-filtered empty home.
- Cross-tenant access tests fail closed and are automated.
- Scanner decodes supported formats on target devices at acceptable speed; manual fallback works.
- An offline draft survives app kill/restart and syncs exactly once in the spike.
- Design system primitives are implemented and documented.
- The database decision is recorded; no core code depends on an undecided store.
- CI/CD builds Android and iOS artifacts and deploys the API to staging.

### Key risks

- Database decision delays schema work → mitigate with domain-first design.
- Expo/native scanning issues → mitigate with a spike and fallback to bare RN.
- Device performance on low-end Android → test early on real hardware.

---

## 5. Phase 2 — MVP build (10 weeks)

### Objective
Deliver a complete, usable core inventory loop for design partners.

### Scope (Release 0.9 / pilot)

| Area | Included |
|---|---|
| Inventory | Items, categories, custom fields, UOM, barcodes, images |
| Locations | Warehouses, location tree (rack/shelf/bin) |
| Parties | Suppliers; minimal customer/department references |
| Movements | Receive, put-away, issue, transfer, return, adjust, reserve |
| Ledger | Immutable movements, balances, available, audit |
| Scan | Scanner, manual entry, scan result action sheet, unknown-code handling |
| Counts | Cycle count session, entry, variance, approval |
| Projects | Project registry, reservation, issue, return, material summary |
| Reports | Stock on hand, movement history, low stock, project allocation |
| Admin | Company, users, roles, warehouses, locations, suppliers, template selection |
| Offline | Drafts, outbox, status, conflict queue (minimum viable) |
| Notifications | In-app inbox + push for approvals/low stock |
| Onboarding | Template selection, guided setup, CSV import (items/locations) |
| Ops | Basic queues: receiving, issue, approvals |

### Explicitly excluded from Phase 2
Purchasing/PO depth beyond receiving against an existing PO reference, lots/serials, valuation,
label printing, machines, maintenance, quality, BOM, advanced insights, integrations, billing
automation, multi-currency, web dashboard.

### Exit criteria (Gate 2)

- A design partner can receive, store, issue, transfer, return and count real stock for two weeks
  without spreadsheet reconciliation.
- AC-01..AC-20 in `03-feature-blueprint.md` pass (with agreed exceptions).
- Offline capture works in a real low-signal area; conflicts are visible and resolvable.
- Stock accuracy in pilot ≥ 98% by line.
- Scan-to-issue median < 30 seconds.
- No cross-tenant or privilege-escalation findings in security review.
- Crash-free sessions > 99%.
- Support runbook and onboarding checklist exist.

### Key risks

- Scope creep from design partners → protect the MVP boundary; log requests for later.
- Mobile-only admin proving painful → test with real admins; adjust layouts before launch.
- Offline conflict complexity → limit MVP offline operations to drafts, not direct commits.

---

## 6. Phase 3 — Pilot and Release 1.0 (6 weeks)

### Objective
Harden, instrument, support and commercially release to the first paying customers.

### Scope
- Pilot with 3–5 design partners across at least two segments.
- Performance tuning, accessibility audit, device matrix testing.
- Security review and penetration test (external if budget allows).
- Backup/restore drill; incident runbook.
- Subscription entitlement and billing integration (or manual invoicing for first customers).
- In-app help, FAQs, onboarding materials, training scripts.
- Analytics dashboards and error tracking.
- Pricing/packaging validation; trial flow.
- Data import hardening and rollback.
- Release 1.0 marketing assets (only with verified claims).

### Exit criteria (Gate 3 — commercial release)

- 3+ paying or committed pilot customers using the product weekly.
- Logo retention intent confirmed; at least 2 customers willing to be references.
- Stock accuracy and scan-time targets met for 4 consecutive weeks.
- Support ticket rate < 5 per 100 active users per month.
- No P0/P1 security issues open.
- Restore drill completed within RTO.
- Pricing, terms, privacy policy, and support SLAs approved.
- App store submissions approved (or ready).

### Key risks
- Pilot customers need a feature outside MVP → decide: workaround, paid custom (discouraged), or
  roadmap.
- App store review delays → submit early with a complete privacy manifest.
- Support load exceeds capacity → hire/train before launch, not after.

---

## 7. Phase 4 — Industrial specialisation (12 weeks)

### Objective
Deepen the wedge with the modules that make NTAN meaningfully different for industrial customers.

### Scope (Release 1.1–1.2)

| Module | Features |
|---|---|
| Traceability | Lots, serials, expiry, FEFO suggestions, recall query |
| Purchasing | Suppliers, POs, approvals, partial receipts, supplier-item data |
| Labels | Templates, barcode/QR generation, PDF/share, common sizes |
| Machines | Registry, critical spares, machine history, QR tags |
| Quality | Inspection templates, incoming/in-process checks, quarantine, disposition |
| Kanban | Min/max, two-bin, line-side replenishment, scan-to-replenish |
| Manufacturing (light) | Single-level BOM, work orders, component issue, finished goods, scrap |
| Maintenance | Jobs, required parts, availability, consumption, returns, history |
| Component passport | MPN, specs, datasheets, alternates, supplier cross-reference, machine/project usage |
| Insights | Aging, dead stock, shortage risk, consumption trends, explainable recommendations |
| Admin depth | Approval rules, saved views, audit exports, device management |

### Exit criteria (Gate 4)

- At least two industrial modules adopted by ≥ 50% of active customers.
- Module activation does not increase core stock error rate.
- Component passport used weekly by at least one pilot technician team.
- Maintenance + inventory flow validated with a real maintenance customer.
- Support can diagnose module issues with existing tooling.

### Key risks
- Module sprawl → enforce the "named problem + measurable value" rule.
- Manufacturing complexity pulls the product toward ERP → keep BOM/MRP deliberately light.
- Machine data quality → guided import and validation.

---

## 8. Phase 5 — Intelligence, ecosystem and scale (ongoing)

### Objective
Turn operational data into decisions and open the platform without compromising trust.

### Candidate scope
- Explainable anomaly detection and reorder optimisation.
- Project material forecasting.
- Scheduled reports and custom report builder.
- Public API, webhooks, accounting/GST integrations (Tally, Zoho Books).
- ERP connectors (Odoo/ERPNext) for customers who keep their ERP.
- Multi-currency, multi-language (Hindi/Marathi), international localisation.
- SSO/SAML, audit exports, enterprise tenancy options.
- External Bluetooth scanner and label printer support.
- Optional read-only web console **only if** customer evidence demands it (separate decision).
- SOC 2 / ISO 27001 readiness if enterprise sales require it.

### Exit criteria (annual)
- Net revenue retention > 100%.
- Expansion revenue from modules/usage.
- Churn below target.
- Differentiators cited in win/loss interviews.

---

## 9. Release scope summary

| Capability | 0.9 Pilot | 1.0 Commercial | 1.1 Ops depth | 1.2 Industrial | 2.0 Intelligence |
|---|---|---|---|---|---|
| Auth, tenancy, RBAC, audit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Items, custom fields, UOM | ✓ | ✓ | ✓ | ✓ | ✓ |
| Warehouses/locations/bins | ✓ | ✓ | ✓ | ✓ | ✓ |
| Receive/issue/transfer/return/adjust | ✓ | ✓ | ✓ | ✓ | ✓ |
| Immutable ledger | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scan-to-Action | ✓ | ✓ | ✓ | ✓ | ✓ |
| Offline drafts + sync | ✓ | ✓ | ✓ | ✓ | ✓ |
| Projects + reservations | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cycle counts | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mobile admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reports (stock/movement/low stock) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Lots/serials | — | — | ✓ | ✓ | ✓ |
| Purchasing/PO | ◐ | ◐ | ✓ | ✓ | ✓ |
| Labels/printing | — | — | ✓ | ✓ | ✓ |
| Valuation/aging | — | — | ✓ | ✓ | ✓ |
| Machines | — | — | — | ✓ | ✓ |
| Quality | — | — | — | ✓ | ✓ |
| Kanban | — | — | — | ✓ | ✓ |
| Manufacturing (light) | — | — | — | ✓ | ✓ |
| Maintenance | — | — | — | ✓ | ✓ |
| Component passport | — | — | — | ✓ | ✓ |
| Insights | — | — | ◐ | ✓ | ✓ |
| Integrations/API | — | — | — | ◐ | ✓ |
| Multi-currency/localisation | — | — | — | — | ✓ |

✓ = included · ◐ = limited · — = not included.

---

## 10. Commercial launch plan

### 10.1 First customers

1. Recruit 3–5 design partners from NTAN's existing industrial network (Mumbai–Thane–Pune).
2. Offer a paid pilot with a clear scope, success criteria and onboarding support.
3. Shadow operators for 2 days per site; fix friction before expanding.
4. Convert pilots to annual contracts with a case study and reference permission.
5. Expand through referrals within industrial clusters and NTAN's service customers.

### 10.2 Onboarding

- Guided template + CSV import + on-site/remote training.
- Data cleanup service (chargeable) for messy catalogues.
- 30-day success plan: first receipt, first issue, first count, first project allocation.
- Named support contact for the first 90 days.

### 10.3 Pricing (hypothesis, not approved)

| Tier | Indicative scope | Model |
|---|---|---|
| Starter | 1 warehouse, 5 users, core inventory | ₹4,999/month (hypothesis) |
| Growth | 3 warehouses, 15 users, projects, counts | ₹9,999/month |
| Industrial | Modules, 30 users, multi-site | ₹19,999/month + modules |
| Enterprise | Custom, SSO, dedicated tenancy | Quote |

Validate willingness to pay before publishing. Consider annual prepay discounts and an implementation
fee.

### 10.4 Support model

- In-app help + WhatsApp/phone during business hours (India).
- Severity definitions and response targets.
- Status page and incident communications.
- Quarterly business review for industrial customers.

---

## 11. Success metrics by phase

| Phase | Metric | Target |
|---|---|---|
| 1 | Foundation gate passed | 100% exit criteria |
| 2 | Pilot stock accuracy | ≥ 98% by line |
| 2 | Scan-to-issue median | < 30 s |
| 2 | Offline sync success | > 99% |
| 3 | Paying/committed pilots | ≥ 3 |
| 3 | Weekly active operators | ≥ 70% of licensed |
| 3 | Support tickets | < 5 per 100 users/month |
| 4 | Module adoption | ≥ 50% of customers use one module |
| 4 | Expansion revenue | ≥ 20% of new ARR from modules |
| 5 | Net revenue retention | > 100% |
| 5 | Logo retention | > 90% annual |

---

## 12. Dependencies

| Dependency | Needed by | Owner |
|---|---|---|
| Database decision | Phase 1 | NTAN management |
| Brand/logo approval | Phase 1 | NTAN |
| Design partner commitments | Phase 1 | NTAN commercial |
| Device fleet for testing | Phase 1 | NTAN/engineering |
| Hosting/region/budget | Phase 1 | NTAN |
| Security/legal review (privacy, DPDP) | Phase 2 | NTAN/legal |
| Pricing approval | Phase 3 | NTAN |
| Support staffing/training | Phase 3 | NTAN |
| App store accounts | Phase 3 | NTAN |
| Payment gateway | Phase 3 | NTAN |

---

## 13. Roadmap risks

| Risk | Impact | Mitigation |
|---|---|---|
| Database decision delayed | Schedule slip | Proceed with domain design; decide by Gate 1 |
| Offline complexity underestimated | Rework, data loss | Spike early; limit MVP offline scope; test conflicts |
| Mobile-only admin rejected | Adoption loss | Usability tests; tablet layouts; revisit web later |
| Scope creep from pilots | Delay | Written MVP boundary; change control |
| Scanning performance on low-end devices | Poor adoption | Device matrix; manual entry; commercial SDK fallback |
| Design partners unavailable | Weak validation | Recruit 5 to keep 3 |
| Support capacity | Churn | Hire/train before launch; in-app help |
| Security incident | Reputation | Threat model, pen test, least privilege, backups |
| Pricing too high/low | Revenue | Validate before publishing; pilot contracts |
| Key-person dependency | Delivery risk | Document decisions; pair on critical modules |

---

## 14. Go/no-go gates

| Gate | Question | If no |
|---|---|---|
| G0 (now) | Is the Phase 0 direction approved? | Revise docs; do not build |
| G1 | Is the technical spine proven (scan, offline, tenancy, DB)? | Extend foundation; do not build features |
| G2 | Can a real site run on the MVP for two weeks? | Fix; do not start commercial sales |
| G3 | Are pilots paying/renewing and supportable? | Harden; do not scale sales |
| G4 | Are industrial modules used and valued? | Prune; do not expand module count |
| G5 | Is retention/expansion healthy? | Fix product/support; do not enter new geographies |

**Stop rule:** do not trade correctness for schedule. A late reliable release is recoverable; a
trust-destroying stock error is not.
