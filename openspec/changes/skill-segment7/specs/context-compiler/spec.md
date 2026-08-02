# Delta for context-compiler

## MODIFIED Requirements

### Requirement: Canonical Segment Ordering

`compileContext` MUST render: (1) DeepSeek protocol, (2) constitution, (3) corporate policies, (4) company and department, (5) role contract, (6) certified competencies, (7) active skills, (8) business process, (9) product/project baseline, (10) recovered memory, (11) current work, (12) recent evidence, (13) tool results. Segments 1–9 MUST form the stable prefix; 10–13 MUST form a non-interleaved suffix. Segment 7 MUST render cohort-selected active skills ordered by `skillId` ascending with only `skillId`, `name`, `version`, and `body`; an empty selection MUST render ABSENT with zero bytes. [REQ]
(Previously: Segment 7 was reserved in the canonical order but always rendered ABSENT.)

#### Scenario: Present segments follow canonical order
- GIVEN all segments are present
- WHEN the input is compiled
- THEN their order MUST be 1 through 13, with no suffix segment preceding or interleaving 1–9

#### Scenario: Segment 7 renders selected skills deterministically
- GIVEN matching active skills supplied in different insertion orders
- WHEN both inputs are compiled
- THEN segment 7 MUST contain only the fixed fields ordered by `skillId` ascending and MUST be byte-identical

#### Scenario: Empty skill selection remains absent
- GIVEN no skill is eligible for the cohort
- WHEN the input is compiled
- THEN segment 7 MUST be ABSENT and contribute zero bytes

### Requirement: Stable-Prefix Byte Stability

For a fixed tenant skill-store state, segments 1–9, including segment 7, MUST be byte-identical within cohort `io:{companyId}:{process}:v{schemaVersion}` and MUST be a pure function of that cohort and store. Work, delegation, clocks, identifiers, insertion order, and segments 10–13 MUST NOT affect or leak into prefix bytes. [REQ]
(Previously: Prefix stability did not include rendered skill content because segment 7 was always ABSENT.)

#### Scenario: Different work preserves prefix bytes
- GIVEN equal cohort inputs and different current work
- WHEN both inputs are compiled
- THEN prefix bytes MUST match while suffix bytes MAY differ

#### Scenario: Dynamic content cannot leak into the prefix
- GIVEN unique values in segments 10–13
- WHEN the input is compiled
- THEN none MUST occur in the prefix bytes

#### Scenario: Dynamic variation cannot poison segment 7
- GIVEN the same cohort and tenant skills with different work, delegation, dynamic-tail values, non-matching entries, and insertion order
- WHEN both inputs are compiled
- THEN the complete stable prefixes, including segment 7, MUST be byte-identical

### Requirement: Schema-Versioned Cohort Bump

Adding or changing a stable segment MUST change `schemaVersion` and `user`. Segment-7 content MUST use `CONTEXT_SCHEMA_VERSION` 2, re-deriving every cohort, and `prefix.v2.golden.txt` MUST pin the resulting prefix bytes. Changed prefix bytes MUST NOT be emitted under an existing cohort, and silent prefix changes MUST remain prohibited. [REQ]
(Previously: The schema-version rule existed at version 1 before segment 7 emitted content.)

#### Scenario: Stable-segment change bumps cohort
- GIVEN a release adds or changes a stable segment
- WHEN equivalent inputs are compiled across releases
- THEN the new release MUST change `schemaVersion` and `user`

#### Scenario: Silent prefix change is prohibited
- GIVEN requests with the same cohort value
- WHEN prefixes are compared byte-for-byte
- THEN every prefix MUST be identical

#### Scenario: Segment 7 uses schema version 2 golden bytes
- GIVEN the release that introduces rendered segment-7 content
- WHEN its cohort and stable prefix are produced
- THEN `CONTEXT_SCHEMA_VERSION` MUST equal 2 and `prefix.v2.golden.txt` MUST match the prefix byte-for-byte
