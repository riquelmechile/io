import { defineConfig } from 'vitest/config';

// Non-domain test discovery: only the root harness under test/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
