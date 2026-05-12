# `inline-parameterized-function` — Inline functions that accept parameters

## Pattern

A helper function that takes parameters, performs work, and returns no value:

```js
// Before
function clampAndStore(value, min, max) {
  const clamped = value < min ? min : value > max ? max : value;
  results[results.length] = clamped;
}

for (let i = 0; i < data.length; i++) {
  clampAndStore(data[i], LOWER, UPPER);
}

// After
for (let i = 0; i < data.length; i++) {
  const value = data[i];
  const min = LOWER;
  const max = UPPER;
  {
    let clamped = value < min ? min : value > max ? max : value;
    results[results.length] = clamped;
  }
}
```

Each argument at the call site becomes a `const` binding introduced immediately before
the inline block, and each `const`/`let` declaration inside the original function body
is reproduced inside the `{}` block. The `const` argument bindings act as the formal
parameters; the inner block provides name isolation for any locals that would otherwise
collide with the surrounding scope.

---

A two-parameter math helper called in a hot loop:

```js
// Before
function addWeighted(a, b) {
  total += a * 0.7 + b * 0.3;
}

for (let i = 0; i < N; i++) {
  addWeighted(xs[i], ys[i]);
}

// After
for (let i = 0; i < N; i++) {
  const a = xs[i];
  const b = ys[i];
  {
    total += a * 0.7 + b * 0.3;
  }
}
```

When the function body is a single expression and there are no local variable name
collisions, the inner `{}` block can be omitted and the body statement placed directly
after the `const` bindings. The `{}` is always safe to keep for clarity.

---

A normalisation helper whose parameter shadows an outer variable:

```js
// Before — `key` is also declared in the outer loop
function normalizeKey(key) {
  keyMap[key.toLowerCase()] = true;
}

for (const key of rawKeys) {
  normalizeKey(key);
}

// After — the const binding for the argument uses a generated name to avoid shadowing
for (const key of rawKeys) {
  const _key = key;   // renamed to avoid duplicate `const key` in the same scope
  {
    keyMap[_key.toLowerCase()] = true;
  }
}
```

The transform must detect when an argument name would duplicate a binding already
visible in the enclosing scope and rename accordingly (see "When it does NOT apply").

---

## Why it's faster

The performance gains are the same as for `inline-no-arg-function`, with one additional
source of savings: the elimination of formal-parameter binding.

### Stack frame allocation

Every JavaScript function call requires V8 to allocate an **activation record** on the
call stack. The record contains one slot for every declared parameter in addition to the
frame header (`this`, `new.target`, closure pointer, return address, saved frame pointer).
For a function with *n* parameters, V8 writes *n* argument values into those slots before
transferring control to the callee. On return the frame is torn down. When the call site
is inside a hot loop this push/pop cycle and the associated slot writes run millions of
times.

The `const` bindings introduced by the inlined form are allocated inside the already-live
frame of the caller. The compiler can register-allocate them or place them in the caller's
existing stack frame without any frame transition.

### Argument passing ABI

On the V8 calling convention, arguments are passed on the stack or in registers depending
on the target platform and the arity. Even for a 2-parameter function on x86-64, at least
one argument value must be moved into a specific register before the `call` instruction is
issued. Introducing `const` bindings for the arguments lets TurboFan fold those values
directly into the subsequent uses without any ABI-imposed register shuffle.

### Formal parameter binding in Ignition bytecode

When Ignition executes a function call it emits bytecode that:
1. Pushes the callee onto the accumulator.
2. Pushes each argument expression in evaluation order.
3. Emits a `CallAnyReceiver` / `Call` bytecode that drives the dispatch loop to the
   callee's bytecode handler.
4. At entry to the callee, Ignition writes each argument into the function's register
   file at the positions corresponding to the formal parameters.

Each of those register writes is an explicit bytecode instruction in the callee's prologue.
With inlining, the argument expressions are evaluated in the caller's register file and
bound directly via `const`. No prologue register-write loop is needed.

### Inline Cache and call dispatch

As with the no-argument case, every dynamic call site carries an **Inline Cache** that
must be checked on each iteration even in the monomorphic (single-target) fast path: load
the cached function object, compare it with the actual callee, and branch. A `const`
binding and an inline block have no call site and no IC machinery.

### TurboFan inlining budget

TurboFan does inline small callees automatically, but the heuristic is gated on bytecode
size of the callee, depth of the call graph, and total size of the caller's IR graph. A
parameterised function with several locals is larger in bytecode than a zero-parameter
void function, so it is more likely to be excluded from automatic inlining when the
enclosing function is itself large. Manual inlining removes this dependency entirely.

---

## When it applies

All of the following must hold:

- **The function has at least one declared parameter and no rest parameter.** A rest
  parameter (`...args`) creates an `Array` object at the call site; mapping it to a
  `const` binding requires generating the array literal from the excess arguments, which
  is only safe when the call site passes a fixed, known number of arguments — see "When
  it does NOT apply".
