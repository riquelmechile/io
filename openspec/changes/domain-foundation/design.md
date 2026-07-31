# Design: Domain Foundation

## Technical Approach

Create `packages/business-domain/` (transitional, mirrors trust-kernel) holding pure domain types, state machine transitions, async repository ports, and in-memory fakes. Add 4 PG-backed adapters to `packages/database/src/` implementing those ports over the existing `DbConnection`. SQL schema in `002_create_business_tables.sql`. No existing source modified except tsconfig includes and database `package.json`/`index.ts` exports.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|-------------|-----------|
| D1 | Package placement | `packages/business-domain/` | Inline into trust-kernel; separate per-type packages | `packages/*` glob auto-discovers; mirrors trust-kernel transitional pattern (private, ESM, zero deps); isolates business domain from authority evaluation |
| D2 | Type purity | `import type` only, zero runtime deps | Import PrincipalId from trust-kernel | Business domain ≠ authority evaluation; separate aggregates per ADR-0002; plain `string` for all ID references keeps package self-contained |
| D3 | Cross-aggregate refs | Neutral string IDs (`workId`, `delegationId`) | Object references; type-level FK enforcement | ADR-0002: "receiving a task never grants ambient authority"; aggregates don't import each other; refs resolved by application layer |
| D4 | State machines | Transition table + `canTransition()` guard functions | Enum-based pattern; XState | Matches existing `validateBoundedWindow`/`checkGrant` pattern; pure functions, no framework, zero deps |
| D5 | SQL per-adapter | Inline SQL in each adapter (not shared builder) | Extend `sql.ts` generic builder | Each business type has a unique column set (unlike evidence/audit which share `PersistentRecord`); inline is clearer and avoids over-abstraction |
| D6 | Nested fields storage | JSONB columns | Normalized child tables | `authorityScope`, `budget`, `deliverable`, `evidenceRefs` are read-at-once value objects; no join query patterns justify child tables |

## Codebase Verification

### Package placement (D1)

| Config | Pattern | Auto-discover? | Action |
|--------|---------|---------------|--------|
| `pnpm-workspace.yaml` | `packages: ['packages/*']` | YES — glob matches any dir under `packages/` | None |
| `vitest.config.ts` | `include: ['packages/**/test/**/*.test.ts']` | YES — glob matches any package test dir | None |
| `tsconfig.json` | Explicit: `packages/trust-kernel/**/*.ts`, `packages/database/**/*.ts` | NO — explicit paths | **Add** `packages/business-domain/**/*.ts` |
| `tsconfig.build.json` | Explicit: `packages/trust-kernel/src/**/*.ts`, `packages/database/src/**/*.ts` | NO — explicit paths | **Add** `packages/business-domain/src/**/*.ts` |

### Transitional package pattern (from `@io/trust-kernel`)

```json
{
  "name": "@io/business-domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Transitional pure domain types: Company, Delegation, Work, BusinessReceipt. Not a canonical package."
}
```

Zero `dependencies`. Zero `devDependencies`. Mirrors trust-kernel exactly.

### Database dependency pattern (from `@io/database`)

```json
"devDependencies": {
  "@io/trust-kernel": "workspace:*",
  "@io/business-domain": "workspace:*"
}
```

`@io/business-domain` is `devDependencies` because adapters import types only (`import type` — erased by tsc, zero runtime cost). Matches the existing `@io/trust-kernel` devDependency.

## Interfaces / Contracts

### Domain Types (`packages/business-domain/src/types.ts`)

```typescript
// ── Company (minimal: identity + scope, architecture doc §4) ──
export interface Company {
  readonly companyId: string;
  readonly purpose: string;
}

// ── Delegation (ADR-0002: authority commitment) ──
export type DelegationState = 'draft' | 'active' | 'revoked' | 'expired';

export interface AuthorityScope {
  readonly scope: string;
  readonly actions: readonly string[];
}

export interface Budget {
  readonly currency: string;
  readonly limit: number;
}

export interface Delegation {
  readonly delegationId: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly authorityScope: AuthorityScope;
  readonly budget: Budget;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly expectedOutcome: string;
  readonly state: DelegationState;
}

// ── Work (ADR-0002: execution, separate from authority) ──
export type WorkState =
  | 'proposed' | 'accepted' | 'in_progress'
  | 'completed' | 'verified' | 'rejected';

export interface Deliverable {
  readonly description: string;
  readonly format?: string;
}

export interface WorkOutcome {
  readonly result: string;
  readonly success: boolean;
}

export interface Work {
  readonly workId: string;
  readonly delegationId: string;
  readonly proposer: string;
  readonly description: string;
  readonly state: WorkState;
  readonly deliverable?: Deliverable;
  readonly evidenceRefs: readonly string[];
  readonly outcome?: WorkOutcome;
}

// ── BusinessReceipt (immutable, persisted; ≠ UnsignedInMemoryReceipt) ──
export interface BusinessReceipt {
  readonly receiptId: string;
  readonly workId: string;
  readonly delegationId: string;
  readonly actor: string;
  readonly policyHash: string;
  readonly evidenceRefs: readonly string[];
  readonly terminalState: string;
  readonly artifactHash: string;
  readonly issuedAt: number;
}
```

