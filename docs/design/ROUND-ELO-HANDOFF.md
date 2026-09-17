# Saved work: round Elo and player menu

Branch: claude/game-session-f15b02. PR: https://github.com/andeplane/fuse-riders/pull/299.
Saved immediately at the user's request because session credits were nearly exhausted.

Latest accepted requirements override older wording in README/design docs:
- Record each individual round with at least one signed-in human, including signed-in solo play.
- A lone signed-in human records zero Elo change. Guests and bots never affect comparisons.
- Two or more signed-in humans compare only with each other. No whole-game participation requirement.
- Keep historical full-game ratings, but distinguish them from new rounds in counts and graph rows.
- Consistent global menu across home/lobby/play, Elo visible on phone play.
- Latest button correction: rank on LEADERBOARD; account button shows nickname then Elo on its second line.

Completed verification before latest scope expansion: 881 unit tests/coverage, build/typecheck, Chromium online
smoke, stats smoke in Chromium/WebKit desktop and phone. Latest single-human counting changes passed 34 focused
history/rating/report tests. Shared peer rules are fuse-p2p-29 after integrating main.

Remaining before merge: finish the latest button correction if not in subsequent commit; re-run relevant browser
smokes with new labels/counts; add solo endpoint regressions and round/legacy metadata parser regressions; update
README/design/PR description to the single-human counting rule; rerun final verification and review expanded diff.
The authenticated solo endpoint accepts only one human, so it can record zero-change rounds but cannot move Elo.
No production deploy has been performed. Do not auto-merge: coordinate client/service rollout and leave merge to user.
