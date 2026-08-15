/**
 * Canonical `learning.promote` scope (task 1.12): `learning.promote:<companyUtf8Bytes>:<companyId>:<skillUtf8Bytes>:<skillId>:v<positiveVersion>`.
 * Identity segments are length-prefixed by canonical UTF-8 BYTE length (mirroring `candidateIdFor`), so colons/non-ASCII never shift boundaries.
 * `promotionScopeFor` emits the canonical form (throwing {@link InvalidCandidateIdComponentError}); `parsePromotionScope` enforces byte counts,
 * canonical counts, well-formed Unicode, positive version, and byte-for-byte canonical re-encoding.
 */
import {
  hasLoneSurrogate,
  InvalidCandidateIdComponentError,
  type LearningSubject,
} from './learning-candidate.js';
import type { ParseResult } from './validation/command.js';

export type PromotionScopeValue = Readonly<{ companyId: string; subject: LearningSubject }>;

const SCOPE_PREFIX = 'learning.promote:';
const CANONICAL_INT = /^[1-9][0-9]*$/;
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function promotionScopeFor(companyId: string, subject: LearningSubject): string {
  if (hasLoneSurrogate(companyId)) throw new InvalidCandidateIdComponentError('companyId');
  if (hasLoneSurrogate(subject.skillId)) throw new InvalidCandidateIdComponentError('skillId');
  return `${SCOPE_PREFIX}${encoder.encode(companyId).length}:${companyId}:${encoder.encode(subject.skillId).length}:${subject.skillId}:v${subject.skillVersion}`;
}

const count = (text: string) => (CANONICAL_INT.test(text) ? Number(text) : undefined);

const sliceBytes = (s: string, byteCount: number): { value: string; rest: string } | undefined => {
  const bytes = encoder.encode(s);
  if (bytes.length < byteCount) return undefined;
  const value = decoder.decode(bytes.slice(0, byteCount));
  if (!s.startsWith(value)) return undefined;
  return { value, rest: s.slice(value.length) };
};

export function parsePromotionScope(scope: unknown): ParseResult<PromotionScopeValue> {
  if (typeof scope !== 'string' || scope === '') return fail('scope must be a non-empty string');
  if (hasLoneSurrogate(scope)) return fail('scope must be well-formed Unicode');
  if (!scope.startsWith(SCOPE_PREFIX)) return fail('scope must start with "learning.promote:"');
  const rest = scope.slice(SCOPE_PREFIX.length);
  const sep1 = rest.indexOf(':');
  const companyBytes = sep1 < 0 ? undefined : count(rest.slice(0, sep1));
  if (companyBytes === undefined)
    return fail('scope company byte length must be canonical positive');
  const company = sliceBytes(rest.slice(sep1 + 1), companyBytes);
  if (!company) return fail('scope company segment must match its byte length');
  if (!company.rest.startsWith(':')) return fail('scope must carry the skill byte length');
  const afterColon = company.rest.slice(1);
  const sep2 = afterColon.indexOf(':');
  const skillBytes = sep2 < 0 ? undefined : count(afterColon.slice(0, sep2));
  if (skillBytes === undefined) return fail('scope skill byte length must be canonical positive');
  const skill = sliceBytes(afterColon.slice(sep2 + 1), skillBytes);
  if (!skill) return fail('scope skill segment must match its byte length');
  if (!skill.rest.startsWith(':v')) return fail('scope must end with ":v<version>"');
  const versionText = skill.rest.slice(2);
  if (!CANONICAL_INT.test(versionText)) return fail('scope version must be a positive integer');
  const version = Number(versionText);
  const companyId = company.value;
  const skillId = skill.value;
  const reencoded = promotionScopeFor(companyId, { skillId, skillVersion: version });
  if (reencoded !== scope) return fail('scope must be byte-for-byte the canonical re-encoding');
  return {
    ok: true,
    value: Object.freeze({ companyId, subject: Object.freeze({ skillId, skillVersion: version }) }),
  };
}
