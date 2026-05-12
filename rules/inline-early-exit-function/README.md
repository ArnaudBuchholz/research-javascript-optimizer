# `inline-early-exit-function` — Inline functions that use early `return`

## Pattern

A helper function that uses one or more early `return` statements to short-circuit
execution before the end of the body:

```js
// Before
function processItem(item) {
  if (!item.active) return;
  if (item.score < THRESHOLD) return;
  results.push(item.value * MULTIPLIER);
}

for (let i = 0; i < data.length; i++) {
  processItem(data[i]);
}
```

```js
// After
for (let i = 0; i < data.length; i++) {
  const item = data[i];
  do {
    if (!item.active) break;
    if (item.score < THRESHOLD) break;
    results.push(item.value * MULTIPLIER);
  } while (0);
}
```

Each argument at the call site becomes a `const` binding in the enclosing scope (as in
`inline-parameterized-function`). The function body is placed inside a `do {} while (0)`
loop. Every bare `return;` inside the body is replaced with `break`, which exits the
`do {} while (0)` block — replicating the function's early-exit control flow without
leaving the enclosing loop or block.

---

A zero-parameter guard function inlined into a loop:

```js
// Before
function checkAndRecord() {
  if (counter > MAX) return;
  log[log.length] = counter;
  counter++;
}

for (let i = 0; i < N; i++) {
  checkAndRecord();
}
```

```js
// After
for (let i = 0; i < N; i++) {
  do {
    if (counter > MAX) break;
    log[log.length] = counter;
    counter++;
  } while (0);
}
```

---

A function that mixes early exit with local variable declarations:

```js
// Before
function maybeStore(raw) {
  const parsed = parse(raw);
  if (parsed === null) return;
  const key = parsed.id.toString();
  cache[key] = parsed;
}

for (const raw of inputs) {
  maybeStore(raw);
}
```

```js
// After
for (const raw of inputs) {
  const raw_ = raw;
  do {
    const parsed = parse(raw_);
    if (parsed === null) break;
    const key = parsed.id.toString();
    cache[key] = parsed;
  } while (0);
}
```

`const` and `let` declarations inside the `do {} while (0)` body are block-scoped to it
and do not leak into the surrounding loop body. The argument binding is placed outside
the `do {} while (0)` so it is evaluated unconditionally before the guarded block runs.

---

## Why it's faster

The performance gains are the same as for `inline-no-arg-function` and
`inline-parameterized-function`: stack frame allocation, argument-passing ABI, formal
parameter binding, and IC check overhead are all eliminated. The early-exit variant adds
one further consideration: the `do {} while (0)` wrapper itself.

### Stack frame allocation and teardown

Every call to a JavaScript function pushes an activation record onto the native call
stack. The record includes the `this` value, `new.target`, the closure pointer, the saved
return address, the saved frame pointer, one slot per formal parameter, and one slot per
local variable. On function return the frame must be torn down regardless of which `return`
statement was reached. When the call site is inside a hot loop, this push/pop cycle runs
on every iteration — even when the guard condition is met on the very first check and the
function returns immediately.

The inlined `do {} while (0)` form introduces argument bindings in the caller's existing
activation record. No new frame is pushed. A `break` that exits the `do {} while (0)`
body is a branch instruction within the already-live register file of the caller — no
frame teardown required.

### Early return path is particularly expensive without inlining

For functions with guard conditions at the top, the majority of calls in a real-world hot
loop may take the early exit path. Each of those calls still pays the full call overhead
(frame push, IC check, Ignition prologue, frame pop) even though the body does almost no
work. After inlining, the short-circuit path is just a conditional branch — the cheapest
possible outcome on both modern CPUs and V8's Ignition bytecode dispatch loop.

### `do {} while (0)` — zero runtime cost

The condition `while (0)` is a compile-time constant. V8's optimising compiler
(TurboFan) eliminates the back-edge entirely; the `do {} while (0)` is treated as a
plain block with a forward jump target for `break`. At the machine-code level there is no
branch back to the top: the construct compiles to the same code as a labelled block
statement. The `while (0)` check is not present in the emitted native code.

