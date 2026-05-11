# `for-of-to-for` — Replace `for...of` with an indexed `for` loop

## Pattern

Simple value iteration:

```js
// Before
for (const item of array) {
  process(item);
}

// After
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  process(item);
}
```

With index needed (using `entries()`):

```js
// Before
for (const [index, item] of array.entries()) {
  process(item, index);
}

// After
for (let i = 0; i < array.length; i++) {
  process(array[i], i);
}
```

Array of objects:

```js
// Before
for (const user of users) {
  if (user.active) sendNotification(user);
}

// After
for (let i = 0; i < users.length; i++) {
  const user = users[i];
  if (user.active) sendNotification(user);
}
```

## Why it's faster

`for...of` is defined by the ECMAScript iteration protocol. For every iterable — including
plain `Array` — the engine must invoke that protocol on each iteration step. This adds
several layers of overhead that a plain `for` loop avoids entirely.

**Iterator object allocation.** Before the first iteration, the runtime calls
`array[Symbol.iterator]()` to obtain an iterator object. This allocates a new heap object
(the iterator state machine), even for the simplest one-element loop. A `for` loop
allocates nothing beyond its counter variable, which the JIT keeps in a CPU register.

**Per-iteration `next()` call.** On each step the engine calls `iterator.next()`, which
returns a `{ value, done }` result object. That is one function call plus one fresh object
allocation per element — exactly the same class of per-element function-call overhead
described in `foreach-to-for`. V8's Turbofan JIT can eliminate these allocations via
escape analysis when the pattern is simple, but the optimisation is not guaranteed: it
depends on inlining depth, the shape of surrounding code, and whether the array's
element kind is statically known.

**`done` sentinel check.** Each call to `next()` must set and the loop must read the
`done` property of the result object to determine when to stop. A `for` loop's termination
condition (`i < array.length`) is a single integer comparison against a cached or
re-read length — a cheaper operation with no property lookup.

**Deoptimisation risk from iterator protocol polymorphism.** `for...of` goes through
`Symbol.iterator`, which is a generic dispatch point. If the same loop is JIT-compiled
while iterating arrays of different element kinds (`PACKED_SMI_ELEMENTS`,
`PACKED_DOUBLE_ELEMENTS`, `PACKED_ELEMENTS`) across separate call sites, Turbofan may
see a polymorphic call site and fall back to a slower compiled form. The indexed `for`
loop accesses elements directly via `array[i]`, which the JIT type-narrows per element
kind with no polymorphism at the iterator dispatch level.

**Loop optimisations that cross the call boundary.** Even when V8 successfully inlines
the `next()` call, the inlining boundary still constrains certain loop-level
optimisations. Bounds-check elimination (removing the `i < array.length` guard inside the
loop body when V8 can prove `i` stays in range), loop unrolling, and SIMD vectorisation
all apply more readily to a plain indexed loop whose induction variable is visible at
the top level of the compilation unit.

**`array.entries()` adds a second iterator.** When an index is needed via
`array.entries()`, a second iterator wrapping the first is created, doubling the
allocation and `next()` call overhead — two objects allocated per iteration step instead
of one. The `for` loop replaces both with the single counter variable `i`.

## When it applies

All of the following must hold for the rewrite to be safe:

- **The iterable is a plain `Array` instance** (not a `Set`, `Map`, `String`, generator,
  `arguments` object, `TypedArray`, or any user-defined iterable). The iteration
  protocol for non-arrays is not equivalent to sequential index access; the rewrite is
  only valid for objects whose `Symbol.iterator` is the default array iterator (i.e.
  `Array.prototype[Symbol.iterator]`).
- **The array is dense (no holes).** The default array iterator skips holes using the
  same `HasProperty` check that `forEach` uses; an indexed `for` loop does not — it reads
  every index and yields `undefined` for holes. The rewrite is safe only for arrays
  known to be packed (`PACKED_*` element kinds).
- **The array expression is side-effect-free and stable across iterations**: a bare
  `Identifier` (`arr`) or a non-computed `MemberExpression` chain of plain identifiers
  (`this.items`, `obj.data`). Function calls or computed members are excluded because
  the rewrite accesses `array.length` and `array[i]` on each iteration; re-evaluating
  a call expression would multiply side effects.
- **The loop body does not modify the array's `length` or delete elements.** The
  default array iterator captures the array reference but re-reads elements dynamically;
  it also stops when `index >= length` at the point of each `next()` call. A `for` loop
  that re-reads `array.length` each iteration matches this behaviour, but only if the
  array is not simultaneously shrunk by code outside the loop. If the loop body may
  shorten the array, hoist `array.length` into a `const len = array.length` before
  the loop and use `i < len` as the termination condition — matching the snapshot
  semantics of the iterator (which calls `ToLength` on the array length at creation
  time for built-in array iterators, though V8 re-checks on each step).
- **The loop body does not call `break` with a label targeting an outer construct that
  the original `for...of` also targets.** Labelled `break` and `continue` work the same
  way in both loop forms, but only if the label structure is reproduced correctly in the
  rewrite.
