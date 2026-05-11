import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    benchmark: {
      include: ['**/benchmark/bench.js', '**/*.{bench,benchmark}.?(c|m)[jt]s?(x)'],
    },
  },
});
