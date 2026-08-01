# Delta for context-compiler

## ADDED Requirements

### Requirement: Canonical Segment Ordering

`compileContext` MUST render: (1) DeepSeek protocol, (2) constitution, (3) corporate policies, (4) company and department, (5) role contract, (6) certified competencies, (7) active skills, (8) business process, (9) product/project baseline, (10) recovered memory, (11) current work, (12) recent evidence, (13) tool results. Segments 1–9 MUST form the stable prefix; 10–13 MUST form a non-interleaved suffix. [REQ]

#### Scenario: Present segments follow canonical order

- GIVEN all segments are present
- WHEN the input is compiled
- THEN their order MUST be 1 through 13, with no suffix segment preceding or interleaving 1–9

### Requirement: Stable-Prefix Byte Stability

Segments 1–9 MUST be byte-identical within a cohort and a pure function of cohort inputs. Segments 10–13 MUST NOT affect or leak into those bytes. [REQ]

#### Scenario: Different work preserves prefix bytes

- GIVEN equal cohort inputs and different current work
- WHEN both inputs are compiled
- THEN prefix bytes MUST match while suffix bytes MAY differ

#### Scenario: Dynamic content cannot leak into the prefix

- GIVEN unique values in segments 10–13
- WHEN the input is compiled
- THEN none MUST occur in the prefix bytes

### Requirement: Forbidden Leading Content

The prefix MUST NOT start with a current date, random id, nonce, heartbeat, recent snapshot, variable message, or tool result. Its first byte MUST come from the lowest-numbered present stable segment. [REQ]

#### Scenario: Forbidden values cannot lead

- GIVEN values for every forbidden category
- WHEN the input is compiled
- THEN none MUST precede the first present stable segment

#### Scenario: Lowest present stable segment leads

- GIVEN segments 1–2 ABSENT and segment 3 present
- WHEN the input is compiled
- THEN the prefix MUST begin with segment 3

### Requirement: Absent-Segment Rendering

An unsourced segment MUST render ABSENT with zero bytes at its fixed position; it MUST NOT shift or reorder another segment. [REQ]

#### Scenario: Missing sources remain in place

- GIVEN segments 1, 8, and 11 present (sourced) and segments 2–7, 9–10, and 12–13 unsourced
- WHEN the input is compiled
- THEN the unsourced segments MUST be ABSENT (zero bytes) at their fixed positions without moving segment 11

### Requirement: Cache-Cohort Derivation

`compileContext` MUST derive `user` as `io:{companyId}:{process}:v{schemaVersion}`, not accept it from callers. It MUST exclude PII and ignore segments 10–13. Cohort peers MUST share policy, privacy, and exact prefix bytes. [REQ]

#### Scenario: Cohort has the derived shape

- GIVEN companyId `acme`, process `planning`, version `2`, and caller cohort `x`
- WHEN the input is compiled
- THEN `user` MUST equal `io:acme:planning:v2`

#### Scenario: Dynamic tail does not fragment the cohort

- GIVEN equal cohort inputs and different segments 10–13
- WHEN both inputs are compiled
- THEN their `user` values MUST match

#### Scenario: Cohort excludes personal data

- GIVEN inputs containing a name, email, and work description
- WHEN `user` is derived
- THEN `user` MUST contain none of those values

### Requirement: Schema-Versioned Cohort Bump

Adding or changing a stable segment MUST change `schemaVersion` and `user`. Changed prefix bytes MUST NOT be emitted under an existing cohort. [REQ]

#### Scenario: Stable-segment change bumps cohort

- GIVEN a release adds or changes a stable segment
- WHEN equivalent inputs are compiled across releases
- THEN the new release MUST change `schemaVersion` and `user`

#### Scenario: Silent prefix change is prohibited

- GIVEN requests with the same cohort value
- WHEN prefixes are compared byte-for-byte
- THEN every prefix MUST be identical

### Requirement: Compiled Output Contract

`compileContext(input)` MUST return `{ messages, user }` consumable by `LlmClient.complete`. `messages` MUST be `LlmMessage[]`-compatible, with stable system prefix before dynamic suffix; `user` MUST be the derived cohort. Compilation MUST be pure and MUST NOT invoke the client. [INF]

#### Scenario: LlmClient-compatible result

- GIVEN a valid input and client spy
- WHEN `compileContext` returns
- THEN `messages` and `user` MUST be valid `LlmClient.complete` fields
- AND the client MUST NOT have been invoked
