# 07 — Open Questions, Risks and Decisions

**Document status:** Living document — requires NTAN decisions
**Date:** 2026-10-22
**Related:** all Phase 0 documents
**Rule:** no item marked **BLOCKING** may be assumed. Development must not start on the affected area
until it is recorded here.

---

## 1. Decision register

| ID | Decision | Options | Recommendation | Owner | Status | Blocks |
|---|---|---|---|---|---|---|
| D-01 | Primary database | A. PostgreSQL · B. MongoDB · C. Hybrid | **A** (PostgreSQL) for the inventory system of record; revisit for document workloads | NTAN management | **OPEN / BLOCKING** | Schema, migrations, core build |
| D-02 | Product name | NTAN Inventory · other | Use "NTAN Inventory" as working title only | NTAN | OPEN | Store listing, brand |
| D-03 | First target industries | Manufacturing · Automation · Maintenance · Warehousing · Engineering | Automation + manufacturing first, maintenance next | NTAN | RECOMMENDED | Templates, sales |
| D-04 | Mobile-only administration | Phone/tablet only · plan future web | Mobile-only for v1; review after 6 months | NTAN | RECOMMENDED | Admin scope |
| D-05 | Offline scope | Drafts only · selected commits · full offline | Drafts + server-validated commits; no direct stock authority offline | NTAN/engineering | RECOMMENDED | Sync design |
| D-06 | Pricing model | Company tiers · per user · base + modules | Tiers + modules; validate with pilots | NTAN commercial | OPEN | Billing, packaging |
| D-07 | Purchasing/PO in 1.0 | Yes · 1.1 | 1.1 unless a design partner blocks | NTAN/product | OPEN | MVP scope |
| D-08 | Lots/serials in 1.0 | Yes · 1.1 | 1.1 unless regulated customer requires | NTAN/product | OPEN | Schema, screens |
| D-09 | Negative stock default | Block · warn · allow | Block by default; configurable | NTAN/product | RECOMMENDED | Inventory rules |
| D-10 | Multi-currency at launch | Yes · later | Later; INR-first | NTAN | RECOMMENDED | Data model, reports |
| D-11 | Launch languages | English · +Hindi/Marathi | English first; Hindi/Marathi in 1.1 | NTAN | OPEN | Localisation |
| D-12 | Hosting region | India · other | India region for Indian customers | NTAN | OPEN | Infrastructure |
| D-13 | Compliance targets | DPDP · SOC 2 · ISO | DPDP readiness at launch; SOC 2 later if enterprise | NTAN/legal | OPEN | Security roadmap |
| D-14 | Support model/SLA | Business hours · 24/7 | Business hours + severity targets | NTAN ops | OPEN | Commercial terms |
| D-15 | App store ownership | NTAN · developer | NTAN owns accounts | NTAN | RECOMMENDED | Release |
| D-16 | Payment provider | Razorpay · Stripe · manual | Razorpay for India; manual invoicing for pilots | NTAN finance | OPEN | Billing |
| D-17 | Data retention | 7 years · configurable | 7 years default for stock/audit; configurable | NTAN/legal | OPEN | Storage, exports |
| D-18 | Device baseline | Android 10+/iOS 15+ | Validate against design-partner devices | NTAN/engineering | OPEN | Testing |
| D-19 | External scanner support | Launch · later | Later; camera first | NTAN | RECOMMENDED | Hardware |
| D-20 | Future web dashboard | Never · later | Defer; revisit only with evidence | NTAN | OPEN | Roadmap |
| D-21 | Manufacturing depth | Light BOM · full MRP | Light BOM/work orders; no full MRP early | NTAN/product | RECOMMENDED | Module scope |
| D-22 | Machines in MVP | Yes · 1.2 | 1.2; projects in MVP | NTAN/product | OPEN | MVP scope |
| D-23 | Design partners | 3–5 named companies | Recruit from NTAN network | NTAN commercial | **OPEN / BLOCKING for pilot** | Validation |
| D-24 | Team and budget | Internal · outsourced · mixed | Confirm capacity before schedule | NTAN | **OPEN / BLOCKING** | Timeline |
| D-25 | Success metrics | As proposed · revised | Approve targets in Doc 01 | NTAN | OPEN | Reporting |

---

## 2. Business questions requiring NTAN answers

### 2.1 Market and customers

