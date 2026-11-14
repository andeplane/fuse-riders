import type {
  RecordingDetail,
  RecordingSummary,
  ReportView,
  SegmentView,
} from "fuse-telemetry/contracts";
import type { Dom } from "./dom.js";
import type { createWorkspaceApi } from "./api.js";
import { timestamp } from "./model.js";

export const utcDate = (value: number): string =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " UTC";

export interface PrivateMedia {
  blob(path: string): Promise<string>;
  error(error: unknown, target: HTMLElement, retry: () => void): void;
  active(): boolean;
  release(url: string): void;
  onDispose(callback: () => void): void;
}

export function createPrivateMedia(
  api: ReturnType<typeof createWorkspaceApi>,
  signal: AbortSignal,
  error: PrivateMedia["error"],
): PrivateMedia {
  const urls = new Set<string>();
  signal.addEventListener(
    "abort",
    () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    },
    { once: true },
  );
  return {
    async blob(path) {
      const blob = await api.blob(path, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const url = URL.createObjectURL(blob);
      urls.add(url);
      return url;
    },
    error,
    active: () => !signal.aborted,
    release(url) {
      URL.revokeObjectURL(url);
      urls.delete(url);
    },
    onDispose(callback) {
      signal.addEventListener("abort", callback, { once: true });
    },
  };
}

export function recordingList(
  dom: Dom,
  recordings: readonly RecordingSummary[],
  open: (id: string) => void,
): HTMLElement {
  const { node, button } = dom;
  const list = node("div", "session-list");
  if (!recordings.length)
    list.append(
      node(
        "p",
        "empty-state",
        "No playtest sessions yet. Developer recordings will appear here after the first saved audio chunk.",
      ),
    );
  for (const recording of recordings) {
    const row = node("article", "session-row");
    const title = button(
      recording.gameId,
      () => open(recording.id),
      "text-button session-title",
    );
    const heading = node("h3");
    heading.append(title);
    row.append(
      heading,
      node("p", "muted", utcDate(recording.startedAt)),
      node("span", `status status-${recording.status}`, recording.status),
      node("span", "number", `${timestamp(recording.durationMs)} saved audio`),
    );
    list.append(row);
  }
  return list;
}

export function reportArticle(
  dom: Dom,
  report: ReportView,
  media: PrivateMedia,
  open: (id: string) => void,
  seek?: (offset: number) => void,
): HTMLElement {
  const { node, button } = dom;
  const article = node("article", "report");
  article.id = `report-${report.id}`;
  const heading = node("div", "report-heading");
  heading.append(
    node("h3", "", `${report.category} · ${report.gameId}`),
    node("span", "muted", utcDate(report.createdAt)),
  );
  article.append(
    heading,
    node("p", "private-copy", report.text || "Screenshot report"),
  );
  const controls = node("div", "inline-controls");
  if (report.offsetMs !== undefined && seek)
    controls.append(
      button(
        `Play at ${timestamp(report.offsetMs)}`,
        () => seek(report.offsetMs!),
        "text-button",
      ),
    );
  if (report.recordingId && !seek)
    controls.append(
      button(
        "Open playtest session",
        () => open(report.recordingId!),
        "text-button",
      ),
    );
  if (!report.recordingId)
    controls.append(node("span", "muted", "Standalone report"));
  if (report.screenshotUrl) {
    const preview = node("div", "screenshot-preview");
    const load = async () => {
      show.disabled = true;
      preview.replaceChildren(
        node("p", "muted", "Loading private screenshot…"),
      );
      try {
        const url = await media.blob(report.screenshotUrl!);
        if (!media.active()) return;
        const image = node("img");
        image.src = url;
        image.alt = `Screenshot attached to ${report.category} report for ${report.gameId}`;
        image.loading = "lazy";
        image.onerror = () => {
          if (!media.active()) return;
          show.disabled = false;
          preview.replaceChildren(
            node(
              "p",
              "error",
              "This screenshot could not be displayed. Try loading it again.",
            ),
          );
          media.release(url);
        };
        preview.replaceChildren(image);
        show.disabled = true;
        show.textContent = "Screenshot loaded";
      } catch (error) {
        if (media.active()) {
          show.disabled = false;
          media.error(error, preview, () => {
            void load();
          });
        }
      }
    };
    const show = button("View screenshot", () => {
      void load();
    });
    controls.append(show);
    article.append(controls, preview);
  } else article.append(controls);
  return article;
}

