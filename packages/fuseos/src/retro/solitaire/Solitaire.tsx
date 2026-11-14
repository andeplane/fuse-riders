import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useContext, useEffect, useRef, useState } from "react";

import { matchShortcut } from "../../lib/shortcuts";
import { GamesDepsContext } from "../gamesDepsContext";

import { CardBack, CardFace } from "./cardArt";
import { CARD_BACKS } from "./cardBacks";
import { CARD_SHEET_PATH } from "./cardSprite";
import { CARD_HEIGHT, CARD_WIDTH } from "./cascade";
import {
  FACE_UP_STEP,
  STOCK_POSITION,
  columnX,
  dropTarget,
  foundationPosition,
  runHeight,
  runOrigin,
  tableauCardY,
  wasteFan,
} from "./solitaireLayout";
import type {
  Card,
  DrawCount,
  Location,
  Scoring,
  SolitaireOptions,
  SolitaireState,
} from "./solitaireRules";
import { canRecycle, liftable } from "./solitaireRules";
import { useSolitaireGame } from "./useSolitaireGame";
import { WinCascade } from "./WinCascade";

export type SolitaireProps = {
  /** A known table instead of a shuffled one; tests use it. */
  initialState?: SolitaireState;
};

type Drag = {
  from: Location;
  count: number;
  cards: Card[];
  originX: number;
  originY: number;
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  moved: boolean;
};

type DialogKind = "deck" | "options" | "again";

const WASTE: Location = { pile: "waste", index: 0 };
const DRAG_THRESHOLD = 3;

const cardButtonStyle: CSSProperties = {
  position: "absolute",
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  minWidth: 0,
  minHeight: 0,
  padding: 0,
  border: "none",
  boxShadow: "none",
  background: "transparent",
  cursor: "default",
  outline: "none",
};

function placeholderStyle(x: number, y: number): CSSProperties {
  return {
    position: "absolute",
    left: x,
    top: y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 4,
    border: "1px solid #005000",
    background: "#007000",
  };
}

function inDrag(
  drag: Drag | undefined,
  location: Location,
  index: number,
  pileLength: number,
): boolean {
  return (
    !!drag &&
    drag.from.pile === location.pile &&
    drag.from.index === location.index &&
    index >= pileLength - drag.count
  );
}

