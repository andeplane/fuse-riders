import { BOOST_DURATION_TICKS, GRAVITY_FIELD_TICKS, INK_DURATION_TICKS, STAR_DURATION_TICKS, TICK_HZ, type PickupType } from '../shared/game.js';
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
  triple: ['TRIPLE', 'next bomb launch fires 3'],
  five: ['FIVE', 'next bomb launch fires 5'],
  target: ['TARGET', 'next bomb lands where you aim and blasts instantly, smaller radius'],
  shell: ['SHELL', 'next shot bounces off walls and trails until it hits a rider, you included'],
  gun: ['GUN', 'next shot curves slightly toward rivals and blasts a hole in the first trail it hits'],
  orbitShield: ['SHIELD', 'blocks one crash'],
  portal: ['PORTAL', 'opens a pair of linked gates'],
  beer: ['BEER', `rivals wobble for ${seconds(DRUNK_DURATION_TICKS)}`],
  ink: ['INK', `clouds rivals' view for ${seconds(INK_DURATION_TICKS)}`],
  star: ['STAR', `invulnerable for ${seconds(STAR_DURATION_TICKS)}`],
  boost: ['BOOST', `a quarter faster for ${seconds(BOOST_DURATION_TICKS)}`],
  gravity: ['SINGULARITY', `next bomb leaves a pull that drags riders in for ${seconds(GRAVITY_FIELD_TICKS)}`],
};

const defaultSpawns = new Set(PICKUP_WEIGHTS.map(row => row.type));

export const POWERUP_GUIDE: readonly PowerupGuideEntry[] = (Object.entries(copy) as Array<[PickupType, readonly [string, string]]>)
  .map(([type, [name, description]]) => ({ type, name, description, spawnsByDefault: defaultSpawns.has(type) }));
