# `object-keys-foreach` — Replace `Object.keys(obj).forEach(fn)` with a `for...in` loop

## Pattern

```js
// Before
Object.keys(obj).forEach((key) => {
  process(key, obj[key]);
});

// After
for (const key in obj) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    process(key, obj[key]);
  }
}
```

## Why it's faster

`Object.keys(obj).forEach(fn)` has two compounding costs before the callback even runs:

1. **Intermediate array allocation**: `Object.keys` allocates a new heap array, copies
   every enumerable own-property name string into it, and then lets the GC collect it
   once the loop is done. For objects with many keys this is a non-trivial allocation
   and copy.

2. **forEach call overhead**: as with `Array.prototype.forEach` on plain arrays, each
   key invokes the callback as a function call — a new stack frame, `this` binding,
   type-feedback entry, and an opaque boundary that blocks Turbofan's loop
   optimisations.

A `for...in` loop avoids both costs. The engine iterates the object's internal property
list directly, emitting each key as a string without constructing an intermediate array.
V8's `for...in` fast path (activated when the object has a stable hidden class and no
prototype chain pollution) is tightly optimised: it walks the descriptor array in-place
and requires no heap allocation proportional to the number of keys.

The `hasOwnProperty` guard is required to match `Object.keys` semantics (own properties
only). Using `Object.prototype.hasOwnProperty.call(obj, key)` instead of
`obj.hasOwnProperty(key)` is safe even when `obj` is a `Object.create(null)` null-
prototype object or when `hasOwnProperty` has been shadowed on the instance.

## When it applies

- `obj` is a plain object (or any object where `for...in` visiting prototype properties
  would be correctly blocked by the `hasOwnProperty` guard).
- The callback is an **arrow function** — no `this` binding in use.
- The callback body is a **block statement** (not a concise body like `key => expr`).
- The callback body contains **no top-level `return` statements**. `return` inside a
  `forEach` callback skips to the next iteration; `return` inside a `for...in` body
  exits the enclosing function.
- The object expression is **side-effect-free and stable**: a bare `Identifier` (`obj`)
  or a non-computed `MemberExpression` chain of identifiers (`this.config`,
  `options.map`). Expressions that may produce a different object on each evaluation
  (e.g. function calls) cannot be safely hoisted outside the loop.
- **No prototype chain properties are expected**: the caller relies on `Object.keys`
  returning only own enumerable properties, which the `hasOwnProperty` guard replicates.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Callback contains a top-level `return` | `return` exits the enclosing function, not just the current iteration — completely different semantics |
| Object expression has side effects, e.g. `getConfig().forEach(...)` | The object reference must be stable; re-evaluating it would change side-effect semantics |
| Code must run in environments where `for...in` order matters and the order differs from `Object.keys` order | In V8 (and per the ES2015+ spec) `for...in` over an own-properties-only object visits string keys in insertion order for non-integer keys, matching `Object.keys` — but this is spec-guaranteed only since ES2020 (`[[OwnPropertyKeys]]` ordering). For insertion-ordered code on modern engines this is safe; for portable code targeting unusual engines it is not |
| The object may be a Proxy | A Proxy's `ownKeys` trap controls `Object.keys`; its `has` and `getOwnPropertyDescriptor` traps control `for...in`. The two paths are not guaranteed to be equivalent for Proxy objects |
| `hasOwnProperty` must not be called (e.g. sealed/frozen object where calling any method on it throws) | Extremely rare, but the `hasOwnProperty` guard changes which methods are invoked on `obj` |
| The callback is a non-arrow `function` expression that uses `this` | The transformation does not preserve the `this` binding established by `forEach` |
| The object has inherited enumerable properties that the caller intentionally wants to skip via `Object.keys` AND also has own properties with the same names on the prototype | The `hasOwnProperty` guard handles this correctly, but the transform should not be applied if the intent is ambiguous |

## Sources

- [V8 blog: Fast `for`-`in` in V8](https://v8.dev/blog/fast-for-in) — detailed
  walkthrough of V8's `for...in` fast and slow paths, hidden class transitions, and
  why prototype chain pollution forces the slow path.
- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains object
  shape representation and how V8 decides which optimisation tier applies.
- [MDN: Object.keys()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys) —
  spec behaviour: own enumerable string-keyed properties only, array returned in the
  same order as `for...in` (with inherited filtered out).
- [MDN: for...in](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in) —
  spec behaviour: enumerates own and inherited enumerable string-keyed properties;
  requires `hasOwnProperty` guard to match `Object.keys` semantics.
- [ECMAScript 2020 spec §10.1.11](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys) —
  `[[OwnPropertyKeys]]` ordering guarantee (non-integer string keys in insertion order),
  which underpins the safety of treating `for...in` + `hasOwnProperty` as equivalent to
  `Object.keys` ordering on V8 and compliant ES2020+ engines.

## Measured speedup

Benchmarked on Node.js (current LTS) with V8, using a 10 000-key plain object.
Run `npx vitest bench rules/object-keys-foreach/benchmark/bench.js` to reproduce.

| Variant | ops/s (mean) |
|---|---|
| `Object.keys(obj).forEach(fn)` (original) | ~2,300 |
| `for...in` + `hasOwnProperty` guard (proposed) | ~1,900 |

**Result: the proposed rewrite is ~21% SLOWER on modern V8 — this rule does NOT meet the ≥ 10% speedup requirement and must be dropped.**

### Why the proposed rewrite is slower on modern V8

The theoretical gain (avoiding the `Object.keys` intermediate array) is real but is outweighed in practice by the cost introduced:

1. **`Object.prototype.hasOwnProperty.call(obj, key)` on every iteration**: this is a
   property lookup on `Object.prototype` followed by a `.call` invocation — two
   additional operations per key that V8 cannot always inline. This is comparable in
   cost to the per-element callback overhead it was supposed to replace.

2. **V8's `for...in` fast path is conditional**: the fast path described in the V8 blog
   applies when the object has a stable hidden class *and* no prototype-chain properties
   are enumerable. The moment a `hasOwnProperty` guard is added, V8's JIT may not be
   able to eliminate the guard from the hot loop, negating the fast-path benefit.

3. **V8 already optimises `Object.keys().forEach`**: modern V8 has dedicated
   optimisation tiers for `Array.prototype.forEach` on dense arrays of strings. The
   key-string array produced by `Object.keys` is an optimised SMI/string array; V8's
   TurboFan can inline the forEach callback and eliminate the function call overhead
   entirely in steady-state code.

### Conclusion

The `object-keys-foreach` rule is **dropped**. The theoretical motivation (intermediate
array allocation + forEach call overhead) does not hold against real V8 measurements:
modern V8's optimised `Object.keys` + inlined `forEach` is measurably faster than the
`for...in + hasOwnProperty` alternative.

If a future engine or benchmark shows a significant regression, this rule should be
revisited with updated measurements.
