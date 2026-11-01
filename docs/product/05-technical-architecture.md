# 05 — Technical Architecture Proposal

**Document status:** Proposed direction. No technology has been implemented.
**Date:** 2026-10-22
**Database decision:** **OPEN.** MongoDB and PostgreSQL are both evaluated. No database is selected.
**Related:** `03-feature-blueprint.md`, `04-mobile-blueprint.md`, `07-open-questions-risks.md`

---

## 1. Architecture drivers

| Driver | Implication |
|---|---|
| Inventory correctness | Every stock change must be atomic, attributable and reversible only by counter-entry |
| Concurrency | Multiple users/devices may act on the same item/location simultaneously |
| Offline operation | The client must capture drafts safely and reconcile without silent data loss |
| Multi-tenancy | Strong isolation is a security requirement, not a filter |
| Auditability | Append-only history, actor/device/time/reason, exportable |
| Configurability | Custom fields, templates and workflows without per-tenant code |
| Mobile-only administration | APIs must support every admin task; no hidden web dependency |
| Reporting | Operational and financial views without threatening transaction latency |
| Scale | Start with SMB workloads; design for multi-site and international growth |
| Operability | Backups, restore drills, monitoring, incident response from day one |

### 1.1 Non-functional targets (initial)

| Area | Target |
|---|---|
| Availability | 99.9% monthly for the API (excluding planned maintenance) |
| Stock commit latency | p95 < 500 ms server-side |
| Read latency | p95 < 300 ms for list/detail |
| Durability | RPO ≤ 5 minutes; RTO ≤ 4 hours for production |
| Data isolation | Zero cross-tenant access in automated tests |
| Audit retention | Configurable; default 7 years for stock/audit records |
| Offline durability | No accepted draft lost on app kill/restart |
| Sync correctness | Effectively-once application via idempotency |
| Security | OWASP MASVS/ASVS aligned; secrets never in the app |

---

## 2. Stack evaluation

### 2.1 Mobile: React Native + TypeScript

**Recommendation: retain.** [Proposed]

| Factor | Assessment |
|---|---|
| Cross-platform | Strong: one codebase for Android/iOS, shared domain logic |
| Native access | Good via config plugins/native modules for camera, SQLite, secure storage, push |
| Ecosystem | Mature navigation, forms, query, camera, SQLite, testing |
| Team fit | Assumed TypeScript capability; validate |
| Performance | Sufficient for forms/lists/scanner; heavy image/video work would need native modules |
| Long-term risk | Moderate: dependency churn, New Architecture migration; mitigated by pinning and tests |
| Alternatives | Flutter (strong UI, different hiring pool), native (best performance, 2× effort) |

**Rule:** business rules that affect stock are never trusted on the client. The mobile app may
pre-validate for UX, but the server is authoritative.

### 2.2 Expo vs bare React Native

| Dimension | Expo (development builds / prebuild) | Bare React Native |
|---|---|---|
| Setup speed | High | Medium |
| Native modules | Supported via config plugins/dev builds; occasional gaps | Full control |
| Camera/ML Kit | Works with `expo-camera` or custom dev build with VisionCamera | Direct |
| SQLite | `expo-sqlite` or custom native module | Direct |
| Push | Expo Notifications or direct FCM/APNs | Direct |
| OTA updates | EAS Update (with policy constraints) | Custom |
| Build/release | EAS Build; managed signing | Custom CI |
| Risk | Expo Go cannot run custom native scanning; must use dev builds | More maintenance |

**Recommendation:** **Expo with development builds and prebuild**, not Expo Go. Keep the option to
eject if a required native module blocks delivery. Validate scanning performance on target devices
before committing. [Proposed]

### 2.3 Scanning

| Option | Strengths | Limitations | Use |
|---|---|---|---|
| `expo-camera` | Simple, Expo-managed, barcode scanning | Less control over focus/low light; Expo Go limitations for advanced config | Pilot / simple flows |
| `react-native-vision-camera` + ML Kit/AVFoundation scanner | High performance, frame processors, torch, focus control | Native build; dependency/version management | Production recommendation |
| Commercial SDK (Scanbot, Scandit) | Best damaged/low-light performance, support | Cost, licensing | Evaluate if field tests fail |

