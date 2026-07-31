# Design: Wire Live PostgreSQL

## Technical Approach

Resolve the CRITICAL sync/async debt (deferred in `archive/2026-07-30-add-postgres-adapter`)
by making the kernel persistence ports and the `DbConnection` port **async** (Option 1 from
exploration). The `pg` driver is TCP-based and fundamentally async; a sync bridge is a lie about
completion. Once ports return `Promise<>`, a real `PgDbConnection` over `pg.Pool` is honest, and
records persist to PostgreSQL 18.4. SQL lives ONLY in the existing adapters — unchanged. This is
the seam the prior design named. Kernel stays **driver-free** (`pg` never crosses into
`trust-kernel`); only `packages/database/` gains the runtime dependency.

## Architecture Decisions

| # | Decision | Choice | Alternatives / rationale |
|---|---|---|---|
| D1 | Sync vs async ports | **Async** (`Promise<>`) | Sync-bridge (Option 2) rejected: no sync TCP in Node.js; `Atomics.wait`/`execSync` block the loop or lose parameterization. Async is the only honest path. |
| D2 | Driver abstraction | `pg.Pool` behind `DbConnection` | Single `pg.Client` rejected: no connection reuse; hand-rolled pooling rejected: `pg.Pool` is battle-tested. |
| D3 | Schema location | `packages/database/sql/*.sql` applied via connection | ORM/migration-runner rejected (out of scope, config rule: first-party only). DDL run through `execute()` keeps zero subprocess surface. |
| D4 | `pg` dependency boundary | `dependencies: { pg }` in `@io/database` ONLY | Kernel gains nothing — `pg` never imports into `trust-kernel`. Kernel coupling stays `import type`-only. |
| D5 | `DbSession` / transactions | **Still deferred** | Single-statement ops only this slice; `EvidenceRepository<R,S>` keeps `S = unknown` default. |
| D6 | Pool lifecycle | Lazy `Pool`; `close()` on `PgDbConnection`, NOT on the port | Lifecycle stays outside the port so fakes need no `close`. |
| D7 | Column mapping | Existing snake_case DDL + `AS "camelCase"` aliases (unchanged) | A separate mapper fn rejected: the `sql.ts` aliasing already shapes rows into `PersistentRecord`. |
| D8 | Integration toggle | `integration: true` in config.yaml | Feature-gates the real-PG test behind a running container; unit suite stays PG-free via fakes. |

## Data Flow

```text
evaluate(input) : Promise<EvaluationResult>           @io/trust-kernel
   └─ finalize() ─await─► routeThroughPorts()
                              ├─ await evidenceRepo.save(rec)  ──┐
                              └─ await auditRepo.append(rec)    │ Promise<>
                                                                    │
   PgEvidenceRepository / PgAuditRepository  ◄── implements ──────┘   @io/database
        └─ await conn.execute(...) / await conn.query(...)
                                     │
                          PgDbConnection (pg.Pool) ──TCP──► PostgreSQL 18.4
```

Kernel arrows are pure type contracts; the only runtime dep (`pg`) lives in `@io/database`.

## Async Migration Plan

### Method-by-method signature changes

| Interface | Method | Before (sync) | After (async) |
|---|---|---|---|
| `EvidenceRepository` | `save` | `save(r, s?): Readonly<R>` | `save(r, s?): Promise<Readonly<R>>` |
| `EvidenceRepository` | `get` | `get(id): R \| undefined` | `get(id): Promise<R \| undefined>` |
| `AuditRepository` | `append` | `append(r): readonly R[]` | `append(r): Promise<readonly R[]>` |
| `AuditRepository` | `getLog` | `getLog(): readonly R[]` | `getLog(): Promise<readonly R[]>` |
| `DbConnection` | `execute` | `execute(sql,p): unknown` | `execute(sql,p): Promise<unknown>` |
| `DbConnection` | `query` | `query<T>(sql,p): readonly T[]` | `query<T>(sql,p): Promise<readonly T[]>` |
| `pipeline` | `evaluate` | `evaluate(i): EvaluationResult` | `evaluate(i): Promise<EvaluationResult>` |
| `pipeline` | `finalize` | (internal, sync) | `async` — `await routeThroughPorts(...)` |
| `pipeline` | `routeThroughPorts` | (internal, sync) | `async` — `await save()` / `await append()` |

