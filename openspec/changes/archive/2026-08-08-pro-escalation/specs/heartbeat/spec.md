# Delta for heartbeat

## ADDED Requirements

### Requirement: Deterministic Model-Tier Escalation

For an activation, the domain MUST select `pro` iff at least one novel material event after the cursor has a valid `payload.riskClass` at or above `PRO_ESCALATION_THRESHOLD = 'high'` (`high` or `critical`); otherwise it MUST select `flash`. Selection MUST be a pure function of `(events, cursor)` and MUST NOT consult `occurredAt`, clocks, LLMs, or randomness. No risk-signal producer is introduced, so absent or invalid facts MUST remain cost-safe as `flash`.

#### Scenario: Threshold and above select Pro
- GIVEN novel material events carrying `high` or `critical` risk
- WHEN the heartbeat is evaluated after the cursor
- THEN the activation model MUST be `pro`

#### Scenario: Below, absent, invalid, or seen risk defaults to Flash
- GIVEN risk is `low`, `medium`, absent, invalid, non-material, or at/before the cursor
- WHEN the heartbeat is evaluated with material novelty
- THEN the activation model MUST be `flash`

#### Scenario: Ambient nondeterminism cannot affect tier
- GIVEN identical events and cursor while clock, LLM output, and randomness vary
- WHEN model selection is repeated
- THEN every selected model MUST be identical

## MODIFIED Requirements

### Requirement: Pure Heartbeat Decision

`business-domain` MUST define `HeartbeatDecision` as `{ kind: 'activate', model: 'flash' | 'pro' } | { kind: 'no-llm-heartbeat' }`, deterministically and with zero `@io/*` imports or runtime dependencies.

(Previously: The activation model was restricted to `flash`.)

#### Scenario: Decision type remains pure
- GIVEN a valid decision branch
- WHEN constructed repeatedly
- THEN the values MUST be equal
- AND boundary checks MUST find no forbidden import or dependency
