import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/app-receipts.test.ts'],
    globalSetup: ['./vitest.receiptsSetup.ts'],
    globals: true,
    fileParallelism: false,
  },
});