**Distinguish:** barcode/QR decoding is **not** OCR. OCR (reading text from labels) is a separate,
optional future capability and must not be conflated with scanning.

**Production requirements:** torch, tap-to-focus, continuous mode with debounce, duplicate suppression,
manual entry, permission rationale, graceful failure, and a tested device matrix.

### 2.4 Backend: Python + FastAPI

**Recommendation: retain.** [Proposed]

- Async I/O, Pydantic validation, OpenAPI generation, strong typing.
- Modular monolith with clear domain boundaries.
- Background workers for exports, notifications, imports, insights.
- Suitable for a small team; avoids premature microservices.

**Proposed libraries (not installed):** FastAPI, Pydantic v2, SQLAlchemy 2.x or Mongo driver,
Alembic (if PostgreSQL), Redis (optional cache/queue), an object-storage SDK, OpenTelemetry.

### 2.5 Offline storage: SQLite

**Recommendation: retain.** SQLite is appropriate for structured local cache, drafts and outbox.
Use an encrypted SQLite build where available; otherwise rely on OS-level file protection plus
application-level encryption for sensitive fields. [Proposed]

---

## 3. Mobile architecture

### 3.1 Layering

```
apps/mobile
├── app/                 # bootstrap, navigation, providers
├── features/
│   ├── auth/
│   ├── inventory/
│   ├── receiving/
│   ├── issuing/
│   ├── transfers/
│   ├── counts/
│   ├── projects/
│   ├── machines/
│   ├── reports/
│   ├── admin/
│   └── sync/
├── domain/              # entities, value objects, invariants (pure TS)
├── data/
│   ├── api/             # generated/typed client
│   ├── local/           # SQLite schema, queries, migrations
│   ├── repositories/    # offline-first repositories
│   └── sync/            # outbox, pull, conflict
├── design-system/       # tokens, primitives, patterns
├── lib/                 # logging, errors, permissions, formatting
└── test/                # unit, integration, e2e
```

**Principles:**

- Feature modules do not import each other's internals.
- Domain logic is pure and testable; no React/DB imports.
- Repositories are the only gateway to local/remote data.
- Screens orchestrate; they do not contain business rules.
- A single source of truth for permissions and feature flags.
- Typed navigation routes; no stringly-typed navigation.

### 3.2 State and data

- **Server state:** query library with caching, retries, background refetch, offline persistence.
- **Client state:** small stores for session, UI preferences, draft context.
- **Forms:** schema-validated forms with field-level errors and draft autosave.
- **Offline:** repository writes to SQLite + outbox; UI observes local state and sync status.
- **No global mutable store for stock quantities.** Balances come from the repository/cache and are
  labelled with freshness.

### 3.3 Design system

- Tokens from verified NTAN colours + proposed functional colours.
- Primitives: Button, Input, Select, QuantityStepper, ScanField, StatusBadge, SyncBadge, EmptyState,
  ErrorState, BottomSheet, ConfirmDialog, DataList, FilterBar.
- Density modes: comfortable (default), compact (tablet/warehouse).
- Dark mode tokens prepared but not enabled at launch.
- Accessibility built into primitives, not bolted on.

### 3.4 Security on device

- Tokens in iOS Keychain / Android Keystore.
- No database credentials, API secrets, or signing keys in the bundle.
- Biometric unlock optional; re-auth for sensitive actions.
- Local DB encrypted; cache cleared on logout (drafts warning).
- Screenshot blocking on sensitive screens (optional, configurable).
- Certificate pinning optional; evaluate operational cost.

### 3.5 Reliability

- Error boundaries per feature.
- Crash reporting with redacted context.
- Idempotent retries.
- Version gating: minimum supported app version; force update path.
- Feature flags for staged rollout.
- Migration strategy for local SQLite schema.

---

