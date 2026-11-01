# 04 — Mobile Application Blueprint

**Document status:** Proposed for NTAN approval
**Date:** 2026-10-22
**Scope:** Android and iOS only. No web dashboard. Administration is designed for phone and tablet.
**Related:** `03-feature-blueprint.md`, `05-technical-architecture.md`

---

## 1. Experience goals

| Goal | Design consequence |
|---|---|
| Operators complete common tasks in seconds | Scan-first entry, remembered context, one primary action per screen |
| The inventory record is trustworthy | Every stock operation shows Draft / Queued / Applied / Rejected / Conflict |
| The app works in poor conditions | Offline drafts, large touch targets, high contrast, torch, manual entry |
| Administrators can work on mobile | Compact tables, filters, bulk actions, guided forms, no desktop-only patterns |
| Industrial users are not treated as consumers | Dense but scannable data, units and precision, audit references, no gamification |
| New industries can be configured | Screens render from capabilities, templates and custom fields, not hardcoded verticals |

**Non-goal:** replicating a desktop ERP grid on a 6-inch screen. The mobile app should expose the
*decisions and actions* an operator or manager needs, not every column.

---

## 2. Navigation architecture

### 2.1 Root structure

```
App
├── Bootstrap (token, version, device, tenant)
├── Auth Stack (unauthenticated)
│   ├── Welcome
│   ├── Sign In
│   ├── Forgot / Reset
│   ├── MFA
│   ├── Accept Invite
│   └── Workspace Select
├── Onboarding Stack (new company, authenticated)
│   ├── Company Profile
│   ├── Industry Template
│   ├── Locations
│   ├── Invite Team (optional)
│   └── Ready
└── Main Tabs (authenticated)
    ├── Home
    ├── Inventory
    ├── Scan (center, modal entry)
    ├── Operations
    └── More
```

### 2.2 Tab rationale

| Proposed tab | Contains | Why |
|---|---|---|
| **Home** | Dashboard, alerts, approvals shortcut, sync status, search | Daily starting point; role-aware |
| **Inventory** | Items, stock, movements, receive/issue/transfer/return/adjust, counts | The core job |
| **Scan** | Camera scanner, manual code entry, scan result | The fastest path to any action; center placement |
| **Operations** | Queues (receiving, issue, transfer), approvals, projects, machines, jobs | Work-in-progress, not master data |
| **More** | Reports, admin, billing, help, settings, profile | Everything infrequent or administrative |

### 2.3 Evaluation of the original menu concept

| Original item | Recommendation | Reason |
|---|---|---|
| Home | **Keep** as tab | Clear |
| Service | **Rename to Operations** | "Service" is ambiguous for warehouses and manufacturers; Operations covers queues, projects, machines, jobs |
| Scanner | **Keep**, as center tab/modal | Core differentiator; must be one tap from anywhere |
| Reports | **Move under More**, plus Home shortcuts | Reports are periodic, not a primary daily tab; five tabs is the practical maximum |
| Help Desk | **Move under More** | Infrequent; keep contextual help in-screen |
| Subscriptions | **Move under More → Admin → Subscription** | Owner/admin task, not daily navigation |
| User Account | **Move under More → Profile** | Standard |
| Settings | **Move under More → Settings** | Standard |
| — | **Add Notifications** | Global inbox accessible from Home header |
| — | **Add Approvals** | Managers need a single queue |
| — | **Add Company Administration** | Mobile-only product requires full admin |
| — | **Add Projects / Machines** | Core differentiators for target industries |

**Decision:** five bottom tabs maximum. Anything that does not earn a tab lives in More or a
contextual action.

### 2.4 Tablet behaviour

- Bottom tabs become a left navigation rail on tablets ≥ 768 dp.
- Master-detail layouts for Inventory and Approvals.
- Forms use two columns where it improves scanning, never to cram more fields.
- Scanner uses a larger preview and a persistent action panel.
- No separate tablet app; one codebase, responsive layouts.

### 2.5 Deep links

Every operational object has a stable route: `/items/:id`, `/movements/:id`, `/projects/:id`,
`/approvals/:id`, `/counts/:id`, `/machines/:id`. Push notifications and shared links open the object,
subject to permissions.

---

## 3. Roles and capabilities

Roles are templates; permissions are atomic capabilities. A user may hold one role per company and
be scoped to specific locations.

| Capability | Owner | Admin | Inv. Mgr | Supervisor | Operator | Project Mgr | Technician | Purchasing | Auditor |
|---|---|---|---|---|---|---|---|---|---|
| View stock | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View cost/value | ✓ | ✓ | ✓ | ◐ | — | ◐ | — | ◐ | ✓ |
| Create/edit items | ✓ | ✓ | ✓ | ◐ | — | — | — | ◐ | — |
| Receive stock | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | — |
| Issue stock | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Transfer stock | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Return stock | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Adjust stock | ✓ | ✓ | ✓ | ◐ | — | — | — | — | — |
| Approve adjustment | ✓ | ✓ | ✓ | ◐ | — | — | — | — | — |
| Create count | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| Count entry | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Approve count | ✓ | ✓ | ✓ | ◐ | — | — | — | — | — |
| Reserve stock | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| Manage projects | ✓ | ✓ | ✓ | — | — | ✓ | — | — | — |
| Manage machines | ✓ | ✓ | ✓ | — | — | — | ◐ | — | — |
| Consume job parts | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | — |
| View reports | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ◐ | ✓ | ✓ |
| Export data | ✓ | ✓ | ✓ | ◐ | — | ◐ | — | ◐ | ✓ |
| Manage users/roles | ✓ | ✓ | — | — | — | — | — | — | — |
| Company settings | ✓ | ✓ | — | — | — | — | — | — | — |
| Billing | ✓ | ◐ | — | — | — | — | — | — | — |
| View audit log | ✓ | ✓ | ◐ | — | — | — | — | — | ✓ |

