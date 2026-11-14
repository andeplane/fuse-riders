import {
  describe as describeTournament,
  placements,
  playerRecord,
} from "./ccbs";

/**
 * Players on http://ccbs.sesse.net/players.pl with at least {@link CCBS_CHANNEL_MIN_TOURNAMENTS}
 * tournaments. Snapshot taken 2026-11-14 (265 players on the page, 66 of them here). They sit in
 * #ddrnorway and the language model speaks as them from these public results. RiChY, Andeplane and
 * Zredna keep the hand-written personas in `regulars.ts`; everyone else gets {@link ccbsPersona}.
 *
 * `Tha Dragon` is written with a space on CCBS. {@link ircNick} seats that player as `Tha_Dragon`.
 */
export type CcbsListedPlayer = {
  /** Nick as written on players.pl. */
  nick: string;
  tournaments: number;
  /** Club cell on players.pl. Empty when CCBS lists none. */
  club: string;
};

export const CCBS_CHANNEL_MIN_TOURNAMENTS = 5;

export const CCBS_PLAYERS_SOURCE = "http://ccbs.sesse.net/players.pl";

export const CCBS_LISTED_PLAYERS: readonly CcbsListedPlayer[] = [
  { nick: "Abra", tournaments: 5, club: "DDR Hardcore" },
  { nick: "Advena", tournaments: 8, club: "" },
  { nick: "Al", tournaments: 15, club: "DDR Ninjas" },
  { nick: "Andeplane", tournaments: 16, club: "DDR Ninjas" },
  { nick: "AndeY", tournaments: 7, club: "DDR Hardcore" },
  { nick: "Athena", tournaments: 13, club: "DDR Hardcore" },
  { nick: "Auby", tournaments: 5, club: "" },
  { nick: "Bonzo", tournaments: 17, club: "DDR Hardcore" },
  { nick: "Cehtna", tournaments: 6, club: "DDR Ninjas" },
  { nick: "Cuivien", tournaments: 12, club: "DDR Hardcore" },
  { nick: "Daniil", tournaments: 24, club: "DDR Hardcore" },
  { nick: "Draconia", tournaments: 26, club: "DDR Hardcore" },
  { nick: "Duckling", tournaments: 18, club: "Nonstop DDR" },
  { nick: "DufF", tournaments: 29, club: "DDR Hardcore" },
  { nick: "Electron", tournaments: 5, club: "DDR Oslo" },
  { nick: "Electus", tournaments: 5, club: "" },
  { nick: "Eruanna", tournaments: 18, club: "Nonstop DDR" },
  { nick: "Felz", tournaments: 5, club: "" },
  { nick: "Glock", tournaments: 9, club: "DDR Ninjas" },
  { nick: "Gogo", tournaments: 12, club: "DDR Ninjas" },
  { nick: "Haggar", tournaments: 19, club: "Fredrikstad Badgers" },
  { nick: "Havok", tournaments: 18, club: "" },
  { nick: "Haz", tournaments: 5, club: "" },
  { nick: "Hyper", tournaments: 14, club: "DDR Hardcore" },
  { nick: "Hypern", tournaments: 5, club: "" },
  { nick: "Indy", tournaments: 11, club: "DDR Hardcore" },
  { nick: "Jallaman", tournaments: 6, club: "" },
  { nick: "JonAnders", tournaments: 16, club: "Nonstop DDR" },
  { nick: "kjmcw", tournaments: 13, club: "" },
  { nick: "Lejordet", tournaments: 10, club: "" },
  { nick: "Marilla", tournaments: 11, club: "Nonstop DDR" },
  { nick: "Matsi", tournaments: 23, club: "DDR Hardcore" },
  { nick: "Mulefisk", tournaments: 11, club: "" },
  { nick: "Mync", tournaments: 7, club: "" },
  { nick: "Nameless", tournaments: 16, club: "Fredrikstad Badgers" },
  { nick: "Nuust", tournaments: 8, club: "" },
  { nick: "OJK", tournaments: 19, club: "Nonstop DDR" },
  { nick: "Olemann", tournaments: 14, club: "DDR Hardcore" },
  { nick: "Oliyzia", tournaments: 20, club: "DDR Hardcore" },
  { nick: "Pfxp", tournaments: 9, club: "" },
  { nick: "Pingo", tournaments: 5, club: "" },
  { nick: "Purity", tournaments: 9, club: "" },
  { nick: "Pyro", tournaments: 14, club: "DDR Ninjas" },
  { nick: "RiChY", tournaments: 30, club: "DDR Hardcore" },
  { nick: "Sesse", tournaments: 6, club: "Nidaros Maskindansarlaug" },
  { nick: "SLC", tournaments: 6, club: "Crash DDR" },
  { nick: "Slusk", tournaments: 11, club: "" },
  { nick: "Smiph", tournaments: 30, club: "DDR Hardcore" },
  { nick: "Snofox", tournaments: 12, club: "" },
  { nick: "Snute", tournaments: 36, club: "DDR Hardcore" },
  { nick: "Soli", tournaments: 5, club: "" },
  { nick: "Spinnvill", tournaments: 7, club: "" },
  { nick: "Stream", tournaments: 9, club: "DDR Hardcore" },
  { nick: "Telc", tournaments: 8, club: "" },
  { nick: "Th0rny", tournaments: 8, club: "" },
  { nick: "Tha Dragon", tournaments: 6, club: "" },
  { nick: "T|na", tournaments: 22, club: "Nonstop DDR" },
  { nick: "Tom", tournaments: 14, club: "" },
  { nick: "Trond", tournaments: 6, club: "" },
  { nick: "uSimen", tournaments: 10, club: "" },
  { nick: "Vampyro", tournaments: 5, club: "" },
  { nick: "ViD", tournaments: 6, club: "" },
  { nick: "Yeye", tournaments: 7, club: "" },
  { nick: "Ylini", tournaments: 24, club: "DDR Hardcore" },
  { nick: "Zax", tournaments: 7, club: "DDR Hardcore" },
  { nick: "Zredna", tournaments: 8, club: "DDR Hardcore" },
];