## 4. Backend architecture

### 4.1 Modular monolith

```
services/api
├── app/
│   ├── main.py
│   ├── core/            # config, security, errors, logging, tenancy
│   ├── modules/
│   │   ├── identity/
│   │   ├── tenancy/
│   │   ├── catalog/
│   │   ├── locations/
│   │   ├── inventory/
│   │   ├── procurement/
│   │   ├── projects/
│   │   ├── machines/
│   │   ├── maintenance/
│   │   ├── quality/
│   │   ├── counts/
│   │   ├── reporting/
│   │   ├── sync/
│   │   ├── notifications/
│   │   ├── files/
│   │   ├── billing/
│   │   ├── audit/
│   │   └── integrations/
│   ├── workers/         # exports, imports, push, insights
│   └── tests/
```

Each module owns its domain, service, repository and API router. Cross-module communication uses
explicit service interfaces or domain events, not direct table access.

### 4.2 API style

- REST/JSON, versioned under `/v1`.
- Cursor pagination; explicit filters; stable sort.
- Idempotency-Key header for all mutating operations.
- `If-Match`/version for updates where optimistic concurrency applies.
- Standard error envelope: `code`, `message`, `field_errors`, `request_id`, `retryable`.
- OpenAPI schema is the contract; generated TypeScript client.
- Rate limiting per user/company/IP.
- No business logic in controllers.

### 4.3 Background processing

- Transactional outbox for domain events (movement posted, approval requested, low stock).
- Workers for notifications, exports, imports, report materialisation, insight computation.
- Retries with backoff and dead-letter queue.
- Idempotent handlers.

### 4.4 Files

- Object storage (S3-compatible) with private buckets.
- Signed, short-lived URLs.
- Virus scanning for uploads (optional but recommended).
- Per-tenant prefixes and access checks.
- Image compression on device; preserve originals where required.

### 4.5 Push and notifications

- FCM (Android) and APNs (iOS).
- Device token registry with invalidation.
- Deep links to objects.
- User preferences and quiet hours.
- In-app inbox as the source of truth; push is a nudge.

---

## 5. Database comparison — MongoDB vs PostgreSQL

> **Decision status: OPEN.** This section evaluates both options against realistic inventory
> scenarios. It does not select or implement either database.

### 5.1 Evaluation criteria and weights

| Criterion | Weight | Why |
|---|---|---|
| Transaction correctness | 25% | Stock movements, reservations, approvals must be atomic |
| Concurrency control | 20% | Multiple users/devices on the same stock |
| Reporting and analytics | 15% | Operational and financial visibility |
| Multi-tenant isolation | 15% | Security and compliance |
| Schema flexibility | 10% | Custom fields and industry templates |
| Horizontal scale | 10% | Growth and multi-region ambition |
| Operational maturity | 5% | Backups, tooling, hiring, managed services |

### 5.2 Scenario analysis

#### S1 — Two operators receive the same SKU at the same time

**Requirement:** two receipts, possibly different locations; each must create a movement, update the
balance, update the PO's received quantity, and write an audit event. No partial state.

- **PostgreSQL:** one transaction; `UPDATE balances ... RETURNING` or `SELECT ... FOR UPDATE`; unique
  constraints; PO line update in the same transaction. Conflict handling via row locks, deadlock
  detection, retry. Mature and predictable.
- **MongoDB:** multi-document transaction across `movements`, `balances`, `purchase_orders`,
  `audit_events`. Requires a replica set/sharded cluster. Write conflicts raise
  `TransientTransactionError` and must be retried. Without a transaction, a crash can leave a movement
  without a balance update or vice versa.

**Risk:** MongoDB is workable, but the team must consistently use transactions and retry semantics for
every stock path. One missed path creates a reconciliation incident.

#### S2 — Reservation races with issue

**Requirement:** available = on-hand − reserved. Never reserve/issue more than available unless a
privileged override applies.

