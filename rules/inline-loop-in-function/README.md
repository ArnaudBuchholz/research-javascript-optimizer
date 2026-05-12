# `inline-loop-in-function` — Inline functions whose bodies contain loops with `break`/`continue`

## Pattern

A helper function whose body contains a loop with `break` or `continue`, called from
inside another loop. The function exits early by returning from within the inner loop:

```js
// Before
function processChunk(chunk, out) {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === null) return;   // early exit from the function
    out[out.length] = chunk[i] * 2;
  }
}

for (let j = 0; j < batches.length; j++) {
  processChunk(batches[j], results);
}
```

A naive application of `inline-early-exit-function` would replace `return;` with `break`,
but that `break` would exit the **inner `for` loop** (`for i`) rather than the function —
changing the observable behaviour. The fix is to attach a unique label to the
`do {} while (0)` wrapper so that the inlined `return` becomes `break <label>`, which
unambiguously targets the function-exit point:

```js
// After
for (let j = 0; j < batches.length; j++) {
  const chunk = batches[j];
  const out = results;
  _fn1: do {
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === null) break _fn1;   // exits do-while, not the for-i loop
      out[out.length] = chunk[i] * 2;
    }
  } while (0);
}
```

The label `_fn1:` (generated to be unique in the surrounding scope) marks the
`do {} while (0)` as the target of `break _fn1`. The inner `for` loop retains its own
unlabelled `break`/`continue` semantics unchanged.

---

A function that uses `continue` inside a loop and also has an early return:

```js
// Before
function collectPositives(src, dst) {
  for (let i = 0; i < src.length; i++) {
    if (src[i] <= 0) continue;         // skip non-positives
    if (dst.length >= MAX) return;     // stop if full
    dst[dst.length] = src[i];
  }
}

for (const page of pages) {
  collectPositives(page, buffer);
}
```

```js
// After
for (const page of pages) {
  const src = page;
  const dst = buffer;
  _fn1: do {
    for (let i = 0; i < src.length; i++) {
      if (src[i] <= 0) continue;         // targets for-i — unchanged
      if (dst.length >= MAX) break _fn1; // targets do-while — exits function
      dst[dst.length] = src[i];
    }
  } while (0);
}
```

The `continue` inside the inner loop targets the inner loop and is left untouched. Only
the bare `return;` statements (the function-level exits) are rewritten to `break <label>`.

---

A function that uses a labelled `break` inside its own loop, plus an early return:

```js
// Before
function findFirst(matrix, target, out) {
  outer: for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === target) {
        out.row = r;
        out.col = c;
        break outer;   // labelled — exits both loops within the function
      }
    }
  }
  if (out.row === -1) return;  // target not found — early exit from function
  out.found = true;
}

for (const query of queries) {
  findFirst(grid, query.value, query.result);
}
```

```js
// After
for (const query of queries) {
  const matrix = grid;
  const target = query.value;
  const out = query.result;
  _fn1: do {
    outer: for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c] === target) {
          out.row = r;
          out.col = c;
          break outer;   // still targets the inner `outer:` label — unchanged
        }
      }
    }
    if (out.row === -1) break _fn1;  // targets do-while — exits function
    out.found = true;
  } while (0);
}
```

Labels that are defined within the inlined body (such as `outer:`) retain their meaning
after inlining, because they are nested inside the `do {} while (0)` and are therefore not
visible at the outer scope. The transform only rewrites bare `return;` statements to
`break <generated-label>`.

---

## Why it's faster

The performance gains are identical to those of `inline-early-exit-function`. This rule
handles the superset of cases where the function body also contains loop constructs with
their own `break`/`continue`, which the simpler rule cannot inline safely without the
labelled wrapper.

### Stack frame allocation and teardown

Every call to a JavaScript function pushes an **activation record** onto the native call
stack. The record includes `this`, `new.target`, the closure pointer, the saved return
address, the saved frame pointer, one slot per formal parameter, and one slot per local
variable. This structure is initialised on entry and torn down on every exit path —
including an early `return` from inside an inner loop. When the call site is in a hot
outer loop, this overhead runs on every outer iteration.

After inlining, argument bindings live in the caller's existing activation record. No new
frame is pushed or torn down. A `break _fn1` that exits the `do {} while (0)` is a
forward branch within the already-live register file — as cheap as any `if` check.

### Early-exit path inside a loop is particularly expensive