### Blast radius

- **`pipeline.ts`**: `evaluate`/`finalize`/`routeThroughPorts` → `async`. `evaluate()` has **9
  `return finalize(...)` call sites** — already return-statement-shaped, so they need no `await`
  (returning a `Promise` from an async fn is correct); only the signatures + the two `await`s
  inside `routeThroughPorts` change.
- **3 in-memory impls** (`fakes.ts`, `connection-fake.ts`): mark `async`; bodies unchanged
  (instant, no I/O).
- **Adapters** (`evidence-adapter.ts`, `audit-adapter.ts`): mark `save`/`get`/`append`/`getLog`
  `async`, `await` the `conn.execute/query`. SQL builders in `sql.ts` untouched.
- **Test call sites**: 25 `evaluate()` calls (`pipeline.test.ts`=12, `ports.test.ts`=13) gain
  `await`; ~25 adapter method calls in `evidence-adapter.test.ts`/`audit-adapter.test.ts` gain
  `await`. **tsc catches every missing `await`** (HIGH-risk/LOW-effort per proposal).

## PgDbConnection

```ts
import { Pool } from 'pg';
import type { DbConnection } from './connection.js';

export class PgDbConnection implements DbConnection {
  private pool?: Pool;                       // D6: lazy — no connection at construction
  constructor(private readonly connectionString: string) {}

  private getPool(): Pool {
    if (!this.pool) this.pool = new Pool({ connectionString: this.connectionString });
    return this.pool;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    await this.getPool().query(sql, [...params]);   // INSERT/UPDATE — result discarded
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    const result = await this.getPool().query(sql, [...params]);
    return result.rows as readonly T[];             // SELECT — rows cast to shape via aliases
  }

  async close(): Promise<void> { await this.pool?.end(); }  // NOT on the port (D6)
}

/** Factory: env-first connection string with local default (zero secrets in code). */
export function pgConnectionString(): string {
  return process.env.DATABASE_URL ?? 'postgresql://io:io_dev@localhost:5432/io_dev';
}
```

- **Connection string**: `DATABASE_URL` env var wins; default `postgresql://io:io_dev@localhost:5432/io_dev`.
- **Pool lifecycle**: lazy init on first query; `close()` ends the pool. Not on `DbConnection`
  (fakes stay close-free).
- **Error mapping**: `pg` errors propagate as rejections (caught by `await` in adapters → test
  failures). No swallowing; `pg`'s typed `DatabaseError` surfaces naturally. Deferred: retry,
  classification (downstream).

## Schema

Column mapping is unchanged from `sql.ts` (D7): snake_case columns ↔ camelCase `PersistentRecord`
via `AS "alias"`.

```sql
-- packages/database/sql/001_create_tables.sql  (id column backs audit ORDER BY id ASC)
CREATE TABLE IF NOT EXISTS evidence (
  id           SERIAL PRIMARY KEY,
  action_id    TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  risk_class   TEXT NOT NULL,
  decision     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  timestamp    BIGINT NOT NULL,
  persistent   BOOLEAN NOT NULL,
  disclosure   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_action_id ON evidence (action_id);

CREATE TABLE IF NOT EXISTS audit (
  id           SERIAL PRIMARY KEY,
  action_id    TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  risk_class   TEXT NOT NULL,
  decision     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  timestamp    BIGINT NOT NULL,
  persistent   BOOLEAN NOT NULL,
  disclosure   TEXT NOT NULL
);
```

**Applied how (D3)**: the integration test reads the `.sql` file and runs it through
`PgDbConnection.execute()` in `beforeAll` (`CREATE TABLE IF NOT EXISTS` = idempotent). Manual
alternative: `docker exec -i io-postgres psql -U io -d io_dev < packages/database/sql/001_create_tables.sql`.
No migration runner this slice.

## Integration Test Strategy

| Concern | Approach |
|---|---|
| Harness | New `packages/database/test/pg-roundtrip.test.ts`; connects via `PgDbConnection(pgConnectionString())`. |
| Schema setup | `beforeAll`: load + `execute()` the DDL (`IF NOT EXISTS`). |
| Isolation | `beforeEach`: `TRUNCATE evidence, audit RESTART IDENTITY` — preserves order semantics, avoids cross-test bleed. |
| Teardown | `afterAll`: `conn.close()` (ends pool). |
| Round-trip | `PgEvidenceRepository.save(rec)` → `get(actionId)` asserts byte-identical record; `PgAuditRepository.append` × N → `getLog()` asserts insertion order + immutability. |
| Failure | If PG unreachable, the test errors (no silent skip) — `integration: true` declares a live dependency. |
| `docker exec` path | Manual inspection only (`psql` in container); **no subprocess in test code**. |

