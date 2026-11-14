import type { PaintFileDeps } from "../paint/paintFiles";

/** A file picker, download sink and image fetcher that never touch the browser: tests script what each answers. */
export class FakePaintFileDeps implements PaintFileDeps {
  /** What the next `pickImage` resolves with; undefined is the user cancelling. */
  nextPick: File | undefined;
  /** Every download handed over, in order. */
  downloads: { blob: Blob; name: string }[] = [];
  /** Every URL fetched, in order. */
  fetched: string[] = [];
  /** The blob each URL answers with; a missing URL rejects like a 404 would. */
  images = new Map<string, Blob>();
  /** Opens every pick with this error instead, when set. */
  pickError: Error | undefined;

  pickImage(): Promise<File | undefined> {
    if (this.pickError) return Promise.reject(this.pickError);
    const file = this.nextPick;
    this.nextPick = undefined;
    return Promise.resolve(file);
  }

  download(blob: Blob, name: string): void {
    this.downloads.push({ blob, name });
  }

  fetchImage(url: string): Promise<Blob> {
    this.fetched.push(url);
    const blob = this.images.get(url);
    return blob
      ? Promise.resolve(blob)
      : Promise.reject(new Error("The server answered 404"));
  }
}