export function recordingDetail(
  dom: Dom,
  detail: RecordingDetail,
  media: PrivateMedia,
  open: (id: string) => void,
  initialOffset?: number,
): HTMLElement {
  const { node, button } = dom;
  const section = node("section", "recording-detail");
  const recording = detail.recording;
  section.append(
    node("h2", "", recording.gameId),
    node(
      "p",
      "muted",
      `${utcDate(recording.startedAt)} · ${recording.status} · ${timestamp(recording.durationMs)} saved audio`,
    ),
    node(
      "p",
      "muted",
      "Timestamps follow the recording timeline. Transcript timing is accurate to each audio chunk, not to individual words. Refresh to see newly processed chunks.",
    ),
  );
  const playerArea = node("div", "player-area");
  const audio = node("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.setAttribute("aria-label", "Private playtest audio");
  const playerStatus = node(
    "p",
    "muted",
    "Choose a transcript timestamp or report to load its audio chunk.",
  );
  playerStatus.setAttribute("role", "status");
  playerArea.append(audio, playerStatus);
  section.append(playerArea);
  media.onDispose(() => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  });
  let playRequest = 0;
  let activeAudio: string | undefined;
  const seek = (offset: number) => {
    const chunk = detail.segments.find(
      (item) => offset >= item.startMs && offset < item.endMs,
    );
    if (!chunk?.audioUrl) {
      playerStatus.textContent =
        "Audio is unavailable at this timestamp. It may not have uploaded or may have expired.";
      return;
    }
    const current = ++playRequest;
    playerStatus.textContent = `Loading audio at ${timestamp(offset)}…`;
    const load = async () => {
      try {
        const url = await media.blob(chunk.audioUrl!);
        if (!media.active() || current !== playRequest) {
          media.release(url);
          return;
        }
        audio.pause();
        if (activeAudio) media.release(activeAudio);
        activeAudio = url;
        audio.src = url;
        audio.onloadedmetadata = () => {
          if (current !== playRequest) return;
          audio.currentTime = Math.max(0, (offset - chunk.startMs) / 1000);
          void audio.play().catch(() => {
            playerStatus.textContent = "Audio is ready. Press play to listen.";
          });
        };
        audio.onerror = () => {
          playerStatus.textContent =
            "This audio chunk could not be played. Choose another timestamp or refresh.";
        };
        playerStatus.textContent = `Audio chunk ${timestamp(chunk.startMs)}–${timestamp(chunk.endMs)}. Player time is relative to this chunk.`;
      } catch (error) {
        if (media.active() && current === playRequest)
          media.error(error, playerStatus, () => {
            void load();
          });
      }
    };
    void load();
  };
  const timeline = node("ol", "timeline");
  const entries = [
    ...detail.segments.map((segment) => ({ offset: segment.startMs, segment })),
    ...detail.reports.map((report) => ({
      offset: report.offsetMs ?? 0,
      report,
    })),
  ].sort((a, b) => a.offset - b.offset || ("segment" in a ? -1 : 1));
  for (const entry of entries) {
    const li = node("li", "timeline-entry");
    if ("segment" in entry) {
      const segment: SegmentView = entry.segment;
      const heading = node("div", "transcript-heading");
      const play = button(
        `${timestamp(segment.startMs)}–${timestamp(segment.endMs)}`,
        () => seek(segment.startMs),
        "text-button timestamp",
      );
      play.disabled = !segment.audioUrl;
      heading.append(
        play,
        node(
          "span",
          `status status-${segment.status}`,
          segment.status === "complete"
            ? "Transcribed"
            : segment.status === "failed"
              ? "Transcription failed"
              : segment.status === "processing"
                ? "Transcribing"
                : "Queued",
        ),
      );
      li.append(
        heading,
        node(
          "p",
          "private-copy",
          segment.transcript ||
            (segment.status === "complete"
              ? "No speech detected."
              : segment.status === "failed"
                ? "Transcription is unavailable for this chunk. The saved audio can still be played."
                : "Transcript will appear after processing."),
        ),
      );
    } else li.append(reportArticle(dom, entry.report, media, open, seek));
    timeline.append(li);
  }
  section.append(node("h2", "", "Transcript & reports"));
  if (!entries.length)
    section.append(
      node(
        "p",
        "empty-state",
        "No saved audio or reports yet. Refresh after the recording uploads its first chunk.",
      ),
    );
  section.append(timeline);
  if (initialOffset !== undefined) seek(initialOffset);
  return section;
}