/** IRC nick for a CCBS name. Spaces become underscores; everything else is kept. */
export function ircNick(name: string): string {
  return name.trim().replace(/\s+/g, "_");
}

/** Who the conversation draws from, weighted by tournaments on players.pl. */
export function sceneCandidates(): { nick: string; weight: number }[] {
  return CCBS_LISTED_PLAYERS.map((player) => ({
    nick: ircNick(player.nick),
    weight: player.tournaments,
  }));
}

/**
 * What the model is allowed to know about a player: the players.pl row and the top-eight finishes in
 * the bundled tournament pages. No invented personality.
 */
export function ccbsPersona(player: CcbsListedPlayer): string {
  const nick = ircNick(player.nick);
  const club = player.club.length > 0 ? ` Club on CCBS: ${player.club}.` : "";
  const record = playerRecord(player.nick);
  const listed =
    record === undefined
      ? " The published top-eight lists do not include you."
      : ` In the published top eights you appear ${record.events} time(s), with ${record.wins} win(s) and ${record.podiums} podium(s).${
          record.best
            ? ` Best finish there: ${record.best.rank}. at ${describeTournament(record.best.tournament)}.`
            : ""
        }`;
  const notable = placements(player.nick)
    .sort(
      (a, b) =>
        a.rank - b.rank || b.tournament.date.localeCompare(a.tournament.date),
    )
    .slice(0, 6)
    .sort((a, b) => a.tournament.date.localeCompare(b.tournament.date))
    .map(
      (row) =>
        `${row.rank}. at ${row.tournament.name} (${row.tournament.date}, ${row.tournament.place})`,
    );
  const results =
    notable.length > 0
      ? ` Results you may mention: ${notable.join("; ")}.`
      : "";
  return [
    `You are ${nick}, a Norwegian DDR player on IRC.${club}`,
    `CCBS lists you with ${player.tournaments} tournaments.${listed}${results}`,
    "Speak as yourself: one short casual line. Do not invent results, songs, clubs or private details you were not given. Never speak for anyone else.",
  ].join(" ");
}

/** One true sentence when the model is not answering, so a direct message still gets a reply. */
export function fallbackLine(nick: string): string | undefined {
  const player = CCBS_LISTED_PLAYERS.find(
    (entry) => ircNick(entry.nick).toLowerCase() === nick.toLowerCase(),
  );
  if (!player) return undefined;
  const record = playerRecord(player.nick);
  const best = record?.best
    ? ` Beste: ${record.best.rank}. plass i ${record.best.tournament.name}.`
    : "";
  return `${player.tournaments} turneringer på CCBS.${best}`;
}
