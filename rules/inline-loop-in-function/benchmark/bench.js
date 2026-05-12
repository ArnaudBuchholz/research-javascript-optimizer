import { bench, describe } from 'vitest';

const N = 100_000;

// ─── shared inputs ────────────────────────────────────────────────────────────
//
// Each outer call processes one chunk (a dense array of CHUNK_SIZE elements).
// A sentinel `null` at index 1 triggers the early-return path from inside the
// inner for-loop — the exact pattern this rule targets.
//
// CHUNK_SIZE=3 keeps per-call work minimal so function-call overhead is a
// significant fraction of total cost (same design principle as
// inline-early-exit-function which uses N=100_000 direct calls).

const CHUNK_SIZE = 3;

// Mixed: null sentinel at index 1 on every other chunk (~50% early exit)
const chunksMixed = Array.from({ length: N }, (_, j) => {
  const chunk = Array.from({ length: CHUNK_SIZE }, (__, i) => (i + 1) * (j % 7 + 1));
  if (j % 2 === 0) chunk[1] = null;
  return chunk;
});

// Heavy: null sentinel at index 1 on every chunk (~100% early exit after 1 item)
const chunksHeavy = Array.from({ length: N }, (_, j) => {
  const chunk = Array.from({ length: CHUNK_SIZE }, (__, i) => (i + 1) * (j % 7 + 1));
  chunk[1] = null;
  return chunk;
});

// ─── original: helper with inner loop + bare `return;` inside the loop ────────
//
// The bare `return;` exits the FUNCTION when a sentinel is found — not merely
// the inner for-loop. `inline-early-exit-function` cannot inline this safely:
// replacing `return;` with an unlabelled `break` would only exit the inner
// for-loop, leaving the outer caller loop to continue from where `return` left
// off — wrong. The fix is a labelled `do {} while (0)` wrapper so that
// `break _fn1` unambiguously targets the function-exit point.

function processChunk(chunk, out) {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === null) return;   // exits the function, not just the for-loop
    out[out.length] = chunk[i] * 2;
  }
}

// ─── scenario 1: mixed sentinel rate (~50% early exit at index 1) ────────────

describe('inline-loop-in-function (mixed sentinel rate ~50% early exit)', () => {
  bench('function call with inner loop + early return (original)', () => {
    const out = [];
    for (let j = 0; j < N; j++) {
      processChunk(chunksMixed[j], out);
    }
    if (out.length < 0) throw new Error('unreachable');
  });

  // `return;` → `break _fn1`. Labelled `do {} while (0)` is the function-exit
  // target. Unlabelled break/continue inside the for-i still target the for-i.
  bench('inlined labelled do-while(0) block (optimized)', () => {
    const out = [];
    for (let j = 0; j < N; j++) {
      const chunk = chunksMixed[j];
      _fn1: do {
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === null) break _fn1;
          out[out.length] = chunk[i] * 2;
        }
      } while (0);
    }
    if (out.length < 0) throw new Error('unreachable');
  });
});

// ─── scenario 2: heavy early-exit rate (~100% early exit at index 1) ─────────
//
// Every chunk exits after 1 useful iteration. Full call overhead (frame push,
// IC check, Ignition prologue writes, frame pop) per outer iteration for almost
// no work — the worst case for per-call overhead. Mirrors the heavy-guard
// scenario in inline-early-exit-function.

describe('inline-loop-in-function (heavy sentinel rate ~100% early exit at index 1)', () => {
  bench('function call with inner loop + early return (original)', () => {
    const out = [];
    for (let j = 0; j < N; j++) {
      processChunk(chunksHeavy[j], out);
    }
    if (out.length < 0) throw new Error('unreachable');
  });

  bench('inlined labelled do-while(0) block (optimized)', () => {
    const out = [];
    for (let j = 0; j < N; j++) {
      const chunk = chunksHeavy[j];
      _fn1: do {
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === null) break _fn1;
          out[out.length] = chunk[i] * 2;
        }
      } while (0);
    }
    if (out.length < 0) throw new Error('unreachable');
  });
});
