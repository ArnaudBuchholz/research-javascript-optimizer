Process the next incomplete optimization rule in BACKLOG.md by delegating each step to a focused sub-agent.

## Step 1 — Identify the next item

Use the Agent tool (subagent_type: Explore) with this prompt:

> Read `/Users/I850991/git/research-javascript-optimizer/BACKLOG.md` and return a JSON object with these fields:
> - `ruleName`: the value in the `rule-name` column (without backticks)
> - `summary`: the value in the `summary` column
> - `researched`: true if the `researched` column contains ✅, else false
> - `tested`: true if the `tested` column contains ✅, else false
> - `implemented`: true if the `implemented` column contains ✅, else false
> - `done`: true if the `done` column contains ✅, else false
>
> Return data for the **first row** whose `done` column is empty. If all rows are done, return `{ "allDone": true }`.

Parse the result. If `allDone` is true, report "All backlog items are complete." and stop.

Set `RULE` = the `ruleName` field and `SUMMARY` = the `summary` field.

---

## Step 2 — Research (if not yet researched)

If `researched` is false, spawn a sub-agent (general-purpose) with this prompt:

> You are working on the JavaScript optimizer research project at `/Users/I850991/git/research-javascript-optimizer`.
> Read `CLAUDE.md` for conventions.
>
> Your task: **research the `$RULE` optimization rule**.
>
> Summary: $SUMMARY
>
> Create the file `rules/$RULE/README.md` following the structure in CLAUDE.md §"Research (README.md)":
> - **Pattern**: original code and its replacement (concrete JS examples)
> - **Why it's faster**: engine-level explanation (function call overhead, hidden class, deopt, etc.)
> - **When it applies**: precise preconditions that must hold for the rewrite to be safe
> - **When it does NOT apply**: cases where the rewrite would break observable behavior
> - **Sources**: links to V8 blog posts, MDN, or community benchmarks
>
> Do not create any other files. Do not run any commands.

Wait for the sub-agent to complete.

Update `BACKLOG.md`: set the `researched` column for the `$RULE` row to ✅.

Report: "Research for `$RULE` complete. README.md written." then **stop** — do not proceed to Step 3.

---

## Step 3 — Benchmark / testing (if not yet tested)

If `researched` is true and `tested` is false, spawn a sub-agent (general-purpose) with this prompt:

> You are working on the JavaScript optimizer research project at `/Users/I850991/git/research-javascript-optimizer`.
> Read `CLAUDE.md` and `rules/$RULE/README.md` before starting.
>
> Your task: **create and run the benchmark for the `$RULE` rule**, then create behavior tests.
>
> 1. Create `rules/$RULE/benchmark/bench.js` using vitest bench (see CLAUDE.md §"Benchmark"). Include at least two cases: `original` and `optimized`. Use ≥ 10 000 elements.
> 2. Run the benchmark: `npx vitest bench rules/$RULE/benchmark/bench.js`
> 3. Record the measured ops/s for both variants in the README.md "Benchmark results" section. Compute the speedup ratio.
> 4. If the speedup is **less than 10%**, write a clear note in README.md explaining why the rule does not justify implementation, then report: "SKIP: benchmark for `$RULE` shows < 10% gain — rule dropped."
> 5. If the speedup is **≥ 10%**, create behavior test fixtures under `rules/$RULE/test/fixtures/` and the test file `rules/$RULE/test/behavior.test.ts`. Run `npx vitest run rules/$RULE/test/` and confirm all tests pass.

Wait for the sub-agent to complete.

Parse the sub-agent's final report:
- If the report contains "SKIP:", update `BACKLOG.md`: set both `tested` **and** `done` for the `$RULE` row to ✅. Report the skip reason and **stop**.
- Otherwise, update `BACKLOG.md`: set `tested` for the `$RULE` row to ✅. Report: "Benchmark and behavior tests for `$RULE` complete." then **stop**.

---

## Step 4 — Transform implementation (if not yet implemented)

If `researched` and `tested` are both true and `implemented` is false, spawn a sub-agent (general-purpose) with this prompt:

> You are working on the JavaScript optimizer research project at `/Users/I850991/git/research-javascript-optimizer`.
> Read `CLAUDE.md` and `rules/$RULE/README.md` before starting.
>
> Your task: **implement the automated transform for the `$RULE` rule**.
>
> 1. Choose ESLint rule (for patterns that can recur) or jscodeshift codemod (for one-off migrations) — justify your choice briefly in a comment at the top of the file.
> 2. Create `rules/$RULE/transform/index.ts`. The transform must only rewrite patterns where all preconditions from the README are provably met. Preserve formatting and comments around unchanged nodes.
> 3. Create `rules/$RULE/transform/index.test.ts` with unit tests covering all fixture cases under `rules/$RULE/test/fixtures/`.
> 4. Run `npx vitest run rules/$RULE/transform/` and confirm all tests pass.
> 5. Run `npx tsc --noEmit` and fix any type errors.

Wait for the sub-agent to complete.

Update `BACKLOG.md`: set both `implemented` and `done` for the `$RULE` row to ✅.

Report: "Transform for `$RULE` complete. All acceptance criteria met." then **stop**.
