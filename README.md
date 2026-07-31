# IO

IO is a digital company operated by agentic workers and directed by a human founder/board. The repository is past pure architecture and into foundation implementation under Spec-Driven Development (SDD).

## Packages

| Package | Role |
|---------|------|
| `@io/trust-kernel` | Transitional in-memory authority evaluation (SoD, grants, pipeline, window gate) |
| `@io/business-domain` | Pure domain types (Company, Delegation, Work, BusinessReceipt), transitions, validation guards, transition use cases, idempotency ports |
| `@io/database` | Driver-free `DbConnection` port + PostgreSQL adapters (`transaction`, CAS versioning, UNIQUE constraints, idempotency journal) |
| `@io/llm-client` | DeepSeek V4 LLM client behind a pure `LlmClient` port |

## Hardened foundation

The domain foundation enforces:

- **SoD**: absolute `proposer≠approver`, `approver≠executor`, `verifier≠executor` at every risk tier
- **Activation window**: `isWindowActive(start, now, expiry)` — future-start grants/assignments are inactive
- **Company scope**: mandatory `companyId` on Work/Delegation/BusinessReceipt; scoped repository reads
- **Transactions**: `DbConnection.transaction(fn)` with PG BEGIN/COMMIT/ROLLBACK and in-memory snapshot rollback
- **Optimistic concurrency**: Work `version` + `updateWithVersion` compare-and-set
- **Idempotency**: company-scoped journal (same key+hash → replay; same key+diff hash → conflict)
- **Runtime validation**: pure guards reject malformed commands, corrupt rows, illegal transitions, invalid LLM plans
- **Transition use cases**: `proposeWork` / `acceptWork` / `startWork` / `completeWork` / `verifyWork` / `rejectWork`

## Documentation

- [Master architecture, memory, and cognitive economy](docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md)
- [ADR index](docs/adr/README.md)

## Toolchain

Requires **Node 24** (`export PATH="/data/node24/bin:$PATH"` in this environment).

```bash
pnpm install
pnpm check   # format + typecheck + build + lint + test
pnpm test
```

PostgreSQL 18.4 (local Docker `localhost:5432`, user/db `io`/`io_dev`) enables integration tests. Without PG they are skipped.