- **The function has no `return` statement** (or only a bare `return;` at the very end).
  Functions that return a value require the `inline-returning-function` treatment.
- **No early `return;` statement** appears inside the body that could short-circuit
  execution before the end of the function. Early exits require the `do {} while (0)`
  / `break` treatment from `inline-early-exit-function`.
- **The function is a plain function declaration or a `const`/`let`-bound function
  expression** whose binding is never reassigned. A mutable binding (`fn = other`) means
  the call site may target a different function at runtime.
- **The function is not a generator or an async function.** Generator calls return an
  iterator; async calls return a `Promise`. Neither is replicable by a block statement.
- **The function is not called with `new`.** Constructor semantics (object allocation,
  `this` binding, `new.target`, prototype assignment) cannot be replicated.
- **The function is called as a plain call** (`fn(a, b)`), not as a method call
  (`obj.fn(a, b)`), not via `.call`/`.apply`/`.bind`. Method calls set `this` to `obj`;
  after inlining into a bare block `this` resolves to the caller's `this`.
- **The function body contains no `this` reference.** After inlining, `this` resolves to
  the caller's `this`, which may differ from the `undefined` (strict) or global (sloppy)
  that the original call would have produced.
- **The function body contains no `arguments` reference.** After inlining, `arguments`
  resolves to the caller's argument object.
- **The function body contains no `var` declarations.** `var` ignores block boundaries
  and would hoist into the caller's function scope, potentially colliding with existing
  variable names.
- **The number of arguments at the call site equals the number of formal parameters.**
  If fewer arguments are passed, the missing parameters would be `undefined` at runtime.
  The transform must either insert an explicit `const missingParam = undefined;` binding
  or decline the rewrite. Passing more arguments than parameters is always safe to inline
  (the extra arguments are ignored), but the extra argument expressions must still be
  evaluated for their side effects.
- **No argument name or local variable name in the function body would collide with a
  `let`/`const`/`var` binding already in scope at the call site**, or the transform must
  rename the conflicting identifier consistently throughout the inlined body. Duplicate
  `let`/`const` bindings in the same block scope are a `SyntaxError`.
- **The function does not use `eval` or `with`.** Both make identifier resolution dynamic
  and render static inlining unsound.
- **The function is called synchronously on a hot path** (tight loop, frequently invoked
  callback). Inlining a cold-path function trades readability for no measurable gain.
- **The function declaration is statically visible and there is exactly one definition**
  in scope at the call site. Multiple or conditional definitions require full data-flow
  analysis beyond what a simple syntactic transform can guarantee.

---

## When it does NOT apply

| Condition | Risk |
|---|---|
| Function has a rest parameter (`...args`) | The `const args` binding would require constructing an `Array` from the remaining call-site arguments; safe only when the arity is fixed and fully known statically |
| Function returns a value | The return expression must be captured in a `let` variable in the parent scope; use `inline-returning-function` |
| Function contains an early `return;` | Control flow must be replicated with `do {} while (0)` + `break`; use `inline-early-exit-function` |
| Function is `async` | The call returns a `Promise`; a block statement produces no `Promise` and does not suspend the caller |
| Function is a generator | The call returns an iterator; a block statement does not |
| Function is called with `new` | Constructor semantics (`this` allocation, `new.target`, prototype) cannot be replicated by a block statement |
| Function uses `this` | After inlining, `this` resolves to the caller's `this`; if they differ the behaviour changes silently |
| Function references `arguments` | After inlining, `arguments` resolves to the caller's argument object, not the callee's |
| Function body contains `var` declarations | `var` hoists past block boundaries into the caller's function scope, potentially shadowing existing variable names |
| Argument count at call site does not match parameter count and the transform cannot insert a `= undefined` binding safely | Missing parameters would silently become `undefined`; the transform must emit explicit `const p = undefined;` or decline |
| Argument name or local variable name collides with a binding in the caller's scope and automatic renaming would require renaming a name that is also referenced outside the inlined region | The rename propagation may be incorrect; safer to decline the rewrite |
| Function binding is mutated (`fn = otherFn`) | The inlined body may not match what is actually called at runtime |
| Called as a method: `obj.helper(x, y)` | `this` inside the body is `obj`; the inlined block's `this` is the caller's `this` |
| Called via `.call` / `.apply` / `.bind` | Explicit `this` binding is lost; body must never read `this` for the rewrite to be safe |
| Body contains `eval` or `with` | Dynamic scope manipulation makes static inlining unsound |
| Function is only called once (cold path) | The overhead eliminated is negligible; inlining only adds code size with no performance benefit |
| Function body contains a loop with `break`/`continue` | Inlining into a block that is itself inside a loop may redirect an unlabelled `break`/`continue` to the outer loop; use `inline-loop-in-function` instead |
| Any argument expression has a side effect that depends on evaluation order relative to other argument expressions | The transform must preserve left-to-right evaluation order; introducing `const` bindings in parameter order achieves this, but the transform must verify no argument expression reads a variable written by an earlier `const` binding for the same call |