1. Which 3–5 companies will be design partners, and who is the operational owner at each?
2. Which industries are we contractually or reputationally able to sell into first?
3. Do target customers have an existing ERP/accounting system that must be integrated? Which?
4. How do target customers buy software today (owner decision, IT, consultant, reseller)?
5. What is the acceptable price range, and who signs?
6. Are customers willing to pay for onboarding/data migration/training?
7. Is there demand for a reseller/white-label model through NTAN's existing programme?
8. What languages do floor operators actually use?
9. Do customers use shared devices or personal phones? What is the device policy?
10. What connectivity reality should we design for (dead zones, Wi-Fi only, mobile data cost)?

### 2.2 Operations and compliance

11. Do customers require GST-specific documents or e-invoicing at launch?
12. Do they need Tally/Zoho Books export or direct integration?
13. Are lots/serials/expiry legally required in the first segments?
14. Are there calibration, safety, or regulatory record requirements?
15. What audit retention is expected by customers/auditors?
16. Is customer data required to remain in India?
17. What is NTAN's data-processing/consent position under DPDP?
18. What support hours and response times can NTAN commit to?
19. Who owns customer data, and what is the exit/export process?
20. What is the policy for custom fields that contain personal data?

### 2.3 Commercial

21. Is the first release sold as a subscription, a paid pilot, or a services engagement?
22. Is there an implementation fee? What scope?
23. What is the trial length and conversion path?
24. What are the refund/cancellation terms?
25. What SLAs and credits will be offered (if any)?
26. Who provides first-line support: NTAN, a partner, or the product team?
27. What is the marketing claim policy (no unverified competitor claims)?
28. What is the brand approval process for app store assets?

---

## 3. Technical risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | Database choice creates rework or integrity issues | Medium | High | Decide at Gate 1; domain-first design; scenario tests | Engineering/NTAN |
| R-02 | Offline conflict handling loses or double-applies stock | Medium | Critical | Outbox + idempotency + append-only ledger; conflict queue; chaos tests | Engineering |
| R-03 | Concurrent reservations oversell stock | Medium | High | Atomic guarded updates; SERIALIZABLE where needed; concurrency tests | Backend |
| R-04 | Cross-tenant data leak | Low | Critical | RLS/tenant enforcement, IDOR tests, security review, pen test | Engineering |
| R-05 | Mobile-only admin is too painful | Medium | High | Usability tests; tablet layouts; focused flows; revisit web later | Design |
| R-06 | Scanner fails on damaged/low-light labels | Medium | High | VisionCamera/ML Kit, torch, manual entry, commercial SDK fallback | Mobile |
| R-07 | Low-end Android performance | Medium | Medium | Device matrix, virtualization, bundle discipline, performance budgets | Mobile |
| R-08 | Expo/native module incompatibility | Medium | Medium | Spike early; dev builds; eject path | Mobile |
| R-09 | Sync engine complexity delays MVP | High | High | Limit MVP offline to drafts; phase conflict UX; dedicated tests | Engineering |
| R-10 | Custom fields/templates destabilise core | Medium | Medium | Generic model, validation, versioned templates, migration tests | Backend |
| R-11 | Reporting slows transactions | Medium | Medium | Read replicas/materialised views; async exports | Backend |
| R-12 | File storage abuse/cost | Low | Medium | Limits, compression, signed URLs, lifecycle policies | Backend |
| R-13 | Push notification reliability | Medium | Low | In-app inbox as source of truth; retries | Mobile |
| R-14 | App store rejection/privacy manifest issues | Low | Medium | Early submission, privacy review, account ownership | Product |
| R-15 | Security incident (token theft, device loss) | Medium | High | Encryption, short sessions, remote revoke, MFA, monitoring | Security |
| R-16 | Backup/restore untested | Medium | Critical | Quarterly restore drills, PITR, documented RTO | DevOps |
| R-17 | Vendor lock-in (push, storage, DB) | Medium | Medium | Abstraction layers; export paths; standard protocols | Architecture |
| R-18 | Import corrupts data | Medium | High | Preview, validation, dry run, rollback batch, audit | Backend |
| R-19 | Notification/alert fatigue | Medium | Medium | Preferences, digests, severity, quiet hours | Product |
| R-20 | Scope creep from design partners | High | High | Written MVP boundary; change control; roadmap log | Product |
| R-21 | Key-person dependency | Medium | High | Documentation, pairing, ADRs, code review | NTAN |
| R-22 | Underestimated support load | Medium | Medium | Runbooks, in-app help, staffing plan, ticket metrics | Ops |
| R-23 | Time zone/date/UOM errors | Medium | Medium | Explicit units, UTC storage, property tests | Engineering |
| R-24 | Cost overrun from cloud/scanning SDK | Low | Medium | Budget alerts, usage caps, open-source first | NTAN |

