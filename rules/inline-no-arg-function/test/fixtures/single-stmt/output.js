// counter is closed over by tick()
let counter = 0;

export function run(iterations) {
  counter = 0;
  for (let i = 0; i < iterations; i++) {
    {
      counter++;
    }
  }
  return counter;
}
