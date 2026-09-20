/**
 * Reads an element a test has just set up itself. Indexed reads are `T | undefined` here, and a test that
 * indexed past its own fixture should say so loudly rather than fail later as a confusing property error.
 */
export function defined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`the fixture has no ${what}`);
  return value;
}
