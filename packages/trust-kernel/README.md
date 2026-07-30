# @io/trust-kernel (Transitional)

> Minimum in-memory, persistence-free authority-evaluation behavior for roadmap
> Increment 2. **Transitional — not a canonical package.**

## What this is

A single transitional module of pure TypeScript functions and in-memory records.
It proves neutral identity, deterministic risk, deny-by-default authority,
separation of duties, evidence/audit, and honest receipts **before** any
persistence, adapter, HTTP, database, daemon, LLM, or framework exists. No state
survives process memory, and no cryptographic or durable guarantee is implied.

## Boundary (hard)

| Rule | Status |
|------|--------|
| Persistence / storage | Excluded |
| Adapters / HTTP / network | Excluded |
| Database / daemon / LLM | Excluded |
| Agentic or business framework | Excluded |
| State survival beyond process memory | None |

## Not a canonical package

`packages/trust-kernel/` is **excluded from the 8 + 12 + 10 = 30 canonical
package partition**. It is never counted as a canonical package (never "package
31"). It exists only to concentrate the minimum in-memory behavior before
canonical extraction.

## Extraction targets (revalidate under change pressure)

| Domain logic | Canonical target |
|--------------|------------------|
| Identity | `organization/` |
| Risk / grants | `policy/` |
| Separation of duties | `approvals/` |
| Evidence | `evidence/` |
| Receipt | `receipts/` |
| Audit | `audit/` |

Revalidate this map and the 30-package partition before extraction; never treat
`trust-kernel` as canonical.

## Next step

A persistence/first-vertical increment extracts the logic above into the
canonical targets. See `openspec/changes/bootstrap-minimum-trust-kernel/` for the
full spec and design.
