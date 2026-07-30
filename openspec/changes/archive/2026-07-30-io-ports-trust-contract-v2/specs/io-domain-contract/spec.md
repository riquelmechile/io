# Delta for io-domain-contract

Resolves the deferred ports/trust handoff from `io-domain-contract` by moving
the default-deny mechanism, classification-before-authority ordering,
no-aggregate-sharing enforcement, and traceable downstream records into the
resolved `io-ports-trust-contract` capability.

## MODIFIED Requirements

### Requirement: Deny-by-Default Authority

Five categories MUST NEVER be autonomously delegated: purpose, capital, critical
limits, irreversible actions, constitutional modification. Every other action
MUST require an explicit grant with budget, scope, risk classification, and
evidence. The default-deny mechanism, the risk-classification-before-authority
ordering, the no-aggregate-sharing enforcement, and the required audit/recovery
records are now defined normatively in the `io-ports-trust-contract` capability
and are no longer deferred. [SRC §2.1] [INF]

(Previously: mechanism and default-deny policy were deferred to the next ports/trust contract; they are now resolved in `io-ports-trust-contract`.)

#### Scenario: Reserved refused

- GIVEN an action in a reserved category, or a non-reserved action without a grant
- WHEN autonomous delegation is requested
- THEN reserved actions MUST be refused (human-only) and others MUST be denied absent an explicit bounded grant

#### Scenario: Mechanism resolved downstream

- GIVEN a non-reserved action requiring an explicit bounded grant
- WHEN the default-deny mechanism and classification ordering are applied
- THEN they MUST conform to the `io-ports-trust-contract` capability rather than being treated as an open handoff

### Requirement: Contract Meta-Handoff

Every substantive claim MUST carry a traceability label. Inferred mechanism
candidates (cron, state machines, checkpoints, compensation, middleware) MUST
stay non-binding and MUST NOT finalize any tool or library. The ports/trust
handoff is now resolved: the `io-ports-trust-contract` capability HAS excluded
H1–H3 as pure design, HAS enforced H4 (no-aggregate-sharing), and HAS resolved
H5 (classification before authority) and H6 (mechanism, default-deny). No
outstanding ports/trust handoff remains for this contract. [INF] [ADR-0002]

(Previously: stated the next ports/trust contract must exclude H1–H3, enforce H4, and resolve H5/H6; that contract now exists and those items are resolved.)

#### Scenario: Labels and hypotheses

- GIVEN any claim, inferred candidate, or hypotheses H1–H6
- WHEN inspected or the resolved contract is reviewed
- THEN claims MUST be labeled, inferred candidates MUST NOT be finalized without design/ADR, H1–H3 MUST be ignored as pure design, and H4/H5/H6 MUST be treated as resolved by `io-ports-trust-contract`
