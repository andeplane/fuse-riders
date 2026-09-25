import type { Action, MapDefinition, World, Outcome } from "../engine/types.js";
import { loadMap } from "../engine/index.js";
import { updateContent } from "./dom-update.js";
import { createAttractScene } from "./attract-scene.js";
import { renderBoard, type BoardAnimation } from "../render/board.js";
import type { BoardCamera, CameraFactory } from "../render/camera.js";
import type {
  GameMode,
  MapRepository,
  MapSummary,
  NeuralSession,
  PreferencesStore,
  PresentationPreferences,
  SessionFactory,
} from "./contracts.js";

type Screen = "menu" | "settings" | "setup" | "game";
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

const commandSymbols: Record<string, string> = {
  research:
    '<path d="M10 3v7L5 20q-1 3 3 3h16q4 0 3-3l-5-10V3M8 3h16M8 17h16"/><path d="M12 13h2m4 7h2"/>',
  log: '<path d="M7 3h18v26H7zM11 9h10M11 15h10M11 21h7"/>',
  fit: '<path d="M3 12V3h9m8 0h9v9M3 20v9h9m8 0h9v-9"/><path d="m10 16 6-6 6 6-6 6z"/>',
  cancel: '<path d="m7 7 18 18M25 7 7 25"/>',
};

function commandButton(options: {
  action: string;
  label: string;
  shortcut: string;
  description: string;
  art?: string;
  symbol?: string;
  cost?: string;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
}): string {
  const art = options.art
    ? `<img src="${escape(options.art)}" alt="" draggable="false">`
    : `<svg viewBox="0 0 32 32" aria-hidden="true">${commandSymbols[options.symbol ?? "research"] ?? commandSymbols.research}</svg>`;
  return `<button class="command-button" data-action="${options.action}" aria-label="${escape(options.label)}${options.cost ? ` · ${escape(options.cost)}` : ""}" aria-keyshortcuts="${options.shortcut}" title="${escape(options.description)} (${options.shortcut})" ${options.disabled ? "disabled" : ""}${options.expanded === undefined ? "" : ` aria-expanded="${options.expanded}" aria-controls="${options.controls}"`}><kbd>${options.shortcut}</kbd>${options.cost ? `<span class="command-cost">${options.cost}</span>` : ""}${art}<span class="command-label">${options.label}</span></button>`;
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
  createCamera?: CameraFactory;
}