✓ = allowed by default · ◐ = configurable / restricted · — = not allowed.

**Rules:** approvals cannot be self-approved by default; cost visibility is separately gated; location
scoping is enforced server-side; every action is checked again by the API.

---

## 4. Screen specification template

Each screen in the catalogue is described with:

1. **Purpose** — the job it does.
2. **Roles** — who can see/use it.
3. **Key content** — data shown.
4. **Actions** — what can be done.
5. **Inputs & validations** — fields and rules.
6. **API & entities** — backend interactions and data.
7. **States** — loading, empty, error, offline.
8. **Navigation** — where it leads.

Detailed specs for the highest-risk screens follow the catalogue (§7).

**Global rules (apply to every screen):**

- Every list is virtualized, searchable and filterable.
- Every destructive action requires confirmation and a reason where the domain requires it.
- Every monetary/quantity display states its unit and precision.
- Every stock-affecting action displays the resulting on-hand/available state before commit.
- Every queued operation displays a sync badge.
- Every error message states what happened, what to do, and an error reference.
- Every screen has a designed empty state with a primary action.
- Pull-to-refresh never discards unsaved input.

---

## 5. Screen catalogue

### 5.1 Authentication and onboarding

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Bootstrap | Validate session, device, version, tenant | All | Logo, progress, version block | Retry, update, sign out | Min app version, token validity | `/auth/session`, `/app/config` · Session, Device | Offline: cached session if allowed; expired → Sign In |
| AUTH-02 | Welcome | Explain value and entry paths | Unauth | Value prop, sign-in, start trial, invite code | Sign in, trial, join | — | `/app/config` | Static; error → retry |
| AUTH-03 | Sign In | Authenticate | Unauth | Email/phone, password, OTP option, forgot link | Sign in, send OTP, switch workspace | Valid email/phone; password min 8; rate limit | `/auth/login`, `/auth/otp` · User, Session | Wrong credentials, locked, network |
| AUTH-04 | Workspace Select | Choose company membership | Multi-company users | Company list, role, last used | Continue | Must select one | `/me/memberships` · Membership, Company | Empty → create/join |
| AUTH-05 | Forgot / Reset | Recover access | Unauth | Email/phone, OTP, new password, confirm | Send code, reset | Code expiry; password policy | `/auth/reset` · User | Invalid code, expired, rate limit |
| AUTH-06 | MFA | Second factor | Admins, opted-in | 6-digit code, resend timer | Verify, use recovery code | 6 digits; 5 attempts | `/auth/mfa` · UserMfa | Expired, locked |
| AUTH-07 | Accept Invite | Join a company | Invited user | Company, inviter, role | Accept, decline | Token valid; email match | `/invites/accept` · Invite, Membership | Expired, already used |
| AUTH-08 | Onboarding Wizard | Create company | Owner | Name, industry, currency, timezone, locations | Next, skip optional, finish | Name required; currency immutable after stock? | `/companies` · Company, Warehouse | Draft preserved locally |
| AUTH-09 | Industry Template | Choose starting configuration | Owner/Admin | Template cards, included modules, preview | Select, customise later | One template | `/templates` · Template | Empty → blank template |
| AUTH-10 | Device Trust | Register device | All | Device name, OS, biometric option | Enable biometrics, continue | Biometric availability | `/devices` · Device | Unsupported biometrics fallback |

### 5.2 Home and search

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| HOME-01 | Dashboard | Role-aware daily overview | All | KPI cards, alerts, approvals, sync banner, quick actions | Drill down, quick receive/issue/scan | Date range for KPIs | `/dashboard` · StockBalance, Movement, Approval | Cached with timestamp; stale banner offline |
| HOME-02 | Notifications | Operational inbox | All | Grouped notifications, unread count, deep links | Mark read, filter, open | — | `/notifications` · Notification | Empty state; offline cached |
| HOME-03 | Global Search | Find anything permitted | All | Query, type filters, recent searches | Open result, scan instead | Min 2 chars; debounce; permission filter | `/search` · all | No results; offline limited to cache |

### 5.3 Scan

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| SCAN-01 | Scanner | Capture barcode/QR | All with scan cap | Camera preview, torch, scan frame, recent scans, manual entry | Torch, switch camera, continuous mode, manual | Camera permission; duplicate window 2 s; supported formats | Local ML Kit/AVFoundation; `/items/lookup` · Item, Barcode | Permission denied; camera busy; low light hint |
| SCAN-02 | Scan Result | Turn a scan into an action | All | Item summary, stock, location, project context, permitted actions | View stock, receive, issue, transfer, return, reserve, damage, history, create | Unknown code → create/search; permission-filtered actions | `/items/:id/actions` · Item, Balance, Permission | Not found; inactive/blocked item; offline queued |
| SCAN-03 | Manual Code Entry | Enter code without camera | All | Code field, recent codes, type hint | Submit, paste, scan instead | Non-empty; trim; case-insensitive lookup; max length | `/items/lookup` · Item, Barcode | Invalid; not found; create |

