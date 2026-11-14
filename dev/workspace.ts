import type {
  MetricsResponse,
  MetricsPeriod,
  RecordingsPage,
  ReportsPage,
  RecordingDetail,
  ReportView,
} from "fuse-telemetry/contracts";
import type { ActionsPage } from "../packages/fuse-telemetry/src/action-contracts.js";
import {
  createWorkspaceApi,
  WorkspaceError,
  type WorkspaceTransport,
} from "./api.js";
import { createDom } from "./dom.js";
import { defaultDateRange } from "./model.js";
import { metricsQuery, renderMetrics, type MetricsFilters } from "./metrics.js";
import {
  createPrivateMedia,
  recordingDetail,
  recordingList,
  reportArticle,
  type PrivateMedia,
} from "./sessions.js";
import {
  actionStatuses,
  renderActions,
  tokenTools,
  type MintedToken,
} from "./actions.js";

export interface WorkspaceAccount {
  ready(): Promise<void>;
  watch(listener: (account: { name: string } | undefined) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  failure(error: unknown): string;
}
export interface WorkspaceDependencies {
  document: Document;
  account: WorkspaceAccount;
  transport: WorkspaceTransport;
  now(): Date;
  gamesUrl: string;
}
type View = "metrics" | "sessions" | "reports" | "actions";

export function mountWorkspace(
  root: HTMLElement,
  deps: WorkspaceDependencies,
): () => void {
  const dom = createDom(deps.document);
  const { node, button, select, field } = dom;
  const api = createWorkspaceApi(deps.transport);
  const header = node("header", "workspace-header");
  const brand = node("a", "brand", "FUSE GAMES");
  brand.href = deps.gamesUrl;
  const title = node("h1", "", "Developer workspace");
  const identity = node("div", "identity");
  header.append(brand, title, identity);
  const main = node("main", "workspace");
  main.id = "workspace";
  main.tabIndex = -1;
  root.replaceChildren(header, main);
  const filters: MetricsFilters = {
    period: "day",
    ...defaultDateRange(deps.now()),
    gameId: "",
  };
  let current: View = "metrics";
  let controller = new AbortController();
  let disposed = false;
  let loginReady = false;
  let accountName = "";
  let selectedRecording: string | undefined;
  let selectedReport: string | undefined;
  let selectedOffset: number | undefined;
  let actionStatus = "";
  let actionGame = "";
  let cursor: string | undefined;
  const tokens: MintedToken[] = [];
  let navigation: HTMLElement;
  let content: HTMLElement;
  let toolbar: HTMLElement;

  const cancel = () => {
    controller.abort();
    controller = new AbortController();
    return controller.signal;
  };
  const isCurrent = (signal: AbortSignal) => !disposed && !signal.aborted;
  function failure(error: unknown, target: HTMLElement, retry: () => void) {
    const message =
      error instanceof WorkspaceError
        ? error.message
        : "Could not connect to the developer service. Check your connection and retry.";
    const notice = node("div", "notice error");
    notice.setAttribute("role", "alert");
    notice.append(node("p", "", message), button("Retry", retry));
    if (
      error instanceof WorkspaceError &&
      (error.status === 401 || error.status === 403)
    ) {
      notice.append(
        button("Use another Google account", () => {
          void deps.account
            .signOut()
            .catch(() =>
              signedOut("Could not sign out. Retry from this browser."),
            );
        }),
      );
    }
    target.replaceChildren(notice);
  }
  function signedOut(message = "") {
    cancel();
    tokens.length = 0;
    identity.replaceChildren();
    const panel = node("section", "auth-panel");
    panel.append(
      node("h2", "", "Sign in to continue"),
      node(
        "p",
        "",
        "Metrics, playtest recordings and reports are private. Sign in with an approved developer Google account.",
      ),
    );
    const signIn = button(
      loginReady ? "Sign in with Google" : "Preparing Google sign-in…",
      () => {
        signIn.disabled = true;
        void deps.account.signIn().catch((error) => {
          const reason = deps.account.failure(error);
          signedOut(reason);
        });
      },
      "primary",
    );
    signIn.disabled = !loginReady;
    panel.append(signIn);
    if (message) {
      const notice = node("p", "error", message);
      notice.setAttribute("role", "alert");
      panel.append(notice);
    }
    panel.append(
      node(
        "p",
        "muted",
        "Access is verified by the server. Signing in alone does not grant developer access.",
      ),
    );
    main.replaceChildren(panel);
  }
  function shell() {
    identity.replaceChildren(
      node("span", "", accountName),
      button("Sign out", () => {
        void deps.account
          .signOut()
          .catch((error) => failure(error, content, () => shell()));
      }),
    );
    navigation = node("nav", "workspace-nav");
    navigation.setAttribute("aria-label", "Developer sections");
    for (const [id, text] of [
      ["metrics", "Metrics"],
      ["sessions", "Playtest sessions"],
      ["reports", "Reports"],
      ["actions", "Action proposals"],
    ] as const) {
      const tab = button(text, () => {
        current = id;
        selectedRecording = undefined;
        selectedReport = undefined;
        selectedOffset = undefined;
        cursor = undefined;
        shell();
        void load();
      });
      tab.setAttribute("aria-current", current === id ? "page" : "false");
      navigation.append(tab);
    }
    toolbar = node("div", "toolbar");
    content = node("div", "view-content");
    content.setAttribute("aria-live", "polite");
    content.setAttribute("aria-atomic", "false");
    main.replaceChildren(navigation, toolbar, content);
    buildToolbar();
  }
  function buildToolbar() {
    toolbar.replaceChildren();
    const form = node("form", "filters");
    if (current === "metrics") {
      const period = select(
        [
          ["day", "Daily"],
          ["week", "Weekly"],
          ["month", "Monthly"],
        ],
        filters.period,
      );
      const from = node("input");
      from.type = "date";
      from.value = filters.from;
      from.required = true;
      const to = node("input");
      to.type = "date";
      to.value = filters.to;
      to.required = true;
      const game = node("input");
      game.type = "search";
      game.value = filters.gameId;
      game.placeholder = "All games";
      form.append(
        field("Period", period),
        field("From · UTC", from),
        field("To · UTC", to),
        field("Game ID", game),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (from.value > to.value) {
          to.setCustomValidity(
            "Choose an end date on or after the start date.",
          );
          to.reportValidity();
          return;
        }
        to.setCustomValidity("");
        filters.period = period.value as MetricsPeriod;
        filters.from = from.value;
        filters.to = to.value;
        filters.gameId = game.value.trim();
        void load();
      });
      to.addEventListener("input", () => to.setCustomValidity(""));
      from.addEventListener("input", () => to.setCustomValidity(""));
    } else if (current === "actions") {
      const status = select(actionStatuses, actionStatus);
      const game = node("input");
      game.type = "search";
      game.value = actionGame;
      game.placeholder = "All games";
      form.append(field("Status", status), field("Game ID", game));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        actionStatus = status.value;
        actionGame = game.value.trim();
        cursor = undefined;
        void load();
      });
    } else {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void load();
      });
      if (selectedRecording)
        form.append(
          button(
            "Back to sessions",
            () => {
              selectedRecording = undefined;
              selectedReport = undefined;
              selectedOffset = undefined;
              buildToolbar();
              void load();
            },
            "text-button",
          ),
        );
      form.append(
        node(
          "h2",
          "view-title",
          selectedRecording
            ? "Playtest session"
            : current === "sessions"
              ? "Playtest sessions"
              : "All reports",
        ),
      );
    }
    const apply = node(
      "button",
      "primary",
      current === "metrics" || current === "actions"
        ? "Apply filters"
        : "Refresh",
    );
    apply.type = "submit";
    form.append(apply);
    if (current === "metrics" || current === "actions")
      form.append(
        button("Refresh", () => {
          void load();
        }),
      );
    toolbar.append(form);
  }
  function openRecording(id: string, reportId?: string, offsetMs?: number) {
    current = "sessions";
    selectedRecording = id;
    selectedReport = reportId;
    selectedOffset = offsetMs;
    cursor = undefined;
    shell();
    void load();
  }
  function pagination(nextCursor: string | undefined) {
    if (!cursor && !nextCursor) return;
    const controls = node("div", "pagination");
    if (cursor)
      controls.append(
        button("First page", () => {
          cursor = undefined;
          void load();
        }),
      );
    if (nextCursor)
      controls.append(
        button("Next page", () => {
          cursor = nextCursor;
          void load();
        }),
      );
    content.append(controls);
  }
  function showRecording(
    data: RecordingDetail,
    signal: AbortSignal,
    media: PrivateMedia,
  ) {
    for (const audio of content.querySelectorAll("audio")) audio.pause();
    content.replaceChildren(
      recordingDetail(dom, data, media, openRecording, selectedOffset),
    );
    selectedOffset = undefined;
    if (data.reportsNextCursor) {
      const nextArea = node("div", "pagination");
      const more = button("Load more reports in this session", () => {
        more.disabled = true;
        const query = new URLSearchParams({
          recordingId: data.recording.id,
          cursor: data.reportsNextCursor!,
          limit: "50",
        });
        void api
          .json<ReportsPage>(`/api/dev/reports?${query}`, signal)
          .then((page) => {
            if (!isCurrent(signal)) return;
            const reports = [
              ...new Map(
                [...data.reports, ...page.reports].map((report) => [
                  report.id,
                  report,
                ]),
              ).values(),
            ];
            showRecording(
              { ...data, reports, reportsNextCursor: page.nextCursor },
              signal,
              media,
            );
          })
          .catch((error) => {
            if (isCurrent(signal))
              failure(error, nextArea, () => {
                more.disabled = false;
                nextArea.replaceChildren(more);
              });
          });
      });
      nextArea.append(more);
      content.append(nextArea);
    }
    if (selectedReport) {
      const target = deps.document.getElementById(`report-${selectedReport}`);
      if (target) {
        target.tabIndex = -1;
        target.focus();
        target.scrollIntoView?.({ block: "center" });
      } else
        content.prepend(
          node(
            "p",
            "notice",
            "The linked report is not on this page. Load more reports in this session to find it, or check All reports if it has expired.",
          ),
        );
    }
  }
  async function load() {
    const signal = cancel();
    content.replaceChildren(
      node("p", "loading-state", "Loading private data…"),
    );
    content.setAttribute("aria-busy", "true");
    const media = createPrivateMedia(api, signal, failure);
    try {
      if (current === "metrics") {
        const data = await api.json<MetricsResponse>(
          metricsQuery(filters),
          signal,
        );
        if (!isCurrent(signal)) return;
        content.replaceChildren(
          renderMetrics(dom, data, (gameId) => {
            filters.gameId = gameId;
            buildToolbar();
            void load();
          }),
        );
        if (filters.gameId)
          content.prepend(
            button(
              "Show all games",
              () => {
                filters.gameId = "";
                buildToolbar();
                void load();
              },
              "text-button",
            ),
          );
      } else if (selectedRecording) {
        const data = await api.json<RecordingDetail>(
          `/api/dev/recordings/${encodeURIComponent(selectedRecording)}`,
          signal,
        );
        if (
          selectedReport &&
          !data.reports.some((report) => report.id === selectedReport)
        ) {
          try {
            const result = await api.json<{ report: ReportView }>(
              `/api/dev/reports/${encodeURIComponent(selectedReport)}`,
              signal,
            );
            if (result.report.recordingId === data.recording.id)
              data.reports.push(result.report);
          } catch (error) {
            if (!(error instanceof WorkspaceError && error.status === 404))
              throw error;
          }
        }
        if (!isCurrent(signal)) return;
        showRecording(data, signal, media);
      } else if (current === "sessions") {
        const query = new URLSearchParams({ limit: "25" });
        if (cursor) query.set("cursor", cursor);
        const data = await api.json<RecordingsPage>(
          `/api/dev/recordings?${query}`,
          signal,
        );
        if (!isCurrent(signal)) return;
        content.replaceChildren(
          recordingList(dom, data.recordings, openRecording),
        );
        pagination(data.nextCursor);
      } else if (current === "reports") {
        const query = new URLSearchParams({ limit: "25" });
        if (cursor) query.set("cursor", cursor);
        const data = await api.json<ReportsPage>(
          `/api/dev/reports?${query}`,
          signal,
        );
        if (!isCurrent(signal)) return;
        content.replaceChildren(
          node(
            "p",
            "muted",
            "All reports, including reports sent without a recording. Screenshots load privately when opened.",
          ),
        );
        if (!data.reports.length)
          content.append(
            node(
              "p",
              "empty-state",
              "No reports yet. Reports sent from any game will appear here.",
            ),
          );
        for (const report of data.reports)
          content.append(reportArticle(dom, report, media, openRecording));
        pagination(data.nextCursor);
      } else {
        const query = new URLSearchParams({ limit: "25" });
        if (cursor) query.set("cursor", cursor);
        if (actionStatus) query.set("status", actionStatus);
        if (actionGame) query.set("gameId", actionGame);
        const data = await api.json<ActionsPage>(
          `/api/dev/actions?${query}`,
          signal,
        );
        if (!isCurrent(signal)) return;
        content.replaceChildren(
          node(
            "p",
            "muted",
            "Explicit spoken development directives become proposals. Proposals do not start work automatically. Evidence links open the original session and related reports.",
          ),
          tokenTools(dom, api, signal, tokens, failure),
          renderActions(dom, data, openRecording),
        );
        pagination(data.nextCursor);
      }
    } catch (error) {
      if (isCurrent(signal))
        failure(error, content, () => {
          void load();
        });
    } finally {
      if (isCurrent(signal)) content.setAttribute("aria-busy", "false");
    }
  }
  async function authorize(name: string) {
    const signal = cancel();
    main.replaceChildren(
      node("p", "loading-state", "Verifying developer access…"),
    );
    try {
      await api.json<{ uid: string; email: string }>("/api/dev/me", signal);
      if (!isCurrent(signal)) return;
      accountName = name;
      shell();
      await load();
    } catch (error) {
      if (isCurrent(signal))
        failure(error, main, () => {
          void authorize(name);
        });
    }
  }
  const unwatch = deps.account.watch((account) => {
    if (disposed) return;
    if (account) void authorize(account.name);
    else signedOut();
  });
  void deps.account
    .ready()
    .then(() => {
      loginReady = true;
      const login = main.querySelector<HTMLButtonElement>(".auth-panel button");
      if (login) {
        login.disabled = false;
        login.textContent = "Sign in with Google";
      }
    })
    .catch(() => {
      if (!disposed)
        signedOut("Google sign-in could not load. Reload this page to retry.");
    });
  return () => {
    disposed = true;
    controller.abort();
    unwatch();
    root.replaceChildren();
  };
}
