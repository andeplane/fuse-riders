import { DURABLES, ITEMS, durableName } from "./data/items.js";
import { chance, randInt } from "./random.js";
import type { FuseLaneRoom, ShelfItem } from "./room.js";
import { addHappiness, notify, say, type PlayerState } from "./state.js";

/**
 * Second Life, the resale shop (modern-game.md §3, the original's pawn shop): pawn a durable for 40% of what you paid,
 * redeem it for 50% within three weeks, or lose it to the shelf, where anyone can buy it second-hand. The shelf is
 * shared and first come, first served; used goods break down like budget ones.
 */
export const PAWN_SHARE = 0.4,
  REDEEM_SHARE = 0.5,
  /** Shelf price of a forfeited item, as a share of what its owner paid. */
  SHELF_SHARE = 0.6,
  /** Weeks a pawn ticket runs: it can be redeemed until the end of the week it was pawned + this. */
  PAWN_WEEKS = 3,
  MAX_TICKETS = 4,
  SHELF_MAX = 8,
  /** A used item that turns up on its own is priced at this share of the new shelf price. */
  USED_SHARE = 0.5;

/** The new price of a durable: its full-price shop's base. */
function basePrice(item: number): number {
  const id = DURABLES[item];
  return (
    ITEMS.find((data) => data.durable === id && !data.cheap)?.price ??
    ITEMS.find((data) => data.durable === id)?.price ??
    0
  );
}
const used = (item: number): ShelfItem => ({
  item,
  price: Math.round(basePrice(item) * USED_SHARE),
});

/** The shelf on day one: a used fridge, TV and air fryer, so a tight budget has a way in. */
export function startingShelf(): ShelfItem[] {
  return (["fridge", "tv", "airfryer"] as const).map((id) =>
    used(DURABLES.indexOf(id)),
  );
}

/** What pawning a durable they own pays now, or 0. */
export function pawnValue(player: PlayerState, item: number): number {
  const owned = player.durables[DURABLES[item]!];
  return owned && owned.n > 0 ? Math.floor(owned.paid * PAWN_SHARE) : 0;
}
export const redeemPrice = (paid: number): number =>
  Math.ceil(paid * REDEEM_SHARE);

export function pawn(player: PlayerState, item: number, week: number): void {
  const id = DURABLES[item];
  if (!id) return;
  const owned = player.durables[id];
  if (!owned || owned.n === 0) return say(player, "You don't own that.", true);
  if (player.pawned.length >= MAX_TICKETS)
    return say(
      player,
      `${MAX_TICKETS} tickets is the limit. Redeem something first.`,
      true,
    );
  const value = pawnValue(player, item);
  player.pawned.push({
    item,
    paid: owned.paid,
    cheap: owned.cheap,
    due: week + PAWN_WEEKS,
  });
  owned.n = 0;
  player.cash += value;
  addHappiness(player, -1);
  say(
    player,
    `Pawned your ${durableName(id)}: +$${value}. Redeem it by week ${week + PAWN_WEEKS} for $${redeemPrice(owned.paid)}.`,
  );
}

export function redeem(player: PlayerState, ticket: number): void {
  const pawned = player.pawned[ticket];
  if (!pawned) return;
  const id = DURABLES[pawned.item]!;
  if ((player.durables[id]?.n ?? 0) > 0)
    return say(player, "You already have one at home.", true);
  const price = redeemPrice(pawned.paid);
  if (player.cash < price)
    return say(player, `Redeeming costs $${price}.`, true);
  player.cash -= price;
  player.pawned.splice(ticket, 1);
  player.durables[id] = { n: 1, paid: pawned.paid, cheap: pawned.cheap };
  say(player, `Your ${durableName(id)} is back home.`);
}

/** Buys shelf slot `slot`, which must still hold item `item` (another player may have just bought it). */
export function buyUsed(
  room: FuseLaneRoom,
  player: PlayerState,
  slot: number,
  item: number,
): void {
  const offer = room.shelf[slot];
  if (!offer || offer.item !== item)
    return say(player, "Someone beat you to it.", true);
  const id = DURABLES[item]!;
  if ((player.durables[id]?.n ?? 0) > 0)
    return say(player, "You already own one.", true);
  if (player.cash < offer.price)
    return say(player, `That costs $${offer.price}.`, true);
  player.cash -= offer.price;
  room.shelf.splice(slot, 1);
  const first = player.durables[id] === undefined;
  player.durables[id] = { n: 1, paid: offer.price, cheap: true };
  const happy = first ? 1 : 0;
  addHappiness(player, happy);
  say(
    player,
    `Second-hand ${durableName(id)}: -$${offer.price}${happy ? ", +1 happiness" : ""}. Good as new (nearly).`,
  );
}

/**
 * Monday at Second Life: tickets past their week are forfeited to the shelf, and now and then a used item turns up on
 * its own. The shelf keeps its newest `SHELF_MAX`.
 */
export function resaleMonday(room: FuseLaneRoom, players: PlayerState[]): void {
  for (const player of players) {
    const kept = player.pawned.filter((ticket) => ticket.due >= room.week);
    for (const ticket of player.pawned)
      if (ticket.due < room.week) {
        room.shelf.push({
          item: ticket.item,
          price: Math.round(ticket.paid * SHELF_SHARE),
        });
        notify(
          player,
          `Your pawned ${durableName(DURABLES[ticket.item]!)} went on sale at Second Life.`,
        );
      }
    player.pawned = kept;
  }
  if (room.shelf.length < 3 && chance(room, 0.4)) {
    const items = DURABLES.map((_, index) => index).filter(
      (index) => DURABLES[index] !== "books",
    );
    room.shelf.push(used(items[randInt(room, 0, items.length - 1)]!));
  }
  if (room.shelf.length > SHELF_MAX)
    room.shelf.splice(0, room.shelf.length - SHELF_MAX);
}
