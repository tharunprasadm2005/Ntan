# 01 — NTAN Product Vision

**Document status:** Proposed for NTAN approval
**Date:** 2026-10-22
**Owner:** Product Strategy / NTAN
**Related:** `02-competitor-research.md`, `03-feature-blueprint.md`, `04-mobile-blueprint.md`

---

## 1. Executive summary

NTAN already sells automation, analytics, product data management and web services to businesses.
Those services teach the company how much operational value is trapped in spreadsheets, disconnected
catalogues, and stock records that nobody trusts. NTAN Inventory turns that service knowledge into
a product.

The product is **not** a general-purpose ERP and **not** a retail/ecommerce inventory clone. It is a
**mobile-first inventory and operations platform for project- and machine-intensive businesses**:
companies that consume materials against projects, production lines, machines, service jobs and
customer installations. These companies need to know not only *how much* they have, but *where it is,
what it is committed to, who touched it, and whether it can be used right now*.

The commercial ambition is to compete on **trust, speed and fit** — not on having the longest feature
list:

- **Trust:** accurate, append-only stock history; no silent overwrites; clear offline behaviour.
- **Speed:** scan-to-action workflows that remove navigation from the operator's day.
- **Fit:** configurable industry templates without forking the core product.

---

## 2. Company context (verified)

| Item | Finding | Label |
|---|---|---|
| Legal entity | NTAN eCommerce Services LLP | [Verified] ntan.in |
| Location | Mumbai, Maharashtra, India | [Verified] ntan.in |
| Contact | business@ntan.in · +91 9762729537 | [Verified] ntan.in |
| Core services | Web services, digital marketing, automation, business setup, tax & compliance, reseller programme | [Verified] ntan.in |
| Automation depth | 10+ years with Excel, VBA, MS Access, SQL and other tools | [Verified] ntan.in |
| Analytics depth | Reporting and data analytics services | [Verified] ntan.in |
| Commerce depth | 50+ store setups, 50+ catalogue maintenance engagements, product data management | [Verified] ntan.in |
| Social presence | facebook.com/ntanservices · linkedin.com/company/ntanservices | [Verified] ntan.in |

**Why this matters:** NTAN's credibility is in **process automation, data discipline and reporting**.
The inventory product should feel like the natural industrial expression of that competence, not a
side project from an unrelated vendor.

### 2.1 Verified brand foundation

Source: `https://www.ntan.in/` and `https://www.ntan.in/assets/css/style.css`, accessed 2026-10-22.

| Token | Value | Where it appears on the website | Status |
|---|---|---|---|
| Primary blue | `#2E5BBF` | Buttons, icons, active nav, accents | [Verified] company website |
| Navy | `#213767` | Footer background, section headings | [Verified] company website |
| Secondary navy | `#364F86` | Footer top band | [Verified] company website |
| Dark navy | `#1F3548` | Mobile navigation, FAQ headings | [Verified] company website |
| Deep blue | `#1C5C93` | Logo text/heading, hover states | [Verified] company website |
| Accent yellow | `#FBCC00` | Social icons, footer links, newsletter CTA | [Verified] company website |
| Light surface | `#F5F9FC` | Alternating section background | [Verified] company website |
| Link blue | `#428BCA` | Body links | [Verified] company website |
| Light blue hover | `#9ECCF4` | Link hover | [Verified] company website |
| Body text | `#444444` | Default body copy | [Verified] company website |
| Muted text | `#5C768D` | Secondary navigation/social icons | [Verified] company website |
| Heading font | Raleway (300–900) | All headings | [Verified] Google Fonts import |
| Body font | Open Sans (300–700) | Body and navigation | [Verified] Google Fonts import |
| Logo | `https://www.ntan.in/assets/img/logo.jpg` | Header, max-height 40px | [Verified] asset exists; **visual details unverified** |

**Unverified brand information**

- The logo is a JPEG. Its exact construction, embedded colours, clear-space rules and minimum size
  have **not** been verified. [Unverified]
- No public brand guideline, design tokens or typography scale was found. [Unverified]
- The product name, icon style, illustration style and dark-mode policy do not exist yet. [Open]
- `#FBCC00` is confirmed as a website accent, not as an approved product-UI alert colour. [Verified
  for website; proposed for app]

### 2.2 Proposed application design tokens (not company colours)

These are **proposed** mappings for the mobile design system. They use verified company colours where
possible and add functional colours that do not exist on the website.

