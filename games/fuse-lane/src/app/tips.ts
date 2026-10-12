import {
  CLOTHING_NAMES,
  COLLEGE,
  COURSES,
  EMPLOYERS,
  EXTENDED,
  FESTIVAL,
  FLU,
  FLU_REST,
  FUN_HAPPY,
  JOB_FAIR,
  OPEN_WEEK,
  OVERTIME,
  PICKPOCKETS,
  POCKET_SAFE,
  SALE,
  FRESHCO,
  GADGET,
  HOURS,
  JOBHUB,
  JOBS,
  KEYNEST,
  MONO,
  NEOBANK,
  PLACES,
  THREADS,
  TRIED_EXTENSION,
  WORKPLACE,
  education,
  creditLeft,
  enrollFee,
  fed,
  hasDegree,
  hiring,
  hoursLeft,
  homePlace,
  lessonsNeeded,
  marketWage,
  missing,
  owns,
  wearing,
  type FuseLaneView,
  type PlayerState,
} from "../game/index.js";

/**
 * Tips: what to do next, read from your situation in the order that matters (the bots' own priorities, told as
 * advice): a job, the rent, food for Monday, clothes, a shift, a better job, rest, study, nice things, savings. The
 * first shows on the board and walks you there when tapped; the you panel lists the first few.
 */
export interface Tip {
  text: string;
  /** Where the tip sends you (a `PLACES` index), or -1. */
  place: number;
}

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/** The best-paying opening you could take now: free, hiring, requirements met, not refused this week. */
function bestOpening(view: FuseLaneView, you: string, me: PlayerState): number {
  let best = -1,
    bestWage = me.job >= 0 ? me.wage * 1.1 : 0;
  JOBS.forEach((job, index) => {
    const held = view.holders[index];
    if (
      index === me.job ||
      me.failed.includes(index) ||
      (held !== undefined && held !== you) ||
      !hiring(view.economy, job.employer) ||
      missing(me, job).length
    )
      return;
    const wage = marketWage(view.economy, job);
    if (wage > bestWage) {
      best = index;
      bestWage = wage;
    }
  });
  return best;
}

/** The course to take next: one you are part way through, else the first you may start. */
function nextCourse(me: PlayerState): number {
  const active = me.courses.findIndex(
    (lessons) => lessons >= 0 && lessons < lessonsNeeded(me),
  );
  if (active >= 0) return active;
  return COURSES.findIndex(
    (course, index) =>
      me.courses[index]! < 0 &&
      (course.prereq < 0 || hasDegree(me, course.prereq)),
  );
}

