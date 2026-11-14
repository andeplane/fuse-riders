import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestGamesDeps } from "../../__mocks__/renderWithProviders";
import type { GamesDeps } from "../gamesDepsContext";
import { GamesDepsContext } from "../gamesDepsContext";

import { Solitaire } from "./Solitaire";
import {
  TABLEAU_TOP,
  TABLE_TOP,
  columnX,
  foundationPosition,
  runOrigin,
} from "./solitaireLayout";
import type { Card, SolitaireState, Suit } from "./solitaireRules";
import { DEFAULT_OPTIONS, KING, deal } from "./solitaireRules";

const T0 = Date.UTC(1998, 5, 25, 12, 0, 0);

describe(Solitaire.name, () => {
  it("deals a table with the stock, empty foundations, seven columns and a zero score", () => {
    renderGame();
    expect(
      screen.getByRole("button", { name: "Stock, 24 cards" }),
    ).toBeInTheDocument();
    expect(within(column(1)).getAllByRole("img")).toHaveLength(1);
    expect(within(column(7)).getAllByRole("img")).toHaveLength(7);
    expect(
      within(column(7)).getAllByRole("img", { name: "Face down card" }),
    ).toHaveLength(6);
    expect(
      within(screen.getByRole("group", { name: "Waste" })).queryAllByRole(
        "img",
      ),
    ).toHaveLength(0);
    expect(
      within(
        screen.getByRole("group", { name: "Foundation 1" }),
      ).queryAllByRole("img"),
    ).toHaveLength(0);
    expect(screen.getByLabelText("Score")).toHaveTextContent("0");
    expect(screen.getByLabelText("Time")).toHaveTextContent("0");
    expect(screen.getByRole("group", { name: "Table" })).toHaveAttribute(
      "data-status",
      "ready",
    );
  });

  it("draws three cards onto the waste when the stock is clicked and runs the clock", async () => {
    // Arrange: a clock that is 15 seconds on when the subscription ticks.
    let tick: (() => void) | undefined;
    let now = T0;
    const user = userEvent.setup();
    renderGame(undefined, {
      now: () => now,
      subscribeSeconds: (onTick) => {
        tick = onTick;
        return () => undefined;
      },
    });
    // Act
    await user.click(screen.getByRole("button", { name: "Stock, 24 cards" }));
    // Assert
    expect(
      within(screen.getByRole("group", { name: "Waste" })).getAllByRole("img"),
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Stock, 21 cards" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Table" })).toHaveAttribute(
      "data-status",
      "playing",
    );
    now = T0 + 15000;
    act(() => tick?.());
    expect(screen.getByLabelText("Time")).toHaveTextContent("15");
  });

  it("drags a run onto another column, turns the card it uncovers and scores it", () => {
    const state = table({
      tableau: [
        [card("S", 9, false), card("H", 8), card("C", 7)],
        [card("C", 9)],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    renderGame(state);
    // Act: pick up the eight and the seven, carry them over column 2, let go.
    const origin = runOrigin(state, { pile: "tableau", index: 0 }, 2);
    fireEvent.mouseDown(screen.getByRole("button", { name: "8 of hearts" }), {
      clientX: origin.x + 10,
      clientY: origin.y + 10,
    });
    fireEvent.mouseMove(window, {
      clientX: columnX(1) + 10,
      clientY: TABLEAU_TOP + 10,
    });
    expect(
      within(screen.getByLabelText("Dragged cards")).getAllByRole("img"),
    ).toHaveLength(2);
    expect(
      within(column(1)).queryByRole("img", { name: "8 of hearts" }),
    ).toBeNull();
    fireEvent.mouseUp(window);
    // Assert
    expect(
      within(column(2))
        .getAllByRole("img")
        .map((img) => img.getAttribute("aria-label")),
    ).toEqual(["9 of clubs", "8 of hearts", "7 of clubs"]);
    expect(
      within(column(1)).getByRole("img", { name: "9 of spades" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Score")).toHaveTextContent("5");
    expect(screen.queryByLabelText("Dragged cards")).toBeNull();
  });

  it("puts the cards back when they are dropped somewhere they do not fit", () => {
    const state = table({
      tableau: [[card("C", 7)], [card("S", 8)], [], [], [], [], []],
    });
    renderGame(state);
    const origin = runOrigin(state, { pile: "tableau", index: 0 }, 1);
    fireEvent.mouseDown(screen.getByRole("button", { name: "7 of clubs" }), {
      clientX: origin.x + 5,
      clientY: origin.y + 5,
    });
    fireEvent.mouseMove(window, {
      clientX: columnX(1) + 5,
      clientY: TABLEAU_TOP + 5,
    });
    fireEvent.mouseUp(window);
    expect(
      within(column(1)).getByRole("img", { name: "7 of clubs" }),
    ).toBeInTheDocument();
    expect(within(column(2)).getAllByRole("img")).toHaveLength(1);
    expect(screen.getByLabelText("Score")).toHaveTextContent("0");
  });

  it("sends a card to its foundation on double click and scores ten", () => {
    renderGame(table({ waste: [card("H", 1)], fanned: 1 }));
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Ace of hearts" }),
    );
    expect(
      within(screen.getByRole("group", { name: "Foundation 1" })).getByRole(
        "img",
        { name: "Ace of hearts" },
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Score")).toHaveTextContent("10");
  });

  it("shows the winning cascade and offers a new deal when it has run", async () => {
    // Arrange: a frame clock the test drives.
    let frame: (() => void) | undefined;
    const user = userEvent.setup();
    renderGame(almostWon(), {
      subscribeFrames: (onFrame) => {
        frame = onFrame;
        return () => {
          frame = undefined;
        };
      },
    });
    // Act: the last king goes up.
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "King of spades" }),
    );
    expect(screen.getByRole("group", { name: "Table" })).toHaveAttribute(
      "data-status",
      "won",
    );
    expect(screen.getByLabelText("Winning cascade")).toBeInTheDocument();
    act(() => {
      for (let i = 0; i < 20000 && frame; i += 1) frame();
    });
    // Assert
    expect(screen.queryByLabelText("Winning cascade")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Solitaire" });
    expect(dialog).toHaveTextContent("Deal again?");
    await user.click(within(dialog).getByRole("button", { name: "Yes" }));
    expect(
      screen.getByRole("button", { name: "Stock, 24 cards" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Table" })).toHaveAttribute(
      "data-status",
      "ready",
    );
  });

  it("skips the cascade with a click and keeps the table when the player declines", async () => {
    const user = userEvent.setup();
    renderGame(almostWon());
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "King of spades" }),
    );
    await user.click(screen.getByLabelText("Winning cascade"));
    await user.click(screen.getByRole("button", { name: "No" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Winning cascade")).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Foundation 4" })).getByRole(
        "img",
        { name: "King of spades" },
      ),
    ).toBeInTheDocument();
  });

  it("undoes the last move from the Game menu", async () => {
    const user = userEvent.setup();
    renderGame();
    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    expect(screen.getByRole("menuitem", { name: /Undo/ })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("button", { name: "Stock, 24 cards" }));
    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("menuitem", { name: /Undo/ }));
    expect(
      screen.getByRole("button", { name: "Stock, 24 cards" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Waste" })).queryAllByRole(
        "img",
      ),
    ).toHaveLength(0);
  });

  it("changes the card back through the Deck dialog", async () => {
    const user = userEvent.setup();
    renderGame();
    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("menuitem", { name: "Deck..." }));
    const dialog = screen.getByRole("dialog", { name: "Select Card Back" });
    expect(
      within(dialog).getByRole("button", { name: "Blue diamonds" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(dialog).getByRole("button", { name: "Robot" }));
    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      within(screen.getByRole("button", { name: "Stock, 24 cards" })).getByRole(
        "img",
      ),
    ).toHaveAttribute("data-back", "Robot");
  });

  it("picks a card back with a double click, and Cancel in either dialog changes nothing", async () => {
    const user = userEvent.setup();
    renderGame();
    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("menuitem", { name: "Deck..." }));
    const deck = screen.getByRole("dialog", { name: "Select Card Back" });
    await user.click(within(deck).getByRole("button", { name: "Robot" }));
    await user.click(within(deck).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const stock = () =>
      within(screen.getByRole("button", { name: "Stock, 24 cards" })).getByRole(
        "img",
      );
    expect(stock()).toHaveAttribute("data-back", "Blue diamonds");

    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("menuitem", { name: "Deck..." }));
    await user.dblClick(
      within(
        screen.getByRole("dialog", { name: "Select Card Back" }),
      ).getByRole("button", { name: "Robot" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stock()).toHaveAttribute("data-back", "Robot");

    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("menuitem", { name: "Options..." }));
    const options = screen.getByRole("dialog", { name: "Options" });
    await user.click(within(options).getByLabelText("Draw one"));
    await user.click(within(options).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Still dealing three: the stock is untouched and the waste takes three on a click.
    await user.click(screen.getByRole("button", { name: "Stock, 24 cards" }));
    expect(
      screen.getByRole("button", { name: "Stock, 21 cards" }),
    ).toBeInTheDocument();
  });

  it("redeals with the options chosen in the Options dialog", async () => {
    const user = userEvent.setup();
    renderGame();
    await user.click(screen.getByRole("menuitem", { name: "Game" }));
    await user.click(screen.getByRole("menuitem", { name: "Options..." }));
    const dialog = screen.getByRole("dialog", { name: "Options" });
    await user.click(within(dialog).getByLabelText("Draw one"));
    await user.click(within(dialog).getByLabelText("Vegas"));
    await user.click(within(dialog).getByLabelText("Timed game"));
    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.getByLabelText("Score")).toHaveTextContent("$-52");
    expect(screen.queryByLabelText("Time")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stock, 24 cards" }));
    expect(
      within(screen.getByRole("group", { name: "Waste" })).getAllByRole("img"),
    ).toHaveLength(1);
  });

  it("marks an empty stock with a ring when the waste can be turned over and an X when it cannot", () => {
    renderGame(table({ stock: [], waste: [card("S", 5)], fanned: 1 }));
    expect(
      screen.getByRole("button", {
        name: "Stock, empty, click to go through the deck again",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Stock, empty/ }));
    expect(
      screen.getByRole("button", { name: "Stock, 1 cards" }),
    ).toBeInTheDocument();
  });

  it("lays out the foundations on the top row and the columns under them", () => {
    renderGame(
      table({
        foundations: [[card("C", 1)], [], [], []],
        tableau: [[card("S", 9)], [], [], [], [], [], []],
      }),
    );
    const ace = screen.getByRole("button", { name: "Ace of clubs" });
    expect(ace).toHaveStyle({
      left: `${foundationPosition(0).x}px`,
      top: `${TABLE_TOP}px`,
    });
    expect(screen.getByRole("button", { name: "9 of spades" })).toHaveStyle({
      left: `${columnX(0)}px`,
      top: `${TABLEAU_TOP}px`,
    });
  });
});

function renderGame(
  initial?: SolitaireState,
  overrides: Partial<GamesDeps> = {},
) {
  const deps = createTestGamesDeps(overrides);
  return render(
    <GamesDepsContext.Provider value={deps}>
      <Solitaire initialState={initial} />
    </GamesDepsContext.Provider>,
  );
}

function column(number: number): HTMLElement {
  return screen.getByRole("group", { name: `Column ${number}` });
}

function card(suit: Suit, rank: number, faceUp = true): Card {
  return { suit, rank, faceUp };
}

function table(overrides: Partial<SolitaireState>): SolitaireState {
  return {
    ...deal(DEFAULT_OPTIONS, () => 0.5),
    stock: [card("D", 2, false), card("D", 3, false)],
    waste: [],
    fanned: 0,
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    ...overrides,
  };
}

/** Everything on the foundations but the king of spades, which sits on the waste. */
function almostWon(): SolitaireState {
  const foundations = (["H", "D", "C", "S"] as const).map((suit) =>
    Array.from({ length: suit === "S" ? KING - 1 : KING }, (_, i) =>
      card(suit, i + 1),
    ),
  );
  return table({
    status: "playing",
    startedAt: T0,
    stock: [],
    waste: [card("S", KING)],
    fanned: 1,
    foundations,
  });
}
