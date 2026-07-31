/**
 * Public surface of @io/llm-client — the DeepSeek V4 adapter slice over the
 * async {@link LlmClient} port. Exports the injectable ASYNC port (type-only,
 * erased by tsc), the {@link DeepSeekClient} adapter (over the `openai` SDK),
 * the pure {@link computeCost} (cache/token → USD), the {@link FakeLlmClient}
 * test double, and the {@link LlmError} classification. The `openai` SDK is
 * confined to `deepseek-client.ts`; the port stays driver-free.
 */
export type {
  LlmClient,
  LlmModel,
  LlmReasoningEffort,
  LlmMessage,
  LlmTool,
  LlmToolCall,
  LlmRequest,
  LlmUsage,
  LlmResponse,
} from './llm-client.js';
export { LlmError } from './llm-client.js';
export { computeCost } from './cost.js';
export { FakeLlmClient } from './fakes.js';
export { DeepSeekClient, deepseekApiKey } from './deepseek-client.js';
export { LLM_FAKE_DISCLOSURE } from './disclosure.js';