`integration: true` flips `openspec/config.yaml` `testing.integration` from `false` → `true`
(D8). Unit tests (`InMemoryDbConnection`/`InMemoryEvidenceRepository`) keep running PG-free.

## docker-compose.yml

Formalizes the already-running container for reproducibility (port 5432, bind-mounted data):

```yaml
services:
  postgres:
    image: postgres:18.4
    container_name: io-postgres
    environment:
      POSTGRES_USER: io
      POSTGRES_PASSWORD: io_dev
      POSTGRES_DB: io_dev
    ports: ["5432:5432"]
    volumes:
      - ./.pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U io -d io_dev"]
      interval: 5s
      timeout: 3s
      retries: 10
```

## Boundary Test Updates

The kernel boundary test is **unchanged** — `trust-kernel` stays driver-free (no `pg` import,
`ports/` exempt as today). Only `packages/database/test/boundary.test.ts` changes:

| Assertion | Current | After |
|---|---|---|
| `dependencies` | `toEqual({})` | **allowlist**: `toEqual({ pg: <version> })` — exact single allowed runtime dep. |
| `@io/trust-kernel` | devDep only | **unchanged** — still devDep / `import type`-only. |
| forbidden-import scan (per `src` file) | rejects `pg` everywhere | **exempt** `pg-connection.ts`; all other `src` files still reject `pg`/drivers/frameworks. |
| `realPgTokens` (`new Pool`, etc.) | forbidden in all `src` | **exempt** `pg-connection.ts` only. |
| `.sql` / migrations | `sqlFiles === []` | Assert `sql/001_create_tables.sql` exists; migration-runner dir still absent. |
| `integration:` config | `toMatch(/integration:\s*false/)` | `toMatch(/integration:\s*true/)`. |
| canonical README | contains `canonical`/`30`/`excluded` | **unchanged** — still excluded from 30. |
| public surface | 3 keys | Adds `PgDbConnection` export; key assertion updated. |

`disclosure.ts` stays a **local** byte-equal constant (adding `pg` does not turn it into a
runtime kernel import — `dependencies` gains only `pg`, kernel coupling unchanged).

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | SQL shape + `$N` param order; round-trip; audit order/immutability — against `InMemoryDbConnection` (now async). | Existing RED→GREEN tests, `await` added. |
| Unit | `PgDbConnection` error propagation, lazy pool init. | Mocked/stubbed `Pool`; no real PG. |
| Integration | Real PG round-trip through both adapters; `TRUNCATE` isolation. | `pg-roundtrip.test.ts` against running PG 18.4. |
| Boundary | `pg` allowlisted, kernel still driver-free, `integration: true`. | Updated `boundary.test.ts` + unchanged kernel boundary test. |
| E2E | N/A | No transport/daemon. |

## Threat Matrix

N/A — no routing, shell commands, subprocesses, VCS/PR automation, executable-file
classification, or process-integration boundary. The integration test connects to PostgreSQL over
TCP via the `pg` library; no code shells out (`docker exec`/`psql` are documented manual paths,
not invoked from code).

## Migration / Rollout

No data migration (no production data exists). Phased within the single change:

1. Async-ify ports + in-memory impls + pipeline + adapters (tsc-driven).
2. Add `pg` dep + `PgDbConnection` + schema SQL.
3. Add integration test; flip `integration: true`.
4. Update `database` boundary test; verify kernel boundary test is untouched.

**Rollback**: revert ports/pipeline/adapters/fakes/tests to sync; remove `PgDbConnection`,
`sql/`, `pg-roundtrip.test.ts`, `docker-compose.yml`, `pg` dep; `integration: true` → `false`.
Kernel product code was never touched (read-only).

## Open Questions

- [ ] Exact `pg` version pin (proposal says v8.x; confirm against TS 6 strict + Node 24 in apply).
- [ ] Whether `result.rows` cast needs a narrowing helper for `readonly T[]` strictness (apply-time).
