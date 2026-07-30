# Exploration: IO Delivery, Quality & Development Contract

> **Contract:** Unified delivery/quality/TDD/RDD/SDD policy for IO. Binds toolchain bootstrap, test architecture by behavior, orthogonal CI applicability/requirement/outcome dimensions, SDD phase dependencies, Organic Receipt-Driven Development with provider-owned native receipt authority, bounded verification, 400-line review budget, stacked-to-main chained delivery, and work-unit commit discipline. [INF] Carries domain v2, ports/trust v2, persistence/recovery, and ADR-0001/0002/0003 invariants as settled constraints. [INF] Supersedes prior ad-hoc quality assumptions. [INF]

---

## 1. Current Truth [CONFIG] [INIT] [INF]

One-engineer greenfield; repo holds architecture doc, ADRs, and OpenSpec artifacts but no application code or toolchain. [CONFIG] [INIT]

| Dimension | State | Source |
|-----------|-------|--------|
| Application code | None | [INIT] |
| Test runner | None (`runner: none`, commands empty) | [CONFIG] |
| strict_tdd | `false` | [CONFIG] |
| Linter / type checker / formatter | None configured | [CONFIG] |
| Application/toolchain CI | None; planned `.github/workflows/ci.yml` is additive and MUST preserve existing governance PR-validation CI | [INF] |
| Governance CI | `.github/workflows/pr-validation.yml` validates the contribution contract | [INIT] |
| Tests (unit/integration/e2e) | None exist | [CONFIG] |
| Coverage | None; threshold 0 | [CONFIG] |

**No application code, test runner, application/toolchain CI, linter, type checker, or formatter exists today.** [INF] Governance PR-validation CI already exists at `.github/workflows/pr-validation.yml`. [INIT]

---

## 2. Toolchain-Bootstrap Transition [INF]

### 2.1 Pre-Bootstrap

Configuration-only artifacts MAY use structural checks (file presence, YAML parse, schema validation) when no runner is available. [INF] These guard config integrity — they are NOT tests. [INF]

### 2.2 Bootstrap Change

The change that introduces the first toolchain MUST execute in this order:

1. Install/configure tools: `package.json`, `tsconfig.json`, test runner config, formatter config. [INF]
2. Create a meaningful harness smoke test: demonstrate local RED (failing test in the new runner) then GREEN (pass after correction) in the actual runner. [INF]
3. Successfully run the actual runner, test suite, typecheck/build, and applicable format/lint checks against the smoke test. [INF]
4. **Only after all proof succeeds**: set `strict_tdd: true`, populate `testing.*`, and configure `test_command`/`build_command` in Git-tracked `openspec/config.yaml`, the candidate authority; then rerun final checks before freeze and review. If any proof step fails, `strict_tdd` remains `false`. [INF]
5. **Only after native review allows that exact candidate and SDD verify succeeds**: idempotently synchronize Engram `sdd/io/testing-capabilities` as a derived cache, then read it back and fail closed on any content, identity, or lineage mismatch before delivery or the next apply. The cache is excluded from candidate bytes; no distributed atomicity is claimed. [INF]

After bootstrap, EVERY behavioral implementation follows local RED → GREEN → REFACTOR. [INF] RED (failing test) NEVER enters a review candidate. [INF]

### 2.3 First Behavioral Vertical Slice [INF]

First product behavior after bootstrap starts its own RED → GREEN → REFACTOR cycle. [INF] The bootstrap setup smoke test does NOT count as product behavior. [INF]

---

## 3. Test Architecture by Behavior [INF] [ARCH]

Tests validate behaviour through the narrowest possible aperture. [INF]

| Layer | Scope | Technique | Runner/Double |
|-------|-------|-----------|---------------|
| Domain unit | Business rules, invariants, state machines | Value-object/aggregate tests; property-based for invariants [ADR-0001/0002/0003] | In-process, zero IO infrastructure |
| Application use-case | Orchestration through inbound ports | Port mocking / in-memory fakes; stub outbound adapters | In-process fakes, same runner |
| Adapter integration | PG connection, outbox/inbox, fencing, recovery | Real PG testcontainer or dedicated test DB; idempotency matrix | PG via testcontainers or local |
| DeepSeek contract | First-party LLM adapter contract fidelity | Deterministic fixtures (standard PR proof) + bounded live smoke (bounded/manual/scheduled in trusted env) | Fixture vs real endpoint |
| Daemon capability | Daemon command lifecycle, UNKNOWN outcomes | Simulated daemon at port boundary, state-machine assertions | Fake daemon adapter |
| E2E slice | Founder → proposal → review → approval → execution → verification → receipt | ONE minimal happy-path slice across all phases | Full stack (PG + TS runtime) |