### 5.4 Inventory

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| INV-01 | Inventory List | Browse and find items | All | Item, SKU, stock, available, location, low-stock badge | Search, filter, sort, scan, create | Filters valid; no negative pages | `/items`, `/balances` · Item, StockBalance | Empty → create/import; offline cached |
| INV-02 | Item Detail | Single item truth | All | Identity, specs, stock by location, reservations, movements, docs | Receive, issue, transfer, adjust, reserve, edit, share | Item exists and permitted | `/items/:id` · Item, Balance, Movement, Reservation | Inactive; no stock; offline cached |
| INV-03 | Item Editor | Create/edit item | IM, Admin | Fields, custom fields, UOM, barcodes, images, status | Save, save draft, archive, generate barcode | SKU unique; UOM required; numeric precision; custom required fields | `/items` · Item, Barcode, CustomFieldValue | Duplicate; validation; offline draft |
| INV-04 | Stock by Location | Where stock sits | All | Location tree, on-hand, reserved, available, lot/serial | Drill down, transfer, count | Location exists | `/items/:id/balances` · StockBalance, Location | No stock; offline cached |
| INV-05 | Movement History | Audit a movement trail | All (cost gated) | Date, type, qty, from/to, actor, document, reason | Filter, open document, export | Date range max; permission filter | `/movements` · StockMovement, AuditEvent | Empty; offline cached; export online |
| INV-06 | Receive | Record incoming stock | OP, WS, IM, Purchasing | PO/ad hoc, supplier, lines, qty, location, lot/serial, discrepancy, photo | Add line, scan, save draft, commit | Qty > 0; location required; lot/serial rules; over-receipt policy | `/receipts` · GoodsReceipt, Movement, PO | Draft/queued/applied/rejected; conflict |
| INV-07 | Issue | Send stock to consumption | OP, WS, IM, PM, T | Item, qty, project/machine/department, reservation, reason | Scan, adjust qty, save draft, commit | Available ≥ qty unless override; reason required for override | `/issues` · Issue, Movement, Reservation | Insufficient; queued; rejected |
| INV-08 | Transfer | Move stock between locations | OP, WS, IM | From/to, lines, qty, in-transit, carrier/note | Dispatch, receive, cancel | From ≠ to; qty > 0; available check; receipt within window | `/transfers` · Transfer, Movement | In transit; partially received; cancelled |
| INV-09 | Return | Return stock to inventory | OP, WS, IM, PM, T | Source project/machine/job, item, qty, condition, disposition | Scan, add, commit | Qty ≤ issued; condition required; quarantine rules | `/returns` · Return, Movement, StockStatus | Pending inspection; queued |
| INV-10 | Adjust | Correct quantity/value | IM, Supervisor (limit) | Current, delta, new, reason, evidence, approval | Submit, approve (if permitted) | Reason code; approval above threshold; no direct balance edit | `/adjustments` · Adjustment, Approval | Awaiting approval; rejected; applied |
| INV-11 | Reserve | Hold stock for a purpose | IM, PM, Supervisor | Item, qty, project/machine, expiry, priority | Reserve, edit, release | Available ≥ qty; project required; expiry future | `/reservations` · Reservation | Insufficient; expired; released |
| INV-12 | Count List | Manage count sessions | IM, WS | Sessions, scope, status, progress, owner | Create, open, resume, cancel | Scope required; no overlapping frozen scope | `/counts` · CountSession | Empty; in progress; awaiting approval |
| INV-13 | Count Session | Capture physical counts | OP, WS, IM | Expected (optional/blind), counted, variance, progress, scan | Scan, enter qty, mark missing, submit | Counted ≥ 0; duplicate line handling; blind mode hides expected | `/counts/:id/lines` · CountLine, Balance | Offline entry; queued; submitted |
| INV-14 | Variance Review | Decide on discrepancies | IM, Supervisor, Auditor (read) | Expected, counted, delta, value, reason, evidence | Approve, reject, request recount | Reason required; threshold triggers second approval | `/counts/:id/review` · CountLine, Adjustment, Approval | Pending; approved; recount |
| INV-15 | Batch/Lot Detail | Trace a lot | All | Lot code, item, qty, expiry, locations, movements, projects | Issue, transfer, trace, block | Lot exists; expired blocked per policy | `/lots/:id` · Lot, Movement | Expired; blocked; empty |
| INV-16 | Serial Detail | Trace a unit | All | Serial, item, status, location, history, documents | Move, issue, return, trace | Serial unique; status transition rules | `/serials/:id` · Serial, Movement | In transit; scrapped |
| INV-17 | Labels | Generate labels | IM, Admin | Item/location/machine selection, template, preview | Generate, share, print later | Max batch size; supported sizes | `/labels` · LabelTemplate, Item | No template; printer unavailable |

### 5.5 Operations

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| OPS-01 | Operations Hub | Work-in-progress overview | WS, IM, PM | Queues, counts, approvals, today's activity | Open queue, quick action | — | `/operations/summary` | Empty onboarding hints |
| OPS-02 | Receiving Queue | Expected and in-progress receipts | OP, WS, IM, Purchasing | PO, supplier, lines, due date, status | Start, resume, scan | PO open; no over-receipt unless allowed | `/receipts?status=` · PO, Receipt | Empty; overdue |
| OPS-03 | Issue Queue | Pending/queued issues | WS, IM | Item, qty, destination, requester, status | Approve, reject, open | Permission; stock check | `/issues?status=` · Issue | Empty; insufficient |
| OPS-04 | Transfer Queue | In-transit and pending transfers | WS, IM | From/to, qty, dispatch time, status | Receive, cancel, open | In-transit only | `/transfers?status=` · Transfer | Empty; overdue |
| OPS-05 | Approval Inbox | One place for decisions | Managers, Admins | Type, requester, value, age, priority | Open, bulk approve (where safe) | Cannot self-approve; threshold | `/approvals` · Approval | Empty; overdue badge |
| OPS-06 | Approval Detail | Decide with context | Approvers | Document lines, before/after, evidence, comments | Approve, reject, request changes | Reason on reject; segregation of duties | `/approvals/:id` · Approval, AuditEvent | Already decided; conflict |

