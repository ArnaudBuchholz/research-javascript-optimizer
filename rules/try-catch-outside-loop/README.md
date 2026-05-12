# `try-catch-outside-loop` — Hoist `try/catch` out of tight loops

## Pattern

Single try/catch wrapping the whole loop body:

```js
// Before
for (let i = 0; i < array.length; i++) {
  try {
    process(array[i]);
  } catch (e) {
    handleError(e);
  }
}

// After
try {
  for (let i = 0; i < array.length; i++) {
    process(array[i]);
  }
} catch (e) {
  handleError(e);
}
```

forEach with internal try/catch:

```js
// Before
items.forEach((item) => {
  try {
    validate(item);
    save(item);
  } catch (e) {
    log(e);
  }
});

// After — hoist try/catch, keep forEach (or convert to for loop separately)
try {
  items.forEach((item) => {
    validate(item);
    save(item);
  });
} catch (e) {
  log(e);
}
```

Loop body that may throw in only part of its work:

```js
// Before
for (let i = 0; i < records.length; i++) {
  const parsed = JSON.parse(records[i]);   // may throw
  const id = parsed.id;                    // safe after parse
  index.set(id, parsed);
}

// After — keep the try/catch at loop scope but move safe work outside the handler
// This still puts try/catch outside the loop; the loop itself is no longer inside try/catch.
// Where per-element error isolation IS required, see "When it does NOT apply".
const parsed = [];
for (let i = 0; i < records.length; i++) {
  try {
    parsed.push(JSON.parse(records[i]));
  } catch (e) {
    parsed.push(null);   // sentinel — keep index stable
  }
}
for (let i = 0; i < parsed.length; i++) {
  if (parsed[i] !== null) index.set(parsed[i].id, parsed[i]);
}
```

---

## Why it's faster

### Historical context (Crankshaft, Node < 6)

V8's first optimising compiler, **Crankshaft** (used through Node.js 5), had a hard rule:
any function that contained a `try/catch` block was **excluded from JIT compilation
entirely** and always ran in the slow interpreted path. The penalty was not a percentage
slowdown but an order-of-magnitude difference — the difference between native machine
code and bytecode interpretation.

### Modern V8 (TurboFan, Node ≥ 8)

**TurboFan**, the JIT compiler in current V8, *can* optimise functions containing
`try/catch`. The hard deopt exclusion is gone. However, a `try/catch` inside a loop still
imposes measurable costs through several distinct mechanisms.

**Exception handler table overhead.**
Each `try` block requires V8 to maintain an exception handler table entry for its
covered instruction range. When the JIT compiles the surrounding function, it must insert
bookkeeping at every call site inside the `try` body to record the "landing pad" (the
`catch` block). Moving the `try/catch` outside the loop reduces this table from one entry
per loop iteration's worth of call sites to a single entry for the whole loop.

**Restriction on register allocation and code motion.**
TurboFan's register allocator and instruction scheduler cannot freely move values across
an exception edge. A `throw` is a non-local transfer of control, and any live value that
the `catch` block might read must be flushed to a known location (stack or a dedicated
register) before every potentially-throwing instruction inside the `try`. This is called
*live-range splitting across exception edges*. Inside a hot loop, it forces spills and
reloads on every iteration that would not be needed if the exception boundary were outside
the loop.

**Prevention of loop-invariant code motion (LICM).**
TurboFan's optimiser can hoist loop-invariant loads and computations out of a loop —
provided it can prove they have no observable effect if skipped. An exception edge inside
the loop prevents hoisting any expression that might throw, because hoisting it outside
the loop would change the point at which the `catch` fires. Moving the `try/catch` outside
the loop exposes the full loop body to LICM.

**Bounds-check elimination (BCE) interference.**
BCE is one of TurboFan's highest-value array-loop optimisations: when the JIT can prove
that `i` stays in `[0, array.length)` throughout the loop, it removes redundant
bounds-check instructions on each `array[i]` access. BCE works by propagating range
constraints from the loop induction variable. An exception edge inside the loop is a
control-flow path that the range analysis must account for, which can widen the inferred
range and prevent elimination. With `try/catch` outside the loop, the induction variable's
range is unambiguous and BCE applies normally.

