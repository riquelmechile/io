# Design: Harden First Enterprise Vertical Foundation

## Technical Approach

Close PASOS 1.1–1.7 on `120ec33` via stacked PRs A→B→C (RED→GREEN, `pnpm test`). No vertical/`app`/`llm-client` reopen. Keep five forbidden-coupling invariants.

## Architecture Decisions

### D1 — `transaction(fn)` (Q1)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T>` | Shared execute/query | **Choose** |
| Nested savepoints | Fake complexity | **Forbid** (throws) |

**Port** (`connection.ts` L40–42) adds signature above. **PG**: `pool.connect()`→`BEGIN`→tx-scoped `{execute,query,transaction:rejectNested}`→`fn`→`COMMIT`+release; throw→`ROLLBACK`+release+rethrow. **Fake**: snapshot `tables`+`idCounters`; success keeps; throw restores+rethrows; still `PERSISTENT_PORT_DISCLOSURE`. Adapters take `conn` from `fn`.

**Checked-out-client error handling (Slice B correction)**: pg-pool strips the idle `error` listener on acquire, so for the tx lifetime `transaction` attaches its own `client.on('error')` capture (removed in `finally`) and releases WITH any captured error so the pool discards a broken client — mirroring R4-001 for checked-out (not just idle) clients; the tx still rejects but with NO uncaughtException. `ROLLBACK` is wrapped in its own try/catch so a rollback failure can never replace fn's ORIGINAL error (error fidelity).

### D2 — proposer ≠ approver (Q2)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `['proposer','approver']` in `ABSOLUTE_PAIRS` | All tiers incl. low+policy | **Choose** (ADR-0003) |
| Low-combination only | Self-approve hole | Reject |

**Code** (`sod.ts:35–38`): append pair. `requiredDistinctRoles` unchanged. Low+`allowsLowCombination` still hits ABSOLUTE_PAIRS (L79–86)→DENY. Delta=low+policy. RED first.

### D3 — Use cases (Q3)

```
business-domain/src/use-cases/
  result.ts | propose|accept|start|complete|verify|reject-work.ts | index.ts
```

`async function xWork(cmd, deps): Promise<UseCaseResult<Work>>` — cmd `{ companyId, actor, workId?, expectedVersion?, idempotencyKey?, requestHash?, … }`; deps=ports only (zero `@io/*`); result `{ ok:true, value } | { ok:false, reason, current? }` (no throw-for-control-flow). `save()`=insert/internals; transitions=use cases (get+CAS); demote raw `save`.

### D4 — Versioning (Q4)

Numeric `version` (not `updatedAt`). Init **1**; bump **+1** on CAS success. `UPDATE work SET …, version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3` → 0 rows ⇒ `{ ok:false, reason:'version-conflict', current?: Work }`. Fake compares version (no overwrite). Port: `updateIfVersion`; `save` insert-only for new Work.

### D5 — terminal_event_id (Q5)

Journal `attempt_id` = terminal event on `business_receipt.terminal_event_id`. No separate event table. `UNIQUE (work_id, terminal_event_id)`; `attempt_id` globally UNIQUE.

### D6 — Idempotency (Q6)

key+same hash→replay; key+diff hash→DENY `idempotency-conflict`; new key→attempt→effect→complete. Journal in 003. One tx: lookup→`in_flight`(pre-effect)→CAS→receipt(`terminal_event_id=attempt_id`)→journal complete. Throw⇒full rollback/snapshot.

### D7 — Runtime-validation (Q7)

| Guard | Owner |
|-------|-------|
| Command | `business-domain/src/validation/command.ts` |
| LLM plan plain shape | `business-domain/src/validation/llm-plan.ts` |
| PG rows | `database/src/row-guards.ts` |

`parseX(unknown)→{ok:true,value}|{ok:false,reason}`. LLM: plain `LlmPlanShape` `{steps:{action,args}[],intent?}`; caller JSON-parses outside; no `LlmClient` import. NEW `runtime-validation` capability.

### D8 — evidenceId (Q8)

