// The parameter name `key` clashes with the for-of loop variable `key`.
// The transform must rename the argument binding to avoid a duplicate declaration.

function normalizeKey(map, key) {
  map[key.toLowerCase()] = true;
}

export function run(rawKeys) {
  // Fresh map per call so tests are independent of module-level state.
  const keyMap = {};
  for (const key of rawKeys) {
    normalizeKey(keyMap, key);
  }
  return Object.keys(keyMap).sort();
}
