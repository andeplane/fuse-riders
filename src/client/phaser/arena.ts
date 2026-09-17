import { powerCountText, POWER_COLOR, POWER_ICON_SIZE, POWER_ICON_GAP } from '../power-indicator.js';
import { assetUrl } from '../asset-url.js';
import { GRAVITY_FIELD_TICKS, PICKUP_TYPES } from '../../shared/game.js';
import Phaser from 'phaser';
import type { ViewSnapshot } from '../snapshot-stream.js';
import { themes, type ThemeDefinition } from '../themes.js';
import { AVATARS, AVATAR_ATLAS_URL } from '../../shared/avatars.js';
import { bombPreviewDistance } from '../bomb-preview.js';
import { bombsPerShot, volleyAngles } from '../../shared/launch-modifiers.js';
import { drawInkClouds } from '../ink-renderer.js';
import { portalPalettes } from '../portal-palettes.js';
import { EffectTransitions, bombPose } from './effects.js';
import { TrailHistoryCache, trailTip, type TrailPoint } from './trails.js';
import { arenaWall, trailStuds } from '../arena-wall.js';
import { mapGround, obstacleParts } from '../arena-maps.js';
import { crossViews, edgeGhosts } from '../arena-views.js';
import { edgesOpen } from '../../shared/arena-map.js';
import { wrapCoordinate } from '../../shared/wrap.js';
import { observeArenaDisplay } from './viewport.js';
import { blastFrame } from '../blast-animation.js';
import { reloadRemaining, RELOAD_RING_RADIUS } from '../reload-ring.js';
import { TrailDebris } from '../trail-debris.js';

const pickups = PICKUP_TYPES;
const color = (value: string): number => /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : 0xffffff;
const clamp = Phaser.Math.Clamp;
const NO_GHOSTS = [{ dx: 0, dy: 0 }] as const;
export interface ArenaOptions { renderer?: 'auto' | 'canvas'; quality?: 'high' | 'low'; resolution?: 'display' | 'world'; onStatus?: (status: 'ready' | 'context-lost' | 'restored') => void }
export interface ArenaMetrics { renderer: string; objects: number; particles: number; renderMs: number; automaticLoopRunning: boolean; trailHistoryBuilds: number }
export interface PhaserArena {
  ready: Promise<void>;
  render(snapshot: ViewSnapshot, now: number, theme: ThemeDefinition, matchId: string, selfId?: string): void;
  resize(width: number, height: number): void;
  reset(): void;
  destroy(): void;
  metrics(): ArenaMetrics;
}

/**
 * A navigation can abort the embedded default images Phaser decodes at boot. Its texture manager still emits READY,
 * and the WebGL renderer then reads `__DEFAULT` and throws (#127). Take over the two READY listeners Phaser 3.90
 * registers (renderer boot, then game start) and run them, in that order, only when the default textures exist.
 * A Phaser whose boot does not match is left untouched.
 */
function guardDefaultTextures(game: Phaser.Game, failed: () => void): void {
  const textures = game.textures; const READY = Phaser.Textures.Events.READY;
  const renderer = game.renderer as unknown as { boot?: () => void } | null; const internal = game as unknown as { texturesReady?: () => void };
  const listeners = textures.listeners(READY);
  if (listeners.length !== 2 || !renderer || listeners[0] !== renderer.boot || listeners[1] !== internal.texturesReady) return;
  textures.off(READY);
  textures.once(READY, () => {
    if (!['__DEFAULT', '__MISSING', '__WHITE'].every(key => textures.exists(key))) {
      // This game never starts, and game.destroy() only completes on a step it will never take: release the window
      // resize/orientation listeners its ScaleManager added at boot so the game and its GL context can be collected.
      game.scale.stopListeners(); failed(); return;
    }
    renderer.boot!.call(renderer); internal.texturesReady!.call(game);
  });
}