| App token | Proposed value | Basis |
|---|---|---|
| `color.primary` | `#2E5BBF` | Verified company primary |
| `color.primaryPressed` | `#1C5C93` | Verified company deep blue |
| `color.navy` | `#213767` | Verified company navy |
| `color.surface` | `#F5F9FC` | Verified company light surface |
| `color.accent` | `#FBCC00` | Verified company accent; use sparingly |
| `color.text` | `#1F2933` | Proposed, darker than website `#444` for mobile contrast |
| `color.textMuted` | `#5C768D` | Verified muted tone |
| `color.success` | Proposed green | Not a company colour |
| `color.warning` | Proposed amber | Not a company colour; must be distinguishable from `#FBCC00` |
| `color.danger` | Proposed red | Not a company colour |
| Type scale | Raleway headings, Open Sans body | Verified fonts; sizes proposed |

**Rule:** no brand colour may be changed in the app without NTAN approval. Functional status colours
must not reuse the yellow accent in a way that makes alerts ambiguous.

---

## 3. Mission

> **Help industrial businesses trust their stock again — by making every movement fast to capture,
> easy to verify, and impossible to lose.**

"Trust" is the product's central promise. It is expressed through four guarantees:

1. **Every quantity has a history.** No balance changes without an attributable movement.
2. **Every scan leads somewhere useful.** Scanning never dead-ends in a lookup screen.
3. **Every offline action is visible.** Users know what is saved, pending, applied or rejected.
4. **Every company sees only its own data.** Isolation is architectural, not a UI filter.

---

## 4. Problems to solve

### 4.1 Operational problems

| Problem | Who feels it | Consequence |
|---|---|---|
| Stock records disagree with the physical shelf | Inventory manager, owner | Recounts, stockouts, emergency purchases |
| Materials are issued to "the project" without traceability | Project manager, finance | Cost leakage, disputes, inability to invoice accurately |
| Spare parts are invisible until a machine breaks | Maintenance technician, supervisor | Extended downtime, duplicate purchases |
| Receiving and issuing happen on paper or chat | Warehouse operator | Delays, transcription errors, no audit trail |
| Barcode scanners are expensive or tied to a desktop | Operator | Workarounds, skipped scans |
| The warehouse has poor connectivity | Operator, supervisor | Transactions are delayed or lost |
| Software is web-first and painful on a phone | Field and floor staff | Low adoption, shadow spreadsheets |
| Industry workflows are forced into generic fields | Operations lead | Customisation by spreadsheet, fragile processes |
| Reports arrive too late to act on | Owner, manager | Dead stock, expired lots, cash tied up |

### 4.2 Product problems in the current market

Based on `02-competitor-research.md`:

- **Web-first products treat mobile as a companion.** Zoho explicitly describes its mobile app as a
  supplement to the web application. [Verified, Google Play listing]
- **Mobile-first tools lack industrial depth.** Sortly and MaintainX are excellent at mobile capture,
  but Sortly is not a manufacturing/WMS engine and MaintainX treats parts as supporting CMMS data.
- **Project/machine allocation is ERP-grade complexity.** Odoo/ERPNext can model it, but the mobile
  experience and setup burden are heavy for an SMB.
- **Offline is claimed more often than it is explained.** Few vendors publish conflict-resolution
  behaviour or a visible sync model.
- **Component intelligence is fragmented.** MPN, datasheets, alternates and compatibility live across
  ERP, PLM, supplier portals and personal spreadsheets.
- **India-specific fit is thin.** GST-aware workflows, INR pricing, local support and affordable
  per-company plans are inconsistently served by Western-priced tools.

---

## 5. Target customers

### 5.1 Ideal Customer Profiles (ICPs)

| ICP | Profile | Why NTAN can win | Evidence / status |
|---|---|---|---|
| **ICP-A: Industrial automation & system integrators** | 20–250 staff; installs PLCs, panels, sensors, drives, controllers; materials consumed per customer project/site | Project allocation, technical specs, alternates, field-friendly mobile, project traceability | [Assumption] based on NTAN's automation background and segment needs |
| **ICP-B: Precision manufacturing & assembly** | 50–500 staff; raw material → WIP → finished goods; quality gates; line-side replenishment | Configurable stages, quality hold, kanban, BOM-lite, machine linkage | [Assumption] supported by Odoo/Katana/ERPNext positioning |
| **ICP-C: Maintenance & spare-parts operations** | 20–300 staff; machine uptime depends on critical spares; technicians consume parts on jobs | Spare-part intelligence, machine linkage, maintenance + inventory convergence | [Assumption] supported by MaintainX/Limble gap analysis |
| **ICP-D: Warehouses & distributors** | 20–300 staff; multi-location, receiving, put-away, picking, transfers, counts | Offline-first scanning, bin locations, cycle counts, audit | [Assumption] |
| **ICP-E: Engineering & assembly businesses** | 20–200 staff; engineer-to-order, project BOMs, customer-specific builds | Project material plans, reservations, returns, variance | [Assumption] |

