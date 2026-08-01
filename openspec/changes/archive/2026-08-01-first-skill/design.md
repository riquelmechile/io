# Design: first-skill — Versioned Skill + Cohort-Safe Activation

## Technical Approach

Approach A: BusinessEvent write-side twin. Pure `Skill` + versioned port/fake + `activeSkillsFor` in `@io/business-domain` (zero `@io/*`); INSERT-only `PgSkillRepository` + `007_skills.sql` + `parseSkillRow` in `@io/database`. No compiler/worker wiring. Covers all 8 `skill` requirements.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Domain home | competency/ vs business-domain | **business-domain** | Event precedent; `competency/` deferred |
| Construction | factory/clocks vs plain object | **Plain literals** (caller supplies all) | Deterministic; matches events |
| Versioning | upsert vs append | **Append; UNIQUE(company,skill,version)** | §9.2 no-overwrite |
| Activation | port method vs pure fn | **`activeSkillsFor(cohort, skills)`** | Cache-poisoning inverse |
| Scope | free string vs structured | **`{process, schemaVersion}` JSONB** | Cohort discriminators |
| Multi-active | all rows vs latest/id | **Max version per skillId** | Deterministic set |
| Order | insertion vs id | **skillId ASC** | Stable cohort output |
| State guard | type-only vs runtime | **`SkillState` + `isSkillState`** | Reject malformed; PG reuses |
| Adapter bind | pool vs DbConnection | **`constructor(conn: DbConnection)`** | Tx- or pool-bound |

## Data Flow

```
Caller Skill ─save/INSERT─► skill row (version N)
  get → latest (ORDER BY version DESC LIMIT 1)
  listByCompany → all versions, tenant-scoped
       ▼
activeSkillsFor({companyId,process,schemaVersion}, skills)
  filter active + company + scope match
  collapse max(version)/skillId; sort skillId ASC
  → Skill[]  (NOT fed to compileContext this slice)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `business-domain/src/types.ts` | Modify | `SkillState`, `SkillScope`, `Skill` |
| `business-domain/src/skill-activation.ts` | Create | `isSkillState`, `activeSkillsFor` |
| `business-domain/src/ports/repositories.ts` | Modify | `SkillRepository` |
| `business-domain/src/ports/fakes.ts` | Modify | `InMemorySkillRepository` |
| `business-domain/src/index.ts` | Modify | Exports |
| `business-domain/test/skill.test.ts` | Create | Domain unit + purity |
| `database/sql/007_skills.sql` | Create | Table + UNIQUE + tenant index |
| `database/src/skill-adapter.ts` | Create | `PgSkillRepository` |
| `database/src/row-guards.ts` | Modify | `parseSkillRow` |
| `database/src/index.ts` | Modify | Export adapter + guard |
| `database/test/skill-roundtrip.integration.test.ts` | Create | Live PG sequential |
| `database/test/row-guards.test.ts` | Modify | Guard cases |
| `database/test/boundary.test.ts` | Modify | INSERT-only + exports |
| `database/test/sql-migrations.test.ts` | Modify | 007 DDL |

**Untouched:** `packages/context/**` (seg 7 ABSENT), `packages/app/**`.

## Interfaces / Contracts

```ts
export type SkillState = 'draft' | 'active' | 'retired';
export interface SkillScope {
  readonly process: string;
  readonly schemaVersion: number; // ≥1
}
export interface Skill {
  readonly skillId: string;
  readonly companyId: string;
  readonly name: string;
  readonly version: number; // ≥1, caller-supplied
  readonly body: string;
  readonly scope: SkillScope;
  readonly state: SkillState;
  readonly createdAt: number; // epoch ms, caller-supplied
  readonly updatedAt: number;
}

export function isSkillState(value: string): value is SkillState;
export function activeSkillsFor(
  cohort: { readonly companyId: string; readonly process: string; readonly schemaVersion: number },
  skills: readonly Skill[],
): Skill[]; // pure; work/tail cannot enter signature

export interface SkillRepository {
  save(skill: Skill): Promise<Readonly<Skill>>; // append; dup triple fails
  get(companyId: string, skillId: string): Promise<Skill | undefined>; // latest
  listByCompany(companyId: string): Promise<readonly Skill[]>; // all versions
}
```

**Fake:** ordered `Skill[]`; `requireCompanyId`; reject dup triple (preserve original); tenant get/list.

**PG:** INSERT 9 cols (`JSON.stringify(scope)`); get `ORDER BY version DESC LIMIT 1`; list `ORDER BY skill_id, version`; map `parseSkillRow`; empty companyId pre-SQL reject; no UPDATE/DELETE.

**`007_skills.sql`:** table `skill` — `id SERIAL PK`, `skill_id/company_id/name/body/state TEXT NOT NULL`, `version INTEGER NOT NULL`, `scope JSONB NOT NULL`, `created_at/updated_at BIGINT NOT NULL`; `uq_skill_company_skill_version UNIQUE(company_id, skill_id, version)`; `idx_skill_company_id ON (company_id)`; all `IF NOT EXISTS`.

**`parseSkillRow`:** `RowGuardResult<Skill>`; non-empty ids/name/body; version≥1; timestamps numbers; state ∈ set; scope `{process, schemaVersion≥1}`; fail `{ok:false,reason}`.

## Testing Strategy

| Spec req | File | Notes |
|----------|------|-------|
| Pure Skill | `skill.test.ts` | Shape, equal construct, zero `@io/*`, no deps |
| Append registry | `skill.test.ts` | Exact port surface; v1+v2 get=v2; dup fails |
| In-memory versioned | `skill.test.ts` | Interleaved A/B tenants |
| Lifecycle | `skill.test.ts` | Guard rejects bad; only active selectable |
| Cohort activation | `skill.test.ts` | Same cohort ⇒ same set; dynamic input ignored |
| Insert-only PG | round-trip (seq) + boundary + sql-migrations + row-guards | RT; UNIQUE; no UPDATE/DELETE; 007 |
| Tenant scope | unit + integration | Empty companyId reject; A≠B |
| Stable-prefix | structural | No context edits; deps = business-domain only |

Runner `PATH=/data/node24/bin:$PATH pnpm test`; gate `pnpm check`. PG sequential `--no-file-parallelism`.

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/process-integration boundary.

## Migration / Rollout

Additive `007`. Stacked-to-main, budget 400 lines.

| PR | Scope | Est. Δ |
|----|-------|--------|
| **PR1** | business-domain type/port/fake/activation + `skill.test.ts` | ~280–360 |
| **PR2** | 007/adapter/guard + round-trip/boundary/sql-migrations/row-guards | ~300–380 |

No app/worker PR.

## Open Questions

None.
