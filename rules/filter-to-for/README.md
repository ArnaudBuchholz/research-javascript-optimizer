# `filter-to-for` — Replace `.filter()` with a `for` loop + conditional push

## Pattern

```js
// Before
const result = array.filter((item) => item.active);

// After
const result = [];
for (let i = 0; i < array.length; i++) {
  if (array[i].active) {
    result.push(array[i]);
  }
}
```

Multi-statement callback body:

```js
// Before
const result = array.filter((item) => {
  const value = normalize(item);
  return value > threshold;
});

// After
const result = [];
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  const value = normalize(item);
  if (value > threshold) {
    result.push(item);
  }
}
```

With index parameter:

```js
// Before
const result = array.filter((item, index) => index % 2 === 0);

// After
const result = [];
for (let i = 0; i < array.length; i++) {
  if (i % 2 === 0) {
    result.push(array[i]);
  }
}
```

## Why it's faster

`Array.prototype.filter` has three distinct sources of overhead relative to a plain
`for` loop.

**Per-element function call overhead.** Like `forEach` and `map`, `filter` invokes a
callback for every element. Each invocation allocates a new stack frame, performs
argument binding (item, index, array), and emits a type-feedback entry that V8's
Turbofan JIT must track. Inlining the body into a `for` loop eliminates this overhead
entirely, allowing Turbofan to compile the predicate and the conditional push as a
single unit and apply bounds-check elimination and range inference across the whole
loop.

**Dynamic result-array growth.** `filter` cannot know the output size ahead of time, so
it builds the result array by appending elements one at a time internally. This is
functionally identical to what the manual rewrite does with `push`, but the `filter`
implementation performs this through the same C++ path that also handles
`ArraySpeciesCreate` (see below) and the associated bookkeeping. A manually constructed
`[]` with `push` calls stays inside optimised JIT code from the start.

**`Symbol.species` and subclass dispatch.** The spec requires `filter` to call
`ArraySpeciesCreate` to determine the constructor for the output array (same as `map`).
For a plain `Array` this resolves to `Array`, but the resolution involves a property
lookup on the constructor and a potential user-defined `Symbol.species` getter. A manual
loop using `[]` bypasses this dispatch entirely.

Unlike `map`, there is no pre-allocation win here — because the output size is unknown,
`filter` and the manual rewrite both start with an empty array and grow it. The gains
therefore come almost entirely from eliminating the per-element call overhead and the
`ArraySpeciesCreate` dispatch.

## When it applies

All of the following must hold for the rewrite to be safe:

- **The array is a plain `Array` instance** (not a subclass, `TypedArray`, or custom
  iterable). Subclasses may override `Symbol.species` to produce a different result
  type, which `filter` honours but a manual `[]` does not.
- **No `Symbol.species` override** on the array's constructor. If a codebase defines
  `Array[Symbol.species]`, the rewrite silently changes the result type.
- **The array is dense (no holes).** `filter` skips holes and does not include the
  corresponding index in the result; a `for` loop processes every index, yielding
  `undefined` values for holes that may or may not pass the predicate.
- **The callback is an arrow function** with no `this` dependency. A regular `function`
  expression may receive a `this` bound via `filter`'s optional second argument
  (`array.filter(fn, thisArg)`); that binding is lost in a bare loop body.
- **The `thisArg` argument is absent** (i.e. `array.filter(fn)` — not
  `array.filter(fn, ctx)`).
- **The callback returns a value on all code paths** — the predicate must be a
  well-formed boolean expression or block that always produces a truthy/falsy value.
  Callbacks with early-exit `return` statements are still rewritable, but the transform
  must convert each `return expr` into `if (expr) result.push(item);` before the closing
  brace — this is structurally safe but increases transform complexity.
- **The array expression is side-effect-free and stable across iterations**: a bare
  `Identifier` (`arr`) or a non-computed `MemberExpression` chain of identifiers
  (`this.items`, `obj.data`). Function calls or computed members are excluded because
  `array.length` and `array[i]` would re-evaluate them on each access.
- **The `filter` return value is consumed** (assigned, passed, or returned). If the
  return value is discarded, the rule `foreach-to-for` applies instead — filtering into
  an array that is never read wastes the allocation and the `push` calls.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Array is a subclass with a custom `Symbol.species` | `filter` returns an instance of the subclass; the rewrite always produces a plain `Array` — different type |
| `thisArg` is passed: `arr.filter(fn, ctx)` | `this` inside `fn` would be `ctx` with `filter` but `undefined` (or global) in a `for` loop |
| Callback is a non-arrow `function` that uses `this` | `this` binding differs between `filter` and a bare loop body |
| Array is sparse (contains holes) | `filter` skips holes entirely; a `for` loop reads every index, yielding `undefined` for holes — the predicate may match `undefined` when it should not |
| The `filter` result is not used (return value discarded) | Building and pushing into a result array that is never read wastes allocations; use `foreach-to-for` instead |
| Callback mutates the source array's length during iteration | `filter` captures `length` at call entry; a `for` loop re-reads `array.length` each iteration — if the array is shortened mid-loop the loop terminates earlier than `filter` would |
| Array expression has side effects: `getItems().filter(fn)` | The rewrite accesses `array.length` once and `array[i]` per iteration — `getItems()` would be called on each access, multiplying side effects |
| The callback uses the third `array` argument | `filter` passes the original array as the third callback argument; a `for` loop does not rebind it, but code that mutates or inspects the third argument may behave differently if the outer reference is not identical |

## Sources

- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains how V8
  represents arrays internally, and why dense (`PACKED_*`) element kinds are more
  optimisable than holey (`HOLEY_*`) kinds; relevant to hole-skipping behaviour.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  background on how Turbofan inlines plain loop bodies versus calls across a
  function-call boundary.
- [ECMAScript spec: `Array.prototype.filter` (step 7 — `ArraySpeciesCreate`)](https://tc39.es/ecma262/#sec-array.prototype.filter) —
  documents the `Symbol.species` lookup and hole-skipping semantics (`HasProperty` check
  on each index) that `filter` performs and that a manual loop does not.
- [MDN: `Array.prototype.filter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter) —
  spec behaviour: hole-skipping, `thisArg`, `Symbol.species`, snapshot of `length` at
  call entry.
- [MDN: `Array.prototype.push`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/push) —
  documents that `push` appends elements and updates `length`; the V8 fast-path for
  `push` on a packed array is a single bounds check + store.

## Benchmark results

Measured on Node.js (current LTS) with a dense array of 100 000 integers (half pass the even-number predicate):

| Variant | ops/s |
|---|---|
| `filter` (original) | 1 571.98 |
| `for` loop with `push` (optimized) | 5 567.55 |

**Speedup: 3.54× faster** (≈ 254% gain). The result comfortably exceeds the ≥ 10% threshold required to justify the rule.

Run `npx vitest bench rules/filter-to-for/benchmark/bench.js` to reproduce.