- **The iterable is not observed via `Symbol.iterator`.** If user code overrides
  `Array.prototype[Symbol.iterator]` or sets a custom `Symbol.iterator` on the specific
  array instance, `for...of` calls that override whereas an indexed loop does not. The
  rewrite is safe only when no such override is in effect.
- **The loop does not rely on iterator-return semantics.** If the loop exits early via
  `break`, `throw`, or `return`, the runtime calls `iterator.return()` (if defined) to
  give the iterator a chance to clean up. Plain `Array` iterators do not define
  `iterator.return`, so for arrays this distinction is moot — but it is a precondition
  to check before the transform is applied.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Iterable is a `Set`, `Map`, `String`, generator, or custom iterable | Index-based access does not exist or has different semantics; the only valid traversal is through the iterator protocol |
| Array is sparse (contains holes) | The array iterator skips holes; `for` loop reads every index, introducing `undefined` values at hole positions |
| `Array.prototype[Symbol.iterator]` or the instance's `Symbol.iterator` is overridden | `for...of` calls the override; a `for` loop bypasses it entirely — observable behaviour differs |
| Array expression has side effects: `getItems()` or `obj[key]` with a computed key | `array.length` and `array[i]` would re-evaluate the expression on each access, multiplying side effects and potentially returning a different array |
| Loop body calls `break` with a label that refers to the `for...of` loop itself (already safe) but the rewrite changes the nesting level | Label resolution must be preserved exactly; an incorrectly placed label in the rewrite causes `break` to target the wrong construct |
| `iterator.return()` is meaningful for cleanup | Only relevant for non-array iterables; for plain `Array` iterators this method is not defined and the condition never applies in practice |
| The loop variable destructures from `array.entries()` and the body uses the array reference via the third argument | `entries()` yields `[index, value]` pairs; if the body also references the outer array directly the rewrite is safe, but if it somehow relied on the iterator object identity (unusual) behaviour may differ |
| The array's `length` is intentionally mutated by the loop body as a control-flow mechanism | `for...of` on an array re-checks `index < length` via the iterator's internal slot on each step; an indexed loop also re-reads `array.length` each iteration — behaviour matches as long as no snapshot-vs-live difference is intended, but any mutation-as-control-flow pattern is fragile and the transform should not touch it |

## Sources

- [ECMAScript spec: `Array Iterator Objects`](https://tc39.es/ecma262/#sec-array-iterator-objects) —
  defines `CreateArrayIterator`, `%ArrayIteratorPrototype%.next`, and the `HasProperty`
  hole check on each step; the authoritative reference for exactly what `for...of` does
  on a plain array.
- [ECMAScript spec: `for-of` statement runtime semantics](https://tc39.es/ecma262/#sec-runtime-semantics-forin-div-ofheadevaluation) —
  documents `GetIterator`, the `IteratorNext` abstract operation, the `done` check, and
  the `IteratorClose` call on abrupt completion (the `iterator.return()` path).
- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains
  `PACKED_*` vs. `HOLEY_*` element kinds and why dense arrays are the most optimisable
  shape; directly relevant to the hole-skipping precondition.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  background on how Turbofan inlines and optimises plain loops versus calls across
  function-call boundaries; explains why the `next()` allocation can be elided by escape
  analysis but is not guaranteed.
- [V8 blog: Fast `for`-`of` in V8](https://v8.dev/blog/fast-for-of) — V8 engineering
  post on optimising `for...of` for arrays specifically; confirms that V8 does apply
  iterator-protocol optimisations for the common array case but that the plain indexed
  `for` loop remains the fastest baseline because it avoids the iterator machinery
  entirely.
- [MDN: `for...of`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of) —
  spec behaviour: `Symbol.iterator` dispatch, `iterator.return()` on abrupt completion,
  and the distinction between iterables and array-likes.
- [MDN: `Array.prototype.entries()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/entries) —
  documents the `[index, value]` iterator produced by `entries()`; relevant to the
  double-iterator overhead described above.

## Benchmark results

Run `npx vitest bench rules/for-of-to-for/benchmark/bench.js` to reproduce.

Measured on Node.js (current LTS), 100 000-element dense integer array:

| Variant | ops/s | Speedup |
|---|---|---|
| `for...of` (original) | 12 205 | baseline |
| `for` loop (optimized) | 15 586 | **1.28× faster (+28%)** |

| Variant | ops/s | Speedup |
|---|---|---|
| `for...of` with `entries()` (original) | 4 495 | baseline |
| `for` loop replacing `entries()` (optimized) | 15 204 | **3.38× faster (+238%)** |

The simple-iteration gain (28%) is comfortably above the 10% threshold. The `entries()` gain
is dramatic (238%) because it eliminates two iterator objects — the outer `entries()` iterator
and the inner array iterator — plus two `next()` calls per element, replacing the whole chain
with a single integer increment and one array element access.