When the early-return guard inside the function fires during the first few inner
iterations (e.g. a sentinel `null` value near the start of a chunk), the function
completes almost no useful work but still pays full call overhead: push frame, IC check,
Ignition prologue writes, `Return` bytecode, pop frame. After inlining, the early-exit
path is just a conditional `break _fn1` — a single branch instruction.

### `do {} while (0)` with a label — zero runtime cost

The `while (0)` condition is a compile-time constant. V8's TurboFan optimising compiler
eliminates the back-edge; the `do {} while (0)` is treated as a plain block with a unique
forward-jump target. Adding a label to the `do {} while (0)` does not add any runtime
cost; labels in JavaScript are purely a compile-time control-flow annotation, not a
runtime construct.

### Formal parameter binding (Ignition prologue)

Ignition's function prologue writes each actual argument from the call frame into the
corresponding parameter slot in the callee's register file. Each write is a distinct
bytecode instruction on every call. `const` bindings for arguments in the caller avoid
this prologue entirely.

### Inline Cache and call dispatch

Even on the monomorphic fast path, V8 must on every call load the cached callee from the
IC slot, compare it against the actual callee, and branch to the cached call sequence. A
`do {} while (0)` block and `const` bindings have no call site and no IC machinery.

### TurboFan inlining budget

TurboFan automatically inlines small callees, but functions that contain nested loops are
larger in bytecode and more likely to exceed the inlining budget, especially when the
enclosing caller is itself large or deeply nested. Manual inlining removes this dependency
and guarantees the body is present at the call site.

---

## When it applies

All of the following must hold for the rewrite to be safe:

- **The function body contains at least one loop (`for`, `while`, `do…while`, `for…in`,
  `for…of`) and at least one `break` or `continue` inside that loop that would conflict
  with the unlabelled `break` semantics of the `do {} while (0)` wrapper.** Specifically:
  the conflict arises when (a) the function body has a loop with `break`/`continue` AND
  (b) the function also has at least one bare `return;` that must be rewritten to `break`.
  If either condition is absent, a simpler rule (`inline-early-exit-function` or
  `inline-parameterized-function`) is sufficient.
- **All `return` statements in the function body are bare `return;` (void return).**
  Functions that return a value from any path require a `let _result` binding (see
  `inline-returning-function`). A function that mixes `return;` and `return <expr>` is
  a composition of both this rule and `inline-returning-function`, which should be
  implemented as a separate combined rule.
- **The function is a plain function declaration or a `const`/`let`-bound function
  expression** whose binding is never reassigned. A mutable binding (`fn = other`) means
  the inlined body may not match the function actually called at runtime.
- **The function is not a generator (`function*`) or an async function (`async function`).**
  Generators return an iterator; async functions return a `Promise`. Neither is replicable
  by a `do {} while (0)` block.
- **The function is not called with `new`.** Constructor semantics — object allocation,
  `this` binding, `new.target`, prototype assignment, and the return-value override rule —
  cannot be replicated by a block statement.
- **The function is called as a plain call** (`fn(a, b)`), not as a method call
  (`obj.fn(a, b)`), not via `.call`/`.apply`/`.bind`. Method calls bind `this` to `obj`;
  the inlined block's `this` resolves to the caller's `this`.
- **The function body contains no `this` reference.** After inlining, `this` resolves to
  the caller's `this`, which may differ from `undefined` (strict mode) or the global
  object (sloppy mode) that the original callee would have seen.
- **The function body contains no `arguments` reference.** After inlining, `arguments`
  resolves to the caller's argument object, not the callee's.
- **The function body contains no `var` declarations.** `var` ignores block boundaries
  and hoists into the caller's function scope, potentially colliding with existing names.
  `let` and `const` inside the `do {} while (0)` are safely block-scoped.
- **Labels defined within the function body do not collide with labels visible at the
  call site.** After inlining, labels defined in the body are nested inside the
  `do {} while (0)` and remain scoped to it. However, if the generated label for the
  `do {} while (0)` itself matches a label already present at the call site, the
  generated name must be adjusted. The transform must scan for label collisions and
  generate a unique label name (e.g. `_fn1`, `_fn2`, …).
- **No argument name or local variable name in the function body collides with a
  `let`/`const`/`var` binding already in scope at the call site**, or the transform must
  rename the conflicting identifier consistently throughout the inlined body. Duplicate
  `let`/`const` bindings in the same block scope are a `SyntaxError`.
