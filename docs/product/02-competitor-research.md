# 02 — Competitor Research

**Document status:** Research complete; conclusions proposed
**Research window:** 2026-10-22 (vendor pages accessed on this date unless stated)
**Related:** `01-product-vision.md`, `03-feature-blueprint.md`, `07-open-questions-risks.md`

---

## 1. Method and limitations

### 1.1 What was reviewed

- Vendor product pages, feature pages, pricing pages and documentation.
- App store / Google Play listings where available.
- Credible third-party comparisons and review platforms (Software Advice, Capterra, industry blogs).
- Vendor-published comparisons (treated as marketing claims, not neutral evidence).

### 1.2 Limitations

- Pricing changes frequently and varies by region, currency, contract length and promotions.
  All prices below are **indicative snapshots**, not quotations.
- Vendor feature pages describe capabilities, not usability. A feature can exist and still be
  unusable on a phone.
- Review-platform samples are self-selected and may not represent the customer base.
- Mobile app quality was assessed from listings, documentation and third-party comparisons; the
  apps were **not** installed and benchmarked in this phase.
- Offline behaviour is often described at marketing level. Where conflict handling is not documented,
  it is marked **unverified**, not assumed.
- No competitor was tested with NTAN's target workflows. Claims about "better" are hypotheses.

**Evidence labels:** [Verified] = vendor/app-store primary source; [Third-party] = comparison/review
site; [Unverified] = not confirmed; [Hypothesis] = proposed interpretation.

---

## 2. Market map

The market is not one category. It is four overlapping categories:

| Category | Representative products | Buyer expectation |
|---|---|---|
| **Integrated ERP / suite** | Odoo, ERPNext | One system for inventory, manufacturing, accounting, projects |
| **SMB inventory / multichannel** | Zoho Inventory, inFlow, Cin7, Fishbowl | Stock + purchasing + sales/fulfilment |
| **Mobile-first tracking / assets** | Sortly, Mobile Inventory, Inventory Scan | Fast capture, labels, photos, simple locations |
| **Maintenance / CMMS with parts** | MaintainX, Limble | Work orders, assets, spare parts, purchasing |

NTAN's proposed position sits between categories: **mobile-first operational inventory with
industrial allocation**, borrowing the usability of the mobile-first group and the depth of the ERP
group without the ERP's setup burden.

---

## 3. Comparison matrix

**Legend:** ● documented/strong · ◐ partial/limited · ○ not evident · ? unverified
Assessments are relative to each vendor's published positioning and sources in §9. They are not
hands-on benchmarks.

| Criterion | Odoo | Zoho Inv. | inFlow | Sortly | ERPNext | Fishbowl | Cin7 | Katana | MaintainX |
|---|---|---|---|---|---|---|---|---|---|
| Primary segment | SMB–mid ERP | SMB, ecommerce | SMB wholesale/light mfg | Small teams/assets | SMB–mid ERP | QuickBooks warehouses | Multichannel retail/distribution | Production-first SMB | Maintenance/CMMS |
| Native iOS/Android | ◐ | ● | ◐ | ● | ○ (mobile web) | ○/◐ | ◐ | ◐ | ● |
| Camera barcode/QR scan | ● | ● | ● | ● | ◐ | ◐ | ◐ | ◐ | ● |
| Offline mobile operations | ● (barcode app) | ? | ◐ | ● | ○ | ◐ | ○ | ○ | ● |
| Multi-warehouse | ● | ● | ● | ◐ | ● | ● | ● | ◐ | ◐ |
| Rack/shelf/bin locations | ● | ● | ● | ◐ | ● | ● | ● | ◐ | ◐ |
| Batch/lot/serial | ● | ● | ● | ◐ | ● | ● | ● | ● | ○ |
| Stock reservations | ● | ● | ◐ | ○ | ● | ● | ● | ● | ○ |
| Project allocation | ● (Project app) | ◐ | ◐ | ◐ (jobs) | ● (Projects) | ◐ | ◐ | ◐ | ◐ (work orders) |
| Machine/asset linkage | ● (Maintenance) | ○ | ○ | ◐ (assets) | ● (Asset/Maintenance) | ○ | ○ | ◐ (work centres) | ● |
| BOM / work orders | ● | ◐ | ◐ | ○ | ● | ● (Advanced) | ◐ | ● | ○ |
| Quality inspection | ● | ○ | ○ | ○ | ● | ◐ | ○ | ◐ | ◐ (checklists) |
| Purchase orders | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |
| Reporting/analytics | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |
| API/integrations | ● | ● | ● | ● | ● | ● | ● (700+) | ● | ● |
| Multi-company | ● (Custom) | ● | ◐ | ◐ | ● | ◐ | ● | ◐ | ● (Enterprise) |
| Mobile UX quality | ◐ | ◐ | ◐ | ● | ◐ | ○ | ◐ | ◐ | ● |
| INR pricing available | ● | ● | ○/? | ○/? | ● | ○/? | ○/? | ○/? | ○/? |

