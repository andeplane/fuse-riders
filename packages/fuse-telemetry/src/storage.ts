/** Immutable private objects. A put with an existing key must verify identical bytes. */
export interface StoredObject {
  generation: string;
  bytes: Uint8Array;
  mime: string;
}
export interface PrivateObjectStorage {
  put(
    key: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ generation: string }>;
  get(key: string, generation?: string): Promise<StoredObject | undefined>;
}
