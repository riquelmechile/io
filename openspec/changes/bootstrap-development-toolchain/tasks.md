# Tasks: Bootstrap Development Toolchain

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180–320 authored (uncertain; see note); lockfile separate |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (PR 1) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (pre-decided contingency) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

Estimate **180–320 authored lines**, uncertain: final ADR evidence, config/metadata content, and the **native authority's classification** decide the actual count. Lockfile (`pnpm-lock.yaml`) is nonzero, forecast separately, native-decided. **Contingency triggers only if native-classified authored lines >400** → auto-chain stacked-to-main: PR 1 = ADR-only slice; PR 2 = proof + application/toolchain CI + activation; **never split proof from activation**.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | ADR + lockfile + proof + gates + application/toolchain CI + activation (atomic proof+activation) | single (main) | `pnpm check` → exit 0 | Node 24 LTS frozen install + `pnpm check`; CI secret-free | revert manifests, lockfile, harness, application/toolchain CI, `config.yaml` activation; preserve governance PR-validation CI; restore `strict_tdd: false` |

## Phase 1: Primary-Doc Verification & ADR 0004

- [ ] 1.1 Verify official docs (pnpm, TS 6.x ESM, Vitest, Biome, Actions); resolve latest secure Node 24 LTS patch; record URLs + date; reject unverified.
- [ ] 1.2 Create `docs/adr/0004-development-toolchain.md` (+ README row): exact versions, Node patch, doc refs/date, enforcement syntax, rejected alternatives, ADR-selected install commands.
- [ ] 1.3 Create `.nvmrc` (Node 24 LTS patch). Gate: ADR 0004 + `.nvmrc` accepted before any manifest or lockfile.

## Phase 2: Root Toolchain & Reproducible Lockfile

- [ ] 2.1 Create `package.json` (private root ESM; `engines`/`packageManager` pin Node 24 + pnpm; scripts `format`/`format-check`/`typecheck`/`build`/`lint`/`test`/ordered `check`) + `pnpm-workspace.yaml` (root-only) + `.npmrc` (engine-strict, Corepack).
- [ ] 2.2 Create `tsconfig.json` (strict ESM, NodeNext) + `tsconfig.build.json` (no-emit) + `biome.json` (ADR policy) + `vitest.config.ts` (non-domain discovery).
- [ ] 2.3 Engine-mismatch enforcement check (separate from lockfile bootstrap; NOT a harness RED test): under non-enforced/stale Node, install MUST refuse; expected = blocked.
- [ ] 2.4 Lockfile bootstrap, explicit sequence — no frozen install before a lockfile exists: (a) verify Node/pnpm pins equal ADR; (b) create initial `pnpm-lock.yaml` with the ADR-approved install command; (c) commit/retain the lockfile; (d) clean reinstall via `pnpm install --frozen-lockfile` (or exact ADR-selected equivalent); (e) verify zero lockfile diff (`git diff --exit-code pnpm-lock.yaml`); reproduce on clean clone.

## Phase 3: Harness RED→GREEN, Gates & CI

- [ ] 3.1 RED (local, UNCOMMITTED): `test/toolchain-probe.test.ts` fails vs absent `src/toolchain-probe.ts`; record evidence to `docs/evidence/bootstrap-development-toolchain-red-green.md`; do not commit RED.
- [ ] 3.2 GREEN: implement `src/toolchain-probe.ts`; `pnpm test` passes; commit GREEN only (RED evidence retained; RED state never committed).
- [ ] 3.3 Ordered `pnpm check` exits 0: `format-check` (non-rewriting), `typecheck`, no-emit `build`, `lint`, `test`.
- [ ] 3.4 Classify each gate across applicability/requirement/outcome; integration, E2E, coverage, security, publication = `not_applicable` + rationale; required AND applicable ⇒ `passed`.
- [ ] 3.5 Create `.github/workflows/ci.yml`: `.nvmrc`, Corepack, cache, frozen install, check-only non-mutating gates, no secrets; mirrors local; preserve `.github/workflows/pr-validation.yml`.

## Phase 4: Source Normalization, Activation & Pre-START Final Checks

- [ ] 4.1 All source-mutating normalization BEFORE review START: run mutating `pnpm format` once; no mutating tool runs after this.
- [ ] 4.2 Metadata activation in the SAME candidate (proof + activation atomic; rollback preserved): `openspec/config.yaml` — `strict_tdd: true`, populate `testing`, command metadata, `rules.apply.tdd`/`test_command`, `rules.verify.*`, `coverage_threshold`.
- [ ] 4.3 Run final full gate suite + CI-equivalent on the final PROSPECTIVE candidate bytes → all required+applicable pass (bytes are prospective, NOT frozen yet).
- [ ] 4.4 `gentle-ai review start` → freezes the exact candidate bytes/paths/modes. This is the ONLY freeze point; no mutation permitted after START.

## Phase 5: Native Review → sdd-Verify → Cache Sync

- [ ] 5.1 After START, run ONLY check-only commands/tests/gates; native review consumes the exact frozen candidate + applicable evidence — it is NOT independent of proof; block until persisted native review reaches the required final-verification state.
- [ ] 5.2 sdd-verify readiness: ONLY after persisted native review reaches the required final-verification state, run independent requirements/runtime verification on the exact candidate; no premature verify.
- [ ] 5.3 After native review allow AND successful sdd-verify, before delivery or any next apply: idempotently sync Engram `sdd/io/testing-capabilities` from `config.yaml` + candidate + receipt lineage; read back; verify equality + lineage; fail closed on mismatch.

## Phase 6: Rollback

- [ ] 6.1 Approved Git revert: remove toolchain, application/toolchain CI, harness, lockfile; preserve governance PR-validation CI; restore `openspec/config.yaml` (`strict_tdd: false`, empty commands/testing).
- [ ] 6.2 Resync Engram `sdd/io/testing-capabilities` from reverted authority + revert receipt lineage; read back; verify no strict-TDD claim; fail closed on mismatch.