### Formal parameter binding (Ignition prologue)

Ignition's function prologue writes each actual argument from the call frame into the
corresponding parameter slot in the callee's register file. Each write is a distinct
bytecode instruction executed on every call. `const` bindings for arguments introduced in
the caller avoid this prologue entirely; the values are already live in the caller's
register file.

### Inline Cache and call dispatch

Even in the monomorphic fast path V8 must, on every iteration: load the cached callee
object from the IC slot, compare it against the actual callee, and branch to the cached
call sequence. A `do {} while (0)` block and a `const` binding have no call site and no
IC machinery.

### TurboFan inlining budget

TurboFan automatically inlines small callees, but the heuristic is gated on the callee's
bytecode size and the caller's total IR graph size. A function with guard conditions and
local variable declarations is larger in bytecode than a trivial expression, making it
more likely to be excluded from automatic inlining when the enclosing caller is itself
large. Manual inlining removes this dependency.

---

## When it applies

All of the following must hold for the rewrite to be safe:

- **The function contains at least one bare `return;` (void return) that is not at the
  very end of the body.** These early exits are the specific control-flow pattern that
  requires the `do {} while (0)` / `break` treatment. A function whose only exits are
  value-returning `return <expr>` statements is handled by `inline-returning-function`.
- **The function does not return a value from any of its exit points.** All `return`
  statements must be bare `return;` with no expression. A function that mixes early
  `return;` (void) with value-returning `return <expr>` requires a composition of this
  rule with `inline-returning-function` (every value-returning exit assigns to `_result`
  and then `break`s; the `do {} while (0)` wrapper provides the exit point). Keep such
  compositions out of this rule's scope; implement them as a separate combined rule.
- **The function is a plain function declaration or a `const`/`let`-bound function
  expression** whose binding is never reassigned. If the binding can be mutated
  (`fn = otherFn`), the inlined body may not match the function actually called at runtime.
- **The function is not a generator (`function*`) or an async function (`async function`).**
  Generator calls return an iterator; async calls return a `Promise`. Neither is replicable
  by a `do {} while (0)` block.
- **The function is not called with `new`.** Constructor semantics — object allocation,
  `this` binding, `new.target`, prototype assignment, and the return-value override rule —
  cannot be replicated by a block statement.
- **The function is called as a plain call** (`fn(a, b)`), not as a method call
  (`obj.fn(a, b)`), not via `.call`/`.apply`/`.bind`. Method calls set `this` to `obj`;
  after inlining into a bare block `this` resolves to the caller's `this`.
- **The function body contains no `this` reference.** After inlining, any `this` resolves
  to the caller's `this`, which may differ from the `undefined` (strict mode) or global
  object (sloppy mode) that the original callee would have seen.
- **The function body contains no `arguments` reference.** After inlining, `arguments`
  resolves to the caller's argument object, not the callee's.
- **The function body contains no `var` declarations.** `var` ignores block boundaries
  and would hoist into the caller's function scope, potentially colliding with existing
  variable names. `let` and `const` declarations inside the `do {} while (0)` are safely
  block-scoped.
- **The function body contains no unlabelled `break` or `continue` statements that are
  not themselves inside a loop or switch within the body.** After inlining, an unlabelled
  `break` inside the `do {} while (0)` body would exit the `do {} while (0)` rather than
  the intended inner construct. A `break` or `continue` that is already enclosed in its
  own loop or `switch` inside the body targets that inner construct and is safe. A
  top-level `break`/`continue` in the original body is already a syntax error in a plain
  function, so this condition is automatically satisfied for valid input.
