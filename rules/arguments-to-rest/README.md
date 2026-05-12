# `arguments-to-rest` — Replace `arguments` object with a rest parameter

## Pattern

Forwarding all arguments to another call:

```js
// Before
function sum() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) {
    total += arguments[i];
  }
  return total;
}

// After
function sum(...args) {
  let total = 0;
  for (let i = 0; i < args.length; i++) {
    total += args[i];
  }
  return total;
}
```

Spreading arguments into another call:

```js
// Before
function log() {
  console.log.apply(console, arguments);
}

// After
function log(...args) {
  console.log(...args);
}
```

Slicing arguments into an array:

```js
// Before
function tail() {
  return Array.prototype.slice.call(arguments, 1);
}

// After
function tail(...args) {
  return args.slice(1);
}
```

## Why it's faster

The `arguments` object is a special **array-like** object that V8 must handle with a
set of constraints that prevent several key optimisations.

**`arguments` leaks the stack frame.** When a function references `arguments`, V8 cannot
apply *arguments object elision*: the optimisation that keeps function parameters in CPU
registers (or on the fast stack) rather than materialising a heap-allocated `Arguments`
object. The moment `arguments` is referenced, V8 must allocate a real object on the heap
and populate it with the current parameter values, which costs an allocation plus
`n` element writes.

**`arguments` can alias named parameters.** In sloppy mode, assigning to a positional
parameter (`x = 1`) updates `arguments[0]` and vice versa. This two-way aliasing makes
the function's frame *observable* in a way that prevents Turbofan from freely moving
or eliding writes to named parameters. Strict mode breaks the alias but the object must
still be allocated; only eliminating the reference entirely removes the cost.

**`arguments` blocks inlining.** V8 Turbofan can inline a callee into the caller when
the callee is small and its arguments are statically known. A function that accesses
`arguments` is a harder candidate for inlining because the inliner must reconstruct the
`arguments` object in the inlined context. Turbofan does handle some cases via *arguments
adaptation*, but it is an additional pass with its own cost; functions that never
reference `arguments` skip it entirely.

**`arguments` is array-like, not an `Array`.** Methods like `.slice`, `.map`, and `.forEach`
are not available on `arguments` directly — code must use `Array.prototype.slice.call(arguments)`
or spread into `Array.from(arguments)`. Both patterns allocate a new array, and neither
gives V8 enough type information to apply `PACKED_SMI_ELEMENTS` or other element-kind
specialisations. A rest parameter `...args` is a genuine `Array` from the start: its
element kind is inferred at the call site, and array methods on it are directly
optimisable.

**Rest parameters enable constant parameter count.** When the declared parameter list
is `function f(...args)`, V8 knows *at compile time* that `f` accepts a variadic list
via `args`. The function's formal parameter count is `0` (or the count of leading named
parameters), so the arguments adaptor frame — the mechanism V8 uses when the actual
argument count differs from the formal parameter count — is either absent or trivially
handled. `arguments` requires no such declaration but forces runtime overhead each time
the object is accessed.

## When it applies

All of the following must hold for the rewrite to be safe:

- **The function is declared with `function` keyword or is a method** (not an arrow
  function). Arrow functions do not have their own `arguments` binding; any `arguments`
  reference inside an arrow resolves to the enclosing non-arrow function's `arguments`.
  Rewriting the enclosing function's parameter list changes what the arrow's
  `arguments` reference resolves to — the arrow should use the renamed `args` directly
  instead. This is handled per-scope, not globally.
- **The function is in strict mode, or the aliasing behaviour between named parameters
  and `arguments` is not relied upon.** In sloppy mode, `arguments[0]` and the first
  named parameter are live aliases of each other. Code that deliberately exploits this
  (e.g., `function f(x) { arguments[0] = 2; return x; }` — returns `2` in sloppy mode)
  would silently change behaviour after the rewrite.
- **`arguments` is accessed only by index (`arguments[i]`) or `.length`, or is spread
  with `apply`/`Array.from`/`[...arguments]`.** Access via `arguments.callee` (the
  function itself, deprecated and forbidden in strict mode) cannot be replaced by a
  rest parameter.
- **The function does not pass `arguments` to code that inspects `arguments.callee` or
  `arguments.caller`.** Both properties are non-standard and forbidden in strict mode;
  their presence is a signal the rewrite is unsafe.
- **No code assigns to `arguments` itself** (`arguments = something`) or to individual
  indexed slots with the intent of aliasing named parameters in sloppy mode
  (`arguments[0] = newVal`).
- **A rest parameter name does not shadow an existing variable in the function scope.**
  Choose a name (`args`, `rest`, or a semantically meaningful name) that does not
  conflict with any identifier already in scope.
- **The function is not a constructor that relies on `arguments` to forward to `super`
  or to `new.target` logic.** While unusual, if a constructor uses `arguments` to
  inspect its call shape, the semantics must be audited before rewriting.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Arrow function body references `arguments` | `arguments` in an arrow resolves to the enclosing function's binding; rewriting the arrow's parameter list is not possible — it has no `arguments` of its own. The *enclosing* function must be rewritten, and the arrow updated to use the new `args` name |
