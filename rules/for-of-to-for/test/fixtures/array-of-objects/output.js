export function run(arr) {
  const active = [];
  for (let i = 0; i < arr.length; i++) {
    const user = arr[i];
    if (user.active) active.push(user.name);
  }
  return active;
}