### 5.6 Projects

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| PRJ-01 | Projects List | Find a project | PM, IM, Owner | Code, name, customer, status, material value, shortage badge | Search, filter, create | Code unique | `/projects` · Project | Empty; archived |
| PRJ-02 | Project Detail | Project material truth | PM, IM, Owner | Planned/reserved/issued/returned/available, variance, activity | Reserve, issue, return, edit, report | Project active; permission | `/projects/:id` · Project, Reservation, Movement | Offline cached; stale banner |
| PRJ-03 | Material Plan | Plan required materials | PM, IM | Planned lines, required date, availability, shortage | Add/edit line, reserve all, export | Qty > 0; required date | `/projects/:id/plan` · PlanLine | Empty; shortage |
| PRJ-04 | Reserve for Project | Hold stock for a project | IM, PM | Item, available, qty, priority, expiry | Reserve, release | Available ≥ qty; project required | `/reservations` · Reservation | Insufficient; conflict |
| PRJ-05 | Project Variance | Explain material variance | PM, IM, Auditor | Planned vs issued vs returned vs remaining; cost (gated) | Filter, export | Date/project scope | `/projects/:id/variance` · Movement, PlanLine | Empty; incomplete data |

### 5.7 Machines and maintenance

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| MCH-01 | Machines List | Find an asset | All operational | Code, name, location, criticality, open jobs | Search, scan QR, create | Code unique | `/machines` · Machine | Empty; archived |
| MCH-02 | Machine Detail | Asset context and spares | All operational | Identity, specs, critical spares, stock, jobs, history, docs | View spares, reserve, create job, scan | Permission | `/machines/:id` · Machine, Item, Movement | Offline cached |
| MCH-03 | Maintenance Job | Execute a job | T, WS, IM | Job info, checklist, required parts, availability, status | Start, consume part, return, complete | Status transitions; parts availability | `/maintenance/jobs/:id` · Job, JobPart | Offline draft; queued |
| MCH-04 | Job Parts | Consume/return parts | T, WS, IM | Required, issued, returned, available | Issue, return, substitute | Available check; reason for substitute | `/maintenance/jobs/:id/parts` · JobPart, Movement | Insufficient; queued |

### 5.8 Reports

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| REP-01 | Reports Hub | Discover reports | All with report cap | Cards by category, recent, favourites | Open, favourite | Permission filter | `/reports` | Empty; offline note |
| REP-02 | Stock on Hand | Current stock truth | All | Item/location/qty/value (gated), filters | Filter, drill, export | Date/scope | `/reports/stock` · Balance | Stale banner offline |
| REP-03 | Movement Ledger | Auditable history | All | Date, type, qty, from/to, actor, reason | Filter, open, export | Range limits | `/reports/movements` · Movement | Empty |
| REP-04 | Valuation | Inventory value | Owner, IM, Auditor | Cost method, value by category/location | Filter, export | Cost permission | `/reports/valuation` · Balance, Cost | Cost hidden |
| REP-05 | Aging | Slow-moving stock | Owner, IM | Age buckets, value, last movement | Filter, export, create action | — | `/reports/aging` · Movement, Item | Empty |
| REP-06 | Consumption | Usage analysis | Owner, IM, PM | By item/project/machine/period | Filter, export | Period max | `/reports/consumption` · Movement | Empty |
| REP-07 | Dead Stock | No-movement items | Owner, IM | Item, value, last movement, days idle | Filter, export, mark review | Threshold config | `/reports/dead-stock` · Item, Movement | Empty |
| REP-08 | Shortage Risk | What may run out | IM, PM, Purchasing | Item, available, reserved, reorder point, lead time, risk | Filter, create PO/reservation | — | `/reports/shortage` · Balance, Supplier | Empty |
| REP-09 | Traceability | Follow an item/lot/serial | Auditor, IM | Upstream/downstream movements, projects, machines, people | Search, export | Permission | `/reports/trace` · Movement, Lot, Serial | Not found |
| REP-10 | Export / Share | Get data out | Authorised | Format (CSV/PDF), scope, row count, expiry link | Export, share, cancel | Row limit; PII rules; audit event | `/exports` · ExportJob | Queued; failed; expired |

### 5.9 Administration

