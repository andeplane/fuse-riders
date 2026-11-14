import { isArrayOf, isNumber, isRecord, isString, isStringArray } from './guards';

describe('guards', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('isString and isNumber', () => {
    expect(isString('a')).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isNumber(1.5)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber('1')).toBe(false);
  });

  it('array guards', () => {
    expect(isStringArray(['a'])).toBe(true);
    expect(isStringArray(['a', 1])).toBe(false);
    expect(isArrayOf([1, 2], isNumber)).toBe(true);
    expect(isArrayOf('nope', isNumber)).toBe(false);
  });
});
