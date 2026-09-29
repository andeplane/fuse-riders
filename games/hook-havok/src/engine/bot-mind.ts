/**
 * What a bot remembers between log ticks (11C), its levels, and the strict
 * checkpoint codec for both. A bot's mind is ordinary room state: it is
 * hashed, cloned by rollback and restored from checkpoints like a keeper's
 * body, so a replay or a joining peer drives the bot exactly as it was driven.
 */
import { integer, plain } from "./codec.js";
import { navGraph, TASK_STRIKE, type Course } from "./bot-nav.js";
import { MAPS } from "./maps.js";
import { CHARGE_TICKS } from "./bomb-rules.js";
import { WIDTH, type Tuning } from "./world.js";

export type BotLevel = Tuning["botLevel"];
export const BOT_LEVELS_ORDER: readonly BotLevel[] = ["easy", "normal", "hard"];
export interface LevelRules {
  /** Log ticks between choosing where to go. */
  replan: number;
  /** Largest sideways error on a throw, as a share of the aim direction. */
  aimError: number;
  /** Share of a rival's velocity a throw leads by, over 20 ticks. */
  lead: number;
  /** A bomb matters once its fuse is this short (ticks), and by this margin (units). */
  react: number;
  margin: number;
  /** Chance a bot notices a given bomb at all. */
  notice: number;
  /** Chance a one-second beat is a hesitation: the bot does nothing. */
  blunder: number;
  /** Log ticks between looking for a throw or a hook shot. */
  attack: number;
  /** Chance of hooking a rival who is not near an edge. */
  strike: number;
  /** Accepted miss of a planned throw, as a share of the blast radius. */
  accept: number;
  /** Farthest power-up pad (ticks of travel) worth a detour. */
  pads: number;
}
export const BOT_LEVELS: Readonly<Record<BotLevel, LevelRules>> = {
  easy: {
    replan: 24,
    aimError: 0.16,
    lead: 0,
    react: 30,
    margin: 4,
    notice: 0.55,
    blunder: 0.2,
    attack: 6,
    strike: 0.15,
    accept: 0.95,
    pads: 90,
  },
  normal: {
    replan: 10,
    aimError: 0.07,
    lead: 0.5,
    react: 45,
    margin: 12,
    notice: 0.8,
    blunder: 0.07,
    attack: 3,
    strike: 0.4,
    accept: 0.75,
    pads: 200,
  },
  hard: {
    replan: 4,
    aimError: 0.02,
    lead: 1,
    react: 90,
    margin: 28,
    notice: 1,
    blunder: 0.015,
    attack: 2,
    strike: 0.8,
    accept: 0.6,
    pads: 360,
  },
};
export const isBotLevel = (v: unknown): v is BotLevel =>
  v === "easy" || v === "normal" || v === "hard";
/** Log ticks without reaching a ledge or its goal before a bot tries elsewhere. */
export const STUCK_TICKS = 160;
/** The longest a bot waits to choose again, log ticks (the checkpoint's bound). */
export const REPLAN_MAX = 60;

export interface Mind extends Course {
  /** The ledge it is heading for, or −1, and where on it (world units). */
  goal: number;
  goalX: number;
  /** Log ticks until it chooses again. */
  replan: number;
  /** Log ticks without progress, up to STUCK_TICKS. */
  timer: number;
  /** Slot of the rival it is after, or −1. */
  rival: number;
  /** The charge (ticks) the throw being wound up is released at; 0 when not throwing. */
  hold: number;
  /** 0 a flat throw, 1 a lob. */
  arc: number;
}
export function freshMind(): Mind {
  return {
    goal: -1,
    goalX: 0,
    edge: -1,
    hop: -1,
    task: 0,
    replan: 0,
    timer: 0,
    rival: -1,
    hold: 0,
    arc: 0,
  };
}
/** Exact keys and bounds, against the map's ledges and its real graph. */
export function decodeMind(raw: unknown, tuning: Tuning): Mind | undefined {
  const ledges = MAPS[tuning.map].platforms.length;
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 10 ||
    !integer(raw.goal, -1, ledges - 1) ||
    !integer(raw.goalX, 0, WIDTH) ||
    !integer(raw.edge, -1, navGraph(tuning).edges.length - 1) ||
    !integer(raw.hop, -1, ledges - 1) ||
    !integer(raw.task, 0, TASK_STRIKE) ||
    !integer(raw.replan, 0, REPLAN_MAX) ||
    !integer(raw.timer, 0, STUCK_TICKS) ||
    !integer(raw.rival, -1, 4) ||
    !integer(raw.hold, 0, tuning.bomb === "off" ? 0 : CHARGE_TICKS) ||
    !integer(raw.arc, 0, 1)
  )
    return;
  return {
    goal: raw.goal,
    goalX: raw.goalX,
    edge: raw.edge,
    hop: raw.hop,
    task: raw.task,
    replan: raw.replan,
    timer: raw.timer,
    rival: raw.rival,
    hold: raw.hold,
    arc: raw.arc,
  };
}
/** Stateless noise in [0, 1) from a bot id, a tick and a salt; never consumed, so replays agree. */
export function noise(id: string, tick: number, salt: number): number {
  let h = (Math.imul(tick | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  for (let i = 0; i < id.length; i++)
    h = Math.imul(h ^ id.charCodeAt(i), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}
