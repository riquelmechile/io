# Architecture Decision Records

Architecture Decision Records (ADRs) capture accepted architectural decisions and their consequences. ADR numbers are assigned sequentially and are never reused. A superseded ADR remains in this directory with its status updated and a reference to its replacement.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-primary-and-temporary-worker-roles.md) | Accepted | Every worker has one primary role and may hold bounded, compatible temporary roles. |
| [0002](0002-delegation-as-authority-commitment.md) | Accepted | Delegation is an authority commitment separate from Work. |
| [0003](0003-risk-tiered-authority-controls.md) | Accepted | Risk is classified deterministically before authority evaluation and sets separation-of-duties controls. |
| [0004](0004-development-toolchain.md) | Accepted | Reproducible root-only toolchain: enforced Node 24 LTS, pnpm, TypeScript 6.x strict-ESM, Vitest, Biome; proof-gated strict-TDD activation. |