- **The call site is not itself inside a labelled statement that uses the same label as
  any label introduced in the inlined body.** Label collisions are only possible if the
  transform introduces a label on the `do {} while (0)` itself (as required by
  `inline-loop-in-function`); for this rule the `do {} while (0)` is unlabelled and no
  label conflict can arise.
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
| Function returns a value from any path (`return <expr>`) | The return value must be captured in a `let _result` variable; use `inline-returning-function`. A mix of `return;` and `return <expr>` requires a combined rule. |
| Function body contains a loop with `break`/`continue` that refers to the function exit | An unlabelled `break` or `continue` that is not enclosed in a loop/switch within the body is a syntax error in the original source; this cannot occur in valid input. However, if the body contains a loop and the call site is inside a loop, an unlabelled `break` inside the inlined loop would target the outer loop instead of the inner one — use `inline-loop-in-function` which adds a label to the `do {} while (0)` so the inlined `break`s can target it explicitly. |
| Function is `async` | The call returns a `Promise`; a `do {} while (0)` block does not produce a `Promise` and does not suspend the event loop |
| Function is a generator | The call returns an iterator; a block statement does not |
| Function is called with `new` | `new` semantics (object allocation, `this`, `new.target`, prototype assignment) cannot be replicated by a block statement |
| Function uses `this` | After inlining, `this` resolves to the caller's `this`; if they differ the behaviour changes silently |
| Function references `arguments` | After inlining, `arguments` resolves to the caller's argument object, not the callee's |
| Function body contains `var` declarations | `var` hoists past block boundaries into the caller's function scope, potentially shadowing or colliding with existing names |
| Function binding is mutated (`fn = otherFn`) | The inlined body may not match what is actually called at runtime |
| Called as a method: `obj.guard(x)` | `this` inside the body is `obj`; the inlined block's `this` is the caller's `this` |
| Called via `.call` / `.apply` / `.bind` | Explicit `this` binding is lost after inlining; safe only if the body never reads `this` |
| Body contains `eval` or `with` | Dynamic scope manipulation makes static inlining unsound |
| Argument name or local variable name collides with a binding in the caller's scope and automatic renaming would propagate incorrectly | The transform must either generate a collision-free name or decline the rewrite |
| Function is only called once (cold path) | The overhead eliminated is negligible; inlining only adds code size with no performance benefit |

---

## Benchmark results

Environment: Node.js LTS, vitest bench v3.2.4, Apple Silicon (darwin 25.4.0), 100 000-element array.

Two scenarios were benchmarked to capture the guard-rate sensitivity described in the "Why it's faster" section above.

### Scenario 1 — mixed guard rate (~33% early-exit on first guard)

Items are ~67% active with uniformly distributed scores; roughly one third of calls
exit at the first guard, one third at the second, one third proceed to the write.

| Variant | ops/s | mean (ms) |
|---|---|---|
| function call with early exit (original) | 4 255 | 0.235 |
| inlined `do {} while (0)` block (optimized) | 4 139 | 0.242 |

**Speedup: ~1.03x (noise level — no measurable gain at this guard rate).**

V8's TurboFan is able to inline the small callee when a significant fraction of
iterations reach the write, keeping the function warm and its feedback type-stable.
At mixed guard rates the auto-inlining heuristic handles the case and the manual
rewrite provides no additional benefit.

### Scenario 2 — heavy guard rate (~95% early-exit on first guard)

Only 5% of items are active. The function returns immediately on 95% of all calls.
This is the worst case for call overhead: a full activation record is pushed and
popped for almost no useful work.

| Variant | ops/s | mean (ms) |
|---|---|---|
| function call with early exit (original) | 7 733 | 0.129 |
| inlined `do {} while (0)` block (optimized) | 10 337 | 0.097 |

**Speedup: 1.34x (+34%) — well above the 10% threshold.**

When the early-exit guard fires on nearly every iteration, TurboFan's inlining
heuristic is less effective (the function is rarely warm on the "full" path), and
the per-call frame overhead dominates. Manual inlining replaces the frame push/pop
and IC check with a single conditional branch, producing the 34% gain.

### Conclusion

The rule is justified for **hot loops where the guard fires on the majority of
iterations**. At mixed or low guard rates the gain is within measurement noise
and the transformation adds readability cost with no performance benefit. The
transform should therefore only be applied when the call site is confirmed hot
(via profiler) and the early-exit path is known to fire frequently.

