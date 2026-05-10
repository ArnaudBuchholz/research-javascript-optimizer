# JavaScript Optimizer — Claude Code Guide

## Project Goal

Research and implement JavaScript optimization rules: each rule identifies a known-inefficient pattern and replaces it with a semantically equivalent but measurably faster alternative.

Example: `array.forEach(fn)` → `for (let i = 0; i < array.length; i++)` eliminates the per-element function call overhead.

Targets: **modern Node.js (current LTS) and evergreen browsers**. No legacy IE support; ES2022+ syntax is acceptable.

---

## Repository Structure

One folder per rule under `rules/`:

```
rules/
  <rule-name>/
    README.md          ← research: what, why, when it applies, known caveats
    benchmark/
      bench.js         ← vitest bench fixture (plain JS)
    transform/
      index.ts         ← jscodeshift codemod or ESLint rule with auto-fix (TypeScript)
      index.test.ts    ← tests for the transform itself
    test/
      fixtures/        ← plain JS input/output pairs
      behavior.test.ts ← tests proving the rewrite preserves observable behavior
```

Rule names use kebab-case and describe the pattern being replaced, e.g. `foreach-to-for`, `object-keys-loop`, `string-concat-to-template`.

---

## Workflow for Adding a New Rule

Follow this order — do **not** skip steps:

### 1. Research (`README.md`)
Write a short document covering:
- **Pattern**: the original code and its replacement
- **Why it's faster**: what the engine does differently (function call overhead, hidden class, deopt, etc.)
- **When it applies**: preconditions (e.g. array is dense, no `this` dependency, no early `return` in the callback)
- **When it does NOT apply**: known exceptions that would break behavior
- **Sources**: links to V8 blog posts, MDN, benchmarks from the community if available

### 2. Benchmark (`benchmark/bench.js`)
Use **vitest bench** to prove the optimization is measurably faster:
- Create at least two bench cases: `original` and `optimized`
- Use a realistic data size (≥ 10 000 elements or iterations)
- Run with `npx vitest bench rules/<rule-name>/benchmark/bench.js`
- The optimized variant must be **at least 10% faster** to justify the rule; document the measured speedup in `README.md`

### 3. Behavior tests (`test/`)
Prove the rewrite preserves observable behavior:
- Cover the happy path and all edge cases listed in the README caveats
- Fixtures are plain `.js` files: `input.js` and `output.js` (or numbered pairs for multiple cases)
- Tests use **vitest** and run with `npx vitest run rules/<rule-name>/test/`

### 4. Transform (`transform/index.ts`)
Implement the automated rewrite. Choose one:

| Option | When to use |
|--------|-------------|
| **jscodeshift codemod** | One-off migration of a codebase |
| **ESLint rule + `fix`** | Ongoing enforcement in CI |

Prefer an **ESLint rule** when the pattern can recur; prefer a **codemod** when it's a migration of legacy code.

The transform must:
- Only rewrite patterns that are provably safe (the preconditions from the README are met)
- Preserve formatting as much as possible (comments, whitespace around unchanged nodes)
- Include its own unit tests in `transform/index.test.ts`

---

## Acceptance Criteria for a Rule

A rule is complete when all four artifacts exist and pass:

- [ ] `README.md` documents the pattern, rationale, and caveats
- [ ] Benchmark shows ≥ 10% speedup on the target pattern
- [ ] Behavior tests pass with `npx vitest run`
- [ ] Transform tests pass and the transform handles all fixture cases

---

## Coding Conventions

- **TypeScript** for all tooling code (`transform/`, `*.test.ts`); **plain JS** for benchmark fixtures and test fixtures
- Strict TypeScript: `"strict": true`, no `any` without a comment justifying it
- No comments that explain *what* code does — only *why* (non-obvious constraints, V8-specific behavior, safety invariants)
- Follow the **Research → Benchmark → Transform** order; do not implement a transform before the benchmark proves the gain

---

## Commands

```bash
# Run all tests
npx vitest run

# Run benchmarks for a specific rule
npx vitest bench rules/<rule-name>/benchmark/bench.js

# Run behavior tests for a specific rule
npx vitest run rules/<rule-name>/test/

# Type-check all TypeScript
npx tsc --noEmit
```

---

## Autonomous Loop

When operating autonomously (e.g. via `/loop`), Claude must:

1. Open [BACKLOG.md](BACKLOG.md) and find the **first row where `done` is empty**.
2. Work through that rule in full following the [Workflow](#workflow-for-adding-a-new-rule) above.
3. After each completed step, update the matching column in `BACKLOG.md`:
   - Set `tested` = ✅ once the benchmark passes (≥ 10% gain confirmed)
   - Set `implemented` = ✅ once the transform + its tests pass
   - Set `done` = ✅ once all four acceptance criteria are met
4. Commit the changes for that rule before moving to the next row.
5. Stop and surface a question to the user if a benchmark fails to show ≥ 10% gain (the rule may need to be dropped or revised).

**Never skip a row** — complete each rule fully before starting the next.

---

## Guiding Principles

1. **Correctness first** — a transform that breaks behavior is worse than no transform. When in doubt, do not rewrite.
2. **Proof before shipping** — no rule without a passing benchmark. Intuition is the starting point, numbers are the gate.
3. **Small, focused rules** — one pattern per rule folder. Composing rules is fine; bundling unrelated patterns is not.
4. **Document the caveat, not just the win** — real-world usefulness depends on knowing when *not* to apply the rule.
