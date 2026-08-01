# Design: Context Compiler

## Technical Approach

New pure `packages/context` (Approach A, §14) exports `compileContext(input) → { messages, user }`. §7.2 order 1–13; prefix 1–9 → `system`; suffix 10–13 → role-`user` content; cohort §7.3 → `LlmRequest.user`. `prepareIntent` compiles then calls injected `LlmClient`; model/thinking + `parseLlmPlan` stay in worker. Migrates `STABLE_SYSTEM_PREFIX` → seg 1. All 7 reqs; worker-cycle/llm-client-port untouched (#5847).

## Architecture Decisions

| # | Decision | Options | Choice |
|---|----------|---------|--------|
| D1 | Placement | A packages/context; B app/llm; C llm-client | **A** — §14 home; B hardens shell; C couples adapter→domain |
| D2 | Messages | import LlmMessage vs structural ContextMessage | **structural** — BD-only dep; LlmMessage-assignable |
| D3 | `process` | role vs business process | **business process** — §7.3 examples are functional domains |
| D4 | Absent | elide vs marker | **elide** — position in table; marker wastes tokens |
| D5 | Delegation | re-fetch vs surface checkAuthority | **surface** — additive success; no 2nd RT |
| D6 | schemaVersion | per-cohort vs constant | **`CONTEXT_SCHEMA_VERSION`** |

## Public API

```ts
// @io/context — dep @io/business-domain only (no llm-client/openai)
export const CONTEXT_SCHEMA_VERSION = 1; // bump on any stable-seg add/change
export interface ContextMessage { readonly role:'system'|'user'; readonly content:string }
export interface CompileContextInput {
  readonly companyId: string;
  readonly process: string;           // business process (D3); never role
  readonly delegation?: Delegation;   // seg 5 (+ optional 8)
  readonly work: Work;                // seg 11 only
}
export interface CompiledContext {
  readonly messages: readonly ContextMessage[]; // [system prefix, user suffix]
  readonly user: string;                        // derived; never caller-supplied
}
export function compileContext(input: CompileContextInput): CompiledContext; // pure
export function deriveCohort(a:{companyId:string;process:string;schemaVersion:number}): string;
// Segment: {id, position:1..13, kind:'stable'|'dynamic',
//   render → {present:true;text}|{present:false}}
```

## Components

| Pos | id | Kind | Source this slice |
|-----|-----|------|-------------------|
| 1 | protocol | stable | migrated STABLE_SYSTEM_PREFIX (always) |
| 2–4,6–7,9 | constitution…baseline | stable | ABSENT |
| 5 | role-contract | stable | delegation → authorityScope + expectedOutcome |
| 8 | business-process | stable | `process` token |
| 10,12–13 | memory/evidence/tools | dynamic | ABSENT |
| 11 | current-work | dynamic | work (migrated buildUserTail) |

Builders: `buildStablePrefix`(1–9)→messages[0]; `buildDynamicSuffix`(10–13)→messages[1]; cohort=`io:{companyId}:{process}:v{schemaVersion}`.

**Byte-stability structural:** prefix reads only companyId, process, delegation, CONTEXT_SCHEMA_VERSION. `work` only from seg 11. No clock/ids/nonce. Golden pin locks prefix for current version.

## Cohort + Schema (OPEN resolved)

- **process = business process** (D3), not role. Role = seg 5 content; process = cohort discriminator (§7.3).
- **schemaVersion** = `CONTEXT_SCHEMA_VERSION`. Stable add/change MUST bump; same cohort ⇒ identical prefix. Callers never supply user/schemaVersion.
- **Transitional process:** `intent.ts` `processTokenFor(delegation)` ← `authorityScope.scope` (fixture → `io:acme:low-risk-documents:v1`). Stand-in until process package. Compiler takes process as plain input.

## Data Flow

```
runWorker
  ├─ checkAuthority → {ok:true, delegation}   // D5 surface fetch
  └─ prepareIntent({companyId, idempotencyKey, work, delegation, llm})
        ├─ process = processTokenFor(delegation)
        ├─ {messages,user} = compileContext({companyId, process, delegation, work})
        ├─ llm.complete({model:'deepseek-v4-flash', messages, thinking:{disabled}, user})
        └─ parseLlmPlan → action
```

AuthorityDecision success `{ok:true; delegation:Delegation}`. IntentInput gains `delegation`. Fail unchanged.

## File Changes + Wiring

| File | Action |
|------|--------|
| `packages/context/package.json` | Create `@io/context`; dep `business-domain:workspace:*` only; private ESM; `@types/node` dev |
| `packages/context/src/{index,segments}.ts` | Create API, table, builders, cohort, version |
| `packages/context/test/{context-compiler,boundary}.test.ts` | Create unit + boundary |
| `packages/app/src/llm/stable-prefix.ts` | Delete → seg 1 |
| `packages/app/src/worker/{intent,authority,worker}.ts` | compileContext; surface delegation; processTokenFor; request.user |
| `packages/app/test/worker-intent.test.ts` | compiled shape + cohort |
| `packages/app/package.json` | `"@io/context":"workspace:*"` |
| `tsconfig.json` / `tsconfig.build.json` | include `packages/context/**` / `src/**` |
| `pnpm-workspace.yaml` | comment only (`packages/*` globs) |

Couplings: BD zero `@io/*`; openai only deepseek-client; context no llm-client/app.

## Testing (strict TDD)

| Layer | Coverage |
|-------|----------|
| Unit | order 1→13; suffix after prefix; same-cohort≠work → identical messages[0]; prefix excludes workId/desc; forbidden leading (date/id/nonce/tool); absent 2–10 holds place; cohort `io:acme:planning:v2`; ignores-work; no-PII; vN≠vN+1; golden pin; LlmMessage-compatible; no LlmClient |
| Integration | prepareIntent+FakeLlmClient: system=prefix, user-msg=work, request.user=`io:acme:low-risk-documents:v1` |
| Boundary | mirror llm-client boundary; deps === BD only |

**worker-intent.test.ts:** (1) drop STABLE_SYSTEM_PREFIX L3; (2) L38 toEqual → compiled prefix; (3) L77–82 buildUserTail → suffix via FakeLlmClient (delete export). Unchanged: attemptIdFor, evidenceId, invalid-plan, cycle. **Live-PG:** none new; pure+FakeLlmClient; e2e stays green transitively.

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/process-integration boundary.

## Migration / Risks / Alternatives

No migration. Rollback = revert.

| Risk | Mitigation |
|------|------------|
| Segments ABSENT | elide; table order; later = version bump |
| Dynamic leak / silent change | work only seg 11; golden + mandatory bump |
| PII in cohort | companyId/process/version only |
| Test churn / new package | 3 intent asserts; mirror llm-client |
| Transitional process | composition-root mapper; documented |

**B** app module / **C** llm-client rejected. **A wins:** canonical, pure, BD-only, reusable.

## Open Questions

None. process RESOLVED (D3: business process).