---

## Sources

- [V8 blog: TurboFan JIT Design](https://v8.dev/blog/turbofan-jit) — describes how
  TurboFan's Sea-of-Nodes IR represents control flow; a `return` node in the callee's
  subgraph becomes a branch edge targeting the join point after the inlined region. The
  `do {} while (0)` / `break` pattern is the source-level analogue: `break` exits the
  synthetic loop, and the point after the `do {} while (0)` is the join point.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  explains the bytecode pipeline: Ignition emits a `Return` bytecode on every exit path;
  each `Return` unwinds the call frame regardless of how little work preceded it. Manual
  inlining replaces all `Return` bytecodes with forward `Jump` instructions within the
  caller's frame.
- [V8 blog: Sparkplug — a non-optimising JavaScript compiler](https://v8.dev/blog/sparkplug) —
  documents the stack frame layout; every function call must allocate and later tear down
  the frame even on early-exit paths. When a guard condition triggers early return on
  every call in a hot loop, the frame overhead dominates.
- [Benedikt Meurer — V8 performance blog](https://benediktmeurer.de) — posts on TurboFan
  inlining heuristics: callee bytecode size, call graph depth, and total IR graph size
  determine whether automatic inlining is attempted; guard functions with branching bodies
  often exceed the budget at the call sites where early-exit overhead matters most.
- [Vyacheslav Egorov — "What's up with monomorphism"](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) —
  analysis of Inline Cache behaviour at call sites; even the monomorphic fast path
  requires a load, a comparison, and a branch on every call. A `do {} while (0)` block
  has no call site and no IC machinery.
- [ECMAScript spec: `do-while` statement (§14.7.3)](https://tc39.es/ecma262/#sec-do-while-statement) —
  normative definition: the body executes, then the condition is evaluated; with condition
  `0` (falsy) the loop never repeats. A `break` statement inside the body produces a
  normal completion that exits the loop immediately, making the construct equivalent to a
  labelled block with a forward exit point.
- [ECMAScript spec: `BreakStatement` semantics (§14.9)](https://tc39.es/ecma262/#sec-break-statement) —
  defines that an unlabelled `break` terminates the nearest enclosing iteration statement
  or `switch`; because `do {} while (0)` is an iteration statement, `break` inside it
  exits only that construct and not any outer loop.
- [ECMAScript spec: `ReturnStatement` semantics (§14.10)](https://tc39.es/ecma262/#sec-return-statement) —
  normative definition of what a bare `return;` does: produces an empty completion value,
  unwinds the current execution context, and resumes the caller. Manual inlining replaces
  this entire protocol with a single `break` that jumps to the end of the `do {} while (0)`.
- [ECMAScript spec: Ordinary Function Calls — `OrdinaryCallEvaluateBody` (§10.2.1)](https://tc39.es/ecma262/#sec-ordinarycallevaluatebody) —
  defines the steps executed to call a function: create a new execution context, bind
  parameters, evaluate the body, and extract the completion value. These are the per-call
  steps that manual inlining eliminates.
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
- [MDN: `do...while` statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/do...while) —
  documents that `do {} while (false)` / `do {} while (0)` is an established JavaScript
  idiom for a block that can be exited with `break`; engines optimise the constant-false
  condition away and emit no back-edge branch.
- [MDN: `break` statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/break) —
  documents that an unlabelled `break` exits the immediately enclosing iteration statement
  or `switch`; confirms that `break` inside a `do {} while (0)` exits only that construct
  and does not affect any outer loop.
- [MDN: `arguments` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments) —
  confirms that `arguments` is bound per function, not per block; inlining a body that
  references `arguments` changes which argument list is visible.
- [Node.js profiling guide](https://nodejs.org/en/learn/getting-started/profiling) —
  V8 profiler guidance; flame charts are the recommended tool for identifying hot call
  sites where guard functions with early-return paths dominate execution time.