- **PostgreSQL:** atomic conditional update:
  `UPDATE balances SET reserved = reserved + :q WHERE ... AND on_hand - reserved >= :q RETURNING ...`
  plus reservation insert and movement, all in one transaction. Or `SERIALIZABLE` for complex
  multi-line operations.
- **MongoDB:** atomic `findOneAndUpdate` on a single balance document with `$expr` guarding available
  and `$inc`; reservation and ledger documents need a transaction. Cross-document consistency requires
  the transaction; otherwise compensation logic.

**Risk:** MongoDB's single-document atomicity is excellent for a counter, but the reservation + ledger +
audit set is multi-document. The design must not pretend otherwise.

#### S3 — Warehouse-to-warehouse transfer

**Requirement:** source decreases, in-transit increases, destination increases on receipt; each step
audited; cancellation reverses safely.

- **PostgreSQL:** native multi-row transaction; check constraints; foreign keys; clear state machine.
- **MongoDB:** multi-document transaction per step; or a saga with compensating actions and an explicit
  state machine. Sagas add application complexity and new failure modes.

**Risk:** transfers are where "eventual consistency" becomes visible to a warehouse operator. The
simpler the transactional model, the fewer support incidents.

#### S4 — Cycle count approval posts adjustments

**Requirement:** count lines, variance, approval, adjustment movements, balance updates, audit, and
notification must be consistent. Approver cannot be creator (policy).

- **PostgreSQL:** one transaction; approval row with unique constraint; audit inserted; outbox event.
- **MongoDB:** transaction across the same documents; unique indexes enforce one decision; otherwise
  partial approvals are possible.

#### S5 — Duplicate scan / retry

**Requirement:** the same client operation applied once.

- **PostgreSQL:** unique `(company_id, idempotency_key)`; `INSERT ... ON CONFLICT` returns the original
  result.
- **MongoDB:** unique compound index; duplicate-key error returns the original. Both are strong.

#### S6 — Reporting: stock value, aging, consumption, project variance

- **PostgreSQL:** joins, CTEs, window functions, materialized views, read replicas. Natural fit for
  financial/operational reporting; BI tools understand SQL.
- **MongoDB:** aggregation pipeline with `$lookup`, `$facet`, `$graphLookup`; or maintain denormalised
  read models. Powerful, but complex queries are harder to evolve and optimise; reporting often needs
  a separate store.

**Risk:** reporting is a core product surface (Docs 03/04). A database that makes reporting expensive
shifts cost into application code and read models.

#### S7 — Multi-tenant isolation

- **PostgreSQL:** shared schema with `company_id` + Row-Level Security (RLS); `SET LOCAL` tenant per
  transaction; composite indexes; automated cross-tenant tests. Optional schema-per-tenant or
  database-per-tenant for enterprise.
- **MongoDB:** shared collections with `company_id` filtered in every query, or database-per-tenant.
  No native RLS equivalent; isolation is application-enforced. A single missed filter is a breach.
  Database-per-tenant improves isolation but complicates migrations, backups, and cross-tenant
  reporting.

**Risk:** mobile-only, multi-tenant SaaS with sensitive cost/project data makes isolation a
first-class requirement. Application-enforced filters are workable but demand exceptional discipline
and tests.

#### S8 — Custom fields and industry templates

- **PostgreSQL:** `JSONB` columns with GIN indexes; typed application validation; a hybrid relational +
  JSON model works well. Custom field definitions can be relational.
- **MongoDB:** native flexible documents; excellent for heterogeneous item attributes. Risk: unbounded
  document growth, inconsistent shapes, and query/index sprawl.

**Advantage:** MongoDB, but PostgreSQL's JSONB is sufficient for the planned custom-field model.

#### S9 — Scale and growth

- **PostgreSQL:** vertical scaling, read replicas, partitioning (by company/time), connection pooling;
  Citus for horizontal sharding if needed. Most SMB/mid-market workloads fit comfortably.
- **MongoDB:** native sharding; good horizontal write scaling; shard key choice is critical (e.g.,
  company_id + item_id) and hard to change later.