| ID | Screen | Purpose | Roles | Key content | Actions | Inputs / validations | API · entities | States |
|---|---|---|---|---|---|---|---|---|
| ADM-01 | More Menu | Entry to secondary areas | All | Reports, Admin, Billing, Help, Settings, Profile | Navigate | Role-filtered | — | — |
| ADM-02 | Company Profile | Company identity and defaults | Owner, Admin | Name, logo, address, currency, timezone, fiscal settings | Edit, save | Name required; currency change restricted after stock | `/company` · Company | Read-only for non-admin |
| ADM-03 | Users | Manage team | Owner, Admin | Users, role, locations, status, last active | Invite, search, deactivate | Seat limit; email/phone unique | `/users` · User, Membership | Empty → invite |
| ADM-04 | User Detail / Invite | Add or edit a user | Owner, Admin | Identity, role, location scope, status, devices | Invite, resend, change role, revoke | Role required; cannot remove last owner | `/users/:id` · User, Role, Device | Pending invite; expired |
| ADM-05 | Roles & Permissions | Define capabilities | Owner, Admin | Role list, capability matrix, user count | Create, clone, edit, delete (if unused) | At least one admin; cannot delete system roles | `/roles` · Role, Permission | Locked system roles |
| ADM-06 | Warehouses | Manage sites | Owner, Admin | Name, address, contact, status, location count | Create, edit, archive | Name unique; cannot archive with stock | `/warehouses` · Warehouse | Empty |
| ADM-07 | Locations | Manage location tree | Owner, Admin, IM | Tree, type, code, capacity, restrictions | Add child, rename, move, archive | Unique code per parent; no cycles | `/locations` · Location | Empty; archive blocked |
| ADM-08 | Suppliers | Manage suppliers | Admin, Purchasing | Name, contacts, terms, lead time, items | Create, edit, archive, view items | Name unique; email format | `/suppliers` · Supplier | Empty |
| ADM-09 | Categories & Attributes | Structure the catalogue | Admin, IM | Category tree, attribute definitions | Add, edit, reorder, archive | No delete with items | `/categories` · Category, Attribute | Empty |
| ADM-10 | Custom Fields | Extend item data | Admin | Field list, type, required, scope, usage count | Create, edit, archive | Type immutable after data; unique key | `/custom-fields` · CustomField | In use → archive only |
| ADM-11 | Workflow Templates | Configure stages | Owner, Admin | Template, stage order, conditions, roles | Enable/disable, reorder, preview | At least one stage; no duplicate order | `/workflows` · Workflow, Stage | Default locked |
| ADM-12 | Approval Rules | Configure thresholds | Owner, Admin | Action, condition, approver, escalation | Create, edit, disable | No self-approval; valid approver | `/approval-rules` · ApprovalRule | Empty → defaults |
| ADM-13 | Label & Scan Settings | Configure codes | Admin | Barcode format, prefix, label sizes, duplicate policy | Save, preview label | Format valid; prefix length | `/settings/scan` · CompanySetting | Invalid format |
| ADM-14 | Subscription & Billing | Plan and payment | Owner | Plan, seats, usage, invoices, renewal | Upgrade, downgrade, pay, cancel | Payment provider; proration | `/billing` · Subscription, Invoice | Past due; grace |
| ADM-15 | Usage & Limits | Show plan consumption | Owner, Admin | Users, locations, items, transactions, storage | View, upgrade | — | `/usage` · UsageCounter | Near limit warnings |
| ADM-16 | Integrations | Connect systems | Owner, Admin | Available connectors, status, last sync | Connect, disconnect, test | Credentials valid; scopes | `/integrations` · Integration | Not configured; error |
| ADM-17 | Data Import | Bring data in | Admin, IM | File, sheet, field mapping, preview, errors | Upload, map, validate, commit, rollback | File type/size; required columns; duplicates | `/imports` · ImportJob | Validation errors; partial; rollback |
| ADM-18 | Data Export | Take data out | Owner, Admin, Auditor | Dataset, format, date range, size estimate | Export, share | Permission; row limit | `/exports` · ExportJob | Queued; expired |
| ADM-19 | Audit Log | Investigate changes | Owner, Admin, Auditor | Actor, action, entity, before/after, time, device | Filter, search, export | Immutable; permission | `/audit` · AuditEvent | Empty |
| ADM-20 | Security Settings | Session and device policy | Owner, Admin | Session timeout, MFA requirement, device limit, offline policy | Save | Policy valid; cannot lock out last owner | `/settings/security` · CompanySetting | Conflicts with user policy |
| ADM-21 | Help Desk | Get help | All | FAQ, contact, diagnostic bundle, status | Search, contact, attach logs | Message required | `/support/tickets` · Ticket | Offline → queue message |
| ADM-22 | Settings | App preferences | All | Theme, language, notifications, sync, storage | Toggle, clear cache, sign out | Storage warning | `/settings` · UserSetting | Offline cached |
| ADM-23 | Profile / Account | Personal account | All | Name, photo, contact, password, sessions | Edit, change password, sign out all | Password policy | `/me` · User, Session | — |

**Total:** 78 screens across 9 groups.

---

## 6. Screen count and phase mapping

| Phase | Screen groups | Approx. screens |
|---|---|---|
| MVP (P0) | Auth essentials, Home, Scan, Inventory core, Operations queues, Approvals, Projects, Reports core, Admin core | 48 |
| Release 1.1 (P1) | Lots/serials, labels, valuation/aging, import/export, billing, security, audit, help | +14 |
| Release 1.2 (P2) | Machines, maintenance, quality, kanban, component passport, advanced insights | +16 |

---

## 7. Detailed specifications for critical screens

### 7.1 HOME-01 — Dashboard

**Purpose:** give each role a truthful, fast answer to "what needs my attention now?"
**Roles:** all, content varies by capability.
**UI components:** greeting/company switcher; sync status chip; KPI cards (stock value if permitted,
low stock, pending approvals, in-transit, open counts); alert list; quick action row (Scan, Receive,
Issue, Count); recent activity; pull-to-refresh.
**Information:** KPI value + delta + "as of" time; alert severity; deep links.
**Actions:** open alert; start quick action; switch company; open sync center.
**Inputs:** date range for trend cards (default 30 days); no free text.
**Validations:** none on load; stale data is labelled, never presented as live.
**API:** `GET /dashboard?company_id=&range=` → KPIs, alerts, pending approvals, sync summary.
**Entities:** StockBalance, StockMovement, Approval, CountSession, Notification.
**Error/empty:** first-run checklist ("Add items", "Add location", "Invite team"); error card with retry;
partial failures show per-card error, not a blank screen.
**Offline:** cached last snapshot with "Last updated" and an offline banner; quick actions still open
drafts; KPI values marked stale.
**Navigation:** every card deep-links; Scan opens SCAN-01.

### 7.2 SCAN-01 / SCAN-02 — Scanner and Scan Result

**Purpose:** make the scan the shortest path to a permitted action.
**Roles:** all with scan capability; actions filtered by permission and context.
**UI components:** full-screen camera; scan frame; torch; camera switch; continuous-mode toggle;
haptic/beep feedback; recent scans strip; "Enter code" button; permission rationale.
**Information:** live preview; last scanned code; item thumbnail/name on result; on-hand/available;
location; active project/machine context if launched from a project/job.
**Actions:** scan; torch; manual entry; rescan; dismiss; choose action.
**Inputs:** barcode/QR; manual code; optional quantity preset when launched from a document.
**Validations:** supported symbologies; duplicate suppression (2 s); invalid/unknown code; inactive
item; blocked item; permission; offline action availability.
**API:** `POST /items/lookup` `{code, company_id, context}` → item + balances + permitted actions.
**Entities:** Item, Barcode, StockBalance, Permission, Project/Machine context.
**Error/empty:** camera permission denied → explain and offer settings + manual entry; unknown code →
"Create item" (if permitted) or search; offline lookup uses local cache; if not cached, queue a
"resolve later" scan.
**Offline:** scanning works offline against cached items; unknown codes can be queued with photo/note;
actions open draft forms; commit waits for sync.
**Navigation:** SCAN-02 action → INV-06/07/08/09/10/11, INV-02, INV-05, INV-03.