- **The function does not use `eval` or `with`.** Both make identifier resolution dynamic
  and render static inlining unsound.
- **The function declaration is statically visible and there is exactly one definition**
  in scope at the call site. Multiple or conditional definitions require full data-flow
  analysis beyond what a syntactic transform can guarantee.
- **The function is called synchronously on a hot path** (tight loop, frequently invoked
  callback). Inlining a cold-path function trades readability for no measurable gain.

---

## When it does NOT apply

| Condition | Risk |
|---|---|
| Function returns a value from any path (`return <expr>`) | The return value must be captured in a `let _result` variable; furthermore each `return <expr>` must assign to `_result` and then `break <label>`. Use `inline-returning-function` for pure return-value cases; implement a combined rule for functions that mix loops, early `return;`, and `return <expr>`. |
| Function body contains no loop at all — only bare `return;` exits | The unlabelled `break` from `inline-early-exit-function` is sufficient and simpler; use that rule instead. |
| Function body contains a loop but no bare `return;` inside it (only `break`/`continue` targeting the inner loop) | No function-exit rewrite is needed; use `inline-parameterized-function` or `inline-early-exit-function` as appropriate. |
| Function is `async` | The call returns a `Promise`; a `do {} while (0)` block does not produce a `Promise` and does not suspend the event loop. |
| Function is a generator | The call returns an iterator; a block statement does not. |
| Function is called with `new` | `new` semantics (object allocation, `this`, `new.target`, prototype assignment) cannot be replicated by a block statement. |
| Function uses `this` | After inlining, `this` resolves to the caller's `this`; if they differ the behaviour changes silently. |
| Function references `arguments` | After inlining, `arguments` resolves to the caller's argument object, not the callee's. |
| Function body contains `var` declarations | `var` hoists past block boundaries into the caller's function scope, potentially shadowing or colliding with existing names. |
| Function binding is mutated (`fn = otherFn`) | The inlined body may not match what is actually called at runtime. |
| Called as a method: `obj.process(x)` | `this` inside the body is `obj`; the inlined block's `this` is the caller's `this`. |
| Called via `.call` / `.apply` / `.bind` | Explicit `this` binding is lost after inlining; safe only if the body never reads `this`. |
| Body contains `eval` or `with` | Dynamic scope manipulation makes static inlining unsound. |
| The generated label for the `do {} while (0)` collides with a label visible at the call site or defined inside the inlined body | A label collision would cause `break <label>` to target the wrong construct. The transform must generate a name that is unique in the combined scope: not present in the outer scope and not shadowed by any label declared within the inlined body itself. |
| Argument name or local variable name collides with a binding in the caller's scope and automatic renaming would propagate incorrectly | The transform must either generate a collision-free name or decline the rewrite. |
| Function is only called once or on a cold path | The overhead eliminated is negligible; inlining only adds code size with no performance benefit. |

---

## Label generation and collision avoidance

This rule introduces a label on the `do {} while (0)` wrapper that did not exist in the
source. The transform must ensure the chosen label is **unique across two dimensions**:

1. **Outer scope**: the label must not match any label already in scope at the call site.
   JavaScript labels are function-scoped in the sense that a labelled statement is visible
   to any nested `break`/`continue` within the same function body. A generated label like
   `_fn1` could collide with a user-written `_fn1:` label elsewhere in the same function.
   The transform must scan all labels in the enclosing function and pick a name absent
   from that set.

2. **Inlined body**: the label must not shadow a label defined within the function body
   that is being inlined. If the body contains `outer: for (...)`, the generated wrapper
   label must not be `outer`. (Because labels defined inside the body are nested inside
   the `do {} while (0)`, they do not escape into the outer scope — but the generated
   wrapper label must still not match them to avoid the body's own `break outer` being
   re-targeted to the wrapper.)

A safe strategy is to collect all label identifiers in the function containing the call
site, all label identifiers in the function body being inlined, and generate a name
(`_fn1`, `_fn2`, …, or a hash-derived suffix) not present in either set.

---

## Sources

