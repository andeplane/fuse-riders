import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";
import type { PrivateObjectStorage, StoredObject } from "./storage.js";

export interface StorageAuthorization {
  headers(): Promise<Headers>;
}
export function googleStorageAuthorization(
  auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
  }),
): StorageAuthorization {
  return {
    headers: async () =>
      new Headers(await (await auth.getClient()).getRequestHeaders()),
  };
}
export class GcsPrivateObjectStorage implements PrivateObjectStorage {
  constructor(
    private bucket: string,
    private authorization: StorageAuthorization,
    private request: typeof fetch = fetch,
  ) {
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket))
      throw new Error("Invalid private bucket");
  }
  private url(key: string) {
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`;
  }
  async put(key: string, bytes: Uint8Array, mime: string) {
    const headers = await this.authorization.headers();
    headers.set("Content-Type", mime);
    const response = await this.request(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers,
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (response.status === 412) {
      const current = await this.get(key);
      if (
        !current ||
        current.mime !== mime ||
        !createHash("sha256")
          .update(current.bytes)
          .digest()
          .equals(createHash("sha256").update(bytes).digest())
      )
        throw new Error("Immutable object conflict");
      return { generation: current.generation };
    }
    if (!response.ok)
      throw new Error(`Private object write failed (${response.status})`);
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("generation" in data) ||
      typeof data.generation !== "string"
    )
      throw new Error("Invalid object generation");
    return { generation: data.generation };
  }
  async get(
    key: string,
    generation?: string,
  ): Promise<StoredObject | undefined> {
    const query = generation
        ? `?generation=${encodeURIComponent(generation)}`
        : "",
      headers = await this.authorization.headers();
    const metadata = await this.request(this.url(key) + query, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (metadata.status === 404) return;
    if (!metadata.ok)
      throw new Error(`Private object metadata failed (${metadata.status})`);
    const data: unknown = await metadata.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("generation" in data) ||
      typeof data.generation !== "string" ||
      !("contentType" in data) ||
      typeof data.contentType !== "string" ||
      !("size" in data) ||
      Number(data.size) > 2 * 1024 * 1024
    )
      throw new Error("Invalid private object metadata");
    if (generation && data.generation !== generation)
      throw new Error("Private object generation mismatch");
    const media = await this.request(
      `${this.url(key)}?alt=media&generation=${encodeURIComponent(data.generation)}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    );
    if (media.status === 404) return;
    if (!media.ok)
      throw new Error(`Private object read failed (${media.status})`);
    const bytes = new Uint8Array(await media.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024)
      throw new Error("Private object too large");
    return { generation: data.generation, mime: data.contentType, bytes };
  }
}
