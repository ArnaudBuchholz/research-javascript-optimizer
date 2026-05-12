# `inline-returning-function` — Inline functions that return a value

## Pattern

A helper function that takes parameters and returns a computed value:

```js
// Before
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

for (let i = 0; i < data.length; i++) {
  output[i] = clamp(data[i], LOWER, UPPER);
}
```

```js
// After
for (let i = 0; i < data.length; i++) {
  const value = data[i];
  const min = LOWER;
  const max = UPPER;
  let _result;
  {
    if (value < min) { _result = min; }
    else if (value > max) { _result = max; }
    else { _result = value; }
  }
  output[i] = _result;
}
```

Each argument at the call site becomes a `const` binding in the enclosing scope. A fresh
`let` variable with a unique, generated name (e.g. `_result`) is introduced in the same
scope immediately before the inline block. Every `return <expr>` inside the function body
is replaced by an assignment to that variable (`_result = <expr>`). The original call
expression is replaced by a reference to `_result`.

---

A single-expression getter inlined into a computation:

```js
// Before
function score(entry) {
  return entry.hits * 10 - entry.misses * 3;
}

const best = items.reduce((acc, item) => Math.max(acc, score(item)), 0);
```

```js
// After
const best = items.reduce((acc, item) => {
  const entry = item;
  let _result;
  {
    _result = entry.hits * 10 - entry.misses * 3;
  }
  return Math.max(acc, _result);
}, 0);
```

---

A zero-parameter function with a computed return value:

```js
// Before
function nextId() {
  return ++counter;
}

for (let i = 0; i < N; i++) {
  ids[i] = nextId();
}
```

```js
// After
for (let i = 0; i < N; i++) {
  let _result;
  {
    _result = ++counter;
  }
  ids[i] = _result;
}
```

When the function body is a single `return` statement and there are no local variable name
collisions, the inner `{}` block can be omitted and the assignment placed directly. The
`{}` is always safe to retain for clarity and to scope any local declarations.

---

## Why it's faster

The performance gains are the same as for `inline-no-arg-function` and
`inline-parameterized-function` — stack frame allocation, argument-passing ABI, formal
parameter binding, and IC check overhead are all eliminated. The returning variant adds
one extra source of savings: the elimination of the return-value protocol.

### Stack frame allocation and teardown

Every call to a JavaScript function causes V8 to push an **activation record** onto the
native call stack. The frame contains the `this` value, `new.target`, the closure pointer,
the saved return address, the saved frame pointer, one slot per formal parameter, and one
slot per local variable declared in the function body. This structure must be initialised
on entry and torn down on return regardless of how trivial the body is. When the call site
is inside a hot loop the push/pop cycle runs on every iteration.

The inlined form introduces `const` bindings for arguments and a `let` binding for the
result. These are allocated inside the caller's existing activation record. No new frame is
pushed; the compiler can register-allocate all of them within the caller's already-live
register file.

### Return-value register protocol

On every JavaScript function return, V8 must:

1. Store the return value in the designated **accumulator register** (Ignition) or return
   register (TurboFan-compiled code).
2. Restore the saved frame pointer and return address.
3. Issue a `ret` instruction that pops the saved return address back into the instruction
   pointer.
4. At the call site, read the value back out of the accumulator / return register into
   whatever register the result expression needs.

Steps 2–4 are independent of what the function computed. After manual inlining the result
is already in `_result`; the compiler sees a plain local variable load with no
cross-frame protocol involved. On a hot path executing 10 million times this is tens of
millions of cycles of bookkeeping eliminated.

### Inline Cache and call dispatch

Even in the best-case monomorphic IC path V8 must, on every iteration: load the cached
callee object from the IC slot, compare it with the actual function object, and branch to
the cached call sequence. A `let _result` declaration and a block statement have no call
site and no IC machinery.

### TurboFan inlining budget

TurboFan does automatically inline small callees, but the heuristic is gated on the
bytecode size of the callee, the depth of the call graph, and the total size of the
caller's intermediate representation graph. A function with a multi-branch body and
local variables is considerably larger in bytecode than a trivial expression, making it
more likely to be excluded from automatic inlining when the enclosing caller is itself
large. Manual inlining removes this dependency: the body is guaranteed to appear at the
call site regardless of budget pressure.

### Formal parameter binding (Ignition prologue)

Ignition's function prologue emits bytecode that writes each actual argument from the call
frame into the corresponding parameter slot in the callee's register file. Each write is
a distinct bytecode instruction executed on every call. `const` bindings for arguments
introduced in the caller avoid this prologue entirely; the values are already live in the
caller's register file from evaluating the argument expressions.

---

## When it applies

All of the following must hold for the rewrite to be safe:

- **The function has exactly one observable exit value.** Every execution path through
  the function body must end with a `return <expr>` (not a bare `return;`, which would
  leave `_result` unassigned). If some paths fall off the end of the function body (implicit
  `return undefined`), the transform must emit `let _result = undefined;` as the initial
  value, or decline the rewrite.
