# `inline-no-arg-function` — Inline zero-parameter, void helper functions

## Pattern

A trivial helper that takes no parameters and returns no value:

```js
// Before
function initCounters() {
  hits = 0;
  misses = 0;
  total = 0;
}

for (let i = 0; i < iterations; i++) {
  initCounters();
  runPass(data);
}

// After
for (let i = 0; i < iterations; i++) {
  {
    hits = 0;
    misses = 0;
    total = 0;
  }
  runPass(data);
}
```

A setup helper called once inside a tight loop:

```js
// Before
function resetState() {
  state.count = 0;
  state.done = false;
}

items.forEach((item) => {
  resetState();
  process(item, state);
});

// After
items.forEach((item) => {
  {
    state.count = 0;
    state.done = false;
  }
  process(item, state);
});
```

A logging / side-effect helper whose body is a single expression statement:

```js
// Before
function tick() {
  counter++;
}

for (let i = 0; i < N; i++) {
  tick();
  doWork(i);
}

// After
for (let i = 0; i < N; i++) {
  {
    counter++;
  }
  doWork(i);
}
```

---

## Why it's faster

Every JavaScript function call carries fixed overhead that is unrelated to the work the
function body performs. Reproducing the body directly in the call site eliminates that
overhead entirely.

### Stack frame allocation

Each call to a JavaScript function requires V8 to push a new **activation record** (stack
frame) onto the call stack. The frame holds:

- the `this` value,
- the `new.target` value,
- one slot per declared parameter (none in this case, but the header is still written),
- all local variables declared in the function body,
- the saved return address and frame pointer.

For a no-argument, void function these slots are nearly empty, yet the frame must still
be allocated and torn down on every call. When the call site is inside a hot loop this
push/pop cycle runs millions of times.

### Context (closure) allocation

A function declared at module or file scope closes over the enclosing lexical scope. V8
represents the scope chain as a heap-allocated **Context** object. On each call, V8 must
resolve the correct context chain for the callee even if the function does not read any
closed-over variable — the machinery cannot be skipped without static proof that the
function is context-free, which a general-purpose compiler cannot easily obtain for
arbitrary call sites.

When the body is inlined into a block statement in the caller, the variable references
already resolve through the existing context chain of the caller. No additional context
object is needed.

### Inline Cache (IC) lookup and type feedback

V8 tracks the type profile of every call site using an **Inline Cache**. The first time a
call site executes, V8 records the target function in the IC. On subsequent calls it
checks that the target has not changed (monomorphic IC check) before using the cached
call path. Even in the best-case monomorphic path this is a load, a comparison, and a
conditional branch on every iteration.

A direct block statement has no call site and no IC machinery at all.

### Inlining budget limits

TurboFan does inline small functions automatically — but only when the **inlining budget**
allows it. The budget is measured in bytecode size, and the heuristic is applied per
call-graph depth and per-function total. A function that calls many small helpers may
exhaust the budget before reaching a deep one; a function that is itself large may not
be inlined even if its body is trivial. The budget also accounts for call frequency:
functions called from multiple call sites share budget pressure, and the compiler may
choose not to inline all of them.

Manual inlining removes the dependency on the compiler's budget and heuristics entirely.
The body is guaranteed to be present at the call site regardless of the surrounding
context size, call depth, or how many other functions compete for the same budget.

### Call instruction cost

At the machine-code level, a `call` instruction saves the return address, updates the
stack pointer, and transfers control. On modern x86-64 CPUs a near `call` + matching
`ret` pair is typically 2–4 cycles in isolation. Inside a loop executing 10 million
times, that is 20–40 million cycles of pure bookkeeping — not counting the frame
setup/teardown that flanks the call.

A block statement is zero additional instructions for the call itself; the body
instructions run sequentially in the already-warm register file of the caller.

---

## When it applies

All of the following must hold for the rewrite to be safe:

- **The function has zero declared parameters.** Parameters introduce local bindings that
  must be mapped to `const`/`let` declarations at the inline site — that is a different
  rule (`inline-parameterized-function`).
- **The function has no `return` statement** (or has only a bare `return;` that exits
  without a value at the very end of the body). A `return` with a value produces a result
  that the caller is expected to consume — that is a different rule
  (`inline-returning-function`). A bare `return;` in the middle of the body (early exit)
  requires the `do {} while (0)` / `break` treatment — that is yet another rule
  (`inline-early-exit-function`).