### 5.2 Beachhead recommendation

Start with **ICP-A and ICP-B in the Mumbai–Thane–Pune industrial belt**, then expand to ICP-C.
Reasons:

- NTAN's existing automation/analytics credibility is strongest there.
- Project/machine allocation is a painful, poorly served workflow.
- These buyers value accuracy and traceability over consumer-style breadth.
- A dense geography enables hands-on onboarding, training and support — critical for first customers.

**Deliberately deprioritised at launch:** pure retail, ecommerce fulfilment, food & beverage
perishables, and large enterprise ERP replacement. These are crowded, regulated differently, or
require capabilities outside the initial engine.

### 5.3 Anti-ICP (for now)

- Single-user homeowners or hobby inventory.
- Businesses needing full accounting, payroll or POS in the same purchase.
- Enterprises requiring on-premise deployment, SSO/SAML, or formal SOC 2 before pilot.
- Operations with no smartphone/tablet access at the point of work.

---

## 6. Personas

| Persona | Primary goals | Frustrations | Mobile context | Success signal |
|---|---|---|---|---|
| **Owner / Managing Director** | Know stock value, project cost, shortages; stop leakage | Reports are late; numbers disagree; can't see project exposure | Between meetings, one hand | Trusts the dashboard without asking for a spreadsheet |
| **Inventory Manager** | Accurate stock, reorder points, counts, approvals | Recounts, duplicate entries, unclear ownership | Walks the floor, tablet/phone | Cycle counts close without reconciliation drama |
| **Warehouse Supervisor** | Throughput, accuracy, queue control | Bottlenecks at receiving, unclear priorities | Standing, moving, gloves | Receiving/issue queues clear predictably |
| **Warehouse Operator** | Receive/issue/transfer quickly with minimal typing | Bad labels, slow apps, connectivity drops, forced navigation | One hand, noisy, poor light | Completes a scan-to-issue in under 30 seconds |
| **Technician** | Find the right part, consume it against the right machine/job, return unused | Can't find parts; wrong part; no history | Under a machine, dirty hands | Fixes the machine without a stock hunt |
| **Project Manager** | Know reserved vs available vs consumed; avoid project overruns | Materials "disappear" into projects; no return discipline | Site visits, travel | Can explain project material variance |
| **Auditor / Finance** | Traceability, valuation, approvals, export | Missing audit trail; untraceable adjustments | Desk/tablet | Produces an audit pack without manual reconstruction |
| **Company Admin** | Users, roles, warehouses, settings, billing | Complex admin; permission mistakes | Phone/tablet | Onboards a user in under 2 minutes |
| **NTAN Support** | Diagnose tenant issues without seeing secrets | No visibility, ambiguous sync state | Desktop support console (internal, later) | Resolves a sync conflict with a clear audit trail |

**Design implication:** the same screen may serve very different roles. The app must be
**capability-driven**, not role-hardcoded. A supervisor and an operator may both scan the same item,
but see different permitted actions.

---

## 7. Market positioning

### 7.1 Positioning statement

> **For industrial businesses that consume materials against projects, machines and service jobs,
> NTAN Inventory is a mobile-first inventory and operations platform that makes every scan an
> auditable action and keeps stock accurate even offline. Unlike web-first ERP suites and
> consumer-grade asset trackers, it combines industrial traceability with a workflow simple enough
> for the shop floor.**

### 7.2 Competitive frame

| Alternative | What buyers use it for | Why they may switch |
|---|---|---|
| Spreadsheets + WhatsApp | Flexible, familiar, free | Errors, no audit, no real-time availability |
| Zoho Inventory | SMB/ecommerce stock | Mobile is secondary; project/machine depth |
| Odoo / ERPNext | Integrated ERP | Setup complexity, cost, mobile UX |
| Sortly | Simple asset/inventory tracking | Not industrial; no reservations/MRP/WMS depth |
| MaintainX / Limble | Maintenance and parts | Parts are supporting data, not a full inventory engine |
| Fishbowl / Cin7 | Distribution/QuickBooks/ecommerce | Mobile weakness, cost, ecommerce bias |
| Katana | Production-first manufacturing | Warehouse and maintenance depth |

