# Design: Bootstrap Development Toolchain

## Technical Approach

Create one root-only, non-product TypeScript workspace. Apply verifies current primary docs before ADR 0004 or lockfile creation; proposed tools remain pnpm, strict-ESM TypeScript, Vitest, Biome, and additive application/toolchain GitHub Actions until ADR acceptance. Local RED→GREEN precedes a green, frozen Git candidate.

## Architecture Decisions

| Decision | Options / trade-off | Decision and rationale |
|---|---|---|
| Toolchain | pnpm/Vitest/Biome vs smaller Node-only stack | Propose the former for reproducible installs, focused TDD, and one check-only formatter/linter; ADR 0004 accepts exact verified versions. |
| Validation | Product emit vs two no-emit TS scopes | Use all-code/test `typecheck` and source-only `build`; this prevents tests substituting for production validation without creating a product artifact. |
| State authority | Git config plus cache in one atomic transaction vs authoritative Git plus derived cache | `openspec/config.yaml` testing block, command metadata, and `strict_tdd` are the reviewed Git authority. Engram `sdd/io/testing-capabilities` is a derived cross-session cache, outside Git candidate bytes and not atomically committable. No distributed atomicity is claimed. |
| Review size | Complexity-based threshold vs native count | Auto-chain only when native-classified authored additions+deletions **>400**. Complexity or lockfile burden may justify an earlier voluntary split, but never redefines that threshold. |

ADR 0004 records versions, primary-doc URLs/date, enforcement syntax, and rejected alternatives. Node is resolved to the latest secure 24 LTS patch, then immutably recorded in ADR, `.nvmrc`, manifest/runtime settings, CI, and lockfile context; mismatches fail before frozen install.

## Data Flow

```text
RED locally → fix → GREEN gates → Git config activation → exact-candidate recheck
                                                       → native review freeze
reviewed config + receipt/candidate identity → Engram cache sync → read-back equality → delivery/apply
```

Before review freeze, all authoritative repo-config edits and final checks complete. Review sees the exact green Git candidate; there is no post-freeze source mutation. After native review permits that exact candidate but before delivery or next apply, idempotently synchronize the derived cache from reviewed config plus receipt/candidate identity. Block closed unless authority and cache agree.

## File Changes

| File / state | Action | Responsibility |
|---|---|---|
| `package.json`; `pnpm-workspace.yaml`; `.npmrc`; `.nvmrc`; `pnpm-lock.yaml` | Create | Root ESM command API, reproducible workspace, runtime/manager enforcement. |
| `tsconfig*.json`; `vitest.config.ts`; `biome.json` | Create | Strict ESM validation, test discovery, formatting/lint policy. |
| `src/toolchain-probe.ts`; `test/toolchain-probe.test.ts` | Create | Non-domain RED→GREEN harness, committed only GREEN. |
| `docs/evidence/bootstrap-development-toolchain-red-green.md`; `docs/adr/0004-development-toolchain.md`; `docs/adr/README.md`; `.github/workflows/ci.yml` | Create / Modify | Proof, accepted decisions, and additive secret-free application/toolchain CI; preserve `.github/workflows/pr-validation.yml`. |
| `openspec/config.yaml` | Modify | Authoritative testing block, command metadata, and `strict_tdd` activation after proof. |
| Engram `sdd/io/testing-capabilities` | Synchronize after review | Derived cache only; store config digest/identity, receipt/candidate reference, observation/topic revision, and equality result. |

No `apps/`, `packages/`, service, secret, or product/domain file is created.

## Interfaces / Contracts

Final executable forms are ADR-defined: frozen install; local-only mutating `format` before RDD START; check-only format, typecheck, no-emit build, lint, test, and ordered `check`. Application/toolchain CI uses `.nvmrc`, Corepack, cache, frozen install, and non-mutating gates without secrets while governance PR-validation CI remains in place. Required applicable checks must pass; integration, E2E, coverage, security scanning, and publication are reported `not_applicable` with root-only rationale.

Cache synchronization evidence is: reviewed config digest/identity; Engram observation/topic/revision; read-back equality; and receipt lineage/reference. A mismatch, missing receipt, or failed read-back blocks delivery/next apply.

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Harness | Deterministic non-domain assertion | Capture local RED, fix to GREEN, retain evidence; candidate stays green. |
| Toolchain | Runtime/manager rejection, frozen install, every gate | Clean-clone and CI-equivalent sequence. |
| State sync | Authority/cache agreement and rollback | Idempotent sync/read-back against candidate identity; fail closed on mismatch. |
| Application/toolchain CI | Secret-free reproducibility | Run the check-only suite without replacing governance PR-validation CI. |

## Threat Matrix

| Boundary | Applicability | Design response / planned RED tests |
|---|---|---|
| Documentation-like paths | N/A — no classifier | No test. |
| Git repository selection | N/A — no `git -C`/path selection | No test. |
| Commit state | N/A — no commit automation | No test. |
| Push state | N/A — no push automation | No test. |
| PR commands | N/A — no PR automation | No test. |

Scripts and CI invoke fixed project-owned commands; they do not parse user paths or compose VCS/PR commands.

## Migration / Rollout

Proof sequence: bootstrap → normalization before RDD START → local RED→GREEN → all gates → authoritative config activation → final checks on exact bytes → native review freeze → cache synchronization/read-back → delivery/next apply.

Rollback requires an approved Git revert that restores `strict_tdd: false` and empty commands. Then resynchronize `sdd/io/testing-capabilities` to the reverted authoritative state and verify read-back; never leave the cache claiming strict TDD when authority is false. This cache synchronization is non-Git state synchronization, not a source mutation.

## Open Questions

- [ ] None: primary-doc verification is required at apply time, not a blocker.
