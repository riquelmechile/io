# Delta for io-ports-trust-contract

## ADDED Requirements

### Requirement: Persistence-Free Pipeline Scoping

While persistence and adapters are unavailable (roadmap Increment 2), the 16-step
authority pipeline is partitioned into enforceable in-memory steps and deferred
hardening steps. Enforceable without persistence: classification, authority
(explicit grant existence), identity, assignment, bounded scope, evidence
collection, SOD, expiry/revocation, action scope, and final check. Deferred to
downstream hardening (require persisted delegation, policy-version store, budget
reservation, real approval chains, auditable human exceptions, or persistent
records): delegation lifecycle, policy version, budget, approvals, exceptions,
and records persistence. During the persistence-free slice, deferred steps MUST
execute as explicit no-op pass-throughs documented as "harden downstream" and
MUST NOT be implemented as real behavior; the pipeline MUST still DENY on ANY
failed enforceable step. This requirement qualifies, and does not alter, the
canonical fixed 16-step ordering in "Default-Deny Authority with Reserved
Categories." [ADR-0002] [ADR-0003] [INF]

#### Scenario: Enforceable steps gate without persistence

- GIVEN an action evaluated without persistence or adapters
- WHEN the enforceable in-memory steps run
- THEN classification, grant, identity, assignment, scope, evidence, SOD, expiry, and action scope MUST each gate the decision and any failure MUST DENY

#### Scenario: Deferred steps pass through explicitly

- GIVEN the persistence-free slice reaching a deferred step
- WHEN delegation/policy-version/budget/approvals/exceptions/records are evaluated
- THEN each MUST be a documented no-op pass-through and MUST NOT be implemented as real behavior
