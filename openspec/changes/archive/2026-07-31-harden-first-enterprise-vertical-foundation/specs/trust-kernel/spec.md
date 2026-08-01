# Delta for trust-kernel

## MODIFIED Requirements

### Requirement: In-Memory Separation of Duties

SOD MUST be enforced per risk tier. No principal MAY self-approve or self-verify
at ANY tier. The pair `proposer ≠ approver` MUST be an ABSOLUTE prohibition
enforced at EVERY risk tier, including low-risk actions evaluated under
`allowsLowCombination`; a single principal MUST NOT be both proposer and approver
under any policy. Medium-risk proposer/approver/executor/verifier MUST be mutually
distinct; critical and high-risk MUST use five distinct principals; low-risk MAY
combine OTHER roles only when policy permits, but NEVER proposer with approver.
Every prohibited role overlap MUST produce a DENY. [ADR-0003]
(Previously: `proposer ≠ approver` was not an absolute pair; low-risk + `allowsLowCombination` could self-approve.)

#### Scenario: Self-approval denied (approver and executor)

- GIVEN one principal acting as both approver and executor
- WHEN SOD is checked
- THEN the action MUST be DENIED

#### Scenario: Self-verification denied (verifier and executor)

- GIVEN one principal acting as both verifier and executor
- WHEN SOD is checked
- THEN the action MUST be DENIED

#### Scenario: Low-risk proposer equals approver denied

- GIVEN a low-risk action evaluated with `allowsLowCombination: true` and one principal acting as both proposer and approver
- WHEN SOD is checked
- THEN the action MUST be DENIED despite the low-risk combination allowance

#### Scenario: Distinct proposer and approver allowed

- GIVEN a low-risk action with `allowsLowCombination: true` where the proposer and approver are distinct principals
- WHEN SOD is checked
- THEN the proposer/approver pair MUST NOT itself cause a DENY

### Requirement: Scoped In-Memory Evaluation Pipeline

The trust kernel MUST evaluate actions through the persistence-free subset of the 16-step pipeline: classification → authority → identity → assignment → bounded scope → evidence → SOD → expiry/revocation → action scope → final check. The `evaluate()` function MUST be async and MUST return `Promise<EvaluationResult>`; its `finalize()` step MUST `await` any injected repository operations (evidence `save`, audit `append`) so a real downstream's completion is honored. Delegation lifecycle, policy version, budget reservation, real approvals, and persistent records MUST be treated as no-op pass-through stubs explicitly deferred to downstream hardening and MUST NOT be silently implemented. A deferred/no-op step MUST NOT emit a silent `ALLOW`; it MUST record an explicit non-ALLOW marker (for example `DEFERRED` or `NOT_EVALUATED`) so unimplemented behavior is honestly surfaced. The kernel MUST DENY on ANY failed enforced step. [ADR-0003] [INF]
(Previously: deferred no-op steps were recorded with decision `ALLOW`, a silent ALLOW that masked unimplemented behavior.)

#### Scenario: Pass-through steps documented

- GIVEN the trust kernel pipeline
- WHEN delegation/policy-version/budget/approval/records steps are reached
- THEN they MUST execute as documented no-op pass-throughs and MUST NOT be implemented as real behavior

#### Scenario: Any failure denies

- GIVEN an action failing one enforced step
- WHEN the pipeline runs
- THEN the final decision MUST be DENY

#### Scenario: Callers must await evaluate

- GIVEN any caller invoking `evaluate()`
- WHEN it consumes the result
- THEN it MUST `await` the returned `Promise<EvaluationResult>` or the decision is not obtained (the compiler MUST surface a missing `await`)

#### Scenario: Deferred step records a non-ALLOW marker

- GIVEN a deferred no-op step (delegation, approvals, records, budget, exceptions, or policy-version)
- WHEN the pipeline reaches it
- THEN the step record MUST carry an explicit non-ALLOW marker such as `DEFERRED` or `NOT_EVALUATED` and MUST NOT carry a silent `ALLOW`

## ADDED Requirements

### Requirement: Activation Window Gate

The kernel MUST evaluate temporal authority with a window gate `isWindowActive(start, now, expiry)` that returns active ONLY when `start <= now < expiry`. A grant or temporary assignment whose `start` is in the future (`start > now`) MUST be treated as NOT active. An expired window (`now >= expiry`) MUST be NOT active. This gate MUST be applied wherever grant or assignment activity is decided (grant checks, active-identity resolution, and the expiry gate). [ADR-0001] [INF]

#### Scenario: Future-start grant is inactive

- GIVEN a grant with `start > now`
- WHEN `isWindowActive(start, now, expiry)` is evaluated
- THEN it MUST return inactive and the grant MUST confer no authority

#### Scenario: Active window passes

- GIVEN a grant with `start <= now < expiry`
- WHEN `isWindowActive(start, now, expiry)` is evaluated
- THEN it MUST return active

#### Scenario: Expired window fails

- GIVEN a grant with `now >= expiry`
- WHEN `isWindowActive(start, now, expiry)` is evaluated
- THEN it MUST return inactive

#### Scenario: Boundary start equals now is active

- GIVEN a grant with `start == now` and `now < expiry`
- WHEN `isWindowActive(start, now, expiry)` is evaluated
- THEN it MUST return active

#### Scenario: Boundary now equals expiry is inactive

- GIVEN a grant with `now == expiry`
- WHEN `isWindowActive(start, now, expiry)` is evaluated
- THEN it MUST return inactive