**Reading the matrix:** no single competitor is weak everywhere. NTAN cannot win by matching every
row. It must win on the intersection of **mobile execution + allocation + offline trust + industrial
fit**, while matching table stakes.

---

## 4. Pricing snapshot

Prices are per organisation unless noted. Annual billing unless stated. **Not quotations.**

| Product | Published / reported entry pricing | Source | Label |
|---|---|---|---|
| **Odoo** | One App Free ₹0 unlimited users; Standard from ₹580/user/month (yearly display; monthly higher); Custom from ₹1,080/user/month (yearly); Light User ₹195 | odoo.com/pricing (India), 2026-10-22 | [Verified] |
| **Zoho Inventory** | Free; Standard $29; Premium $79; Plus $129; Enterprise $249 per org/month billed annually. Add-ons: users $7.50, locations $10, advanced warehousing $124.17, advanced autoscans $8 | zoho.com/us/inventory/pricing, 2026-10-22 | [Verified] |
| **inFlow** | Reported ~$129/month annual entry; monthly higher. Vendor pricing page not retrievable during research (404) | Third-party comparison, 2026-08-24 | [Third-party, unverified] |
| **Sortly** | Free (100 entries); Advanced $49; Ultra $149; Premium $299; Enterprise quote. Promotional first-year discounts shown ($24/$74/$149) | sortly.com/pricing, 2026-10-22 | [Verified] |
| **ERPNext** | Open source, no per-user licence; Frappe Cloud hosting from $14/month | erpnext.com/homepage, 2026-10-22 | [Verified] |
| **Fishbowl** | Inventory from $229/month billed annually; Advanced from $595/month; implementation package | Third-party comparison, 2026-08-24 | [Third-party] |
| **Cin7** | Standard from $349/month; Pro from $599/month; 12-month contract reported | cin7.com; third-party comparison | [Verified vendor price; contract third-party] |
| **Katana** | Free up to 30 SKUs; Core from $299/month; Manufacturing add-on $199/month; unlimited users | Third-party comparison, 2026-08-24 | [Third-party] |
| **MaintainX** | Basic free; Essential $20/user/month annual ($25 monthly); Premium $65/user/month annual ($75 monthly); Enterprise custom | getmaintainx.com/pricing, 2026-10-22 | [Verified] |
| **Limble** | Premium+ reported ~$55–$69/user/month | Third-party comparison, 2026-10-09 | [Third-party] |

**Commercial observation:** per-user CMMS pricing (MaintainX/Limble) becomes expensive for large
operator teams, while per-order inventory pricing (Zoho) becomes expensive for high-volume
warehousing. NTAN has room to design **operator-friendly pricing** that does not discourage scanning
by every floor user. This is a hypothesis to validate.

---

## 5. Competitor profiles

### 5.1 Odoo Inventory (+ Manufacturing, Quality, Maintenance, Project)

**Snapshot:** Open-source suite with a commercial enterprise edition. Inventory is a full WMS/MRP
component of a much larger ERP.

**Target:** SMB to mid-market; companies willing to adopt multiple Odoo apps; partners implement.

**Verified capabilities:**
- Multi-warehouse, locations, routes, put-away/removal strategies, reservation methods.
- Barcode app: barcode, QR, GS1, EAN13/EAN14; receipts, pickings, adjustments; **works offline**.
- Lots/serials, packaging, cycle counting, KPIs, valuation (FIFO/AVCO/standard), landed costs.
- Manufacturing: BOMs, work orders, work centres, quality control points, maintenance, PLM, OEE.
- Project app for project-based operations.
- Multi-company available on the Custom plan.

**Mobile:** Odoo has mobile apps and a barcode scanner app. The shop-floor/barcode experience is
tablet/Android-oriented. The broader ERP admin experience is web-first. Mobile UX is functional, not
consumer-grade. [Verified product pages; UX assessment Hypothesis]