### 7.3 INV-06 — Receive

**Purpose:** record incoming material accurately and make it available only after validation.
**Roles:** Operator, Supervisor, Inventory Manager, Purchasing.
**UI components:** header (supplier, PO/ad hoc); line list; scan/add; qty keypad; UOM; location picker;
lot/serial section (conditional); discrepancy reason; photo; note; save draft; commit; sync badge.
**Information:** PO lines and ordered/received/remaining; item stock; supplier; expected date;
over-receipt policy; location availability.
**Actions:** add line by scan/search; edit qty; remove line; split lot; capture photo; save draft;
submit; duplicate line; print/share receipt (later).
**Inputs:** supplier (required for PO receipt), PO (optional per policy), item (required), qty > 0,
UOM, location (required), lot/serial (if tracked), discrepancy reason (if qty differs), photo optional.
**Validations:** qty ≤ remaining unless over-receipt allowed; lot uniqueness; serial uniqueness;
location belongs to company; item active; duplicate scan prevention; required custom fields.
**API:** `POST /receipts` (draft/commit), `GET /purchase-orders/:id`, `GET /items/lookup`,
`POST /uploads`.
**Entities:** GoodsReceipt, ReceiptLine, PurchaseOrder, StockMovement, Lot, Serial, Attachment.
**Error/empty:** no PO → ad hoc receiving with supplier optional per policy; no lines → empty prompt;
commit rejection → line-level errors and a retry path; duplicate → show existing receipt.
**Offline:** capture as draft/queued; local validation for qty/lot format; server validates PO status,
over-receipt and uniqueness at sync. Applied only after server acceptance.
**Navigation:** back to OPS-02 or INV-01; success → receipt summary; "receive another" loop.

### 7.4 INV-07 — Issue

**Purpose:** move stock to consumption with a traceable destination and reason.
**Roles:** Operator, Supervisor, Inventory Manager, Project Manager, Technician.
**UI components:** item header with available; qty keypad; destination selector (project, machine,
work order, department, customer); reservation selector; reason; note; photo; commit.
**Information:** on-hand, reserved, available; destination's existing allocation; recent destinations;
who requested (if from a queue).
**Actions:** scan item; change destination; consume reservation; override (if permitted); save draft;
commit; report damage instead.
**Inputs:** item, qty > 0, destination (required by policy), reason (required for override/ad hoc),
reservation (optional), note.
**Validations:** available ≥ qty unless override capability; reservation belongs to destination;
inactive/blocked item; location scope; cannot issue expired lot if policy blocks.
**API:** `POST /issues`, `GET /items/:id/availability`, `GET /projects`, `GET /machines`.
**Entities:** Issue, IssueLine, Reservation, StockMovement, Project, Machine.
**Error/empty:** insufficient stock shows available and suggests transfer/reservation; offline commit
queued; server may reject if another user consumed the stock → conflict.
**Offline:** draft/queued; local availability check is advisory only; server is authoritative.
**Navigation:** success → issue summary / next scan; conflict → sync center.

### 7.5 INV-08 — Transfer

**Purpose:** move stock between locations with an auditable in-transit state.
**Roles:** Operator, Supervisor, Inventory Manager.
**UI components:** from/to location; line list; qty; dispatch; receive; in-transit banner; timeline.
**Information:** source available; destination; dispatched/received quantities; expected arrival.
**Actions:** add lines; dispatch; receive full/partial; cancel; report discrepancy.
**Inputs:** from, to (different), item, qty > 0, carrier/note optional.
**Validations:** source available; destination active; no self-transfer; receipt within configured window.
**API:** `POST /transfers`, `POST /transfers/:id/dispatch`, `POST /transfers/:id/receive`.
**Entities:** Transfer, TransferLine, StockMovement, Location.
**Error/empty:** no destination → create location shortcut; partial receipt → discrepancy flow.
**Offline:** dispatch/receive drafts; in-transit state is server-authoritative; queued actions show
pending.
**Navigation:** OPS-04; item detail.

### 7.6 INV-13 — Count Session

**Purpose:** capture a physical count with minimal friction and a defensible variance.
**Roles:** Operator, Supervisor, Inventory Manager.
**UI components:** progress (counted/total); scan; list; qty keypad; "not found"; notes; blind-mode
toggle (if enabled); submit; offline badge.
**Information:** location scope; item; expected (hidden in blind mode); counted; variance; counter.
**Actions:** scan, enter, skip, mark missing, add unexpected item, submit, resume.
**Inputs:** counted qty ≥ 0; reason for variance at review; note.
**Validations:** item in scope; duplicate line updates rather than duplicates; submit requires all
lines or explicit "incomplete" flag.
**API:** `POST /counts/:id/lines`, `POST /counts/:id/submit`, `GET /counts/:id`.
**Entities:** CountSession, CountLine, StockBalance, User.
**Error/empty:** no scope → create; offline → queue lines; conflict if item moved during count.
**Offline:** all count entry is safe offline (draft); submission queues; variance approval requires
server.
**Navigation:** INV-14 review; back to INV-12.

### 7.7 PRJ-02 — Project Detail