/** Every tip that applies to `you` now, most pressing first; none once their week is over. */
export function tips(view: FuseLaneView, you: string): Tip[] {
  const me = view.players.find((player) => player.id === you)?.state;
  if (!me || me.done) return [];
  const economy = view.economy,
    out: Tip[] = [];
  const job = me.job >= 0 ? JOBS[me.job]! : undefined;
  const add = (text: string, place: number) => out.push({ text, place });

  if (!job) {
    const best = bestOpening(view, you, me);
    if (best >= 0)
      add(
        JOBS[best]!.sure
          ? `Get a job: ${JOBS[best]!.title} at ${EMPLOYERS[JOBS[best]!.employer]} is a sure thing at the Job Hub.`
          : "Get a job: the Job Hub lists every opening with your odds.",
        JOBHUB,
      );
    else
      add(
        "No job you can get yet: gig work at the Job Hub pays while you study.",
        JOBHUB,
      );
  }

  if (me.rentOwed > 0)
    add(`You owe ${usd(me.rentOwed)} in back rent at KeyNest.`, KEYNEST);
  else if (me.rentWeeks === 0 && (me.flags & EXTENDED) === 0) {
    if (me.cash >= me.rent)
      add(`Rent is due: pay ${usd(me.rent)} at KeyNest this week.`, KEYNEST);
    else if (me.cash + me.bank >= me.rent)
      add(
        `Rent of ${usd(me.rent)} is due: take cash out at Neobank, then pay at KeyNest.`,
        NEOBANK,
      );
    else if (me.cash + me.bank + creditLeft(me) >= me.rent)
      add(
        `Rent of ${usd(me.rent)} is due and you are short: Neobank can lend you the rest.`,
        NEOBANK,
      );
    else if ((me.flags & TRIED_EXTENSION) === 0 && me.rentExt >= 0)
      add("Rent is due and you are short: ask KeyNest for more time.", KEYNEST);
    else
      add(
        `Rent is due and you are ${usd(me.rent - me.cash - me.bank)} short: earn it this week, or it goes on your arrears.`,
        job ? WORKPLACE[job.employer]! : JOBHUB,
      );
  }
  if (me.loanLate > 0)
    add(
      `You missed a loan payment: pay Neobank back, or half of every shift goes to them.`,
      NEOBANK,
    );

  // This week's town event, when it touches you: hazards first, opportunities after the week's first shift.
  const event = economy.event,
    eventArg = economy.eventArg;
  if (event === PICKPOCKETS && me.cash > POCKET_SAFE + 200)
    add(
      "Pickpockets about: bank your cash at Neobank before the weekend.",
      NEOBANK,
    );
  if (event === FLU && me.relax < FLU_REST)
    add(
      `Flu going round: relax at ${PLACES[homePlace(me.home)]!.name} this week, or risk urgent care.`,
      homePlace(me.home),
    );

  if (!fed(me))
    add(
      owns(me, "fridge")
        ? "Buy groceries at FreshCo, or you lose 20 hours to hunger next week."
        : "Eat at Mono Burger, or you lose 20 hours to hunger next week.",
      owns(me, "fridge") ? FRESHCO : MONO,
    );

  const uniform = job?.uniform ?? 0;
  if (job && wearing(me) < uniform)
    add(
      `Your job needs ${CLOTHING_NAMES[uniform]!.toLowerCase()} clothes: Threads has them.`,
      THREADS,
    );
  else if (Math.max(...me.clothes.slice(uniform)) <= 1)
    add(
      wearing(me) < 0
        ? "You have nothing to wear: get clothes at Threads."
        : "Your clothes wear out next week: get new ones at Threads.",
      THREADS,
    );

  const workplace = job ? WORKPLACE[job.employer]! : -1;
  if (
    job &&
    wearing(me) >= uniform &&
    me.weekShifts === 0 &&
    hoursLeft(me) >= 3
  )
    add(
      `Work a shift at ${PLACES[workplace]!.name}: ${HOURS.work} hours, paid as 8.`,
      workplace,
    );

  if (job && event === OVERTIME && eventArg === job.employer)
    add(
      `Rush pay: shifts at ${PLACES[workplace]!.name} pay 50% more this week.`,
      workplace,
    );
  if (event === JOB_FAIR && !job)
    add("Job fair: every employer is hiring this week.", JOBHUB);
  if (event === OPEN_WEEK && education(me) < me.goals[2]!)
    add("Open week: tuition is half price at City College.", COLLEGE);
  if (event === SALE && me.cash >= 300)
    add(
      `Sale at ${PLACES[eventArg]!.name}: everything 25% off this week.`,
      eventArg,
    );
  if (event === FESTIVAL && (me.flags & FUN_HAPPY) === 0 && me.cash >= 60)
    add(
      "Harbour festival: a night out at Mono Burger cheers twice as much.",
      MONO,
    );

  if (job) {
    const better = bestOpening(view, you, me);
    if (better >= 0)
      add(
        `You qualify for ${JOBS[better]!.title} at ${usd(marketWage(economy, JOBS[better]!))}/h: apply at the Job Hub.`,
        JOBHUB,
      );
  }

  if (me.relax <= 13)
    add(
      `You are worn out: relax at ${PLACES[homePlace(me.home)]!.name}, or the doctor may send a bill.`,
      homePlace(me.home),
    );

  if (education(me) < me.goals[2]!) {
    const course = nextCourse(me);
    if (course >= 0 && me.courses[course]! >= 0)
      add(
        `Go to class at City College: ${me.courses[course]} of ${lessonsNeeded(me)} lessons done in ${COURSES[course]!.name}.`,
        COLLEGE,
      );
    else if (course >= 0 && me.cash >= enrollFee(economy, course))
      add(
        `Enroll in ${COURSES[course]!.name} at City College: degrees lift education and open better jobs.`,
        COLLEGE,
      );
  }

  if (me.happiness < me.goals[1]! && me.cash >= 400)
    add(
      "Treat yourself at Gadget Garage: the first of each thing lifts happiness.",
      GADGET,
    );

  if (me.cash >= 800)
    add("Save your spare cash at Neobank, where it earns interest.", NEOBANK);

  // Everything is in hand (a job always has a tip until you have one).
  if (out.length === 0 && job)
    add(
      `Work more at ${PLACES[workplace]!.name}, or call it a week: spare hours become sleep.`,
      workplace,
    );
  return out;
}