- **The function is a plain function declaration or a `const`/`let`-bound function
  expression** whose binding is never reassigned. If the binding can be mutated
  (`fn = otherFn`), the inlined body may not match the function actually called at runtime.
- **The function is not a generator (`function*`) or an async function (`async function`).**
  Generator calls return an iterator; async calls return a `Promise`. Neither is
  replicable by an assignment to a `let` variable.
- **The function is not called with `new`.** Constructor semantics — object allocation,
  `this` binding, `new.target` initialisation, prototype assignment, and the return-value
  override rule — cannot be replicated by a block statement and a variable.
- **The function is called as a plain call** (`fn(a, b)`), not as a method call
  (`obj.fn(a, b)`), not via `.call`/`.apply`/`.bind`. Method calls set `this` to `obj`;
  after inlining into a bare block `this` resolves to the caller's `this`.
- **The function body contains no `this` reference.** After inlining, any `this`
  resolves to the caller's `this`, which may differ from the `undefined` (strict mode)
  or global object (sloppy mode) that the original call would have produced.
- **The function body contains no `arguments` reference.** After inlining, `arguments`
  resolves to the caller's argument object, not the callee's.
- **The function body contains no `var` declarations.** `var` ignores block boundaries
  and would hoist into the caller's function scope, potentially colliding with existing
  variable names.
- **The function body contains no early `return;` (void return).** A bare `return;`
  short-circuits execution without producing a value; replicating it requires the
  `do {} while (0)` / `break` treatment from `inline-early-exit-function`. A returning
  function whose only early exits are `return <expr>` (value-returning) can be handled
  here: each becomes `_result = <expr>` followed by inserting control-flow to skip the
  remainder of the block — which in practice means the early-return case is a composition
  of this rule with `inline-early-exit-function`.
- **No argument name, the generated result variable name (`_result`), or any local
  variable name in the function body collides with a `let`/`const`/`var` binding already
  in scope at the call site**, or the transform must rename the conflicting identifier
  consistently throughout the inlined body. Duplicate `let`/`const` bindings in the same
  block scope are a `SyntaxError`.
- **The generated result variable name must be unique in the enclosing scope.** When
  multiple calls to the same (or different) functions are inlined into the same scope,
  each must receive its own `_result_N` variable. The transform must generate
  collision-free names, e.g. `_result_1`, `_result_2`, or a hash-based suffix.
- **The call expression is used as a value** (assigned, passed as an argument, used in an
  expression, or returned). If the call result is discarded (expression statement
  `fn(x);`), the function effectively has no meaningful return value to capture; the
  `inline-parameterized-function` rule (which requires no return value) applies instead.
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
| Function has a `return;` (bare void return) in the middle of the body | Control flow short-circuits without assigning `_result`; requires the `do {} while (0)` / `break` treatment from `inline-early-exit-function` |
| Function falls off the end without a `return` on all paths | `_result` would be `undefined` on those paths; safe only if the transform emits `let _result = undefined;` and the caller can tolerate `undefined` |
| Function is `async` | The call returns a `Promise`; a block-statement result variable does not produce a `Promise` and does not suspend the event loop |
| Function is a generator | The call returns an iterator; a block statement does not |
| Function is called with `new` | `new` semantics (object allocation, `this`, `new.target`, prototype assignment, return-value override) cannot be replicated by an assignment to a `let` |
| Function uses `this` | After inlining, `this` resolves to the caller's `this`; if they differ the behaviour changes silently |
| Function references `arguments` | After inlining, `arguments` resolves to the caller's argument object, not the callee's |
| Function body contains `var` declarations | `var` hoists past block boundaries into the caller's function scope, potentially shadowing or colliding with existing names |
| Call result is discarded (expression statement `fn(x);`) | The return value is not consumed; use `inline-parameterized-function` instead, which requires no result variable |
| Result variable name (`_result`) collides with an existing binding and the transform cannot generate a unique name | Duplicate `let` bindings in the same block scope are a `SyntaxError`; the transform must either generate a collision-free name or decline |
| Multiple inlined calls share the same scope and the transform generates the same `_result` name for both | Two `let _result` declarations in the same block scope are a `SyntaxError`; the transform must suffix names to ensure uniqueness |
| Function binding is mutated (`fn = otherFn`) | The inlined body may not match what is actually called at runtime |
| Called as a method: `obj.compute(x)` | `this` inside the body is `obj`; the inlined block's `this` is the caller's `this` |
| Called via `.call` / `.apply` / `.bind` | Explicit `this` binding is lost after inlining; safe only if the body never reads `this` |
| Body contains `eval` or `with` | Dynamic scope manipulation makes static inlining unsound |
| Function contains a loop with `break`/`continue` and the call site is itself inside a loop | An unlabelled `break`/`continue` in the inlined body would target the outer loop instead of the inner one; use `inline-loop-in-function` |
| Function is only called once or on a cold path | The overhead eliminated is negligible; inlining only adds code size with no performance benefit |

