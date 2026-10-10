/**
 * A 64-bit hash (16 hex characters) of plain data for the desync check: numbers by their IEEE bits (−0 as 0, which
 * MessagePack writes as the integer 0), booleans, strings, arrays, typed arrays, objects and maps in sorted key order,
 * so a field added to the room later is covered as it is. An undefined value counts as absent, and keys in `skip` are
 * left out wherever they appear. Anything else (a function, a symbol, a bigint, a class instance) throws.
 */
export function hashPlain(value: unknown, skip: ReadonlySet<string>): string {
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  const view = new DataView(new ArrayBuffer(8));
  const word = (w: number) => {
    a = Math.imul(a ^ w, 0x01000193);
    b = Math.imul(b ^ w, 0x5bd1e995);
    b ^= b >>> 15;
  };
  const text = (s: string) => {
    word(s.length);
    for (let i = 0; i < s.length; i++) word(s.charCodeAt(i));
  };
  const fields = (keys: string[], at: (key: string) => unknown) => {
    const kept = keys.filter((k) => !skip.has(k) && at(k) !== undefined);
    word(kept.length);
    for (const key of kept.sort()) {
      text(key);
      feed(at(key));
    }
  };
  function feed(v: unknown): void {
    if (v !== v)
      word(10); // NaN: one value, whatever bits the engine keeps
    else if (typeof v === "number") {
      view.setFloat64(0, v === 0 ? 0 : v, true);
      word(1);
      word(view.getUint32(0, true));
      word(view.getUint32(4, true));
    } else if (typeof v === "boolean") word(v ? 2 : 3);
    else if (typeof v === "string") {
      word(4);
      text(v);
    } else if (v === null) word(5);
    else if (v instanceof Uint32Array) {
      word(6);
      word(v.length);
      for (let i = 0; i < v.length; i++) word(v[i]!);
    } else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const items = v as ArrayLike<unknown>;
      word(7);
      word(items.length);
      for (let i = 0; i < items.length; i++) feed(items[i]);
    } else if (v instanceof Map) {
      word(8);
      const keys = [...v.keys()];
      if (!keys.every((k) => typeof k === "string"))
        throw new TypeError("not plain data: a map key");
      fields(keys as string[], (k) => v.get(k));
    } else if (
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      const record = v as Record<string, unknown>;
      word(9);
      fields(Object.keys(record), (k) => record[k]);
    } else throw new TypeError(`not plain data: ${typeof v}`);
  }
  feed(value);
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, "0");
  return hex(a) + hex(b);
}