/** One external presentation clock; Phaser physics and input are deliberately disabled. */
export function createPhaserArena(canvas: HTMLCanvasElement, options: ArenaOptions = {}): PhaserArena {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let destroyed = false; let booted = false; let lost = false; let lastNow = 0; let renderMs = 0;
  canvas.style.width = '100%'; canvas.style.height = '100%';
  const display = observeArenaDisplay(canvas);
  const scene = new ArenaScene(options.quality === 'low' ? 160 : 480, () => { if (destroyed) return; game.loop.stop(); booted = true; options.onStatus?.('ready'); resolveReady(); });
  const context = options.renderer === 'canvas' ? null : canvas.getContext('webgl', { alpha: false, antialias: true });
  const game = new Phaser.Game({
    type: context ? Phaser.WEBGL : Phaser.CANVAS, canvas, width: canvas.width, height: canvas.height,
    backgroundColor: '#020715', banner: false, audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: { antialias: true, antialiasGL: true, pixelArt: false, roundPixels: false, powerPreference: 'high-performance' },
    fps: { target: 60, smoothStep: false }, scene,
  });
  guardDefaultTextures(game, () => { if (!destroyed) rejectReady(new Error('Default textures did not load')); });
  const onLost = (event: Event) => { event.preventDefault(); lost = true; scene.resetEffects(); options.onStatus?.('context-lost'); };
  const onRestored = () => { lost = false; scene.invalidate(); scene.resetEffects(); options.onStatus?.('restored'); };
  const onLeaving=()=>scene.cancelPreload();
  window.addEventListener('beforeunload',onLeaving);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  const resize = (width: number, height: number, crossed = false) => {
    if (destroyed || !booted) return;
    const backing = options.resolution === 'world' ? { width, height } : display.backing(width, height);
    if (game.scale.width !== backing.width || game.scale.height !== backing.height) game.scale.resize(backing.width, backing.height);
    // CSS layout remains independent of the physical canvas; all drawing stays in world units.
    canvas.style.width = '100%'; canvas.style.height = '100%';
    // The crossed map is the same world seen through four cameras, each showing one quarter in the opposite corner
    // of the screen. Nothing that is drawn knows: every object is clipped at a seam and picked up past it for free.
    const views = crossed ? crossViews(width, height, backing.width, backing.height)
      : [{ x: 0, y: 0, width: backing.width, height: backing.height, scrollX: 0, scrollY: 0 }];
    const cameras = scene.cameras;
    while (cameras.cameras.length > views.length) cameras.remove(cameras.cameras[cameras.cameras.length - 1]!);
    while (cameras.cameras.length < views.length) cameras.add(0, 0, 1, 1);
    for (const [index, view] of views.entries()) {
      cameras.cameras[index]!.setViewport(view.x, view.y, view.width, view.height).setOrigin(0, 0).setScroll(view.scrollX, view.scrollY).setZoom(backing.width / width, backing.height / height);
    }
  };
  return {
    ready,
    render(snapshot, now, theme, matchId, selfId) {
      if (!booted || destroyed || lost || document.hidden) return;
      const start = performance.now();
      resize(snapshot.width, snapshot.height, snapshot.map === 'cross');
      scene.paint(snapshot, now, theme, matchId, selfId);
      game.step(now, lastNow ? Math.min(50, Math.max(0, now - lastNow)) : 16.667);
      lastNow = now; renderMs = performance.now() - start;
    },
    resize,
    reset() { scene.resetEffects(); lastNow = 0; },
    destroy() {
      if (destroyed) return; destroyed = true;
      display.destroy();
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      window.removeEventListener('beforeunload',onLeaving);
      scene.cancelPreload();
      if (!booted) rejectReady(new Error('Renderer disposed before loading'));
      game.destroy(false); // caller owns the DOM node
      if (game.scene.isBooted) game.step(0, 0); // SceneManager needs its system scene; otherwise the first normal frame flushes destruction.
    },
    metrics: () => ({ renderer: game.renderer?.type === Phaser.WEBGL ? 'webgl' : 'canvas', objects: scene.objectCount(), particles: scene.particleCount(), renderMs, automaticLoopRunning: game.loop.running, trailHistoryBuilds: scene.trailHistoryBuilds }),
  };
}

