// counter is closed over by tick()
let counter = 0;

function tick() {
  counter++;
}

export function run(iterations) {
  counter = 0;
  for (let i = 0; i < iterations; i++) {
    tick();
  }
  return counter;
}
