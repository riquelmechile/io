# Proposal: IO Domain Contract v2

## Intent

Formalize the already-approved IO Domain Contract v2 exploration into the OpenSpec pipeline. The semantic work is already absorbed in `exploration.md`; this proposal adds no new domain requirements and only routes the approved classification, boundary, and authority handoff into later SDD artifacts.

## Scope

### In Scope
- Preserve the exact 30-package primary-responsibility classification from exploration.
- Preserve the non-circular context map, ID/port crossing rule, and deferred package-placement notes.
- Preserve the deny-by-default authority handoff: five never-delegable human categories, bounded temporary roles, and Delegation separate from Work.

### Out of Scope
- Implementing packages, ports, adapters, database schema, UI, or runtime behavior.
- Choosing new tools/libraries or finalizing inferred mechanism candidates.
- Reopening excluded hypotheses H1-H3 or changing ADR-0001/ADR-0002 decisions.

## Capabilities

### New Capabilities
- `io-domain-contract`: Source-traceable domain contract for package responsibilities, context boundaries, and ports/trust handoff constraints.

### Modified Capabilities
- None. Existing `development-toolchain` spec is unrelated and remains unchanged.

## Approach

Use `exploration.md` as the authoritative approved source. Later spec/design/tasks phases must translate only its accepted constraints, labels, and handoff statements; they must not introduce new product behavior or implementation choices.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/io-domain-contract-v2/proposal.md` | New | Pipeline proposal artifact for the approved exploration. |
| `openspec/changes/io-domain-contract-v2/exploration.md` | Referenced | Sole semantic source; unchanged. |
| `openspec/specs/io-domain-contract/spec.md` | New | Expected future spec target for approved contract behavior. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Proposal accidentally extends the approved exploration | Med | Treat exploration as the only semantic authority; keep this artifact routing-level. |
| Downstream phases conflate inferred notes with source/ADR facts | Med | Preserve `[SRC]`, `[ADR-*]`, `[INF]`, and `[HYP]` labels. |
| Authority model weakened by later implementation detail | Med | Keep deny-by-default, five reserved categories, and Delegation/Work separation explicit. |

## Rollback Plan

Remove `openspec/changes/io-domain-contract-v2/proposal.md` to return the change to exploration-only status. No code, specs, config, or approved exploration content is modified.

## Dependencies

- Approved `openspec/changes/io-domain-contract-v2/exploration.md`.
- ADR-0001 and ADR-0002 as cited by the exploration.

## Success Criteria

- [ ] Proposal exists at `openspec/changes/io-domain-contract-v2/proposal.md` and stays under 450 words.
- [ ] Capabilities route to new `io-domain-contract` and modify no existing capability.
- [ ] No requirement beyond the approved exploration is introduced.
