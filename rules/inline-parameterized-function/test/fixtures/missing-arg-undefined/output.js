// The call site passes only one argument to a two-parameter function.
// The missing second parameter is implicitly `undefined` at runtime.
// The transform must emit an explicit `const suffix = undefined;` binding.

const parts = [];

export function run(values) {
  parts.length = 0;
  for (let i = 0; i < values.length; i++) {
    // only one argument — suffix is undefined
    const value = values[i];
    const suffix = undefined;
    {
      // suffix may be undefined; String() converts it to "undefined" gracefully
      parts[parts.length] = String(value) + (suffix !== undefined ? suffix : '');
    }
  }
  return parts.slice();
}
