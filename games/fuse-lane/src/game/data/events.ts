import { EMPLOYERS, GADGET, MEGAMART, PLACES, THREADS } from "./places.js";

/**
 * This week in Fusetown: most weeks one town event changes the rules a little, announced in the Monday briefing and
 * shown on the HUD all week, so no two weeks play quite alike and a player who reads the news gets an edge. The event
 * lives in the economy (`Economy.event`, `Economy.eventArg`), drawn from the room's seeded generator each Monday.
 */
export const NO_EVENT = -1,
  /** One shop sells everything for less (`eventArg`: the place). */
  SALE = 0,
  /** Shifts at one employer pay more (`eventArg`: the employer). */
  OVERTIME = 1,
  /** City College's open week: tuition at a discount. */
  OPEN_WEEK = 2,
  /** A night out cheers you twice as much. */
  FESTIVAL = 3,
  /** Every employer hires, whatever its books say. */
  JOB_FAIR = 4,
  /** Cash carried into the weekend may go missing. */
  PICKPOCKETS = 5,
  /** Rest up, or risk a trip to urgent care at the weekend. */
  FLU = 6;
export const EVENT_COUNT = 7;

/** A week has an event this often (out of 100). */
export const EVENT_ODDS = 70;
export const SALE_PLACES = [GADGET, MEGAMART, THREADS] as const;
export const SALE_SHARE = 0.75,
  OVERTIME_PAY = 1.5,
  OPEN_WEEK_SHARE = 0.5,
  /** Cash above this is what pickpockets go for; they take 20–40% of it, half the time. */
  POCKET_SAFE = 200,
  /** Rest below this during flu week risks urgent care. */
  FLU_REST = 25;
/** Employers that can call for overtime: the companies and the port, not City College. */
export const OVERTIME_EMPLOYERS = EMPLOYERS.length - 1;

/** The event's headline for the Monday briefing. */
export function eventHeadline(event: number, arg: number): string {
  switch (event) {
    case SALE:
      return `Sale at ${PLACES[arg]?.name ?? "the shops"}: everything 25% off this week`;
    case OVERTIME:
      return `Rush at ${EMPLOYERS[arg] ?? "work"}: shifts there pay 50% more this week`;
    case OPEN_WEEK:
      return "City College open week: tuition half price";
    case FESTIVAL:
      return "Harbour festival! A night out at Mono Burger cheers twice as much";
    case JOB_FAIR:
      return "Job fair: every employer in town is hiring this week";
    case PICKPOCKETS:
      return "Pickpockets on the waterfront: bank your cash before the weekend";
    case FLU:
      return "Flu going round: rest up or risk urgent care at the weekend";
    default:
      return "";
  }
}

/** The event's short HUD chip. */
export function eventChip(event: number, arg: number): string {
  switch (event) {
    case SALE:
      return `Sale: ${PLACES[arg]?.name ?? "shops"}`;
    case OVERTIME:
      return `Rush: ${EMPLOYERS[arg] ?? "work"}`;
    case OPEN_WEEK:
      return "Tuition ½ price";
    case FESTIVAL:
      return "Festival";
    case JOB_FAIR:
      return "Job fair";
    case PICKPOCKETS:
      return "Pickpockets";
    case FLU:
      return "Flu week";
    default:
      return "";
  }
}