Kernel stays `actionId`-keyed. Business: `ev:${companyId}:${idempotencyKey}` (or hash companyId|intent|key). Not actionId/nonce/now.

## Atomic Terminal Flow

```
UseCase → transaction(tx =>
  journal.lookup → replay|DENY|cont
  → insert(in_flight) → updateIfVersion
  → receipt(terminal_event_id=attempt_id) → journal.complete)
```

## Data Model (003 + 004)

Split into two additive, idempotent migrations. **003 travels with Slice A** —
the columns its adapters already read/write (`company_id` ×3, `version`); this is
the coherence fix found during live-PG verification (adapters landed in A, the
columns were originally planned for B). **004 travels with Slice B** — the
constraints (`terminal_event_id`, all UNIQUE indexes, `idempotency_journal`).
004's column additions use `IF NOT EXISTS`, so they are safe after 003.

```sql
-- database/sql/003_harden_columns.sql (Slice A: additive columns the adapters read/write)
ALTER TABLE delegation ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE work ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE work ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE business_receipt ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
```

```sql
-- database/sql/004_harden_constraints.sql (Slice B: terminal_event_id + UNIQUE + journal)
ALTER TABLE business_receipt ADD COLUMN IF NOT EXISTS terminal_event_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_company_id ON company (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delegation_delegation_id ON delegation (delegation_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_work_id ON work (work_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_receipt_id ON business_receipt (receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_work_terminal ON business_receipt (work_id, terminal_event_id);
CREATE TABLE IF NOT EXISTS idempotency_journal (
  id SERIAL PRIMARY KEY, company_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, attempt_id TEXT NOT NULL, status TEXT NOT NULL,
  result_json JSONB, created_at BIGINT NOT NULL,
  UNIQUE (company_id, idempotency_key), UNIQUE (attempt_id));
```

Types: Delegation/Work/BusinessReceipt +`companyId`; Work +`version`.

## Forbidden Coupling

1. Neutral IDs. 2. Domain zero `@io/*`. 3. `openai` only in `deepseek-client.ts`. 4. LLM plan non-authority. 5. No agentic frameworks.

## Slice Mapping

| Slice | Surfaces |
|-------|----------|
| **A** | D2 sod; `isWindowActive`→grant/identity/expiryGate; honest deferred steps; companyId+scoped get; 003 columns |
| **B** | D1 tx; D4 CAS; D5 UNIQUE/terminal; 004 constraints; fake UPDATE |
| **C** | D3–D8 use-cases/journal/guards; hygiene; CI-PG visible |

## File Changes

| File | Action |
|------|--------|
| `trust-kernel/src/{sod,model,grant,identity,pipeline}.ts` | Modify |
| `business-domain/src/{types,ports/*,index,use-cases/*,validation/*}` | Modify/Create |
| `database/src/{connection,pg-connection,*-adapter,row-guards}.ts`, fake, `sql/003_*.sql`, `sql/004_*.sql` | Modify/Create |
| Tests + hygiene | Create/Modify |

## Interfaces

```ts
type CasResult = { ok:true; value:Work } | { ok:false; reason:'version-conflict'; current?:Work };
function isWindowActive(start: number, now: number, expiry: number): boolean; // start<=now<expiry
```

## Testing Strategy

| Slice | Focus |
|-------|-------|
| A | SoD all tiers; future-start inactive; scope; deferred honesty; boundaries green |
| B | tx PG+fake; nested throw; concurrent CAS; UNIQUE dups |
| C | 6 transitions; idemp replay/deny; atomic no partial; guards reject; domain pure |

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/process boundary.

## Migration / Rollout

Greenfield. Per-slice revertible → `120ec33`.

## Residual Risks

| Risk | Sev | Note |
|------|-----|------|
| Fake UPDATE+tx for CAS | Med | Extend fake in B |
| Slice C vs 400-line budget | Med | Thin files; stacked PRs |

## Open Questions

None. Spec/tasks: nested tx forbidden; absolute SoD pair; version init 1 + conflict; journal + `UNIQUE(work_id,terminal_event_id)`; LLM plain shape; evidenceId=`companyId`+key.