- **The function is a plain function declaration or a `const`/`let`-bound function
  expression** whose binding is never reassigned. If the binding can be mutated
  (`funcRef = otherFn`), the call site may target a different function at runtime than the
  one the transform inlined.
- **The function is not a generator (`function*`) or an async function (`async function`)**. 
  Generator calls return an iterator object; async function calls return a `Promise`. Both
  have protocol semantics that a bare block statement cannot replicate.
- **The function is not a constructor** (i.e., the call site never uses `new`). A `new`
  call allocates an object, sets `this`, and returns it. Inlining a constructor call
  requires `new.target` handling and prototype-chain setup that a block statement cannot
  trivially provide.
- **The function body contains no `arguments` reference.** `arguments` inside the function
  body refers to the callee's own argument list (always empty here), not the caller's
  arguments. After inlining into the caller, any `arguments` reference would resolve to
  the caller's `arguments` instead — silently changing behaviour if the caller has
  parameters.
- **The function does not read or write `this`.** A regular function's `this` is set by
  the call site (`func()` → `undefined` in strict mode, or the global object in sloppy
  mode). After inlining, any `this` reference resolves to the caller's `this`. If
  the callee's semantics depend on `this` being `undefined` / global and the caller has a
  different `this`, the behaviour changes.
- **The function is called as a plain call** (`func()`), not as a method call
  (`obj.func()`), not via `.call`/`.apply`/`.bind`, and not with `new`. Method calls and
  explicit `this` binding affect what `this` resolves to inside the body (see above).
- **The function declaration is visible (in scope) at the call site and there is exactly
  one definition.** If the same name is declared in multiple scopes or re-declared
  conditionally, the static analysis must determine which definition applies at the call
  site before inlining.
- **The function body contains no `var` declarations.** `var` hoists to the nearest
  enclosing function scope, not to a block scope. Inlining a `var` declaration into a
  block statement places it in a `{}`, but `var` ignores block boundaries — it would
  hoist into the caller's function scope, potentially shadowing or colliding with an
  existing variable of the same name. `let` and `const` declarations are block-scoped and
  safe to inline into a `{}` block.
- **None of the local variable names in the function body collide with names in the
  caller's scope.** A `let x` inside the inline block is scoped to that block and does
  not conflict — but if the caller already has a `let x` in the same scope, the transform
  must rename one of them to avoid a `SyntaxError` from duplicate `let` bindings, or
  decline the rewrite.
- **The function does not use `eval`.** `eval` can introduce new variable bindings
  dynamically, read the caller's scope chain, and generally render the function's
  semantics opaque to static analysis. Any function containing `eval` must not be inlined.
- **The function does not use `with`.** `with` adds an object to the scope chain and makes
  all identifier resolution dynamic; for the same reasons as `eval`, functions containing
  `with` cannot be safely inlined.
- **The function is called synchronously** in a context where call frequency makes the
  overhead measurable (i.e., a hot path: tight loop, repeated callback, frequently
  triggered event handler). Inlining a function called once per process startup gains
  nothing and adds code bloat.

---

## When it does NOT apply

| Condition | Risk |
|---|---|
| Function has parameters | Parameter values must be bound as `const` variables at the inline site; this is a separate rule (`inline-parameterized-function`) |
| Function returns a value | The return value must be captured in a `let` variable in the parent scope; this is a separate rule (`inline-returning-function`) |
| Function contains an early `return;` | The control flow must be replicated with `do {} while (0)` + `break`; this is a separate rule (`inline-early-exit-function`) |
| Function is `async` | The call returns a `Promise`; a block statement does not — completely different execution semantics |
| Function is a generator | The call returns an iterator; a block statement does not |
| Function uses `this` | After inlining, `this` resolves to the caller's `this`; if they differ the behaviour changes silently |
| Function references `arguments` | After inlining, `arguments` resolves to the caller's arguments object, not an empty one |
| Function body contains `var` declarations | `var` ignores block boundaries and hoists into the caller's function scope, potentially colliding with existing variable names |
| Function binding is reassigned at runtime (`fn = otherFn`) | The inlined body may not match the function actually called; the rewrite is only valid when the binding is provably stable |
| Called with `new` | `new` semantics (object creation, `this` binding, prototype assignment, `new.target`) cannot be replicated by a block statement |
| Called as a method: `obj.resetState()` | `this` inside the body is `obj`; after inlining into a bare block, `this` is whatever the caller's `this` is — behaviour changes unless the body never touches `this` |
| Called via `.call` / `.apply` / `.bind` | Explicit `this` binding is lost after inlining; body must never read `this` for the rewrite to be safe |
| Body contains `eval` or `with` | Dynamic scope manipulation makes static inlining unsound |
| Multiple definitions of the same name are in scope | The transform cannot determine which definition is active at the call site without full data-flow analysis |
| Function is only called once (cold path) | The overhead eliminated is negligible; inlining adds code size with no performance benefit |
| Function body contains a `break` or `continue` targeting a loop in the callee | There is no loop in a no-arg void function by definition, but if the body includes a loop and the `break`/`continue` targets that loop, inlining into a block statement preserves the semantics — however if the outer call site is also inside a loop, an unlabelled `break` now targets the outer loop (see `inline-loop-in-function`) |

