import { createDialog } from "./dialog.js";
import * as account from "./browser-account.js";
import { createEndpoints } from "fuse-network-fe";
import { PORTAL_GAMES } from "./portal.js";
import type { ReportSubmission } from "fuse-telemetry/contracts";
import { capturePlaytestPage } from "./playtest-capture.js";
import { installPlaytestGameFocus } from "./playtest-focus.js";
import {
  isEditableReportTarget,
  playtestInputBlocked,
  setPlaytestInputBlocked,
} from "./playtest-input.js";
import {
  startPcmMicrophone,
  type MicrophoneCapture,
  type WavSegment,
} from "./playtest-audio.js";
import {
  createRecordingUploader,
  indexedDbPlaytestOutbox,
  type StoredRecording,
  type StoredSegment,
  type PlaytestOutbox,
} from "./playtest-outbox.js";

export interface BrowserPlaytestOptions {
  document: Document;
  window: Window;
  gameId: string;
  base?: string;
  apiOrigin?: string;
  /** FuseOS owns the microphone, while each game's frame owns its report UI. */
  recordingOnly?: boolean;
  /** Browser capabilities supplied by the composition root or typed test adapters. */
  account?: PlaytestAccount;
  outbox?: PlaytestOutbox;
  startMicrophone?: typeof startPcmMicrophone;
  fetch?: typeof fetch;
}
export type PlaytestAccount = Pick<
  typeof account,
  "signedInToken" | "watchAccount" | "accountReady" | "signIn" | "signInFailure"
>;
export interface PlaytestRecordingState {
  available: boolean;
  active: boolean;
  busy: boolean;
}
export interface BrowserPlaytest {
  openReport(): void;
  toggleRecording(): void;
  watchRecording(changed: (state: PlaytestRecordingState) => void): () => void;
}
interface RecordingContext {
  recordingId: string;
  offsetMs: number;
}
const installed = new WeakMap<Document, BrowserPlaytest>();
const INTENT = "fuse-playtest-recording-intent";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function recordingRequested(
  search: string,
  stored: string | null,
): boolean {
  const query = new URLSearchParams(search);
  return query.has("record") || query.has("report") || stored === "1";
}
export function recordingTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function failure(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed. Try again.";
}
class PlaytestRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function validContext(value: unknown): value is RecordingContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<RecordingContext>;
  return (
    typeof context.recordingId === "string" &&
    UUID.test(context.recordingId) &&
    typeof context.offsetMs === "number" &&
    Number.isSafeInteger(context.offsetMs) &&
    context.offsetMs >= 0 &&
    context.offsetMs <= 7200000
  );
}

/** Best-effort shared recording context, never accepting a response from a different origin or window. */
async function parentRecordingContext(
  win: Window,
): Promise<RecordingContext | undefined> {
  if (win.top === win.self || !win.top) return undefined;
  return new Promise((resolve) => {
    const nonce = win.crypto.randomUUID();
    const timeout = win.setTimeout(() => {
      win.removeEventListener("message", received);
      resolve(undefined);
    }, 700);
    function received(event: MessageEvent<unknown>) {
      if (
        event.origin !== win.location.origin ||
        event.source !== win.top ||
        !event.data ||
        typeof event.data !== "object"
      )
        return;
      const data = event.data as {
        type?: unknown;
        nonce?: unknown;
        context?: unknown;
      };
      if (data.type !== "fuse-playtest-context" || data.nonce !== nonce) return;
      win.clearTimeout(timeout);
      win.removeEventListener("message", received);
      resolve(validContext(data.context) ? data.context : undefined);
    }
    win.addEventListener("message", received);
    win.top?.postMessage(
      { type: "fuse-playtest-context-request", nonce },
      win.location.origin,
    );
  });
}