### State Machine Transitions (`packages/business-domain/src/transitions.ts`)

```typescript
// Delegation: draft → active → revoked | expired
const DELEGATION_TRANSITIONS: Readonly<Record<DelegationState, readonly DelegationState[]>> = {
  draft:   ['active'],
  active:  ['revoked', 'expired'],
  revoked: [],
  expired: [],
};

// Work: proposed → accepted → in_progress → completed → verified | rejected
const WORK_TRANSITIONS: Readonly<Record<WorkState, readonly WorkState[]>> = {
  proposed:    ['accepted', 'rejected'],
  accepted:    ['in_progress'],
  in_progress: ['completed'],
  completed:   ['verified', 'rejected'],
  verified:    [],
  rejected:    [],
};

export function canTransitionDelegation(from: DelegationState, to: DelegationState): boolean;
export function canTransitionWork(from: WorkState, to: WorkState): boolean;
```

### Repository Ports (`packages/business-domain/src/ports/repositories.ts`)

Follows `EvidenceRepository`/`AuditRepository` pattern: async, driver-free, generic.

```typescript
export interface CompanyRepository {
  save(company: Company): Promise<Readonly<Company>>;
  get(companyId: string): Promise<Company | undefined>;
}

export interface DelegationRepository {
  save(delegation: Delegation): Promise<Readonly<Delegation>>;
  get(delegationId: string): Promise<Delegation | undefined>;
}

export interface WorkRepository {
  save(work: Work): Promise<Readonly<Work>>;
  get(workId: string): Promise<Work | undefined>;
}

export interface BusinessReceiptRepository {
  save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>>;
  get(receiptId: string): Promise<BusinessReceipt | undefined>;
}
```

### In-Memory Fakes (`packages/business-domain/src/ports/fakes.ts`)

Map-backed, same pattern as `InMemoryEvidenceRepository`. One class per port: `InMemoryCompanyRepository`, `InMemoryDelegationRepository`, `InMemoryWorkRepository`, `InMemoryBusinessReceiptRepository`. All methods async (return `Promise`), in-memory storage, instant resolution.

### PG Adapter Pattern (each adapter in `packages/database/src/`)

Each adapter follows `PgEvidenceRepository`:

```typescript
export class PgDelegationRepository implements DelegationRepository {
  constructor(private readonly conn: DbConnection) {}

  async save(delegation: Delegation): Promise<Readonly<Delegation>> {
    await this.conn.execute(
      'INSERT INTO delegation (delegation_id, delegator, delegate, authority_scope, budget, ' +
      'valid_from, valid_until, expected_outcome, state, created_at) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [delegation.delegationId, delegation.delegator, delegation.delegate,
       delegation.authorityScope, delegation.budget,
       delegation.validFrom, delegation.validUntil, delegation.expectedOutcome,
       delegation.state, Date.now()],
    );
    return delegation;
  }

  async get(delegationId: string): Promise<Delegation | undefined> {
    const rows = await this.conn.query<Delegation>(
      'SELECT delegation_id AS "delegationId", delegator, delegate, ' +
      'authority_scope AS "authorityScope", budget, ' +
      'valid_from AS "validFrom", valid_until AS "validUntil", ' +
      'expected_outcome AS "expectedOutcome", state ' +
      'FROM delegation WHERE delegation_id = $1',
      [delegationId],
    );
    return rows[0];
  }
}
```

Key adapter rules:
- `created_at` is adapter-managed (`Date.now()` on INSERT), not in the domain type, not in SELECT aliases
- JSONB columns (`authorityScope`, `budget`, `deliverable`, `evidenceRefs`, `outcome`) pass objects directly as params; `pg` serializes to JSON on write, deserializes on read
- Nullable JSONB (`deliverable`, `outcome`) → adapter converts `null` → `undefined` on get
- `$N` positional placeholders; `AS "camelCase"` column aliases on SELECT

### SQL Schema DDL (`packages/database/sql/002_create_business_tables.sql`)

