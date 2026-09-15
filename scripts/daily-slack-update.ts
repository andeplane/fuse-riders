// Posts a summary of the last 24h of merged PRs to Slack. Run via .github/workflows/daily-slack-update.yml
// Local test: OPENAI_API_KEY=... SLACK_BOT_TOKEN=... SLACK_CHANNEL_ID=... GITHUB_TOKEN=... npx tsx scripts/daily-slack-update.ts
export {};

const GITHUB_TOKEN = requireEnv('GITHUB_TOKEN');
const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');
const SLACK_BOT_TOKEN = requireEnv('SLACK_BOT_TOKEN');
const SLACK_CHANNEL_ID = requireEnv('SLACK_CHANNEL_ID');
const REPO = requireEnv('GITHUB_REPOSITORY'); // "owner/repo", set by Actions
const HOURS = Number(process.env.LOOKBACK_HOURS ?? 24);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`missing required env var ${name}`); process.exit(1); }
  return value;
}

type PullRequest = { number: number; title: string; body: string | null; merged_at: string | null; updated_at: string; html_url: string; user: { login: string } };

async function mergedPullRequests(since: Date): Promise<PullRequest[]> {
  const merged: PullRequest[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=${page}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const prs = await res.json() as PullRequest[];
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (pr.merged_at && new Date(pr.merged_at) >= since) merged.push(pr);
    }
    // Sorted by updated desc: once the oldest PR on this page was last updated before the
    // window, every PR on later pages is older still, merged or not.
    const oldest = prs[prs.length - 1]!;
    if (new Date(oldest.updated_at) < since) break;
  }
  return merged;
}

async function summarize(prs: PullRequest[]): Promise<string> {
  const list = prs.map(pr => `#${pr.number} by @${pr.user.login}: ${pr.title}\n${(pr.body ?? '').slice(0, 500)}`).join('\n\n');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You summarize merged GitHub pull requests into a short Slack update for a small game dev team. Group into "New features" and "Fixes" (omit a section if empty). Use Slack mrkdwn: *bold* section headers, "- " bullets, no headings with #. Keep each bullet to one line. Be concrete, skip pure chores/refactors unless user-visible.' },
        { role: 'user', content: `Merged pull requests from the last ${HOURS} hours:\n\n${list}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]!.message.content.trim();
}

async function postToSlack(text: string) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: SLACK_CHANNEL_ID, text, unfurl_links: false }),
  });
  const data = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !data.ok) throw new Error(`Slack API error: ${data.error ?? res.status}`);
}

const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
const prs = await mergedPullRequests(since);
if (prs.length === 0) {
  console.log(`No PRs merged in the last ${HOURS}h — skipping Slack post.`);
  process.exit(0);
}
console.log(`Summarizing ${prs.length} merged PR(s): ${prs.map(pr => `#${pr.number}`).join(', ')}`);
const summary = await summarize(prs);
await postToSlack(`*Daily update — ${prs.length} PR${prs.length === 1 ? '' : 's'} merged in the last ${HOURS}h*\n\n${summary}`);
console.log('Posted to Slack.');