**Advantage:** MongoDB for extreme horizontal write scale; PostgreSQL for the expected workload.

#### S10 — Backup, recovery, migrations

- **PostgreSQL:** WAL-based PITR, logical replication, mature migration tooling, broad managed
  offerings, strong SQL talent pool.
- **MongoDB:** replica sets, Atlas continuous backup/PITR, schema validation, migration scripts. Also
  mature, but schema evolution is application-managed.

### 5.3 Weighted comparison (illustrative)

Scores 1–5; weighted score out of 5. This is a decision aid, not a benchmark.

| Criterion | Weight | PostgreSQL | MongoDB |
|---|---|---|---|
| Transaction correctness | 25% | 5.0 | 3.5 |
| Concurrency control | 20% | 5.0 | 3.5 |
| Reporting/analytics | 15% | 5.0 | 3.0 |
| Multi-tenant isolation | 15% | 5.0 | 3.0 |
| Schema flexibility | 10% | 4.0 | 5.0 |
| Horizontal scale | 10% | 3.5 | 4.5 |
| Operational maturity | 5% | 5.0 | 4.0 |
| **Weighted score** | **100%** | **4.78** | **3.50** |

**Interpretation:** PostgreSQL is a stronger fit for an inventory **system of record** because the
hard problems are transactions, concurrency, isolation and reporting. MongoDB is a stronger fit for
flexible catalogue/document workloads and extreme horizontal scale.

### 5.4 Recommendation (pending approval)

**Recommended:** PostgreSQL as the transactional system of record for inventory, reservations,
ledger, audit and tenancy; optionally MongoDB (or object storage + search) for document-heavy
catalogue/telemetry if a concrete need appears. [Proposed — not approved]

**Conditions under which MongoDB may still be the right choice:**

- NTAN has strong in-house MongoDB operational expertise and a deliberate document-first architecture.
- The team commits to multi-document transactions for every stock path and to automated reconciliation.
- Reporting is offloaded to a dedicated read model/warehouse from the start.
- Tenant isolation is enforced by database-per-tenant or a rigorously tested data-access layer.
- The expected scale genuinely requires horizontal sharding.

**If MongoDB is approved, mandatory safeguards:**

1. Replica set/sharded cluster with transactions enabled.
2. Every stock operation uses a transaction + retry on transient errors.
3. Unique compound indexes for idempotency, serials, lot codes, and document numbers.
4. A persisted `available` counter guarded atomically; never compute availability from an unbounded
   ledger at write time.
5. Append-only ledger collection; balances are projections with a version.
6. Tenant ID in every document and every query; automated cross-tenant tests; no client-supplied
   tenant trust.
7. A reconciliation job that recomputes balances from the ledger and alerts on drift.
8. Read models for reporting, with freshness indicators.
9. Schema validation and migration scripts, even though MongoDB is schema-flexible.
10. Documented backup/PITR and restore drills.

**If PostgreSQL is approved, mandatory safeguards:**

1. RLS enabled and tested on every tenant table.
2. Ledger append-only enforced by permissions/triggers; no UPDATE/DELETE grants to the app role.
3. Atomic balance updates and reservation checks; `SERIALIZABLE` where needed.
4. Composite indexes on `(company_id, ...)` for every hot query.
5. Partitioning strategy for large movement/audit tables.
6. PITR, restore drills, and migration review.
7. Read replica for reporting; materialized views for heavy aggregates.
8. Connection pooling and query timeouts.

### 5.5 Decision required from NTAN

| Option | What NTAN is approving |
|---|---|
| **A. PostgreSQL** (recommended) | Relational system of record, RLS, transactions, SQL reporting |
| **B. MongoDB** | Document model with multi-document transactions, app-enforced tenancy, read models for reporting |
| **C. Hybrid** | PostgreSQL for ledger/tenancy; MongoDB for catalogue/documents/telemetry (added operational complexity) |

No schema, migration or database provisioning will occur until this decision is recorded in
`07-open-questions-risks.md`.

---

## 6. Inventory transaction design (database-agnostic)