- [V8 blog: TurboFan JIT Design](https://v8.dev/blog/turbofan-jit) — describes how
  TurboFan's Sea-of-Nodes IR represents control flow including loops; a `return` from
  inside a loop in the callee becomes a conditional exit edge in the subgraph. The labelled
  `do {} while (0)` is the source-level analogue: `break _fn1` exits the synthetic outer
  block just as the `return` node would exit the callee subgraph.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  explains the bytecode pipeline; Ignition emits a `Return` bytecode that unwinds the
  call frame regardless of how many loop levels are active in the callee. Manual inlining
  replaces the `Return` with a `Jump` to the label target, staying within the caller's
  frame.
- [V8 blog: Sparkplug — a non-optimising JavaScript compiler](https://v8.dev/blog/sparkplug) —
  documents the stack frame layout; every function call must allocate and later tear down
  the frame even when the exit path returns from inside a nested inner loop. The fixed
  overhead per call is the quantity that manual inlining eliminates.
- [Benedikt Meurer — V8 performance blog](https://benediktmeurer.de) — posts on TurboFan
  inlining heuristics: functions whose bodies contain loops are larger in bytecode and
  more likely to exceed the inlining budget; the budget is evaluated against the callee's
  total bytecode size including all loop bodies.
- [Vyacheslav Egorov — "What's up with monomorphism"](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) —
  analysis of Inline Cache behaviour; even a monomorphic call site inside a hot outer loop
  pays a load, comparison, and branch on every outer iteration. No call site means no IC
  overhead, regardless of how many loops are in the inlined body.
- [ECMAScript spec: `LabelledStatement` semantics (§14.13)](https://tc39.es/ecma262/#sec-labelled-statements) —
  defines that a label is in scope for any `BreakStatement` or `ContinueStatement` nested
  within the labelled statement. After inlining, the `_fn1:` label on the `do {} while (0)`
  is the enclosing labelled statement; `break _fn1` inside the body targets it correctly.
- [ECMAScript spec: `BreakStatement` semantics (§14.9)](https://tc39.es/ecma262/#sec-break-statement) —
  defines that a labelled `break <label>` exits the nearest enclosing statement bearing
  that label, which after inlining is the `do {} while (0)`. An unlabelled `break` inside
  a loop body still exits the nearest enclosing iteration statement or `switch`, unchanged
  by the presence of the outer `do {} while (0)` label.
- [ECMAScript spec: `ContinueStatement` semantics (§14.8)](https://tc39.es/ecma262/#sec-continue-statement) —
  defines that an unlabelled `continue` advances the nearest enclosing iteration statement.
  After inlining, a `continue` inside an inner loop still targets that inner loop; the
  outer labelled `do {} while (0)` is not an iteration-loop target for `continue` because
  `continue` on a `do {} while (0)` would re-evaluate the `while (0)` condition — which
  is falsy — causing it to exit rather than restart. The transform must therefore rewrite
  `return;` to `break <label>`, not `continue <label>`.
- [ECMAScript spec: `do-while` statement (§14.7.3)](https://tc39.es/ecma262/#sec-do-while-statement) —
  normative definition: the body executes, then the condition is evaluated; with condition
  `0` (falsy) the loop never repeats. A `break <label>` targeting the `do {} while (0)`
  exits it immediately. A `continue <label>` would re-evaluate `while (0)` and also exit,
  but `continue` on a `do {} while (0)` that evaluates false has the same net effect as
  `break` — however `break <label>` is the correct and intentional form for clarity.
- [ECMAScript spec: `ReturnStatement` semantics (§14.10)](https://tc39.es/ecma262/#sec-return-statement) —
  normative definition that a bare `return;` unwinds the current execution context and
  resumes the caller regardless of any active loop or switch. Manual inlining replaces this
  cross-frame protocol with a `break <label>` that jumps to the end of the `do {} while (0)`.
- [ECMAScript spec: `FunctionDeclarationInstantiation` (§10.2.11)](https://tc39.es/ecma262/#sec-functiondeclarationinstantiation) —
  normative definition of how formal parameters are bound to argument values on each call;
  the `const` argument bindings of the inlined form replicate this at the source level,
  inside the caller's already-live environment record.
- [ECMAScript spec: `var` hoisting and Variable Environments (§8.1.2)](https://tc39.es/ecma262/#sec-variable-environments) —
  defines that `var` declarations hoist to the `VariableEnvironment` (function scope), not
  the `LexicalEnvironment` (block scope); the authoritative basis for disallowing `var`
  in the function body.
- [ECMAScript spec: Block scoping and `let`/`const` (§14.2)](https://tc39.es/ecma262/#sec-block) —
  defines that `let` and `const` are scoped to the enclosing `Block`; confirms that
  `let`/`const` declarations inside the `do {} while (0)` body are safely isolated from
  the surrounding scope.
- [MDN: `break` statement — labelled form](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/break) —
  documents that `break <label>` exits the statement that carries that label, including a
  `do…while`. Confirms that an unlabelled `break` inside a loop nested within the
  `do {} while (0)` still exits only the inner loop, leaving the `do {} while (0)` active.
- [MDN: `continue` statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/continue) —
  documents that an unlabelled `continue` advances the nearest enclosing iteration loop;
  confirms that `continue` inside an inner loop nested in the `do {} while (0)` targets
  the inner loop, not the `do {} while (0)`.
- [MDN: label statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/label) —
  documents the scope and visibility of JavaScript labels; labels are per-function and
  must be unique within the labelled statement hierarchy. The transform must verify
  uniqueness before emitting the generated label.
- [MDN: `do...while` statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/do...while) —
  documents the constant-false idiom `do {} while (0)` and confirms that `break` exits the
  construct; `continue` on a `do {} while (false)` is legal but re-evaluates the condition
  (immediately false) so also exits — however `break` is the semantically correct form for
  a function-exit replacement.
- [MDN: `arguments` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments) —
  confirms that `arguments` is bound per function, not per block; inlining a body that
  references `arguments` changes which argument list is visible.
- [Node.js profiling guide](https://nodejs.org/en/learn/getting-started/profiling) —
  V8 profiler guidance; flame charts are the recommended tool for identifying hot call
  sites where helpers containing inner loops are called from outer loops and dominate
  execution time.

---

## Benchmark results

> **Rule not justified — measured speedup is below the required 10% threshold.**

Measured on Node.js v24.15.0 (V8 TurboFan, Apple Silicon), vitest bench v3.2.4.
100 000 outer-loop calls, each calling a helper whose body is a `for`-loop
(CHUNK_SIZE = 3) with a bare `return;` inside it (see `benchmark/bench.js`).

The benchmark was redesigned from an earlier version that used only 10 000 outer
calls over chunks of 10 elements. The new design matches the scale used by the
sibling `inline-early-exit-function` rule: N = 100 000 direct calls with a
minimal per-call body (CHUNK_SIZE = 3), so that function-call overhead is a
larger fraction of total cost.

### Mixed sentinel rate (~50% of chunks exit early at index 1)

| variant | ops/s | mean (ms) |
|---|---|---|
| function call — original | ~974 | ~1.027 |
| inlined `_fn1: do {} while (0)` — optimized | ~983 | ~1.017 |

Speedup: **~1.01×** — within measurement noise.

### Heavy early-exit rate (~100% of chunks exit at index 1)

| variant | ops/s | mean (ms) |
|---|---|---|
| function call — original | ~1 734 | ~0.577 |
| inlined `_fn1: do {} while (0)` — optimized | ~1 853 | ~0.540 |

Speedup: **~1.07×** — 7% gain, below the 10% gate.

---

### Why no gain is observed even with a fair comparison

The previous benchmark was flawed (10 000 calls × CHUNK_SIZE 10 buried overhead
under work). The redesigned benchmark isolates per-call overhead correctly by
using 100 000 calls with CHUNK_SIZE = 3. Even so, the speedup tops out at ~7%
in the heavy scenario and ~1% in the mixed scenario — well below the required
10% threshold.

The theoretical gains described in "Why it's faster" apply when the JS engine
cannot auto-inline the callee. V8's TurboFan **does** inline small-to-medium
functions that contain loops, including those with a `return` inside an inner
loop. TurboFan's Sea-of-Nodes IR represents the `return` from inside the inner
loop as a conditional exit edge in the callee subgraph; when the caller is also
optimised, the call dispatch overhead is negligible.

A microbenchmark using `%NeverOptimizeFunction` (which prevents TurboFan from
optimising the callee) confirms the theoretical gains exist in the
non-optimised case: ~6× speedup. However, that scenario does not represent
normal production code in a warm Node.js process.

**Conclusion**: on modern Node.js (v20 LTS and later, V8 ≥ 11.x), TurboFan
auto-inlines this pattern reliably even when the callee contains inner loops
with early returns. The 7% gain in the pathological heavy scenario is real but
below the 10% gate and within the noise of a micro-benchmark. Manual inlining
produces no practically meaningful gain and trades readability for nothing.

The rule remains valuable as documentation of the pattern (for cases where
TurboFan cannot inline — e.g. very large functions, polymorphic call sites, or
when targeting Ignition-only environments) but no automated rewrite should be
shipped based on this benchmark.
