---
name: game-direction-workflow
description: How to direct a coding agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode…) through building a game, from first prompt to polish. Load at the start of any new game, before a big feature, or before a long autonomous / multi-agent run. Covers the kickoff prompt, agent waves with critics, critique prompts, /goal recipes and the guard rails that keep a growing codebase sane.
---

# Game direction workflow

Strong agent-built games don't come from secret prompts. They come from a **clear quality bar, a feature list, critics that compare the game against references, and a very picky human**.

## Principles

1. **A quality bar plus references beats prompt length.** Words like "AAA", "as polished as <reference game>" or "you can't tell it isn't real" combined with *reference photos* move the result more than pages of spec. A two-sentence prompt at maximum effort can produce a convincing first build.
2. **Separate builders from critics.** A critic agent that never edits code and only compares screenshots with references is the single biggest quality lever.
3. **Pickiness is the job.** Short, specific critiques ("caustics are just noise", "rewrite this from the ground up and find something better") are what turn a demo into a game that holds up.
4. **Build the most advanced prototype first, then polish.** Polishing a rich prototype is easier than growing a thin one.
5. **Split work into waves of agents, one per domain**, each owning its own files, with critics running between waves.
6. **Let a human playtest before merging gameplay.** Green CI is not acceptance.

## Phase 1: Brief (≤1 page, ~10 minutes)

Ask Claude: "Write a detailed one-page brief for a game like <X> but <twist>." Then edit it. It must contain:
- Fantasy and pitch in one sentence. Name the reference games ("a roguelike dungeon crawler mapped onto a post-apocalyptic voxel world").
- Core loop (30 seconds, 5 minutes, session), win/fail, and the meta-progression.
- Camera, controls, target platform (desktop browser? mobile?), **performance target (60 fps on <machine>)**.
- Art direction: 3–6 reference images or photos plus 5 adjectives. Concept art from an image model is fine.
- Tech choice (see `game-engine-choice`) and asset strategy (see `game-asset-pipeline`).
- Out of scope.
- Feature list as **phased steps with acceptance criteria**. Each step must be independently testable.

Don't write a 30-document GDD. Claude-Code-Game-Studios measured that its 30-document build came last in blind review against a one-page-brief build.

## Phase 2: Kickoff prompt template

```
Build <game> as described in docs/BRIEF.md.
Quality bar: <AAA / "looks like real earth" / "as polished as <reference game>">.
Tech: <three.js r18x + WebGPU/TSL + Vite + TS> (see brief). Target 60 fps on <machine>; choose
resolutions, poly counts and texture sizes accordingly. Show FPS in the top-left.
Identify features I missed and implement them. If you find a better technique than the one I
named, use it. I'm not prescribing implementations.
Research references (real photos, papers, talks) for every visual system and refine against them.
Use up to <6> parallel agents, one per domain (world, rendering, gameplay, UI, audio), each owning
its own files. Run a separate critic agent that never edits code: it captures screenshots from
several views and compares them against references, then files concrete defects.
Keep docs/PROGRESS.md updated with what's done, what's next and known issues.
```

Settings: the highest reasoning effort for the kickoff and for rewrites (Claude Code: max/extra-high; Codex: `high`/`xhigh` reasoning); lower effort is fine for small fixes. "Parallel agents" means subagents where the agent has them (Claude Code subagents, Codex/Cursor multi-agent). Otherwise run each domain and the critic as separate sessions on separate branches.

## Phase 3: Agent waves (for long runs)

- **Lead** reads the brief, splits work by domain, and assigns **file ownership**: one writer per file, no overlapping edits.
- **Builders** implement one phased step each and finish with a verification artefact: screenshot path, test output, perf numbers.
- **Critics** run *after* each wave. They never touch the build. They compare captures with references and with the brief's acceptance criteria, and output a numbered defect list. See `game-art-review`.
- **One review round per step.** Fix, then move on; don't loop reviews recursively.
- Integrate behind a **feature flag** (`?caves`), and promote it when it's done.

## Phase 4: Critique prompts (the human's job)

Write short, specific and physical critiques. Good patterns:
- Name the defect precisely: "seeing tons of bright flickering spots", "clouds are pixelated", "shadows are really weak", "foam is getting stretched out".
- Demand a restart when a subsystem is fundamentally wrong: "caustics need to be rewritten from ground up. start over. find something better."
- Ask it to think through the physics or art: "think of where particles should spawn, how they should spawn, what they should look like, how lighting works."
- Guard performance continuously: "performance is starting to suffer. optimize as you go. don't let it get away from you."
- Ask for what "sells" realism: "irregular dark patches, world-placed patches of foam and streaks like you see in real water."

Avoid vague praise or "make it better". Every prompt should name what is wrong and where.

## Done-conditions (/goal recipes)

Claude Code's `/goal` keeps working until an evaluator judges the condition met from the transcript alone. Other agents don't have `/goal`; paste the same done-condition at the end of the prompt, or use the agent's own loop/autonomous mode. Either way the condition must be mechanically provable from printed output:
```
/goal Implement steps B.1–B.3 of docs/BRIEF-CAVES.md. Done when: `npm run build` exits 0,
`npm test` passes, `npm run playtest -- --scenario caves` saves screenshots to
artifacts/caves/*.png and prints their paths, and the seed sweep prints "256 seeds, 0 failures".
Stop after 30 turns if not done and summarise blockers.
```

## Guard rails for codebases that grow

Agents slow down and lose the big picture as a codebase grows. Counter it with:
- **AGENTS.md** with architecture rules, commands and definition of done. Codex, Cursor, Copilot, OpenCode, Amp and most other agents read it natively. For Claude Code add a `CLAUDE.md` containing `@AGENTS.md`; for Gemini CLI set `contextFileName` to `AGENTS.md` or add a `GEMINI.md` that points to it.
- **A deterministic simulation separate from rendering**, enforced by a test that fails on forbidden imports (for example, `src/engine` may not import Phaser, the DOM, `Math.random` or `Date.now`). This keeps replays, bots, netcode and tests possible.
- **A seeded RNG everywhere.** Generators are pure functions of the seed. Golden hashes guard worldgen changes (bump `GEN_VERSION`).
- **docs/PROGRESS.md** as continuity between sessions; one brief per feature in `docs/BRIEF-<feature>.md`.
- **Test discipline:** unit-test pure logic only (sim, RNG, scoring, generators plus solvers). Run one smoke playthrough per iteration and full visual passes at milestones. Agents love adding slow tests, so state the time budget for the suite.
- **One PR per feature;** gameplay PRs stay open for a human playtest ("green CI ≠ acceptance").

## Verification

At the end of any session the agent must print:
- the build/test results;
- the paths to fresh screenshots from at least three views (or a short capture video);
- an FPS/frame-time readout;
- the updated PROGRESS.md diff.