```sql
-- Idempotent CREATE TABLE IF NOT EXISTS, targeting PostgreSQL 18.4.
-- snake_case columns map to camelCase domain fields via AS aliases in adapters.

CREATE TABLE IF NOT EXISTS company (
  id          SERIAL PRIMARY KEY,
  company_id  TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_company_id ON company (company_id);

CREATE TABLE IF NOT EXISTS delegation (
  id               SERIAL PRIMARY KEY,
  delegation_id    TEXT NOT NULL,
  delegator        TEXT NOT NULL,
  delegate         TEXT NOT NULL,
  authority_scope  JSONB NOT NULL,
  budget           JSONB NOT NULL,
  valid_from       BIGINT NOT NULL,
  valid_until      BIGINT NOT NULL,
  expected_outcome TEXT NOT NULL,
  state            TEXT NOT NULL,
  created_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegation_delegation_id ON delegation (delegation_id);

CREATE TABLE IF NOT EXISTS work (
  id            SERIAL PRIMARY KEY,
  work_id       TEXT NOT NULL,
  delegation_id TEXT NOT NULL,
  proposer      TEXT NOT NULL,
  description   TEXT NOT NULL,
  state         TEXT NOT NULL,
  deliverable   JSONB,
  evidence_refs JSONB NOT NULL,
  outcome       JSONB,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_work_id ON work (work_id);
CREATE INDEX IF NOT EXISTS idx_work_delegation_id ON work (delegation_id);

CREATE TABLE IF NOT EXISTS business_receipt (
  id             SERIAL PRIMARY KEY,
  receipt_id     TEXT NOT NULL,
  work_id        TEXT NOT NULL,
  delegation_id  TEXT NOT NULL,
  actor          TEXT NOT NULL,
  policy_hash    TEXT NOT NULL,
  evidence_refs  JSONB NOT NULL,
  terminal_state TEXT NOT NULL,
  artifact_hash  TEXT NOT NULL,
  issued_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_business_receipt_receipt_id ON business_receipt (receipt_id);
CREATE INDEX IF NOT EXISTS idx_business_receipt_work_id ON business_receipt (work_id);
```

## Data Flow

```
Application Layer
    │
    ├──→ Company ──→ CompanyRepository ──┐
    ├──→ Delegation ──→ DelegationRepository ──┤
    │        │                                ├──→ InMemoryFake (unit tests)
    │   canTransitionDelegation()             │
    │                                         ├──→ PgXxxRepository ──→ DbConnection ──→ PostgreSQL
    ├──→ Work ──→ WorkRepository ─────────────┤     (port)
    │    │                                    │
    │   canTransitionWork()                   │
    │                                         │
    └──→ BusinessReceipt ──→ BusinessReceiptRepository ─┘
                              (immutable, write-once)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/business-domain/package.json` | Create | Transitional package manifest (private, ESM, zero deps) |
| `packages/business-domain/src/types.ts` | Create | 4 domain types + value types + state unions |
| `packages/business-domain/src/transitions.ts` | Create | Transition tables + `canTransition` functions |
| `packages/business-domain/src/ports/repositories.ts` | Create | 4 async repository port interfaces |
| `packages/business-domain/src/ports/fakes.ts` | Create | 4 in-memory fake repositories |
| `packages/business-domain/src/index.ts` | Create | Public exports (types + transitions + ports + fakes) |
| `packages/business-domain/test/transitions.test.ts` | Create | State machine transition tests (all valid paths ALLOW, invalid REJECT) |
| `packages/business-domain/test/fakes.test.ts` | Create | Fake repository save→get round-trip for all 4 types |
| `packages/database/src/company-adapter.ts` | Create | `PgCompanyRepository` |
| `packages/database/src/delegation-adapter.ts` | Create | `PgDelegationRepository` |
| `packages/database/src/work-adapter.ts` | Create | `PgWorkRepository` |
| `packages/database/src/business-receipt-adapter.ts` | Create | `PgBusinessReceiptRepository` |
| `packages/database/src/index.ts` | Modify | Export 4 new adapters |
| `packages/database/sql/002_create_business_tables.sql` | Create | DDL for 4 tables + indices |
| `packages/database/package.json` | Modify | Add `@io/business-domain` workspace devDependency |
| `packages/database/test/business-adapters.test.ts` | Create | Adapter unit tests with `InMemoryDbConnection` (SQL shape + round-trip) |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Create | Real PG round-trip for all 4 types |
| `tsconfig.json` | Modify | Add `packages/business-domain/**/*.ts` to `include` |
| `tsconfig.build.json` | Modify | Add `packages/business-domain/src/**/*.ts` to `include` |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | State machine transitions | Table-driven: every valid transition returns `true`, every invalid returns `false`; terminal states reject all transitions |
| Unit | Fake repository round-trips | `save()` → `get()` → assert field-level equality for all 4 types; `get()` unknown ID → `undefined` |
| Unit | PG adapter SQL shape | `InMemoryDbConnection` records SQL + params; assert exact `$N` binding order and `AS "camelCase"` aliases |
| Unit | PG adapter round-trip (fake) | `save()` → `get()` through `InMemoryDbConnection`; assert field-level equality including JSONB objects |
| Integration | Real PG round-trip | `PgDbConnection` to live PostgreSQL 18.4; apply schema DDL; `save()` → `get()` for all 4 types; TRUNCATE isolation per test; skip suite when PG unreachable |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. DDL is `CREATE TABLE IF NOT EXISTS` (idempotent). Rollback: delete `packages/business-domain/`, remove 4 adapter files + SQL from `packages/database/`, revert `tsconfig.json`/`tsconfig.build.json`/`database/package.json`/`database/index.ts` changes, `DROP TABLE company, delegation, work, business_receipt`. No existing source code is modified.

## Open Questions

None. All four design considerations from the proposal are resolved.