### 7.3 Value proposition by buyer

| Buyer | Promise |
|---|---|
| Owner | "Know what you own, what is committed, and what is leaking — without waiting for month-end." |
| Inventory manager | "Stop recounting. Every movement is captured once and traceable." |
| Supervisor | "Clear queues, clear priorities, fewer workarounds." |
| Operator | "Scan, choose an action, done — even without signal." |
| Technician | "Find the right part and charge it to the right machine." |
| Project manager | "See reserved, available, consumed and returned by project." |
| Auditor | "A complete, append-only history you can export." |

---

## 8. Differentiation pillars

These are **areas to compete on**, not claims of exclusivity. Each is analysed in
`03-feature-blueprint.md`.

### D1. Scan-to-Action with offline execution
Scanning an item immediately presents the actions the user is permitted to take **in the current
context** — receive, issue, transfer, return, reserve, report damage, view history. The action is
captured offline as a draft and committed through a safe sync queue. Competitors scan; fewer combine
zero-navigation action discovery with a transparent offline model.

**Evidence:** Zoho/Odoo/Sortly/MaintainX all advertise barcode scanning. Offline is advertised by
Odoo, Sortly, MaintainX, Cleverence and Ventory. The combination and the explicit draft/commit
distinction are the proposed advantage. [Hypothesis]

### D2. Project / machine / work-order inventory ledger
A first-class allocation model: on-hand, reserved, available, consumed, returned and variance by
project, machine, production line or work order. ERPs can model this; SMB mobile tools generally do
not make it simple. [Hypothesis based on competitor gap analysis]

### D3. Industrial component intelligence
Manufacturer part number, technical specifications, datasheets, images, supplier data, compatible
alternatives and related machines/projects — available at the point of scan. PLM/ERP systems store
some of this; mobile-native access for technicians and storekeepers is underserved. [Hypothesis]

### D4. Configurable industry workflows
Industry templates configure item types, custom fields, locations, approval rules, document
numbering and optional stages. NTAN's five stages — Inbound Receiving, Line-Feed/Kanban, Quality Gate,
Stock Audit, Finished Goods — are available as composable stages, not mandatory gates. [Proposed]

### D5. Explainable inventory insight
Aging, dead stock, consumption trends, shortage risk and unusual movement detection, delivered with a
plain-language "why" for each recommendation. Rule-based and statistical first; AI only where it
improves a measurable decision. [Proposed]

### D6 (candidate). Maintenance + spare-parts convergence
Work orders consume parts; parts availability determines whether a job can start; returns go back to
stock. MaintainX/Limble are strong at maintenance but treat parts as supporting data; WMS tools ignore
maintenance. [Hypothesis]

**Selection rule:** a differentiator is only promoted to the roadmap if it has a named customer
problem, a measurable value hypothesis, and a feasible delivery path. Feature count is not a goal.

---

## 9. Product principles

1. **Accuracy before elegance.** A beautiful screen that produces a wrong balance is a failure.
2. **The scan is the shortcut.** If a workflow needs more than three taps after a successful scan,
   redesign it.
3. **Show state, always.** Draft, pending, synced, rejected, conflict — never ambiguous.
4. **Never silently overwrite.** Conflicts surface to a human with both versions.
5. **Core stays industry-agnostic.** Industry behaviour is configuration, not a fork.
6. **Mobile is the product, not a viewer.** Admin, reports and approvals must be genuinely usable on
   a phone or tablet.
7. **Design for the worst conditions.** Gloves, poor light, noise, one hand, no signal, damaged labels.
8. **Explain, don't impress.** Insights must show their reasoning; AI is not a marketing sticker.
9. **Least privilege by default.** Roles are capability bundles; sensitive actions need approval.
10. **Every action is attributable.** Actor, time, device, source document and reason are recorded.
11. **No fake data in production.** Demo/test data is isolated and labelled.
12. **Build for the next industry.** Avoid assumptions that only make sense for one vertical.

---

## 10. Non-goals (Phase 1–2)

- Full accounting, payroll, CRM or POS.
- A public customer portal or B2B showroom.
- A separate web administration dashboard.
- Autonomous purchasing or fully automated reordering without human approval.
- AI-generated inventory decisions without explainability.
- On-premise deployment, custom per-customer code forks.
- Marketplace/plugin ecosystem.
- Hardware manufacturing (scanners, printers, RFID).
- Social/chat features unrelated to operational collaboration.

