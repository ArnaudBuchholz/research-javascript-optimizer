# Optimization Backlog

| rule-name | summary | researched | tested | implemented | done |
|-----------|---------|:----------:|:------:|:-----------:|:----:|
| `foreach-to-for` | Replace `Array.forEach(fn)` with a `for` loop to eliminate per-element function call overhead | ✅ | ✅ | ✅ | ✅ |
| `map-to-for` | Replace `Array.map(fn)` with a pre-allocated array + `for` loop when the callback has no side-effects | ✅ | ✅ | ✅ | ✅ |
| `filter-to-for` | Replace `Array.filter(fn)` with a `for` loop + conditional `push` | ✅ | ✅ | ✅ | ✅ |
| `reduce-to-for` | Replace `Array.reduce(fn, init)` with a `for` loop and an explicit accumulator variable | ✅ | ✅ | ✅ | ✅ |
| `for-of-to-for` | Replace `for...of` iteration over arrays with an indexed `for` loop to avoid iterator protocol overhead | ✅ | ✅ | ✅ | ✅ |
| `chained-array-methods` | Replace `.filter(...).map(...)` chains with a single `for` loop to avoid intermediate array allocations | ✅ | ✅ | ✅ | ✅ |
| `object-keys-foreach` | Replace `Object.keys(obj).forEach(fn)` with a `for...in` loop + `hasOwnProperty` guard | ✅ | ✅ | | ✅ |
| `array-spread-concat` | Replace `[...a, ...b]` with `a.concat(b)` (or a pre-sized loop) in hot paths to avoid iterable protocol | ✅ | ✅ | ✅ | ✅ |
| `try-catch-outside-loop` | Hoist `try/catch` blocks out of tight loops — V8 cannot optimise a function that contains `try/catch` as well as it can one that does not | ✅ | ✅ | | ✅ |
| `arguments-to-rest` | Replace use of the `arguments` object with a rest parameter to allow the function to be fully optimised by V8 | ✅ | ✅ | | ✅ |
| `inline-no-arg-function` | Inline calls to simple functions with no parameters and no return value by reproducing the body in a block scope, eliminating call overhead entirely | ✅ | ✅ | ✅ | ✅ |
| `inline-parameterized-function` | Extend inlining to functions with parameters: pass arguments via `const` variables in the parent scope and declare shadowed `let` bindings in the inline block | ✅ | ✅ | ✅ | ✅ |
| `inline-returning-function` | Extend inlining to functions that return a value: capture the result in a unique `let` variable in the parent scope, assigned before the inline block exits | ✅ | ✅ | ✅ | ✅ |
| `inline-early-exit-function` | Extend inlining to functions that use early `return`: wrap the inline block in `do {} while (0)` and replace each `return` with `break` to preserve control flow | ✅ | ✅ | ✅ | ✅ |
| `inline-loop-in-function` | Extend inlining to functions that contain loops with `break`/`continue`: introduce a unique label on the `do {} while (0)` wrapper so that `break label` targets the function exit rather than the inner loop | ✅ | ✅ | | ✅ |
| `pow-to-multiply` | Replace `Math.pow(x, n)` with repeated multiplication (`x * x`, `x * x * x`) for small integer exponents (2–4) to eliminate the function call and the general-purpose floating-point path | | | | |
| `delete-to-undefined` | Replace `delete obj.prop` with `obj.prop = undefined` to avoid forcing a hidden-class transition that de-optimises all code holding a reference to that object shape | | | | |
| `property-chain-cache` | Cache a repeated deep property access (`a.b.c.d`) in a `const` before a loop so V8 can track a single local binding instead of re-resolving the chain on every iteration | | | | |
| `typeof-undefined` | Replace `typeof x === 'undefined'` with `x === undefined` — the `typeof` form allocates a temporary string and performs a string comparison; the strict-equality form is a direct value test | | | | |
| `nullish-double-check` | Replace `x !== null && x !== undefined ? x : fallback` (or `x == null ? fallback : x`) with `x ?? fallback` — the explicit form evaluates `x` up to three times; the `??` operator evaluates it exactly once | | | | |
| `and-chain-to-optional-chain` | Replace `a && a.b && a.b.c` with `a?.b?.c` — the `&&`-chain re-traverses the property path from the root at each step; `?.` evaluates each segment exactly once | | | | |
| `bitwise-floor` | Replace `Math.floor(x)` with `x | 0` for known-positive integers and `Math.ceil(x)` with `-(-x | 0)` — eliminates the function call and forces the pure integer path | | | | |
| `preallocated-array` | Replace `const arr = []; for (...) arr.push(x)` with `const arr = new Array(n); for (...) arr[i] = x` when the final length is known upfront — avoids repeated backing-store re-allocations as the array grows | | | | |
| `fast-numeric-coerce` | Replace `Number(x)` and `parseInt(x, 10)` for known-numeric strings with `+x` — the unary `+` operator compiles to a single ToNumber bytecode; `Number()` and `parseInt()` go through a function call | | | | |
| `fn-call-to-bound` | Replace repeated `fn.call(fixedCtx, ...)` inside a loop with a bound function hoisted outside (`const f = fn.bind(fixedCtx)`) — removes the per-iteration `.call` dispatch overhead when `this` is invariant | | | | |
| `for-in-array-to-for` | Replace `for (const i in arr)` over arrays with an indexed `for` loop — `for-in` forces string-key enumeration and a prototype-chain scan; the indexed loop stays in the fast packed-elements path | | | | |
| `string-concat-to-join` | Replace `s += piece` in a loop with `arr.push(piece)` + `arr.join('')` after the loop — repeated `+=` copies the growing string on every iteration (O(n²) allocations); `join` measures the final length and allocates once | | | | |
| `json-parse-large-literal` | Replace large inline object/array literals (≥ ~10 kB) with `JSON.parse('…')` — V8 parses JSON ~2× faster than equivalent JS object literals because it skips AST construction and type inference | | | | |
| `instanceof-to-typeof` | Replace `x instanceof String` / `x instanceof Number` / `x instanceof Boolean` with `typeof x === 'string'` etc. — `instanceof` walks the prototype chain; `typeof` is a single opcode with a dedicated TurboFan fast path | | | | |
| `object-assign-to-spread` | Replace `Object.assign({}, a, b)` with `{ ...a, ...b }` — object spread triggers the `CloneObjectIC` fast path in V8; `Object.assign` goes through a generic built-in call with per-property IC lookups | | | | |
| `apply-to-spread-call` | Replace `fn.apply(null, args)` with `fn(...args)` — `Function.prototype.apply` must allocate an arguments-adaptor frame for arbitrary-length arrays; a spread call site is statically monomorphic and directly inlineable | | | | |
