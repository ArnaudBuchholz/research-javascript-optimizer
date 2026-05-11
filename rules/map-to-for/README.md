# `map-to-for` — Replace `.map()` with a pre-allocated array + `for` loop

## Pattern

```js
// Before
const result = array.map((item, index) => transform(item, index));

// After
const result = new Array(array.length);
for (let i = 0; i < array.length; i++) {
  result[i] = transform(array[i], i);
}
```

Multi-statement callback body:

```js
// Before
const result = array.map((item) => {
  const normalized = item.trim().toLowerCase();
  return normalized + '_suffix';
});

// After
const result = new Array(array.length);
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  const normalized = item.trim().toLowerCase();
  result[i] = normalized + '_suffix';
}
```

## Why it's faster

`Array.prototype.map` has three independent sources of overhead compared to a plain
`for` loop with a pre-allocated result array.

**Per-element function call overhead.** Like `forEach`, `map` invokes a callback for
every element. Each call allocates a new stack frame, performs argument binding, and
generates a type-feedback slot that V8's Turbofan JIT must track. A `for` loop body
executes inline; Turbofan can treat it as a single compilation unit and apply
bounds-check elimination, range inference, and loop-invariant code motion across the
whole loop.

**Result array growth vs. pre-allocation.** `map`'s spec-compliant implementation
creates the result array with `new Array(len)` internally, but V8 must still validate
and populate it through the same C++ path that handles arbitrary `ArraySpeciesCreate`
results (to support subclasses and `Symbol.species`). Writing into a pre-allocated
plain `Array` created in user code bypasses that machinery and stays entirely within
optimised JIT code. Crucially, pre-allocating with `new Array(n)` gives V8 the exact
final length upfront, so no backing-store reallocation or hidden-class transitions
occur during writes.

**`Symbol.species` and subclass dispatch.** The spec requires `map` to call
`ArraySpeciesCreate` to determine the constructor for the output array. For a plain
`Array` this resolves to `Array`, but the resolution itself involves a property lookup
on the constructor and a potential user-defined `Symbol.species` getter — overhead that
a manual loop completely avoids.

Together these factors mean the `for`-loop variant can be several times faster on dense
integer or object arrays in a tight benchmark.

## When it applies

All of the following must hold for the rewrite to be safe:

- **The array is a plain `Array` instance** (not a subclass, `TypedArray`, or
  custom iterable). Subclasses may override `Symbol.species` to produce a different
  result type, which `map` honours but a manual loop does not.
- **No `Symbol.species` override** on the array's constructor. If a codebase defines
  `Array[Symbol.species]`, the rewrite silently changes the result type.
- **The array is dense (no holes).** `map` skips holes and does not write the
  corresponding index in the result; a `for` loop always writes, producing `undefined`
  where a hole was expected.
- **The callback is an arrow function** with no `this` dependency. A regular `function`
  expression receives a `this` bound by `map`'s optional second argument
  (`array.map(fn, thisArg)`); that binding is lost in a bare `for` loop.
- **The `thisArg` argument is absent** (i.e. `array.map(fn)` — not
  `array.map(fn, ctx)`). Passing `thisArg` changes `this` inside the callback; a `for`
  loop cannot replicate this without wrapping.
- **The callback contains no top-level `return` inside a nested function or loop** —
  this is a non-issue for the rewrite itself, but the callback must not rely on
  `map`'s iteration protocol (e.g. mutating the source array mid-iteration in a way
  that depends on `map` taking a snapshot of `length` at call time).
- **The array expression is side-effect-free and stable across iterations**: a bare
  `Identifier` (`arr`) or a non-computed `MemberExpression` chain of identifiers
  (`this.items`, `obj.data`). Function calls or computed members are excluded because
  `array.length` and `array[i]` would re-evaluate them on each access.
- **The call is used as an expression whose value is consumed** (assigned, passed, or
  returned). If the return value of `map` is discarded, the rule `foreach-to-for`
  applies instead; rewriting a discarded `map` to a pre-allocating `for` loop
  wastes the allocation.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Array is a subclass with a custom `Symbol.species` | `map` returns an instance of the subclass; the rewrite always produces a plain `Array` — different type |
| `thisArg` is passed: `arr.map(fn, ctx)` | `this` inside `fn` would be `ctx` with `map` but `undefined` (or global) in a `for` loop |
| Callback is a non-arrow `function` that uses `this` | `this` binding differs between `map` and a bare loop body |
| Array is sparse (contains holes) | `map` preserves holes as holes; a `for` loop writes `undefined` into every slot, changing the shape |
| The `map` result is **not used** (return value discarded) | Pre-allocating an array that is never read wastes memory; use `foreach-to-for` instead |
| Callback mutates the source array's length | `map` captures `length` at call entry; a `for` loop re-reads `array.length` each iteration unless the condition is hoisted — behaviour diverges if the array is shortened mid-loop |
| Array expression has side effects: `getItems().map(fn)` | The rewrite accesses `array.length` once and `array[i]` per iteration — `getItems()` would be called on each access, changing side-effect count |
| Callback body contains a `return` that exits via `map`'s iteration control | A `return` in a `map` callback produces the mapped value for that element; there is no structural difference when rewriting to `result[i] = expr`, but the callback body must be normalised so that all code paths reach a `return` (or the callback is a concise-body arrow function) before the transform can inline it |

## Sources

- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains dense
  vs. holey array shapes and why `HOLEY_*` elements kinds are slower than `PACKED_*`
  kinds; relevant to why pre-allocating with `new Array(n)` and filling sequentially
  keeps the array in a `PACKED` kind.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  background on how Turbofan inlines and optimises plain loop bodies versus calls
  through a function-call boundary.
- [ECMAScript spec: `Array.prototype.map` (step 3 — `ArraySpeciesCreate`)](https://tc39.es/ecma262/#sec-array.prototype.map) —
  documents the `Symbol.species` lookup that `map` performs and that a manual loop
  skips entirely.
- [MDN: `Array.prototype.map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map) —
  spec behaviour: hole-skipping, `thisArg`, `Symbol.species`, snapshot of `length`.
- [MDN: `Array` constructor — `new Array(n)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/Array) —
  documents that passing a single numeric argument pre-sets `length` without creating
  slots, yielding a holey array that becomes packed as slots are filled sequentially.

## Measured speedup

Benchmark run on Node.js LTS (macOS, Apple Silicon), array of 100 000 integers:

| Variant | ops/s | mean (ms) |
|---|---|---|
| `map` (original) | 1 819.67 | 0.5496 |
| `for` + pre-allocated array (optimized) | 9 757.25 | 0.1025 |

**Speedup: 5.36× faster** (~436% gain, well above the 10% threshold).

The large margin is consistent with the three overhead sources described above
(per-element callback, `ArraySpeciesCreate` dispatch, and V8's C++ `map` path)
all being eliminated at once in the tight benchmark case.

Run `npx vitest bench rules/map-to-for/benchmark/bench.js` to reproduce.
