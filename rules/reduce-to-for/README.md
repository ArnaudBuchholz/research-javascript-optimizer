# `reduce-to-for` — Replace `.reduce()` with a `for` loop and an explicit accumulator

## Pattern

Simple sum (concise-body arrow callback):

```js
// Before
const sum = array.reduce((acc, item) => acc + item, 0);

// After
let sum = 0;
for (let i = 0; i < array.length; i++) {
  sum = sum + array[i];
}
```

Block-body arrow callback:

```js
// Before
const total = array.reduce((acc, item) => {
  const value = item.price * item.qty;
  return acc + value;
}, 0);

// After
let total = 0;
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  const value = item.price * item.qty;
  total = total + value;
}
```

With index parameter:

```js
// Before
const indexedSum = array.reduce((acc, item, index) => acc + item * index, 0);

// After
let indexedSum = 0;
for (let i = 0; i < array.length; i++) {
  indexedSum = indexedSum + array[i] * i;
}
```

Object accumulator:

```js
// Before
const grouped = array.reduce((acc, item) => {
  acc[item.key] = item.value;
  return acc;
}, {});

// After
const grouped = {};
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  grouped[item.key] = item.value;
}
```

## Why it's faster

`Array.prototype.reduce` calls a callback function once per element. Each call carries
the same per-element function-call overhead as `forEach` and `map`:

**Stack frame allocation.** Every callback invocation allocates a new activation record,
sets up argument bindings (`accumulator`, `currentValue`, `currentIndex`, `array`), and
tears it down on return. A `for` loop body executes inline — no frame boundary, no
argument binding, no teardown.

**Type-feedback pollution.** V8's Turbofan JIT builds a type profile for each call site.
Invoking the same callback through `reduce` constitutes a polymorphic call site if the
accumulator's type changes between iterations (e.g. starts as `0`, becomes a `number`,
then becomes an `object`). A local variable that the JIT sees mutated in a simple
arithmetic loop is far easier to type-narrow and optimise.

**Cross-boundary inlining limit.** Turbofan can inline short callbacks called from
`reduce`, but only up to its inlining depth budget. Once the budget is exhausted (e.g.
`reduce` is itself inside another inlined call), the callback is called as a full
function. A `for` loop body is always in the same compilation unit as the surrounding
code and is never subject to this limit.

**The accumulator variable stays in a register.** With an explicit `let acc = init;`
the JIT can keep the accumulator in a CPU register across the entire loop. Inside
`reduce`, the accumulator is passed as an argument on each call and returned as a value,
requiring at minimum a store + load across the call boundary — even when inlined, this
adds unnecessary liveness constraints that can spill the variable to the stack.

**`Symbol.species` / subclass dispatch does not apply here.** Unlike `map` and `filter`,
`reduce` does not call `ArraySpeciesCreate`, so that overhead is absent; the primary
gains for `reduce-to-for` come from eliminating per-element call overhead and improving
accumulator type stability.

## When it applies

All of the following must hold for the rewrite to be safe:

- **The call uses the two-argument form** (`array.reduce(fn, initialValue)`). The
  no-`initialValue` form (`array.reduce(fn)`) uses `array[0]` as the implicit
  accumulator and starts iteration at index `1`; the rewrite must emit different
  initialisation code and is substantially more complex to handle safely.
- **The array is a plain `Array` instance** (not a `TypedArray`, `Arguments` object, or
  custom array-like). `reduce` on a `TypedArray` (e.g. `Float64Array`) has different
  element-kind semantics; a `for` loop over a `TypedArray` is already near-optimal.
- **The array is dense (no holes).** `reduce` skips holes (it checks `HasProperty` on
  each index); a `for` loop always reads every index, yielding `undefined` for holes.
  Processing an extra `undefined` may cause a type error or silently produce a wrong
  result depending on what the callback does.
- **The callback is an arrow function** with no `this` dependency. A regular `function`
  expression passed to `reduce` can reference `this` (bound by `reduce` to `undefined`
  in strict mode or the global object in sloppy mode); a `for` loop body inherits the
  outer `this`, which is a different binding.
- **The `thisArg` argument is absent.** `reduce` does not take a `thisArg` parameter
  (unlike `forEach`/`map`/`filter`), so this condition is automatically satisfied — it
  is listed here only for completeness.
- **The accumulator is not used or modified by code outside the callback during the
  loop.** If the callback closes over a variable that is also mutated by an outer scope
  concurrently (e.g. in an async or generator context), extracting the accumulator as a
  local `let` may change the timing of mutations. In synchronous, single-threaded code
  this is never a concern.
