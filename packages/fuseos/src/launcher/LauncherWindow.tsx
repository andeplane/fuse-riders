import type { KeyboardEvent } from "react";
import { useContext, useEffect, useLayoutEffect, useRef } from "react";

import { AppIcon } from "../ui/icons";
import { WindowManagerContext } from "../windows/windowManagerContext";

import { centeredLauncherRect } from "./launcherFacts";
import type { LauncherGame, LauncherViewModel } from "./useLauncherViewModel";
import { LAUNCHER_TABS, useLauncherViewModel } from "./useLauncherViewModel";

import "./launcher.css";

export type LauncherWindowProps = {
  windowId: string;
  active: boolean;
};

function GameRowIcon({ game }: { game: LauncherGame }) {
  if (game.icon) return <AppIcon icon={game.icon} size={16} />;
  return (
    <span
      className="fst-tile"
      style={{ background: game.accent }}
      aria-hidden
      data-icon="tile"
    />
  );
}

function Screenshot({ game }: { game: LauncherGame }) {
  if (game.screenshotUrl)
    return (
      <img
        className="fst-shot-image"
        src={game.screenshotUrl}
        alt={`${game.name} screenshot`}
        draggable={false}
      />
    );
  return (
    <div
      className="fst-shot-missing"
      role="img"
      aria-label={`${game.name} has no screenshot yet`}
    >
      <span style={{ color: game.accent }}>{game.mark}</span>
    </div>
  );
}

function GamesPage({ vm, active }: { vm: LauncherViewModel; active: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  // The window that boots focused answers the arrow keys at once, like the old client's list.
  useEffect(() => {
    if (active) list.current?.focus();
  }, [active]);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (row && typeof row.scrollIntoView === "function")
      row.scrollIntoView({ block: "nearest" });
  }, [vm.selected?.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown":
        vm.selectNext();
        break;
      case "ArrowUp":
        vm.selectPrevious();
        break;
      case "Enter":
        vm.play();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const { selected, details } = vm;
  return (
    <div className="fst-games">
      <section className="fst-list-col" aria-labelledby="fst-my-games">
        <h2 className="fst-heading" id="fst-my-games">
          My Games
        </h2>
        <div className="fst-list-head" aria-hidden>
          <span>Game</span>
          <span>Status</span>
        </div>
        <ul
          ref={list}
          className="fst-list"
          role="listbox"
          aria-labelledby="fst-my-games"
          tabIndex={0}
          aria-activedescendant={
            selected ? `fst-game-${selected.id}` : undefined
          }
          onKeyDown={onKeyDown}
        >
          {vm.games.map((game) => {
            const isSelected = game.id === selected?.id;
            return (
              <li
                key={game.id}
                id={`fst-game-${game.id}`}
                role="option"
                aria-selected={isSelected}
                className={`fst-row ${isSelected ? "selected" : ""}`}
                onClick={() => vm.select(game.id)}
                onDoubleClick={() => vm.playGame(game.id)}
              >
                <GameRowIcon game={game} />
                <span className="fst-row-name">{game.name}</span>
                <span className="fst-row-status" aria-hidden>
                  Ready
                </span>
              </li>
            );
          })}
          {vm.games.length === 0 ? (
            <li className="fst-row fst-muted" aria-disabled>
              No games installed
            </li>
          ) : null}
        </ul>
      </section>
      {selected && details ? (
        <section className="fst-detail" aria-label={`${selected.name} details`}>
          <div className="fst-shot">
            <Screenshot game={selected} />
          </div>
          <h3 className="fst-name">{selected.name}</h3>
          <p className="fst-tagline">{selected.tagline}</p>
          <div className="fst-detail-row">
            <div className="fst-facts">
              <button
                type="button"
                className="fst-play"
                onClick={vm.play}
                aria-label={`Play ${selected.name}`}
              >
                <span aria-hidden>▶</span> PLAY
              </button>
              <dl className="fst-dl">
                <dt>Status:</dt>
                <dd className="fst-status">{details.status}</dd>
                <dt>Disk usage:</dt>
                <dd>{details.diskUsage}</dd>
                <dt>Last played:</dt>
                <dd>{details.lastPlayed}</dd>
              </dl>
            </div>
            <nav className="fst-links" aria-label="Links">
              <h4 className="fst-heading">Links</h4>
              <a
                className="fst-link"
                href={selected.url}
                target="_blank"
                rel="noopener"
              >
                Open in new tab
              </a>
              <a
                className="fst-link"
                href={selected.url}
                target="_blank"
                rel="noopener"
              >
                Leaderboard
              </a>
              <a
                className="fst-link"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  vm.openFriends();
                }}
              >
                Friends
              </a>
            </nav>
          </div>
        </section>
      ) : (
        <section className="fst-detail fst-empty" aria-label="No game selected">
          <p className="fst-muted">
            No Fuse games are installed on this desktop.
          </p>
        </section>
      )}
    </div>
  );
}

const NEWS_LINES = [
  "Fusteam launcher released: pick a game from MY GAMES and press PLAY.",
  "Every game on this desktop updates itself; there is nothing to download.",
];

/** Fusteam's own News page, for a build without the Hall of Fame. */
function NewsPage() {
  return (
    <div className="fst-placeholder">
      <h2 className="fst-heading">News</h2>
      <div className="fst-panel">
        {NEWS_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

/**
 * Body of the Fusteam window, after the 2004 Steam client's Games window: tabs across the top, MY GAMES on the
 * left, the selected game's screenshot and PLAY on the right, ADD A GAME... and FRIENDS & CHAT along the bottom.
 * The olive skin, including this window's own title bar, is `launcher.css`.
 */
export function LauncherWindow({ windowId, active }: LauncherWindowProps) {
  const vm = useLauncherViewModel();
  const { rects, viewport, setRect } = useContext(WindowManagerContext);
  // Opens centred on the desktop rather than in the cascade; only the first time, a moved window stays put.
  const placed = useRef(windowId in rects);
  useLayoutEffect(() => {
    if (placed.current) return;
    placed.current = true;
    setRect(windowId, centeredLauncherRect(viewport));
  }, [windowId, viewport, setRect]);

  return (
    <div className="fst-root" data-tab={vm.tab}>
      <div className="fst-tabs" role="tablist" aria-label="Fusteam">
        {LAUNCHER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`fst-tab-${tab.id}`}
            aria-selected={vm.tab === tab.id}
            aria-controls="fst-page"
            className={`fst-tab ${vm.tab === tab.id ? "selected" : ""}`}
            onClick={() => vm.openTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="fst-page"
        id="fst-page"
        role="tabpanel"
        aria-labelledby={`fst-tab-${vm.tab}`}
      >
        {vm.tab === "games" ? (
          <GamesPage vm={vm} active={active} />
        ) : (
          <NewsPage />
        )}
      </div>
      <div className="fst-footer">
        <span className="fst-wordmark" aria-label="Fusteam">
          FUSTEAM
        </span>
        <span className="fst-spacer" />
        <button type="button" className="fst-button" onClick={vm.addGame}>
          ADD A GAME...
        </button>
        <button type="button" className="fst-button" onClick={vm.openFriends}>
          FRIENDS &amp; CHAT
        </button>
      </div>
    </div>
  );
}
