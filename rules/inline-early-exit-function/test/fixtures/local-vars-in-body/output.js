// Function body that mixes an early exit with local `const`/`let` declarations
// (third README example). The local variables must be scoped to the inlined
// block and must not leak into the surrounding loop body.

const cache = {};

export function run(inputs) {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
  for (const raw of inputs) {
    const raw_ = raw;
    do {
      const parsed = raw_ !== null ? { id: raw_, value: raw_ * 10 } : null;
      if (parsed === null) break;
      const key = parsed.id.toString();
      cache[key] = parsed;
    } while (0);
  }
  return Object.assign({}, cache);
}
