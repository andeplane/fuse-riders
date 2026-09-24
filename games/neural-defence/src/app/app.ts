import type { Action, MapDefinition, World } from '../engine/types.js';
import { loadMap } from '../engine/index.js';
import { renderBoard, type BoardAnimation } from '../render/board.js';
import type { GameMode, MapRepository, MapSummary, NeuralSession, PreferencesStore, PresentationPreferences, SessionFactory } from './contracts.js';

type Screen = 'menu' | 'settings' | 'setup' | 'game';
type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function units(value: number): string { return (value / 1000).toFixed(1); }

export interface AppDependencies {
  maps: MapRepository;
  preferences: PreferencesStore;
  createSession: SessionFactory;
  debug: boolean;
  animationClock: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
}

export function mountNeuralDefence(root: HTMLElement, dependencies: AppDependencies): { dispose(): void } {
  let screen: Screen = 'menu';
  let mode: GameMode = 'sandbox';
  let catalog: LoadState<MapSummary[]> | null = null;
  let selectedId: string | null = null;
  let mapState: LoadState<MapDefinition> | null = null;
  let selectedSlot = 0;
  let selectedCell: number | null = null;
  let pending: 'reset' | 'leave' | null = null;
  let launchError: string | null = null;
  let launching = false;
  let session: NeuralSession | null = null;
  let unsubscribe: (() => void) | null = null;
  let aborter: AbortController | null = null;
  let generation = 0;
  let animation: BoardAnimation | null = null;
  let frame: number | null = null;
  let disposed = false;
  let preferences: PresentationPreferences = dependencies.preferences.read();

  function stopAnimation() {
    if (frame !== null) dependencies.cancelFrame(frame);
    frame = null;
    animation = null;
  }

  function animate(now: number) {
    if (disposed || screen !== 'game') return;
    animation?.animate(now);
    frame = dependencies.requestFrame(animate);
  }

  function cancelLoads() { generation++; aborter?.abort(); aborter = null; }

  function disposeSession() { stopAnimation(); unsubscribe?.(); unsubscribe = null; session?.dispose(); session = null; }

  function showMenu() { cancelLoads(); disposeSession(); pending = null; launchError = null; screen = 'menu'; render(); }

  async function loadCatalog() {
    cancelLoads();
    const token = generation;
    aborter = new AbortController();
    catalog = { status: 'loading' }; mapState = null; render();
    try {
      const value = await dependencies.maps.list(aborter.signal);
      if (disposed || token !== generation || screen !== 'setup') return;
      catalog = { status: 'ready', value };
      if (!selectedId || !value.some(item => item.id === selectedId)) selectedId = value[0]?.id ?? null;
      render();
      if (selectedId) await loadSelectedMap(selectedId);
    } catch (error) {
      if (disposed || token !== generation || screen !== 'setup') return;
      catalog = { status: 'error', message: error instanceof Error ? error.message : 'The map catalog could not be loaded.' };
      render();
    }
  }

  async function loadSelectedMap(id: string) {
    cancelLoads();
    const token = generation;
    aborter = new AbortController();
    selectedId = id; selectedSlot = 0; mapState = { status: 'loading' }; launchError = null; render();
    try {
      const raw = await dependencies.maps.load(id, aborter.signal);
      const value = loadMap(raw);
      if (disposed || token !== generation || screen !== 'setup') return;
      mapState = { status: 'ready', value };
      selectedSlot = value.spawns[0]?.slot ?? 0;
      render();
    } catch (error) {
      if (disposed || token !== generation || screen !== 'setup') return;
      mapState = { status: 'error', message: error instanceof Error ? error.message : 'This map is invalid.' };
      render();
    }
  }

  function launch() {
    if (launching || mapState?.status !== 'ready') return;
    launching = true; launchError = null; render();
    try {
      const settings = { instantConstruction: dependencies.debug, instantResearch: dependencies.debug };
      const created = dependencies.createSession(mapState.value, selectedSlot, mode, settings);
      disposeSession();
      session = created;
      selectedCell = mapState.value.spawns.find(spawn => spawn.slot === selectedSlot)?.cellIndex ?? null;
      unsubscribe = created.subscribe(() => { if (screen === 'game') renderGame(); });
      screen = 'game'; render();
    } catch (error) {
      launchError = error instanceof Error ? error.message : 'The session could not start.';
    } finally { launching = false; render(); }
  }

  function gameWorld(): Readonly<World> | null { return session?.view() ?? null; }

  function modal(): string {
    if (!pending) return '';
    return `<div class="nd-modal-backdrop"><section class="nd-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><p class="eyebrow">Progress will be discarded</p><h2 id="discard-title">${pending === 'reset' ? 'Reset this session?' : 'Return to the menu?'}</h2><p>${pending === 'reset' ? 'The same map and spawn will start from the beginning.' : 'Your current network and research will be lost.'}</p><div class="button-row"><button data-action="cancel-confirm" class="secondary">Keep playing</button><button data-action="confirm-${pending}" class="danger">${pending === 'reset' ? 'Reset session' : 'Leave session'}</button></div></section></div>`;
  }

  function header(title: string, subtitle: string): string {
    return `<header class="nd-header"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><span>NEURAL <strong>DEFENCE</strong></span></div><span class="header-subtitle">${subtitle}</span>${dependencies.debug ? '<span class="debug-badge">DEBUG · INSTANT BUILD + RESEARCH</span>' : ''}</header><div class="screen-heading"><p class="eyebrow">Phase 0 / ${escape(subtitle)}</p><h1>${escape(title)}</h1></div>`;
  }

  function menuMarkup(): string {
    return `${header('Grow a living network.', 'main menu')}<main class="menu-layout"><section class="hero-card"><div class="hero-illustration" aria-hidden="true"><div class="hero-brain">◈</div><div class="hero-line hero-line-a"></div><div class="hero-line hero-line-b"></div><div class="hero-node hero-node-a"></div><div class="hero-node hero-node-b"></div></div><p>Every branch carries your limited charge. Grow toward resources, direct the flow, and see how a network holds under pressure.</p></section><nav class="menu-actions" aria-label="Main menu"><button data-action="new-game" class="primary menu-button"><span>New game</span><span aria-hidden="true">↗</span></button><button data-action="settings" class="secondary menu-button"><span>Settings</span><span aria-hidden="true">⚙</span></button></nav></main>`;
  }

  function settingsMarkup(): string {
    return `${header('Settings', 'presentation')}<main class="nd-panel settings-panel"><p>Presentation preferences stay on this device and do not change simulation rules.</p><label class="setting-row"><span><strong>Mute audio</strong><small>Keep the sandbox quiet</small></span><input type="checkbox" data-setting="mute" ${preferences.mute ? 'checked' : ''}></label><label class="setting-row"><span><strong>Volume</strong><small>Sound level when audio is enabled</small></span><input type="range" data-setting="volume" min="0" max="1" step="0.05" value="${preferences.volume}" ${preferences.mute ? 'disabled' : ''}></label><label class="setting-row"><span><strong>Reduced motion</strong><small>Minimize travel animation</small></span><input type="checkbox" data-setting="reducedMotion" ${preferences.reducedMotion ? 'checked' : ''}></label><button data-action="back-menu" class="secondary">← Back</button></main>`;
  }

  function setupMarkup(): string {
    const mapOptions = catalog?.status === 'ready' ? catalog.value.map(map => `<option value="${escape(map.id)}" ${selectedId === map.id ? 'selected' : ''}>${escape(map.title)}</option>`).join('') : '';
    const catalogBlock = !catalog || catalog.status === 'loading' ? '<p role="status">Loading maps…</p>'
      : catalog.status === 'error' ? `<div class="error-card" role="alert"><strong>Map catalog unavailable</strong><p>${escape(catalog.message)}</p><button data-action="retry-catalog">Retry</button></div>`
      : catalog.value.length === 0 ? '<div class="empty-card">No maps are available yet. <button data-action="retry-catalog">Retry</button></div>'
      : `<label class="field-label" for="map-picker">Map</label><select id="map-picker" data-field="map">${mapOptions}</select>`;
    const loaded = mapState?.status === 'ready' ? mapState.value : null;
    const details = !selectedId || catalog?.status !== 'ready' ? ''
      : !mapState || mapState.status === 'loading' ? '<p role="status">Validating selected map…</p>'
      : mapState.status === 'error' ? `<div class="error-card" role="alert"><strong>Map unavailable or invalid</strong><p>${escape(mapState.message)}</p><button data-action="retry-map">Retry map</button></div>`
      : `<div class="map-meta"><strong>${loaded?.width} × ${loaded?.height} hexes</strong><span>◈ Biomass deposits</span><span>◇ Insight deposits</span><span>▰ Blocked ground</span></div><label class="field-label" for="spawn-picker">Spawn</label><select id="spawn-picker" data-field="spawn">${loaded?.spawns.map(spawn=>`<option value="${spawn.slot}" ${selectedSlot===spawn.slot?'selected':''}>Spawn ${spawn.slot+1} · tile ${spawn.cellIndex}</option>`).join('')}</select>`;
    return `${header('New game', 'setup')}<main class="setup-layout"><section class="nd-panel"><p class="section-index">01 / SCENARIO</p><div class="choice-grid"><button data-action="mode-sandbox" class="choice ${mode==='sandbox'?'active':''}" aria-pressed="${mode==='sandbox'}"><strong>Open sandbox</strong><span>One player, no AI. Grow at your pace.</span></button><button data-action="mode-combat-lab" class="choice ${mode==='combat-lab'?'active':''}" aria-pressed="${mode==='combat-lab'}"><strong>Combat lab</strong><span>Scripted opposition to test routing and cuts.</span></button></div><p class="section-index">02 / FIELD</p>${catalogBlock}${details}</section><aside class="nd-panel setup-summary"><p class="section-index">SESSION BRIEF</p><h2>${mode==='sandbox'?'An open beginning':'A controlled confrontation'}</h2><p>One local player · No AI controller${mode==='combat-lab'?' · Scripted opposing network':''}</p><p>${dependencies.debug?'Debug timing: construction and research complete instantly after acceptance. Travel takes normal time.':'Normal construction and research timing.'}</p>${launchError?`<div class="error-card" role="alert">${escape(launchError)}<button data-action="start">Retry launch</button></div>`:''}<div class="button-row"><button data-action="back-menu" class="secondary">← Back</button><button data-action="start" class="primary" ${loaded&&!launching?'':'disabled'}>${launching?'Starting…':'Start →'}</button></div></aside></main>`;
  }

  function gameMarkup(): string {
    return `${header('Living network', mode === 'sandbox' ? 'solo sandbox' : 'combat lab')}<main class="game-layout"><section class="board-shell"><div class="board-topline"><span>◈ SLATE BASIN <small>· ${mode === 'sandbox' ? '1 player / no AI' : 'scripted opposition'}</small></span><span id="tick-label">TICK 0</span></div><div class="board-scroll"><svg id="nd-board" class="nd-board" tabindex="0" aria-label="Hex board. Use arrow keys to move selection."></svg></div><p class="board-hint">Select a hex to inspect. Arrow keys move the selection; Enter queues a neuron.</p></section><aside id="game-sidebar" class="game-sidebar"></aside></main>${modal()}`;
  }

  function sidebarMarkup(world: Readonly<World>): string {
    const player=world.players[0];
    if (!player) return '<div class="nd-panel">No local player exists.</div>';
    const structure=world.structures.find(item=>item.cell===selectedCell);
    const cell=selectedCell===null?null:world.map.cells[selectedCell];
    const owned=structure?.ownerId===player.id;
    const queued=player.queue.find(item=>item.cell===selectedCell);
    const priority=selectedCell===null?0:player.priorities[String(selectedCell)]??0;
    const count=selectedCell===null?0:world.particles.filter(p=>p.ownerId===player.id&&p.cell===selectedCell&&p.mode==='stationed').length;
    const incoming=selectedCell===null?[]:world.particles.filter(p=>p.ownerId===player.id&&p.to===selectedCell&&p.mode==='transit');
    const worker=player.worker;
    const detail = selectedCell===null ? '<p>Select a hex to see its role and actions.</p>'
      : `<div class="tile-heading"><span>HEX ${selectedCell}</span><strong>${structure?`${structure.kind.toUpperCase()} · ${structure.hp} HP`:cell?.terrain==='deposit'?`${cell.resourceKind.toUpperCase()} DEPOSIT`:cell?.terrain==='blocked'?'BLOCKED GROUND':cell?.towerSite?'TOWER SITE':'OPEN GROUND'}</strong></div>${structure?`<p>${structure.connected?'Connected to brain':'Disconnected from brain'} · ${count} attack particles stationed · ${incoming.length} incoming${incoming.length?` (next arrival tick ${Math.min(...incoming.map(p=>p.arrivesAt))})`:''}</p>`:''}${owned?`<label class="field-label" for="priority-slider">Attack demand priority · ${priority}/3</label><input id="priority-slider" data-field="priority" type="range" min="0" max="3" step="1" value="${priority}">`:''}${!structure&&cell?.terrain==='open'&&!queued?`<div class="button-row"><button data-action="build-neuron" class="primary">Queue neuron · 20 ◈</button>${cell.towerSite?'<button data-action="build-tower" class="secondary">Queue test tower · 60 ◈</button>':''}</div>`:''}${queued?`<p>Construction ${queued.paid?`in progress · ${queued.progress}/${queued.duration} ticks`:'queued / awaiting builder or resources'}</p><button data-action="cancel-build" class="secondary">Cancel construction</button>`:''}`;
    const researchNames: Record<string,string>={growth:'Growth efficiency',excitation:'Excitation',conduction:'Conduction'};
    const researchDescription: Record<string,string>={growth:'Faster future neuron construction',excitation:'Stronger newly dispatched attack particles',conduction:'Faster newly dispatched attack particles'};
    const research=Object.keys(researchNames).map(key=>`<button class="research-option" data-action="research-${key}" ${player.research.includes(key as typeof player.research[number])||player.researchJob?'disabled':''}><strong>${researchNames[key]}</strong><span>${researchDescription[key]} · 10 ◇</span></button>`).join('');
    const outcomes=world.outcomes.filter(item=>item.playerId===player.id).slice(-3).map(item=>`<li>${escape(item.type)}${item.reason?` · ${escape(item.reason)}`:''}${item.cell!==undefined?` at hex ${item.cell}`:''}</li>`).join('');
    return `<div class="nd-panel hud-panel"><div class="resource-row"><div><small>BIOMASS</small><strong>◈ ${units(player.biomass)}</strong></div><div><small>INSIGHT</small><strong>◇ ${units(player.insight)}</strong></div></div><div class="hud-mini">Tick ${world.tick} · +1.0 ◈ / s · +0.5 ◇ / s baseline</div>${dependencies.debug?'<div class="debug-note">DEBUG · instant jobs · normal particle travel</div>':''}</div><div class="nd-panel inspector"><p class="section-index">INSPECTOR</p>${detail}</div><div class="nd-panel"><p class="section-index">CONSTRUCTION</p><p>${player.queue.length} / 32 queued · builder ${escape(worker.mode)}</p>${player.queue.length?`<ol class="queue-list">${player.queue.map(q=>`<li>Hex ${q.cell} · ${q.kind}${q.paid?' · building':' · waiting'}</li>`).join('')}</ol>`:'<p>No route queued. Select an open neighbor to expand.</p>'}</div><div class="nd-panel"><p class="section-index">RESEARCH</p><p>${player.researchJob?`${researchNames[player.researchJob.kind]} · ends tick ${player.researchJob.completesAt}`:'No active research'}${player.research.length?` · completed: ${player.research.map(r=>researchNames[r]).join(', ')}`:''}</p>${player.researchJob?'<button data-action="cancel-research" class="secondary">Cancel research</button>':research}</div><div class="nd-panel"><p class="section-index">SESSION</p><ul class="event-list">${outcomes||'<li>Awaiting first action.</li>'}</ul><div class="button-row"><button data-action="reset" class="secondary">Reset</button><button data-action="leave" class="secondary">Menu</button></div></div>`;
  }

  function renderGame() {
    const world=gameWorld();
    if (!world) return;
    const svg=root.querySelector<SVGSVGElement>('#nd-board');
    const sidebar=root.querySelector<HTMLElement>('#game-sidebar');
    const tick=root.querySelector<HTMLElement>('#tick-label');
    if (!svg||!sidebar) return;
    const focus=document.activeElement as HTMLElement | null;
    const focusAction=focus?.dataset.action;
    const focusField=focus?.dataset.field;
    if (tick) tick.textContent=`TICK ${world.tick}`;
    sidebar.innerHTML=sidebarMarkup(world);
    if (focusAction) sidebar.querySelector<HTMLElement>(`[data-action="${focusAction}"]`)?.focus();
    else if (focusField) sidebar.querySelector<HTMLElement>(`[data-field="${focusField}"]`)?.focus();
    animation=renderBoard(svg,world,selectedCell,dependencies.debug,preferences.reducedMotion,dependencies.animationClock());
  }

  function render() {
    if (disposed) return;
    root.innerHTML=screen==='menu'?menuMarkup():screen==='settings'?settingsMarkup():screen==='setup'?setupMarkup():gameMarkup();
    if (screen==='game') {
      stopAnimation();
      renderGame();
      frame=dependencies.requestFrame(animate);
    }
  }

  function dispatch(action: Action) { session?.dispatch(action); renderGame(); }

  function onClick(event: MouseEvent) {
    const target=event.target as Element;
    const button=target.closest<HTMLElement>('[data-action]');
    if (button) {
      const action=button.dataset.action;
      if (action==='new-game') { screen='setup'; mode='sandbox'; selectedId='sandbox-12'; loadCatalog(); }
      else if (action==='settings') { screen='settings'; render(); }
      else if (action==='back-menu') showMenu();
      else if (action==='retry-catalog') loadCatalog();
      else if (action==='retry-map'&&selectedId) loadSelectedMap(selectedId);
      else if (action==='mode-sandbox'||action==='mode-combat-lab') { mode=action==='mode-sandbox'?'sandbox':'combat-lab'; const id=mode==='sandbox'?'sandbox-12':'combat-lab-12'; loadSelectedMap(id); }
      else if (action==='start') launch();
      else if (action==='build-neuron'&&selectedCell!==null) dispatch({type:'queueConstruction',cell:selectedCell,kind:'neuron'});
      else if (action==='build-tower'&&selectedCell!==null) dispatch({type:'queueConstruction',cell:selectedCell,kind:'tower'});
      else if (action==='cancel-build'&&selectedCell!==null) dispatch({type:'cancelConstruction',cell:selectedCell});
      else if (action?.startsWith('research-')) dispatch({type:'startResearch',research:action.slice(9) as 'growth'|'excitation'|'conduction'});
      else if (action==='cancel-research') dispatch({type:'cancelResearch'});
      else if (action==='reset'||action==='leave') { pending=action; render(); }
      else if (action==='cancel-confirm') { pending=null; render(); }
      else if (action==='confirm-reset') { session?.reset(); pending=null; render(); }
      else if (action==='confirm-leave') showMenu();
      return;
    }
    if (screen==='game') {
      const tile=target.closest<SVGElement>('[data-cell]');
      if (tile) { selectedCell=Number(tile.dataset.cell); renderGame(); }
    }
  }

  function onChange(event: Event) {
    const target=event.target as HTMLInputElement|HTMLSelectElement;
    if (target.dataset.field==='map') loadSelectedMap(target.value);
    else if (target.dataset.field==='spawn') { selectedSlot=Number(target.value); render(); }
    else if (target.dataset.field==='priority'&&selectedCell!==null) dispatch({type:'setPriority',cell:selectedCell,weight:Number(target.value)});
    else if (target.dataset.setting) {
      const setting=target.dataset.setting;
      if (setting==='mute') preferences={...preferences,mute:(target as HTMLInputElement).checked};
      else if (setting==='reducedMotion') preferences={...preferences,reducedMotion:(target as HTMLInputElement).checked};
      else if (setting==='volume') preferences={...preferences,volume:Number(target.value)};
      dependencies.preferences.write(preferences); render();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (screen!=='game'||pending||!(event.target instanceof SVGSVGElement)) return;
    const world=gameWorld(); if (!world) return;
    const current=selectedCell??0;
    const width=world.map.width;
    const row=Math.floor(current/width), col=current%width;
    const delta: Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if (event.key in delta) {
      event.preventDefault();
      const [dc,dr]=delta[event.key] ?? [0,0];
      const c=Math.max(0,Math.min(width-1,col+dc)),r=Math.max(0,Math.min(world.map.height-1,row+dr));
      selectedCell=r*width+c; renderGame();
    } else if (event.key==='Enter'&&selectedCell!==null&&world.map.cells[selectedCell]?.terrain==='open') {
      event.preventDefault();dispatch({type:'queueConstruction',cell:selectedCell,kind:'neuron'});
    }
  }

  root.addEventListener('click',onClick);
  root.addEventListener('change',onChange);
  root.addEventListener('keydown',onKeyDown);
  render();
  return { dispose() { if (disposed) return; disposed=true; cancelLoads(); disposeSession(); root.removeEventListener('click',onClick); root.removeEventListener('change',onChange); root.removeEventListener('keydown',onKeyDown); root.innerHTML=''; } };
}
