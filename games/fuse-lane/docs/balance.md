# Fusetown balance

How the game was tuned, and how to check it again. The numbers come from `scripts/fuse-lane-balance.ts`, which plays many all-bot hot-seat matches through the real rules fold:

```sh
pnpm exec tsx scripts/fuse-lane-balance.ts --games 300 --bots 4 --level 2 --goal 50
pnpm exec tsx scripts/fuse-lane-balance.ts --games 400 --bots 1 --level 1 --goal 50   # each style alone
pnpm exec tsx scripts/fuse-lane-balance.ts --games 1 --trace 1 --style Hustler       # one bot's weeks
```

It prints how long matches last, which goal the winner reached last, the win rate and the mean winning week of each bot style, the markets at the end and how much the loans, scratch cards and Second Life get used. `scripts/fuse-lane-sim.ts` still prints the economy's ranges. `tests/balance.test.ts` guards the headline: four hard bots finish a Standard match in roughly 20–35 weeks.

## What was wrong (October 2026, before this pass)

Four hard bots, Standard goals (50), 200 matches each:

- **One strategy won everything.** Studying first was all that mattered: when the bots were given styles, the studious one won 100% of normal matches and the hard-working and investing ones 0%.
- **Wealth was always the last goal.** Happiness overshot to 77 on average (100 in Long games) just from sleeping and the first purchases, and Career was met by week 14 (week 4 in Quick games) in any job.
- **Nothing varied.** 80% of hard matches ended within a two-week window (25–27). The economy, luck and the other players barely moved the result.
- **Investing did not pay.** The City500 had no drift (a 30-week return of −1% on average, with crashes); a savings account was the better bet.
- **Easy bots took 63 weeks** at Standard, normal 31, hard 26.

## What changed

| Lever         | Before                              | After                                                                                                                                                                                                       | Why                                                                             |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Rival bots    | one way of playing                  | four styles dealt from the match seed: **Steady**, **Hustler** (works a lot, buys scratch cards), **Scholar** (studies first, borrows for tuition), **Investor** (puts its surplus in the City500, borrows) | rivals that play differently, and a way to measure whether a strategy dominates |
| Bot judgement | fixed shifts and classes            | a normal or hard bot leans into its most lagging goal (one or two more shifts or classes, fewer of the other); a normal bot leaves its last 8 hours unplanned                                               | strategies converge on balance like a good player's do; levels separate         |
| Tuition       | $50 per course                      | $110–$340 per course (a higher degree costs more)                                                                                                                                                           | studying costs money too; loans have a use                                      |
| Raises        | only up to the market wage          | plus up to 4 seniority steps of +8%, one per 6 experience past the job's bar; experience grows to the job's bar + 25                                                                                        | hard work pays without a degree, slowly                                         |
| Wages         | base                                | base × 1.2; gig work $4/h (below any job)                                                                                                                                                                   | the early weeks were a money trap; gig work out-earned the first jobs           |
| Career        | 10 × ⌊dependability / 8⌋ in any job | capped at the job's dependability bar + 20 (a starter job tops out at 30)                                                                                                                                   | Career now means climbing the ladder                                            |
| Education     | 1 + 9 × degrees                     | 11 × degrees                                                                                                                                                                                                | Quick and Long need one degree fewer (3 and 8); Standard still needs 5          |
| Happiness     | only goes up                        | fades by ⌊happiness / 15⌋ every Monday; home comforts give up to +3 a week (a kitchen gadget, a screen or console, a hot tub); a karaoke night at Mono Burger (+4, 4 h, $40, once a week)                   | a happy life needs keeping up; there is something fun to spend on               |
| Shares        | no drift                            | fair value grows 0.5% a week                                                                                                                                                                                | the City500 returns about +20% over a game, crashes aside                       |
| New systems   | —                                   | Neobank loans, FreshCo scratch cards, Second Life resale shop                                                                                                                                               | see the README                                                                  |

## Where it landed

Four bots, 300 matches per row, weeks to a winner (p10 / median / p90):

| Bots            | Quick 30     | Standard 50  | Long 80      |
| --------------- | ------------ | ------------ | ------------ |
| Easy (before)   | 41 / 42 / 42 | 61 / 63 / 63 | 91 / 92 / 94 |
| Easy (after)    | 22 / 28 / 33 | 37 / 47 / 55 | 84 / 85 / 97 |
| Normal (before) | 21 / 22 / 23 | 31 / 31 / 31 | 44 / 46 / 46 |
| Normal (after)  | 18 / 19 / 20 | 25 / 27 / 29 | 38 / 42 / 59 |
| Hard (before)   | 18 / 19 / 20 | 25 / 26 / 27 | 35 / 36 / 39 |
| Hard (after)    | 16 / 17 / 19 | 24 / 25 / 27 | 34 / 37 / 47 |

- **No style dominates where the bots play well.** Each style playing alone (400 matches, Standard) wins on average in week 25.8 (Scholar), 25.5 (Steady), 26.9 (Investor) and 30.5 (Hustler) at hard; 30.1, 26.7, 26.5 and 29.6 at normal. Head to head, races are close (the runner-up is at 95% of the goals when the winner finishes), so small edges show up large: hard win rates are Steady 37%, Investor 32%, Scholar 21%, Hustler 10%. Easy bots, which do not adapt, still win most by studying (Scholar 55%).
- **Every goal can be the last one.** At hard Standard the winner's last goal was Wealth in 60% of matches, Happiness in 36% and Education in 4%; in Long matches Happiness is the hardest. The winner's first week per goal is within a week for Wealth, Happiness and Education.
- **The markets matter.** At the end of a Standard match the City500 is at 1.23× its start (p10 0.53×, p90 1.69×), crypto 1.13× (p10 0.48×, p90 2.85×).
- **The new systems get used.** About three in four bots borrow at some point (rent, tuition), a hard match sees at least four second-hand buys, and scratch cards stay a rare flutter (the script counts the last answer of each tick, so these are lower bounds).

## Known limits

- Easy bots rarely finish Long (80) goals before week 85; they are meant to be beaten.
- A match still varies less than it could: hard Standard matches mostly end within weeks 24–27. More random events (muggings, illness tied to rest, news) would widen it.
- Bots never pawn or redeem; only people use pawn tickets.