### 6.1 Core concepts

| Concept | Rule |
|---|---|
| **Stock movement** | Immutable; never updated or deleted. Corrections are counter-entries linked to the original. |
| **Balance** | Derived projection per company/item/location/lot/serial: on-hand, reserved, in-transit, version. |
| **Available** | `on_hand − reserved`. Computed consistently; may be persisted for guarded updates. |
| **Reservation** | Holds quantity without changing on-hand; consumed by issue or released. |
| **Allocation** | Links reservations/issues/returns to a project, machine, work order or department. |
| **Idempotency** | Unique key per client operation; repeated submission returns the original result. |
| **Audit** | Every mutation records actor, device, time, before/after, reason, source document. |

### 6.2 Invariants

1. Sum of movements for an item/location equals its on-hand balance (reconcilable).
2. `reserved ≥ 0`; `on_hand ≥ 0` unless negative-stock policy allows and records a reason.
3. `reserved ≤ on_hand` for the same item/location/lot.
4. A serial exists in at most one active location/state at a time.
5. A reservation cannot be consumed twice.
6. A posted movement cannot be edited; only reversed.
7. Every movement has a source document and an actor.
8. `occurred_at` (business time) and `recorded_at` (system time) are both stored.

### 6.3 Posting sequence (conceptual)

1. Validate request shape, permissions, tenant, location scope.
2. Check idempotency key; return prior result if present.
3. Load and lock/atomically guard the relevant balance(s).
4. Validate domain rules: availability, lot/serial, expiry, negative-stock policy, approval.
5. Write movement(s).
6. Update balance projection(s) and reservation(s).
7. Write audit event and outbox event in the same transaction.
8. Commit; return canonical document with new balances and version.
9. On conflict: roll back, return a structured conflict (not a generic 500).

### 6.4 Costing

- Phase 1: store unit cost and support simple valuation (standard/last cost).
- Later: FIFO layers and weighted average, with explicit cost movements.
- Cost visibility is permission-gated; cost data is excluded from operator responses by default.

### 6.5 UOM

- Store the entered quantity/UOM and the converted base quantity.
- Conversion factors are company-defined and versioned; movements retain the factor used.
- Prevent unit changes that would reinterpret historical movements.

---

## 7. Multi-tenancy

### 7.1 Options

| Model | Isolation | Cost | Migration complexity | Recommendation |
|---|---|---|---|---|
| Shared schema + `company_id` + RLS (PostgreSQL) | Strong if enforced | Low | Low | Preferred for SaaS |
| Shared collections + app-enforced `company_id` (MongoDB) | Depends on discipline | Low | Low | Viable with tests |
| Schema-per-tenant (PostgreSQL) | Stronger | Medium | High (many schemas) | Enterprise option |
| Database-per-tenant | Strongest | High | High | Enterprise/regulated option |

### 7.2 Requirements regardless of database

- Tenant context derived from the authenticated session, never from a client-supplied header alone.
- Every query filtered by tenant at the data-access layer; deny-by-default.
- Composite indexes begin with `company_id`.
- File keys, cache keys, job payloads and search indexes include tenant.
- Cross-tenant access tests in CI, including IDOR attempts on every object route.
- Support/impersonation is explicit, time-bound, consented, and audited.
- Tenant deletion/export workflow.

---

## 8. Offline synchronisation design

### 8.1 Two classes of offline work

| Class | Definition | Examples | Commit authority |
|---|---|---|---|
| **Safe draft** | Captured locally, no stock authority | Receipt draft, issue draft, transfer draft, return draft, count lines, new item draft, damage report, reservation request | Server on sync |
| **Server-validated transaction** | Requires authoritative checks | Issue commit, transfer dispatch, reservation confirm, adjustment post, count approval, negative-stock override, serial/lot validation | Server only |

**UI rule:** a draft is never shown as stock movement. It is "Queued — not yet applied."

### 8.2 Client data model (conceptual)

