# Bootstrap Development Toolchain — RED→GREEN & Gate Evidence

Runtime for all local evidence: Node `v24.18.1` (LTS "Krypton"), pnpm `11.18.0`
(Corepack via `packageManager`). Engine mismatch shown under Node `v26.4.0`
("Current", non-LTS).

| Step | Command | Result |
|---|---|---|
| RED (uncommitted) | `pnpm test` (source absent) | FAIL — `Cannot find module '../src/toolchain-probe.js'`; exit 1 |
| GREEN | `pnpm test` (source implemented) | PASS — 2 passed (2); exit 0 |
| Ordered gates | `pnpm check` | PASS — exit 0 |
| Engine mismatch | `pnpm install` under Node 26.4.0 | REFUSED — `ERR_PNPM_UNSUPPORTED_ENGINE`; exit 1, no lockfile |

## RED (before fix; state never committed)

`test/toolchain-probe.test.ts` imports `toolchainProfile` from `../src/toolchain-probe.js`,
which did not exist. `pnpm test`:

```text
Error: Cannot find module '../src/toolchain-probe.js' imported from .../test/toolchain-probe.test.ts
 Test Files  1 failed (1)
      Tests  no tests
[ELIFECYCLE] Test failed.
```

Exit `1`; `src/toolchain-probe.ts` was absent. RED recorded here, never committed.

## GREEN (after implementing `toolchainProfile()`)

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Exit `0`. Only GREEN is committed.

## Engine mismatch (runtime enforcement, NOT a test assertion)

With `engines.node` `^24.18.1` + `engine-strict`, install under non-LTS/stale
Node refuses before touching the lockfile:

```text
[ERR_PNPM_UNSUPPORTED_ENGINE] Expected version: ^24.18.1 / Got: v26.4.0
```

Exit `1`; no lockfile created. (`pnpm-workspace.yaml` must NOT set `nodeVersion` —
that makes pnpm assume a version and bypass real-runtime enforcement.)

## Lockfile reproducibility

`pnpm install` under Node 24.18.1 produced `pnpm-lock.yaml` (881 lines); a clean
`pnpm install --frozen-lockfile` reproduced an identical lockfile (sha256
`7a800e37…93f96` before and after).

## Quality-gate classification (orthogonal dimensions)

`applicability` (`applicable` | `not_applicable`) × `requirement`
(`required` | `optional`) × `outcome` (declared only when applicable:
`passed` | `failed` | `unavailable` | `not_run`). `required` AND `applicable`
MUST be `passed`. No applicable check is `unavailable`.

| Check | Applicability | Requirement | Outcome | Evidence |
|---|---|---|---|---|
| format-check | applicable | required | passed | `biome format .` — 7 files, no fixes |
| typecheck | applicable | required | passed | `tsc -p tsconfig.json` (strict ESM) |
| build | applicable | required | passed | `tsc -p tsconfig.build.json` (no-emit) |
| lint | applicable | required | passed | `biome lint .` — 7 files, no fixes |
| test | applicable | required | passed | `vitest run` — 2 passed |
| ordered `check` | applicable | required | passed | `pnpm run check` |
| engine-mismatch refusal | applicable | required | passed | Node 26 → `ERR_PNPM_UNSUPPORTED_ENGINE` |
| frozen-lockfile reproducibility | applicable | required | passed | identical sha256 before/after |
| integration | not_applicable | — | — | Root-only non-product harness; no integration boundary (out of scope). |
| e2e | not_applicable | — | — | No product surface to drive end-to-end. |
| coverage | not_applicable | — | — | No coverage policy in the bootstrap; out of scope per proposal. |
| security scanning | not_applicable | — | — | Only a pinned dev toolchain; no secret surface. Deferred. |
| publication | not_applicable | — | — | Private root package (`"private": true`); nothing published. |