**Purpose:** show the material truth of a project in one screen.
**Roles:** Project Manager, Inventory Manager, Owner; Auditor read-only.
**UI components:** header (code, name, customer, status); summary cards (planned, reserved, issued,
returned, available, variance); tabs (Materials, Activity, Documents); quick actions.
**Information:** quantities by item; shortage indicators; recent movements; reservations; cost if
permitted.
**Actions:** add plan line; reserve all; issue; return; export; edit project.
**Inputs:** project fields; plan quantities; required dates.
**Validations:** project active; quantities > 0; reservation cannot exceed available.
**API:** `GET /projects/:id/summary`, `/projects/:id/materials`, `/projects/:id/activity`.
**Entities:** Project, PlanLine, Reservation, StockMovement, Attachment.
**Error/empty:** no plan → prompt to add; no activity → explain; offline → cached summary with stale
label.
**Offline:** read-only cache; reservation/issue drafts queued; conflicts surfaced.
**Navigation:** PRJ-03, PRJ-05, INV-07, INV-11.

### 7.8 ADM-05 — Roles & Permissions

**Purpose:** let an administrator define exactly what a role can do, on a phone.
**Roles:** Owner, Admin.
**UI components:** role list; create/clone; capability groups (Inventory, Projects, Reports, Admin);
switch toggles; location scope selector; user count; save.
**Information:** capability description; dependencies (e.g., approve implies view); impacted users.
**Actions:** create, clone, rename, toggle, set scope, delete unused role.
**Inputs:** role name unique; at least one capability; at least one admin role must exist.
**Validations:** cannot remove own admin capability if last admin; cannot delete assigned role.
**API:** `GET/POST/PATCH /roles`, `GET /permissions`.
**Entities:** Role, Permission, RolePermission, Membership.
**Error/empty:** no custom roles → offer templates; save failure → preserve edits.
**Offline:** **not available offline** (security-sensitive); show "Connect to manage roles."
**Navigation:** ADM-03/04.

---

## 8. Key user journeys

### J1 — New company onboarding

1. Owner receives invite or starts trial → AUTH-02/03.
2. Creates company → AUTH-08 (name, currency, timezone).
3. Selects industry template → AUTH-09 (preview of stages/modules).
4. Confirms default locations (Receiving, Quarantine, Main Store).
5. Invites team (optional) → AUTH-07.
6. Lands on Home with a checklist: add items, import CSV, scan a test item, receive first stock.
7. Admin can complete everything on a phone; no desktop required.

**Success:** company can receive and issue a real item within 30 minutes of signup.

### J2 — Receiving a delivery by scan (online)

1. Operator opens OPS-02 → selects PO (or ad hoc).
2. Scans item → SCAN-02 shows item and "Receive" action.
3. Enters quantity, location, lot if required, captures discrepancy/photo.
4. Reviews summary (on-hand before/after).
5. Commits → server validates → receipt applied → stock available.
6. Success screen offers "Receive another" and "Print/share" (later).

### J3 — Issuing to a project while offline

1. Technician/operator is in a low-signal area; offline banner visible.
2. Scans item → cached item resolves → chooses "Issue to project."
3. Selects project, enters qty; local advisory availability shown.
4. Saves → operation status "Queued"; Home shows pending count.
5. On reconnect, outbox pushes with idempotency key.
6. Server validates reservation/availability:
   - success → Applied; balances update; audit recorded.
   - insufficient/conflict → Rejected/Conflict; appears in Sync Center; user resolves.
7. Technician sees final status and can inform the supervisor.

### J4 — Cycle count

1. Manager creates a count for a location/category (INV-12).
2. Operator counts by scan/qty; blind mode hides expected.
3. Submits; manager reviews variance (INV-14).
4. Above threshold → recount or second approval.
5. Approval posts adjustments to the ledger; report updates.
6. Accuracy metric recorded.

### J5 — Transfer between warehouses

1. Supervisor creates transfer (INV-08), dispatches.
2. Stock shows in-transit; source available reduced.
3. Destination operator scans/receives (full or partial).
4. Discrepancy triggers a reason and, if needed, an adjustment approval.
5. Transfer closes; both locations' histories are complete.

### J6 — Technician consumes a spare part (Release 1.2)

1. Technician opens maintenance job (MCH-03).
2. Sees required parts and availability.
3. Scans part → issue to job; reservation consumed.
4. Completes job; returns unused part (MCH-04).
5. Machine history and job cost update.

### J7 — Conflict resolution

1. Queued issue is rejected because another user consumed the stock.
2. Notification + Sync Center badge.
3. Conflict screen shows device value, server value, timestamp, user, and suggested options.
4. User chooses: accept server, reduce quantity, transfer from another location, or cancel.
5. Resolution is audited; no silent overwrite.

### J8 — Admin invites a user

1. Admin → ADM-03 → Invite.
2. Enters name, email/phone, role, location scope.
3. System checks seat limit and duplicate.
4. Invite sent; pending state visible; resend/revoke available.
5. User accepts via AUTH-07; membership activated; audit recorded.

### J9 — Low-stock response

1. Home alert / notification: item below reorder point.
2. Opens item → sees on-hand, reserved, open POs, consumption.
3. Creates a purchase request/PO (Release 1.1) or reserves/transfers.
4. Alert resolves when stock or incoming supply covers the threshold.

### J10 — Unknown barcode

1. Scan returns unknown.
2. Options: search similar, create item (if permitted), queue for later.
3. Create item prefills barcode; requires SKU/name/UOM/category.
4. Save → item created; user returns to the original action with the new item.

---

## 9. Offline behaviour

### 9.1 Classification

| Class | Examples | Local behaviour | Authority |
|---|---|---|---|
| **Safe offline draft** | Receive draft, issue draft, transfer draft, return draft, count lines, reservation request, damage report, new item draft, notes/photos | Persisted locally, editable, queued | None until server accepts |
| **Server-validated transaction** | Commit issue, dispatch transfer, confirm reservation, post adjustment, approve count, negative-stock override, serial/lot validation | May be prepared offline; commit requires server validation | Server |
| **Read-only cache** | Item list/detail, balances, project summary, recent movements, dashboard snapshot | Cached with "as of" timestamp | Server |
| **Online-only** | User/role changes, billing, password/MFA, security settings, export generation, integration credentials | Blocked offline with clear message | Server |

