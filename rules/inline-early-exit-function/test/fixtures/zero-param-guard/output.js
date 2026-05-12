// Zero-parameter guard function from the README.
// The function reads and mutates free variables. No argument bindings needed
// at the call site.

const MAX = 5;
let counter = 0;
let log = [];

export function run(N) {
  counter = 0;
  log = [];
  for (let i = 0; i < N; i++) {
    do {
      if (counter > MAX) break;
      log[log.length] = counter;
      counter++;
    } while (0);
  }
  return { log: log.slice(), counter };
}