Coverage is **evidence, not a goal**. [INF] No threshold enforced until baseline is measured and a decision is recorded. [INF] Uncovered paths are a risk note, not a gate failure. [INF]

---

## 4. CI Applicability [INF]

### 4.1 Check States

Each CI check records three separate dimensions; requirement is not applicability, and applicability is not outcome. [INF]

| Dimension | Values | Behaviour |
|-----------|--------|-----------|
| Applicability | `applicable` \| `not_applicable` | Determines whether the check pertains to this candidate/environment. `not_applicable` is a completed classification, not an unavailable execution. |
| Requirement | `required` \| `optional` | Determines whether an applicable check gates delivery. |
| Outcome | `passed` \| `failed` \| `unavailable` \| `not_run` | Recorded only for applicable checks. `unavailable` means execution could not occur; `not_run` means no execution was attempted or completed. |

An applicable required check passes only with outcome `passed`. [INF] `required` + `applicable` + `failed`, `unavailable`, or `not_run` does NOT pass and blocks delivery or requires an explicit maintainer decision where policy permits. [INF] An applicable optional check reports its outcome without becoming a required gate. [INF]

### 4.2 PR CI Rules

Mocks/contract fixtures are the standard deterministic PR proof. [INF] Fork builds run all secret-free required checks. [INF] Live DeepSeek smoke is explicitly **not applicable** to untrusted forks and is NOT part of standard PR CI — it runs bounded/manual/scheduled in trusted environment only. [INF] Never claim every CI run executes live smoke. [INF]

The planned application/toolchain workflow at `.github/workflows/ci.yml` is additive. [INF] It MUST preserve the existing governance workflow at `.github/workflows/pr-validation.yml`, which continues to validate the contribution contract. [INIT]

### 4.3 Stage Topology

Stages are generic — no unverified tool selected. [INF]

| Order | Stage | Scope | Typical Requirement |
|-------|-------|-------|---------------------|
| 1 | Install / reproducibility | Lockfile resolution, dependency install | required |
| 2 | Format check-only | Source formatting; NON-MUTATING | required |
| 3 | Typecheck | Full-project type checking | required |
| 4 | Lint / static architecture | Lint rules + architecture enforcement | required |
| 5 | Unit | Domain + application use-case tests | required |
| 6 | Integration | PG, outbox/inbox, fencing, recovery tests | optional |
| 7 | Security / dependency scanning | Known vulns, license compliance, credential leak | optional |
| 8 | Build | Compilation, artifact assembly | required |
| 9 | Receipt / evidence publication | Candidate identity hash, evidence manifest, receipt | required |

Applicability and outcome are evaluated separately for every stage and candidate. [INF]

---

## 5. SDD Dependency Contract [INF]

### 5.1 Phase Dependencies

```
proposal → (spec + design concurrently) → tasks → apply → native bounded review transaction
native persisted state (`ready_final_verification` | `final_verifying`) → verify → archive
native review missing or active → native review
```

- **proposal** is the native structured dependency for spec and design. [INF]
- **spec** and **design** may proceed concurrently once proposal exists. [INF]
- **tasks** requires both spec and design. [INF]
- **apply** requires tasks, spec, and design. [INF]
- **native bounded review transaction** is a separate post-apply gate owned by the native review provider. [INF]
- **verify** is independent in purpose, but dispatcher status is READY only after the persisted native bounded review transaction reaches `ready_final_verification` or `final_verifying`. [INF] Missing or active review state routes back to native review rather than dispatching verification. [INF]
- **archive** requires completed tasks, verify evidence, and an allowed review receipt. [INF]

### 5.2 Dispatcher, Not Invented Gates

