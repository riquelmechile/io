import { evidenceId } from '@io/business-domain/src/evidence-id.js';
import type { Work } from '@io/business-domain/src/types.js';
import { parseLlmPlan } from '@io/business-domain/src/validation/llm-plan.js';
import type { LlmPlanShape } from '@io/business-domain/src/validation/llm-plan.js';
import type { LlmClient, LlmMessage, LlmRequest } from '@io/llm-client/src/index.js';

import { STABLE_SYSTEM_PREFIX } from '../llm/stable-prefix.js';
import type { SandboxAction } from '../sandbox/sandbox-port.js';

/**
 * Worker intent (WC intent-before-effect / runtime-validation /
 * evidenceId-stable): build the LLM request (STABLE_SYSTEM_PREFIX + dynamic
 * user tail), validate the UNTRUSTED model output via `parseLlmPlan` and the
 * business command via `parseCommand` (typed rejects — never passed through),
 * and derive the retry-stable `attemptId` (`att:` scheme, receipt-traceable)
 * and `evidenceId` (`ev:${companyId}:${idempotencyKey}`). The returned action
 * is the single reversible create-document effect the sandbox will execute
 * AFTER the journal in-flight row is committed.
 */

/** Deterministic attempt id for a (companyId, idempotencyKey): one attempt per
 * key (UNIQUE(company_id, idempotency_key)) keeps the receipt's
 * terminal_event_id traceable — same scheme as completeWork. */
export function attemptIdFor(companyId: string, idempotencyKey: string): string {
  return `att:${companyId}:${idempotencyKey}`;
}

/** The dynamic per-work user tail (the ONLY per-request message that varies). */
export function buildUserTail(work: Work): string {
  return `Execute work ${work.workId} for company ${work.companyId}: ${work.description}. Produce a single reversible create-document plan.`;
}

/** The full request message pair: stable system prefix + dynamic user tail. */
export function buildIntentMessages(work: Work): readonly LlmMessage[] {
  return [
    { role: 'system', content: STABLE_SYSTEM_PREFIX },
    { role: 'user', content: buildUserTail(work) },
  ];
}

export interface IntentInput {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly work: Work;
  readonly llm: LlmClient;
}

export type IntentResult =
  | { ok: true; attemptId: string; evidenceId: string; plan: LlmPlanShape; action: SandboxAction }
  | { ok: false; reason: 'invalid-plan'; detail: string };

export async function prepareIntent(input: IntentInput): Promise<IntentResult> {
  const request: LlmRequest = {
    model: 'deepseek-v4-flash',
    messages: buildIntentMessages(input.work),
    thinking: { type: 'disabled' },
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
