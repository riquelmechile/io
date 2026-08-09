import { describe, expect, it, vi } from 'vitest';

import type { Delegation, Work } from '@io/business-domain/src/index.js';

import {
  CONTEXT_SCHEMA_VERSION,
  buildDynamicSuffix,
  buildStablePrefix,
  compileContext,
  deriveCohort,
} from '../src/index.js';

/**
 * Compiled output contract (Req R7 / design D2). `compileContext(input)` MUST
 * return `{ messages, user }` consumable by `LlmClient.complete`: `messages`
 * MUST be LlmMessage[]-compatible ([system prefix, user suffix]) and `user`
 * MUST be the derived cohort. Compilation MUST be pure and MUST NOT invoke any
 * client. LlmMessage compatibility is STRUCTURAL (D2): @io/context depends on
 * business-domain types only, so the test asserts the shape is assignable to a
 * structural mirror of the llm-client message contract.
 */

const work: Work = {
  workId: 'work-1',
  companyId: 'acme',
  delegationId: 'delegation-1',
  proposer: 'founder',
  description: 'execute the quarterly close',
  state: 'accepted',
  version: 1,
  fencingToken: 0,
  evidenceRefs: [],
};

const delegation: Delegation = {
  delegationId: 'delegation-1',
  companyId: 'acme',
  delegator: 'founder',
  delegate: 'worker-1',
  authorityScope: { scope: 'low-risk-documents', actions: ['create-document'] },
  budget: { currency: 'USD', limit: 100 },
  validFrom: 1,
  validUntil: 2,
  expectedOutcome: 'produce a single reversible create-document plan',
  state: 'active',
};

const input = { companyId: 'acme', process: 'planning', delegation, work };

/** Structural mirror of the llm-client message shape (design D2, BD-only dep). */
interface LlmMessageLike {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly reasoningContent?: string;
  readonly toolCalls?: readonly unknown[];
  readonly toolCallId?: string;
}

describe('compileContext — output contract (R7)', () => {
  it('returns messages as [system stable prefix, user dynamic suffix]', () => {
    const compiled = compileContext(input);
    expect(compiled.messages).toHaveLength(2);
    expect(compiled.messages[0]?.role).toBe('system');
    expect(compiled.messages[0]?.content).toBe(buildStablePrefix(input));
    expect(compiled.messages[1]?.role).toBe('user');
    expect(compiled.messages[1]?.content).toBe(buildDynamicSuffix(input));
  });

  it('messages are LlmMessage[]-compatible — structurally assignable to the client message shape', () => {
    const compiled = compileContext(input);
    const asClientMessages: readonly LlmMessageLike[] = compiled.messages;
    expect(asClientMessages[0]?.role).toBe('system');
    expect(asClientMessages[1]?.role).toBe('user');
    expect(typeof asClientMessages[0]?.content).toBe('string');
  });

  it('user is the derived cohort — io:{companyId}:{process}:v{CONTEXT_SCHEMA_VERSION}', () => {
    const compiled = compileContext(input);
    expect(compiled.user).toBe(
      deriveCohort({
        companyId: 'acme',
        process: 'planning',
        schemaVersion: CONTEXT_SCHEMA_VERSION,
      }),
    );
  });

  it('compilation is pure — a client spy is NOT invoked and output is deterministic', () => {
    const spy = { complete: vi.fn() };
    const first = compileContext(input);
    const second = compileContext(input);
    expect(spy.complete).not.toHaveBeenCalled();
    expect(second).toEqual(first);
  });

  it('user embeds the schema version — a version bump would change the compiled user (R6)', () => {
    const compiled = compileContext(input);
    expect(compiled.user).toContain(`v${CONTEXT_SCHEMA_VERSION}`);
  });
});
