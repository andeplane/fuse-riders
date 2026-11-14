import { describe, playerRecord } from "./ccbs";

/**
 * The people in the simulated channels. RiChY, Andeplane and Zredna are real members of the Norwegian DDR scene
 * who agreed to be voiced here; everyone else is fictional. Other real players appear only when CCBSbot cites
 * a result, never as members or speakers.
 */
export type Regular = {
  nick: string;
  user: string;
  host: string;
  realName: string;
  /** Prefix in the channels they sit in: `@` op, `+` voice, `` none. */
  prefix: "@" | "+" | "";
  channels: readonly string[];
  /** Who they are, for the model's system prompt. */
  persona: string;
  /** Lines they say when no model answers (no WebGPU, not downloaded, still loading). */
  lines: readonly string[];
  /** Away message for /whois. */
  away?: string;
  /** Voiced by the language model (the three real regulars and a couple of fictional ones). */
  ai: boolean;
};

export const DDR_CHANNEL = "#ddrnorway";
export const DDR_TOPIC =
  "DDR Norway | Neste: Challenge Cup på Megazone søndag kl 14 | !ccbs for resultater | EuroMix 2 forever";

function recordLine(nick: string): string {
  const record = playerRecord(nick);
  if (!record) return "";
  const best = record.best
    ? ` Best result: ${record.best.rank}. place at ${describe(record.best.tournament)}.`
    : "";
  return ` In the CCBS results you played ${record.events} ranked tournaments, ${record.wins} win(s), ${record.podiums} podium(s).${best}`;
}

const SCENE =
  "It is around 2004 in Norway. People play Dancing Stage EuroMix 2 and DDR Extreme at bowling alleys, Megazone and LAN parties like The Gathering, and meet at Challenge Cup tournaments.";

export const REGULARS: readonly Regular[] = [
  {
    nick: "RiChY",
    user: "richy",
    host: "hdc.ddr.no",
    realName: "RiChY",
    prefix: "@",
    channels: [DDR_CHANNEL],
    ai: true,
    persona: `You are RiChY, a Norwegian DDR player from club HDC. Competitive, friendly, a bit cocky about your footwork, loves hard EuroMix 2 songs.${recordLine("RiChY")}`,
    lines: [
      "noen som blir med på Megazone på søndag?",
      "PARANOiA Rebirth på heavy er fortsatt bare tull",
      "venstrepila på maskina i Askim henger igjen -_-",
      "trente doubles hele kvelden, beina er ferdige",
      "Max 300 eller ingenting",
      "hvem tar med pads til OsloLan?",
    ],
  },
  {
    nick: "Andeplane",
    user: "andeplane",
    host: "njs.ddr.no",
    realName: "Andeplane",
    prefix: "@",
    channels: [DDR_CHANNEL],
    ai: true,
    away: "koder litt, straks tilbake",
    persona: `You are Andeplane, a Norwegian DDR player from club NJS. Nerdy, enthusiastic, likes building things with computers and talking strategy and stamina.${recordLine("Andeplane")}`,
    lines: [
      "har noen prøvd å lage stepfiler selv? holder på med en",
      "Healing Vision (Angelic Mix) er undervurdert",
      "tenker å bygge en DDR-pad av MDF og en gammel tastaturkontroller",
      "stamina > teknikk, diskuter",
      "noen som har oversikt over Challenge Cup-poengene?",
    ],
  },
  {
    nick: "Zredna",
    user: "zredna",
    host: "hdc.ddr.no",
    realName: "Zredna",
    prefix: "+",
    channels: [DDR_CHANNEL],
    ai: true,
    persona: `You are Zredna, a Norwegian DDR player from club HDC. Laid-back, dry humour, often teases the others about their scores.${recordLine("Zredna")}`,
    lines: [
      "hehe",
      "jeg kom for snacksen, ble for pilene",
      "noen som så den fyren som spilte med ryggen til skjermen?",
      "Butterfly på light er egentlig mitt nivå",
      ":D",
    ],
  },
  {
    nick: "stepzilla",
    user: "stepz",
    host: "dialup-212-17.online.no",
    realName: "zilla",
    prefix: "",
    channels: [DDR_CHANNEL, "#chatzone"],
    ai: true,
    persona:
      "You are stepzilla, a fictional newcomer to DDR from Bergen. Eager, asks beginner questions, types with lots of !!! and :D.",
    lines: [
      "endelig klarte jeg Butterfly på standard!!!",
      "hvordan i all verden gjør dere crossovers? :D",
      "er det noen turneringer på vestlandet?",
      "min første AA i dag!!",
    ],
  },
  {
    nick: "FootieFox",
    user: "fox",
    host: "cable-84-48.chello.no",
    realName: "Footie",
    prefix: "",
    channels: [DDR_CHANNEL],
    ai: false,
    away: "på trening",
    persona: "You are FootieFox, a fictional DDR player who mostly idles.",
    lines: [
      "*gjesp*",
      "brb, middag",
      "noen som har pads til salgs?",
      "tilbake",
    ],
  },
  {
    nick: "CCBSbot",
    user: "ccbs",
    host: "ccbs.sesse.net",
    realName: "CCBS score bot - !ccbs for help",
    prefix: "+",
    channels: [DDR_CHANNEL],
    ai: false,
    persona: "",
    lines: [],
  },
  {
    nick: "modem_man",
    user: "modem",
    host: "dialup-55-201.tele2.no",
    realName: "56k forever",
    prefix: "@",
    channels: ["#chatzone", "#dialup"],
    ai: false,
    persona: "",
    lines: [
      "*krrrsshhhh* beeeeep",
      "mom picked up the phone again",
      "anyone else on 28.8?",
    ],
  },
  {
    nick: "Sunny_D",
    user: "sunny",
    host: "adsl-80-212.broadband.no",
    realName: "Sunny",
    prefix: "",
    channels: ["#chatzone", "#friends"],
    ai: false,
    persona: "",
    lines: ["hiya all :)", "a/s/l? jk jk", "who's going to the LAN party?"],
  },
  {
    nick: "lurker99",
    user: "lurk",
    host: "proxy.school.no",
    realName: "...",
    prefix: "",
    channels: ["#chatzone", "#help", "#friends"],
    ai: false,
    persona: "",
    lines: [],
  },
  {
    nick: "Op_Bot",
    user: "bot",
    host: "eggdrop.shell.no",
    realName: "eggdrop v1.6",
    prefix: "@",
    channels: ["#chatzone", "#help", "#friends", "#dialup", "#winamp-skins"],
    ai: false,
    persona: "",
    lines: [],
  },
];

export const SCENE_PROMPT = SCENE;

export function findRegular(nick: string): Regular | undefined {
  const wanted = nick.toLowerCase();
  return REGULARS.find((regular) => regular.nick.toLowerCase() === wanted);
}

export function regularsIn(channel: string): Regular[] {
  const wanted = channel.toLowerCase();
  return REGULARS.filter((regular) =>
    regular.channels.some((c) => c.toLowerCase() === wanted),
  );
}

/** The system prompt for one regular's next line. */
export function systemPromptFor(
  regular: Regular,
  channel: string,
  userNick: string,
): string {
  return [
    regular.persona,
    SCENE,
    `You are chatting on IRC in ${channel} with ${userNick} and others.`,
    "Reply with ONE short IRC line (at most 20 words) in the same language as the last message (Norwegian or English).",
    "No quotes, no name prefix, no emojis except :) :D ;) -_-.",
    "Never speak for, quote or pretend to be anyone else. Do not invent tournament results; only mention the ones you were told.",
  ].join(" ");
}
