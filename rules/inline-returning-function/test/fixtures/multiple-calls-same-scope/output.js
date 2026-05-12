// Two calls to value-returning functions in the same loop iteration.
// Both return values are consumed in the same expression.

export function run(data) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const x_1 = data[i];
    let _result_1;
    {
      _result_1 = x_1 * 2;
    }
    const x_2 = data[i];
    let _result_2;
    {
      _result_2 = -x_2;
    }
    result.push(_result_1 + _result_2);
  }
  return result;
}