---

## Sources

- [V8 blog: TurboFan JIT Design](https://v8.dev/blog/turbofan-jit) — describes how
  TurboFan's Sea-of-Nodes IR represents function inlining as subgraph merging, and how
  the callee's parameter nodes are replaced by the caller's argument nodes during inlining;
  the same substitution that the `const` bindings in a manual inline replicate at the
  source level.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  explains how Ignition's register-based bytecode handles formal parameter passing: each
  parameter occupies a dedicated register slot in the callee's register file, written in
  the function prologue before the body starts; these are the per-call writes that manual
  inlining avoids.
- [V8 blog: Sparkplug — a non-optimising JavaScript compiler](https://v8.dev/blog/sparkplug) —
  documents the stack frame layout including argument slots; even a function with two
  parameters must reserve space for those slots and write to them on every call.
- [Benedikt Meurer — V8 performance blog](https://benediktmeurer.de) — posts on inlining
  heuristics in TurboFan, including how bytecode size of the callee (which grows with
  parameter count and local variable count) determines whether automatic inlining is
  attempted.
- [Vyacheslav Egorov — "What's up with monomorphism"](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) —
  analysis of Inline Cache behaviour at call sites; explains the per-call IC check even
  in the monomorphic fast path and why it is eliminated when there is no call site at all.
- [ECMAScript spec: Ordinary Function Calls — `FunctionDeclarationInstantiation` (§10.2.11)](https://tc39.es/ecma262/#sec-functiondeclarationinstantiation) —
  normative definition of how a function's formal parameters are bound to argument values
  on each call: the spec algorithm iterates over the parameter list, evaluates default
  values if needed, and creates a binding in the function's environment record for each;
  this per-call work is what manual inlining with `const` bindings avoids.
- [ECMAScript spec: `arguments` object creation (§10.4.4)](https://tc39.es/ecma262/#sec-arguments-exotic-objects) —
  documents that a new `arguments` object is created on each call and bound per function,
  not per block; the normative basis for the `arguments`-in-body precondition.
- [ECMAScript spec: `var` hoisting and Variable Environments (§8.1.2)](https://tc39.es/ecma262/#sec-variable-environments) —
  defines that `var` declarations hoist to the `VariableEnvironment` (function scope) not
  to the `LexicalEnvironment` (block scope); the authoritative basis for disallowing `var`
  in the function body.
- [ECMAScript spec: Block scoping and `let`/`const` (§14.2)](https://tc39.es/ecma262/#sec-block) —
  defines that `let` and `const` are scoped to the enclosing `Block`; confirms that `const`
  argument bindings placed immediately before the inline `{}` and `let`/`const` locals
  placed inside the `{}` are safely isolated from the surrounding function scope.
- [MDN: Functions — default parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Default_parameters) —
  documents how default parameter values are evaluated once per call in a separate scope
  that precedes the function body scope; a transform that encounters default parameters
  must emit the conditional initialisation logic (`const p = arg !== undefined ? arg : defaultExpr`)
  rather than a plain `const p = arg`.
- [MDN: Rest parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/rest_parameters) —
  documents that a rest parameter collects trailing arguments into a fresh `Array` on each
  call; inlining a rest parameter requires replicating that array construction at the call
  site, which is only safe when the call-site arity is statically known.
- [MDN: `arguments` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments) —
  confirms that `arguments` is bound per function, not per block; inlining a body that
  references `arguments` into a caller's block changes which argument list is visible.
- [Node.js profiling guide](https://nodejs.org/en/learn/getting-started/profiling) —
  V8 profiler guidance; flame charts are the recommended tool for identifying hot call
  sites where manual inlining of parameterised helpers yields measurable gains.

---

## Benchmark results

Measured with `npx vitest bench rules/inline-parameterized-function/benchmark/bench.js`
on Node.js 22 (LTS), Apple M-series, vitest v3.2.4.

Pattern: a three-parameter `normalizeAndStore` helper (multi-statement body with
`Math.floor`, branching, and a conditional cap) called in a loop of 100 000 iterations.
The body is large enough that TurboFan's auto-inlining heuristic does not apply.

| Variant | ops/s (run 1) | ops/s (run 2) |
|---|---|---|
| `function call (original)` | 4 810 | 4 186 |
| `inlined const bindings (optimized)` | 6 490 | 6 347 |
| **Speedup** | **1.35 ×** | **1.52 ×** |

The inlined form is consistently **35–52 % faster** across runs (well above the 10 %
threshold). The gain is reproducible and stable (rme ≤ 2 %).

**Key observation**: for trivially small bodies (single arithmetic expression) TurboFan
auto-inlines the callee at compile time, closing the gap to ≈ 7 %. The rule is most
valuable for helpers whose bytecode size exceeds TurboFan's inlining budget — typically
functions with ≥ 3 statements, local variable declarations, or branching.
