export interface GoldenHashes {
  rules: string;
  hashes: readonly string[];
}

/** An expected-data update must not bless a missed simulation-rules bump. */
export function validateGoldenUpdate(
  previous: GoldenHashes,
  next: GoldenHashes,
  recordingChanged = false,
): void {
  if (previous.rules !== next.rules) return;
  const hashesChanged =
    previous.hashes.length !== next.hashes.length ||
    previous.hashes.some((hash, index) => hash !== next.hashes[index]);
  if (hashesChanged || recordingChanged)
    throw new Error(
      `Refusing to update the golden or recording under unchanged RULES (${next.rules}). Preserve the baseline for refactors, or bump RULES for intended simulation/workload changes.`,
    );
}