/** Windows 98 Solitaire: green table, stock and waste, four foundations, seven columns, a Game menu and the score. */
export function Solitaire({ initialState }: SolitaireProps) {
  const deps = useContext(GamesDepsContext);
  const game = useSolitaireGame(initialState);
  const { state } = game;
  const sheetUrl = deps.resolveUrl(CARD_SHEET_PATH);
  const tableRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | undefined>();
  const [dismissed, setDismissed] = useState<Card[][] | undefined>();
  const [drag, setDragState] = useState<Drag | undefined>();
  const dragRef = useRef<Drag | undefined>(undefined);
  const setDrag = (next: Drag | undefined) => {
    dragRef.current = next;
    setDragState(next);
  };

  const cascading = state.status === "won" && dismissed !== state.foundations;

  const toTable = (clientX: number, clientY: number) => {
    const rect = tableRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const beginDrag = (event: ReactMouseEvent, from: Location, count: number) => {
    if (event.button !== 0 || cascading || dialog) return;
    const cards = liftable(state, from, count);
    if (cards.length === 0) return;
    event.preventDefault();
    const origin = runOrigin(state, from, count);
    const pointer = toTable(event.clientX, event.clientY);
    setDrag({
      from,
      count,
      cards,
      originX: origin.x,
      originY: origin.y,
      grabX: pointer.x - origin.x,
      grabY: pointer.y - origin.y,
      x: origin.x,
      y: origin.y,
      moved: false,
    });
  };

  const dragging = drag !== undefined;
  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: MouseEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const pointer = toTable(event.clientX, event.clientY);
      const x = pointer.x - current.grabX;
      const y = pointer.y - current.grabY;
      const moved =
        current.moved ||
        Math.abs(x - current.originX) + Math.abs(y - current.originY) >
          DRAG_THRESHOLD;
      setDrag({ ...current, x, y, moved });
    };
    const onUp = () => {
      const current = dragRef.current;
      setDrag(undefined);
      if (!current || !current.moved) return;
      const target = dropTarget(state, current.cards, {
        x: current.x,
        y: current.y,
        width: CARD_WIDTH,
        height: runHeight(current.count),
      });
      if (target) game.move(current.from, current.count, target);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, state, game]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (matchShortcut(event, "solitaire.newGame")) {
      event.preventDefault();
      game.deal();
    }
  };

  const choose = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  const fan = wasteFan(state);
  const wasteTop = fan.length - 1;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[silver]"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="relative flex shrink-0 items-center border-b border-b-[grey] px-1"
        role="menubar"
        aria-label="Solitaire menu"
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`menu-item flat px-2 ${menuOpen ? "open" : ""}`}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Game
        </button>
        {menuOpen ? (
          <ul
            role="menu"
            aria-label="Game"
            className="raised absolute left-1 top-full z-30 min-w-40 bg-[silver] py-0.5"
          >
            <MenuItem
              label="Deal"
              shortcut="F2"
              onClick={() => choose(game.deal)}
            />
            <MenuItem
              label="Undo"
              disabled={!state.previous}
              onClick={() => choose(game.undo)}
            />
            <li role="none">
              <hr className="mx-1 my-0.5 border-t border-[grey] border-b-white" />
            </li>
            <MenuItem
              label="Deck..."
              onClick={() => choose(() => setDialog("deck"))}
            />
            <MenuItem
              label="Options..."
              onClick={() => choose(() => setDialog("options"))}
            />
          </ul>
        ) : null}
      </div>
      <div
        ref={tableRef}
        role="group"
        aria-label="Table"
        data-status={state.status}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ background: "#008000" }}
      >
        <StockPile state={state} onDraw={game.draw} cardBack={state.cardBack} />
        <div role="group" aria-label="Waste">
          {fan.map(({ card, x }, i) =>
            inDrag(drag, WASTE, i, fan.length) ? null : (
              <CardButton
                key={`${card.suit}${card.rank}`}
                card={card}
                sheetUrl={sheetUrl}
                x={x}
                y={STOCK_POSITION.y}
                onMouseDown={
                  i === wasteTop
                    ? (event) => beginDrag(event, WASTE, 1)
                    : undefined
                }
                onDoubleClick={
                  i === wasteTop ? () => game.autoMove(WASTE) : undefined
                }
              />
            ),
          )}
        </div>
        {state.foundations.map((pile, index) => {
          const location: Location = { pile: "foundation", index };
          const position = foundationPosition(index);
          const shown = pile.filter(
            (_, i) => !inDrag(drag, location, i, pile.length),
          );
          const topCard = shown[shown.length - 1];
          return (
            <div
              key={index}
              role="group"
              aria-label={`Foundation ${index + 1}`}
            >
              <div style={placeholderStyle(position.x, position.y)} />
              {topCard ? (
                <CardButton
                  card={topCard}
                  sheetUrl={sheetUrl}
                  x={position.x}
                  y={position.y}
                  onMouseDown={(event) => beginDrag(event, location, 1)}
                />
              ) : null}
            </div>
          );
        })}
        {state.tableau.map((pile, index) => {
          const location: Location = { pile: "tableau", index };
          return (
            <div key={index} role="group" aria-label={`Column ${index + 1}`}>
              {pile.length === 0 ? (
                <div
                  style={placeholderStyle(
                    columnX(index),
                    tableauCardY(pile, 0),
                  )}
                />
              ) : null}
              {pile.map((card, i) => {
                if (inDrag(drag, location, i, pile.length)) return null;
                const y = tableauCardY(pile, i);
                const isTop = i === pile.length - 1;
                if (!card.faceUp)
                  return (
                    <CardBack
                      key={i}
                      design={state.cardBack}
                      style={{
                        position: "absolute",
                        left: columnX(index),
                        top: y,
                      }}
                    />
                  );
                return (
                  <CardButton
                    key={`${card.suit}${card.rank}`}
                    card={card}
                    sheetUrl={sheetUrl}
                    x={columnX(index)}
                    y={y}
                    onMouseDown={(event) =>
                      beginDrag(event, location, pile.length - i)
                    }
                    onDoubleClick={
                      isTop ? () => game.autoMove(location) : undefined
                    }
                  />
                );
              })}
            </div>
          );
        })}
        {drag && drag.moved ? (
          <div
            aria-label="Dragged cards"
            className="pointer-events-none absolute z-10"
            style={{
              left: drag.x,
              top: drag.y,
              width: CARD_WIDTH,
              height: runHeight(drag.count),
            }}
          >
            {drag.cards.map((card, i) => (
              <CardFace
                key={`${card.suit}${card.rank}`}
                card={card}
                sheetUrl={sheetUrl}
                style={{ position: "absolute", left: 0, top: i * FACE_UP_STEP }}
              />
            ))}
          </div>
        ) : null}
        {cascading ? (
          <WinCascade
            foundations={state.foundations}
            onDone={() => {
              setDismissed(state.foundations);
              setDialog("again");
            }}
          />
        ) : null}
        {dialog === "deck" ? (
          <DeckDialog
            current={state.cardBack}
            onOk={(design) => {
              game.setCardBack(design);
              setDialog(undefined);
            }}
            onCancel={() => setDialog(undefined)}
          />
        ) : null}
        {dialog === "options" ? (
          <OptionsDialog
            current={state.options}
            onOk={(options) => {
              game.setOptions(options);
              setDialog(undefined);
            }}
            onCancel={() => setDialog(undefined)}
          />
        ) : null}
        {dialog === "again" ? (
          <Dialog title="Solitaire">
            <p>Deal again?</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                className="default"
                autoFocus
                onClick={() => {
                  setDialog(undefined);
                  game.deal();
                }}
              >
                Yes
              </button>
              <button type="button" onClick={() => setDialog(undefined)}>
                No
              </button>
            </div>
          </Dialog>
        ) : null}
      </div>
      <div className="status-bar flex shrink-0">
        <p className="status-bar-field flex-1" />
        <p className="status-bar-field whitespace-pre" style={{ flexGrow: 0 }}>
          Score: <output aria-label="Score">{game.score}</output>
          {state.options.timed ? (
            <>
              {"   Time: "}
              <output aria-label="Time">{game.time}</output>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

type MenuItemProps = {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
};

function MenuItem({ label, shortcut, disabled, onClick }: MenuItemProps) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        className="menu-item flat flex w-full justify-between gap-6 px-4 py-0.5 text-left disabled:text-[grey]"
        onClick={onClick}
      >
        <span>{label}</span>
        {shortcut ? <span>{shortcut}</span> : null}
      </button>
    </li>
  );
}