| Sloppy-mode function exploits parameter–`arguments` aliasing | Assigning `arguments[0] = v` updates the named parameter `x` (and vice versa) in sloppy mode; a rest parameter breaks this alias — the function's return value can silently change |
| Code accesses `arguments.callee` | Returns a reference to the function itself; `arguments.callee` is forbidden in strict mode and has no equivalent on a rest array — there is no safe mechanical replacement |
| Code accesses `arguments.caller` | Non-standard, forbidden in strict mode, no equivalent in the rest parameter model |
| The function is an async generator or its `arguments` object is intentionally passed to `yield*` | Exotic generator resumption scenarios make the aliasing analysis non-trivial; skip unless the full call graph is audited |
| `arguments` is passed by reference to external code that mutates it and expects the mutations to propagate back to named parameters | The aliasing semantics in sloppy mode make this a two-way live binding; a rest `Array` is a value snapshot — mutations to `args[0]` do not affect a named parameter `x` |
| The named parameter list already contains default values or destructuring | In these cases `arguments` and named parameters are already de-aliased even in sloppy mode (spec §10.2.11 step 16) — aliasing is not a concern, but the transform still needs to splice the rest parameter after any existing named parameters without changing their positions |

## Benchmark results

Measured on Node.js current LTS (V8 >= 8.9) using vitest bench with 10 000 calls per iteration.

| Pattern | Original (ops/s) | Optimized (ops/s) | Speedup |
|---|---|---|---|
| Indexed `arguments[i]` loop vs rest `args[i]` loop | 30,628 | 31,638 | 1.03x |
| `fn.apply(ctx, arguments)` vs `fn(...args)` | 80,199 | 80,341 | 1.00x |
| `Array.prototype.slice.call(arguments, 1)` vs `args.slice(1)` | 7,605 | 8,130 | 1.07x |

**None of the three patterns reaches the ≥ 10% speedup threshold.**

### Why the gain is negligible on modern V8

The theoretical overhead described in the "Why it's faster" section was largely addressed in V8 8.9 (shipped with Node.js 16, released March 2021):

- **Arguments adaptor frame removed** — V8 8.9 [retired the arguments adaptor frame](https://v8.dev/blog/v8-release-89#arguments-adaptor-frame-removal). The extra stack frame that was historically inserted when actual and formal argument counts differed no longer exists in Node.js 16+. This eliminates one of the primary runtime costs associated with variadic calls.

- **TurboFan arguments object elision** — Modern TurboFan can eliminate the `arguments` heap allocation entirely in many functions through escape analysis. When V8's optimising compiler determines that `arguments` does not escape the function (the common case for indexed loops), no heap object is allocated; the arguments are kept in the fast frame just like named parameters.

- **`apply` + `arguments` fast path** — `Function.prototype.apply` with an `arguments` object has a dedicated fast path in V8 that avoids materialising a real `Array`. The spread syntax `fn(...restArray)` must iterate a genuine `Array` and does not always benefit from the same shortcut, making the two paths equivalent in throughput on modern V8.

- **Rest parameters allocate a real Array** — A rest parameter `...args` creates a new `Array` on every call, even when the array is not needed. For the indexed-loop pattern, V8's arguments elision can avoid the allocation entirely on the `arguments` side; the rest side must always allocate. This partially offsets the theoretical rest-parameter advantage.

### Conclusion

This rule is a **style/readability improvement**, not a measurable performance optimization on any Node.js version >= 16. The `arguments` object is a well-known anti-pattern and should still be avoided in new code for clarity, strict-mode safety, and tooling reasons — but the transform cannot be justified by benchmark evidence alone under the project's ≥ 10% gate.

The rule is **dropped from the implementation backlog**. The README and benchmark are retained as documentation of the investigation.

## Sources

- [V8 blog: Optimizing V8 Arguments](https://v8.dev/blog/optimizing-v8-memory) — V8
  engineering coverage of `arguments` object costs, arguments adaptor frames, and the
  memory optimisations introduced as `arguments` usage was reduced across the V8 codebase.
- [V8 blog: Retiring the arguments adaptor frame](https://v8.dev/blog/v8-release-89#arguments-adaptor-frame-removal) —
  V8 8.9 (Node.js 16+) removed the arguments adaptor frame for the common case; explains
  why formal-parameter-count mismatches historically required an extra frame and why rest
  parameters avoid that frame entirely.
- [ECMAScript spec: `arguments` Exotic Objects (§10.4.4)](https://tc39.es/ecma262/#sec-arguments-exotic-objects) —
  defines the two-way aliasing between `arguments` indexed slots and named parameters in
  non-strict, non-arrow functions; the authoritative source for the aliasing precondition.
- [ECMAScript spec: Rest parameter semantics (§14.1)](https://tc39.es/ecma262/#sec-function-definitions) —
  defines how `...args` collects remaining arguments into a new dense `Array`; no aliasing
  with named parameters.
- [MDN: The `arguments` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments) —
  covers `arguments.callee`, `arguments.length`, sloppy-mode aliasing, and the
  non-Array nature of the object; useful survey of all the surface area this rule must
  handle.
- [MDN: Rest parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/rest_parameters) —
  spec behaviour of `...args`, including the rule that rest parameters cannot have
  default values and must be the last parameter.
- [Node.js performance best practices](https://nodejs.org/en/docs/guides/dont-block-the-event-loop) —
  general guidance on V8 optimisation; `arguments` object avoidance is a recurring theme
  in V8-targeted performance guides.
- [Google V8 issue tracker: Arguments object materialisation](https://bugs.chromium.org/p/v8/issues/detail?id=4745) —
  historical V8 issue tracking arguments object elision; illustrates the engineering
  complexity that `arguments` adds to the optimising compiler.