---

## 4. Hardware and environment dependencies

| Dependency | Why it matters | Decision needed | Fallback |
|---|---|---|---|
| Android devices (low/mid range) | Primary operator device | Which models/OS versions? | Manual entry, lighter UI |
| iPhones/iPads | Supervisors/owners | Which minimum models? | Web-free mobile only |
| Camera quality | Scanning reliability | Test matrix | Torch, manual entry, external scanner |
| Bluetooth scanners | Industrial customers may demand | Support at launch? | Keyboard-wedge later |
| Label printers | Barcode/QR labels | Which models/sizes? | PDF/PNG share; external print app |
| Wi-Fi/connectivity | Offline design | Site survey with pilots | Drafts + sync |
| Charging/shift use | Battery and UX | Shift length? | Power-saving scanner mode |
| Device management (MDM) | Enterprise customers | Required? | App-level policies |
| Server region | Latency/residency | India? | Multi-region later |
| Payment gateway | Billing | Razorpay/Stripe? | Manual invoices |

---

## 5. Unknown customer requirements to validate

These are **not** committed features. They must be validated before inclusion.

| Area | Unknown | Validation |
|---|---|---|
| Traceability | Lot/serial/expiry rules by industry | Design-partner interviews + sample documents |
| Quality | Inspection criteria, sampling plans, regulatory records | Quality manager interviews |
| Maintenance | Job workflows, meter readings, calibration, downtime | Technician shadowing |
| Manufacturing | BOM depth, subcontracting, WIP, by-products, rework | Production manager interviews |
| Projects | Budgeting, billing, change orders, customer acceptance | Project manager interviews |
| Purchasing | Approval chains, RFQ, vendor portals, landed cost | Procurement interviews |
| Warehousing | Put-away strategies, picking waves, packing, dispatch | Warehouse observation |
| Returns | RMA, repair, refurbishment, scrap, warranty | Service manager interviews |
| Consignment | Customer-owned/consignment stock | Contract review |
| Kitting | Bundles/kits and disassembly | Sales/operations interviews |
| Multi-currency | Imported components, foreign suppliers | Finance interviews |
| Compliance | GST/e-invoice, customs, safety, environment | Legal/CA review |
| Device policy | Shared devices, shift handover, biometrics | Site IT interviews |
| Language | Operator literacy and language | Site observation |

---

## 6. Assumptions to validate

| ID | Assumption | Confidence | Validation | Impact if false |
|---|---|---|---|---|
| A-01 | Industrial SMBs will pay for mobile-first inventory | Medium | 15–20 interviews + paid pilots | No market |
| A-02 | Project/machine allocation is top-3 pain | Medium | Interviews + shadowing | Weaker differentiation |
| A-03 | Offline capture is a buying criterion | Medium | Site visits | Less urgency |
| A-04 | Operators will adopt phones if fast | Medium | Usability tests | Low adoption |
| A-05 | Mobile-only admin is acceptable | Medium | Admin task tests | Need web console |
| A-06 | 3–5 design partners are enough to stabilise MVP | Medium | Pilot exit criteria | Longer beta |
| A-07 | Company-tier pricing fits better than per-user | Low | Pricing interviews | Repackage |
| A-08 | INR-first is sufficient at launch | High | Customer interviews | Multi-currency earlier |
| A-09 | English is acceptable for admins at launch | Medium | Interviews | Localise earlier |
| A-10 | Customers will clean/import their own data with guidance | Medium | Pilot imports | More services |
| A-11 | Camera scanning is sufficient without hardware | Medium | Device tests | External scanner support |
| A-12 | 98% line accuracy is achievable in pilot | Medium | Pilot measurement | Redesign counts/training |
| A-13 | A modular monolith is sufficient for 2 years | High | Load tests | Extract services |
| A-14 | PostgreSQL/MongoDB choice can be made by Gate 1 | High | NTAN decision | Schedule slip |
| A-15 | NTAN can support customers in local languages | Medium | Hiring plan | Partner support |
| A-16 | Customers accept cloud-only | High | Interviews | On-prem demand |
| A-17 | App store distribution is acceptable | High | Pilot | Enterprise distribution |
| A-18 | Customers will pay for implementation | Medium | Pilot contracts | Absorb cost |
| A-19 | Scan-to-action improves speed vs forms | Medium | A/B usability test | Simplify differently |
| A-20 | Maintenance + inventory convergence is valued | Low | Maintenance pilot | Deprioritise module |

