import type {
  Action,
  MapDefinition,
  World,
  Outcome,
  Player,
} from "../engine/types.js";
import {
  AI_STRATEGIES,
  isAiStrategy,
  type AiStrategy,
} from "../engine/types.js";
import { loadMap, RULES } from "../engine/index.js";
import { updateContent } from "./dom-update.js";
import { minimapMarkup, minimapCell } from "../render/minimap.js";
import { battleFocusCell } from "../render/battle-focus.js";
import { structureArt, teamArtFilter } from "../render/art.js";
import type { PresentationAudio } from "./audio.js";
import { createAttractScene } from "./attract-scene.js";
import {
  renderBoard,
  hexPoints,
  structureArtwork,
  neuronPortraitUrl,
  type BoardAnimation,
} from "../render/board.js";
import type { BoardCamera, CameraFactory } from "../render/camera.js";
import type { LightRenderer } from "../render/light-field.js";
import { ROOM_MAPS, bundledMap } from "../online/maps.js";
import { TEAM_PALETTES } from "../render/creep.js";

const TEAM_COLORS = TEAM_PALETTES.map((p) => p.glow);
import { POWERUP_STYLE } from "../render/powerup-art.js";
import { sporeIconUrl } from "../render/spore-art.js";
import { POWERUP_PRESENTATION } from "../engine/powerups.js";
import {
  isBuildKind,
  canAttack,
  STRUCTURES,
  isResearchKind,
  constructionAvailability,
  constructionQueueAvailability,
  constructionUpgradeSource,
  CONSTRUCTIONS,
  constructionDispatchAvailability,
  type BuildKind,
} from "../engine/catalog.js";
import {
  renderCommands,
  commandPageCount,
  RESEARCH_PRESENTATION,
  BUILD_PRESENTATION,
  requirementText,
  type CommandPanel,
} from "./command-card.js";
import type {
  GameMode,
  MapRepository,
  MapSummary,
  NeuralSession,
  PreferencesStore,
  PresentationPreferences,
  SessionFactory,
  OnlineDependencies,
  OnlineSession,
  RoomSnapshot,
} from "./contracts.js";

type Screen = "menu" | "settings" | "setup" | "game" | "multiplayer" | "room";
type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function units(value: number): string {
  return (value / 1000).toFixed(1);
}

/** Active powerup buffs with their remaining seconds. */
function buffChips(world: Readonly<World>, player: Player): string {
  return player.buffs
    .filter((b) => b.expiresAt > world.tick)
    .map(
      (b) =>
        `<span class="buff-chip" style="--buff:${POWERUP_STYLE[b.kind].color}" title="${escape(POWERUP_PRESENTATION[b.kind].description)}">${escape(POWERUP_PRESENTATION[b.kind].label.toUpperCase())} ${Math.ceil((b.expiresAt - world.tick) / RULES.ticksPerSecond)}s</span>`,
    )
    .join("");
}

export interface AppDependencies {
  maps: MapRepository;
  preferences: PreferencesStore;
  createSession: SessionFactory;
  debug: boolean;
  animationClock: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  sprites?: Readonly<Record<string, string>>;
  buildingSprites?: import("../render/sprite-raster.js").BuildingSprites;
  createCamera?: CameraFactory;
  /** Online Versus rooms; omitted where the page cannot reach the room service. */
  online?: OnlineDependencies;
  /** A room code from the page address, opened on load. */
  initialRoom?: string;
  /** Additive GPU light over the battlefield; omitted or null renders without it. */
  createLightRenderer?: (canvas: HTMLCanvasElement) => LightRenderer | null;
  audio?: PresentationAudio;
  forcedMute?: boolean;
}

