import { isValidNick } from "../mircPrefs";

import { placements } from "./ccbs";
import {
  CCBS_CHANNEL_MIN_TOURNAMENTS,
  CCBS_LISTED_PLAYERS,
  fallbackLine,
  ircNick,
} from "./ddrPlayers";
import { DDR_CHANNEL, findRegular, regularsIn } from "./regulars";

describe("CCBS players in #ddrnorway", () => {
  it("snapshots everyone with at least five tournaments, as valid unique nicks", () => {
    expect(CCBS_LISTED_PLAYERS.length).toBe(66);
    expect(
      CCBS_LISTED_PLAYERS.every(
        (player) => player.tournaments >= CCBS_CHANNEL_MIN_TOURNAMENTS,
      ),
    ).toBe(true);
    const nicks = CCBS_LISTED_PLAYERS.map((player) => ircNick(player.nick));
    expect(new Set(nicks.map((nick) => nick.toLowerCase())).size).toBe(
      nicks.length,
    );
    for (const nick of nicks) expect(isValidNick(nick)).toBe(true);
    expect(ircNick("Tha Dragon")).toBe("Tha_Dragon");
  });

  it("seats every one of them and models them from their results", () => {
    const seated = regularsIn(DDR_CHANNEL);
    for (const player of CCBS_LISTED_PLAYERS) {
      const regular = findRegular(ircNick(player.nick));
      expect(regular?.channels).toContain(DDR_CHANNEL);
      expect(regular?.ai).toBe(true);
      expect(regular?.persona.length).toBeGreaterThan(0);
    }
    expect(seated.length).toBeGreaterThan(CCBS_LISTED_PLAYERS.length);
    const snute = findRegular("Snute");
    expect(snute?.persona).toContain("36 tournaments");
    expect(snute?.persona).toContain("Results you may mention:");
    expect(placements("Snute").length).toBeGreaterThan(0);
    expect(fallbackLine("Snute")).toContain("36 turneringer");
    expect(findRegular("Tha_Dragon")?.realName).toBe("Tha Dragon");
    expect(findRegular("Snute")?.realName).toBe("Snute (DDR Hardcore)");
    expect(findRegular("RiChY")?.persona).toContain("You are RiChY");
    expect(findRegular("RiChY")?.host).toBe("hdc.ddr.no");
  });
});