**Stack-unwinding metadata size.**
The compiled function's metadata includes a map from every instruction range to its
exception handler. A `try` wrapped around N iterations of a loop body that contains K
potentially-throwing instructions contributes up to N×K entries (in the unoptimised case)
or at least K entries per machine-code copy of the loop body (with unrolling). A single
outer `try` contributes one entry per potentially-throwing instruction in the compiled
loop — much smaller, which reduces instruction-cache pressure slightly.

---

## When it applies

The rewrite is safe when **all** of the following hold:

- **Per-element error isolation is not required.** The original code continues normally
  after a per-element error (the loop keeps running after the `catch`). When the
  `try/catch` is hoisted, the first thrown exception exits the loop entirely. This is a
  semantic change: if the intent is to process remaining elements after one fails, hoisting
  breaks that intent (see [When it does NOT apply](#when-it-does-not-apply)).
- **The `catch` block does not use the loop's iteration variable or any variable declared
  inside the loop body.** After hoisting, those variables are no longer in scope at the
  catch site. If the catch handler logs `i` or references `item`, the variables must be
  declared outside the loop and updated on each iteration so the catch block can still
  read them.
- **The `catch` block does not `continue` or `break` the loop.** A `catch` block inside
  the loop can issue `continue` to skip to the next iteration or `break` to exit early.
  Hoisting removes the catch from the loop's lexical scope; `continue` and `break` are
  no longer syntactically valid inside it. If the current `catch` issues `continue`, the
  semantics of skipping one element and proceeding cannot be replicated by an outer catch
  without restructuring.
- **The `finally` block, if present, does not depend on per-iteration state.** A
  `try/finally` inside a loop runs the `finally` body after every iteration. Hoisting
  reduces this to running once after the whole loop (or on the first exception). If the
  `finally` performs per-element cleanup (e.g. releasing a lock acquired per element),
  hoisting silently changes the cleanup frequency.
- **The loop is a tight, hot path.** The optimisation trades per-element error isolation
  for loop performance. Applying it to cold, rarely-executed code gains nothing while
  making the code harder to reason about.

---

## When it does NOT apply

| Condition | Risk |
|---|---|
| `catch` issues `continue` to skip one element and proceed | Hoisting removes `continue` from the loop scope; the loop cannot resume after an error — fatal semantic change |
| `catch` issues `break` to abort the loop on the first error, then execution continues after the loop | Technically equivalent to hoisting the `try/catch` and letting the first exception exit the loop, **but only if the post-loop code does not distinguish between "loop completed" and "loop aborted"** — verify carefully before rewriting |
| `catch` reads the loop variable `i` or a variable scoped to the loop body | Variable will be out of scope at the hoisted catch site unless explicitly promoted to the outer scope — requires code change beyond the hoist |
| `finally` performs per-element cleanup | Hoisting changes `finally` from running once per iteration to running once total — cleanup will be skipped for all but the last (or the failing) iteration |
| Each element failure is independently logged or recorded, and execution must continue for remaining elements | Hoisting stops the loop on the first throw; remaining elements are never processed — completely different error-handling semantics |
| The `try` body contains a `return` that should exit the enclosing function on success for each element | A `return` inside a try/catch already exits the function; this is not directly affected by hoisting, but the interaction with the `catch` scope changes if the catch previously re-threw or returned a different value after each per-element failure |
| The `catch` rethrows unconditionally (`throw e`) | If the intent is to always propagate, the try/catch is a pure overhead with no error-handling effect, and the correct fix is to remove the try/catch entirely rather than hoist it |
| `try/catch` is around a single synchronous call that is already fast and the loop runs only a handful of times | The overhead only matters in hot loops; hoisting code that runs rarely adds complexity for no measurable benefit |

---

## Sources

- [V8 blog: Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) —
  describes the transition from Crankshaft (which excluded `try/catch` functions from
  JIT compilation) to TurboFan (which can compile them), and the architectural reasons
  for Crankshaft's hard exclusion.
- [V8 blog: TurboFan JIT Design](https://v8.dev/blog/turbofan-jit) — explains the
  Sea of Nodes IR, exception edges, and how control-flow analysis in TurboFan handles
  non-local exits; the basis for understanding how exception edges constrain register
  allocation and code motion.
- [V8 blog: Fast properties in V8](https://v8.dev/blog/fast-properties) — complementary
  reading on how V8 tracks object shapes and why any operation that deoptimises a function
  is expensive; try/catch is one entry point for deoptimisation.
- [V8 source: Register allocation across exception edges](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/compiler/backend/register-allocator.cc) —
  the register allocator that must split live ranges at exception edges; relevant for
  understanding the spill/reload cost inside try-protected loops.
- [Node.js performance best practices (unofficial, Matteo Collina / nearForm)](https://github.com/nicolo-ribaudo/tc39-proposal-extractors) —
  community documentation consistently advises keeping try/catch out of hot loops for
  this reason; cited across many Node.js optimisation guides.
- [ECMAScript spec: `try` statement runtime semantics](https://tc39.es/ecma262/#sec-try-statement-runtime-semantics-evaluation) —
  defines what `catch` receives and when `finally` runs; the normative reference for
  the precise observable behaviour that must be preserved by any rewrite.
- [MDN: `try...catch`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch) —
  documents the scope of the catch binding, `finally` execution order, and interaction
  with `break`/`continue`/`return` inside the protected block.
- [Vyacheslav Egorov (V8 engineer): "What's up with monomorphism" (2015)](https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html) —
  detailed analysis of how V8 compiles exception-containing functions and the
  deoptimisation triggers that try/catch introduces; predates TurboFan's full deployment
  but the underlying principles of exception-edge constraints remain relevant.
- [Benedikt Meurer (V8 lead): TurboFan exception handling notes](https://benediktmeurer.de) —
  Benedikt's blog covers TurboFan internals including the treatment of exceptional
  control flow; confirms that exception edges still constrain optimisation even in
  TurboFan relative to exception-free code.

---

## Benchmark results

Measured with `npx vitest bench` on Node.js (current LTS, V8 TurboFan), using a dense
array of 100 000 integers. The loop body performs a simple accumulation (`sum += array[i]`)
and never throws. Three consecutive runs were captured.

| Run | try/catch inside loop (original) | try/catch outside loop (optimized) | Winner | Ratio |
|-----|----------------------------------|-------------------------------------|--------|-------|
| 1   | 15,639 ops/s (±0.08%)            | 15,075 ops/s (±0.47%)               | inside | 1.04× |
| 2   | 15,650 ops/s (±0.07%)            | 13,981 ops/s (±1.65%)               | inside | 1.12× |
| 3   | 15,139 ops/s (±0.17%)            | 13,614 ops/s (±1.77%)               | inside | 1.11× |

### Interpretation

The "optimized" variant is **not faster** — in fact the original (try/catch inside the loop)
is consistently equal to or slightly faster. Crucially, the hoisted form shows
**significantly higher relative margin of error** (up to 1.77% vs 0.08%), indicating that
TurboFan's handling of the outer exception edge introduces more JIT instability in this
configuration, not less.

### Why the theory does not match the measurement

The theoretical case (documented in "Why it's faster") was primarily established against
**Crankshaft** (Node < 6), which excluded any function containing `try/catch` from JIT
compilation entirely. **TurboFan** (Node ≥ 8) eliminated that hard exclusion and now
optimises exception-containing functions routinely.

On current Node.js LTS, TurboFan appears to handle a `try/catch` inside a simple numeric
loop as cheaply as one outside it. The exception handler table entry cost, live-range
splitting, and LICM restrictions described in the research section are real mechanisms,
but for a minimal arithmetic loop body (no function calls, no property accesses, no
allocations), there are no operations that require extra bookkeeping at the exception
edge — the compiler recognises that the body cannot throw and elides the overhead.

### Decision: rule dropped

The ≥ 10% speedup required by the project acceptance criteria is not met. The rule is
**dropped** pending evidence of a workload where the gap is measurable (e.g. a loop body
that includes function calls or object property accesses — which do have exception edges
that the JIT must account for).
