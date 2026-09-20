// Posts a summary of the last 24h of merged PRs to Slack. Run via .github/workflows/daily-slack-update.yml
// Local test: OPENAI_API_KEY=... SLACK_BOT_TOKEN=... SLACK_CHANNEL_ID=... GITHUB_TOKEN=... pnpm exec tsx scripts/daily-slack-update.ts
export {};

const DRY_RUN = process.env.DRY_RUN === "1";
const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
const SLACK_BOT_TOKEN = DRY_RUN ? "" : requireEnv("SLACK_BOT_TOKEN");
const SLACK_CHANNEL_ID = DRY_RUN ? "" : requireEnv("SLACK_CHANNEL_ID");
const REPO = requireEnv("GITHUB_REPOSITORY"); // "owner/repo", set by Actions
const HOURS = Number(process.env.LOOKBACK_HOURS ?? 24);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

type PullRequest = {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  updated_at: string;
  html_url: string;
  user: { login: string };
  additions?: number;
  deletions?: number;
};

async function mergedPullRequests(since: Date): Promise<PullRequest[]> {
  const merged: PullRequest[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok)
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const prs = (await res.json()) as PullRequest[];
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (pr.merged_at && new Date(pr.merged_at) >= since) merged.push(pr);
    }
    // Sorted by updated desc: once the oldest PR on this page was last updated before the
    // window, every PR on later pages is older still, merged or not.
    const oldest = prs[prs.length - 1]!;
    if (new Date(oldest.updated_at) < since) break;
  }
  // The list endpoint doesn't include diff size, only the single-PR endpoint does — fetch it
  // per PR so we can surface the biggest changes, which correlate with the ones worth calling out.
  for (const pr of merged) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/pulls/${pr.number}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok)
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const detail = (await res.json()) as {
      additions: number;
      deletions: number;
    };
    pr.additions = detail.additions;
    pr.deletions = detail.deletions;
  }
  return merged.sort(
    (a, b) => b.additions! + b.deletions! - (a.additions! + a.deletions!),
  );
}

async function chatCompletion(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]!.message.content.trim();
}

// A dedicated pass over just the biggest-diff PRs. Lumping them into the 48-PR batch prompt
// repeatedly produced vague, easy-to-miss bullets for the one that mattered most (a netcode
// rewrite described in dense engineering language) — a focused prompt with only 1-3 PRs to
// consider is far more reliable at either explaining the real impact or correctly saying "skip".
const HIGHLIGHT_MIN_LINES = 300;

async function highlightBullets(
  prs: PullRequest[],
): Promise<Map<number, string>> {
  // prs is sorted biggest diff first.
  const candidates = prs
    .slice(0, 3)
    .filter(
      (pr) => (pr.additions ?? 0) + (pr.deletions ?? 0) >= HIGHLIGHT_MIN_LINES,
    );
  if (candidates.length === 0) return new Map();
  const list = candidates
    .map(
      (pr) =>
        `#${pr.number} (+${pr.additions}/-${pr.deletions} lines): ${pr.title}\n${(pr.body ?? "").slice(0, 1500)}`,
    )
    .join("\n\n");
  const reply = await chatCompletion(
    'These are the PRs with the largest diffs merged today. Large diffs are often architecture or netcode rewrites described in dense engineering language even when they fixed something players felt — e.g. "rollback", "TickClock" or "shared input log" usually means multiplayer sync got more reliable. For each PR below, reply with exactly one line "#<number>: <bullet>" translating its real effect into plain language a player or teammate would notice. If a PR is genuinely internal with no such effect (local dev tooling, CI, infra with no gameplay or reliability impact), reply "#<number>: SKIP" instead. One line per PR, nothing else.',
    `Pull requests:\n\n${list}`,
  );
  const bullets = new Map<number, string>();
  for (const line of reply.split("\n")) {
    const match = line.match(/^#(\d+):\s*(.+)$/);
    if (match && match[2]!.trim().toUpperCase() !== "SKIP")
      bullets.set(Number(match[1]), `- ${match[2]!.trim()}`);
  }
  return bullets;
}

async function summarize(prs: PullRequest[]): Promise<string> {
  const highlights = await highlightBullets(prs);
  const rest = prs.filter((pr) => !highlights.has(pr.number));
  const body =
    rest.length === 0
      ? ""
      : await chatCompletion(
          'You summarize merged GitHub pull requests into a short Slack update for a small game dev team. Group into "New features" and "Fixes" (omit a section if empty). Be concrete, skip pure chores/refactors with no user-facing effect (CI tuning, docs, test-only changes, dead code removal). Use Slack mrkdwn: *bold* section headers. Each bullet is one line starting with a single "- " (one dash, one space, never doubled) followed by the text, no headings with #.',
          `Merged pull requests from the last ${HOURS} hours:\n\n${rest.map((pr) => `#${pr.number} by @${pr.user.login}: ${pr.title}\n${(pr.body ?? "").slice(0, 1000)}`).join("\n\n")}`,
        );
  const highlightSection =
    highlights.size === 0
      ? ""
      : `*Notable this batch*\n${[...highlights.values()].join("\n")}\n\n`;
  return (highlightSection + body).trim();
}

async function postToSlack(text: string) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL_ID,
      text,
      unfurl_links: false,
    }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !data.ok)
    throw new Error(`Slack API error: ${data.error ?? res.status}`);
}

const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
const prs = await mergedPullRequests(since);
if (prs.length === 0) {
  console.log(`No PRs merged in the last ${HOURS}h — skipping Slack post.`);
  process.exit(0);
}
console.log(
  `Summarizing ${prs.length} merged PR(s): ${prs.map((pr) => `#${pr.number}`).join(", ")}`,
);
const summary = await summarize(prs);
const message = `*Daily update — ${prs.length} PR${prs.length === 1 ? "" : "s"} merged in the last ${HOURS}h*\n\n${summary}`;
if (DRY_RUN) {
  console.log("\n--- DRY RUN: would post to Slack ---\n" + message + "\n---");
} else {
  await postToSlack(message);
  console.log("Posted to Slack.");
}
