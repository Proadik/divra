import { defineConfig } from 'vitest/config';

// Юнит-тесты: без базы и сети
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