The orchestrator routes phases by structured dispatcher status (`state.yaml`). [INF] Verification readiness is derived from the persisted native review transaction state, not from a new SDD purpose dependency: `ready_final_verification` or `final_verifying` dispatches verification; missing or active review dispatches native review. [INF] Separate session automatic gatekeeper behavior from native artifact dependency states. [INF] No claim-label gates are native SDD semantics. [INF] No "automatic gatekeeper" with AC verdicts — only honest dispatcher routing. [INF]

---

## 6. Organic Receipt-Driven Development [RDD] [INF]

RDD is enabled (`rdd: true`) as Gentle AI's stable native authority and delivery path, anchored to [Gentle AI v2.2.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v2.2.0), the stable Organic Receipt-Driven Development release. [CONFIG] Direct, delegated, and optional-SDD routes converge on proof, bounded review, an exact native receipt, and delivery authorization. [RDD] IO explicitly selects SDD for planning; TDD remains implementation discipline. [INF] Native repository receipts are distinct from future IO business receipts (S11/S15 in persistence contract). [INF] Business receipts attest execution evidence on chain; native receipts attest candidate review completeness and delivery authority. [INF] [ARCH] The native provider owns the versioned repository receipt schemas, behavior, and validation authority; this project MUST consume that authority and MUST NOT redesign or freeze those schemas locally. [INF] This version anchor records the current native workflow baseline; it does not constrain future IO business semantics to native repository schemas. [INF] Only the future IO business receipt schema belongs to product design. [ARCH] [HYP]

### 6.1 Native Review Facade

| Concern | Behaviour |
|---------|-----------|
| Tier | Candidate/diff risk (NOT ADR-0003 business-action risk) |
| Lenses | Risk, Readability, Reliability, Resilience — controller selects zero, one, or all four |
| Budget | 400 changed lines per review unit | [CONFIG] |
| Receipt | Provider-owned versioned schema binds native lineage/candidate identities, initial/final trees, paths digest, policy, frozen ledger/findings, correction delta, evidence/counters/base relationship; provider validation is authoritative and project redesign is forbidden |

### 6.2 Candidate Freeze Protocol [RDD] [INF]

1. All source-mutating normalisation (reformat, reorganise, rephrase) happens **before START**. [INF]
2. After START: candidate bytes are frozen. [INF]
3. Only CHECK-ONLY operations permitted after freeze — formatting check, typecheck, tests, gates. [INF]
4. **Ordinary review permits at most one native-authorized bounded correction transaction**, which yields a corrected candidate plus final receipt after validator + evidence. [INF]
5. Any other byte, path, or mode change after freeze **invalidates authority** and requires a new review candidate. [INF]

---

## 7. Verification Contract [INF] [RDD]

| Rule | Behaviour |
|------|-----------|
| Candidate identity | Exact byte-for-byte identity of what enters review |
| Behaviour proof | Test output demonstrating the change does what spec/design says |
| Required+applicable+unavailable | Required applicable check that cannot run → does NOT pass; blocks or needs maintainer decision |
| Unavailable evidence | Applicable check typed as `unavailable` with reason (for example, a missing credential in a trusted execution environment) — never fabricated `passed`; a check excluded from an untrusted fork is `not_applicable` instead |
| Correction maximum | ONE bounded round per ordinary review; further changes require a new candidate |
| Gate re-use | Same gate receipt for unchanged candidates; different receipt for re-candidated work |

---

## 8. Review Workload Budget [CONFIG] [INF]

Hard limit: **400 changed lines** per review unit. [CONFIG] [SESSION]

The **native facade** owns the exact changed-line count. [INF] Original authored additions+deletions determine budget under native policy. [INF]

### 8.1 Category Roles

| Category | Role |
|----------|------|
| Authored source | Counted in native 400-line budget — primary risk driver |
| Tests | Counted in native 400-line budget — travels with code |
| Documentation | Counted in native 400-line budget |
| Config | Counted in native 400-line budget |
| Generated goldens | **Excluded** from native authored count but remain candidate identity and receipt burden. [INF] Do NOT generalize this exclusion to every generated file or lockfile. [INF] |
| Lockfiles / generated snapshots | Always candidate identity and review burden. Forecast separately; native classifies/counts. [INF] |

### 8.2 Bootstrap Forecast Includes Generated

Bootstrap forecast MUST include nonzero generated lockfile estimate and note unknown burden after dependency installation. [INF] Do not claim reliable total before package/tool choices. [INF]

