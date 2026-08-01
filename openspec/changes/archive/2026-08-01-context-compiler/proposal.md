# Proposal: Context Compiler (Paso 3 — first bounded slice)

## Intent

DeepSeek reuses identical token prefixes from token one; a cache hit costs ~50× less than a miss (§7.2). One reordered or inserted byte shifts every downstream token and kills the whole prefix. Today the worker hand-assembles only 2 of 13 segments, with no ordering machinery, no stable/dynamic contract, and no `user` cache-cohort field (§7.3). This change adds the compiler that makes prefixes cache-coherent.

- **Business problem / users**: inference is the platform's dominant cost; cache hits make the enterprise worker's plan-generation cheap and deterministic (beneficiaries: the worker, the founder/board paying for inference).
- **Current-state gap**: only segments 1 (protocol) and 11 (current work) exist — no canonical order, no byte-stability, no cohort.

## Scope

### In Scope
- New pure `packages/context` exporting `compileContext(input): { messages, user }`.
- Canonical §7.2 order table (1–13); absent sources hold a fixed position.
- Stable-prefix builder (1–9, byte-stable per cohort) + dynamic-suffix builder (10–13).
- Cache-cohort derivation into `user` (no PII); migrate `STABLE_SYSTEM_PREFIX` text in.
- Worker wiring: `prepareIntent` compiles then calls the injected `LlmClient`; delegation plumbed from the worker.
- Tests: compiler unit + worker integration (`FakeLlmClient`) + package boundary.

### Out of Scope (non-goals — later changes)
- Live DeepSeek E2E, BusinessEvent, skills (seg 7), heartbeats, Memory OS, §9.9 instrumentation, §7.1 model policy.
- Content sources not yet existing (constitution, policies, company, competencies, skills, baseline, memory, evidence) — render ABSENT.
- Model/thinking selection (stays in the worker).

## Capabilities

### New Capabilities
- `context-compiler`: canonical §7.2 ordering, the stable-prefix/dynamic-suffix contract, and cache-cohort derivation producing `{ messages, user }`.

### Modified Capabilities
- None. Worker wiring is implementation; `worker-cycle` requirements and `llm-client-port` (already supports `user`) are unchanged.

## Approach

Pure new package (Approach A): the canonical §14 `context/` home; keeps `business-domain` pure (imports domain TYPES only) and the `llm-client` adapter boundary green; reusable by future entry points; unit-testable. Precedent: `deepseek-client` → `packages/llm-client`.

**Business rules (stable-prefix contract)**:
- Segments 1–9 byte-identical per cohort, canonical order; 10–13 dynamic suffix.
- No forbidden leading content (§7.2): date, ids, nonce, heartbeat, snapshot, tool result.
- Cohort = `user`, derived (`io:{companyId}:{process}:v{schemaVersion}`), never PII (§7.3).
- Adding a segment bumps a schema-versioned cohort — never silent byte changes.

**Done**: a compiler ordering segments canonically, enforcing the stable-prefix contract, deriving the cohort, wired into `prepareIntent`, fully tested with `FakeLlmClient` — no live DeepSeek. Constraints: no new runtime deps; business-domain zero `@io/*` imports; `openai` confined to `deepseek-client`; strict TDD; live-PG where relevant. New-package surface is the accepted tradeoff for the canonical home.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/context/` | New | Order table, prefix/suffix builders, cohort. |
| `packages/app/src/llm/stable-prefix.ts` | Removed | Constant migrates into the compiler. |
| `packages/app/src/worker/intent.ts` | Modified | `prepareIntent` calls the compiler. |
| `packages/app/src/worker/{worker,types}.ts` | Modified | Pass delegation into the intent phase. |
| `packages/app/test/worker-intent.test.ts` | Modified | Assertions move to the compiled shape. |
| `tsconfig*.json`, `pnpm-workspace.yaml` | Modified | Register the new package. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Prefix-stability violation (dynamic leak / segment added without cohort bump) | Med | Byte-stability test + schema-versioned cohort. |
| PII in cohort (`user`) | Low | Derived from companyId/process/version; test asserts it ignores work. |
| Test churn (prefix-constant assertions) | Med | Update to compiled shape; no live cache to invalidate. |
| New-package monorepo surface | Low | Mirror `llm-client` boundary; single-purpose package.json. |
| Scope drift into rest of Paso 3 | High | Slice is the compiler alone; OUT list enforced. |

## Rollback Plan

Revert the merge commit: `prepareIntent` returns to `STABLE_SYSTEM_PREFIX`, `packages/context` deleted, tsconfig/workspace entries removed. No persisted state, schema, or live cache touched — clean revert.

## Dependencies

- None new. Consumes existing `business-domain` types and the `llm-client` port/`FakeLlmClient`.

## Success Criteria

- [ ] `compileContext` emits canonical §7.2 order; absent sources hold a fixed position.
- [ ] Stable prefix byte-identical across different works in one cohort; no forbidden dynamic content in the prefix.
- [ ] Cohort (`user`) derived, PII-free, ignores the work description.
- [ ] Worker integration via `FakeLlmClient` records compiled messages + cohort.
- [ ] `pnpm check` green; baseline 771 passed / 3 skipped @ e7b5fe8 preserved or grown.