---

## Benchmark results

Measured on Node.js LTS (v22) with vitest bench, 100 000 iterations per bench sample.

| Variant | ops/s | mean (ms) |
|---|---|---|
| function call (original) | 11 233 | 0.0890 |
| inlined block (optimized) | 13 044 | 0.0767 |

**Speedup: 1.16× (≈ 16% faster)**

The measured gain is consistent with the theoretical analysis: eliminating the per-call
stack-frame push/pop, the monomorphic IC check, and the closure-pointer resolution on each
of 100 000 iterations adds up to a measurable, reproducible improvement above the 10%
acceptance threshold.

---

## Sources

- [V8 blog: TurboFan JIT Design](https://v8.dev/blog/turbofan-jit) — describes the
  Sea-of-Nodes IR that TurboFan builds for each compiled function; inlining is the act of
  merging one function's subgraph into another's, which requires the callee subgraph to
  fit within the caller's budget.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  explains how Ignition produces bytecode from which TurboFan decides what to inline;
  the bytecode size of the callee is the primary inlining budget metric.
- [V8 blog: Sparkplug — a non-optimising JavaScript compiler](https://v8.dev/blog/sparkplug) —
  describes the stack frame layout that every JavaScript function call must set up and
  tear down, including the frame header slots for `this`, `new.target`, and the closure
  pointer; illustrates why even an empty function body carries fixed call overhead.
- [Benedikt Meurer (V8 lead) — performance blog](https://benediktmeurer.de) — series of
  posts on TurboFan inlining heuristics, including how inlining budgets are applied across
  call graph depth and why megamorphic call sites are never inlined.
- [Vyacheslav Egorov — "What's up with monomorphism"](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) —
  explains Inline Caches at call sites: the monomorphic IC fast path that checks a single
  target function before dispatching, and how megamorphic call sites fall back to a generic
  `CallFunctionStub` that cannot be inlined; directly relevant to why even a single-target
  call site has observable overhead per iteration.
- [ECMAScript spec: Ordinary Function Calls (§10.2.1)](https://tc39.es/ecma262/#sec-ordinarycallbindthis) —
  normative definition of what happens when a function is called: `this` binding,
  `new.target` initialisation, formal parameter binding, and `arguments` object creation;
  the authoritative source for which runtime steps an inlined block statement can safely
  skip.
- [ECMAScript spec: `var` hoisting and Variable Environments (§8.1.2)](https://tc39.es/ecma262/#sec-variable-environments) —
  defines why `var` declarations hoist to the enclosing `VariableEnvironment` (function
  scope) rather than the `LexicalEnvironment` (block scope); the normative basis for the
  `var`-in-body precondition.
- [ECMAScript spec: Block scoping and `let`/`const` (§14.2)](https://tc39.es/ecma262/#sec-block) —
  defines that `let` and `const` declarations are scoped to the enclosing `Block`
  statement, making them safe to place inside the inlined `{}` without leaking into the
  surrounding function scope.
- [MDN: Functions guide — closures and scope chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures) —
  explains how V8 (and all JS engines) represent the lexical scope chain; each function
  call must resolve the correct scope chain entry for the callee even before the body
  executes; inlining eliminates this lookup by reusing the caller's chain.
- [MDN: `arguments` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments) —
  documents that `arguments` is bound per-function, not per-block; inlining a body that
  references `arguments` into a block statement changes which `arguments` object is visible.
- [Node.js performance best practices](https://nodejs.org/en/learn/getting-started/profiling) —
  V8 profiling guidance; profiler flame charts are the recommended tool for identifying
  hot call sites where manual inlining is worth the cost in code readability.