When forecast exceeds 400 lines: **auto-chain** (see §9). [SESSION]

---

## 9. Chained Delivery Strategy [SESSION] [INF]

**Strategy: stacked-to-main**. [SESSION]

| Rule | Behaviour |
|------|-----------|
| Base | PR1 branches from `main`; PR2 branches from PR1 branch; PRn branches from PR(n-1) branch |
| Child target | Child PR initially targets its predecessor branch for focused review |
| Retarget | After predecessor merges to `main`, retarget child PR to `main` — predecessor commits disappear from diff |
| History | No rewrite or rebase required for retarget |
| Sync | If synchronisation needed, merge updated `main` into child (no force-push) |
| Receipt invalidation | Content/path/mode change invalidates review receipt → new candidate required |
| Merge order | Each PR merges to `main` in order; every PR is autonomous, green, and reversible |
| Travel | Tests, docs, migrations, config travel with the code they verify |
| Rollback metadata | Each PR states rollback command, files in scope, and dependency PRs |
| Dependency metadata | Child states `Depends on: #N`, `Blocked by: #N` |

Do NOT create PRs as part of this exploration. [INF]

---

## 10. Work-Unit Commits [INF]

| Rule | Behaviour |
|------|-----------|
| Structure | One reviewable outcome per commit; no file-type grouping |
| Scope | Tests + docs travel with the behaviour they verify |
| Message | Conventional commit (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`); describes OUTCOME, not file list |
| Attribution | No `Co-Authored-By` or AI-generated tags |
| Trigger | Commits created only when explicitly requested | [SESSION] |
| Verification | Each commit records: test command + exact result, harness + exact result (or N/A), rollback boundary |

---

## 11. Readiness Gates & Forecast [INF] [HYP]

### 11.1 Toolchain Bootstrap Readiness

| Gate | Criterion | Verdict |
|------|-----------|---------|
| Tools installed | package.json, tsconfig, runner config, formatter present | OPEN |
| Smoke RED→GREEN | Harness test fails then passes in actual runner | OPEN |
| All checks pass | Runner, typecheck/build, format/lint succeed on smoke | OPEN |
| strict_tdd true | Config populated only after proof succeeds | OPEN |
| Toolchain ADR | Records runner, linter, formatter, type checker | OPEN |

### 11.2 First Behavioral Slice Readiness

| Gate | Criterion | Verdict |
|------|-----------|---------|
| Bootstrap complete | All §11.1 gates PASS | OPEN |
| RED→GREEN→REFACTOR | Product behavior cycle demonstrated (not setup smoke) | OPEN |
| Application/toolchain CI pipeline exists | Additive `.github/workflows/ci.yml` automates stages 1–5 and configures 6–9 without replacing `.github/workflows/pr-validation.yml` | OPEN |
| Test coverage | Domain unit + application use-case tests for slice | OPEN |

### 11.3 Forecast: Bootstrap Change [HYP]

| Category | Estimated Lines |
|----------|-----------------|
| Source (package.json, tsconfig, runner config, formatter config, .gitignore) | 80–150 |
| Smoke test | 20–40 |
| Docs | 30–60 |
| Config (openspec/config.yaml updates) | 10–20 |
| Generated lockfile (after install) | **unknown — nonzero** |
| **Est. total (excl. generated)** | **140–270** |
| **Generated lockfile burden** | **unknown; native classifies/counts after actual install** |

### 11.4 Forecast: First Behavioral Slice [HYP]

| Category | Estimated Lines |
|----------|-----------------|
| Source (domain + application + adapter) | 200–400 |
| Tests | 150–300 |
| Docs | 30–60 |
| Config | 10–20 |
| Generated (lockfile after new deps) | unknown — forecast separately |
| **Total** | **390–780** — likely exceeds 400 → auto-chain into 2–3 stacked-to-main PRs |

### 11.5 Unresolved Tool Decisions [HYP]

Test runner, linter, formatter, type checker strict mode, application/toolchain CI implementation, test DB, dependency scanner, secret scanner — none settled. [HYP] GitHub Actions already hosts governance PR-validation CI; the planned application/toolchain workflow remains additive and MUST preserve it. [INIT] A toolchain ADR MUST select each unresolved tool before bootstrap. [HYP]

---

## 12. Acceptance Criteria

| # | Criterion | Evidence | Verdict |
|---|-----------|----------|---------|
| AC1 | Current state honestly distinguishes absent code/test/application CI/linter/typecheck/formatter from existing governance CI | §1: application/toolchain rows remain none; governance row identifies `.github/workflows/pr-validation.yml` | PASS |
| AC2 | Bootstrap defines config-only structural checks, proof-before-strict_tdd, RED→GREEN→REFACTOR mandatory | §2.1: structural checks labelled NOT tests; §2.2: proof-before-switch; §2.3: RED never enters review | PASS |
| AC3 | Test architecture defines all six layers with scope and evidence; coverage not a goal until measured | §3: 6-layer table with scope/technique/runner; "coverage is evidence" | PASS |
| AC4 | CI separates applicability, requirement, and applicable-check outcome; required+applicable+unavailable never passes; not_applicable is not unavailable; fork rules keep live DeepSeek smoke outside standard PR CI | §4.1: three dimensions and gating combinations; §4.2: fork/DeepSeek rules | PASS |
| AC5 | Phase deps allow concurrent spec+design after proposal; tasks requires both; verification purpose remains independent but dispatch waits for persisted native review state; no claim-label gates | §5.1: corrected DAG and READY states; §5.2: missing/active review routes to native review | PASS |
| AC6 | RDD facade uses diff-risk tier, Risk/Readability/Reliability/Resilience lenses; native provider owns repository receipt schemas/validation; freeze at START; one correction | §6: explicit receipt-domain separation and provider authority; §6.2: freeze/correction protocol | PASS |
| AC7 | Verification: required+applicable+unavailable blocks; unavailable remains distinct from not_applicable; one correction; gate re-use | §7: six rules with typed CI dimensions and required-check block | PASS |
| AC8 | 400-line native count on authored additions+deletions; goldens excluded from count; lockfiles separately forecast | §8.1: native count scope; §8.2: bootstrap includes unknown lockfile | PASS |
| AC9 | Stacked-to-main: PR1 from main, PRn from PR(n-1); targets predecessor; retarget after merge | §9: corrected branching/retarget/receipt rules | PASS |
| AC10 | Work-unit commits: conventional, no AI attribution, one outcome, tests/docs with code | §10: six rules covering all points | PASS |
| AC11 | Readiness gates for bootstrap and first slice; forecasts include generated; unresolved decisions listed | §11.1–§11.5: corrected gates/forecasts/tool decisions | PASS |
| AC12 | Every substantive claim labelled with correct provenance | Throughout: [CONFIG]/[SESSION]/[INIT]/[ARCH]/[RDD]/[INF]/[HYP]; §14 provenance table | PASS |
| AC13 | Line count 250–340 | Structural count | PASS |

---

## 13. Explicitly Downstream [HYP]

1. Test runner, linter, formatter, type checker selection (requires ADR or primary doc)
2. Additive application/toolchain pipeline `.github/workflows/ci.yml`, preserving governance `.github/workflows/pr-validation.yml`
3. Test DB provisioning for integration tests
4. Future IO business receipt schema design (S11/S15); native repository review receipt schemas remain provider-owned
5. Candidate freeze CLI tool or automation
6. DeepSeek live smoke credential management (bounded/manual/scheduled)
7. E2E test slice design and maintenance strategy
8. Coverage threshold decision (after measured baseline)

---

## 14. Provenance & Claim Labels

| Claim | Label | Rationale |
|-------|-------|-----------|
| strict_tdd=false, runner=none, no tools | [CONFIG] | From openspec/config.yaml |
| Greenfield, no app code | [INIT] | From sdd-init |
| ADR-0001/0002/0003 invariants | [ARCH] | Accepted ADRs |
| RDD enabled | [RDD] | Session decision `rdd: true`; native baseline anchored to the Gentle AI v2.2.0 stable Organic RDD release |
| Execution auto, hybrid, auto-chain, 400-line budget | [SESSION] | Session decisions |
| Stacked-to-main | [SESSION] | Session decision |
| No auto commit/push | [SESSION] | Session instruction |
| Derived policy, topology, rules | [INF] | Inferred from config + SDD constraints |
| Unresolved decisions, forecasts | [HYP] | Not yet settled; no code exists |
