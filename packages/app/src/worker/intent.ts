import type { ActivatedSkillRef, ModelTier } from '@io/business-domain/src/index.js';
import { evidenceId } from '@io/business-domain/src/evidence-id.js';
import type { Delegation, Skill, Work } from '@io/business-domain/src/types.js';
import { parseLlmPlan } from '@io/business-domain/src/validation/llm-plan.js';
import type { LlmPlanShape } from '@io/business-domain/src/validation/llm-plan.js';
import { compileContext } from '@io/context/src/index.js';
import type { LlmClient, LlmRequest } from '@io/llm-client/src/index.js';

import type { SandboxAction } from '../sandbox/sandbox-port.js';
import { llmModelFor } from './model-tier.js';

/**
 * Worker intent (WC intent-before-effect / runtime-validation /
 * evidenceId-stable): compile the canonical context via `compileContext` (the
 * stable system prefix + the work tail + the derived cache cohort), validate
 * the UNTRUSTED model output via `parseLlmPlan` and the business command via
 * `parseCommand` (typed rejects — never passed through), and derive the
 * retry-stable `attemptId` (`att:` scheme, receipt-traceable) and `evidenceId`
 * (`ev:${companyId}:${idempotencyKey}`). The returned action is the single
 * reversible create-document effect the sandbox will execute AFTER the journal
 * in-flight row is committed.
 */

/** Deterministic attempt id for a (companyId, idempotencyKey): one attempt per
 * key (UNIQUE(company_id, idempotency_key)) keeps the receipt's
 * terminal_event_id traceable — same scheme as completeWork. */
export function attemptIdFor(companyId: string, idempotencyKey: string): string {
  return `att:${companyId}:${idempotencyKey}`;
}

/**
 * Transitional process token (design D3): the cohort discriminator is the
 * delegation's authority scope until a process package exists. Documented
 * stand-in — the compiler receives `process` as plain input, so swapping the
 * source later is composition-root-only.
 */
export function processTokenFor(delegation: Delegation): string {
  return delegation.authorityScope.scope;
}

export interface IntentInput {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly work: Work;
  /** The delegation checkAuthority already fetched (D5 — no second fetch). */
  readonly delegation: Delegation;
  /** The tenant skill store, fetched once after authority (skill R7): the
   * compiler cohort-selects the ACTIVE matching skills into segment 7. Skills
   * only condition the plan via context — the worker never executes them. */
  readonly skills?: readonly Skill[];
  readonly llm: LlmClient;
  /** The heartbeat-selected domain tier (ModelTier), threaded unchanged from
   * `runWorker`. Mapped to the `LlmModel` ONLY via `llmModelFor` at the LLM
   * boundary — the SAME stable context prefix serves both tiers (KV cache
   * intact; only the request model differs). */
  readonly model: ModelTier;
}

export type IntentResult =
  | {
      ok: true;
      attemptId: string;
      evidenceId: string;
      plan: LlmPlanShape;
      action: SandboxAction;
      /** The intent-captured skill selection (skill-outcome design): the EXACT
       * `{ skillId, version }` refs `compileContext` surfaced from its single
       * segment-7 selection. Immutable snapshot — threaded to finalization and
       * NEVER re-derived (a version bump after intent cannot change it). */
      activatedSkills: readonly ActivatedSkillRef[];
    }
  | { ok: false; reason: 'invalid-plan'; detail: string };

export async function prepareIntent(input: IntentInput): Promise<IntentResult> {
  const compiled = compileContext({
    companyId: input.companyId,
    process: processTokenFor(input.delegation),
    delegation: input.delegation,
    work: input.work,
    skills: input.skills,
  });
  const request: LlmRequest = {
    model: llmModelFor(input.model),
    messages: compiled.messages,
    thinking: { type: 'disabled' },
    user: compiled.user,
  };
  const response = await input.llm.complete(request);

  let raw: unknown;
  try {
    raw = JSON.parse(response.content);
  } catch {
    return { ok: false, reason: 'invalid-plan', detail: 'model output is not valid JSON' };
  }
  const parsed = parseLlmPlan(raw);
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid-plan', detail: parsed.reason };
  }
  const plan = parsed.value;
  const action = createDocumentActionFromPlan(plan);
  if (action === undefined) {
    return {
      ok: false,
      reason: 'invalid-plan',
      detail: 'plan has no create-document step with a relativePath and content',
    };
  }

  return {
    ok: true,
    attemptId: attemptIdFor(input.companyId, input.idempotencyKey),
    evidenceId: evidenceId(input.companyId, input.idempotencyKey),
    plan,
    action,
    // The compiler's single-pass selection, projected verbatim (never
    // re-selected): the LLM request still carries ONLY `{ messages, user }`.
    activatedSkills: compiled.activatedSkills,
  };
}

/** Extract the single create-document SandboxAction from a validated plan. */
function createDocumentActionFromPlan(plan: LlmPlanShape): SandboxAction | undefined {
  const step = plan.steps.find((candidate) => candidate.action === 'create-document');
  if (step === undefined) return undefined;
  const args = step.args as Record<string, unknown>;
  const relativePath = args.relativePath;
  const content = args.content;
  if (typeof relativePath !== 'string' || relativePath === '') return undefined;
  if (typeof content !== 'string') return undefined;
  return { type: 'create-document', relativePath, content };
}
