// resetState operates on a closed-over object — the reference, not the binding, is mutated
const state = { count: 0, done: false };

export function run(items) {
  const results = [];
  items.forEach((item) => {
    {
      state.count = 0;
      state.done = false;
    }
    state.count += item;
    state.done = state.count > 10;
    results.push({ count: state.count, done: state.done });
  });
  return results;
}
