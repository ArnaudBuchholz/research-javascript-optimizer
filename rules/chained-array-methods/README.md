# `chained-array-methods` — Replace `.filter(...).map(...)` chains with a single `for` loop

## Pattern

Simple filter-then-map chain (arrow callbacks):

```js
// Before
const result = array.filter((item) => item.active).map((item) => item.value);

// After
const result = [];
for (let i = 0; i < array.length; i++) {
  if (array[i].active) {
    result.push(array[i].value);
  }
}
```

Multi-statement callbacks:

```js
// Before
const result = array
  .filter((item) => {
    const score = compute(item);
    return score > threshold;
  })
  .map((item) => {
    return { id: item.id, label: item.name.trim() };
  });

// After
const result = [];
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  const score = compute(item);
  if (score > threshold) {
    result.push({ id: item.id, label: item.name.trim() });
  }
}
```

Chain with index usage in the map callback:

```js
// Before
const result = array.filter((item) => item.enabled).map((item, index) => `${index}: ${item.name}`);

// After
const result = [];
let mappedIndex = 0;
for (let i = 0; i < array.length; i++) {
  if (array[i].enabled) {
    result.push(`${mappedIndex}: ${array[i].name}`);
    mappedIndex++;
  }
}
```

## Why it's faster

A `.filter().map()` chain has three layers of overhead that a single `for` loop eliminates.

**Intermediate array allocation.** `filter` always materialises a full intermediate array
before `map` sees a single element. For an array of N elements where K pass the predicate,
this means allocating an array of K elements, writing K references into it, and then
discarding it once `map` finishes. A single loop never materialises this intermediate
array — each element that passes the predicate is transformed and pushed directly into the
result, reducing peak memory allocation and GC pressure.

**Two passes over the data.** `filter` iterates all N elements once; `map` then iterates
the K survivors a second time. A fused loop touches each element exactly once. For large
arrays this halves the number of memory reads and substantially reduces L1/L2 cache
thrashing: modern CPUs prefetch sequential reads well, but two separate passes double the
working-set traversal.

**Double per-element function-call overhead.** Each element that passes the predicate
incurs two callback invocations: one for `filter` and one for `map`. Elements that are
filtered out still incur one callback invocation (for `filter`). A single `for` loop body
executes inline for all N elements; there is zero per-element call overhead regardless of
the filtering ratio.

Combined with the `ArraySpeciesCreate` dispatch that both `filter` and `map` independently
perform (each resolves `Symbol.species` to decide the result array constructor), the total
overhead is substantially higher than either individual method alone — and the fused loop
eliminates all of it in one transformation.

V8's Turbofan JIT can apply bounds-check elimination, range inference, and loop-invariant
code motion to a plain `for` loop as a single compilation unit. Neither `filter` nor `map`
crosses into the loop body for JIT purposes; the callback boundary prevents Turbofan from
seeing that the two passes share the same source array with the same element kinds.

**Note on index semantics.** The `index` parameter in the `map` callback of a
`.filter().map()` chain refers to the element's position within the *filtered* intermediate
array, not its position in the original array. A fused loop must replicate this by
maintaining a separate counter that increments only when the predicate is satisfied (see
pattern example above). This is a correctness-critical difference: code that uses the map
`index` to build keys, labels, or offsets would produce different results if the rewrite
used the source array index `i` instead.

## When it applies

All of the following must hold for the rewrite to be safe:

- **The chain is exactly `.filter(fn1).map(fn2)`** with no other method calls in between
  or after (e.g. no additional `.filter()`, `.reduce()`, `.forEach()`, `.find()`, etc.).
  Longer chains can be fused but require separate analysis and are outside the scope of
  this rule.
- **The array is a plain `Array` instance** (not a subclass, `TypedArray`, or custom
  iterable). Both `filter` and `map` honour `Symbol.species` to determine the result type;
  a manual loop always produces a plain `Array`, changing the type for subclasses.
- **No `Symbol.species` override** on the array's constructor. If a codebase defines
  `Array[Symbol.species]`, both `filter` and `map` would use it to pick the result
  constructor; the rewrite produces a plain `[]`, silently changing the result type.
- **The array is dense (no holes).** `filter` skips holes; a fused `for` loop reads every
  index and processes `undefined` for holes, which may pass the predicate when it should
  not.
- **Both callbacks are arrow functions** with no `this` dependency. Regular `function`
  expressions receive a `this` bound by the optional `thisArg` parameter of each method;
  that binding is lost in a bare loop body.
- **Neither `thisArg` argument is passed** (i.e. `array.filter(fn1)` and `.map(fn2)`,
  not `.filter(fn1, ctx1)` or `.map(fn2, ctx2)`).
- **If `map`'s callback uses its `index` parameter**, the rewrite must introduce a
  separate `mappedIndex` counter (as shown above). The transform must detect this usage
  and emit the counter; if it cannot reliably detect it, it must conservatively decline
  the rewrite.
- **Neither callback uses its third `array` argument.** `filter` passes the original array
  as the third argument; `map` passes the intermediate *filtered* array as its third
  argument. These are different objects, and code that reads or mutates the third argument
  of either callback has semantics that cannot be trivially replicated in a fused loop.
