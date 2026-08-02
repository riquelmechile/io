# Delta for business-event

## ADDED Requirements

### Requirement: Read-Only Company Discovery

`listCompanyIds()` MUST return each company represented in the event log once through a read-only distinct `company_id` selection. It MUST NOT append, update, delete, or otherwise mutate events.

#### Scenario: Discovery returns distinct companies
- GIVEN interleaved events for companies A and B with repeated company IDs
- WHEN company IDs are listed
- THEN A and B MUST each appear exactly once

#### Scenario: Discovery preserves event facts
- GIVEN a snapshot of the append-only event log
- WHEN `listCompanyIds()` executes
- THEN the snapshot MUST remain unchanged
- AND terminal-close facts MUST remain the only worker-emitted events

## MODIFIED Requirements

### Requirement: Append-Only Repository Port

`BusinessEventRepository` MUST expose only `append(event)`, `listByCompany(companyId)`, and read-only `listCompanyIds()`. It MUST NOT expose update, delete, or overwrite operations.
(Previously: The port exposed only append and tenant-scoped event listing.)

#### Scenario: Port surface prevents mutation
- GIVEN the repository contract
- WHEN its operations are inspected
- THEN only append and read-only listing operations MUST be available
