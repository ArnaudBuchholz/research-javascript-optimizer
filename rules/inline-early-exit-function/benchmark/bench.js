import { bench, describe } from 'vitest';

const N = 100_000;

// ─── shared inputs ────────────────────────────────────────────────────────────

const THRESHOLD = 50;
const MULTIPLIER = 2.5;

// Mixed guard rate: ~67% active, scores uniformly distributed 0..100.
// Roughly 33% of calls hit the first guard, ~33% hit the second, ~33% proceed.
const dataMixed = Array.from({ length: N }, (_, i) => ({
  active: i % 3 !== 0,
  score: (i * 7) % 101,
  value: (i % 256) + 1,
}));

// Heavy guard rate: only 5% of items are active.
// The first guard fires on ~95% of calls — the worst case for call overhead
// because the frame is allocated and torn down for almost no work.
const dataHeavy = Array.from({ length: N }, (_, i) => ({
  active: i % 20 === 0,
  score: (i * 7) % 101,
  value: (i % 256) + 1,
}));

let results = [];

// ─── original helper ─────────────────────────────────────────────────────────
//
// Two bare `return;` guards followed by a write. The function body is
// intentionally multi-statement so its bytecode size challenges TurboFan's
// auto-inlining heuristic when the enclosing loop is itself non-trivial.

function processItem(item) {
  if (!item.active) return;
  if (item.score < THRESHOLD) return;
  results[results.length] = item.value * MULTIPLIER;
}

// ─── scenario 1: mixed guard rate ────────────────────────────────────────────

describe('inline-early-exit-function (mixed guard rate ~33% exit)', () => {
  bench('function call with early exit (original)', () => {
    results = [];
    for (let i = 0; i < N; i++) {
      processItem(dataMixed[i]);
    }
    if (results.length < 0) throw new Error('unreachable');
  });

  // Each bare `return;` becomes `break`. The `while (0)` condition is a
  // compile-time constant — TurboFan removes the back-edge; no loop overhead.
  bench('inlined do-while(0) block (optimized)', () => {
    results = [];
    for (let i = 0; i < N; i++) {
      const item = dataMixed[i];
      do {
        if (!item.active) break;
        if (item.score < THRESHOLD) break;
        results[results.length] = item.value * MULTIPLIER;
      } while (0);
    }
    if (results.length < 0) throw new Error('unreachable');
  });
});

// ─── scenario 2: heavy guard rate ────────────────────────────────────────────
//
// 95% of iterations hit the first guard and return immediately. This is the
// case where per-call frame overhead dominates: every call still pushes and
// pops a full activation record even though the body does almost no work.

describe('inline-early-exit-function (heavy guard rate ~95% exit)', () => {
  bench('function call with early exit (original)', () => {
    results = [];
    for (let i = 0; i < N; i++) {
      processItem(dataHeavy[i]);
    }
    if (results.length < 0) throw new Error('unreachable');
  });

  bench('inlined do-while(0) block (optimized)', () => {
    results = [];
    for (let i = 0; i < N; i++) {
      const item = dataHeavy[i];
      do {
        if (!item.active) break;
        if (item.score < THRESHOLD) break;
        results[results.length] = item.value * MULTIPLIER;
      } while (0);
    }
    if (results.length < 0) throw new Error('unreachable');
  });
});
