import { defineConfig } from 'vitest/config';

// Non-domain test discovery: the root harness under test/ plus strict-TDD unit
// tests discovered in workspace packages (e.g. packages/trust-kernel/test/).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
    environment: 'node',
    // The live-PostgreSQL integration suites share the single io_dev database
    // and isolate state via TRUNCATE in beforeEach; parallel file execution
    // races that shared state (pre-existing flake). The project's documented
    // live-PG gate mode is sequential, so file parallelism is disabled here to
    // keep `pnpm check` deterministic.
    fileParallelism: false,
  },
});
