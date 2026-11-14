/** The game boundary releases held keys, pointers and gamepads before a report takes focus. */
export interface PlaytestInput {
  cancel(): void;
}
type Capture = () => Promise<ReadonlyMap<HTMLCanvasElement, string>>;
interface PageState {
  blocked: boolean;
  inputs: Set<PlaytestInput>;
  captures: Set<Capture>;
}
const pages = new WeakMap<Document, PageState>();
function state(document: Document): PageState {
  let value = pages.get(document);
  if (!value) {
    value = { blocked: false, inputs: new Set(), captures: new Set() };
    pages.set(document, value);
  }
  return value;
}
export function registerPlaytestInput(
  document: Document,
  input: PlaytestInput,
): () => void {
  const page = state(document);
  page.inputs.add(input);
  if (page.blocked) input.cancel();
  return () => {
    page.inputs.delete(input);
  };
}
export function playtestInputBlocked(document: Document): boolean {
  return state(document).blocked;
}
export function setPlaytestInputBlocked(
  document: Document,
  blocked: boolean,
): void {
  const page = state(document);
  if (blocked === page.blocked) return;
  page.blocked = blocked;
  // Release again on close: keys held across the dialog never resume themselves.
  for (const input of page.inputs) input.cancel();
}
/** A renderer supplies a real post-render image for canvases whose WebGL drawing buffer is discarded. */
export function registerPlaytestCapture(
  document: Document,
  capture: Capture,
): () => void {
  const captures = state(document).captures;
  captures.add(capture);
  return () => {
    captures.delete(capture);
  };
}
export async function playtestCanvasImages(
  document: Document,
): Promise<Map<HTMLCanvasElement, string>> {
  const images = new Map<HTMLCanvasElement, string>();
  for (const capture of state(document).captures)
    for (const [canvas, image] of await capture())
      if (canvas.isConnected) images.set(canvas, image);
  return images;
}

export function isEditableReportTarget(target: EventTarget | null): boolean {
  return Boolean(
    (target as Element | null)?.closest?.(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
    ),
  );
}