type CardButtonProps = {
  card: Card;
  sheetUrl: string;
  x: number;
  y: number;
  onMouseDown?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
};

function CardButton({
  card,
  sheetUrl,
  x,
  y,
  onMouseDown,
  onDoubleClick,
}: CardButtonProps) {
  return (
    <button
      type="button"
      data-card={`${card.suit}${card.rank}`}
      style={{ ...cardButtonStyle, left: x, top: y }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <CardFace card={card} sheetUrl={sheetUrl} />
    </button>
  );
}

type StockPileProps = {
  state: SolitaireState;
  cardBack: number;
  onDraw: () => void;
};

function StockPile({ state, cardBack, onDraw }: StockPileProps) {
  const empty = state.stock.length === 0;
  const recyclable = canRecycle(state);
  const label = empty
    ? recyclable
      ? "Stock, empty, click to go through the deck again"
      : "Stock, empty"
    : `Stock, ${state.stock.length} cards`;
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        ...cardButtonStyle,
        left: STOCK_POSITION.x,
        top: STOCK_POSITION.y,
      }}
      onClick={onDraw}
    >
      {empty ? (
        <span
          style={placeholderStyle(0, 0)}
          className="flex items-center justify-center"
        >
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
            {recyclable ? (
              <circle
                cx="20"
                cy="20"
                r="15"
                fill="none"
                stroke="#00ff00"
                strokeWidth="4"
              />
            ) : (
              <path
                d="M6 6 L34 34 M34 6 L6 34"
                stroke="#ff0000"
                strokeWidth="4"
              />
            )}
          </svg>
        </span>
      ) : (
        <CardBack design={cardBack} />
      )}
    </button>
  );
}

