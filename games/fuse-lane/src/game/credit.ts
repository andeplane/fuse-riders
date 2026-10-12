import { ECONOMY } from "./data/economy.js";
import type { Economy } from "./economy.js";
import { randInt } from "./random.js";
import type { FuseLaneRoom } from "./room.js";
import { addHappiness, notify, say, type PlayerState } from "./state.js";

/**
 * Neobank's loans and FreshCo's scratch cards: the two ways to gamble on the future. A loan brings tomorrow's pay
 * forward (a fridge, a suit, tuition) and counts against Wealth until it is paid back; a scratch card is a small bet
 * with a rare big prize. Both draw on the room's seeded generator or plain arithmetic, so every replica agrees.
 */
const L = ECONOMY.loans;

/** The most anyone may owe: about four weeks of three shifts at their wage, a little without a job; none while late. */
export function creditLine(player: PlayerState): number {
  if (player.loanLate > 0) return 0;
  const line = player.job >= 0 ? player.wage * L.weeksOfPay * 24 : L.withoutJob;
  return Math.min(L.max, Math.floor(line / 100) * 100);
}
/** What they may still borrow now. */
export const creditLeft = (player: PlayerState): number =>
  Math.max(0, creditLine(player) - player.loan);
/** The yearly rate a loan costs now, percent: the central bank's rate plus Neobank's margin. */
export const loanRate = (economy: Economy): number =>
  economy.policyRate + L.margin;
/** The Monday payment due on a balance: a tenth of it, at least the minimum (or all of a small one). */
export const loanPayment = (loan: number): number =>
  Math.min(loan, Math.max(L.minPayment, Math.ceil(loan * L.payShare)));

export function borrow(
  room: FuseLaneRoom,
  player: PlayerState,
  amount: number,
): void {
  if (amount <= 0) return;
  const left = creditLeft(player);
  if (left < amount)
    return say(
      player,
      player.loanLate > 0
        ? "No new credit until your missed payments are made good."
        : left > 0
          ? `Neobank lends you up to $${left} more.`
          : player.job < 0
            ? "Get a job first: Neobank lends against a payslip."
            : "You're at your credit limit.",
      true,
    );
  player.loan += amount;
  player.cash += amount;
  say(
    player,
    `Borrowed $${amount} at ${loanRate(room.economy).toFixed(1)}% a year. Owed: $${player.loan}.`,
  );
}

export function repay(player: PlayerState, amount: number): void {
  if (amount <= 0 || player.loan <= 0) return;
  const paid = Math.min(amount, player.loan);
  if (player.cash < paid)
    return say(player, `You need $${paid} in cash to pay that back.`, true);
  player.cash -= paid;
  player.loan -= paid;
  if (player.loan === 0) player.loanLate = 0;
  say(
    player,
    player.loan === 0
      ? "Loan paid off. Debt free!"
      : `Paid back $${paid}. Still owed: $${player.loan}.`,
  );
}

/**
 * Monday at Neobank: a week's interest is added, then the payment is taken from savings, then cash. A missed payment
 * stops new credit and garnishes shifts until a payment is made in full; it stings, too.
 */
export function loanMonday(
  room: FuseLaneRoom,
  player: PlayerState,
  economy: Economy,
): void {
  if (player.loan <= 0) return;
  const interest = Math.ceil((player.loan * loanRate(economy)) / 100 / 52);
  player.loan += interest;
  room.economy.companies[1]!.spend += interest;
  const due = loanPayment(player.loan),
    fromBank = Math.min(player.bank, due),
    fromCash = Math.min(player.cash, due - fromBank);
  player.bank -= fromBank;
  player.cash -= fromCash;
  player.loan -= fromBank + fromCash;
  if (fromBank + fromCash >= due) {
    player.loanLate = 0;
    notify(
      player,
      player.loan === 0
        ? `Last loan payment: $${due}. You're debt free.`
        : `Loan payment: $${due} (interest $${interest}). Still owed: $${player.loan}.`,
    );
    return;
  }
  player.loanLate++;
  addHappiness(player, -2);
  notify(
    player,
    `Missed a loan payment of $${due}. Neobank will take half of every shift's pay until you catch up.`,
  );
}

/** Half of a shift's pay towards a loan in arrears; returns what was taken. */
export function garnishLoan(player: PlayerState, pay: number): number {
  if (player.loanLate === 0 || player.loan <= 0 || pay <= 0) return 0;
  const taken = Math.min(player.loan, Math.floor(pay / 2));
  player.loan -= taken;
  if (player.loan === 0) player.loanLate = 0;
  return taken;
}

// ---- scratch cards -------------------------------------------------------------------------------------------

/** Prizes, best first: the odds out of 1000 and the payout. Pays back about 80% on average. */
export const SCRATCH_PRIZES = [
  { odds: 1, prize: 2000, happy: 8 },
  { odds: 10, prize: 50, happy: 3 },
  { odds: 50, prize: 15, happy: 1 },
  { odds: 150, prize: 5, happy: 0 },
] as const;
export const SCRATCH_PRICE = 5;
/** Cards anyone may scratch in a week: a flutter, not a pastime. */
export const SCRATCH_PER_WEEK = 5;

export function scratch(room: FuseLaneRoom, player: PlayerState): void {
  if (player.scratched >= SCRATCH_PER_WEEK)
    return say(
      player,
      `That's ${SCRATCH_PER_WEEK} cards this week. The clerk cuts you off.`,
      true,
    );
  if (player.cash < SCRATCH_PRICE)
    return say(player, `A card costs $${SCRATCH_PRICE}.`, true);
  player.cash -= SCRATCH_PRICE;
  player.scratched++;
  room.economy.spend[4]! += SCRATCH_PRICE;
  room.economy.companies[2]!.spend += SCRATCH_PRICE;
  let roll = randInt(room, 1, 1000);
  for (const { odds, prize, happy } of SCRATCH_PRIZES) {
    roll -= odds;
    if (roll > 0) continue;
    player.cash += prize;
    addHappiness(player, happy);
    room.economy.companies[2]!.spend -= Math.min(
      prize,
      room.economy.companies[2]!.spend,
    );
    return say(
      player,
      prize >= 1000
        ? `JACKPOT! +$${prize}. The whole shop cheers.`
        : prize > SCRATCH_PRICE
          ? `Winner! +$${prize}.`
          : `Your $${prize} back. Close one.`,
    );
  }
  say(player, "Scratch, scratch... nothing. Better luck next time.", true);
}