export function installBrowserPlaytest(
  options: BrowserPlaytestOptions,
): BrowserPlaytest {
  const { document: doc, window: win, gameId } = options;
  const previous = installed.get(doc);
  if (previous) return previous;
  const identity = options.account ?? account;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
    const result = doc.createElement(tag);
    result.textContent = text;
    return result;
  };
  const button = (text: string, action: () => void) => {
    const result = node("button", text);
    result.type = "button";
    result.className = "fui-button";
    result.onclick = action;
    return result;
  };
  // Game roots are often replaced during navigation. Keep these overlays alive
  // under the body while opting in to the shared dialog/button styling.
  const overlays = node("div");
  overlays.className = "fui-app";
  overlays.dataset.fuiPlaytest = "overlays";
  overlays.style.display = "contents";
  doc.body.append(overlays);
  const endpoints = createEndpoints(
    {
      basePath: new URL("./", win.location.href).pathname,
      apiOrigin: options.apiOrigin ?? import.meta.env?.VITE_API_ORIGIN,
    },
    win.location.origin,
  );
  const schedule = (run: () => void, ms: number) => {
    const timer = win.setTimeout(run, ms);
    return () => win.clearTimeout(timer);
  };
  async function request(
    path: string,
    init: RequestInit = {},
    authorized = false,
  ): Promise<unknown> {
    const requestGeneration = accessGeneration;
    const headers = new Headers(init.headers);
    if (authorized) {
      const token = await identity.signedInToken();
      if (!token)
        throw new Error(
          "Sign in with an approved developer account to record audio.",
        );
      if (requestGeneration !== accessGeneration)
        throw new Error("Account changed. Retry after sign-in.");
      headers.set("Authorization", `Bearer ${token}`);
    }
    const controller = new AbortController();
    const cancel = schedule(() => controller.abort(), 20000);
    try {
      const response = await (options.fetch ?? win.fetch.bind(win))(
        endpoints.apiUrl(path),
        {
          ...init,
          headers,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        if (
          authorized &&
          requestGeneration === accessGeneration &&
          (response.status === 401 || response.status === 403)
        ) {
          // A resource denial can mean missing audio or a different owner,
          // rather than revoked developer access. Only /me can revoke access.
          if (path !== "/api/dev/me") await checkAccess(requestGeneration);
        }
        if (response.status === 401)
          throw new PlaytestRequestError("Sign in again, then retry.", 401);
        if (response.status === 403)
          throw new PlaytestRequestError(
            "Microphone recording is restricted to approved developer accounts.",
            403,
          );
        if (response.status === 413)
          throw new Error(
            "This attachment is too large. Capture a smaller screenshot and retry.",
          );
        if (response.status === 429)
          throw new Error(
            "The upload limit was reached. Wait a moment, then retry.",
          );
        throw new Error(
          `Could not save (${response.status}). Retry when the service is available.`,
        );
      }
      return response.json();
    } finally {
      cancel();
    }
  }
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let recording: StoredRecording | undefined;
  let microphone: MicrophoneCapture | undefined;
  let stopping: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  let stoppedReason = "";
  let disposed = false;
  let recorderMounted = false;
  let recordingBar: HTMLElement | undefined;
  let beginRecording: (() => Promise<void>) | undefined;
  let endRecording: (() => Promise<void>) | undefined;
  let accessGeneration = 0;
  let signedIn = false;
  let approvedUid: string | undefined;
  let accessCheck: { generation: number; promise: Promise<void> } | undefined;
  let retryUploads: (() => void) | undefined;
  let recordingState: PlaytestRecordingState = {
    available: false,
    active: false,
    busy: false,
  };
  const recordingListeners = new Set<(state: PlaytestRecordingState) => void>();
  function publishRecording(change: Partial<PlaytestRecordingState>) {
    recordingState = { ...recordingState, ...change };
    for (const changed of recordingListeners) changed({ ...recordingState });
    if (ownsMicrophone)
      for (const frame of doc.querySelectorAll("iframe"))
        frame.contentWindow?.postMessage(
          { type: "fuse-playtest-recording-state", state: recordingState },
          win.location.origin,
        );
  }
  function revokeAccess(generation: number) {
    if (disposed || generation !== accessGeneration) return;
    accessGeneration++;
    approvedUid = undefined;
    publishRecording({ available: false });
    stoppedReason = "Developer access expired. Recording stopped.";
    void endRecording?.();
  }
  function checkAccess(generation = accessGeneration): Promise<void> {
    if (disposed || !signedIn || generation !== accessGeneration)
      return Promise.resolve();
    if (accessCheck?.generation === generation) return accessCheck.promise;
    const promise = request("/api/dev/me", {}, true)
      .then((value) => {
        if (disposed || generation !== accessGeneration) return;
        const principal = object(value);
        if (
          typeof principal.uid !== "string" ||
          !principal.uid ||
          typeof principal.email !== "string" ||
          !principal.email
        ) {
          revokeAccess(generation);
          return;
        }
        approvedUid = principal.uid;
        publishRecording({ available: true });
        retryUploads?.();
      })
      .catch((error: unknown) => {
        if (
          error instanceof PlaytestRequestError &&
          (error.status === 401 || error.status === 403)
        )
          revokeAccess(generation);
        // Network/server failures retain current approval and retry on online.
      })
      .finally(() => {
        if (accessCheck?.generation === generation) accessCheck = undefined;
      });
    accessCheck = { generation, promise };
    return promise;
  }
  const context = (): RecordingContext | undefined =>
    recording && microphone
      ? { recordingId: recording.id, offsetMs: microphone.offsetMs() }
      : undefined;
  const ownsMicrophone = win.top === win.self;
  const focus = installPlaytestGameFocus({
    document: doc,
    window: win,
    gameId,
    knownGames: new Set([
      gameId,
      "dice",
      ...PORTAL_GAMES.map((game) => game.id),
    ]),
    changed: () => undefined,
  });

  // Only the top page responds; report text and audio never travel over this bridge.
  if (ownsMicrophone)
    win.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (
        event.origin !== win.location.origin ||
        !event.source ||
        !event.data ||
        typeof event.data !== "object"
      )
        return;
      const data = event.data as { type?: unknown; nonce?: unknown };
      const knownFrame = [...doc.querySelectorAll("iframe")].some(
        (frame) => frame.contentWindow === event.source,
      );
      if (!knownFrame) return;
      if (data.type === "fuse-playtest-recording-state-request") {
        (event.source as Window).postMessage(
          { type: "fuse-playtest-recording-state", state: recordingState },
          win.location.origin,
        );
        return;
      }
      if (data.type === "fuse-playtest-recording-toggle") {
        toggleRecording();
        return;
      }
      if (data.type === "fuse-playtest-recording-request") {
        try {
          win.sessionStorage.setItem(INTENT, "1");
        } catch {
          /* This prompt still requires explicit consent. */
        }
        mountRecording();
        return;
      }
      if (
        data.type !== "fuse-playtest-context-request" ||
        typeof data.nonce !== "string" ||
        !UUID.test(data.nonce)
      )
        return;
      (event.source as Window).postMessage(
        {
          type: "fuse-playtest-context",
          nonce: data.nonce,
          context: context(),
        },
        win.location.origin,
      );
    });
  else
    win.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.origin !== win.location.origin || event.source !== win.top)
        return;
      const data = object(event.data);
      const state = object(data.state);
      if (
        data.type === "fuse-playtest-recording-state" &&
        typeof state.available === "boolean" &&
        typeof state.active === "boolean" &&
        typeof state.busy === "boolean"
      )
        publishRecording({
          available: state.available,
          active: state.active,
          busy: state.busy,
        });
    });

  // Reporting remains available even when microphone APIs, authentication or durable browser storage are absent.
  const shell = createDialog({
    title: "Report",
    document: doc,
    closeOnBackdrop: false,
  });
  shell.dialog.classList.add("fui-playtest-report");
  shell.dialog.dataset.fuiPlaytest = "report";
  const form = node("form"),
    preview = node("img");
  preview.alt = "Screenshot attached to this report";
  preview.className = "fui-playtest-preview";
  const captureStatus = node("p"),
    retryCapture = button("Retry screenshot", () => {
      void screenshot();
    });
  const screenshotActions = node("div");
  screenshotActions.className = "fui-playtest-actions";
  screenshotActions.append(retryCapture);
  const categoryLabel = node("label", "Category"),
    category = node("select");
  category.name = "category";
  for (const [value, label] of [
    ["bug", "Bug"],
    ["feature", "Feature"],
    ["idea", "Idea"],
    ["other", "Other"],
  ]) {
    const option = node("option", label);
    option.value = value ?? "other";
    category.append(option);
  }
  categoryLabel.append(category);
  const textLabel = node("label", "What happened, or what would you change?"),
    text = node("textarea");
  text.name = "text";
  text.required = true;
  text.maxLength = 8000;
  text.rows = 5;
  textLabel.append(text);
  const timeline = node("p"),
    result = node("p");
  result.setAttribute("role", "status");
  const send = node("button", "Send report");
  send.type = "submit";
  send.className = "fui-button fui-button-primary";
  form.append(
    preview,
    captureStatus,
    screenshotActions,
    categoryLabel,
    textLabel,
    timeline,
    result,
    send,
  );
  shell.body.append(form);
  let opening = false,
    sending = false,
    capturing = false,
    screenshotData: string | undefined;
  let reportId = "",
    reportCreatedAt = 0,
    reportContext: RecordingContext | undefined;
  let reportPayload: ReportSubmission | undefined;
  function updateSend() {
    send.disabled = sending || !screenshotData || opening;
  }
  async function screenshot() {
    capturing = true;
    screenshotData = undefined;
    preview.hidden = true;
    retryCapture.disabled = true;
    captureStatus.textContent = "Capturing screenshot…";
    updateSend();
    const wasOpen = shell.dialog.open;
    if (wasOpen) shell.dialog.close();
    // Retrying also freezes gameplay input until the dialog has reopened.
    setPlaytestInputBlocked(doc, true);
    try {
      screenshotData = await capturePlaytestPage(doc);
      preview.src = screenshotData;
      preview.hidden = false;
      captureStatus.textContent =
        "This screenshot will be sent with your report.";
    } catch (error) {
      captureStatus.textContent = `Screenshot failed. ${failure(error)}`;
    } finally {
      retryCapture.disabled = false;
      if (wasOpen && !disposed && !shell.dialog.open) shell.dialog.showModal();
      capturing = false;
      updateSend();
    }
  }
  shell.dialog.addEventListener("close", () => {
    if (!opening && !capturing && !shell.dialog.open)
      setPlaytestInputBlocked(doc, false);
  });
  async function openReport() {
    if (opening || shell.dialog.open || options.recordingOnly) return;
    opening = true;
    reportId = win.crypto.randomUUID();
    reportCreatedAt = Date.now();
    reportPayload = undefined;
    reportContext = context();
    text.value = "";
    category.value = "bug";
    result.textContent = "";
    sending = false;
    text.disabled = false;
    category.disabled = false;
    retryCapture.disabled = false;
    send.textContent = "Send report";
    setPlaytestInputBlocked(doc, true);
    const parentContext = ownsMicrophone
      ? Promise.resolve(undefined)
      : parentRecordingContext(win);
    await screenshot();
    reportContext ??= await parentContext;
    timeline.textContent = reportContext
      ? `Recording timestamp: ${recordingTime(reportContext.offsetMs)}`
      : "No microphone recording attached.";
    opening = false;
    updateSend();
    if (!disposed) {
      shell.dialog.showModal();
      text.focus();
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sending || !screenshotData || !text.value.trim()) return;
    sending = true;
    shell.back.disabled = true;
    result.textContent = "Saving report…";
    updateSend();
    // An ambiguous response retries the exact same immutable report, rather than creating duplicates.
    reportPayload ??= {
      id: reportId,
      gameId,
      category:
        category.value === "feature" ||
        category.value === "idea" ||
        category.value === "other"
          ? category.value
          : "bug",
      text: text.value.trim(),
      createdAt: reportCreatedAt,
      screenshot: {
        mime: "image/jpeg",
        base64: screenshotData.slice(screenshotData.indexOf(",") + 1),
      },
      ...reportContext,
    };
    text.disabled = true;
    category.disabled = true;
    retryCapture.disabled = true;
    void request(
      "/api/telemetry/reports",
      json(reportPayload),
      Boolean(reportContext),
    )
      .then((acknowledgement) => {
        const ack = object(acknowledgement);
        if (
          ack.id !== reportId ||
          typeof ack.receivedAt !== "number" ||
          !Number.isFinite(ack.receivedAt)
        )
          throw new Error(
            "The service did not confirm the report. Retry to check it was saved.",
          );
        result.textContent = "Report saved. Thank you.";
        send.textContent = "Saved";
        sending = false;
      })
      .catch((error: unknown) => {
        result.textContent = `${failure(error)} Your report is still here; press Send report to retry.`;
        sending = false;
        updateSend();
      })
      .finally(() => {
        shell.back.disabled = false;
      });
  });
  shell.dialog.addEventListener("cancel", (event) => {
    if (sending) event.preventDefault();
  });
  if (!options.recordingOnly) {
    overlays.append(shell.dialog);
    doc.addEventListener(
      "keydown",
      (event) => {
        if (
          event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.repeat &&
          event.key.toLowerCase() === "x" &&
          !isEditableReportTarget(event.target)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void openReport();
        }
      },
      true,
    );
    // Native dialog controls retain their keys; events reaching the game while capture is pending are blocked.
    doc.addEventListener(
      "keydown",
      (event) => {
        if (
          playtestInputBlocked(doc) &&
          !shell.dialog.contains(event.target as Node)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  }

  const api = {
    openReport: () => {
      void openReport();
    },
    toggleRecording,
    watchRecording(changed: (state: PlaytestRecordingState) => void) {
      recordingListeners.add(changed);
      changed({ ...recordingState });
      return () => {
        recordingListeners.delete(changed);
      };
    },
  };
  installed.set(doc, api);
  if (ownsMicrophone) {
    // Guests never load the sign-in SDK or make a developer-access request.
    // Every account transition invalidates outstanding checks and any active capture.
    identity.watchAccount((user) => {
      const generation = ++accessGeneration;
      signedIn = Boolean(user);
      approvedUid = undefined;
      publishRecording({ available: false });
      if (microphone || recordingState.busy) {
        stoppedReason = "Account changed. Recording stopped.";
        void endRecording?.();
      }
      if (!user) return;
      void checkAccess(generation);
    });
    win.addEventListener("online", () => {
      void checkAccess();
    });
    let stored: string | null = null;
    try {
      stored = win.sessionStorage.getItem(INTENT);
    } catch {
      /* An explicit URL still works when session storage is refused. */
    }
    const intent = recordingRequested(win.location.search, stored);
    if (intent) {
      try {
        win.sessionStorage.setItem(INTENT, "1");
      } catch {
        /* Keep this page's explicit opt-in. */
      }
      mountRecording();
    } else if (win.indexedDB) {
      // Upload recovery is independent of whether the recording prompt was dismissed.
      void indexedDbPlaytestOutbox(win.indexedDB)
        .list()
        .then((items) => {
          if (
            !disposed &&
            items.some(
              (item) =>
                item.kind === "segment" ||
                (item.kind === "recording" && item.finished),
            )
          )
            mountRecording();
        })
        .catch(() => undefined);
    }
  } else {
    win.top?.postMessage(
      { type: "fuse-playtest-recording-state-request" },
      win.location.origin,
    );
    if (recordingRequested(win.location.search, null)) {
      // An embedded game can request the visible prompt, but only its desktop may own the microphone.
      win.top?.postMessage(
        { type: "fuse-playtest-recording-request" },
        win.location.origin,
      );
    }
  }
  function toggleRecording() {
    if (disposed || !recordingState.available || recordingState.busy) return;
    if (!ownsMicrophone) {
      win.top?.postMessage(
        { type: "fuse-playtest-recording-toggle" },
        win.location.origin,
      );
      return;
    }
    mountRecording();
    if (microphone) void endRecording?.();
    else void beginRecording?.();
  }
  function mountRecording() {
    if (disposed) return;
    if (recorderMounted) {
      if (recordingBar && !recordingBar.isConnected)
        overlays.append(recordingBar);
      return;
    }
    recorderMounted = true;
    const bar = node("section");
    recordingBar = bar;
    bar.className = "fui-playtest-recording";
    bar.dataset.fuiPlaytest = "recording";
    bar.setAttribute("aria-label", "Developer microphone recording");
    const title = node("strong", "Microphone recording"),
      status = node(
        "p",
        "Only approved developers can record. Audio is saved in short chunks.",
      ),
      detail = node("p");
    status.setAttribute("role", "status");
    detail.textContent =
      "Saved uploads survive closing this page. Queued audio retries when you return; an unfinished chunk may be lost.";
    const controls = node("div");
    controls.className = "fui-playtest-actions";
    const signIn = button("Sign in", () => {
      void identity.signIn().catch((error: unknown) => {
        status.textContent =
          identity.signInFailure(error) || "Sign-in cancelled.";
      });
    });
    signIn.disabled = true;
    const start = button("Start recording", () => {
      void begin();
    });
    const stop = button("Stop recording", () => {
      void stopRecording();
    });
    stop.hidden = true;
    const retry = button("Retry uploads", () => {
      void uploader.kick();
    });
    const dismiss = button("Dismiss", () => {
      if (microphone) return;
      try {
        win.sessionStorage.removeItem(INTENT);
      } catch {
        /* No persistent intent to clear. */
      }
      bar.remove();
    });
    controls.append(signIn, start, stop, retry, dismiss);
    bar.append(title, status, detail, controls);
    overlays.append(bar);
    void identity
      .accountReady()
      .then(() => {
        signIn.disabled = false;
      })
      .catch(() => {
        status.textContent =
          "Sign-in could not load. Reload the page to retry.";
      });
    identity.watchAccount((user) => {
      signIn.textContent = user ? `Signed in: ${user.name}` : "Sign in";
      if (!user && microphone) {
        stoppedReason =
          "Signed out. Recording stopped; sign in to retry pending audio.";
        void stopRecording();
      }
    });
    const store =
      options.outbox ??
      (win.indexedDB ? indexedDbPlaytestOutbox(win.indexedDB) : undefined);
    if (!store) {
      status.textContent =
        "Durable browser storage is unavailable. Recording is disabled.";
      start.disabled = true;
      retry.disabled = true;
      return;
    }
    let uploadStatus = {
      pending: 0,
      savedMs: 0,
      error: undefined as string | undefined,
    };
    const render = () => {
      bar.dataset.recording = String(Boolean(microphone));
      const elapsed =
        microphone?.offsetMs() ?? recording?.savedMs ?? uploadStatus.savedMs;
      title.textContent = microphone
        ? `Recording microphone · ${recordingTime(elapsed)}`
        : "Microphone recording";
      status.textContent = [
        stoppedReason || (microphone ? "Recording" : "Ready when you are."),
        `Saved through ${recordingTime(recording?.savedMs ?? uploadStatus.savedMs)}.`,
        `${uploadStatus.pending} pending upload${uploadStatus.pending === 1 ? "" : "s"}.`,
        uploadStatus.error ?? "",
      ]
        .filter(Boolean)
        .join(" ");
    };
    const uploader = createRecordingUploader({
      store,
      ownerUid: () => approvedUid,
      schedule,
      upload: {
        async segment(session, segment) {
          const acknowledgement = object(
            await request(
              `/api/telemetry/recordings/${session.id}/segments/${segment.sequence}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "audio/wav",
                  "X-Recording-Start-Ms": String(segment.startMs),
                  "X-Recording-Game-Id": segment.gameId ?? session.gameId,
                },
                body: segment.blob,
              },
              true,
            ),
          );
          if (
            acknowledgement.saved !== true ||
            acknowledgement.sequence !== segment.sequence ||
            acknowledgement.startMs !== segment.startMs ||
            acknowledgement.endMs !== segment.endMs
          )
            throw new Error(
              "The service did not confirm this audio chunk. Retry uploads.",
            );
          if (recording?.id === session.id)
            recording.savedMs = Math.max(recording.savedMs, segment.endMs);
        },
        async finish(session) {
          const acknowledgement = object(
            await request(
              `/api/telemetry/recordings/${session.id}/finish`,
              json({}),
              true,
            ),
          );
          const saved = object(acknowledgement.recording);
          if (saved.id !== session.id || saved.status !== "finished")
            throw new Error(
              "The service did not confirm recording completion. Retry uploads.",
            );
        },
      },
      changed(state) {
        uploadStatus = { ...state, error: state.error };
        render();
      },
    });
    retryUploads = () => {
      void uploader.kick();
    };
    void uploader.kick();
    let captureStorageFailed = false;
    function received(chunk: WavSegment) {
      const session = recording;
      if (!session || captureStorageFailed) return;
      const segment: StoredSegment = {
        ...chunk,
        kind: "segment",
        key: `${session.id}:${chunk.sequence}`,
        recordingId: session.id,
      };
      writes = writes
        .then(async () => {
          if (captureStorageFailed) return;
          await store!.put(segment);
          void uploader.kick();
        })
        .catch((error: unknown) => {
          captureStorageFailed = true;
          stoppedReason = `${failure(error)} The latest unsaved audio could not be retained.`;
          void stopRecording();
          render();
        });
    }
    async function begin() {
      if (microphone || start.disabled || stopping) return;
      const generation = accessGeneration;
      publishRecording({ busy: true });
      captureStorageFailed = false;
      start.disabled = true;
      signIn.disabled = true;
      dismiss.disabled = true;
      stoppedReason = "Checking developer access…";
      render();
      const session: StoredRecording = {
        kind: "recording",
        key: win.crypto.randomUUID(),
        id: "",
        ownerUid: approvedUid ?? "",
        gameId,
        startedAt: Date.now(),
        savedMs: 0,
        finished: false,
      };
      session.id = session.key;
      try {
        if (!session.ownerUid)
          throw new Error(
            "Sign in with an approved developer account to record audio.",
          );
        // Authorization succeeds before the microphone is touched; a query flag cannot grant recording access.
        const acknowledgement = object(
          await request(
            "/api/telemetry/recordings",
            json({ id: session.id, gameId, startedAt: session.startedAt }),
            true,
          ),
        );
        if (object(acknowledgement.recording).id !== session.id)
          throw new Error(
            "The service did not authorize this recording. Retry before allowing the microphone.",
          );
        if (disposed || generation !== accessGeneration)
          throw new Error(
            "Account changed. Start recording again after sign-in.",
          );
        await store!.put(session);
        recording = session;
        if (disposed || generation !== accessGeneration)
          throw new Error(
            "Account changed. Start recording again after sign-in.",
          );
        stoppedReason = "Allow microphone access to begin.";
        render();
        microphone = await (options.startMicrophone ?? startPcmMicrophone)(
          {
            getUserMedia: (constraints) =>
              win.navigator.mediaDevices.getUserMedia(constraints),
            createContext: () => new AudioContext({ sampleRate: 24000 }),
            createNode: (context, name) => new AudioWorkletNode(context, name),
            connect(context, node, stream) {
              const source = context.createMediaStreamSource(stream);
              source.connect(node);
              node.connect(context.destination);
              return source;
            },
            createUrl: (blob) => URL.createObjectURL(blob),
            revokeUrl: (url) => URL.revokeObjectURL(url),
            schedule,
          },
          received,
          (reason) => {
            stoppedReason = reason;
            void stopRecording();
          },
          focus,
        );
        if (disposed || generation !== accessGeneration) {
          await stopRecording();
          return;
        }
        stoppedReason = "";
        stop.hidden = false;
        start.hidden = true;
      } catch (error) {
        stoppedReason =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow it in browser settings and try again."
            : failure(error);
        if (recording?.id === session.id) {
          session.finished = true;
          await store!.put(session).catch(() => undefined);
          void uploader.kick();
        }
      } finally {
        start.disabled = false;
        signIn.disabled = false;
        dismiss.disabled = Boolean(microphone);
        publishRecording({ active: Boolean(microphone), busy: false });
        render();
      }
    }
    function stopRecording(): Promise<void> {
      if (stopping) return stopping;
      const capture = microphone;
      if (!capture) return Promise.resolve();
      stop.disabled = true;
      publishRecording({ busy: true });
      stopping = (async () => {
        await capture.stop();
        microphone = undefined;
        await writes;
        if (recording) {
          recording = await store!.updateRecording(
            recording.key,
            (current) => ({ ...current, finished: true }),
          );
        }
        void uploader.kick();
        stop.hidden = true;
        start.hidden = false;
        dismiss.disabled = false;
        if (!stoppedReason) stoppedReason = "Recording stopped.";
      })()
        .catch((error: unknown) => {
          stoppedReason = failure(error);
        })
        .finally(() => {
          stopping = undefined;
          stop.disabled = false;
          publishRecording({ active: Boolean(microphone), busy: false });
          render();
        });
      return stopping;
    }
    beginRecording = begin;
    endRecording = stopRecording;
    const refresh = win.setInterval(render, 1000);
    win.addEventListener("online", () => {
      void uploader.kick();
    });
    win.addEventListener("pagehide", () => {
      win.clearInterval(refresh);
      void stopRecording();
      uploader.dispose();
    });
  }
  win.addEventListener("pagehide", () => {
    disposed = true;
  });
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) win.location.reload();
  });
  return api;
}

/** The shared header calls this once; tests without real browser surfaces still render a functional Report button. */
export function browserPlaytestFor(
  document: Document,
  gameId: string,
): BrowserPlaytest | undefined {
  const win = document.defaultView;
  if (
    !win?.location?.href ||
    !win.crypto?.randomUUID ||
    typeof win.fetch !== "function"
  )
    return undefined;
  return installBrowserPlaytest({ document, window: win, gameId });
}
