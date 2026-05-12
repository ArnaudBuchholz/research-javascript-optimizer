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
| `inline-returning-function` | Extend inlining to functions that return a value: capture the result in a unique `let` variable in the parent scope, assigned before the inline block exits | | | | |
| `inline-early-exit-function` | Extend inlining to functions that use early `return`: wrap the inline block in `do {} while (0)` and replace each `return` with `break` to preserve control flow | | | | |
| `inline-loop-in-function` | Extend inlining to functions that contain loops with `break`/`continue`: introduce a unique label on the `do {} while (0)` wrapper so that `break label` targets the function exit rather than the inner loop | | | | |
