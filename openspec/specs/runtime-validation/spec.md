# runtime-validation Specification

## Purpose

Runtime validation provides explicit, runtime guards that parse untrusted inputs
and return typed results rather than relying on TypeScript compile-time types
alone. Each guard returns `{ ok: true, value }` on success or
`{ ok: false, reason }` on rejection. Rejection MUST be explicit and typed, not a
thrown exception used for control flow. Guards cover business commands (in
`business-domain`), plain LLM plan shapes (in `business-domain`, with no coupling
to `@io/llm-client`), and PostgreSQL rows (in `database`). An LLM plan is data,
never authority. [ADR-0002] [INF]

## Requirements

### Requirement: Typed Guard Result Contract

Every runtime guard MUST accept `unknown` and return
`{ ok: true, value } | { ok: false, reason }`. On rejection the guard MUST return
`{ ok: false, reason }` with a non-empty `reason` and MUST NOT throw to signal an
invalid input. Guards MUST perform real runtime structural checks and MUST NOT be
satisfied by TypeScript types alone: a value that type-checks but is structurally
invalid at runtime MUST still be rejected. [INF]

#### Scenario: Valid input parses

- GIVEN a structurally valid input
- WHEN a guard parses it
- THEN it MUST return `{ ok: true, value }` with the parsed value

#### Scenario: Invalid input rejected with reason

- GIVEN a structurally invalid input
- WHEN a guard parses it
- THEN it MUST return `{ ok: false, reason }` with a non-empty `reason` and MUST NOT throw

#### Scenario: Runtime check, not type-only

- GIVEN a value that satisfies the static type but is structurally corrupt at runtime
- WHEN a guard parses it
- THEN it MUST be rejected with `{ ok: false, reason }`

### Requirement: Command Guard

The business-domain package MUST provide a command guard (`parseCommand(unknown)`)
that validates business command inputs and returns the typed guard result. The
guard MUST live in `business-domain` and MUST NOT import any `@io/*` package
(business-domain purity). [INF]

#### Scenario: Valid command parses

- GIVEN a well-formed business command
- WHEN `parseCommand` is invoked
- THEN it MUST return `{ ok: true, value }`

#### Scenario: Invalid command rejected with reason

- GIVEN a malformed business command
- WHEN `parseCommand` is invoked
- THEN it MUST return `{ ok: false, reason }` with a non-empty `reason`

### Requirement: LLM Plan Guard

The business-domain package MUST provide an LLM-plan guard
(`parseLlmPlan(unknown)`) that validates a PLAIN, in-domain `LlmPlanShape` of the
form `{ steps: { action, args }[], intent? }`. The caller MUST JSON-parse the raw
model output before invoking the guard. The guard MUST NOT import `@io/llm-client`
or any LLM SDK; it operates on a plain shape only. A parsed plan MUST be treated
as untrusted data and MUST NOT grant authority. [INF]

#### Scenario: Valid plan shape parses

- GIVEN a plain object matching `LlmPlanShape`
- WHEN `parseLlmPlan` is invoked
- THEN it MUST return `{ ok: true, value }`

#### Scenario: Malformed plan rejected

- GIVEN a plain object that does not match `LlmPlanShape`
- WHEN `parseLlmPlan` is invoked
- THEN it MUST return `{ ok: false, reason }` with a non-empty `reason`

#### Scenario: Guard stays in-domain and plan is non-authority

- GIVEN the LLM-plan guard module
- WHEN its imports and result are inspected
- THEN it MUST NOT import `@io/llm-client` or any LLM SDK, and a parsed plan MUST confer no authority

### Requirement: PostgreSQL Row Guards

The database package MUST provide row guards that validate rows read from
PostgreSQL before they are used, returning the typed guard result. A corrupt or
unexpected row MUST be rejected with a reason rather than passed through. [INF]

#### Scenario: Valid row passes

- GIVEN a well-formed row read from PostgreSQL
- WHEN a row guard validates it
- THEN it MUST return `{ ok: true, value }`

#### Scenario: Corrupt row rejected

- GIVEN a corrupt or malformed row read from PostgreSQL
- WHEN a row guard validates it
- THEN it MUST return `{ ok: false, reason }` with a non-empty `reason`