- `local_entities`: cached company, items, locations, balances, projects, permissions (with `fetched_at`).
- `drafts`: editable operations with validation state.
- `outbox`: ordered operations with `client_operation_id`, `idempotency_key`, `aggregate_type`,
  `aggregate_id`, `payload`, `state`, `attempts`, `last_error`.
- `conflicts`: server response + local snapshot + resolution state.
- `sync_state`: cursor, last successful push/pull, device ID.

### 8.3 Protocol

1. **Capture:** validate locally, save draft, enqueue on submit.
2. **Push:** batch by aggregate; include idempotency key and base version (if applicable).
3. **Server:** authenticate → authorize → validate → apply transaction → audit → return canonical
   result + new version.
4. **Ack:** mark applied, update cache, remove payload (keep audit metadata).
5. **Pull:** fetch changes since cursor (movements, balances, item changes, approvals).
6. **Conflict:** store both versions; notify; never auto-merge stock.

### 8.4 Ordering and consistency

- Preserve order per aggregate (item/location/project).
- Do not assume cross-aggregate order.
- Server timestamps are authoritative; device time is recorded but not trusted for ordering.
- Use monotonic server versions/cursors.
- Reject operations based on stale base versions when the domain requires it.

### 8.5 Conflict taxonomy

| Type | Detection | Resolution |
|---|---|---|
| Duplicate retry | Idempotency key exists | Return original result |
| Insufficient stock | Server availability check | Reduce, transfer, cancel, or override (privileged) |
| Stale entity | Version/ETag mismatch | Show diff; accept server or reapply |
| Reservation lost | Reservation consumed/expired | Re-reserve or cancel |
| Serial/lot conflict | Uniqueness/expiry rule | Choose another or escalate |
| Permission changed | 403 at sync | Re-authenticate; operation rejected |
| Validation drift | Schema/custom field changed | Show field error; edit and retry |

### 8.6 Security of offline data

- Encrypted local database; tokens in secure storage.
- Offline session limited (e.g., 7 days) and revocable.
- Remote sign-out invalidates refresh tokens; local cache cleared on next launch.
- No sensitive attachments left unencrypted.
- Device binding and anomaly detection (optional).

---

## 9. Security architecture

### 9.1 Threat model (initial)

| Threat | Control |
|---|---|
| Stolen/unlocked device | Biometric lock, encrypted DB, short session, remote revoke |
| Token theft/replay | Short-lived access tokens, refresh rotation, device binding, TLS |
| Cross-tenant access (IDOR) | Tenant-scoped queries/RLS, object-level authorization, tests |
| Privilege escalation | Capability checks server-side, segregation of duties, audit |
| Malicious offline payload | Server validation, schema checks, no client trust |
| Injection | Parameterised queries, validation, output encoding |
| File upload abuse | Type/size limits, scanning, private buckets, signed URLs |
| Insider misuse | Least privilege, audit, approval thresholds, export controls |
| Brute force | Rate limits, lockouts, MFA for admins |
| Secret leakage | Secrets only server-side; mobile config contains public identifiers only |

### 9.2 Authentication and authorization

- OAuth2-style flows with short-lived JWT access tokens and rotating refresh tokens.
- Email/phone OTP; password optional per policy; MFA for owners/admins.
- Device registration; session list; sign-out all.
- RBAC with atomic capabilities; location scoping; server-side enforcement.
- Support access requires explicit, time-bound consent and is audited.

### 9.3 Data protection

- TLS 1.2+ in transit; HSTS at the edge.
- Encryption at rest for database, object storage and backups.
- Field-level encryption for highly sensitive data if required.
- Data minimisation: no unnecessary personal data.
- Signed URLs with short expiry.
- Secure deletion and tenant export.

### 9.4 Compliance (India-first)

- Digital Personal Data Protection Act (DPDP) readiness: notice, consent, purpose limitation, retention,
  breach process, data principal rights.
- Data residency options: India region preferred for Indian customers.
- Audit retention configurable; legal hold capability later.
- SOC 2 / ISO 27001 are **future** goals, not launch claims.

---

## 10. Observability and operations