These may become future opportunities, but they are explicitly out of the initial product.

---

## 11. Success metrics

### 11.1 Product health

| Metric | Target (first 6 months after launch) | Why |
|---|---|---|
| Scan-to-commit time (issue) | Median < 30 seconds | Core promise |
| Offline sync success rate | > 99.5% of queued operations applied without manual intervention | Trust |
| Conflict rate | < 1% of synced operations | Design quality |
| Stock accuracy (cycle count variance) | > 98% by line, > 95% by value | Operational value |
| Time to onboard a company | < 1 business day with template + import | Commercial velocity |
| Time to onboard a user | < 2 minutes | Adoption |
| Weekly active operators / licensed operators | > 70% | Real usage, not shelfware |
| Crash-free sessions | > 99.5% | Quality |
| p95 API latency (stock commit) | < 500 ms server-side | Responsiveness |
| Support tickets per 100 active users | < 5/month | Usability |

### 11.2 Commercial health

| Metric | Target (first 12 months) | Why |
|---|---|---|
| Design partners | 3–5 signed | Evidence and case studies |
| Paying companies | 10–20 | Early traction |
| Logo retention | > 90% annual | Fit |
| Net revenue retention | > 100% | Expansion via modules/users |
| Trial → paid conversion | > 25% | Onboarding quality |
| CAC payback | < 12 months | Sustainability |
| Gross margin | > 75% | SaaS viability |

These targets are **assumptions** to be recalibrated after design-partner validation.

---

## 12. Commercial model hypotheses

| Model | Structure | Pros | Cons | Status |
|---|---|---|---|---|
| **A. Company tiers** | ₹4,999 / ₹9,999 / ₹19,999 per month by users, locations, transactions | Predictable; easy to explain; fits SMB | Can penalise growth; module upsell needed | Recommended for validation |
| **B. Per user** | ₹499–₹999 per user/month | Aligns with usage; common in industrial SaaS | Operators may be numerous; discourages adoption | Alternative |
| **C. Base + modules** | Low base + Manufacturing / Maintenance / Insights add-ons | Good expansion; fit-based | Complexity in sales and billing | Recommended as later layer |
| **D. Implementation fee** | One-time onboarding/data migration/training | Funds service-heavy sales | Must be clearly scoped | Recommended |

**Hypotheses to test with design partners:** willingness to pay, sensitivity to per-user pricing,
value of offline, value of project allocation, appetite for annual prepay. Pricing is **not approved**
and must not be published.

---

## 13. Assumptions and validation plan

| ID | Assumption | Validation method | Owner |
|---|---|---|---|
| A-01 | Industrial SMBs will pay for mobile-first inventory even if they already use Excel/ERP | 15–20 discovery interviews; 3 paid pilots | Product |
| A-02 | Project/machine allocation is a top-3 pain for automation/manufacturing | Interviews + workflow shadowing | Product |
| A-03 | Offline capture is a buying criterion, not just a nice-to-have | Site visits in low-connectivity plants | Product |
| A-04 | Operators will use personal/shared phones if the app is fast and simple | Usability tests on the floor | Design |
| A-05 | Mobile-only administration is acceptable for SMB admins | Admin task tests on phone/tablet | Design |
| A-06 | NTAN can support customers in Hindi/Marathi/English without a large support team | Support pilot | Operations |
| A-07 | Per-company pricing fits better than per-user for Indian SMBs | Pricing interviews | Commercial |
| A-08 | A 3–5 design partner cohort is enough to stabilise the MVP | Pilot exit criteria | Product |

---

## 14. Vision statement (long-term)

> A business of any size should be able to point a phone at a part and immediately know what it is,
> where it is, what it is committed to, what it costs, and what to do next — with the same confidence
> whether the device is online or offline. NTAN Inventory aims to be the operational system of record
> for that moment.

The product earns that position through reliability, not breadth. Every release should make the
inventory record more trustworthy and the operator's next action more obvious.

---

## 15. Approval required

NTAN management is asked to confirm or amend:

1. The target customer priority (ICP-A/B first, ICP-C next).
2. The six differentiation pillars, especially the inclusion of maintenance convergence.
3. The non-goals, particularly the exclusion of a web dashboard and accounting/POS.
4. The success metrics and measurement approach.
5. That "NTAN Inventory" may be used as a working title only.
