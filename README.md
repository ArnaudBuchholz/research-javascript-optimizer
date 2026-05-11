# JavaScript Optimizer

A research project that identifies known-inefficient JavaScript patterns and provides
measurably faster, semantically equivalent replacements.

Each rule lives in `rules/<rule-name>/` and ships four artifacts:

| artifact | purpose |
|---|---|
| `README.md` | what the pattern is, why it's faster, and when NOT to apply it |
| `benchmark/bench.js` | vitest bench proving ≥ 10% speedup |
| `test/` | behavior tests proving the rewrite preserves observable semantics |
| `transform/index.ts` | ESLint rule with autofix |

---

## Available rules

| rule | summary | status |
|---|---|:---:|
| [`foreach-to-for`](rules/foreach-to-for/README.md) | Replace `Array.forEach(fn)` with a `for` loop — **8.6× faster** on dense arrays | ✅ |
| `map-to-for` | Replace `Array.map(fn)` with a pre-allocated array + `for` loop | 🔜 |
| `filter-to-for` | Replace `Array.filter(fn)` with a `for` loop + conditional `push` | 🔜 |
| `reduce-to-for` | Replace `Array.reduce(fn, init)` with a `for` loop + accumulator | 🔜 |
| `for-of-to-for` | Replace `for...of` on arrays with an indexed `for` loop | 🔜 |
| `chained-array-methods` | Replace `.filter().map()` chains with a single `for` loop | 🔜 |
| `object-keys-foreach` | Replace `Object.keys(obj).forEach(fn)` with `for...in` | 🔜 |
| `array-spread-concat` | Replace `[...a, ...b]` with `a.concat(b)` in hot paths | 🔜 |
| `try-catch-outside-loop` | Hoist `try/catch` out of tight loops | 🔜 |
| `arguments-to-rest` | Replace `arguments` object with a rest parameter | 🔜 |

---

## Validating the implementation

### Run all tests

```bash
npx vitest run
```

Runs behavior tests (semantics preserved) and transform tests (rule detects and fixes
correctly) for every implemented rule.

### Run tests for a single rule

```bash
npx vitest run rules/foreach-to-for/
```

### Run the benchmark for a rule

```bash
npx vitest bench rules/foreach-to-for/benchmark/bench.js
```

The benchmark output shows ops/sec for the original pattern and the optimised
replacement. A rule is considered valid only when the optimised variant is **at least
10% faster**.

### Type-check all TypeScript

```bash
npx tsc --noEmit
```

---

## Using a rule in your project

Each rule is a standalone ESLint rule module. Add it to your ESLint flat config
(`eslint.config.js`) alongside the rules you already use:

```js
// eslint.config.js
import foreachToFor from './path/to/rules/foreach-to-for/transform/index.js';

export default [
  {
    plugins: {
      optimizer: {
        rules: { 'foreach-to-for': foreachToFor },
      },
    },
    rules: {
      'optimizer/foreach-to-for': 'warn',   // report only
      // 'optimizer/foreach-to-for': 'error', // report as error
    },
  },
];
```

### Applying the autofix

Run ESLint with `--fix` to rewrite all matching patterns automatically:

```bash
npx eslint --fix src/
```

Each rule's `README.md` documents exactly which patterns are rewritten and which are
intentionally skipped (e.g. callbacks with `return` statements, sparse arrays, or
side-effectful array expressions).

---

## Adding a new rule

Follow the four-step workflow in [CLAUDE.md](CLAUDE.md):

1. **Research** — write `rules/<name>/README.md` (pattern, rationale, caveats)
2. **Benchmark** — prove ≥ 10% speedup with `benchmark/bench.js`
3. **Behavior tests** — prove semantics are preserved in `test/`
4. **Transform** — implement the ESLint rule in `transform/index.ts`

Never implement the transform before the benchmark proves the gain.
