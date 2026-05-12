// hits, misses, and total are module-level state mutated by initCounters()
let hits = 0;
let misses = 0;
let total = 0;

function initCounters() {
  hits = 0;
  misses = 0;
  total = 0;
}

export function run(data) {
  const snapshots = [];
  for (let i = 0; i < data.length; i++) {
    initCounters();
    if (data[i] > 0) {
      hits++;
    } else {
      misses++;
    }
    total++;
    snapshots.push({ hits, misses, total });
  }
  return snapshots;
}
