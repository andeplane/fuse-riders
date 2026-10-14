import { FLOOR, dockAt } from "./arena.js";
import { dist2, px } from "./math.js";
import { wagons } from "./trail.js";
import * as T from "./tuning.js";
import { FX, effect, random, type World } from "./world.js";

/**
 * New cargo for the floor: a cart at a random place from the world's stream, clear of the docks, of every
 * locomotive and wagon, and of the other carts. It tries a few places and gives up for this time if none is clear.
 */
const EDGE = px(38),
  CLEAR_OF_LOCO = px(84),
  CLEAR_OF_WAGON = px(32),
  CLEAR_OF_CART = px(36),
  CLEAR_OF_DOCK = px(24);

export function spawnCart(world: World, announce: boolean): boolean {
  if (world.carts.length >= T.MAX_LOOSE) return false;
  const width = FLOOR.right - FLOOR.left - 2 * EDGE,
    height = FLOOR.bottom - FLOOR.top - 2 * EDGE;
  const taken = world.trains.flatMap((train) => wagons(train));
  for (let attempt = 0; attempt < 6; attempt++) {
    const x = FLOOR.left + EDGE + random(world, width),
      y = FLOOR.top + EDGE + random(world, height);
    if (
      dockAt(x, y, CLEAR_OF_DOCK) >= 0 ||
      world.trains.some(
        (train) =>
          dist2(train.x, train.y, x, y) < CLEAR_OF_LOCO * CLEAR_OF_LOCO,
      ) ||
      taken.some(
        ([wx, wy]) => dist2(wx, wy, x, y) < CLEAR_OF_WAGON * CLEAR_OF_WAGON,
      ) ||
      world.carts.some(
        (cart) => dist2(cart.x, cart.y, x, y) < CLEAR_OF_CART * CLEAR_OF_CART,
      )
    )
      continue;
    const kind = random(world, T.CARGO_KINDS);
    world.carts.push({ id: world.nextId++, kind, x, y, vx: 0, vy: 0, cool: 0 });
    if (announce) effect(world, FX.spawn, x, y, -1, kind);
    return true;
  }
  return false;
}

/** How many loose carts the depot keeps topped up to. */
export const looseTarget = (world: World): number =>
  Math.min(T.MAX_LOOSE, T.LOOSE_BASE + T.LOOSE_PER_TRAIN * world.trains.length);

/** Cut carts roll to a stop (7/8 of their speed a step), stay on the floor, and their cooldowns run out. */
export function rollCarts(world: World): void {
  for (const cart of world.carts) {
    if (cart.vx !== 0 || cart.vy !== 0) {
      cart.x += cart.vx;
      cart.y += cart.vy;
      if (cart.x < FLOOR.left + T.CART_R) {
        cart.x = FLOOR.left + T.CART_R;
        cart.vx = -cart.vx;
      } else if (cart.x > FLOOR.right - T.CART_R) {
        cart.x = FLOOR.right - T.CART_R;
        cart.vx = -cart.vx;
      }
      if (cart.y < FLOOR.top + T.CART_R) {
        cart.y = FLOOR.top + T.CART_R;
        cart.vy = -cart.vy;
      } else if (cart.y > FLOOR.bottom - T.CART_R) {
        cart.y = FLOOR.bottom - T.CART_R;
        cart.vy = -cart.vy;
      }
      cart.vx = Math.trunc((cart.vx * 7) / 8);
      cart.vy = Math.trunc((cart.vy * 7) / 8);
    }
    if (cart.cool > 0) cart.cool--;
  }
}
