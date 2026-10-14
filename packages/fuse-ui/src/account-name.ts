/** The shared backend's username contract, mirrored here without importing a game engine. */
export const MAX_ACCOUNT_NAME = 18;
export const validAccountName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.trim() &&
  Array.from(value).length <= MAX_ACCOUNT_NAME &&
  !/[\u0000-\u001f\u007f]/.test(value) &&
  !/\p{Cs}/u.test(value);
export const suggestAccountName = (name: string): string =>
  Array.from(
    name
      .replace(/[\u0000-\u001f\u007f]|\p{Cs}/gu, "")
      .trim()
      .split(/\s+/)[0] ?? "",
  )
    .slice(0, MAX_ACCOUNT_NAME)
    .join("");
