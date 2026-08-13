# Delta for skill

## ADDED Requirements

### Requirement: Intent-Captured Skill Usage Outcomes

An activated Skill SHALL be attributable only through the exact `{ skillId, version }` selection captured at intent from the compiler. A verified successful Work close SHALL emit one composite `work.skill-outcome` fact for that selection, including an empty selection; it SHALL NOT fan out one event per Skill. The selection SHALL NOT be re-evaluated at finalization. Failed or typed non-success paths SHALL emit no outcome. This requirement SHALL NOT define promotion, learning, expected-outcome comparison, consumer behavior, or a backfill.

#### Scenario: Captured version is attributed
- GIVEN intent selected a Skill at version 1 and version 2 becomes active before close
- WHEN the Work closes successfully
- THEN the emitted composite fact SHALL attribute version 1 only

#### Scenario: Failure emits no usage outcome
- GIVEN an intent has selected Skills
- WHEN the cycle ends as invalid-plan, denied, or recovery-required
- THEN no `work.skill-outcome` fact SHALL be emitted

#### Scenario: Historical Work remains untouched
- GIVEN Work completed before usage outcomes were introduced
- WHEN skills or event discovery are read
- THEN no outcome SHALL be synthesized for that Work
