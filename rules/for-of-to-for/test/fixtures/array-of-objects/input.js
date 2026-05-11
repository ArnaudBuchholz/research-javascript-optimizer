export function run(arr) {
  const active = [];
  for (const user of arr) {
    if (user.active) active.push(user.name);
  }
  return active;
}