---

## 7. Risk register summary (top 10)

| Rank | Risk | Why it matters | Immediate action |
|---|---|---|---|
| 1 | Offline stock integrity (R-02) | Destroys trust and money | Design outbox/conflict tests in Phase 1 |
| 2 | Cross-tenant leak (R-04) | Existential security failure | Tenancy model + automated tests |
| 3 | Database decision delay (R-01) | Blocks build | NTAN decision at Gate 1 |
| 4 | Mobile-only admin (R-05) | Adoption risk | Usability tests with admins |
| 5 | Scope creep (R-20) | Delays release | Written MVP boundary |
| 6 | Concurrent oversell (R-03) | Inventory accuracy | Atomic design + concurrency tests |
| 7 | Scanning reliability (R-06) | Core UX | Device spike |
| 8 | Support capacity (R-22) | Churn | Staffing/training plan |
| 9 | Backup/restore (R-16) | Data loss | Restore drills |
| 10 | Pricing (D-06) | Revenue | Pilot validation |

---

## 8. Decision log template

Use this format for every approved decision. Append-only.

```
### DEC-YYYYMMDD-NN — <short title>
- Date:
- Decision:
- Context:
- Options considered:
- Chosen option:
- Rationale:
- Consequences:
- Approved by:
- Review date:
- Related docs:
```

**Recorded decisions:**

| ID | Date | Decision | Approved by |
|---|---|---|---|
| DEC-20261022-01 | 2026-10-22 | Proceed with Phase 0 documentation only; no application code | NTAN |
| DEC-20261022-02 | 2026-10-22 | Mobile-only Android/iOS; no web dashboard for now | NTAN |
| DEC-20261022-03 | 2026-10-22 | Retain React Native + TypeScript and Python + FastAPI | NTAN |
| DEC-20261022-04 | 2026-10-22 | Database decision remains open; document both options | NTAN |
| DEC-20261022-05 | 2026-10-22 | NTAN website branding is the visual foundation | NTAN |

---

## 9. Approval checklist for NTAN

### Phase 0 acceptance

- [ ] Product vision and target customers approved (Doc 01)
- [ ] Competitor research accepted as evidence-based; no unverified uniqueness claims (Doc 02)
- [ ] Feature scope, core vs modules, and priorities approved (Doc 03)
- [ ] Mobile navigation and screen catalogue approved (Doc 04)
- [ ] Architecture direction approved; database decision recorded (Doc 05, D-01)
- [ ] Roadmap, team and budget assumptions approved (Doc 06, D-24)
- [ ] Risks and assumptions acknowledged (Doc 07)
- [ ] Brand usage approved, including proposed app tokens and logo usage (Doc 01)
- [ ] Design partners identified (D-23)
- [ ] Permission to begin Phase 1 granted

### Before Phase 1 starts

- [ ] Database decision: PostgreSQL / MongoDB / Hybrid
- [ ] Target industries and pilot customers confirmed
- [ ] Offline scope confirmed (drafts vs commits)
- [ ] Hosting region and budget confirmed
- [ ] Security/legal review scheduled
- [ ] Device baseline confirmed
- [ ] Product name and app store plan confirmed
- [ ] Support model and SLAs confirmed
- [ ] Success metrics approved

### Before commercial release

- [ ] Pilot exit criteria met
- [ ] Penetration test complete; no open P0/P1
- [ ] Restore drill complete
- [ ] Privacy policy, terms, DPDP notices approved
- [ ] Pricing and packaging approved
- [ ] Support runbook and training complete
- [ ] App store listings approved
- [ ] Incident response plan approved

---

## 10. What NTAN must decide now

To move to Phase 1, NTAN needs to answer at minimum:

1. **Database:** PostgreSQL, MongoDB, or hybrid? (D-01)
2. **Pilot customers:** which 3–5 companies? (D-23)
3. **Team/budget:** who builds it, and for how long? (D-24)
4. **MVP boundary:** are projects in, and are purchasing/lots out? (D-07, D-08, D-22)
5. **Offline policy:** drafts only, or selected commits offline? (D-05)
6. **Hosting/compliance:** India region, DPDP, retention? (D-12, D-13, D-17)
7. **Commercial model:** paid pilot vs subscription, and price range? (D-06)

Without these, Phase 1 can only proceed on design-system and non-database foundation work.