export function mountNeuralDefence(
  root: HTMLElement,
  dependencies: AppDependencies,
): { dispose(): void } {
  let screen: Screen = "menu";
  let mode: GameMode = "sandbox";
  let catalog: LoadState<MapSummary[]> | null = null;
  let selectedId: string | null = null;
  let mapState: LoadState<MapDefinition> | null = null;
  let selectedSlot = 0;
  let selectedCell: number | null = null;
  let pending: "reset" | "leave" | null = null;
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
  let instantConstruction = false;
  let instantResearch = false;
  let notices: Outcome[] = [];
  let noticeTick = -1;
  let noticeMatch = "";
  let panel: "inspect" | "research" | "activity" = "inspect";
  const attractScene = createAttractScene();

  function stopAnimation() {
    if (frame !== null) dependencies.cancelFrame(frame);
    frame = null;
    animation = null;
  }

  function animate(now: number) {
    if (disposed || screen !== "game") return;
    animation?.animate(now);
    frame = dependencies.requestFrame(animate);
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
  }

  function showMenu() {
    cancelLoads();
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
        instantConstruction: dependencies.debug && instantConstruction,
        instantResearch: dependencies.debug && instantResearch,
      };
      const created = dependencies.createSession(
        mapState.value,
        selectedSlot,
        mode,
        settings,
      );
      disposeSession();
      session = created;
      panel = "inspect";
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
    return `<div class="nd-modal-backdrop"><section class="nd-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><p class="eyebrow">Progress will be discarded</p><h2 id="discard-title">${pending === "reset" ? "Reset this session?" : "Return to the menu?"}</h2><p>${pending === "reset" ? "The same map and spawn will start from the beginning." : "Your current network and research will be lost."}</p><div class="button-row"><button data-action="cancel-confirm" class="secondary">Keep playing</button><button data-action="confirm-${pending}" class="danger">${pending === "reset" ? "Reset session" : "Leave session"}</button></div></section></div>`;
  }

  function header(title: string, subtitle: string): string {
    return `<header class="nd-header"><div class="brand">NEURAL <strong>DEFENCE</strong></div><span class="header-subtitle">${escape(subtitle)}</span>${dependencies.debug ? '<span class="debug-badge">DEBUG</span>' : ""}</header>${screen === "game" || screen === "menu" ? "" : `<div class="screen-heading"><h1>${escape(title)}</h1></div>`}`;
  }

  function menuMarkup(): string {
    return `<div class="attract-scene" aria-hidden="true"><svg id="nd-attract-board"></svg></div><div class="attract-shade"></div>${header("Neural Defence", "A neural strategy game")}<main class="menu-layout fui-landing"><p class="eyebrow">GROW · CONNECT · DEFEND</p><h1 class="fui-landing-title">NEURAL<br><span>DEFENCE</span></h1><p class="fui-landing-tagline">Build your network.<br>Keep the signal alive.</p><nav class="fui-landing-actions" aria-label="Main menu"><button data-action="new-game" class="fui-button-primary menu-button"><span aria-hidden="true">▶</span> New game</button><button data-action="settings" class="menu-button">Settings</button></nav></main><footer class="menu-footer">A FUSE GAME <span>LOCAL SANDBOX</span></footer>`;
  }

  function settingsMarkup(): string {
    return `${header("Settings", "presentation")}<main class="nd-panel settings-panel"><p>Preferences stay on this device.</p><label class="setting-row"><span><strong>Reduced motion</strong><small>Reduce particle animation and flashes</small></span><input type="checkbox" data-setting="reducedMotion" ${preferences.reducedMotion ? "checked" : ""}></label><button data-action="back-menu" class="secondary">← Back</button></main>`;
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
        <button data-action="mode-sandbox" class="choice ${mode === "sandbox" ? "active" : ""}" aria-pressed="${mode === "sandbox"}"><strong>Open sandbox</strong><span>One player, no AI. Grow at your pace.</span></button>
        <button data-action="mode-combat-lab" class="choice ${mode === "combat-lab" ? "active" : ""}" aria-pressed="${mode === "combat-lab"}"><strong>Combat lab</strong><span>Scripted opposition to test routing and cuts.</span></button>
        </div><p class="section-index">02 / FIELD</p>${catalogBlock}${details}</section>
        <aside class="nd-panel setup-summary"><p class="section-index">SESSION BRIEF</p>
        <h2>${mode === "sandbox" ? "An open beginning" : "A controlled confrontation"}</h2>
        <p>One local player · No AI controller${mode === "combat-lab" ? " · Scripted opposing network" : ""}</p>
        ${
          dependencies.debug
            ? `<fieldset class="debug-options"><legend>Debug options</legend>
          <p>Clear tile boundaries are on. Particle travel always takes normal time.</p>
          <label><input type="checkbox" data-debug="construction" ${instantConstruction ? "checked" : ""}> Instant construction after delivery</label>
          <label><input type="checkbox" data-debug="research" ${instantResearch ? "checked" : ""}> Instant research</label>
          <small>Resource costs and prerequisites still apply.</small></fieldset>`
            : "<p>Normal construction and research timing.</p>"
        }
        ${launchError ? `<div class="error-card" role="alert">${escape(launchError)}<button data-action="start">Retry launch</button></div>` : ""}
        <div class="button-row"><button data-action="back-menu" class="secondary">← Back</button>
        <button data-action="start" class="primary" ${loaded && !launching ? "" : "disabled"}>${launching ? "Starting…" : "Start →"}</button></div></aside></main>`;
  }

  function gameMarkup(): string {
    const title =
      catalog?.status === "ready"
        ? catalog.value.find((m) => m.id === selectedId)?.title
        : undefined;
    return `<main class="game-layout" aria-label="${escape(title ?? "Neural field")} battlefield" ${pending ? "inert" : ""}>
      <section class="board-shell">
      <div id="nd-viewport" class="board-scroll"><svg id="nd-board" class="nd-board" tabindex="0" aria-label="Hex board. Use arrow keys to move selection."></svg></div>
      </section>
      <aside id="game-sidebar" class="game-sidebar"></aside></main><div id="game-modal">${modal()}</div>`;
  }

  function sidebarMarkup(world: Readonly<World>): string {
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
              p.ownerId === player.id &&
              p.cell === selectedCell &&
              p.mode === "stationed",
          ).length;
    const incoming =
      selectedCell === null
        ? []
        : world.particles.filter(
            (p) =>
              p.ownerId === player.id &&
              p.to === selectedCell &&
              p.mode === "transit",
          );
    const worker = player.worker;
    const team = ["blue", "coral", "green", "gold"][player.slot] ?? "blue";
    const sprite = (name: string) =>
      dependencies.sprites?.[`${name}-v2`] ?? dependencies.sprites?.[name];
    const portrait = structure
      ? sprite(
          structure.kind === "tower"
            ? "tower-experimental"
            : `${structure.kind}-${["blue", "coral", "green", "gold"][world.players.find((p) => p.id === structure.ownerId)?.slot ?? 0]}`,
        )
      : cell?.terrain === "deposit"
        ? sprite(`deposit-${cell.resourceKind}`)
        : sprite(
            cell?.terrain === "blocked" ? "blocker-boulder" : "terrain-slate-a",
          );
    const detail =
      selectedCell === null
        ? '<div class="selection-summary"><strong>Select a hex</strong><span>Click terrain to build or inspect.</span></div>'
        : `<div class="selection-summary"><div class="tile-heading"><span>HEX ${selectedCell}</span><strong>${structure ? `${structure.kind.toUpperCase()} · ${structure.hp} HP` : cell?.terrain === "deposit" ? `${cell.resourceKind.toUpperCase()} DEPOSIT` : cell?.terrain === "blocked" ? "BLOCKED GROUND" : "OPEN GROUND"}</strong></div>
        ${structure ? `<span title="${structure.connected ? "Connected to brain" : "Disconnected from brain"}${incoming.length ? ` · next arrival tick ${Math.min(...incoming.map((p) => p.arrivesAt))}` : ""}">${structure.connected ? "Connected" : "Disconnected"} · ${count} particles · ${incoming.length} incoming</span>` : ""}
        ${cell?.terrain === "deposit" ? '<span title="Each connected friendly neighbor earns one sixth of this source. Several players may share it.">Expand alongside to mine.</span>' : ""}</div>
        ${owned ? `<div class="priority-control"><label class="field-label" for="priority-slider">Attack priority · ${priority}/3</label><input id="priority-slider" data-field="priority" type="range" min="0" max="3" step="1" value="${priority}"></div>` : ""}
        ${queued ? `<span class="construction-progress" title="Queued construction waits for support, builder and resources.">${queued.paid ? `Growing · ${queued.progress}/${queued.duration}` : "Queued"}</span>` : ""}`;
    const researchNames: Record<string, string> = {
      growth: "Growth efficiency",
      excitation: "Excitation",
      conduction: "Conduction",
    };
    const researchDescription: Record<string, string> = {
      growth: "Faster future neuron construction",
      excitation: "Stronger newly dispatched attack particles",
      conduction: "Faster newly dispatched attack particles",
    };
    const research = Object.keys(researchNames)
      .map(
        (key) =>
          `<button class="research-option" data-action="research-${key}" aria-keyshortcuts="${key === "growth" ? "G" : key === "excitation" ? "E" : "C"}" ${player.research.includes(key as (typeof player.research)[number]) || player.researchJob || player.insight < 10_000 || !player.alive ? "disabled" : ""}><strong>${researchNames[key]} <kbd>${key === "growth" ? "G" : key === "excitation" ? "E" : "C"}</kbd></strong><span>${researchDescription[key]} · 10 ◇</span></button>`,
      )
      .join("");
    const canBuild =
      !structure && cell?.terrain === "open" && !queued && player.alive;
    const commands = [
      commandButton({
        action: "build-neuron",
        label: "Neuron",
        shortcut: "N",
        cost: "20 ◈",
        art: sprite(`neuron-${team}`),
        description:
          "Queue a neuron on the selected open hex. Needs a connected neighbor; waits for support and resources.",
        disabled: !canBuild,
      }),
      commandButton({
        action: "build-tower",
        label: "Tower",
        shortcut: "T",
        cost: "60 ◈",
        art: sprite("tower-experimental"),
        description:
          "Queue a test tower. Needs all six neighbors connected and owned; waits for support and resources.",
        disabled: !canBuild,
      }),
      commandButton({
        action: "panel-research",
        label: "Research",
        shortcut: "R",
        symbol: "research",
        description: "Research network upgrades",
        expanded: panel === "research",
        controls: "research-panel",
      }),
      commandButton({
        action: "cancel-build",
        label: "Cancel",
        shortcut: "X",
        symbol: "cancel",
        description: "Cancel the selected construction",
        disabled: !queued,
      }),
      commandButton({
        action: "panel-activity",
        label: "Log",
        shortcut: "L",
        symbol: "log",
        description: "Recent network activity",
        expanded: panel === "activity",
        controls: "activity-panel",
      }),
      commandButton({
        action: "zoom-fit",
        label: "Fit map",
        shortcut: "F",
        symbol: "fit",
        description: "Show the entire map",
      }),
    ].join("");
    const outcomes = notices
      .filter((item) => item.playerId === player.id)
      .slice(-3)
      .map(
        (item) =>
          `<li>${escape(item.type)}${item.reason ? ` · ${escape(item.reason)}` : ""}${item.cell !== undefined ? ` at hex ${item.cell}` : ""}</li>`,
      )
      .join("");
    return `<div class="battle-topbar"><div class="resource-row"><div><small>BIOMASS</small><strong>◈ ${units(player.biomass)}</strong></div><div><small>INSIGHT</small><strong>◇ ${units(player.insight)}</strong></div></div><div class="hud-mini"></div>${dependencies.debug ? '<div class="debug-note"></div>' : ""}<div class="session-controls"><button data-action="reset" class="secondary">Reset</button><button data-action="leave" class="secondary">Menu</button></div></div>
      <div class="command-dock"><section class="inspector" aria-label="Selected hex">${portrait ? `<div class="selection-portrait"><img src="${escape(portrait)}" alt="" draggable="false"></div>` : ""}<div class="selection-details">${detail}<span class="construction-summary" title="${escape(player.queue.map((q) => `Hex ${q.cell} · ${q.kind}${q.paid ? " · building" : " · waiting"}`).join("\n"))}">${player.queue.length}/32 queued · builder ${escape(worker.mode)}</span></div></section><nav class="command-card" aria-label="Commands">${commands}</nav></div>
      <section id="research-panel" class="nd-panel hud-popover research-panel" aria-label="Research" ${panel !== "research" ? "hidden" : ""}><div class="popover-heading"><strong>Research</strong><button data-action="close-panel" aria-label="Close research">×</button></div><p>${player.researchJob ? `${researchNames[player.researchJob.kind]} · ends tick ${player.researchJob.completesAt}` : "Choose an upgrade for your network."}${player.research.length ? ` · completed: ${player.research.map((r) => researchNames[r]).join(", ")}` : ""}</p>${player.researchJob ? '<button data-action="cancel-research" class="secondary">Cancel research</button>' : research}</section>
      <section id="activity-panel" class="nd-panel hud-popover activity-panel" aria-label="Recent activity" ${panel !== "activity" ? "hidden" : ""}><div class="popover-heading"><strong>Recent activity</strong><button data-action="close-panel" aria-label="Close activity">×</button></div><ul class="event-list" aria-live="polite">${outcomes || "<li>No recent activity.</li>"}</ul></section>`;
  }

  function renderGame() {
    const world = gameWorld();
    if (!world) return;
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
      rate.textContent = `Tick ${world.tick} · +${income("biomass").toFixed(1)} ◈ / s · +${income("insight").toFixed(1)} ◇ / s`;
    const debugNote = sidebar.querySelector<HTMLElement>(".debug-note");
    if (debugNote)
      debugNote.textContent = `DEBUG · grid${world.settings.instantConstruction ? " · instant build" : ""}${world.settings.instantResearch ? " · instant research" : ""} · normal travel`;
    animation = renderBoard(
      svg,
      world,
      selectedCell,
      dependencies.debug,
      preferences.reducedMotion,
      dependencies.animationClock(),
      dependencies.sprites,
    );
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
    session?.dispatch(action);
    renderGame();
  }

  function closePanel() {
    const previous = panel;
    panel = "inspect";
    renderGame();
    root
      .querySelector<HTMLButtonElement>(`[data-action="panel-${previous}"]`)
      ?.focus();
  }

  function onClick(event: MouseEvent) {
    const target = event.target as Element;
    const button = target.closest<HTMLElement>("[data-action]");
    if (button?.dataset.action?.startsWith("panel-")) {
      const next = button.dataset.action.slice(6);
      if (next === "inspect" || next === "research" || next === "activity")
        panel = panel === next ? "inspect" : next;
      renderGame();
      if (panel !== "inspect") {
        root
          .querySelector<HTMLButtonElement>(
            `#${panel}-panel [data-action="close-panel"]`,
          )
          ?.focus?.();
      }
      return;
    }
    if (button) {
      const action = button.dataset.action;
      if (action === "close-panel") {
        closePanel();
      } else if (action === "new-game") {
        screen = "setup";
        mode = "sandbox";
        selectedId = "sandbox-12";
        void loadCatalog();
      } else if (action === "settings") {
        screen = "settings";
        render();
      } else if (action === "zoom-fit") {
        camera?.fit();
      } else if (action === "back-menu") showMenu();
      else if (action === "retry-catalog") void loadCatalog();
      else if (action === "retry-map" && selectedId)
        void loadSelectedMap(selectedId);
      else if (action === "mode-sandbox" || action === "mode-combat-lab") {
        mode = action === "mode-sandbox" ? "sandbox" : "combat-lab";
        const id = mode === "sandbox" ? "sandbox-12" : "combat-lab-12";
        void loadSelectedMap(id);
      } else if (action === "start") launch();
      else if (action === "build-neuron" && selectedCell !== null)
        dispatch({
          type: "queueConstruction",
          cell: selectedCell,
          kind: "neuron",
        });
      else if (action === "build-tower" && selectedCell !== null)
        dispatch({
          type: "queueConstruction",
          cell: selectedCell,
          kind: "tower",
        });
      else if (action === "cancel-build" && selectedCell !== null)
        dispatch({ type: "cancelConstruction", cell: selectedCell });
      else if (action?.startsWith("research-"))
        dispatch({
          type: "startResearch",
          research: action.slice(9) as "growth" | "excitation" | "conduction",
        });
      else if (action === "cancel-research")
        dispatch({ type: "cancelResearch" });
      else if (action === "reset" || action === "leave") {
        pending = action;
        render();
      } else if (action === "cancel-confirm") {
        pending = null;
        render();
      } else if (action === "confirm-reset") {
        session?.reset();
        pending = null;
        render();
      } else if (action === "confirm-leave") showMenu();
      return;
    }
    if (screen === "game") {
      const tile = target.closest<SVGElement>("[data-cell]");
      if (tile) {
        selectedCell = Number(tile.dataset.cell);
        panel = "inspect";
        renderGame();
      }
    }
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
    if (target.dataset.field === "map") void loadSelectedMap(target.value);
    else if (target.dataset.field === "spawn") {
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
        const action = (
          {
            n: "build-neuron",
            t: "build-tower",
            r: "panel-research",
            l: "panel-activity",
            f: "zoom-fit",
            x: "cancel-build",
            ...(panel === "research"
              ? {
                  g: "research-growth",
                  e: "research-excitation",
                  c: "research-conduction",
                }
              : {}),
          } as Record<string, string>
        )[event.key.toLowerCase()];
        if (action) {
          const command = root.querySelector<HTMLButtonElement>(
            `[data-action="${action}"]`,
          );
          if (command && !command.disabled) {
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
      event.target !== root.querySelector("#nd-board")
    )
      return;
    const world = gameWorld();
    if (!world) return;
    const current = selectedCell ?? 0;
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
      renderGame();
      camera?.ensureCellVisible(width, selectedCell);
    } else if (
      event.key === "Enter" &&
      selectedCell !== null &&
      world.map.cells[selectedCell]?.terrain === "open"
    ) {
      event.preventDefault();
      dispatch({
        type: "queueConstruction",
        cell: selectedCell,
        kind: "neuron",
      });
    }
  }

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKeyDown);
  render();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelLoads();
      disposeSession();
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
      root.removeEventListener("keydown", onKeyDown);
      root.innerHTML = "";
    },
  };
}
