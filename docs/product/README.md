# NTAN Inventory — Phase 0 Product Package

**Status:** Phase 0 complete — awaiting NTAN management review and approval.
**Prepared:** 2026-10-22
**Product owner:** NTAN eCommerce Services LLP
**Working product name:** NTAN Inventory (subject to approval)
**Platforms:** Android and iOS (React Native + TypeScript). No web dashboard in this phase.
**Current phase:** Product discovery, competitive research, requirements, architecture direction. **No application code has been written.**

---

## 1. Purpose of this package

This package records the evidence, decisions and proposed direction for a commercial,
multi-tenant, multi-industry inventory management product. It is deliberately written for
long-term product ownership, not for a demonstration build.

It answers five questions:

1. Who is NTAN building for, and why will those customers switch?
2. What do competitors already do well, and where are the real gaps?
3. What belongs in the common inventory engine versus optional industry modules?
4. What must the mobile application contain, screen by screen?
5. What architecture, data model direction, and offline strategy can carry a commercial product?

---

## 2. Document map

| # | Document | Purpose |
|---|---|---|
| 00 | `README.md` | Index, evidence rules, decision status, glossary |
| 01 | `01-product-vision.md` | Mission, customers, personas, positioning, value proposition, success metrics |
| 02 | `02-competitor-research.md` | Competitor profiles, comparison matrix, pricing, complaints, market gaps, sources |
| 03 | `03-feature-blueprint.md` | Core engine vs modules, differentiators, priorities, dependencies, acceptance criteria |
| 04 | `04-mobile-blueprint.md` | Navigation, roles, complete screen catalogue, journeys, offline UX, accessibility |
| 05 | `05-technical-architecture.md` | Stack evaluation, mobile/backend architecture, MongoDB vs PostgreSQL, ledger, sync, security |
| 06 | `06-roadmap.md` | Phased delivery plan, release scope, exit criteria, go/no-go gates |
| 07 | `07-open-questions-risks.md` | Approval decisions, risks, assumptions, hardware dependencies, unknowns |

---

## 3. Evidence conventions

Every material claim in this package carries one of these labels:

| Label | Meaning |
|---|---|
| **[Verified]** | Observed directly on a vendor page, official documentation, app store listing, or NTAN's own website/CSS on the date shown. |
| **[Third-party]** | Reported by a credible comparison site, review platform, or industry article. Not confirmed by the vendor. |
| **[Assumption]** | A working belief needed to proceed. Must be validated with customers or NTAN. |
| **[Hypothesis]** | A proposed product idea or expected advantage. Not yet supported by market evidence. |
| **[Proposed]** | A design, architecture, or process recommendation awaiting approval. |
| **[Unverified]** | Information that could not be confirmed from a primary source. Do not treat as fact. |

**Verification date:** 2026-10-22 unless otherwise stated. Pricing and packaging change frequently;
re-verify before any external publication, sales collateral, or pricing decision.

**No claim of uniqueness** is made anywhere in this package. Phrases such as "differentiator"
mean "a capability we can compete on," not "no competitor offers this."

---

## 4. Locked vs open decisions

| Topic | Status | Note |
|---|---|---|
| Platforms: Android + iOS | **Locked** | Mobile-only; no web dashboard in Phase 0/1. |
| Mobile stack: React Native + TypeScript | **Locked** | Expo vs bare React Native remains an architecture recommendation in Doc 05. |
| Backend: Python + FastAPI | **Locked** | Modular monolith recommended for initial delivery. |
| Database: MongoDB vs PostgreSQL | **OPEN** | Full comparison in Doc 05. No database selected or implemented. |
| Product name | **OPEN** | "NTAN Inventory" is a working title. |
| Primary database hosting | **OPEN** | Depends on database decision and budget. |
| First target industries | **OPEN (recommended)** | Manufacturing, industrial automation, maintenance recommended as beachhead. |
| Pricing model | **OPEN** | Models and hypotheses in Docs 01 and 06. |
| Offline scope for v1 | **OPEN (recommended)** | Draft capture offline; server validation for stock commits. |
| Brand accent use in product UI | **OPEN** | Website yellow `#FBCC00` is verified; product usage is a proposed design choice. |

All open decisions are tracked in `07-open-questions-risks.md`.

---

## 5. Product in one paragraph

NTAN Inventory is a mobile-first inventory and operations platform for project- and
machine-intensive businesses. It turns a barcode or QR scan into a small set of permitted,
auditable actions; keeps stock accurate when connectivity is poor; and shows exactly what is
on hand, reserved, available, consumed and returned across warehouses, projects, machines and
work orders. The common engine is industry-agnostic. Manufacturing, industrial automation,
warehousing, maintenance and engineering behaviour is delivered through configurable
templates, custom fields and optional modules — not hardcoded industry forks.

---

## 6. Core vocabulary

| Term | Meaning in this product |
|---|---|
| **Tenant / Company** | A customer organisation. All business data is scoped to exactly one tenant. |
| **Item** | A stockable material, component, spare part, sub-assembly or finished good. Services are out of scope. |
| **Location** | A warehouse, zone, rack, shelf or bin. Locations form a tree. |
| **Stock movement** | An immutable record of a quantity change or transfer, with actor, time, reason and source document. |
| **Balance** | A derived quantity per item/location/lot/serial. Never edited directly. |
| **Reservation** | A hold on stock for a project, machine, work order or customer. Reduces available, not on-hand. |
| **Draft** | A locally stored, uncommitted operation. Has no authority over stock until accepted by the server. |
| **Pending** | A queued operation that has been submitted but not yet validated/applied. |
| **Conflict** | A server rejection or mismatch requiring a human decision. Never silently overwritten. |
| **Scan-to-Action** | The pattern where a scan immediately presents the permitted next actions for that item/context. |
| **Template** | A versioned bundle of item types, fields, locations, workflows and defaults for an industry. |

---

## 7. Phase boundary

**Included in Phase 0:** research, requirements, feature blueprint, mobile blueprint, architecture
direction, database comparison, roadmap, risks, open decisions.

**Explicitly excluded from Phase 0:** application code, project scaffolding, package installation,
database schemas, migrations, API implementation, Figma files, CI/CD, cloud provisioning.
