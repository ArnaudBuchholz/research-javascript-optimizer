// Function body that mixes an early exit with local `const`/`let` declarations
// (third README example). The local variables must be scoped to the inlined
// block and must not leak into the surrounding loop body.

const cache = {};

function maybeStore(raw) {
  const parsed = raw !== null ? { id: raw, value: raw * 10 } : null;
  if (parsed === null) return;
  const key = parsed.id.toString();
  cache[key] = parsed;
}

export function run(inputs) {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
  for (const raw of inputs) {
    maybeStore(raw);
  }
  return Object.assign({}, cache);
}
