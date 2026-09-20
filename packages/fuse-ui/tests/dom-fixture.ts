import { parseHTML } from "linkedom";

/** A fresh linkedom document per test; nothing is installed on globalThis. */
export function page() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body></body></html>",
  );
  return { document: document as unknown as Document, window };
}

/** A hostile display name: must render as text, never as markup. */
export const HOSTILE = `<img src=x onerror="alert(1)"><b>Ada</b> & "friends"`;

/** linkedom has no HTMLDialogElement methods; a dialog in these tests records its close calls instead. */
export function recordClose(dialog: HTMLDialogElement): { count: number } {
  const calls = { count: 0 };
  Object.defineProperty(dialog, "close", {
    value: () => {
      calls.count++;
    },
  });
  return calls;
}

/** An event with the fields a handler reads, for event types linkedom does not construct. */
export function event(
  window: { Event: typeof Event },
  type: string,
  fields: Record<string, unknown> = {},
): Event {
  const result = new window.Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(fields))
    Object.defineProperty(result, key, { value });
  return result;
}

/** A timer queue that runs only when told to. */
export function manualTimers() {
  let next = 1;
  const pending = new Map<number, { run: () => void; ms: number }>();
  return {
    setTimeout: (run: () => void, ms: number): unknown => {
      pending.set(next, { run, ms });
      return next++;
    },
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number);
    },
    pending: () => [...pending.values()].map((timer) => timer.ms),
    runAll() {
      const due = [...pending.values()];
      pending.clear();
      for (const timer of due) timer.run();
    },
  };
}
