import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmUsage,
} from '../src/llm-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const portSource = readSource('src/llm-client.ts');

/**
 * Forbidden module specifiers for the LlmClient port (Req: LlmClient Port
 * Purity, scenario 2): the port is a driver-free, SDK-free, framework-free seam.
 * The DeepSeek API shape, the `openai` SDK, HTTP, and the network live ONLY in
 * the adapter (`deepseek-client.ts`) — the port itself MUST carry zero API-shape
 * or transport knowledge beyond the abstract request/response types.
 */
const forbiddenSpecifiers: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'LLM/agentic SDK or framework',
    pattern:
      /^(openai|anthropic|@anthropic-ai|langchain|@langchain|langgraph|@ai-sdk|^ai$|crewai|autogen|mastra|paperclip|llamaindex|@llamaindex)(\/|$)/i,
  },
  {
    label: 'HTTP/framework server',
    pattern: /^(express|fastify|koa|hapi|polka|next|@nestjs)(\/|$)/,
  },
  {
    label: 'fetch/HTTP client',
    pattern: /^(node:)?(undici|fetch|axios|got|ky|node-fetch|superagent)(\/|$)/i,
  },
  { label: 'filesystem', pattern: /^(node:)?fs(\/|$)/ },
  { label: 'network', pattern: /^(node:)?(net|https?|dgram|dns|tls)(\/|$)/ },
  { label: 'subprocess/daemon', pattern: /^(node:)?(child_process|cluster|worker_threads)(\/|$)/ },
];

/**
 * Transport / provider-shape tokens the port MUST NOT mention: a fixed
 * `baseURL`, an `Authorization`/`Bearer` header, the chat-completions path, or
 * snake_case API fields. Their presence would mean the port knows about the
 * transport or the provider's wire shape, violating "zero API-shape knowledge
 * beyond the abstract request/response types" (Req scenario 2; threat: leakage).
 */
const transportTokens = [
  'api.deepseek.com',
  'chat/completions',
  'chat.completions',
  'Authorization',
  'Bearer',
  'reasoning_content',
  'reasoning_effort',
  'prompt_tokens',
  'completion_tokens',
];

function readSource(rel: string): string {
  const abs = join(pkgRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`expected source file not found: ${rel} (RED until llm-client.ts exists)`);
  }
  return readFileSync(abs, 'utf8');
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticImport = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticImport)) specs.push(match[1] ?? '');
  for (const match of source.matchAll(dynamicImport)) specs.push(match[1] ?? '');
  return specs;
}

/**
 * Strip comments so purity is measured against CODE/types only, not
 * architectural documentation (the port legitimately explains "SDK lives in the
 * adapter" in JSDoc). A real violation — a provider field referenced in a type
 * or runtime value — is still caught because it lives in code, not comments.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('LlmClient port interface (Req: LlmClient Port Purity)', () => {
  describe('asynchronous complete (scenario 1)', () => {
    it('complete returns a Promise<LlmResponse> (asynchronous; NOT a synchronous value)', () => {
      // The network call is fundamentally async; a Promise return is the only
      // honest completion contract — a synchronous return would lie about it.
      expectTypeOf<LlmClient['complete']>().returns.toMatchTypeOf<Promise<LlmResponse>>();
      expectTypeOf<LlmClient['complete']>().returns.not.toMatchTypeOf<LlmResponse>();
    });

    it('complete accepts an LlmRequest', () => {
      expectTypeOf<LlmClient['complete']>().parameter(0).toEqualTypeOf<LlmRequest>();
    });

    it('LlmRequest.model is exactly deepseek-v4-flash | deepseek-v4-pro (Req: Model Selection)', () => {
      expectTypeOf<LlmRequest['model']>().toEqualTypeOf<'deepseek-v4-flash' | 'deepseek-v4-pro'>();
    });

    it('LlmUsage carries all four cache/token fields (Req: complete returns content, usage, model)', () => {
      const usage = {} as LlmUsage;
      expectTypeOf<typeof usage.promptTokens>().toEqualTypeOf<number>();
      expectTypeOf<typeof usage.completionTokens>().toEqualTypeOf<number>();
      expectTypeOf<typeof usage.promptCacheHitTokens>().toEqualTypeOf<number>();
      expectTypeOf<typeof usage.promptCacheMissTokens>().toEqualTypeOf<number>();
    });

    it('LlmResponse carries content, model, and usage (Req: complete returns content, usage, model)', () => {
      const response = {} as LlmResponse;
      expectTypeOf<typeof response.content>().toEqualTypeOf<string>();
      expectTypeOf<typeof response.model>().toEqualTypeOf<
        'deepseek-v4-flash' | 'deepseek-v4-pro'
      >();
      expectTypeOf<typeof response.usage>().toEqualTypeOf<LlmUsage>();
    });

    it('LlmMessage surfaces reasoningContent for multi-turn passthrough (Req: Thinking Mode)', () => {
      const message = {} as LlmMessage;
      expectTypeOf<typeof message.reasoningContent>().toEqualTypeOf<string | undefined>();
    });
  });

  describe('no SDK imports or transport/provider-shape coupling (scenario 2; threat: leakage)', () => {
    it('the forbidden-import detector actually catches a known offender', () => {
      const source =
        "import OpenAI from 'openai';\nimport express from 'express';\nimport { readFileSync } from 'node:fs';";
      const caught = extractImportSpecifiers(source).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );

      expect(caught).toEqual(['openai', 'express', 'node:fs']);
    });

    it('llm-client.ts imports nothing forbidden', () => {
      const violations = extractImportSpecifiers(portSource).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );

      expect(violations).toEqual([]);
    });

    it('llm-client.ts carries zero transport/provider-shape awareness', () => {
      const code = stripComments(portSource);
      const present = transportTokens.filter((token) => code.includes(token));

      expect(present).toEqual([]);
    });
  });
});
