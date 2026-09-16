import { bombFuseTicks, BOOST_DURATION_TICKS, GRAVITY_FIELD_TICKS, INK_DURATION_TICKS, STAR_DURATION_TICKS, TICK_HZ, type PickupType } from '../shared/game.js';
import { DRUNK_DURATION_TICKS } from '../shared/drunk.js';
import { PICKUP_WEIGHTS } from '../shared/pickup-weights.js';

export interface PowerupGuideEntry {
  type: PickupType;
  name: string;
  description: string;
  /** False for pickups that only spawn when a host enables them in room settings. */
  spawnsByDefault: boolean;
}

const seconds = (ticks: number): string => `${ticks / TICK_HZ}s`;

// Keyed by PickupType so a new pickup fails to typecheck until it has a guide entry; key order is display order.
const copy: Record<PickupType, readonly [name: string, description: string]> = {
  power: ['POWER', 'each pickup improves blast size and reload for this round, with diminishing returns'],
  extraBomb: ['EXTRA BOMB', '+1 bomb per ordinary shot for this round, up to 9; stacks with Triple/Five'],
  triple: ['TRIPLE', 'next ordinary shot adds 2 bombs'],
  five: ['FIVE', 'next ordinary shot adds 4 bombs (overrides Triple)'],
  target: ['TARGET', 'next bomb lands where you aim and blasts instantly, smaller radius'],
  shell: ['SHELL', 'next shot bounces off walls and trails until it hits a rider, you included'],
  gun: ['GUN', 'next shot curves slightly toward rivals and blasts a hole in the first trail it hits'],
  stopwatch: ['FUSE', `shorter bomb fuses for this round: ${[0, 1, 2].map(level => seconds(bombFuseTicks(level))).join(' → ')}`],
  orbitShield: ['SHIELD', 'blocks one crash'],
  portal: ['PORTAL', 'opens a pair of linked gates'],
  beer: ['BEER', `rivals wobble for ${seconds(DRUNK_DURATION_TICKS)}`],
  ink: ['INK', `clouds rivals' view for ${seconds(INK_DURATION_TICKS)}`],
  star: ['STAR', `invulnerable for ${seconds(STAR_DURATION_TICKS)}`],
  grip: ['GRIP', '43% tighter turn radius for this round; collect once, leave later drops for rivals'],
  boost: ['BOOST', `a quarter faster for ${seconds(BOOST_DURATION_TICKS)}`],
  gravity: ['SINGULARITY', `next bomb leaves a pull that drags riders in for ${seconds(GRAVITY_FIELD_TICKS)}`],
};

const defaultSpawns = new Set(PICKUP_WEIGHTS.map(row => row.type));

export const POWERUP_GUIDE: readonly PowerupGuideEntry[] = (Object.entries(copy) as Array<[PickupType, readonly [string, string]]>)
  .map(([type, [name, description]]) => ({ type, name, description, spawnsByDefault: defaultSpawns.has(type) }));
