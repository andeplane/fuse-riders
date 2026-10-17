import { relative } from "node:path";

/**
 * A `node --test` reporter that writes one JSON object, seconds per test file, for scripts/test-timings.json.
 * A file's cost is its process's wall time (the file-level `test:complete` event the runner emits for each
 * isolated file, so imports and setup count), or, without that event, its top-level tests' summed durations.
 */
interface TestEvent {
  type: string;
  data?: {
    file?: string;
    name?: string;
    nesting?: number;
    details?: { duration_ms?: number };
  };
}

const local = (path: string) =>
  relative(process.cwd(), path).replaceAll("\\", "/");

export default async function* timingReporter(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const whole = new Map<string, number>();
  const summed = new Map<string, number>();
  for await (const event of source) {
    const data = event.data;
    if (!data?.file || data.nesting !== 0) continue;
    const file = local(data.file);
    const ms = data.details?.duration_ms ?? 0;
    if (
      event.type === "test:complete" &&
      data.name &&
      local(data.name) === file
    )
      whole.set(file, ms);
    else if (event.type === "test:pass" || event.type === "test:fail")
      summed.set(file, (summed.get(file) ?? 0) + ms);
  }
  const seconds: Record<string, number> = {};
  for (const file of [...new Set([...whole.keys(), ...summed.keys()])].sort())
    seconds[file] =
      Math.round((whole.get(file) ?? summed.get(file) ?? 0) / 100) / 10;
  yield `${JSON.stringify(seconds, null, 2)}\n`;
}
