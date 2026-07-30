```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:0503151bc3a67540b2f94f8b587c4b3f3ff3b9aa5b553d8267e6c1b9d47b7d66
verdict: pass
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 6/6
test_command: PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm test
test_exit_code: 0
test_output_hash: sha256:4957eae8190ab97773352b02d0e53134099cf2fde02567ef9e77cbf7341acad6
build_command: PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm build
build_exit_code: 0
build_output_hash: sha256:24c42b76aecef2c39c8a5639a3536efb936b03bdac9a8f8be50c0e71ffbc7af8
```

## Verification Report

**Change**: io-domain-contract-v2
**Version**: N/A (new `io-domain-contract` capability delta)
**Mode**: Strict TDD
**Runtime attempt**: request `io-domain-contract-v2-verify-1-20260729`, active attempt ordinal 2, revision after begin `sha256:37ad30cb31be476b28a881557081e61a7da9d2e6d7b502834957c864fa581681`

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 8 |
| Tasks complete | 8 |
| Tasks incomplete | 0 |
| Requirements | 6/6 |
| Scenarios | 6/6 |
| Docs-only scope | Preserved |
| Review gate/binding | Allowed: `review-77439f7ed7870f93`, post-apply gate |

### Build & Tests Execution

**Environment**: Node `v24.18.1` (`sha256:1f2f55b6a7002be8f9992bdfa80f6a4a2b133df9201a4cbc2c35fb471256cd48`), pnpm `11.18.0` (`sha256:324f52ea836cd47edb7932f3992fa50b67fc7fec13a6950e1a1ddf720afab6d2`).

**Build**: ✅ Passed

```text
Command: PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm build
Exit: 0
Output hash: sha256:24c42b76aecef2c39c8a5639a3536efb936b03bdac9a8f8be50c0e71ffbc7af8
Output:
$ tsc -p tsconfig.build.json
```

**Tests**: ✅ 2 passed / 0 failed / 0 skipped

```text
Command: PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm test
Exit: 0
Output hash: sha256:4957eae8190ab97773352b02d0e53134099cf2fde02567ef9e77cbf7341acad6
Output:
$ vitest run

 RUN  v4.1.10 /data/io


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  23:29:42
   Duration  120ms (transform 16ms, setup 0ms, import 25ms, tests 3ms, environment 0ms)
```

**No-regression check**: ✅ Passed

```text
Command: PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check
Exit: 0
Output hash: sha256:118e953cf6f1e54fc167f19f8de0fa0b39101ef0d07068fde99e28417f87615e
Summary: format-check, typecheck, build, lint, and Vitest all passed under Node 24.18.1.
```

**Coverage**: ➖ Not available (coverage disabled in `openspec/config.yaml`, `testing.coverage: false`).

### Command Evidence

| Evidence | Command | Exit | Output hash | Result |
|---|---|---:|---|---|
| Node runtime | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" node --version` | 0 | `sha256:1f2f55b6a7002be8f9992bdfa80f6a4a2b133df9201a4cbc2c35fb471256cd48` | `v24.18.1` |
| pnpm runtime | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm --version` | 0 | `sha256:324f52ea836cd47edb7932f3992fa50b67fc7fec13a6950e1a1ddf720afab6d2` | `11.18.0` |
| Spec counts | `python - <<'PY2' ...` | 0 | `sha256:0df76eed08be978b883ba09fdaabfc729f5d37bb4c2d2a1b437fd3d4904568be` | `requirements=6`, `scenarios=6` |
| Traceability labels | `rg -c '\[(SRC|ADR-0001|ADR-0002|INF|HYP)\]' openspec/changes/io-domain-contract-v2/specs/io-domain-contract/spec.md` | 0 | `sha256:10159baf262b43a92d95db59dae1f72c645127301661e0a3ce4e38b295a97c58` | `7` labeled lines |
| Main spec absence | `test ! -e openspec/specs/io-domain-contract/spec.md` | 0 | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | New capability; archive will add main spec |
| Product status | `git status --short -- ':!openspec/'` | 0 | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Empty; no product/toolchain file touched |
| Review gate | `gentle-ai review validate --gate "post-apply" --cwd "/data/io"` | 0 | `sha256:09aefe5d9de97274002de860f5845e0a2df19334f765cb991993de8fa2817e23` | `allow`, lineage `review-77439f7ed7870f93` |
| Tests | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm test` | 0 | `sha256:4957eae8190ab97773352b02d0e53134099cf2fde02567ef9e77cbf7341acad6` | 1 file, 2 tests passed |
| Build | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm build` | 0 | `sha256:24c42b76aecef2c39c8a5639a3536efb936b03bdac9a8f8be50c0e71ffbc7af8` | TypeScript build passed |
| Full check | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` | 0 | `sha256:118e953cf6f1e54fc167f19f8de0fa0b39101ef0d07068fde99e28417f87615e` | format/typecheck/build/lint/test passed |