class ArenaScene extends Phaser.Scene {
  private floor!: Phaser.GameObjects.Graphics;
  private floorTexture!: Phaser.Textures.CanvasTexture;
  private floorImage!: Phaser.GameObjects.Image;
  private trails!: Phaser.GameObjects.Graphics;
  private trailTips!: Phaser.GameObjects.Graphics;
  private dynamic!: Phaser.GameObjects.Graphics;
  private front!: Phaser.GameObjects.Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private world!: Phaser.GameObjects.Layer;
  private maskShape!: Phaser.GameObjects.Graphics;
  private ink!: Phaser.Textures.CanvasTexture;
  private inkImage!: Phaser.GameObjects.Image;
  private images: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private imageIndex = 0; private labelIndex = 0;
  private trailHistory = new TrailHistoryCache();
  trailHistoryBuilds = 0;
  private floorKey = ''; private backgroundKey = '';
  private transitions = new EffectTransitions();
  private debris: TrailDebris;
  constructor(private readonly particleLimit: number, private readonly loaded: () => void) {
    super('arena'); this.debris = new TrailDebris(Math.floor(particleLimit / 2));
  }
  /** Phaser reset clears its sets, but does not detach pending XHR callbacks. */
  cancelPreload(): void {
    const loader=this.load;
    if(!loader?.inflight)return;
    loader.inflight.iterate((file:Phaser.Loader.File)=>{
      file.resetXHR();
      if(file.xhrLoader){file.xhrLoader.ontimeout=null;file.xhrLoader.abort();}
      return true;
    });
    loader.reset();
  }
  preload(): void {
    this.load.image('avatars', assetUrl(AVATAR_ATLAS_URL));
    for (const theme of Object.values(themes)) {
      this.load.svg(`${theme.id}:rider`, assetUrl(theme.sprites.rider), { width: 64, height: 64 });
      this.load.svg(`${theme.id}:bomb`, assetUrl(theme.sprites.bomb), { width: 128, height: 128 });
      for (const type of pickups) this.load.svg(`${theme.id}:${type}`, assetUrl(`/themes/${theme.id}/pickup-${type}.svg`), { width: 128, height: 128 });
    }
  }
  create(): void {
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff).fillRect(0,0,4,4).generateTexture('spark',4,4); g.clear();
    g.fillStyle(0x49e062).fillCircle(20,20,15).lineStyle(3,0xe0ffcc).strokeCircle(20,20,15).lineStyle(2,0x14762f).strokeCircle(20,20,8);
    g.generateTexture('shell',40,40); g.destroy();
    if (this.textures.exists('avatars')) {
      const texture = this.textures.get('avatars'); const source = texture.getSourceImage();
      AVATARS.forEach((avatar,index) => texture.add(avatar.id,0,(index%5)*source.width/5,Math.floor(index/5)*source.height/2,source.width/5,source.height/2));
    }
    this.floorTexture = this.textures.createCanvas('arena-floor', 1, 1)!;
    this.floorImage = this.add.image(0, 0, 'arena-floor').setOrigin(0).setDepth(-1);
    this.floor = this.add.graphics().setDepth(0);
    this.trails = this.add.graphics().setDepth(1);
    this.trailTips = this.add.graphics().setDepth(1);
    this.dynamic = this.add.graphics().setDepth(2);
    this.front = this.add.graphics().setDepth(5);
    this.maskShape = this.make.graphics({ x: 0, y: 0 });
    const mask = this.maskShape.createGeometryMask();
    this.world = this.add.layer([this.trails,this.trailTips,this.dynamic,this.front]).setDepth(1).setMask(mask);
    this.sparks = this.add.particles(0,0,'spark', { emitting: false, lifespan: { min: 180, max: 650 }, speed: { min: 100, max: 420 }, scale: { start: 1.7, end: 0 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 90 }, blendMode: 'ADD', maxParticles: this.particleLimit + 1, maxAliveParticles: this.particleLimit }).setDepth(4);
    this.world.add(this.sparks);
    // Phaser atLimit counts dead + alive; reserve below maxParticles while maxAlive is the hard rendering cap.
    this.sparks.reserve(this.particleLimit);
    this.ink = this.textures.createCanvas('ink-overlay',1600,900)!;
    this.inkImage = this.add.image(0,0,'ink-overlay').setOrigin(0).setDepth(6).setVisible(false);
    this.world.add(this.inkImage);
    this.loaded();
  }
  resetEffects(): void { this.transitions.reset(); this.sparks?.killAll(); this.trailHistory.reset(); this.debris.reset(); }
  invalidate(): void { this.trailHistory.reset(); this.floorKey = ''; this.backgroundKey = ''; }
  objectCount(): number { return (this.children?.length ?? 0) + (this.world?.length ?? 0); }
  particleCount(): number { return this.sparks?.getAliveParticleCount() ?? 0; }
  /**
   * Both glow passes are shared; the bright core is the theme's signature. A pixel theme dots it as
   * 2x2 studs and squares the ends, a smooth theme keeps the hairline and the rounded caps.
   */
  private strokeTrail(graphics: Phaser.GameObjects.Graphics, paths: readonly (readonly TrailPoint[])[], tint: number, alive: boolean, theme: ThemeDefinition): void {
    const pixel = theme.rendering.pixelated;
    const glow = theme.rendering.trailGlow;
    const passes = [[4 * glow, .25, tint], [5, 1, tint], [1, .95, 0xffffff]] as const;
    for (const [index, [width, alpha, shade]] of passes.entries()) {
      const core = index === passes.length - 1;
      // Detached trails are quieter visually but remain collidable until eroded.
      graphics.lineStyle(width, shade, alpha * (alive ? 1 : .6)).fillStyle(shade, alpha * (alive ? 1 : .6));
      for (const path of paths) {
        if (path.length < 2) continue;
        if (core && pixel) {
          for (const stud of trailStuds(path)) graphics.fillRect(stud.x - 1, stud.y - 1, 2, 2);
          continue;
        }
        graphics.beginPath().moveTo(path[0]!.x, path[0]!.y);
        for (let i = 1; i < path.length; i++) graphics.lineTo(path[i]!.x, path[i]!.y);
        graphics.strokePath();
        // Ends also cover the seam between cached history and the moving tip; square for pixel themes.
        for (const point of [path[0]!, path[path.length - 1]!]) {
          if (pixel) graphics.fillRect(point.x - width / 2, point.y - width / 2, width, width);
          else graphics.fillCircle(point.x, point.y, width / 2);
        }
      }
    }
  }

  /** Paints whatever `arenaWall()` chose for this theme; the choice itself lives there, once, for both renderers. */
  private drawWall(w: number, h: number, b: number, theme: ThemeDefinition): void {
    const rim = color(theme.palette.rim);
    // Graphics has no shadowBlur: a wide translucent stroke under a tight one stands in for the glow.
    this.floor.lineStyle(14, rim, .12).strokeRect(b, b, w - 2 * b, h - 2 * b);
    this.floor.lineStyle(4, rim, .9).strokeRect(b, b, w - 2 * b, h - 2 * b);
    const wall = arenaWall(w, h, b, theme);
    if (wall.kind === 'smooth') {
      this.floor.lineStyle(wall.strokeWidth, color(theme.palette.wall), .9).strokeRect(wall.rect.x, wall.rect.y, wall.rect.width, wall.rect.height);
      return;
    }
    const face = color(theme.palette.wall);
    for (const brick of wall.bricks) {
      this.floor.fillStyle(0x211862).fillRect(brick.x, brick.y, brick.width, brick.height);
      this.floor.fillStyle(face, .92).fillRect(brick.x + 2, brick.y + 2, brick.width - 4, brick.height - 4);
      this.floor.fillStyle(0xb696ff, .65).fillRect(brick.x + 3, brick.y + 3, brick.width - 6, 2);
      this.floor.fillStyle(0x19114e, .65).fillRect(brick.x + 3, brick.y + brick.height - 5, brick.width - 6, 3);
      this.floor.fillStyle(0x241664, .45).fillRect(brick.chip.x, brick.chip.y, brick.chip.width, brick.chip.height);
    }
    this.floor.lineStyle(4, rim, .95);
    for (const [ax, ay, bx, by, cx, cy] of wall.brackets) {
      this.floor.beginPath(); this.floor.moveTo(ax, ay); this.floor.lineTo(bx, by); this.floor.lineTo(cx, cy); this.floor.strokePath();
    }
    for (const stud of wall.studs) {
      this.floor.fillStyle(color(theme.palette.blast)).fillRect(stud.x, stud.y, wall.studSize, wall.studSize);
      this.floor.fillStyle(color(theme.palette.blastCore)).fillRect(stud.x + 2, stud.y + 2, 3, 3);
    }
  }
  /** Scenery is static until a blast clears it, so it is baked into the floor pass rather than redrawn each frame. */
  private drawObstacles(obstacles: ViewSnapshot['obstacles']): void {
    for (const obstacle of obstacles) for (const part of obstacleParts(obstacle)) {
      this.floor.fillStyle(color(part.color), part.alpha ?? 1);
      if (part.shape === 'ellipse') this.floor.fillEllipse(part.x, part.y, part.radiusX * 2, part.radiusY * 2);
      else this.floor.fillRect(part.x, part.y, part.width, part.height);
    }
  }
  private sprite(texture: string, x: number, y: number, size: number, rotation = 0, frame?: string): Phaser.GameObjects.Image {
    let image = this.images[this.imageIndex++];
    if (!image) { image = this.add.image(0,0,'spark').setDepth(3); this.images.push(image); this.world.add(image); }
    const fallback=texture.replace(/^clean-neon:/,'neon-pixel:');
    const key = this.textures.exists(texture) ? texture : this.textures.exists(fallback) ? fallback : 'spark';
    return image.setDepth(3).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(true).setTexture(key, frame).setPosition(x,y).setDisplaySize(size,size).setRotation(rotation).setAlpha(1).clearTint();
  }
  private label(text: string, x: number, y: number, tint: string, size = 11, depth = 5): Phaser.GameObjects.Text {
    let label = this.labels[this.labelIndex++];
    if (!label) { label = this.add.text(0,0,'',{ fontFamily: 'monospace', fontSize: size, fontStyle: 'bold', stroke: '#020715', strokeThickness: 3 }).setOrigin(.5).setDepth(7); this.labels.push(label); this.world.add(label); }
    if (label.text !== text) label.setText(text);
    const resolution = Math.max(1, Math.ceil(Math.max(this.cameras.main.zoomX, this.cameras.main.zoomY)));
    if (label.style.resolution !== resolution) label.setResolution(resolution);
    label.setDepth(depth).setVisible(true).setPosition(x,y);
    if(label.style.color!==tint)label.setColor(tint);
    if(label.style.fontSize!==`${size}px`)label.setFontSize(size);
    return label;
  }
  paint(s: ViewSnapshot, now: number, theme: ThemeDefinition, matchId: string, selfId?: string): void {
    this.imageIndex = 0; this.labelIndex = 0;
    const g = this.dynamic.clear(); const f = this.front.clear();
    const { width:w, height:h, boundaryInset:b } = s;
    const ground = mapGround(s.map, theme);
    const open = edgesOpen(s);
    const ghosts = (x: number, y: number, reach: number) => open ? edgeGhosts(w, h, x, y, reach) : NO_GHOSTS;
    const backgroundKey = `${w}:${h}:${theme.id}:${s.map}`;
    if (backgroundKey !== this.backgroundKey) {
      this.backgroundKey = backgroundKey;
      // The pre-Phaser floor: a soft radial wash and a grid anchored to the arena,
      // so the background stays still as the boundary closes in.
      this.floorTexture.setSize(w, h);
      const ctx = this.floorTexture.context;
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, w * .7);
      gradient.addColorStop(0, ground.floorCenter);
      gradient.addColorStop(1, ground.floorEdge);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
      this.floorTexture.refresh();
      // Upload resets filtering; preserve smooth backdrop scaling.
      this.floorTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.floorImage.setDisplaySize(w, h);
    }
    // Obstacles are only ever removed within a round, so their count identifies the standing set.
    const floorKey = `${backgroundKey}:${b}:${matchId}:${s.round}:${s.obstacles.length}`;
    if (floorKey !== this.floorKey) {
      this.floorKey = floorKey;
      // Boundary motion must not redraw/upload the full background texture each tick.
      this.floor.clear();
      // Draw grid lines as geometry: baking them into a texture loses lines on small boards.
      const grid = Phaser.Display.Color.RGBStringToColor(ground.grid.replace(/,\s*\./, ',0.'));
      this.floor.lineStyle(1,grid.color,grid.alphaGL);
      for(let x=0;x<=w;x+=ground.gridSize)this.floor.lineBetween(x,0,x,h);
      for(let y=0;y<=h;y+=ground.gridSize)this.floor.lineBetween(0,y,w,y);
      if(edgesOpen(s)) {
        // No wall to draw. A dashed rim marks where the board repeats, in place of one that would say "stop".
        this.floor.lineStyle(2,color(theme.palette.rim),.35);
        for(let x=0;x<w;x+=28){this.floor.lineBetween(x,1,x+14,1);this.floor.lineBetween(x,h-1,x+14,h-1);}
        for(let y=0;y<h;y+=28){this.floor.lineBetween(1,y,1,y+14);this.floor.lineBetween(w-1,y,w-1,y+14);}
      } else {
        this.floor.fillStyle(0x00020c,.67)
          .fillRect(0,0,w,b).fillRect(0,h-b,w,b)
          .fillRect(0,b,b,h-2*b).fillRect(w-b,b,b,h-2*b);
        this.drawWall(w,h,b,theme);
      }
      // After the boundary band: an obstacle the closing walls have reached is already gone from the state.
      this.drawObstacles(s.obstacles);
      this.maskShape.clear().fillStyle(0xffffff).fillRect(b,b,w-2*b,h-2*b);
    }
    const history = this.trailHistory.update(s.players, `${matchId}:${s.round}:${theme.id}`);
    if (history.changed) {
      this.trailHistoryBuilds++;
      this.trails.clear();
      for (const stroke of history.strokes) this.strokeTrail(this.trails, stroke.paths, color(stroke.color), stroke.alive, theme);
    }
    this.trailTips.clear();
    for (const player of s.players) this.strokeTrail(this.trailTips, [trailTip(player, s.tick, s.phase)], color(player.color), player.alive && !player.trail.at(-1)?.detached, theme);
    const events = this.transitions.accept(s,matchId);
    for(const p of events.deaths) { this.sparks.setParticleTint(color(p.color)); this.sparks.explode(12,p.x,p.y); }
    for(const piece of events.rubble) { this.sparks.setParticleTint(color(ground.dust)); this.sparks.explode(10,piece.x,piece.y); }
    for(const p of s.pickups) {
      const pulse=1+Math.sin(now/210+p.id)*.06;
      const power=p.type==='power';
      if(!power) g.lineStyle(2,0x65fff2,.5).strokeCircle(p.x,p.y,24*pulse).lineStyle(7,0x65fff2,.05).strokeCircle(p.x,p.y,26*pulse);
      this.sprite(`${theme.id}:${p.type}`,p.x,p.y,(power?24:34)*pulse).setAlpha(clamp((p.expiresAtTick-s.tick)/40,.15,1));
      if(!power) this.label(p.type==='stopwatch'?'FUSE':p.type==='extraBomb'?'+1 BOMB':p.type==='orbitShield'?'SHIELD':p.type.toUpperCase(),p.x,p.y+30,'#d3fff2',9);
    }
    const livePortals=s.portalPairs.filter(pair=>pair.expiresAtTick>s.tick);
    const portalTints=portalPalettes(livePortals.map(pair=>pair.id));
    for(const [pairIndex,pair] of livePortals.entries()) {
      const tints=portalTints[pairIndex]!.map(color) as [number,number];
      // The faint tether keeps the two ends of one pair readable when several pairs are open.
      g.lineStyle(2,tints[0],.18).lineBetween(pair.gates[0].x,pair.gates[0].y,pair.gates[1].x,pair.gates[1].y);
      for(const [index,gate] of pair.gates.entries()) {
        const tint=tints[index]!;
        g.lineStyle(22,tint,.12).lineBetween(gate.x,gate.y-gate.halfLength,gate.x,gate.y+gate.halfLength).lineStyle(8,tint,.9).lineBetween(gate.x,gate.y-gate.halfLength,gate.x,gate.y+gate.halfLength);
        for(let y=-gate.halfLength;y<gate.halfLength;y+=20) { const offset=(now/35)%20; g.fillStyle(0xffffff,.75).fillRect(gate.x-1,gate.y+y+offset,2,8); }
        for(let y=-gate.halfLength+20;y<gate.halfLength;y+=40) { g.lineStyle(2,tints[1-index]!).lineBetween(gate.x-8,gate.y+y-5,gate.x-14,gate.y+y).lineBetween(gate.x-14,gate.y+y,gate.x-8,gate.y+y+5).lineBetween(gate.x+8,gate.y+y-5,gate.x+14,gate.y+y).lineBetween(gate.x+14,gate.y+y,gate.x+8,gate.y+y+5); }
      }
    }
    for(const bomb of s.bombs) {
      if(bomb.shell?.gun) {
        const alpha=clamp((bomb.explodeAtTick-(s.presentationTick??s.tick))/Math.max(1,bomb.explodeAtTick-bomb.launchedTick),0,1);
        g.lineStyle(2,0xd8edff,.7*alpha).lineBetween(bomb.launchX,bomb.launchY,bomb.x,bomb.y);
        g.fillStyle(0xffffff,alpha).fillCircle(bomb.x,bomb.y,2);
        continue;
      }
      if(bomb.shell) { for(const {dx,dy} of ghosts(bomb.x,bomb.y,60)) { const x=bomb.x+dx,y=bomb.y+dy; this.sprite('shell',x,y,34,now/130);
        const a=Math.atan2(bomb.shell.vy,bomb.shell.vx); for(let i=1;i<5;i++) g.fillStyle(0x66ff72,.18/i).fillCircle(x-Math.cos(a)*i*12,y-Math.sin(a)*i*12,7); } continue; }
      const ownerTint=color(s.players.find(player=>player.id===bomb.ownerId)?.color??'#ffffff');
      // The fine outer edge stays at the exact supplied damage radius.
      for(const {dx,dy} of ghosts(bomb.x,bomb.y,bomb.blastRange)) {
        g.lineStyle(1.5,ownerTint,.32).strokeCircle(bomb.x+dx,bomb.y+dy,bomb.blastRange);
        g.lineStyle(4,ownerTint,.04).strokeCircle(bomb.x+dx,bomb.y+dy,Math.max(0,bomb.blastRange-3));
        g.fillStyle(ownerTint,.025).fillCircle(bomb.x+dx,bomb.y+dy,bomb.blastRange);
        if(s.tick<bomb.landsAtTick) g.lineStyle(2,ownerTint,.6).strokeEllipse(bomb.x+dx,bomb.y+dy,34,15);
      }
      // A lob over an open edge is one straight throw in the state; it is folded onto the board only to be drawn.
      const flown=bombPose(bomb,s.tick); const airborne=s.tick<bomb.landsAtTick;
      const pose=open?{...flown,x:wrapCoordinate(flown.x,w),y:wrapCoordinate(flown.y,h)}:flown;
      this.sprite(`${theme.id}:bomb`,pose.x,pose.y,44*(1+Math.sin(now/90)*.04));
      const remaining=clamp((bomb.explodeAtTick-s.tick)/Math.max(1,bomb.explodeAtTick-bomb.landsAtTick),0,1);
      const ringTint=ownerTint;
      const progress=airborne?pose.flight:remaining, end=-Math.PI/2+Math.PI*2*progress;
      g.lineStyle(2,ownerTint,.15).strokeCircle(pose.x,pose.y,26);
      if(progress>0) {
        g.lineStyle(7,ringTint,.1).beginPath().arc(pose.x,pose.y,26,-Math.PI/2,end,false).strokePath();
        g.lineStyle(2.5,ringTint).beginPath().arc(pose.x,pose.y,26,-Math.PI/2,end,false).strokePath();
        g.fillStyle(ringTint).fillCircle(pose.x,pose.y-26,1.25);
        g.fillStyle(0xfff2d5).fillCircle(pose.x+Math.cos(end)*26,pose.y+Math.sin(end)*26,2);
      }
    }
    for(const field of s.gravityFields) {
      const life=clamp((field.expiresAtTick-s.tick)/GRAVITY_FIELD_TICKS,0,1), swirl=now/900;
      g.fillStyle(0x784ed6,.16+life*.16).fillCircle(field.x,field.y,field.radius);
      g.lineStyle(2,0xc9a6ff,.45+life*.3);
      for(let arm=0;arm<3;arm++) { const start=swirl+arm*Math.PI*2/3; g.beginPath(); g.arc(field.x,field.y,field.radius*(.35+.2*arm),start,start+1.1,false); g.strokePath(); }
      g.fillStyle(0x0a0618,.95).fillCircle(field.x,field.y,field.radius*.16);
    }
    for(const blast of s.blasts) {
      const frame=blastFrame(blast,s.presentationTick??s.tick), {x,y,radius}=blast.circle;
      const tints={outer:color(theme.palette.blast),warm:0xffb52e,core:color(theme.palette.blastCore)};
      g.fillStyle(tints.outer,frame.footprintAlpha).fillCircle(x,y,radius);
      g.lineStyle(1.5,tints.warm,frame.ring.alpha).strokeCircle(x,y,frame.ring.radius);
      for(const circle of frame.circles) g.fillStyle(tints[circle.tone],circle.alpha).fillCircle(circle.x,circle.y,circle.radius);
      for(const spark of frame.sparks) g.fillStyle(tints.warm,spark.alpha).fillRect(spark.x-spark.size/2,spark.y-spark.size/2,spark.size,spark.size);
    }
    for(const piece of this.debris.update(s,now,matchId)) {
      const tint=color(piece.color);
      g.lineStyle(piece.width+5,tint,piece.alpha*.16).lineBetween(piece.x1,piece.y1,piece.x2,piece.y2);
      g.lineStyle(piece.width,tint,piece.alpha).lineBetween(piece.x1,piece.y1,piece.x2,piece.y2);
      g.lineStyle(1,0xffffff,piece.alpha*.65).lineBetween(piece.x1,piece.y1,piece.x2,piece.y2);
    }
    // Near an open edge a rider is drawn on both sides of it, so it arrives as it leaves rather than popping across.
    for(const rider of s.players) for(const ghost of rider.alive?ghosts(rider.x,rider.y,40):[]) {
      const p=ghost.dx||ghost.dy?{...rider,x:rider.x+ghost.dx,y:rider.y+ghost.dy}:rider;
      const tint=color(p.color);
      // The portrait stays upright at the trail head; only its direction marker turns.
      g.fillStyle(0x080c22).fillCircle(p.x,p.y,15);
      f.lineStyle(1,tint).strokeCircle(p.x,p.y,15);
      this.sprite(this.textures.exists('avatars')?'avatars':`${theme.id}:rider`,p.x,p.y,32,0,this.textures.exists('avatars')?p.avatarId:undefined);
      const a=p.angle, dx=Math.cos(a), dy=Math.sin(a);
      f.fillStyle(tint).fillTriangle(p.x+dx*23,p.y+dy*23,p.x+dx*16+dy*5,p.y+dy*16-dx*5,p.x+dx*16-dy*5,p.y+dy*16+dx*5);
      const self=p.id===selfId, labelY=p.y-(self?30:27);
      if(self)f.lineStyle(2,tint,.55+Math.sin(now/180)*.25).strokeCircle(p.x,p.y,22+Math.sin(now/180)*2);
      const name=this.label(self?'YOU':p.name,p.x,labelY,self?'#ffffff':p.color,self?12:10);
      const power=this.label(powerCountText(p.powerPickups, p.extraBombs, p.grip),p.x,labelY,POWER_COLOR);
      const gap=8, left=p.x-(name.width+gap+POWER_ICON_SIZE+POWER_ICON_GAP+power.width)/2;
      name.setX(left+name.width/2);
      const iconX=left+name.width+gap+POWER_ICON_SIZE/2, iconY=labelY, radius=POWER_ICON_SIZE/2;
      f.fillStyle(color(POWER_COLOR)).lineStyle(2,0x020715).beginPath()
        .moveTo(iconX,iconY-radius).lineTo(iconX+radius,iconY).lineTo(iconX,iconY+radius).lineTo(iconX-radius,iconY)
        .closePath().fillPath().strokePath();
      power.setX(iconX+radius+POWER_ICON_GAP+power.width/2);
      const reload=reloadRemaining(p,s);
      if(reload>0) {
        const start=-Math.PI/2+(1-reload)*Math.PI*2;
        f.lineStyle(2,0x080c22,.95).strokeCircle(p.x,p.y,RELOAD_RING_RADIUS);
        f.lineStyle(2,tint,.2).strokeCircle(p.x,p.y,RELOAD_RING_RADIUS);
        f.lineStyle(2,tint).beginPath().arc(p.x,p.y,RELOAD_RING_RADIUS,start,Math.PI*1.5,false).strokePath();
      }
      if(p.shielded || p.shieldGraceUntilTick>s.tick) { f.lineStyle(2,0x8affff,.8).strokeCircle(p.x,p.y,29); const a=now/350; f.fillStyle(0xcaffff).fillRect(p.x+Math.cos(a)*29-4,p.y+Math.sin(a)*29-4,8,8); }
      if(p.portalGraceUntilTick>s.tick || p.invulnerableUntilTick>s.tick) f.lineStyle(3,0xffdbff,.6).strokeCircle(p.x,p.y,35+Math.sin(now/80)*2);
      if(p.drunkUntilTick>s.tick) { f.lineStyle(2,0xd799ff,.9).strokeEllipse(p.x,p.y-12,70,35); for(let i=0;i<4;i++){ const a=now/240+i*Math.PI/2; const sx=p.x+Math.cos(a)*36,sy=p.y-12+Math.sin(a)*20; f.fillStyle(i%2?0xffe790:0xffaa32).fillRect(sx-2,sy-8,4,16).fillRect(sx-8,sy-2,16,4); } this.label('DIZZY',p.x,p.y+37,'#fff078',9); }
      if(p.bombChargeStartedTick!==undefined && !p.targetBombArmed && !p.shellArmed && !p.gunArmed) {
        const distance=bombPreviewDistance((p.presentationTick??s.tick)-p.bombChargeStartedTick,s.bombChargeTicks,s.aimBounce);
        for(const a of volleyAngles(p.angle,bombsPerShot(p))) { const x=open?p.x+Math.cos(a)*distance:clamp(p.x+Math.cos(a)*distance,b+20,w-b-20),y=open?p.y+Math.sin(a)*distance:clamp(p.y+Math.sin(a)*distance,b+20,h-b-20); f.lineStyle(2,tint,.5).lineBetween(p.x,p.y,x,y).lineStyle(2,tint,.9).strokeRect(x-9,y-9,18,18); }
      }
      if(p.targetBombArmed && !p.shellArmed && !p.gunArmed && p.bombChargeStartedTick!==undefined && p.bombTarget) {
        const {x,y}=p.bombTarget; f.lineStyle(2,tint,.5).lineBetween(p.x,p.y,x,y).lineStyle(3,tint).strokeCircle(x,y,23).lineBetween(x-32,y,x-11,y).lineBetween(x+11,y,x+32,y).lineBetween(x,y-32,x,y-11).lineBetween(x,y+11,x,y+32);
        this.label(`TARGET · ${p.name}`,x,y+45,p.color,12,7);
      }
    }
    const inked=s.players.some(p=>p.alive&&p.inkUntilTick>s.tick);
    this.inkImage.setVisible(inked);
    if(inked) {
      if(this.ink.width!==w || this.ink.height!==h) this.ink.setSize(w,h);
      this.ink.context.clearRect(0,0,w,h); drawInkClouds(this.ink.context,s,s.tick); this.ink.refresh();
    }
    while(this.images.length>this.imageIndex+16) this.images.pop()!.destroy();
    while(this.labels.length>this.labelIndex+8) this.labels.pop()!.destroy();
    for(let i=this.imageIndex;i<this.images.length;i++) this.images[i]!.setVisible(false);
    for(let i=this.labelIndex;i<this.labels.length;i++) this.labels[i]!.setVisible(false);
    this.world.depthSort();
  }
}
