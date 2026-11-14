import { render, screen } from "@testing-library/react";

import { CardBack, CardFace } from "./cardArt";
import { CARD_BACKS } from "./cardBacks";
import { CARD_SHEET_PATH, faceStyle, spriteOffset } from "./cardSprite";
import { CARD_HEIGHT, CARD_WIDTH } from "./cascade";

const SHEET = "https://fuseos.test/fuse-riders/games/solitaire/cards.png";

describe(spriteOffset.name, () => {
  it("finds ace to king along a row and clubs, diamonds, hearts, spades down the sheet", () => {
    expect(spriteOffset({ suit: "C", rank: 1, faceUp: true })).toEqual({
      x: 0,
      y: 0,
    });
    expect(spriteOffset({ suit: "D", rank: 13, faceUp: true })).toEqual({
      x: 12 * CARD_WIDTH,
      y: CARD_HEIGHT,
    });
    expect(spriteOffset({ suit: "H", rank: 7, faceUp: true })).toEqual({
      x: 6 * CARD_WIDTH,
      y: 2 * CARD_HEIGHT,
    });
    expect(spriteOffset({ suit: "S", rank: 10, faceUp: true })).toEqual({
      x: 9 * CARD_WIDTH,
      y: 3 * CARD_HEIGHT,
    });
  });
});

describe(faceStyle.name, () => {
  it("shows one 71x96 cell of the sheet", () => {
    const style = faceStyle({ suit: "S", rank: 10, faceUp: true }, SHEET);
    expect(style).toMatchObject({
      width: 71,
      height: 96,
      backgroundImage: `url("${SHEET}")`,
      backgroundPosition: "-639px -288px",
      backgroundSize: "923px 384px",
    });
    expect(CARD_SHEET_PATH).toBe("games/solitaire/cards.png");
  });
});

describe(CardFace.name, () => {
  it("names the card for screen readers", () => {
    render(
      <CardFace
        card={{ suit: "H", rank: 12, faceUp: true }}
        sheetUrl={SHEET}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Queen of hearts" }),
    ).toBeInTheDocument();
  });
});

describe(CardBack.name, () => {
  it("ships twelve designs and falls back to the first for an unknown one", () => {
    expect(CARD_BACKS).toHaveLength(12);
    expect(new Set(CARD_BACKS.map((back) => back.name)).size).toBe(12);
    render(<CardBack design={4} />);
    expect(screen.getByRole("img", { name: "Face down card" })).toHaveAttribute(
      "data-back",
      "Robot",
    );
    render(<CardBack design={99} />);
    expect(
      screen.getAllByRole("img", { name: "Face down card" })[1],
    ).toHaveAttribute("data-back", CARD_BACKS[0]?.name ?? "");
  });
});