export function mountNeuralDefence(
  root: HTMLElement,
  dependencies: AppDependencies,
): { dispose(): void } {
  let screen: Screen = "menu";
  let mode: GameMode = "skirmish";
  let catalog: LoadState<MapSummary[]> | null = null;
  let selectedId: string | null = null;
  let mapState: LoadState<MapDefinition> | null = null;
  let selectedSlot = 0;
  let selectedCell: number | null = null;
  let placement: BuildKind | null = null;
  let placementCell: number | null = null;
  let pending: "reset" | "leave" | null = null;
  let lightTarget: HTMLCanvasElement | null = null;
  let online: OnlineSession | null = null;
  let roomCode = "";
  let roomError: string | null = null;
  let creatingRoom = false;
  let playerName = dependencies.online?.savedName() ?? "";
  let roomQr: { code: string; url: string } | null = null;
  let lightRenderer: LightRenderer | undefined;
  let launchError: string | null = null;
  let launching = false;
  let session: NeuralSession | null = null;
  let unsubscribe: (() => void) | null = null;
  let aborter: AbortController | null = null;
  let generation = 0;
  let animation: BoardAnimation | null = null;
  let camera: BoardCamera | null = null;
  let frame: number | null = null;
  let disposed = false;
  let preferences: PresentationPreferences = dependencies.preferences.read();
  dependencies.audio?.configure(preferences);
  let instantConstruction = false;
  let instantResearch = false;
  let aiStrategy: AiStrategy = "balanced";
  let powerups = true;
  let firstAiStrategy: AiStrategy = "pressure";
  let notices: Outcome[] = [];
  let noticeTick = -1;
  let noticeMatch = "";
  let panel: CommandPanel = "inspect";
  let commandPage = 0;
  const attractScene = createAttractScene();

  function stopAnimation() {
    if (frame !== null) dependencies.cancelFrame(frame);
    frame = null;
    animation = null;
  }

  function animate(now: number) {
    if (disposed || screen !== "game") return;
    animation?.animate(now);
    updateMinimapView();
    frame = dependencies.requestFrame(animate);
  }

  function updateMinimapView() {
    const view = root
      .querySelector("#nd-board")
      ?.getAttribute("viewBox")
      ?.split(" ");
    const outline = root.querySelector(".minimap-view");
    if (view && outline)
      ["x", "y", "width", "height"].forEach((key, i) =>
        outline.setAttribute(key, view[i]!),
      );
  }

  function restart() {
    if (online) {
      pending = null;
      online.lobby();
      return;
    }
    camera?.dispose();
    camera = null;
    placement = null;
    placementCell = null;
    panel = "inspect";
    commandPage = 0;
    pending = null;
    session?.reset();
    selectedCell =
      session
        ?.view()
        .structures.find(
          (s) => s.ownerId === session?.localPlayerId && s.kind === "brain",
        )?.cell ?? null;
    render();
  }

  function cancelLoads() {
    generation++;
    aborter?.abort();
    aborter = null;
  }

  function disposeSession() {
    camera?.dispose();
    camera = null;
    stopAnimation();
    unsubscribe?.();
    unsubscribe = null;
    session?.dispose();
    session = null;
    online = null;
  }

  function showMenu() {
    cancelLoads();
    if (online) dependencies.online?.leaveRoom();
    disposeSession();
    pending = null;
    launchError = null;
    screen = "menu";
    render();
  }

  async function loadCatalog() {
    cancelLoads();
    const token = generation;
    aborter = new AbortController();
    catalog = { status: "loading" };
    mapState = null;
    render();
    try {
      const value = await dependencies.maps.list(aborter.signal);
      if (disposed || token !== generation || screen !== "setup") return;
      catalog = { status: "ready", value };
      if (!selectedId || !value.some((item) => item.id === selectedId))
        selectedId = value[0]?.id ?? null;
      render();
      if (selectedId) await loadSelectedMap(selectedId);
    } catch (error) {
      if (disposed || token !== generation || screen !== "setup") return;
      catalog = {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The map catalog could not be loaded.",
      };
      render();
    }
  }

  async function loadSelectedMap(id: string) {
    cancelLoads();
    const token = generation;
    aborter = new AbortController();
    selectedId = id;
    selectedSlot = 0;
    mapState = { status: "loading" };
    launchError = null;
    render();
    try {
      const raw = await dependencies.maps.load(id, aborter.signal);
      const value = loadMap(raw);
      if (disposed || token !== generation || screen !== "setup") return;
      mapState = { status: "ready", value };
      selectedSlot = value.spawns[0]?.slot ?? 0;
      render();
    } catch (error) {
      if (disposed || token !== generation || screen !== "setup") return;
      mapState = {
        status: "error",
        message:
          error instanceof Error ? error.message : "This map is invalid.",
      };
      render();
    }
  }

  function launch() {
    if (launching || mapState?.status !== "ready") return;
    launching = true;
    launchError = null;
    render();
    try {
      const settings = {
        aiStrategy,
        instantConstruction: dependencies.debug && instantConstruction,
        instantResearch: dependencies.debug && instantResearch,
        ...(mode === "skirmish" || mode === "watch" ? { powerups } : {}),
      };
      const created = dependencies.createSession(
        mapState.value,
        selectedSlot,
        mode,
        settings,
        mode === "watch"
          ? { watchStrategies: [firstAiStrategy, aiStrategy] }
          : undefined,
      );
      disposeSession();
      session = created;
      panel = "inspect";
      placement = null;
      placementCell = null;
      selectedCell =
        mapState.value.spawns.find((spawn) => spawn.slot === selectedSlot)
          ?.cellIndex ?? null;
      unsubscribe = created.subscribe(() => {
        if (screen === "game") renderGame();
      });
      screen = "game";
      render();
    } catch (error) {
      launchError =
        error instanceof Error ? error.message : "The session could not start.";
    } finally {
      launching = false;
      render();
    }
  }

  function gameWorld(): Readonly<World> | null {
    return session?.view() ?? null;
  }

  function modal(): string {
    if (!pending) return "";
    const watching = session?.canControl === false;
    return `<div class="nd-modal-backdrop"><section class="nd-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><p class="eyebrow">Progress will be discarded</p><h2 id="discard-title">${pending === "reset" ? "Reset this session?" : "Return to the menu?"}</h2><p>${pending === "reset" ? "The same map and spawn will start from the beginning." : watching ? "This battle will be discarded." : "Your current network and research will be lost."}</p><div class="button-row"><button data-action="cancel-confirm" class="secondary">${watching ? "Keep watching" : "Keep playing"}</button><button data-action="confirm-${pending}" class="danger">${pending === "reset" ? "Reset session" : "Leave session"}</button></div></section></div>`;
  }

  function header(title: string, subtitle: string): string {
    return `<header class="nd-header"><div class="brand">FUSE <strong>CRAFT</strong></div><span class="header-subtitle">${escape(subtitle)}</span>${dependencies.debug ? '<span class="debug-badge">DEBUG</span>' : ""}</header>${screen === "game" || screen === "menu" ? "" : `<div class="screen-heading"><h1>${escape(title)}</h1></div>`}`;
  }

  function menuMarkup(): string {
    return `<div class="attract-scene" aria-hidden="true"><svg id="nd-attract-board"></svg></div><div class="attract-shade"></div>${header("Fuse Craft", "A neural strategy game")}<main class="menu-layout fui-landing"><p class="eyebrow">GROW · CONNECT · DEFEND</p><h1 class="fui-landing-title">FUSE<br><span>CRAFT</span></h1><p class="fui-landing-tagline">Build your network.<br>Keep the signal alive.</p><nav class="fui-landing-actions" aria-label="Main menu"><button data-action="new-game" class="fui-button-primary menu-button"><span aria-hidden="true">▶</span> Single player</button>${dependencies.online ? '<button data-action="multiplayer" class="menu-button">Multiplayer</button>' : ""}<button data-action="settings" class="menu-button">Settings</button></nav></main><footer class="menu-footer">A FUSE GAME <span>${dependencies.online ? "PLAYER VS AI · ONLINE VERSUS" : "SKIRMISH · PLAYER VS AI"}</span></footer>`;
  }

  function settingsMarkup(): string {
    return `${header("Settings", "presentation")}<main class="nd-panel settings-panel"><p>Preferences stay on this device.</p>${dependencies.forcedMute ? '<p class="debug-note">This preview URL forces audio off.</p>' : ""}<label class="setting-row"><span><strong>Mute sound</strong><small>Interface, construction and combat cues</small></span><input type="checkbox" data-setting="mute" ${preferences.mute ? "checked" : ""}></label><label class="setting-row"><span><strong>Volume</strong></span><input type="range" min="0" max="1" step="0.05" data-setting="volume" value="${preferences.volume}"></label><label class="setting-row"><span><strong>Reduced motion</strong><small>Reduce particle animation and flashes</small></span><input type="checkbox" data-setting="reducedMotion" ${preferences.reducedMotion ? "checked" : ""}></label><button data-action="back-menu" class="secondary">← Back</button></main>`;
  }

  function setupMarkup(): string {
    const mapOptions =
      catalog?.status === "ready"
        ? catalog.value
            .map(
              (map) =>
                `<option value="${escape(map.id)}" ${selectedId === map.id ? "selected" : ""}>${escape(map.title)}</option>`,
            )
            .join("")
        : "";
    const catalogBlock =
      !catalog || catalog.status === "loading"
        ? '<p role="status">Loading maps…</p>'
        : catalog.status === "error"
          ? `<div class="error-card" role="alert"><strong>Map catalog unavailable</strong><p>${escape(catalog.message)}</p><button data-action="retry-catalog">Retry</button></div>`
          : catalog.value.length === 0
            ? '<div class="empty-card">No maps are available yet. <button data-action="retry-catalog">Retry</button></div>'
            : `<label class="field-label" for="map-picker">Map</label><select id="map-picker" data-field="map">${mapOptions}</select>`;
    const loaded = mapState?.status === "ready" ? mapState.value : null;
    const details =
      !selectedId || catalog?.status !== "ready"
        ? ""
        : !mapState || mapState.status === "loading"
          ? '<p role="status">Validating selected map…</p>'
          : mapState.status === "error"
            ? `<div class="error-card" role="alert"><strong>Map unavailable or invalid</strong><p>${escape(mapState.message)}</p><button data-action="retry-map">Retry map</button></div>`
            : `<div class="map-meta"><strong>${loaded?.width} × ${loaded?.height} hexes</strong><span>◈ Biomass deposits</span><span>◇ Insight deposits</span><span>▰ Blocked ground</span></div><label class="field-label" for="spawn-picker">Spawn</label><select id="spawn-picker" data-field="spawn">${loaded?.spawns.map((spawn) => `<option value="${spawn.slot}" ${selectedSlot === spawn.slot ? "selected" : ""}>Spawn ${spawn.slot + 1} · tile ${spawn.cellIndex}</option>`).join("")}</select>`;
    return `${header("New game", "setup")}
      <main class="setup-layout"><section class="nd-panel">
        <p class="section-index">01 / SCENARIO</p><div class="choice-grid">
        <button data-action="mode-skirmish" class="choice ${mode === "skirmish" ? "active" : ""}" aria-pressed="${mode === "skirmish"}"><strong>Player vs AI</strong><span>Grow, research and destroy the rival brain.</span></button>
        <button data-action="mode-watch" class="choice ${mode === "watch" ? "active" : ""}" aria-pressed="${mode === "watch"}"><strong>Watch AI vs AI</strong><span>Choose two openings and follow their battle.</span></button>
        <button data-action="mode-sandbox" class="choice ${mode === "sandbox" ? "active" : ""}" aria-pressed="${mode === "sandbox"}"><strong>Open sandbox</strong><span>One player, no AI. Grow at your pace.</span></button>
        <button data-action="mode-combat-lab" class="choice ${mode === "combat-lab" ? "active" : ""}" aria-pressed="${mode === "combat-lab"}"><strong>Combat lab</strong><span>Scripted opposition to test routing and cuts.</span></button>
        </div><p class="section-index">02 / FIELD</p>${catalogBlock}${details}</section>
        <aside class="nd-panel setup-summary"><p class="section-index">SESSION BRIEF</p>
        <h2>${mode === "watch" ? "Follow the battle" : mode === "skirmish" ? "Take the field" : mode === "sandbox" ? "An open beginning" : "A controlled confrontation"}</h2>
        <p>${mode === "watch" ? "Two AI players · Equal resources · Watch, pan and inspect either network" : mode === "skirmish" ? "You versus one AI · Equal resources · Destroy the enemy brain" : `One local player · No AI controller${mode === "combat-lab" ? " · Scripted opposing network" : ""}`}</p>
        ${mode === "watch" ? `<label class="field-label" for="first-strategy-picker">First AI opening</label><select id="first-strategy-picker" data-field="first-strategy">${AI_STRATEGIES.map((kind) => `<option value="${kind}" ${kind === firstAiStrategy ? "selected" : ""}>${kind[0]!.toUpperCase() + kind.slice(1)}</option>`).join("")}</select>` : ""}
        ${mode === "skirmish" || mode === "watch" ? `<label class="field-label" for="strategy-picker">${mode === "watch" ? "Second AI opening" : "Opponent opening"}</label><select id="strategy-picker" data-field="strategy">${AI_STRATEGIES.map((kind) => `<option value="${kind}" ${kind === aiStrategy ? "selected" : ""}>${kind[0]!.toUpperCase() + kind.slice(1)}</option>`).join("")}</select><p class="muted">Different openings, equal resources. Opponents can adapt when countered.</p>` : ""}
        ${mode === "skirmish" || mode === "watch" ? `<label class="toggle-field"><input type="checkbox" data-field="powerups" ${powerups ? "checked" : ""}> Random powerups <small>Contested pickups spawn between the brains; the first network to touch one claims it.</small></label>` : ""}
        ${
          dependencies.debug
            ? `<fieldset class="debug-options"><legend>Debug options</legend>
          <p>Clear tile boundaries are on. Particle travel always takes normal time.</p>
          <label><input type="checkbox" data-debug="construction" ${instantConstruction ? "checked" : ""}> Instant construction after delivery</label>
          <label><input type="checkbox" data-debug="research" ${instantResearch ? "checked" : ""}> Instant research</label>
          <small>Resource costs and prerequisites still apply.</small></fieldset>`
            : mode === "watch"
              ? "<p>Select a structure to inspect it. Use the minimap or either player's card to move around the field.</p>"
              : "<p>Build beside resources. Connect your network. Select frontline nodes and use <strong>Charge</strong> to supply their weapons.</p>"
        }
        ${launchError ? `<div class="error-card" role="alert">${escape(launchError)}<button data-action="start">Retry launch</button></div>` : ""}
        <div class="button-row"><button data-action="back-menu" class="secondary">← Back</button>
        <button data-action="start" class="primary" ${loaded && !launching ? "" : "disabled"}>${launching ? "Starting…" : mode === "watch" ? "Watch match →" : "Start →"}</button></div></aside></main>`;
  }

  function gameMarkup(): string {
    const title =
      catalog?.status === "ready"
        ? catalog.value.find((m) => m.id === selectedId)?.title
        : undefined;
    return `<main class="game-layout" aria-label="${escape(title ?? "Neural field")} battlefield" ${pending ? "inert" : ""}>
      <section class="board-shell">
      <div id="nd-viewport" class="board-scroll"><svg id="nd-board" class="nd-board" tabindex="0" aria-label="Hex board. Use arrow keys to move selection."></svg><canvas id="nd-light" class="nd-light" aria-hidden="true"></canvas></div>
      <div id="match-result" class="match-result" role="status" hidden></div>
      </section>
      <aside id="game-sidebar" class="game-sidebar"></aside></main><div id="game-modal">${modal()}</div>`;
  }

  function sideName(world: Readonly<World>, id: string): string {
    return (
      ["Blue", "Red", "Green", "Gold"][
        world.players.find((p) => p.id === id)?.slot ?? 0
      ] ?? "Player"
    );
  }

  function watchMarkup(world: Readonly<World>): string {
    const players = [...world.players].sort(
      (a, b) =>
        Number(b.id === session?.localPlayerId) -
        Number(a.id === session?.localPlayerId),
    );
    const structure = world.structures.find((s) => s.cell === selectedCell);
    const selected = structure
      ? `${sideName(world, structure.ownerId)} · ${structure.kind.toUpperCase()} · ${structure.hp} HP`
      : selectedCell === null
        ? "Select a structure"
        : `HEX ${selectedCell}`;
    const resources = players
      .map(
        (p) =>
          `<div><small>${sideName(world, p.id).toUpperCase()}</small><strong>◈ ${units(p.biomass)} <span>◇ ${units(p.insight)}</span></strong></div>${buffChips(world, p)}`,
      )
      .join("");
    const cards = players
      .map((p) => {
        const opening =
          p.id === session?.localPlayerId ? firstAiStrategy : aiStrategy;
        const brain = world.structures.find(
          (s) => s.ownerId === p.id && s.kind === "brain",
        );
        return `<button class="watch-player" data-watch-player="${escape(p.id)}" style="--team:${TEAM_COLORS[p.slot]}"><strong>${sideName(world, p.id)} · ${escape(opening)}</strong><span>Brain ${brain?.hp ?? 0} HP</span><small>${p.statistics.built} built · ${p.statistics.lost} lost</small></button>`;
      })
      .join("");
    return `<div class="battle-topbar watch-topbar"><div class="resource-row">${resources}</div><div class="hud-mini"></div><div class="session-controls"><button data-action="reset" class="secondary">Restart</button><button data-action="leave" class="secondary">Menu</button></div></div><div class="command-dock watch-dock">${minimapMarkup(world)}<section class="inspector" aria-label="Selected hex"><div class="selection-details"><strong>${escape(selected)}</strong><span>${structure ? (structure.connected ? "Connected to its brain" : "Disconnected") : "Watch either network grow and adapt."}</span><small>Pan, zoom and inspect · Select a player to follow its brain</small></div><button data-action="find-battle" class="secondary" title="Jump to fighting or the nearest opposing networks">Find battle</button></section><nav class="watch-players" aria-label="AI players">${cards}</nav></div>`;
  }

  function sidebarMarkup(world: Readonly<World>): string {
    if (session && !session.canControl) return watchMarkup(world);
    const player = world.players.find(
      (item) => item.id === session?.localPlayerId,
    );
    if (!player) return '<div class="nd-panel">No local player exists.</div>';
    const structure = world.structures.find(
      (item) => item.cell === selectedCell,
    );
    const cell = selectedCell === null ? null : world.map.cells[selectedCell];
    const owned = structure?.ownerId === player.id;
    const queued = player.queue.find((item) => item.cell === selectedCell);
    const priority =
      selectedCell === null
        ? 0
        : (player.priorities[String(selectedCell)] ?? 0);
    const count =
      selectedCell === null
        ? 0
        : world.particles.filter(
            (p) =>
              p.ownerId === (structure?.ownerId ?? player.id) &&
              p.cell === selectedCell &&
              p.mode === "stationed",
          ).length;
    const incoming =
      selectedCell === null
        ? []
        : world.particles.filter(
            (p) =>
              p.ownerId === (structure?.ownerId ?? player.id) &&
              p.to === selectedCell &&
              p.mode === "transit",
          );
    const worker = player.worker;
    const sprite = (name: string) =>
      dependencies.sprites?.[`${name}-v2`] ?? dependencies.sprites?.[name];
    const portrait = structure
      ? structure.kind === "neuron"
        ? neuronPortraitUrl(world, structure.cell)
        : structure.kind === "spore"
          ? sporeIconUrl(
              world.players.find((p) => p.id === structure.ownerId)?.slot ?? 0,
            )
          : sprite(structureArt(structure.kind))
      : cell?.terrain === "deposit"
        ? sprite(`deposit-${cell.resourceKind}`)
        : sprite(
            cell?.terrain === "blocked" ? "blocker-boulder" : "terrain-slate-a",
          );
    const powerup = world.powerups.find((p) => p.cell === selectedCell);
    const detail =
      selectedCell === null
        ? '<div class="selection-summary"><strong>Select a hex</strong><span>Click terrain to build or inspect.</span></div>'
        : `<div class="selection-summary"><div class="tile-heading"><span>HEX ${selectedCell}</span><strong>${structure ? `${structure.kind.toUpperCase()} · ${structure.hp} HP` : powerup ? `POWERUP · ${POWERUP_PRESENTATION[powerup.kind].label.toUpperCase()}` : cell?.terrain === "deposit" ? `${cell.resourceKind.toUpperCase()} DEPOSIT` : cell?.terrain === "blocked" ? "BLOCKED GROUND" : "OPEN GROUND"}</strong></div>
        ${powerup ? `<span>${escape(POWERUP_PRESENTATION[powerup.kind].description)} Fades in ${Math.ceil((powerup.expiresAt - world.tick) / RULES.ticksPerSecond)}s. Touch it with your connected network to claim it; two networks touching it keep it contested.</span>` : ""}
        ${structure ? `<span title="${structure.connected ? "Connected to brain" : "Disconnected from brain"}${incoming.length ? ` · next arrival in ${Math.ceil((Math.min(...incoming.map((p) => p.arrivesAt)) - world.tick) / RULES.ticksPerSecond)}s` : ""}">${structure.connected ? "Connected" : "Disconnected"} · ${count} particles · ${incoming.length} incoming</span>` : ""}
        ${cell?.terrain === "deposit" ? '<span title="Connected neighboring structures harvest this deposit. Several players may share it.">Expand alongside to mine.</span>' : ""}</div>
        ${owned && canAttack(structure.kind) ? `${priority === 0 && structure.kind !== "brain" ? '<span class="supply-warning">No supply assigned — use D / Charge to arm this node.</span>' : ""}<div class="priority-control"><label class="field-label" for="priority-slider">Attack priority · ${priority}/3</label><input id="priority-slider" data-field="priority" type="range" min="0" max="3" step="1" value="${priority}"></div>` : ""}
        ${structure && STRUCTURES[structure.kind].miningBonus ? `<span class="economic-summary" title="One specialist bonus per deposit per player. Requires a connection to the brain. No attack supply needed.">${structure.connected ? "Extracting" : "Extraction paused"} · +${STRUCTURES[structure.kind].miningBonus} shares/deposit · non-stacking</span>` : ""}
        ${queued ? `<span class="construction-progress" title="Queued construction waits for support, builder and resources.">${queued.paid ? `${queued.upgradeFrom !== undefined ? "Specializing" : "Growing"} · ${Math.ceil((queued.duration - queued.progress) / RULES.ticksPerSecond)}s remaining` : constructionDispatchAvailability(world, player, queued).missing.map(requirementText).join(" ") || "Ready for construction"}</span>` : ""}`;
    const researchNames = Object.fromEntries(
      Object.entries(RESEARCH_PRESENTATION).map(([id, item]) => [
        id,
        item.label,
      ]),
    );
    const commands = renderCommands(
      world,
      player,
      selectedCell,
      panel,
      commandPage,
      dependencies.sprites,
      placement,
    );
    const outcomes = notices
      .filter((item) => item.playerId === player.id)
      .slice(-3)
      .map(
        (item) =>
          `<li>${escape(item.type)}${item.reason ? ` · ${escape(item.reason)}` : ""}${item.cell !== undefined ? ` at hex ${item.cell}` : ""}</li>`,
      )
      .join("");
    const placementRequirements =
      placement && placementCell !== null
        ? constructionQueueAvailability(world, player, placement, placementCell)
        : null;
    const placementHints =
      placementRequirements?.allowed && placement && placementCell !== null
        ? constructionDispatchAvailability(world, player, {
            kind: placement,
            cell: placementCell,
            upgradeFrom: constructionUpgradeSource(
              world,
              player,
              placement,
              placementCell,
            )?.id,
          }).missing
        : (placementRequirements?.missing ?? []);
    const upgrading =
      placement &&
      placementCell !== null &&
      constructionUpgradeSource(world, player, placement, placementCell);
    const contextDetail = placement
      ? `<div class="placement-instructions" role="status"><strong>${upgrading ? "Upgrade neuron to" : "Place"} ${BUILD_PRESENTATION[placement].label}</strong><p>Shift: queue more · Esc / S: cancel</p><small>${placementHints.map(requirementText).map(escape).join(" ") || (upgrading ? "Neuron stays connected during work. Damage carries over." : CONSTRUCTIONS[placement].upgradesFrom?.length ? "Choose open ground or upgrade your neuron." : "Click or tap open ground.")}</small></div>`
      : panel === "inspect" || panel === "build"
        ? `${detail}<span class="construction-summary">${player.queue.length}/${RULES.queueLimit} queued · builder ${escape(worker.mode)}</span>`
        : panel === "particles"
          ? `<div class="command-context"><strong>Particle profile · ${escape(player.particleKind)}</strong><p>Refit at the brain</p><small>Existing particles change on return or departure. Your finite pool stays the same size.</small></div>`
          : panel === "research"
            ? `<div class="command-context"><strong>Research</strong><p>${player.researchJob ? `${researchNames[player.researchJob.kind]} · researching` : "Choose an upgrade"}</p><small>${player.research.length ? `Complete: ${player.research.map((r) => researchNames[r]).join(", ")}` : "Hover or focus a command for its requirements."}</small></div>`
            : `<div class="command-context"><strong>Recent activity</strong><ul class="event-list" aria-live="polite">${outcomes || "<li>No recent activity.</li>"}</ul></div>`;
    return `<div class="battle-topbar"><div class="resource-row"><div><small>BIOMASS</small><strong>◈ ${units(player.biomass)}</strong></div><div><small>INSIGHT</small><strong>◇ ${units(player.insight)}</strong></div>${buffChips(world, player)}</div><div class="hud-mini"></div>${dependencies.debug ? '<div class="debug-note"></div>' : ""}<div class="session-controls">${online ? (online.room().manager ? '<button data-action="reset" class="secondary">Lobby</button>' : "") : '<button data-action="reset" class="secondary">Reset</button>'}<button data-action="leave" class="secondary">${online ? "Leave" : "Menu"}</button></div></div>
      <div class="command-dock">${minimapMarkup(world)}<section class="inspector" aria-label="${panel === "inspect" || panel === "build" ? "Selected hex" : panel === "research" ? "Research" : "Recent activity"}">${portrait ? `<div class="selection-portrait"><img style="filter:${structure && structure.kind !== "neuron" && structure.kind !== "spore" ? teamArtFilter(world.players.find((p) => p.id === structure.ownerId)?.slot ?? 0) : "none"}" src="${escape(portrait)}" alt="" draggable="false"></div>` : ""}<div class="selection-details">${contextDetail}</div></section><nav class="command-card" data-panel="${panel}" aria-label="${panel === "research" ? "Research commands" : panel === "build" ? "Build commands" : panel === "activity" ? "Activity commands" : "Commands"}">${commands}</nav></div>`;
  }

  function renderGame() {
    const world = gameWorld();
    if (!world) return;
    dependencies.audio?.present(
      world,
      session?.canControl ? session.localPlayerId : "",
    );
    if (world.matchId !== noticeMatch || world.tick < noticeTick) {
      notices = [];
      noticeTick = -1;
      noticeMatch = world.matchId;
    }
    if (world.tick !== noticeTick) {
      notices = [
        ...notices.filter((e) => e.tick > world.tick - 120),
        ...world.outcomes.filter((e) => e.type !== "income"),
      ].slice(-12);
      noticeTick = world.tick;
    }
    const svg = root.querySelector<SVGSVGElement>("#nd-board");
    const sidebar = root.querySelector<HTMLElement>("#game-sidebar");
    const tick = root.querySelector<HTMLElement>("#tick-label");
    if (!svg || !sidebar) return;
    const result = root.querySelector<HTMLElement>("#match-result");
    if (result) {
      result.hidden = !world.finished;
      if (world.finished) {
        const title =
          world.winnerId === null
            ? "Draw"
            : !session?.canControl
              ? `${sideName(world, world.winnerId)} wins`
              : world.winnerId === session?.localPlayerId
                ? "Victory"
                : "Defeat";
        updateContent(
          result,
          `<strong>${title}</strong><p>${world.winnerId === null ? "Both brains were destroyed." : !session?.canControl ? "The opposing brain has been destroyed." : world.winnerId === session?.localPlayerId ? "The rival brain has been destroyed." : "Your brain has been destroyed."}</p><small>${Math.floor(world.tick / RULES.ticksPerSecond / 60)}:${String(Math.floor(world.tick / RULES.ticksPerSecond) % 60).padStart(2, "0")} elapsed</small><div class="button-row">${online ? (online.room().manager ? '<button data-action="rematch-room">Rematch</button><button data-action="lobby-room" class="secondary">Lobby</button>' : '<span class="room-wait">Waiting for the host…</span>') : `<button data-action="reset">${session?.canControl ? "Play again" : "Watch again"}</button>`}<button data-action="leave" class="secondary">${online ? "Leave room" : "Menu"}</button></div>`,
        );
      }
    }
    if (tick) tick.textContent = `TICK ${world.tick}`;
    updateContent(sidebar, sidebarMarkup(world));
    const rate = sidebar.querySelector<HTMLElement>(".hud-mini");
    const income = (resource: "biomass" | "insight") =>
      (world.outcomes
        .filter(
          (e) =>
            e.type === "income" &&
            e.playerId === session?.localPlayerId &&
            e.resource === resource,
        )
        .reduce((sum, e) => sum + (e.amount ?? 0), 0) *
        20) /
      1000;
    if (rate)
      rate.textContent = `${Math.floor(world.tick / RULES.ticksPerSecond / 60)}:${String(Math.floor(world.tick / RULES.ticksPerSecond) % 60).padStart(2, "0")}${session?.canControl ? ` · +${income("biomass").toFixed(1)} ◈ / s · +${income("insight").toFixed(1)} ◇ / s` : " · AI vs AI"}`;
    const debugNote = sidebar.querySelector<HTMLElement>(".debug-note");
    if (debugNote)
      debugNote.textContent = `DEBUG · grid${world.settings.instantConstruction ? " · instant build" : ""}${world.settings.instantResearch ? " · instant research" : ""} · normal travel`;
    const lightCanvas = root.querySelector<HTMLCanvasElement>("#nd-light");
    if (lightCanvas !== lightTarget) {
      lightTarget = lightCanvas;
      lightRenderer =
        (lightCanvas && dependencies.createLightRenderer?.(lightCanvas)) ??
        undefined;
    }
    animation = renderBoard(
      svg,
      world,
      selectedCell,
      dependencies.debug,
      preferences.reducedMotion,
      dependencies.animationClock(),
      dependencies.sprites,
      dependencies.buildingSprites,
      lightRenderer,
    );
    let preview = svg.querySelector<SVGGElement>(".placement-preview");
    if (!preview) {
      preview = svg.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      preview.setAttribute("class", "placement-preview");
      preview.setAttribute("pointer-events", "none");
      svg.append(preview);
    }
    const owner = world.players.find((p) => p.id === session?.localPlayerId);
    root.classList.toggle("is-placing", placement !== null);
    if (placement && placementCell !== null && owner) {
      const valid = constructionQueueAvailability(
        world,
        owner,
        placement,
        placementCell,
      ).allowed;
      preview.setAttribute("data-valid", String(valid));
      preview.setAttribute(
        "data-upgrade",
        String(
          !!constructionUpgradeSource(world, owner, placement, placementCell),
        ),
      );
      const artwork = `<g opacity="0.55">${structureArtwork(world.map.width, placementCell, placement, owner.slot, dependencies.sprites)}</g>`;
      preview.innerHTML = `<polygon points="${hexPoints(world.map.width, placementCell, 1.5)}"/>${artwork}`;
    } else preview.replaceChildren();
    const viewport = root.querySelector<HTMLElement>("#nd-viewport");
    if (!camera && viewport && dependencies.createCamera) {
      camera = dependencies.createCamera(svg, viewport);
      const player = world.players.find((p) => p.id === session?.localPlayerId);
      const brain = world.structures.find(
        (s) => s.ownerId === player?.id && s.kind === "brain",
      );
      if (brain) camera.focusCell(world.map.width, brain.cell);
      svg.focus?.({ preventScroll: true });
    }
    camera?.refresh();
  }

  function multiplayerMarkup(): string {
    return `${header("Multiplayer", "online versus")}<main class="setup-layout multiplayer-layout"><section class="nd-panel"><p class="section-index">01 / NEW ROOM</p><h2>Host a Versus match</h2><p>Create a room, share its code or link, add bots if you like, and start when everyone has joined. Two to four networks, one brain each.</p><button data-action="create-room" class="primary" ${creatingRoom ? "disabled" : ""}>${creatingRoom ? "Creating…" : "Create room"}</button></section><section class="nd-panel"><p class="section-index">02 / JOIN</p><h2>Join a friend</h2><label class="field-label" for="room-code">Room code</label><div class="join-row"><input id="room-code" data-field="room-code" autocomplete="off" spellcheck="false" maxlength="12" value="${escape(roomCode)}" placeholder="CODE"><button data-action="join-room" class="primary">Join</button></div>${roomError ? `<p class="error-card" role="alert">${escape(roomError)}</p>` : ""}</section><div class="button-row"><button data-action="back-menu" class="secondary">← Back</button></div></main>`;
  }

  function roomMarkup(): string {
    const room = online?.room();
    if (!online || !room) return multiplayerMarkup();
    if (room.closed)
      return `${header("Versus room", room.code)}<main class="setup-layout"><section class="nd-panel"><h2>${room.closed === "kicked" ? "The host removed you from the room" : "The room has ended"}</h2><div class="button-row"><button data-action="leave-room" class="primary">Back to menu</button></div></section></main>`;
    const players = room.seats.filter((seat) => !seat.watcher);
    const seated = players.some((seat) => seat.id === room.self);
    const capacity = ROOM_MAPS.find((map) => map.id === room.mapId)?.seats ?? 2;
    const ready = players.filter((seat) => seat.connected).length;
    const canStart = room.manager && ready >= 2 && ready <= capacity;
    const seats = players
      .map(
        (seat) =>
          `<li class="room-seat${seat.connected ? "" : " away"}" style="--team:${TEAM_COLORS[players.indexOf(seat)] ?? "#63cfff"}"><span class="seat-dot"></span><strong>${escape(seat.name)}</strong>${seat.id === room.self ? "<em>you</em>" : ""}${seat.bot ? "<em>bot</em>" : ""}${seat.connected ? "" : "<em>away</em>"}${room.manager && seat.bot && room.stage === "lobby" ? `<button data-action="remove-bot" data-bot-id="${escape(seat.id)}" class="secondary small" aria-label="Remove ${escape(seat.name)}">✕</button>` : ""}</li>`,
      )
      .join("");
    const disabled = room.manager && room.stage === "lobby" ? "" : "disabled";
    const link = dependencies.online?.roomLink(room.code) ?? "";
    return `${header("Versus room", room.code)}<main class="setup-layout room-layout"><section class="nd-panel"><p class="section-index">PLAYERS · ${ready}/${capacity}</p><ul class="room-seats">${seats || '<li class="room-seat empty">Nobody has joined yet</li>'}</ul>${
      seated
        ? ""
        : `<label class="field-label" for="player-name">Your name</label><div class="join-row"><input id="player-name" data-field="player-name" maxlength="32" autocomplete="nickname" value="${escape(playerName)}" placeholder="Name"><button data-action="join-seat" class="primary">Join</button></div>`
    }${room.manager && room.stage === "lobby" && players.length < capacity ? '<button data-action="add-bot" class="secondary">+ Add bot</button>' : ""}</section><aside class="nd-panel setup-summary"><p class="section-index">INVITE</p><div class="room-invite"><strong class="room-code">${escape(room.code)}</strong>${roomQr?.code === room.code ? `<img class="room-qr" src="${escape(roomQr.url)}" alt="QR code for the room link">` : ""}<small>${escape(link)}</small><button data-action="copy-room-link" class="secondary">Copy link</button></div><p class="section-index">RULES</p><label class="field-label" for="room-map">Map</label><select id="room-map" data-field="room-map" ${disabled}>${ROOM_MAPS.map((map) => `<option value="${map.id}" ${map.id === room.mapId ? "selected" : ""}>${escape(map.title)} · ${map.seats} players</option>`).join("")}</select><label class="field-label" for="room-strategy">Bot opening</label><select id="room-strategy" data-field="room-strategy" ${disabled}>${AI_STRATEGIES.map((kind) => `<option value="${kind}" ${kind === room.aiStrategy ? "selected" : ""}>${kind[0]!.toUpperCase()}${kind.slice(1)}</option>`).join("")}</select><label class="toggle-field"><input type="checkbox" data-field="room-powerups" ${room.powerups ? "checked" : ""} ${disabled}> Random powerups</label><p class="room-status" role="status">${escape(room.stage === "connecting" ? "Connecting to the room…" : players.length > capacity ? `Too many players for this map: it seats ${capacity}. Pick a larger map or ask someone to watch.` : room.status)}</p><div class="button-row"><button data-action="leave-room" class="secondary">Leave</button>${room.manager ? `<button data-action="start-room" class="primary" ${canStart ? "" : "disabled"}>Start match</button>` : '<span class="room-wait">Waiting for the host to start…</span>'}</div></aside></main>`;
  }

  function openRoom(code: string) {
    if (!dependencies.online) return;
    disposeSession();
    const created = dependencies.online.openRoom(code);
    online = created;
    session = created;
    panel = "inspect";
    placement = null;
    placementCell = null;
    unsubscribe = created.subscribe(onRoomChange);
    screen = "room";
    render();
    const link = dependencies.online.roomLink(code);
    void dependencies.online
      .qr?.(link)
      .then((url) => {
        roomQr = { code, url };
        if (screen === "room") render();
      })
      .catch(() => {});
  }

  /** Follows the room between its lobby and the battlefield. */
  function onRoomChange() {
    if (!online || disposed) return;
    const room = online.room();
    const playing = room.stage === "running" || room.stage === "over";
    if (screen === "room" && playing && !room.closed) {
      selectedCell =
        online
          .view()
          .structures.find(
            (s) => s.ownerId === online?.localPlayerId && s.kind === "brain",
          )?.cell ?? null;
      screen = "game";
      render();
      return;
    }
    if (screen === "game" && (!playing || room.closed)) {
      camera?.dispose();
      camera = null;
      pending = null;
      screen = "room";
      render();
      return;
    }
    if (screen === "room") {
      updateContent(root, roomMarkup());
      return;
    }
    if (screen === "game") renderGame();
  }

  async function createRoom() {
    if (!dependencies.online || creatingRoom) return;
    creatingRoom = true;
    roomError = null;
    render();
    try {
      const { code } = await dependencies.online.createRoom();
      if (disposed) return;
      dependencies.online.enterRoom(code);
      openRoom(code);
    } catch (error) {
      roomError =
        error instanceof Error
          ? error.message
          : "The room could not be created.";
    } finally {
      creatingRoom = false;
      if (screen === "multiplayer") render();
    }
  }

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!dependencies.online?.validCode(code)) {
      roomError = "That is not a room code: check it and try again.";
      render();
      return;
    }
    roomError = null;
    dependencies.online.enterRoom(code);
    openRoom(code);
  }

  function render() {
    if (disposed) return;
    const battlefield = root.querySelector<HTMLElement>(".game-layout");
    const modalHost = root.querySelector<HTMLElement>("#game-modal");
    if (screen === "game" && battlefield && modalHost) {
      battlefield.toggleAttribute("inert", pending !== null);
      modalHost.innerHTML = modal();
      renderGame();
      if (pending)
        modalHost
          .querySelector<HTMLButtonElement>('[data-action="cancel-confirm"]')
          ?.focus();
      return;
    }
    camera?.dispose();
    camera = null;
    root.className = `fui-app nd-app screen-${screen}`;
    root.innerHTML =
      screen === "menu"
        ? menuMarkup()
        : screen === "settings"
          ? settingsMarkup()
          : screen === "setup"
            ? setupMarkup()
            : screen === "multiplayer"
              ? multiplayerMarkup()
              : screen === "room"
                ? roomMarkup()
                : gameMarkup();
    root
      .querySelectorAll<HTMLElement>(".primary")
      .forEach((button) => button.classList.add("fui-button-primary"));
    if (screen === "menu") {
      const scenery = root.querySelector<SVGSVGElement>("#nd-attract-board");
      if (scenery)
        renderBoard(
          scenery,
          attractScene,
          null,
          false,
          true,
          0,
          dependencies.sprites,
          dependencies.buildingSprites,
        );
    }
    if (screen === "game") {
      stopAnimation();
      renderGame();
      frame = dependencies.requestFrame(animate);
      if (pending)
        root
          .querySelector<HTMLElement>('[data-action="cancel-confirm"]')
          ?.focus();
    }
  }

  function dispatch(action: Action) {
    if (!session?.canControl) return;
    session?.dispatch(action);
    renderGame();
  }

  function closePanel() {
    placement = null;
    placementCell = null;
    const previous = panel;
    panel = "inspect";
    commandPage = 0;
    renderGame();
    root
      .querySelector<HTMLButtonElement>(`[data-action="panel-${previous}"]`)
      ?.focus?.();
  }

  function onClick(event: MouseEvent) {
    dependencies.audio?.unlock();
    const target = event.target as Element;
    const watchedId = target.closest<HTMLElement>("[data-watch-player]")
      ?.dataset.watchPlayer;
    if (
      target.closest('[data-action="find-battle"]') &&
      session &&
      !session.canControl &&
      !pending
    ) {
      const world = session.view();
      const cell = battleFocusCell(world);
      if (cell !== null) {
        selectedCell = cell;
        camera?.focusCell(world.map.width, cell);
        renderGame();
      }
      return;
    }
    if (watchedId && session && !session.canControl && !pending) {
      const world = session.view();
      const player = world.players.find((p) => p.id === watchedId);
      const cell =
        world.structures.find(
          (s) => s.ownerId === watchedId && s.kind === "brain",
        )?.cell ??
        world.map.spawns.find((s) => s.slot === player?.slot)?.cellIndex;
      if (cell !== undefined) {
        selectedCell = cell;
        camera?.focusCell(world.map.width, cell);
        renderGame();
      }
      return;
    }
    const tactical = target.closest<SVGSVGElement>("#nd-minimap");
    if (tactical && !pending) {
      const world = gameWorld();
      const box = tactical.getBoundingClientRect();
      if (world && box.width && box.height)
        camera?.focusCell(
          world.map.width,
          minimapCell(
            world,
            (event.clientX - box.left) / box.width,
            (event.clientY - box.top) / box.height,
          ),
        );
      updateMinimapView();
      return;
    }
    const button = target.closest<HTMLElement>("[data-action]");
    if (button?.getAttribute("aria-disabled") === "true") {
      button.focus?.();
      return;
    }
    if (button?.dataset.action?.startsWith("panel-")) {
      placement = null;
      placementCell = null;
      const next = button.dataset.action.slice(6);
      if (
        next === "inspect" ||
        next === "build" ||
        next === "research" ||
        next === "activity" ||
        next === "particles"
      )
        panel = panel === next ? "inspect" : next;
      commandPage = 0;
      renderGame();
      if (panel !== "inspect") {
        root
          .querySelector<HTMLButtonElement>(
            '.command-card [data-action="close-panel"]',
          )
          ?.focus?.();
      }
      return;
    }
    if (button) {
      dependencies.audio?.play("select");
      const action = button.dataset.action;
      if (action === "close-panel") {
        closePanel();
      } else if (action === "next-command-page") {
        commandPage = (commandPage + 1) % commandPageCount(panel);
        renderGame();
      } else if (action === "new-game") {
        screen = "setup";
        mode = "skirmish";
        selectedId = "close-quarters";
        void loadCatalog();
      } else if (action === "multiplayer") {
        roomError = null;
        screen = "multiplayer";
        render();
      } else if (action === "create-room") void createRoom();
      else if (action === "join-room") joinRoom();
      else if (action === "join-seat" && online) {
        const name = playerName.trim();
        if (name) {
          dependencies.online?.saveName(name);
          online.join(name);
        }
      } else if (action === "add-bot") online?.addBot();
      else if (action === "remove-bot") {
        const id = target.closest<HTMLElement>("[data-bot-id]")?.dataset.botId;
        if (id) online?.removeBot(id);
      } else if (action === "start-room") online?.start();
      else if (action === "rematch-room") online?.rematch();
      else if (action === "lobby-room") online?.lobby();
      else if (action === "leave-room") showMenu();
      else if (action === "copy-room-link" && online) {
        const link = dependencies.online?.roomLink(online.code) ?? "";
        void navigator.clipboard?.writeText(link).catch(() => {});
      } else if (action === "settings") {
        screen = "settings";
        render();
      } else if (action === "back-menu") showMenu();
      else if (action === "retry-catalog") void loadCatalog();
      else if (action === "retry-map" && selectedId)
        void loadSelectedMap(selectedId);
      else if (
        action === "mode-sandbox" ||
        action === "mode-combat-lab" ||
        action === "mode-skirmish" ||
        action === "mode-watch"
      ) {
        mode =
          action === "mode-watch"
            ? "watch"
            : action === "mode-skirmish"
              ? "skirmish"
              : action === "mode-sandbox"
                ? "sandbox"
                : "combat-lab";
        const id =
          mode === "skirmish" || mode === "watch"
            ? "close-quarters"
            : mode === "sandbox"
              ? "sandbox-12"
              : "combat-lab-12";
        void loadSelectedMap(id);
      } else if (action === "start") launch();
      else if (action?.startsWith("build-")) {
        const kind = action.slice(6);
        const owner = session
          ?.view()
          .players.find((p) => p.id === session?.localPlayerId);
        if (
          isBuildKind(kind) &&
          owner &&
          constructionAvailability(owner, kind).allowed
        ) {
          placement = kind;
          placementCell = null;
          renderGame();
          root
            .querySelector<SVGSVGElement>("#nd-board")
            ?.focus?.({ preventScroll: true });
        }
      } else if (action === "cancel-placement") {
        placement = null;
        placementCell = null;
        renderGame();
        root
          .querySelector<SVGSVGElement>("#nd-board")
          ?.focus?.({ preventScroll: true });
      } else if (action === "auto-expand" && session) {
        const world = session.view();
        const player = world.players.find(
          (p) => p.id === session?.localPlayerId,
        );
        if (
          player &&
          world.structures.some(
            (s) =>
              s.cell === selectedCell &&
              s.kind === "brain" &&
              s.ownerId === player.id,
          )
        )
          dispatch({ type: "setAutoExpand", enabled: !player.autoExpand });
      } else if (action === "charge" && session && selectedCell !== null) {
        const world = session.view();
        const owner = world.players.find(
          (p) => p.id === session?.localPlayerId,
        );
        if (
          owner &&
          world.structures.some(
            (s) => s.cell === selectedCell && s.ownerId === owner.id,
          )
        )
          dispatch({
            type: "setPriority",
            cell: selectedCell,
            weight: owner.priorities[selectedCell] === 3 ? 0 : 3,
          });
      } else if (action === "cancel-build" && selectedCell !== null)
        dispatch({ type: "cancelConstruction", cell: selectedCell });
      else if (action?.startsWith("particle-")) {
        const kind = action.slice(9);
        if (kind === "pulse" || kind === "heavy" || kind === "swift")
          dispatch({ type: "setParticleKind", kind });
      } else if (action?.startsWith("research-")) {
        const research = action.slice(9);
        if (isResearchKind(research))
          dispatch({ type: "startResearch", research });
      } else if (action === "cancel-research")
        dispatch({ type: "cancelResearch" });
      else if (action === "reset" || action === "leave") {
        if (session?.view().finished) {
          if (action === "reset") restart();
          else showMenu();
          return;
        }
        pending = action;
        render();
      } else if (action === "cancel-confirm") {
        pending = null;
        render();
      } else if (action === "confirm-reset") {
        restart();
      } else if (action === "confirm-leave") showMenu();
      return;
    }
    if (screen === "game") {
      const tile = target.closest<SVGElement>("[data-cell]");
      if (tile) {
        selectedCell = Number(tile.dataset.cell);
        if (placement) {
          placeAt(selectedCell, event.shiftKey);
          return;
        }
        if (panel !== "build") panel = "inspect";
        renderGame();
      }
    }
  }

  function placeAt(cell: number, keepPlacing = false) {
    const world = session?.view();
    const owner = world?.players.find((p) => p.id === session?.localPlayerId);
    placementCell = cell;
    if (
      placement &&
      world &&
      owner &&
      constructionQueueAvailability(world, owner, placement, cell).allowed
    ) {
      const kind = placement;
      if (!keepPlacing) {
        placement = null;
        placementCell = null;
      }
      dispatch({ type: "queueConstruction", kind, cell });
    } else renderGame();
  }

  function onPointerMove(event: PointerEvent) {
    if (!placement || pending || event.pointerType === "touch" || event.buttons)
      return;
    const tile = (event.target as Element).closest<SVGElement>(
      "#nd-board [data-cell]",
    );
    const cell = tile ? Number(tile.dataset.cell) : null;
    if (cell !== placementCell) {
      placementCell = cell;
      renderGame();
    }
  }

  /** Text fields keep their value as typed, so a re-render never loses it. */
  function onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.dataset.field === "room-code") roomCode = target.value;
    if (target.dataset.field === "player-name") playerName = target.value;
  }

  function onChange(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.dataset.debug && dependencies.debug) {
      if (target.dataset.debug === "construction")
        instantConstruction = (target as HTMLInputElement).checked;
      if (target.dataset.debug === "research")
        instantResearch = (target as HTMLInputElement).checked;
      return;
    }
    if (target.dataset.field === "room-code") {
      roomCode = target.value;
      return;
    }
    if (target.dataset.field === "player-name") {
      playerName = target.value;
      return;
    }
    if (target.dataset.field === "room-map" && online) {
      if (bundledMap(target.value)) online.configure({ mapId: target.value });
      return;
    }
    if (target.dataset.field === "room-strategy" && online) {
      if (isAiStrategy(target.value))
        online.configure({ aiStrategy: target.value });
      return;
    }
    if (target.dataset.field === "room-powerups" && online) {
      online.configure({
        powerups: (target as HTMLInputElement).checked,
      });
      return;
    }
    if (target.dataset.field === "powerups") {
      powerups = (target as HTMLInputElement).checked;
      return;
    }
    if (target.dataset.field === "map") void loadSelectedMap(target.value);
    else if (
      target.dataset.field === "first-strategy" &&
      isAiStrategy(target.value)
    )
      firstAiStrategy = target.value;
    else if (
      target.dataset.field === "strategy" &&
      isAiStrategy(target.value)
    ) {
      aiStrategy = target.value;
    } else if (target.dataset.field === "spawn") {
      selectedSlot = Number(target.value);
      render();
    } else if (target.dataset.field === "priority" && selectedCell !== null) {
      dispatch({
        type: "setPriority",
        cell: selectedCell,
        weight: Number(target.value),
      });
      // The command may be queued or rejected. Once a drag is committed,
      // show the current authority until the next applied tick updates it.
      target.value = target.getAttribute("value") ?? "0";
    } else if (target.dataset.setting) {
      const setting = target.dataset.setting;
      if (setting === "mute")
        preferences = {
          ...preferences,
          mute: (target as HTMLInputElement).checked,
        };
      else if (setting === "reducedMotion")
        preferences = {
          ...preferences,
          reducedMotion: (target as HTMLInputElement).checked,
        };
      else if (setting === "volume")
        preferences = { ...preferences, volume: Number(target.value) };
      dependencies.preferences.write(preferences);
      dependencies.audio?.configure(preferences);
      dependencies.audio?.unlock();
      render();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (pending) {
      if (event.key === "Escape") {
        event.preventDefault();
        pending = null;
        render();
        return;
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          root.querySelectorAll<HTMLButtonElement>(
            '[role="alertdialog"] button',
          ),
        );
        const current = controls.indexOf(
          root.ownerDocument.activeElement as HTMLButtonElement,
        );
        event.preventDefault();
        controls[
          (current + (event.shiftKey ? -1 : 1) + controls.length) %
            controls.length
        ]?.focus();
      }
      return;
    }
    if (screen === "game" && event.key === "Escape" && placement) {
      event.preventDefault();
      placement = null;
      placementCell = null;
      renderGame();
      return;
    }
    if (screen === "game" && event.key === "Escape" && panel !== "inspect") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (
      screen === "game" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.repeat
    ) {
      const target = event.target as HTMLElement;
      if (
        !target.closest('input, select, textarea, [contenteditable="true"]')
      ) {
        if (
          "qweasd".includes(event.key.toLowerCase()) &&
          event.key.length === 1
        ) {
          const command = root.querySelector<HTMLButtonElement>(
            `.command-card [aria-keyshortcuts="${event.key.toUpperCase()}"]`,
          );
          if (command) {
            event.preventDefault();
            command.click();
          }
          return;
        }
      }
    }
    if (
      screen !== "game" ||
      pending ||
      (event.target !== root.querySelector("#nd-board") &&
        event.target !== root.querySelector("#nd-minimap"))
    )
      return;
    const world = gameWorld();
    if (!world) return;
    const current = selectedCell ?? 0;
    if (
      event.target === root.querySelector("#nd-minimap") &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      camera?.focusCell(world.map.width, current);
      updateMinimapView();
      return;
    }
    const width = world.map.width;
    const row = Math.floor(current / width),
      col = current % width;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key in delta) {
      event.preventDefault();
      const [dc, dr] = delta[event.key] ?? [0, 0];
      const c = Math.max(0, Math.min(width - 1, col + dc)),
        r = Math.max(0, Math.min(world.map.height - 1, row + dr));
      selectedCell = r * width + c;
      if (placement) placementCell = selectedCell;
      renderGame();
      camera?.ensureCellVisible(width, selectedCell);
    } else if (
      event.key === "Enter" &&
      selectedCell !== null &&
      world.map.cells[selectedCell]?.terrain === "open"
    ) {
      event.preventDefault();
      if (placement) placeAt(selectedCell, event.shiftKey);
    }
  }

  root.addEventListener("click", onClick);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("input", onInput);
  if (
    dependencies.initialRoom &&
    dependencies.online?.validCode(dependencies.initialRoom)
  )
    openRoom(dependencies.initialRoom);
  else render();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelLoads();
      disposeSession();
      dependencies.audio?.dispose();
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("change", onChange);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("input", onInput);
      root.innerHTML = "";
    },
  };
}
