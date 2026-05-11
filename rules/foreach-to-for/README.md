# `foreach-to-for` — Replace `.forEach()` with a `for` loop

## Pattern

```js
// Before
array.forEach((item, index) => {
  process(item, index);
});

// After
for (let i = 0; i < array.length; i++) {
  const item = array[i];
  const index = i;
  process(item, index);
}
```

## Why it's faster

`Array.prototype.forEach` invokes a callback function on every element. Each invocation
carries function-call overhead: allocating a new stack frame, binding the `this` value,
setting up the `arguments` object, and emitting a type-feedback entry that V8 must
track. A `for` loop executes the body inline, eliminating all of that per-element cost.

V8's Turbofan JIT can apply aggressive loop optimisations (bounds-check elimination,
range inference, loop unrolling) to plain `for` loops but not across the hidden
function-call boundary that `forEach` introduces.

## When it applies

- The callback is an **arrow function** — no `this` binding ambiguity.
- The callback body is a **block statement** (not a concise body like `item => expr`).
- The callback body contains **no top-level `return` statements** — `return` in a
  `forEach` callback acts as `continue` but `return` in a `for` loop exits the
  enclosing function (see [When it does NOT apply](#when-it-does-not-apply) below).
- The array expression is **safe to evaluate multiple times**: a bare `Identifier`
  (`arr`) or a non-computed `MemberExpression` chain of identifiers (`this.items`,
  `obj.arr`). Function calls and other expressions with potential side effects are
  excluded because the generated loop accesses `.length` once and `[i]` per iteration.

## When it does NOT apply

| Condition | Risk |
|---|---|
| Callback contains a top-level `return` | `return` exits the *enclosing function*, not just this iteration — completely different semantics |
| Array expression is a function call, e.g. `getItems().forEach(...)` | `.length` and `[i]` would call `getItems()` on each access, changing side-effect semantics |
| Array is sparse (has holes) | `forEach` skips holes; a `for` loop does not — extra `undefined` values are processed |
| Callback is a non-arrow `function` expression (with `this` usage) | The arrow-function transform does not preserve `this` binding |

## Sources

- [V8 blog: Elements Kinds in V8](https://v8.dev/blog/elements-kinds) — explains how V8
  represents arrays and why dense integer arrays are the most optimisable shape.
- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  background on how Turbofan optimises loops.
- [MDN: Array.prototype.forEach](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach) —
  spec behaviour (holes, return value ignored, `this` binding).

## Measured speedup

Run `npx vitest bench rules/foreach-to-for/benchmark/bench.js` to reproduce.
Results on Node.js 22 (M-series Mac, 100 000-element dense array, summing all elements):

| variant | ops/sec | relative |
|---|---|---|
| `forEach` (original) | 1 824 | 1× |
| `for` loop (optimised) | 15 622 | **8.6×** |

The `for` loop is ~8.56× faster — a 756% improvement, far exceeding the 10% gate.