- **The array expression is side-effect-free and stable across iterations**: a bare
  `Identifier` (`arr`) or a non-computed `MemberExpression` chain of plain identifiers
  (`this.items`, `obj.data`). Function calls or computed members are excluded because
  the generated loop accesses `array.length` once and `array[i]` per iteration — a
  function call would be invoked on each access, changing side-effect count and
  potentially returning a different array each time.
- **The `reduce` call's return value is consumed** (assigned to a variable, passed as an
  argument, or returned). If the value is discarded the rewrite is still valid, but the
  only benefit is eliminating call overhead — the rule is most impactful when the
  accumulator result is actually used.
- **The callback does not use the fourth `array` argument.** `reduce` passes the
  original array as the fourth callback argument. Code that reads or mutates this
  parameter must be checked to confirm it refers to the same object as the outer
  array variable before the transform is applied.

## When it does NOT apply

| Condition | Risk |
|---|---|
| No `initialValue` supplied: `arr.reduce(fn)` | `array[0]` becomes the implicit initial accumulator and iteration starts at index 1; a `for` loop always starts at index 0 — iteration count and initial value both differ |
| Array is sparse (contains holes) | `reduce` skips holes; a `for` loop reads every index, introducing `undefined` values that may fail the callback's type assumptions |
| Callback is a non-arrow `function` that uses `this` | `this` inside `fn` is `undefined` (strict) or `globalThis` (sloppy) when called by `reduce`; a `for` loop body inherits the lexical `this` — different binding |
| Callback closes over a variable that is itself the accumulator with external mutation | Extracting the accumulator as `let acc` in the loop makes it a new binding; any code that previously referenced the same closure variable now sees a different variable |
| Callback uses the fourth `array` argument and the outer array reference differs | If the callback is defined in a scope where `array` is not in scope, the fourth argument was the only way to access it; after rewriting, that argument is gone |
| The callback has early-exit `return` semantics that differ from normal accumulation | A `return` in a `reduce` callback returns the next accumulator value and continues iteration — this maps cleanly to `acc = expr;` only when there is a single `return` on all paths; multiple `return`s with branching still rewrite correctly but require careful normalisation by the transform |
| Array is a `TypedArray` | `TypedArray.prototype.reduce` has its own spec steps and element-kind semantics; the manual loop may behave identically but the transform should not target `TypedArray` instances without separate analysis |
| The `reduce` call is chained: `array.reduce(fn, []).map(g)` | The rewrite hoists the accumulator before the loop; if the original expression appeared inside a larger expression, the hoisted variable must be placed at the correct scope level — the transform must check it does not escape its intended scope |

## Sources

- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains dense
  vs. holey array shapes (`PACKED_*` vs. `HOLEY_*`) and why `HasProperty` checks on
  holes add per-element overhead to builtins like `reduce`.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  background on how Turbofan inlines loop bodies and how the inlining budget limits
  cross-call-boundary optimisations.
- [ECMAScript spec: `Array.prototype.reduce`](https://tc39.es/ecma262/#sec-array.prototype.reduce) —
  documents the exact iteration semantics: `HasProperty` hole check, `initialValue`
  handling (steps 8–9 that change start index and initial accumulator), and the absence
  of `ArraySpeciesCreate` (unlike `map`/`filter`).
- [MDN: `Array.prototype.reduce`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce) —
  spec behaviour: no-`initialValue` edge cases, hole-skipping, callback signature
  (`accumulator`, `currentValue`, `currentIndex`, `array`).
- [V8 blog: Optimizing V8 — understanding hidden classes](https://v8.dev/blog/fast-properties) —
  explains how V8 tracks object shapes (hidden classes) and why type-stable accumulator
  variables in a loop are easier for the JIT to narrow than values passed across
  function-call boundaries.

## Measured speedup

Benchmarked on Node.js LTS with `npx vitest bench rules/reduce-to-for/benchmark/bench.js`
using a 100 000-element dense array:

| Scenario | `reduce` (ops/s) | `for` loop (ops/s) | Speedup |
|---|---|---|---|
| Numeric sum (concise arrow) | 1 554 | 15 489 | **9.96×** |
| Object accumulation (block arrow) | 1 365 | 11 696 | **8.57×** |

Both variants are well above the ≥ 10% threshold. The large gains (8–10×) are consistent
with the `foreach-to-for` result (8.56×) and confirm that the dominant cost is
per-element callback overhead, not the accumulator passing itself.