**Offline:** Odoo states its barcode scanner operations work offline ("Works offline: No WiFi coverage
issues!"). The exact conflict-resolution semantics are not documented on the public feature page.
[Verified claim; conflict handling Unverified]

**Pricing:** per user, per month; India page shows ₹580–₹1,080/user/month tiers; one app free;
implementation and custom development are extra.

**Strengths:** depth, integration, open source, offline barcode, manufacturing/quality/maintenance in
one suite, strong partner ecosystem.

**Limitations / complaints:** complexity, configuration and implementation cost; the mobile
experience is secondary to the web ERP; many capabilities require multiple apps and careful setup.
[Assumption supported by market positioning; specific complaint frequency not measured]

**NTAN opportunity:** deliver 80% of the operator-facing inventory workflow with a fraction of the
setup, on a phone, with project/machine allocation that is understandable without an ERP consultant.

---

### 5.2 Zoho Inventory

**Snapshot:** Cloud inventory for SMBs, tightly integrated with Zoho Books/CRM/Analytics and
ecommerce channels.

**Target:** SMBs, ecommerce sellers, wholesalers; businesses already in the Zoho ecosystem.

**Verified capabilities:**
- Item management, composite items, variants, UOM conversion, barcodes/RFID, batch/serial tracking.
- Multi-location, bins (500–5,000 depending on plan), transfers, stock counts, adjustments.
- Purchase orders, receiving, picklists, packing, shipping integrations.
- Approval workflows, audit trail, role-based permissions, warehouse-level permissions.
- Ecommerce integrations: Shopify, Amazon, eBay, Etsy; shipping carriers; Zoho Analytics on Enterprise.
- Mobile iOS/Android app with barcode scanning, stock lookup, adjustments, transfers, order management.

**Mobile:** 4.7★ and 250K+ downloads on the app listing. Critically, the Google Play listing states
the mobile app is a **supplement to the web-based Zoho Inventory application** after trial. [Verified]
This is the clearest evidence of the web-first gap NTAN can exploit.

**Offline:** Not prominently documented for stock operations. The mobile app supports offline order
tracking in some contexts, but full offline inventory execution is **not verified**. Treat as limited.

**Pricing:** Free to $249/org/month annual; order volume, users and locations drive tier; advanced
warehousing is a paid add-on. [Verified]

**Strengths:** price, ecosystem, breadth, ecommerce, polished enough for SMB, strong brand.

**Limitations / complaints:** mobile is secondary; advanced warehousing costs extra; pricing scales
with orders/users/locations; deep manufacturing and machine-level maintenance are limited; project
allocation is not a first-class mobile workflow. [Verified packaging; complaint themes Third-party]

**NTAN opportunity:** mobile-first execution, industrial allocation, offline trust, no order-volume
tax for warehouse work.

---

### 5.3 inFlow Inventory

**Snapshot:** SMB inventory and order management with wholesale/B2B and light manufacturing support;
Canadian vendor with a long history.

**Target:** Small wholesalers, distributors, retailers, light manufacturers, field service.

**Verified/reported capabilities:**
- Barcode scanning, pick/pack, purchase orders, sales orders, B2B showroom, customer-specific pricing.
- Lot tracking; manufacturing alongside sales/fulfilment; offline-capable desktop client.
- Mobile app exists but is generally regarded as secondary to desktop.

**Mobile:** Companion app; not positioned as the primary operating surface. [Assumption]

**Offline:** Desktop client can operate offline; mobile offline depth not verified.

**Pricing:** Vendor pricing page not retrievable during research (404). Third-party comparison reports
~$129/month annual entry. [Third-party, unverified]

**Strengths:** ease of use for SMB, wholesale/B2B features, lot tracking, established brand.

**Limitations / complaints:** dated UX relative to mobile-first tools; limited deep WMS/manufacturing;
mobile depth; pricing clarity. [Third-party/Assumption]

**NTAN opportunity:** modern mobile UX, industrial traceability, project/machine allocation.

---

### 5.4 Sortly

**Snapshot:** Mobile-first inventory and asset tracking with photos, QR/barcode labels, custom fields
and simple locations.

**Target:** Small businesses, teams tracking assets, tools, supplies, equipment; not a manufacturing
or WMS system.

**Verified capabilities:**
- iOS/Android apps; in-app barcode/QR scanning; third-party scanner support.
- QR/barcode label creation and printing (barcode labels on higher tiers).
- Custom fields, tags, photos, folders, multi-location, check-in/check-out.
- Stock counts, low-stock and date-based alerts, activity reports, CSV/PDF export.
- **Offline mobile access** and automatic sync.
- Jobs (limited active jobs by plan), purchase orders on higher tiers, API on Ultra+.
- Multi-account access; custom roles on higher tiers.

**Mobile:** Best-in-class simplicity among the reviewed tools. [Verified feature set; UX assessment
Hypothesis]

**Offline:** Explicitly offered on mobile with automatic sync. Conflict semantics are not publicly
detailed. [Verified feature; conflict handling Unverified]

**Pricing:** Free; Advanced $49; Ultra $149; Premium $299; Enterprise quote; first-year promotions
shown. Entry limits and user counts vary by tier. [Verified]

**Strengths:** fast adoption, excellent mobile capture, labels, simplicity, offline.

**Limitations / complaints:** not an industrial inventory engine; limited batch/serial depth, no MRP,
limited reservations, shallow cost/valuation, limited reporting; review sites list pricing and barcode
scanning as common concerns. [Third-party]

**NTAN opportunity:** match Sortly's simplicity while adding industrial-grade ledger, allocation,
lots/serials and reporting.

---

### 5.5 ERPNext

**Snapshot:** Open-source ERP on the Frappe framework, covering accounting, stock, manufacturing,
projects, CRM, HR, POS and more.

**Target:** Cost-sensitive SMBs and mid-market; organisations willing to self-host or use Frappe Cloud
and invest in implementation.

**Verified capabilities:**
- Item master, warehouses, serial/batch tracking, stock ledger, inventory reports.
- Multi-level BOM, production planning, work orders, job cards, subcontracting, quality checks.
- Projects with inventory tracking; asset management; approval workflows; granular roles.
- API-first; no-code/low-code customisation; mobile-friendly web across modules.
- No per-user licence; hosting from $14/month on Frappe Cloud.

**Mobile:** "100% mobile friendly" web, but no first-party native app with the polish of Sortly or
MaintainX was verified. [Verified web claim; native app Unverified]

**Offline:** No first-party offline mobile inventory execution was verified. [Unverified]

**Pricing:** open source; hosting + implementation. [Verified]

**Strengths:** depth, cost, customisability, manufacturing/projects, open source.

**Limitations / complaints:** implementation effort, UX, upgrade/customisation maintenance, mobile
experience. [Assumption/Third-party]

**NTAN opportunity:** productised, mobile-first experience with predictable onboarding; no bespoke
implementation project to get started.

---

### 5.6 Fishbowl Inventory

**Snapshot:** Inventory and warehouse management tightly integrated with QuickBooks; Advanced edition
adds manufacturing.

**Target:** SMB warehouses/distributors standardised on QuickBooks; light manufacturing via Advanced.

**Verified/reported capabilities:**
- Multi-location inventory, barcode/RFID, PO/receiving, order fulfilment, reorder management.
- BOMs and work orders on Fishbowl Advanced.
- On-premise or hosted deployment options.
- Deep QuickBooks integration.

**Mobile:** Mobile access is widely regarded as weak; one Software Advice comparison scored Mobile
Access 2.7/5. [Third-party]

**Offline:** On-premise deployment can provide local operation; mobile offline depth is limited.
[Assumption]

**Pricing:** $229/month annual; Advanced $595/month; implementation package. [Third-party]

**Strengths:** QuickBooks fit, warehouse depth, established install base.

**Limitations / complaints:** UI, report customisation, support, mobile, implementation overhead.
[Third-party review themes]

**NTAN opportunity:** modern mobile, no QuickBooks dependency, faster onboarding.

---

### 5.7 Cin7

**Snapshot:** Multichannel inventory and order management for retail, ecommerce and distribution,
with WMS and integrations.

**Target:** High-volume multichannel brands, retailers, distributors.

**Verified capabilities:**
- Real-time multichannel stock sync, 700+ integrations, warehouse management, shipping carriers.
- Demand forecasting, POS on higher tiers, multi-currency/VAT.
- Supplier management, purchasing, fulfilment.

**Mobile:** WMS/mobile app exists; the product is primarily a web platform. Mobile depth is secondary.
[Verified feature set; UX assessment Hypothesis]

**Offline:** Not a primary selling point; offline stock execution is **not verified**. Treat as
limited. [Unverified]

**Pricing:** Standard $349/month; Pro $599/month; 12-month contract reported. [Verified price;
contract Third-party]

**Strengths:** integrations, multichannel sync, retail/distribution breadth.

**Limitations / complaints:** cost, contract commitment, support, complexity for small industrial
teams, mobile. [Third-party/Assumption]

**NTAN opportunity:** avoid the ecommerce arms race; focus on industrial projects/machines and offline
floor execution at a lower total cost.

---

### 5.8 Katana

**Snapshot:** Production-first manufacturing inventory with visual scheduling and BOM-driven material
tracking.

**Target:** Small/mid manufacturers whose daily work revolves around production scheduling.

**Verified/reported capabilities:**
- Raw material to finished goods, BOMs, work orders, visual production scheduling.
- Inventory, purchasing, sales, shop-floor execution.
- Unlimited users on paid plans.
- Manufacturing add-on; warehouse management as paid add-on.

**Mobile:** Mobile app exists; production scheduling is primarily a desktop/web experience. [Assumption]

**Offline:** Not a primary claim; offline execution **not verified**.

**Pricing:** Free up to 30 SKUs; Core from $299/month; Manufacturing add-on $199/month. [Third-party]

**Strengths:** production clarity, visual scheduling, unlimited users, manufacturing focus.

**Limitations / complaints:** long ramp-up (competitor claim), weaker warehouse depth, no POS,
add-on pricing. [Third-party/vendor claim]

**NTAN opportunity:** warehouse + maintenance + project allocation around production, with a simpler
mobile operator experience.

---

### 5.9 MaintainX

**Snapshot:** Mobile-first CMMS / enterprise asset management with work orders, preventive
maintenance, checklists, parts inventory and purchasing. Acquired by Autodesk in 2026 (per vendor and
third-party reporting).

**Target:** Maintenance and facilities teams in manufacturing, facilities, hospitality, logistics,
energy, etc.

**Verified capabilities:**
- Work orders, preventive maintenance, checklists/inspections, asset hierarchies, downtime tracking.
- Parts inventory: parts tracking, statuses, availability, low-stock alerts, POs, approval workflows,
  cycle counting, multi-location parts, custom fields.
- Mobile-first iOS/Android with offline mode.
- QR/barcode generation for assets (Enterprise); scan-based asset lookup.
- Open REST API, integrations, SOC 2/ISO 27001/GDPR claims, SSO/MFA.
- AI: procedure generation, anomaly detection, smart time estimates (higher tiers).

**Mobile:** Excellent, near-identical to web per third-party comparison. [Third-party/Verified]

**Offline:** Explicitly supported. Conflict semantics not publicly detailed. [Verified feature]

**Pricing:** Free Basic; Essential $20/user/month annual; Premium $65/user/month annual; Enterprise
custom. Parts inventory and POs at Premium. [Verified]

**Strengths:** usability, mobile, maintenance workflow, asset linkage, parts purchasing, enterprise
trust signals.

**Limitations / complaints:** parts inventory is supporting data, not a full inventory/WMS engine;
less depth in batch/serial, valuation, project allocation, WMS put-away/picking; per-user pricing at
scale; AI features gated. [Third-party comparison; Assumption]

**NTAN opportunity:** combine maintenance-grade usability with a genuine inventory ledger, project
allocation, lots/serials and warehouse workflows — without per-seat pricing that penalises technicians.

---

### 5.10 Limble CMMS

**Snapshot:** Maintenance management with asset hierarchies, work orders, PMs, parts and purchasing.

**Target:** Maintenance teams; strong in regulated and multi-site operations.

**Verified/reported capabilities:** work orders, PMs, asset hierarchy, parts/POs, reporting, mobile
apps, offline mode on Premium+, API/MCP integrations, 21 CFR Part 11 support claims.

**Pricing:** reported ~$55–$69/user/month Premium+. [Third-party]

**Strengths:** asset depth, parts-to-asset linking, compliance, offline.

**Limitations:** maintenance-first; not a distribution/WMS engine; per-user cost. [Assumption]

**NTAN opportunity:** as with MaintainX — inventory depth plus maintenance context.

---

### 5.11 Secondary players worth monitoring

| Product | Relevance | Note |
|---|---|---|
| **Cleverence Inventory** | Offline-first Android barcode/RFID layer for ERPs | Local queue, embedded DB, conflict resolution, label printing; validates that offline warehousing is a real demand. [Verified vendor article] |
| **Ventory** | Offline field inventory | Merge-on-sync with timestamps and audit trail; strong offline positioning. [Verified vendor] |
| **Unleashed** | SMB inventory/manufacturing | Real-time perpetual inventory; weaker bin/forecasting depth per Cin7 comparison. [Third-party/vendor claim] |
| **MRPeasy** | SMB MRP | Strong manufacturing planning; narrower mobile/warehouse. [Third-party] |
| **Wasp** | Barcode asset/inventory | Hardware-adjacent; barcode depth. [Third-party] |
| **Mobile Inventory / Inventory Scan** | Mobile-first trackers | Low-cost, offline, label-centric; prove SMB willingness to use phones. [Verified app listings] |
| **SAP / Oracle / Microsoft Dynamics** | Enterprise | Out of initial segment; set the expectation bar for auditability. |

---

## 6. Complaint themes (cross-market)

These themes recur across review platforms and comparisons. They are directional, not statistically
weighted.

| Theme | What users say | Products most associated | Implication for NTAN |
|---|---|---|---|
| **Mobile is an afterthought** | "The app can't do what the web does" | Zoho, Fishbowl, Cin7, inFlow | Make mobile the complete operator surface |
| **Complex setup** | "Needed a consultant / months to configure" | Odoo, ERPNext, Fishbowl | Templates + guided onboarding + import |
| **Reports are rigid** | "Can't customise / export what I need" | Fishbowl, inFlow | Composable reports, CSV/PDF export, saved views |
| **Support quality** | "Slow / unhelpful support" | Fishbowl, Cin7 (review themes) | India-based, responsive, in-app help |
| **Pricing surprises** | "Add-ons, user fees, order limits" | Zoho, Cin7, MaintainX | Transparent tiers; operator-friendly pricing |
| **Scanning is unreliable** | "Doesn't read damaged/low-light labels" | Sortly and mobile apps (review theme) | Tune scanner, torch, manual entry, duplicate prevention |
| **Offline confusion** | "Did it save? Did it sync? Which record won?" | Many | Explicit draft/pending/applied/conflict states |
| **Data migration pain** | "Import failed / fields don't map" | Most | Guided CSV mapping, validation preview, rollback |
| **Weak project/machine traceability** | "Stock disappears into jobs" | SMB tools | First-class allocation ledger |
| **No industrial component context** | "We keep datasheets in another folder" | Most | MPN/spec/datasheet/alternates at scan |

**Caution:** complaint themes are not proof of product-wide failure. They identify where a better
experience can earn attention.

---

## 7. Feature classification

### 7.1 Standard market features (table stakes)

- Item master with SKU/barcode, categories, units of measure, images.
- Multiple warehouses and locations; rack/shelf/bin on mid/high tiers.
- Barcode/QR scanning via camera or external scanner.
- Purchase orders, goods receiving, stock issue, transfers, returns, adjustments.
- Stock counts / cycle counts.
- Low-stock alerts and reorder points.
- Role-based permissions, audit trail, CSV import/export.
- Basic reports: stock on hand, movement history, valuation, low stock.
- Mobile app with stock lookup and at least some transaction capture.
- API or integrations with accounting/ecommerce.

### 7.2 Advanced features already offered by competitors

- Batch/lot and serial tracking with expiry.
- Reservations and allocation.
- Multi-level BOM, work orders, MRP, capacity planning (Odoo, ERPNext, Katana, Fishbowl Advanced).
- Quality control points and inspections (Odoo, ERPNext).
- Bin-level put-away/picking strategies, wave/cluster/batch picking (Odoo, Cin7).
- Multi-company consolidation (Odoo Custom, ERPNext, Zoho orgs, MaintainX Enterprise).
- Offline mobile execution (Odoo barcode, Sortly, MaintainX, Cleverence, Ventory).
- Demand forecasting and analytics (Cin7, Odoo, MaintainX AI).
- Supplier performance, landed costs, multi-currency (Odoo, Cin7, Zoho).
- Approval workflows (Zoho, MaintainX, ERPNext).
- QR/barcode label generation and printing (Sortly, Zoho, MaintainX Enterprise).
- Asset hierarchies, preventive maintenance, downtime (MaintainX, Limble, Odoo Maintenance).
- Project modules with material tracking (Odoo, ERPNext).

**Conclusion:** almost every individual capability exists somewhere. Differentiation must come from
the **combination, the mobile execution quality, the setup model and the trust model** — not from
inventing an unheard-of feature.

### 7.3 Commonly requested improvements

- A mobile app that can actually run the operation, not just view it.
- Faster onboarding and data import.
- Custom fields without vendor services.
- Better reporting and export.
- Reliable offline with clear sync status.
- Label printing that works with common printers.
- Project/job costing and material traceability.
- Spare-parts visibility tied to assets.
- Transparent pricing without order-volume surprises.
- Responsive local support and training.

### 7.4 Potentially underserved workflows

| Workflow | Evidence of gap | Confidence |
|---|---|---|
| Project/machine allocation for SMBs, mobile-native | ERPs support it but are complex; SMB mobile tools are shallow | Medium |
| Industrial component intelligence at the point of scan | Split across ERP/PLM/supplier portals/spreadsheets | Medium |
| Maintenance + inventory convergence without per-seat CMMS pricing | MaintainX/Limble are maintenance-first; WMS ignore maintenance | Medium |
| Conflict-safe offline UX with visible state | Offline is claimed; conflict UX rarely documented | High |
| Explainable (non-AI-hype) inventory insight | Forecasting exists; "why" explanations are rare | Medium |
| India-first GST/local support at SMB price | Western tools localise partially; local tools are fragmented | Medium |
| Operator-friendly pricing that encourages scanning | Per-user CMMS and per-order inventory pricing create friction | Medium |

### 7.5 Proposed NTAN features (hypotheses)

1. **Scan-to-Action** with context-aware permitted actions and a one-tap commit.
2. **Allocation ledger** for project/machine/work order: on-hand, reserved, available, consumed,
   returned, variance.
3. **Component passport**: MPN, specs, datasheet, image, supplier, alternates, compatible machines.
4. **Industry template engine**: composable stages, fields, locations, approvals, numbering.
5. **Sync Trust Center**: per-operation status, conflict queue, device history, retry/cancel.
6. **Explainable insights**: aging, dead stock, shortage risk, anomaly with reasons and evidence.
7. **Maintenance-aware inventory**: job consumes parts; availability blocks/allows job; returns.
8. **Guided CSV import** with field mapping, validation preview and reversible batches.

Each is assessed for value, feasibility and priority in `03-feature-blueprint.md`.

---

## 8. Market gaps and opportunity

### 8.1 Where the market is strong

- Breadth of ERP functionality.
- Ecommerce/multichannel integrations.
- Mature purchasing and order management.
- Maintenance work-order workflows.
- Basic mobile barcode scanning.

### 8.2 Where the market is weak for NTAN's target

1. **The mobile operator experience is secondary** in the ERP/inventory suites.
2. **Allocation to projects/machines is either absent or consultant-heavy.**
3. **Offline is marketed without a transparent conflict model.**
4. **Component knowledge is disconnected from stock.**
5. **Maintenance and inventory are separate purchases.**
6. **Pricing structures penalise exactly the people who should scan most.**
7. **Onboarding assumes a web admin and a long implementation.**

### 8.3 Opportunity statement

> Win the **operator's phone** first. Make receiving, issuing, transferring, counting and allocating
> so fast and trustworthy that the inventory record becomes the path of least resistance. Then expand
> upward into project/machine intelligence and maintenance, where competitors are either complex or
> shallow.

### 8.4 What would falsify this opportunity

- Design partners say mobile capture is not a priority and existing ERP workflows are "good enough."
- Offline connectivity is not a real constraint in target factories.
- Project allocation is handled well enough by spreadsheets + existing ERP.
- Buyers refuse to pay separately for inventory vs their accounting/ERP suite.
- NTAN cannot support on-site onboarding at the required quality.

These are tracked in `07-open-questions-risks.md`.

---

## 9. Sources

All accessed 2026-10-22 unless a publication date is shown. Vendor pages are primary evidence for
their own claims; they are not independent verification.

| # | Source | Supports | Label |
|---|---|---|---|
| S1 | https://www.ntan.in/ | NTAN services, contact, positioning | [Verified] |
| S2 | https://www.ntan.in/assets/css/style.css | Brand colours, fonts | [Verified] |
| S3 | https://www.zoho.com/us/inventory/pricing/ | Zoho plans/prices/add-ons | [Verified] |
| S4 | https://www.zoho.com/us/inventory/mobile-apps/ | Zoho mobile capabilities | [Verified] |
| S5 | https://play.google.com/store/apps/details?id=com.zoho.inventory | Mobile app is a "supplement" to web; 4.7/250K+ | [Verified] |
| S6 | https://www.zoho.com/us/inventory/warehouse-inventory-management/ | Bins, counts, approvals, audit, picklists | [Verified] |
| S7 | https://www.odoo.com/app/inventory | Offline barcode, GS1/EAN, routes, valuation | [Verified] |
| S8 | https://www.odoo.com/app/inventory-features | Feature inventory | [Verified] |
| S9 | https://www.odoo.com/app/manufacturing | MRP, quality, maintenance, OEE | [Verified] |
| S10 | https://www.odoo.com/pricing | India pricing tiers (₹580/₹1,080) | [Verified] |
| S11 | https://erpnext.com/homepage | ERPNext modules, hosting from $14 | [Verified] |
| S12 | https://erpnext.com/pricing | Free/open-source, hosting model | [Verified] |
| S13 | https://www.sortly.com/pricing/ | Sortly plans, offline mobile, labels | [Verified] |
| S14 | https://help.sortly.com/sortly-pricing-plan-information | Plan structure, trial, discounts | [Verified] |
| S15 | https://www.inflowinventory.com/blog/top-10-inventory-software-compared/ | Fishbowl/Cin7/Katana/inFlow pricing and positioning (published 2026-08-24) | [Third-party] |
| S16 | https://www.cin7.com/cin7-competitors/ | Cin7 pricing/features, competitor claims | [Verified vendor; competitor claims are marketing] |
| S17 | https://www.cin7.com/features/inventory/inventory-management/ | Multichannel sync | [Verified] |
| S18 | https://www.getmaintainx.com/pricing | MaintainX plans, parts inventory, offline, security | [Verified] |
| S19 | https://www.maintainx.com/pricing | MaintainX pricing/feature framing | [Verified] |
| S20 | https://facilio.com/blog/maintainx-vs-limble | MaintainX vs Limble comparison (2026-10-09) | [Third-party] |
| S21 | https://www.softwareadvice.com/retail/cin7-profile/vs/fishbowl-inventory-manufacturing/ | Fishbowl mobile 2.7/5; feature ratings | [Third-party] |
| S22 | https://www.capterra.com/p/123794/Fishbowl/alternatives/ | Fishbowl review themes/alternatives (2026-10-19) | [Third-party] |
| S23 | https://www.hashmicro.com/ph/blog/zoho-inventory-review/ | Zoho review themes (2026-10-15) | [Third-party] |
| S24 | https://www.cleverence.com/articles/business-blogs/odoo-software-2026-4821 | Offline mobile warehousing patterns (2026-05-17) | [Third-party] |
| S25 | https://www.ventory.io/use-case/working-offline | Offline field inventory, merge-on-sync | [Verified vendor] |
| S26 | https://apps.apple.com/us/app/mobile-inventory-scan-track/id6479791814 | Mobile-first tracker feature expectations | [Verified] |
| S27 | https://www.softwaresuggest.com/sortly | Sortly feature/pricing cross-check (2026-10-21) | [Third-party] |
| S28 | https://www.softwareadvice.com/cmms/ezofficeinventory-profile/vs/sortly-pro/ | Sortly pros/cons (pricing, barcode) | [Third-party] |

---

## 10. Implications for NTAN

1. **Do not compete on feature count.** The matrix shows broad parity in table stakes. Compete on the
   operator experience and trust.
2. **Mobile completeness is the wedge.** "Web-first with an app" is the norm. A genuinely complete
   mobile operation is rare.
3. **Allocation is the industrial differentiator.** Project/machine/work-order visibility is valuable
   and poorly served at SMB price points.
4. **Offline must be explained, not just claimed.** Publish and design the sync/conflict model.
5. **Pricing is part of the product.** Avoid per-order and per-operator structures that punish usage.
6. **India-first execution is defensible.** Local support, INR, GST-aware flows and on-site
   onboarding can beat global tools in the beachhead.
7. **Stay honest in marketing.** No "unique" claims; use verifiable comparisons and customer evidence.

These implications feed `03-feature-blueprint.md` and `06-roadmap.md`.