---

## Benchmark results

Measured on Node.js LTS (v22) with vitest bench, 100 000 iterations per bench sample.
The loop body sums the return value of a three-branch clamp function so the result is
consumed and the compiler cannot eliminate the call.

| Variant | ops/s | mean (ms) |
|---|---|---|
| function call (original) | 15 860 | 0.0630 |
| inlined _result binding (optimized) | 17 687 | 0.0565 |

**Speedup: 1.12× (≈ 12% faster)**

The measured gain exceeds the 10% acceptance threshold. The improvement reflects the
elimination of the per-call stack-frame push/pop, the return-value register protocol,
the monomorphic IC check at the call site, and the Ignition prologue that writes each
actual argument into the callee's parameter slots. The inlined form keeps all values in
the caller's existing register file without any cross-frame value transfer.

---

## Sources

- [V8 blog: TurboFan JIT Design](https://v8.dev/blog/turbofan-jit) — describes how
  TurboFan's Sea-of-Nodes IR represents inlining as subgraph merging; the callee's
  `Return` node is replaced by wiring its value output directly into the caller's data
  graph. The `let _result` variable is the source-level analogue: a named slot in the
  caller's IR into which the callee's computed value is written.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  explains the bytecode pipeline: Ignition emits a `Return` bytecode that moves the
  accumulator value back to the call site; TurboFan must model that value flow across the
  call edge. Manual inlining eliminates the call edge and the cross-frame value transfer.
- [V8 blog: Sparkplug — a non-optimising JavaScript compiler](https://v8.dev/blog/sparkplug) —
  documents the stack frame layout including the return-value slot; every function call
  must reserve and populate this slot on entry and read it back on return, contributing to
  the fixed per-call overhead that manual inlining avoids.
- [Benedikt Meurer — V8 performance blog](https://benediktmeurer.de) — posts on TurboFan
  inlining heuristics: callee bytecode size, call graph depth, and total IR graph size
  determine whether automatic inlining is attempted; functions with branching bodies and
  local variables are more likely to exceed the budget.
- [Vyacheslav Egorov — "What's up with monomorphism"](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) —
  analysis of Inline Cache behaviour at call sites; even the monomorphic fast path
  requires a load, a comparison, and a branch on every call. A `let _result` binding and
  a block statement have no call site and no IC machinery.
- [ECMAScript spec: `ReturnStatement` semantics (§14.10)](https://tc39.es/ecma262/#sec-return-statement) —
  normative definition of what `return <expr>` does: evaluates the expression to a
  completion value, unwinds the current execution context, and resumes the caller with
  that value. Manual inlining replaces this entire protocol with a plain assignment.
- [ECMAScript spec: Ordinary Function Calls — `OrdinaryCallEvaluateBody` (§10.2.1)](https://tc39.es/ecma262/#sec-ordinarycallevaluatebody) —
  defines the steps executed to call a function: create a new execution context, bind
  parameters, evaluate the body, and extract the return completion value. These are the
  per-call steps that manual inlining eliminates.
- [ECMAScript spec: `FunctionDeclarationInstantiation` (§10.2.11)](https://tc39.es/ecma262/#sec-functiondeclarationinstantiation) —
  normative definition of how formal parameters are bound to argument values on each call;
  the `const` argument bindings of the inlined form replicate this at the source level,
  inside the caller's already-live environment record.
- [ECMAScript spec: `var` hoisting and Variable Environments (§8.1.2)](https://tc39.es/ecma262/#sec-variable-environments) —
  defines that `var` declarations hoist to the `VariableEnvironment` (function scope), not
  the `LexicalEnvironment` (block scope); the authoritative basis for disallowing `var`
  in the function body.
- [ECMAScript spec: Block scoping and `let`/`const` (§14.2)](https://tc39.es/ecma262/#sec-block) —
  defines that `let` and `const` are scoped to the enclosing `Block`; confirms that the
  `let _result` binding placed before the inline `{}` is scoped to the nearest enclosing
  block and does not leak into the surrounding function scope.
- [MDN: `return` statement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/return) —
  documents that `return` without a value returns `undefined`, and that falling off the
  end of a function body is equivalent to `return undefined`; the basis for the precondition
  that all paths must yield a value if `_result` is to have a defined value.
- [MDN: `arguments` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments) —
  confirms that `arguments` is bound per function, not per block; inlining a body that
  references `arguments` changes which argument list is visible.
- [Node.js profiling guide](https://nodejs.org/en/learn/getting-started/profiling) —
  V8 profiler guidance; flame charts are the recommended tool for identifying hot call
  sites where manual inlining of value-returning helpers yields measurable gains.
