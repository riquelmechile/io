# ADR 0004: Development Toolchain

## Status

Accepted

## Date

2026-07-29

## Context

Governance PR-validation CI exists, but there is no runtime, lockfile, test
runner, linter/formatter, typecheck/build, or application/toolchain CI, so
`openspec/config.yaml` keeps `strict_tdd: false`. The foundational architecture
document (Section 6) declares TypeScript 6.x, Node.js 24 LTS, strict-ESM,
first-party components, and no agentic/business frameworks.

This ADR records exact, primary-doc-verified versions and enforcement making the
bootstrap reproducible. It is root-only, non-product. Concrete tools are accepted
ONLY here, AFTER compatibility was verified against current official primary docs
on 2026-07-29 (see References); the spec forbids naming concrete tools.

## Decision

Accept pnpm + strict-ESM TypeScript 6.x + Vitest + Biome + additive GitHub
Actions, pinned to the exact verified versions below.

### Accepted versions (verified 2026-07-29)

| Tool | Version | Role |
|---|---|---|
| Node.js | `24.18.1` (Active LTS "Krypton", security release 2026-07-28) | Enforced runtime |
| pnpm | `11.18.0` | Package manager (Corepack-pinned) |
| TypeScript | `6.0.3` | Strict-ESM typechecker (no-emit scopes) |
| Vitest | `4.1.10` | Test runner |
| Vite | `8.1.5` | Vitest required peer / transform pipeline |
| Biome | `2.5.6` | Check-only formatter + linter |
| `@types/node` | `24.13.3` | Node 24 runtime types |

### Node resolution and enforcement

Node is resolved to the latest secure 24 LTS patch (`24.18.1`), then immutably
recorded here, `.nvmrc`, `package.json` (`engines.node`), the CI `.nvmrc` step,
and lockfile context. Non-LTS lines (e.g. Node 26 "Current") and stale 24.x
patches are rejected.

- `.nvmrc` pins `24.18.1`.
- `package.json` `engines.node` = `^24.18.1` (24 LTS line at/above the secure
  patch), `engines.pnpm` = `^11.18.0`, `packageManager` = `pnpm@11.18.0`.
- `.npmrc` sets `engine-strict=true`; pnpm additionally fails unconditionally
  when the root package's own `engines` are violated, so a stale/non-LTS Node
  refuses install before a frozen lockfile is touched. Do NOT set
  `pnpm-workspace.yaml` `nodeVersion` (it bypasses real-runtime enforcement).

### Validation strategy (no product artifact)

Two no-emit TypeScript scopes: `typecheck` (all source + tests, strict ESM) and
`build` (source-only, `noEmit`), so production validation is not substituted by
tests and no artifact is emitted.

### Commands

| Script | Behavior |
|---|---|
| `format` / `format-check` | Mutating Biome format (local) / non-rewriting check (CI) |
| `typecheck` | Strict ESM no-emit check across source + tests |
| `build` | Source-only no-emit check |
| `lint` | Biome lint/static analysis |
| `test` | Vitest single run |
| `check` | Ordered gate: `format-check`, `typecheck`, `build`, `lint`, `test` |

Install (ADR-selected): `corepack enable pnpm` then `pnpm install`
(`pnpm install --frozen-lockfile` reproduces the committed lockfile).

## Consequences

Positive: reproducible installs under an enforced LTS; one tool (Biome) for
check-only format + lint; no-emit scopes avoid a product artifact; proof-gated
activation keeps `strict_tdd` off until every gate is green. Negative: two
TypeScript scopes must stay consistent; the lockfile is nonzero and is classified
as review burden by the native authority (forecast separately).

## Rejected Alternatives

- **npm/yarn**: pnpm gives stronger reproducible lockfiles, strict peers, Corepack.
- **Node 26 "Current"**: not an LTS line; production must use an LTS.
- **TypeScript 7.x** (`7.0.2` now published): the architecture document declares
  TS 6.x and treats TS 7 as not-yet-stable for IO; pin the declared stable 6.x.
- **Product emit (`tsc --emit` + `dist/`)**: would create a product artifact.
- **Tests as the only validation**: source-only `build` proves production code
  validates independently.
- **ESLint + Prettier**: Biome is one tool for format + lint; a valid but larger stack.
- **Node Test Runner (`node --test`)**: viable but less ergonomic for strict TDD.

## Scope / Follow-ups

Root-only, non-product toolchain only. No `apps/`, `packages/`, service, secret,
or domain file. Strict-TDD activation is proof-gated: `strict_tdd` switches to
`true` and command metadata populates only after all gates pass on the same
candidate, then final checks rerun before freeze. The derived Engram
`sdd/io/testing-capabilities` cache is synchronized AFTER native review allows
the exact candidate; it is not candidate bytes. Next change
(`bootstrap-minimum-trust-kernel`) introduces the first strict-TDD product behavior.

## References

Official primary docs verified 2026-07-29:

- Node.js LTS schedule: https://nodejs.org/en/about/previous-releases
- Node.js version index: https://nodejs.org/dist/index.json
- Node 24.18.1 release: https://nodejs.org/en/blog/release/v24.18.1
- pnpm installation/Corepack: https://pnpm.io/installation
- pnpm `engines`/`packageManager`: https://pnpm.io/package_json
- pnpm `engineStrict`/`nodeVersion`: https://pnpm.io/settings
- TypeScript: https://www.typescriptlang.org/ (`typescript@6.0.3`)
- Vitest config: https://vitest.dev/config/ (`vitest@4.1.10`)
- Vite: https://vite.dev/ (`vite@8.1.5`)
- Biome: https://biomejs.dev/ (`@biomejs/biome@2.5.6`)
- GitHub Actions setup-node: https://github.com/actions/setup-node
- GitHub Actions pnpm/action-setup: https://github.com/pnpm/action-setup
