// The parameter name `key` clashes with the for-of loop variable `key`.
// The transform must rename the argument binding to avoid a duplicate declaration.

export function run(rawKeys) {
  // Fresh map per call so tests are independent of module-level state.
  const keyMap = {};
  for (const key of rawKeys) {
    const map = keyMap;
    const _key = key;
    {
      map[_key.toLowerCase()] = true;
    }
  }
  return Object.keys(keyMap).sort();
}
