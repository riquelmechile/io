import { defineConfig } from 'vitest/config';

// Non-domain test discovery: the root harness under test/ plus strict-TDD unit
// tests discovered in workspace packages (e.g. packages/trust-kernel/test/).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