type DialogProps = { title: string; children: ReactNode };

function Dialog({ title, children }: DialogProps) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="window absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ minWidth: 220 }}
    >
      <div className="title-bar">
        <div className="title-bar-text">{title}</div>
      </div>
      <div className="window-body flex flex-col gap-3">{children}</div>
    </div>
  );
}

type DeckDialogProps = {
  current: number;
  onOk: (design: number) => void;
  onCancel: () => void;
};

function DeckDialog({ current, onOk, onCancel }: DeckDialogProps) {
  const [chosen, setChosen] = useState(current);
  return (
    <Dialog title="Select Card Back">
      <div className="grid grid-cols-6 gap-1">
        {CARD_BACKS.map((design, i) => (
          <button
            key={design.name}
            type="button"
            aria-label={design.name}
            aria-pressed={chosen === i}
            className="p-0"
            style={{
              minWidth: 0,
              minHeight: 0,
              padding: 2,
              boxShadow: "none",
              background: "transparent",
              border: `2px solid ${chosen === i ? "#000" : "transparent"}`,
            }}
            onClick={() => setChosen(i)}
            onDoubleClick={() => onOk(i)}
          >
            <CardBack design={i} />
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="default" onClick={() => onOk(chosen)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

type OptionsDialogProps = {
  current: SolitaireOptions;
  onOk: (options: SolitaireOptions) => void;
  onCancel: () => void;
};

const DRAW_CHOICES: { value: DrawCount; label: string }[] = [
  { value: 1, label: "Draw one" },
  { value: 3, label: "Draw three" },
];
const SCORING_CHOICES: { value: Scoring; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "vegas", label: "Vegas" },
  { value: "none", label: "None" },
];

function OptionsDialog({ current, onOk, onCancel }: OptionsDialogProps) {
  const [draft, setDraft] = useState(current);
  return (
    <Dialog title="Options">
      <div className="flex gap-4">
        <fieldset>
          <legend>Draw</legend>
          {DRAW_CHOICES.map((choice) => (
            <div key={choice.value} className="field-row">
              <input
                id={`solitaire-draw-${choice.value}`}
                type="radio"
                name="solitaire-draw"
                checked={draft.draw === choice.value}
                onChange={() => setDraft({ ...draft, draw: choice.value })}
              />
              <label htmlFor={`solitaire-draw-${choice.value}`}>
                {choice.label}
              </label>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>Scoring</legend>
          {SCORING_CHOICES.map((choice) => (
            <div key={choice.value} className="field-row">
              <input
                id={`solitaire-scoring-${choice.value}`}
                type="radio"
                name="solitaire-scoring"
                checked={draft.scoring === choice.value}
                onChange={() => setDraft({ ...draft, scoring: choice.value })}
              />
              <label htmlFor={`solitaire-scoring-${choice.value}`}>
                {choice.label}
              </label>
            </div>
          ))}
        </fieldset>
      </div>
      <div className="field-row">
        <input
          id="solitaire-timed"
          type="checkbox"
          checked={draft.timed}
          onChange={(event) =>
            setDraft({ ...draft, timed: event.target.checked })
          }
        />
        <label htmlFor="solitaire-timed">Timed game</label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="default" onClick={() => onOk(draft)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
