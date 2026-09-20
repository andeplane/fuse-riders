---
name: ship
description: Take a finished change in Fuse Riders from working tree to a reviewed pull request (and merge only when the user has authorized it). Use when the user says "ship it", "PR it", "PR, review and merge", or asks to take a change end to end.
---

# Ship a change

Follow AGENTS.md; this is the order of operations, not a new set of gates.

1. **Ownership.** Search open pull requests, branches pushed in the last day and open issues for the same work (`gh pr list --search`, `git branch -r --sort=-committerdate | head`). If another agent owns it, report and stop.
2. **Branch.** Work on a `codex/` branch. Merge the latest `origin/main` and resolve conflicts.
3. **Verify.** Run the focused tests for what changed, plus `pnpm typecheck`. If a check fails, check whether it also fails on `origin/main` before debugging it as yours. Engine behaviour changes bump `RULES` and refresh the golden (see AGENTS.md).
4. **Self-review the feature.** Reachable from the menus? Empty, loading and failed-fetch states render, with a retry? Any effect that can loop? For UI changes, open the real flow in the browser with `?mute` and take a screenshot.
5. **Docs.** Update README/AGENTS.md/docs directly affected by the change.
6. **Pull request.** Stage files by name, commit, push and open the pull request: what changed, what was verified, what could not be run, the screenshot.
7. **Review.** Dispatch at least two review subagents in parallel on the diff: correctness plus simulation/protocol risk, and UX plus empty/error states plus tests. Fix every finding or answer it in the pull request, then push.
8. **CI.** `gh pr checks --watch`. Report only state changes. If main moved, merge it in and re-watch.
9. **Stop or merge.** Stop at the reviewed pull request with a short report, and leave gameplay and visual changes open for playtesting. Merge only if the user authorized a merge of this change, and only with `verify` green. Report the merge SHA.