**Critical rule:** an offline draft must never be represented as committed stock. The UI must say
"Queued — not yet applied."

### 9.2 Local data

- SQLite database (encrypted at rest where supported).
- Tables: cached entities, drafts, outbox operations, sync cursor, user/company settings.
- Attachments: compressed images stored in app sandbox; upload on sync; user warned about storage.
- Cache is scoped per company and cleared on sign-out (with a warning if drafts exist).

### 9.3 Sync protocol (conceptual)

1. Client creates operation with `client_operation_id` (UUIDv7) and `idempotency_key`.
2. Operation enters outbox with state `queued`.
3. On connectivity, client pushes a batch in order per aggregate (item/location).
4. Server authenticates, checks company/role/location scope, validates invariants, applies in a
   transaction, records audit, returns result.
5. Client marks `applied` or `rejected`; updates local cache from the response.
6. Client pulls changes since `cursor` (other users' movements, item changes).
7. Conflicts are stored with both versions and surfaced in the Sync Center.

**Guarantees:** at-least-once delivery + idempotency = effectively-once application. No last-write-wins
on stock. Ordering is preserved per item/location aggregate; cross-aggregate ordering is not assumed.

### 9.4 Conflict classes and resolution

| Conflict | Example | Resolution |
|---|---|---|
| Duplicate | Same operation retried | Idempotency key returns original result |
| Insufficient stock | Issue queued, stock consumed elsewhere | Reduce qty, transfer, or cancel |
| Stale version | Item/location changed since cache | Show diff; accept server or reapply |
| Reservation race | Two users reserve last units | First commit wins; second gets conflict |
| Serial conflict | Same serial received twice | Reject; show existing receipt |
| Lot/expiry rule | Expired lot blocked | Choose another lot or request override |
| Approval race | Two approvers act | First decision wins; second sees final state |
| Permission change | Role revoked while offline | Reject; require re-auth/role refresh |

### 9.5 Sync Center UX

- Global badge: queued count + error count.
- Per-operation timeline: created → queued → syncing → applied/rejected/conflict.
- Filter by status/type/date.
- Conflict detail: side-by-side values, actor, timestamps, device, suggested actions.
- Bulk retry for transient failures; no bulk override of stock conflicts.
- Diagnostic export for support (redacted).

---

## 10. Accessibility

- WCAG 2.1 AA contrast for text and controls.
- Minimum 44×44 pt/dp touch targets; 8 dp spacing.
- Dynamic type support; layouts reflow at large font sizes.
- Screen-reader labels for icon-only buttons; logical focus order.
- Never encode status by colour alone: use icon + text + colour.
- Haptics and optional sound for scan success/failure.
- Reduced-motion setting respected.
- Camera scanner offers a non-camera path (manual entry) for accessibility.
- Forms use visible labels, not placeholder-only.
- Error messages are announced and linked to the field.
- Landscape and tablet layouts tested.
- Language: English at launch; Hindi and Marathi planned; RTL architecture-ready but not required.

---

## 11. Performance and device targets

| Target | Requirement |
|---|---|
| Cold start | < 3 s mid-range Android (e.g., 4 GB RAM) |
| Scan decode | < 1.5 s typical; feedback < 200 ms after decode |
| List scroll | 60 fps with 1,000 virtualized rows |
| Item search | < 500 ms p95 online; < 200 ms cached |
| Stock commit | < 500 ms server p95; UI acknowledges < 100 ms |
| Offline draft save | < 100 ms |
| App size | Keep under ~60 MB where feasible; defer heavy assets |
| Battery | Avoid continuous camera use outside scanner |
| Storage | Warn at 200 MB cache; configurable retention |
| Minimum OS | Android 10+ / iOS 15+ (proposed; validate device fleet) |

---

## 12. Instrumentation

Track (privacy-respecting, no sensitive payloads):

- Scan started / succeeded / failed / manually entered.
- Scan-to-commit duration by action.
- Draft created / queued / applied / rejected / conflict.
- Screen load time and error rate.
- Search with no results.
- Approval turnaround.
- Import success/failure by reason.
- Crash-free sessions and ANRs.
- Feature usage by role (aggregate).

Instrumentation must never log item costs, personal contact data, credentials, or full payloads.

---

## 13. Empty, error and permission patterns

| Situation | Pattern |
|---|---|
| First use | Illustration + one-sentence value + primary action + "learn more" |
| No results | Explain query, suggest filter reset, offer scan |
| No permission | Explain which role is needed and who to contact; hide sensitive data |
| Offline | Persistent banner; actions that can queue are enabled; online-only actions disabled with reason |
| Server error | Plain-language message + retry + error reference |
| Validation | Inline, field-level, preserve input |
| Partial failure | Per-line status, not a global failure |
| Session expiry | Re-authenticate and return to the same screen/draft |
| Duplicate | Show existing record and link to it |
| Rate limit | Explain wait time; do not lose draft |

---

## 14. Open UX decisions

1. Should the center Scan tab be a tab or a floating action button? (Recommendation: tab, with FABs
   for context-specific actions.)
2. Is a five-tab bar acceptable for tablet, or should tablet use a rail? (Recommendation: rail.)
3. Should the app support dark mode at launch? (Recommendation: no; design tokens ready.)
4. Should administrators be able to bulk-edit items on mobile? (Recommendation: limited bulk actions,
   full bulk via CSV import.)
5. Which report is the default for owners? (Recommendation: stock value + shortage + recent movements.)
6. Should counts freeze stock by default? (Recommendation: no; warn on conflicting movements.)
7. Should the scanner support continuous mode for cycle counts by default? (Recommendation: yes,
   with a visible toggle.)
8. What is the minimum device/OS baseline? (Needs NTAN field data.)
