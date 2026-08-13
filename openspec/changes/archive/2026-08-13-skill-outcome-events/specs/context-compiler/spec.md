# Delta for context-compiler

## MODIFIED Requirements

### Requirement: Compiled Output Contract

`compileContext(input)` SHALL return `{ messages, user, activatedSkills }` consumable by `LlmClient.complete` after projection to `{ messages, user }`. `activatedSkills` SHALL expose the exact segment-7 cohort selection as ordered `{ skillId, version }` values, including an empty list when none is selected. `messages` SHALL remain `LlmMessage[]`-compatible with stable system prefix before dynamic suffix, and `user` SHALL remain the derived cohort. Compilation SHALL be pure and SHALL NOT invoke the client. Adding this output field SHALL leave the bytes of `messages` and `user`, including schema version and cohort, unchanged for identical input.

(Previously: output exposed only `{ messages, user }`.)

#### Scenario: LlmClient-compatible result
- GIVEN a valid input and client spy
- WHEN `compileContext` returns
- THEN `messages` and `user` SHALL be valid `LlmClient.complete` fields
- AND the client SHALL not have been invoked

#### Scenario: Exact selected identities are surfaced
- GIVEN segment 7 selects Skills in a deterministic order
- WHEN context is compiled
- THEN `activatedSkills` SHALL equal those selected `{ skillId, version }` pairs in that order

#### Scenario: Output extension is byte-stable
- GIVEN identical compiler input before and after this output extension
- WHEN context is compiled
- THEN `messages` and `user` SHALL be byte-identical to the prior contract

#### Scenario: Empty selection is explicit without rendering change
- GIVEN no Skills are eligible for the cohort
- WHEN context is compiled
- THEN `activatedSkills` SHALL be an empty list and segment 7 SHALL remain absent with zero bytes
