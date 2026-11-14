import type {
  ActionsPage,
  ActionStatus,
} from "../packages/fuse-telemetry/src/action-contracts.js";
import type { Dom } from "./dom.js";
import { timestamp } from "./model.js";
import { utcDate } from "./sessions.js";
import type { createWorkspaceApi } from "./api.js";

export const actionStatuses: readonly (readonly [string, string])[] = [
  ["", "All statuses"],
  ["proposed", "Proposed"],
  ["claimed", "Claimed"],
  ["done", "Done"],
  ["dismissed", "Dismissed"],
  ["retracted", "Retracted"],
];
export type ActionFilter = ActionStatus | "";

export function renderActions(
  dom: Dom,
  page: ActionsPage,
  open: (recordingId: string, reportId?: string, offsetMs?: number) => void,
): HTMLElement {
  const { node, button } = dom;
  const section = node("div", "action-list");
  if (!page.actions.length)
    section.append(
      node(
        "p",
        "empty-state",
        page.nextCursor
          ? "No matching proposals on this page. Continue to the next page."
          : "No matching action proposals. Only explicit development directives from developer recordings become proposals.",
      ),
    );
  for (const item of page.actions) {
    const article = node("article", "action-item");
    const heading = node("div", "report-heading");
    heading.append(
      node("h3", "", item.title),
      node("span", `status status-${item.status}`, item.status),
    );
    article.append(
      heading,
      node("p", "muted", `${item.gameId} · Updated ${utcDate(item.updatedAt)}`),
      node("p", "private-copy", item.detail),
    );
    if (item.lease)
      article.append(
        node(
          "p",
          "muted",
          `Claimed by ${item.lease.agentName} · Lease expires ${utcDate(item.lease.expiresAt)}`,
        ),
      );
    if (item.resolution)
      article.append(
        node("p", "private-copy", `Resolution: ${item.resolution.note}`),
      );
    if (item.retraction)
      article.append(
        node("p", "notice", `Directive retracted: “${item.retraction.quote}”`),
      );
    if (item.correction)
      article.append(
        node(
          "p",
          "notice",
          `Later correction: ${item.correction.title}. ${item.correction.detail}`,
        ),
      );
    for (const evidence of [
      ...item.evidence,
      ...(item.correction?.evidence ?? []),
    ]) {
      const quote = node("blockquote", "evidence", evidence.quote);
      const links = node("div", "inline-controls");
      links.append(
        button(
          `Session · ${timestamp(evidence.startMs)}–${timestamp(evidence.endMs)}`,
          () => open(item.recordingId, undefined, evidence.startMs),
          "text-button",
        ),
      );
      for (const reportId of evidence.reportIds)
        links.append(
          button(
            "Related report",
            () => open(item.recordingId, reportId),
            "text-button",
          ),
        );
      article.append(quote, links);
    }
    section.append(article);
  }
  return section;
}

export interface MintedToken {
  id: string;
  expiresAt: number;
  recordingId?: string;
  gameId?: string;
}

export function tokenTools(
  dom: Dom,
  api: ReturnType<typeof createWorkspaceApi>,
  signal: AbortSignal,
  tokens: MintedToken[],
  fail: (error: unknown, target: HTMLElement, retry: () => void) => void,
): HTMLElement {
  const { node, field, select, button } = dom;
  const section = node("details", "token-tools");
  section.append(node("summary", "", "Create a scoped agent credential"));
  section.append(
    node(
      "p",
      "muted",
      "Give an automation access to action proposals for one recording or game. It can claim and complete work, but cannot read audio, screenshots or admin data. Keep the credential private; it is shown once and never saved in this browser.",
    ),
  );
  const form = node("form", "filters");
  const scope = select(
    [
      ["recordingId", "One recording"],
      ["gameId", "One game"],
    ],
    "recordingId",
  );
  const value = node("input");
  value.required = true;
  value.maxLength = 128;
  value.autocomplete = "off";
  value.spellcheck = false;
  const expiry = select(
    [
      ["3600000", "1 hour"],
      ["14400000", "4 hours"],
      ["86400000", "24 hours"],
    ],
    "3600000",
  );
  const submit = node("button", "", "Create credential");
  submit.type = "submit";
  form.append(
    field("Scope", scope),
    field("Recording or game ID", value),
    field("Expires after", expiry),
    submit,
  );
  const result = node("div");
  const inventory = node("div");
  function drawTokens() {
    inventory.replaceChildren();
    for (const token of tokens) {
      const row = node("div", "minted-token");
      row.append(
        node(
          "span",
          "muted",
          `${token.gameId ?? token.recordingId} · Expires ${utcDate(token.expiresAt)}`,
        ),
      );
      const revoke = button("Revoke credential", () => {
        revoke.disabled = true;
        void api
          .json<{ revoked: true }>(
            `/api/dev/agent-tokens/${encodeURIComponent(token.id)}`,
            signal,
            { method: "DELETE" },
          )
          .then(() => {
            if (signal.aborted) return;
            const index = tokens.findIndex((item) => item.id === token.id);
            if (index >= 0) tokens.splice(index, 1);
            result.replaceChildren(node("p", "muted", "Credential revoked."));
            drawTokens();
          })
          .catch((error) => {
            if (!signal.aborted) {
              revoke.disabled = false;
              fail(error, result, () => revoke.click());
            }
          });
      });
      row.append(revoke);
      inventory.append(row);
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!value.value.trim()) return;
    submit.disabled = true;
    result.replaceChildren(node("p", "muted", "Creating private credential…"));
    void api
      .json<MintedToken & { token: string }>("/api/dev/agent-tokens", signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [scope.value]: value.value.trim(),
          expiresInMs: Number(expiry.value),
        }),
      })
      .then((minted) => {
        if (signal.aborted) return;
        tokens.push({
          id: minted.id,
          expiresAt: minted.expiresAt,
          recordingId: minted.recordingId,
          gameId: minted.gameId,
        });
        const credential = node("textarea");
        credential.readOnly = true;
        credential.rows = 3;
        credential.value = minted.token;
        credential.autocomplete = "off";
        credential.spellcheck = false;
        result.replaceChildren(
          node(
            "p",
            "",
            "Copy this credential now. Leaving or refreshing this view hides it permanently.",
          ),
          field("Private agent credential", credential),
          button("Hide credential", () => result.replaceChildren()),
        );
        credential.focus();
        credential.select();
        drawTokens();
      })
      .catch((error) => {
        if (!signal.aborted) fail(error, result, () => form.requestSubmit());
      })
      .finally(() => {
        if (!signal.aborted) submit.disabled = false;
      });
  });
  drawTokens();
  section.append(form, result, inventory);
  return section;
}
