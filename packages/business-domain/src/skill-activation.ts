import type { Skill, SkillState } from './types.js';

/**
 * Runtime guard for the explicit Skill lifecycle (R4): returns true ONLY for
 * `draft`, `active`, or `retired`, and narrows a plain string to
 * {@link SkillState}. Every other state is rejected — a malformed record never
 * passes as a Skill. Shared by the domain guard and the downstream PG row
 * parser (design: `SkillState` + `isSkillState`).
 */
export function isSkillState(value: string): value is SkillState {
  return value === 'draft' || value === 'active' || value === 'retired';
}

/**
 * The cohort a Skill activation is evaluated for (design). Selection is a pure
 * function of these values and each Skill's own state/scope — never work,
 * clocks, generated IDs, or dynamic-tail content.
 */
export interface SkillCohort {
  readonly companyId: string;
  readonly process: string;
  readonly schemaVersion: number;
}

/**
 * Pure, cohort-safe Skill activation (R5): selects the ACTIVE Skill versions
 * eligible for `cohort` from `skills`, deterministically.
 *
 * Purity / cache-poisoning inverse: the signature admits ONLY `(cohort,
 * skills)` — no work, no clocks, no generated IDs, no dynamic-tail content can
 * enter. The same cohort ALWAYS yields the same Skill identities and versions,
 * no matter what surrounds the call.
 *
 * Selection (design): filter `active` Skills whose `companyId` equals the
 * cohort's AND whose `scope` matches BOTH the cohort `process` and
 * `schemaVersion`; collapse to the max `version` per `skillId` (one Skill per
 * identity); sort `skillId` ASC for a stable cohort output.
 */
export function activeSkillsFor(cohort: SkillCohort, skills: readonly Skill[]): Skill[] {
  const latestBySkillId = new Map<string, Skill>();
  for (const skill of skills) {
    if (skill.state !== 'active') continue;
    if (skill.companyId !== cohort.companyId) continue;
    if (skill.scope.process !== cohort.process) continue;
    if (skill.scope.schemaVersion !== cohort.schemaVersion) continue;
    const current = latestBySkillId.get(skill.skillId);
    if (current === undefined || skill.version > current.version) {
      latestBySkillId.set(skill.skillId, skill);
    }
  }
  return [...latestBySkillId.values()].sort((a, b) => a.skillId.localeCompare(b.skillId));
}