### Spec Compliance Matrix

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Primary-Responsibility Classification | Exact partition | Spec now carries the self-contained 30-package inventory table: 8 Core Business, 12 Platform-Enabled Domain, and 10 Technical Infrastructure entries; docs-only no-regression passed. | ✅ COMPLIANT |
| Context Boundary, Crossing, and Delegation-Work Separation | Crossings and routing | Proposal/design/spec preserve IDs/ports, no shared aggregates, Delegation ID routing, and no ambient authority; docs-only no-regression passed. | ✅ COMPLIANT |
| Deny-by-Default Authority | Reserved refused | Proposal/spec/apply-progress preserve the five reserved categories and explicit bounded grant rule; docs-only no-regression passed. | ✅ COMPLIANT |
| Bounded Temporary Roles | Bounded and expiring | Spec retains required temporary-role fields, expiry/revocation behavior, and human approval constraint; docs-only no-regression passed. | ✅ COMPLIANT |
| Platform-Enabled Semantics | Semantics survive | Spec preserves domain classification and semantic-survival invariant for platform-enabled packages; docs-only no-regression passed. | ✅ COMPLIANT |
| Contract Meta-Handoff | Labels and hypotheses | Traceability label readback returned 7 labeled lines; H1-H3 excluded, H4 enforced, H5/H6 deferred/resolved by next contract path; docs-only no-regression passed. | ✅ COMPLIANT |

**Compliance summary**: 6/6 scenarios compliant.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Primary-Responsibility Classification | ✅ Implemented | Requirement states exact 8+12+10=30 partition and includes the package names/category assignments needed for archive-time verification. |
| Context Boundary, Crossing, and Delegation-Work Separation | ✅ Implemented | Requirement preserves IDs/ports, no shared aggregate, Delegation/Work separation, and explicit valid states. |
| Deny-by-Default Authority | ✅ Implemented | Requirement preserves all five never-delegable human categories and bounded-grant default deny. |
| Bounded Temporary Roles | ✅ Implemented | Requirement preserves primary role plus temporary roles, expiry/revocation, SOD, budget, and human approval constraints. |
| Platform-Enabled Semantics | ✅ Implemented | Requirement preserves the 12 platform-enabled packages as domain-classified despite platform implementation. |
| Contract Meta-Handoff | ✅ Implemented | Requirement preserves traceability labels, non-binding inferred mechanisms, and H1-H6 handoff semantics. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Semantic authority | ✅ Yes | Proposal, spec, design, tasks, and apply-progress treat `exploration.md` as the approved semantic source and preserve traceability labels. |
| Boundary formalization | ✅ Yes | Artifacts formalize conceptual boundaries without creating interfaces, packages, source files, storage, or runtime behavior. |
| Deferred ownership | ✅ Yes | Delegation placement and mechanism design remain deferred to the next ports/trust contract; no premature package ownership was chosen. |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Found in `apply-progress.md`; Strict TDD is docs-only for this change because no runtime domain code exists. |
| All tasks have tests | ✅ | 8/8 apply-owned tasks have validation evidence; runtime RED tests are N/A by docs-only scope and design §Testing. |
| RED confirmed (tests exist) | ✅ | Applicable RED evidence is structural readback, not a runtime domain test; no created/modified product test file is required. |
| GREEN confirmed (tests pass) | ✅ | `pnpm test` passed under Node 24.18.1: 1 file, 2 tests. |
| Triangulation adequate | ✅ | 6 spec scenarios inspected; task 1.4 triangulates categories across proposal/spec/exploration. |
| Safety Net for modified files | ✅ | `pnpm check` passed; product/toolchain status outside OpenSpec is empty. |

**TDD Compliance**: 6/6 checks passed.

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 2 | 1 | Vitest |
| Integration | 0 | 0 | not enabled |
| E2E | 0 | 0 | not enabled |
| **Total** | **2** | **1** | |

---

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected/enabled for this repository (`testing.coverage: false`).

---

### Assertion Quality

**Assertion quality**: ✅ All assertions verify real behavior in the existing Vitest safety-net file (`test/toolchain-probe.test.ts`). No test files were created or modified by this docs-only change.

---

### Quality Metrics

**Linter**: ✅ No errors (`pnpm check` ran `biome lint .`, 7 files checked, no fixes applied)  
**Type Checker**: ✅ No errors (`tsc -p tsconfig.json` and `tsc -p tsconfig.build.json` passed)

### Issues Found

**CRITICAL**: None  
**WARNING**: None  
**SUGGESTION**: None

### Verdict

PASS

All 8 tasks are complete; proposal/spec/design/apply-progress are coherent; the spec contains exactly 6 requirements and 6 scenarios; docs-only scope is preserved; Node 24 no-regression checks passed; and the native review binding is allowed for `review-77439f7ed7870f93` at the post-apply gate.