- **The array expression is side-effect-free and stable across iterations**: a bare
  `Identifier` (`arr`) or a non-computed `MemberExpression` chain of plain identifiers
  (`this.items`, `obj.data`). Function calls or computed members are excluded because the
  generated loop accesses `array.length` once and `array[i]` per iteration — a function
  call would be re-evaluated on each access.
- **The final result is consumed** (assigned, passed, or returned). If neither the
  intermediate nor the final result is used, the chain has no observable output and a
  single `forEach`-style loop (without result collection) is the correct rewrite.
- **Neither callback mutates the source array's length during iteration.** `filter`
  captures `length` at call entry and iterates up to that value; a `for` loop re-reads
  `array.length` each iteration unless the condition is hoisted — behaviour diverges if
  the array is shortened mid-loop.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Array is a subclass with a custom `Symbol.species` | Both `filter` and `map` return instances of the subclass; the rewrite always produces a plain `Array` — different type |
| `thisArg` is passed to `filter` or `map` | `this` inside the callback is `ctx` with the method but `undefined` (or global) in a `for` loop |
| Callback is a non-arrow `function` that uses `this` | `this` binding differs between the built-in methods and a bare loop body |
| Array is sparse (contains holes) | `filter` skips holes entirely; a `for` loop processes every index, introducing `undefined` values that may pass the predicate unintentionally |
| `map` callback uses its `index` parameter and the transform cannot safely emit a `mappedIndex` counter | The `map` index is over filtered elements, not source elements; using `i` produces wrong index values |
| Either callback uses its third `array` argument | `filter`'s third argument is the original array; `map`'s third argument is the *intermediate filtered array* — these are different objects that a fused loop cannot replicate without materialising the intermediate array |
| The chain is longer than two steps: `.filter().map().filter()` | Additional chained calls require separate fusion analysis; this rule only handles exactly one `.filter()` followed by one `.map()` |
| The intermediate array (result of `filter`) is captured in another variable before `.map()` is called | The pattern `const filtered = arr.filter(fn); const result = filtered.map(g);` is structurally two separate statements, not a single chain expression; the rewrite scope changes and `filtered` would no longer exist |
| Either callback mutates the source array's length | `filter` snapshots `length` at entry; a `for` loop re-reads it each iteration — premature truncation causes the loop to terminate earlier than the method chain would |
| Array expression has side effects: `getItems().filter(fn).map(g)` | Both `array.length` and `array[i]` in the fused loop would call `getItems()` repeatedly, multiplying side effects |
| The chain produces no output (result is discarded) | No intermediate array is ever consumed; using a plain `for` loop body without result collection (like `foreach-to-for`) is the correct target, not a fused filter+map |

## Benchmark results

Measured with `npx vitest bench` on Node.js (current LTS), array of 100 000 plain-object
elements (`{ id, value, active }`).

| Scenario | Variant | ops/s | Speedup |
|---|---|---|---|
| 50% pass (alternating active flag) | `filter().map()` original | 1 120 | — |
| 50% pass (alternating active flag) | fused `for` loop | 4 703 | **4.20×** |
| 100% pass (all elements pass predicate) | `filter().map()` original | 709 | — |
| 100% pass (all elements pass predicate) | fused `for` loop | 2 536 | **3.58×** |

The 50%-pass scenario benefits most: the intermediate array from `filter` is half the
source size, but the overhead of allocating it, filling it, and then iterating it again in
`map` still accounts for most of the total cost. When all elements pass the predicate the
intermediate array is the same size as the source, and the overhead is even greater — yet
the fused loop is still 3.58× faster because it eliminates both the allocation and the
second full-size traversal.

Both scenarios exceed the ≥ 10% threshold by a wide margin. The rule is justified.

## Sources

- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains dense
  vs. holey array shapes (`PACKED_*` vs. `HOLEY_*`) and how built-in array methods handle
  holes; directly relevant to why `.filter()` skips holes while a `for` loop does not.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  background on how Turbofan compiles loop bodies as single units and how the inlining
  budget constrains cross-call-boundary optimisations.
- [ECMAScript spec: `Array.prototype.filter` — `ArraySpeciesCreate`](https://tc39.es/ecma262/#sec-array.prototype.filter) —
  documents the `Symbol.species` lookup, hole-skipping (`HasProperty` per index), and that
  `length` is captured at call entry.
- [ECMAScript spec: `Array.prototype.map` — `ArraySpeciesCreate`](https://tc39.es/ecma262/#sec-array.prototype.map) —
  documents the same `Symbol.species` dispatch and that the `index` parameter passed to
  the map callback is the index within the array on which `map` was called (i.e., the
  filtered intermediate, not the original).
- [MDN: `Array.prototype.filter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter) —
  spec behaviour: hole-skipping, `thisArg`, callback signature (`element`, `index`,
  `array`), `Symbol.species`.
- [MDN: `Array.prototype.map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map) —
  spec behaviour: callback `index` is relative to the array `map` is called on, `thisArg`,
  `Symbol.species`, snapshot of `length`.
- [V8 blog: Fast properties in V8](https://v8.dev/blog/fast-properties) — explains how V8
  tracks object shapes (hidden classes) and how allocating and immediately discarding the
  intermediate array from `filter` creates GC pressure that a fused loop eliminates.
