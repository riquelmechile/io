import type { ParseResult } from './command.js';

/**
 * LLM-plan guard (design D7, runtime-validation spec): `parseLlmPlan(unknown)`
 * validates a PLAIN, in-domain plan shape `{ steps: { action, args }[], intent? }`.
 * The caller JSON-parses the raw model output BEFORE invoking this guard; this
 * module NEVER imports `@io/llm-client` or any LLM SDK and never talks to a
 * model. A parsed plan is UNTRUSTED DATA — it confers no authority and has no
 * access to any repository. Invalid input is an explicit
 * `{ ok: false; reason }` result, never a thrown exception.
 */

/** One planned action: a verb + its arguments (object or positional array). */
export interface LlmPlanStep {
  readonly action: string;
  readonly args: Record<string, unknown> | readonly unknown[];
}

/** The plain in-domain plan shape validated by this guard. */
export interface LlmPlanShape {
  readonly steps: readonly LlmPlanStep[];
  readonly intent?: string;
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

export function parseLlmPlan(input: unknown): ParseResult<LlmPlanShape> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('llm-plan must be an object');
  }
  const record = input as Record<string, unknown>;

  const steps = record.steps;
  if (!Array.isArray(steps)) {
    return fail('llm-plan.steps must be an array');
  }
  if (steps.length === 0) {
    return fail('llm-plan.steps must contain at least one step');
  }

  const parsedSteps: LlmPlanStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      return fail(`llm-plan.steps[${index}] must be an object`);
    }
    const stepRecord = step as Record<string, unknown>;
    const action = stepRecord.action;
    if (typeof action !== 'string' || action === '') {
      return fail(`llm-plan.steps[${index}].action must be a non-empty string`);
    }
    const args = stepRecord.args;
    if (typeof args !== 'object' || args === null) {
      return fail(`llm-plan.steps[${index}].args must be an object or array`);
    }
    parsedSteps.push({ action, args: args as LlmPlanStep['args'] });
  }

  const intent = record.intent;
  if (intent !== undefined && typeof intent !== 'string') {
    return fail('llm-plan.intent must be a string');
  }

  return {
    ok: true,
    value: {
      steps: parsedSteps,
      ...(intent !== undefined ? { intent } : {}),
    },
  };
}