### 10.1 Telemetry

- Structured JSON logs with request/tenant/user IDs (no secrets or payloads).
- Metrics: request rate/latency/errors, DB latency, queue depth, sync success/conflict, push failures,
  import/export duration.
- Distributed tracing with OpenTelemetry.
- Mobile crash/error reporting (Sentry or equivalent) with redaction.
- Dashboards: API health, stock commit latency, conflict rate, offline backlog, tenant usage.
- Alerts: error budget burn, DB saturation, sync failure spike, backup failure.

### 10.2 Backup and recovery

- Automated daily backups + PITR where supported.
- Encrypted backups in a separate region/account.
- Restore drills quarterly; documented RTO/RPO.
- Tenant-level restore procedure (or documented compensating export).
- Migration rollback plan.

### 10.3 Environments

- Local → CI → staging → production.
- Seed data isolated and labelled; no production data in non-production.
- Feature flags for gradual rollout.
- Blue/green or rolling deploys; backward-compatible migrations.

---

## 11. Testing strategy

| Layer | Approach |
|---|---|
| Domain/unit | Pure TS/Python tests for quantities, UOM, reservations, permissions |
| Property-based | Ledger invariants: sum of movements = balance; reserved ≤ on-hand; no double consume |
| Integration | API + real database (containerised); transaction/concurrency tests |
| Concurrency | Parallel receive/issue/reserve tests with deterministic assertions |
| Offline/sync | Simulated network loss, duplicate delivery, reordering, conflict |
| Multi-tenant | Automated cross-tenant access attempts on every route |
| Contract | OpenAPI schema validation; generated client compatibility |
| Mobile unit | Repositories, validation, sync state machine |
| Mobile E2E | Maestro/Detox for scan, receive, issue, count, sync, admin |
| Load | k6/Locust for stock commit, list, reports at target volumes |
| Security | Dependency scanning, SAST, secret scanning, authz tests |
| Accessibility | Screen-reader and contrast checks; manual device testing |
| Device matrix | Low-end Android, mid-range Android, iPhone, tablet, poor network |

**Definition of done for inventory features:** concurrency tests and offline/conflict tests pass.

---

## 12. CI/CD

- GitHub Actions: lint, typecheck, unit, integration, build.
- Backend: container image, migration check, staging deploy, smoke tests.
- Mobile: EAS Build (or equivalent), internal track, staged rollout.
- Versioned API and mobile compatibility policy.
- Database migrations reviewed and reversible where feasible.
- Secrets in managed secret storage, never in the repo.

---

## 13. Architecture decision records (proposed)

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | React Native + TypeScript for mobile | Accepted by NTAN direction |
| ADR-002 | Expo development builds + prebuild (not Expo Go) | Proposed |
| ADR-003 | FastAPI modular monolith for initial backend | Proposed |
| ADR-004 | Primary database: MongoDB vs PostgreSQL | **OPEN — NTAN approval required** |
| ADR-005 | Immutable stock ledger + balance projection | Proposed |
| ADR-006 | Offline drafts; server-authoritative stock commits | Proposed |
| ADR-007 | Shared-schema multi-tenancy with enforced isolation | Proposed (implementation depends on DB) |
| ADR-008 | JWT access + rotating refresh, device binding, MFA for admins | Proposed |
| ADR-009 | REST/JSON API with idempotency keys and cursor pagination | Proposed |
| ADR-010 | Object storage with signed URLs for files | Proposed |
| ADR-011 | Transactional outbox for domain events | Proposed |
| ADR-012 | Read models/materialised views for reporting | Proposed |

---

## 14. What must be true before implementation

1. Database decision recorded and approved.
2. Tenancy isolation model approved.
3. Offline scope (which operations) approved.
4. Security/compliance expectations (DPDP, residency) confirmed.
5. Device/OS baseline confirmed from design partners.
6. Scanning performance validated on target devices.
7. Hosting/cloud budget and region approved.
8. Support and incident-response ownership defined.

No code, schema or infrastructure is created in Phase 0.
