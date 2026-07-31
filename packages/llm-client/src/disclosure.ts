/**
 * Honest disclosure shared by this package's fake LLM client and any non-real
 * test double (Req: FakeLlmClient Test Double, scenario: Honest non-real
 * disclosure). The FakeLlmClient returns CANNED responses from in-memory
 * structures — it is NOT a real LLM and NOT network-backed. Carrying this
 * constant explicitly (rather than an empty string) prevents a fake from being
 * mistaken for a live model in logs or test output.
 */
export const LLM_FAKE_DISCLOSURE =
  'not a real LLM; not network-backed; returns canned in-memory responses only';
