import { assetUrl } from '../asset-url.js';
import Phaser from 'phaser';
import type { ViewSnapshot } from '../snapshot-stream.js';
import { themes, type ThemeDefinition } from '../themes.js';
import { AVATARS, AVATAR_ATLAS_URL } from '../../shared/avatars.js';
import { bombLaunchDistance } from '../../shared/bomb-launch.js';
import { volleyAngles } from '../../shared/launch-modifiers.js';
import { drawInkClouds } from '../ink-renderer.js';
import { EffectTransitions, bombPose } from './effects.js';

const pickups = ['stopwatch','gun','shell','target','blast','star','beer','ink','triple','five','orbitShield','portal'] as const;
const color = (value: string): number => /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : 0xffffff;
const clamp = Phaser.Math.Clamp;
export interface ArenaOptions { renderer?: 'auto' | 'canvas'; quality?: 'high' | 'low'; onStatus?: (status: 'ready' | 'context-lost' | 'restored') => void }
export interface ArenaMetrics { renderer: string; objects: number; particles: number; renderMs: number; automaticLoopRunning: boolean }
export interface PhaserArena {
  ready: Promise<void>;
  render(snapshot: ViewSnapshot, now: number, theme: ThemeDefinition, matchId: string): void;
  resize(width: number, height: number): void;
  reset(): void;
  destroy(): void;
  metrics(): ArenaMetrics;
}

/** One external presentation clock; Phaser physics and input are deliberately disabled. */
export function createPhaserArena(canvas: HTMLCanvasElement, options: ArenaOptions = {}): PhaserArena {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let destroyed = false; let booted = false; let lost = false; let lastNow = 0; let renderMs = 0;
  const scene = new ArenaScene(options.quality === 'low' ? 160 : 480, () => { game.loop.stop(); booted = true; options.onStatus?.('ready'); resolveReady(); });
  const context = options.renderer === 'canvas' ? null : canvas.getContext('webgl', { alpha: false, antialias: false });
  const game = new Phaser.Game({
    type: context ? Phaser.WEBGL : Phaser.CANVAS, canvas, width: canvas.width, height: canvas.height,
    backgroundColor: '#020715', banner: false, audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: { antialias: false, pixelArt: true, roundPixels: false, powerPreference: 'high-performance' },
    fps: { target: 60, smoothStep: false }, scene,
  });
  const onLost = (event: Event) => { event.preventDefault(); lost = true; scene.resetEffects(); options.onStatus?.('context-lost'); };
  const onRestored = () => { lost = false; scene.invalidate(); scene.resetEffects(); options.onStatus?.('restored'); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return {
    ready,
    render(snapshot, now, theme, matchId) {
      if (!booted || destroyed || lost || document.hidden) return;
      const start = performance.now();
      if (game.scale.width !== snapshot.width || game.scale.height !== snapshot.height) game.scale.resize(snapshot.width, snapshot.height);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      scene.paint(snapshot, now, theme, matchId);
      game.step(now, lastNow ? Math.min(50, Math.max(0, now - lastNow)) : 16.667);
      lastNow = now; renderMs = performance.now() - start;
    },
    resize(width, height) { if (!destroyed && booted) game.scale.resize(width, height); },
    reset() { scene.resetEffects(); lastNow = 0; },
    destroy() {
      if (destroyed) return; destroyed = true;
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      if (!booted) rejectReady(new Error('Renderer disposed before loading'));
      game.destroy(false); // caller owns the DOM node
      if (game.isBooted) game.step(0, 0); // flush Phaser's deferred destruction without another RAF
    },
    metrics: () => ({ renderer: game.renderer?.type === Phaser.WEBGL ? 'webgl' : 'canvas', objects: scene.objectCount(), particles: scene.particleCount(), renderMs, automaticLoopRunning: game.loop.running }),
  };
}

class ArenaScene extends Phaser.Scene {
  private floor!: Phaser.GameObjects.Graphics;
  private trails!: Phaser.GameObjects.Graphics;
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
  private previousTrails: ViewSnapshot['players'][number]['trail'][] = [];
  private trailKey = ''; private floorKey = '';
  private transitions = new EffectTransitions();
  constructor(private readonly particleLimit: number, private readonly loaded: () => void) { super('arena'); }
  preload(): void {
    this.load.image('avatars', assetUrl(AVATAR_ATLAS_URL));
    for (const theme of Object.values(themes)) {
      this.load.svg(`${theme.id}:rider`, assetUrl(theme.sprites.rider), { width: 64, height: 64 });
      this.load.svg(`${theme.id}:bomb`, assetUrl(theme.sprites.bomb), { width: 64, height: 64 });
      for (const type of pickups) this.load.svg(`${theme.id}:${type}`, assetUrl(`/themes/${theme.id}/pickup-${type}.svg`), { width: 64, height: 64 });
    }
  }
  create(): void {
    const glow = this.textures.createCanvas('glow',64,64)!;
    const gradient=glow.context.createRadialGradient(32,32,1,32,32,32); gradient.addColorStop(0,'rgba(255,255,255,.8)'); gradient.addColorStop(.25,'rgba(255,255,255,.32)'); gradient.addColorStop(1,'rgba(255,255,255,0)'); glow.context.fillStyle=gradient;glow.context.fillRect(0,0,64,64);glow.refresh();
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff).fillRect(0,0,4,4).generateTexture('spark',4,4); g.clear();
    g.fillStyle(0x101d35).fillRoundedRect(2,5,42,30,12).lineStyle(3,0xd4fff8).strokeRoundedRect(2,5,42,30,12);
    g.fillStyle(0x8ca0ae).fillRect(0,5,8,30).fillStyle(0xffffff).fillRect(24,12,10,10).fillStyle(0x081020).fillRect(30,13,4,8);
    g.generateTexture('gun',48,40); g.clear();
    g.fillStyle(0x49e062).fillCircle(20,20,15).lineStyle(3,0xe0ffcc).strokeCircle(20,20,15).lineStyle(2,0x14762f).strokeCircle(20,20,8);
    g.generateTexture('shell',40,40); g.clear().fillStyle(0xffffff).beginPath();
    for(let i=0;i<64;i++){const a=i*Math.PI/32,r=120*(.88+.06*Math.sin(i*2.37)+.06*Math.cos(i*7.2)),x=Math.round((128+Math.cos(a)*r)/4)*4,y=Math.round((128+Math.sin(a)*r)/4)*4;if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}
    g.closePath().fillPath().generateTexture('burst',256,256);g.clear().fillStyle(0xffffff).fillCircle(128,128,120).generateTexture('disc',256,256);g.destroy();
    if (this.textures.exists('avatars')) {
      const texture = this.textures.get('avatars'); const source = texture.getSourceImage();
      AVATARS.forEach((avatar,index) => texture.add(avatar.id,0,(index%5)*source.width/5,Math.floor(index/5)*source.height/2,source.width/5,source.height/2));
    }
    this.floor = this.add.graphics().setDepth(0);
    this.trails = this.add.graphics().setDepth(1);
    this.dynamic = this.add.graphics().setDepth(2);
    this.front = this.add.graphics().setDepth(5);
    this.maskShape = this.make.graphics({ x: 0, y: 0 });
    const mask = this.maskShape.createGeometryMask();
    this.world = this.add.layer([this.trails,this.dynamic,this.front]).setDepth(1).setMask(mask);
    this.sparks = this.add.particles(0,0,'spark', { emitting: false, lifespan: { min: 180, max: 650 }, speed: { min: 100, max: 420 }, scale: { start: 1.7, end: 0 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 90 }, blendMode: 'ADD', maxParticles: this.particleLimit + 1, maxAliveParticles: this.particleLimit }).setDepth(4);
    this.world.add(this.sparks);
    // Phaser atLimit counts dead + alive; reserve below maxParticles while maxAlive is the hard rendering cap.
    this.sparks.reserve(this.particleLimit);
    this.ink = this.textures.createCanvas('ink-overlay',1600,900)!;
    this.inkImage = this.add.image(0,0,'ink-overlay').setOrigin(0).setDepth(6).setVisible(false);
    this.world.add(this.inkImage);
    this.loaded();
  }
  resetEffects(): void { this.transitions.reset(); this.sparks?.killAll(); }
  invalidate(): void { this.trailKey = ''; this.floorKey = ''; }
  objectCount(): number { return (this.children?.length ?? 0) + (this.world?.length ?? 0); }
  particleCount(): number { return this.sparks?.getAliveParticleCount() ?? 0; }
  private sprite(texture: string, x: number, y: number, size: number, rotation = 0, frame?: string): Phaser.GameObjects.Image {
    let image = this.images[this.imageIndex++];
    if (!image) { image = this.add.image(0,0,'spark').setDepth(3); this.images.push(image); this.world.add(image); }
    const fallback=texture.replace(/^clean-neon:/,'neon-pixel:');
    const key = this.textures.exists(texture) ? texture : this.textures.exists(fallback) ? fallback : 'spark';
    return image.setDepth(3).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(true).setTexture(key, frame).setPosition(x,y).setDisplaySize(size,size).setRotation(rotation).setAlpha(1).clearTint();
  }
  private label(text: string, x: number, y: number, tint: string, size = 11, depth = 5): void {
    let label = this.labels[this.labelIndex++];
    if (!label) { label = this.add.text(0,0,'',{ fontFamily: 'monospace', fontSize: size, fontStyle: 'bold', stroke: '#020715', strokeThickness: 3 }).setOrigin(.5).setDepth(7); this.labels.push(label); this.world.add(label); }
    if (label.text !== text) label.setText(text);
    label.setDepth(depth).setVisible(true).setPosition(x,y);
    if(label.style.color!==tint)label.setColor(tint);
    if(label.style.fontSize!==`${size}px`)label.setFontSize(size);
  }
  paint(s: ViewSnapshot, now: number, theme: ThemeDefinition, matchId: string): void {
    this.imageIndex = 0; this.labelIndex = 0;
    const g = this.dynamic.clear(); const f = this.front.clear();
    const { width:w, height:h, boundaryInset:b } = s;
    const floorKey = `${w}:${h}:${b}:${theme.id}`;
    if (floorKey !== this.floorKey) {
      this.floorKey = floorKey; this.floor.clear().fillStyle(color(theme.palette.floorEdge)).fillRect(0,0,w,h).fillStyle(color(theme.palette.floorCenter)).fillRect(b,b,w-2*b,h-2*b);
      this.floor.lineStyle(1,0x2574a5,.16);
      for(let x=b;x<w-b;x+=theme.rendering.gridSize) this.floor.lineBetween(x,b,x,h-b);
      for(let y=b;y<h-b;y+=theme.rendering.gridSize) this.floor.lineBetween(b,y,w-b,y);
      this.floor.lineStyle(16,color(theme.palette.rim),.12).strokeRect(b,b,w-2*b,h-2*b).lineStyle(3,color(theme.palette.rim),.9).strokeRect(b,b,w-2*b,h-2*b);
      if(theme.rendering.pixelated) {
        for(let x=b;x<w-b;x+=32) for(const y of [b,h-b]) this.brick(x,y,28,12,color(theme.palette.wall));
        for(let y=b+16;y<h-b;y+=32) for(const x of [b,w-b]) this.brick(x,y,12,28,color(theme.palette.wall));
      }
      this.maskShape.clear().fillStyle(0xffffff).fillRect(b,b,w-2*b,h-2*b);
    }
    // Trail geometry updates with simulation changes; interpolation changes only heads.
    const trailKey = `${theme.id}:${s.tick}:${s.round}:${matchId}:${s.players.map(p=>`${p.id}:${p.alive}:${p.trail.length}:${p.trail[0]?.createdTick}:${p.trail.at(-1)?.x2}`).join('|')}`;
    if (trailKey !== this.trailKey || s.players.some((p,index)=>p.trail!==this.previousTrails[index])) {
      this.previousTrails=s.players.map(p=>p.trail);
      this.trailKey = trailKey; this.trails.clear();
      for(const p of s.players) for(const [width,alpha,tint] of [[15,.13,color(p.color)],[8,.75,color(p.color)],[2,.95,0xffffff]] as const) {
        this.trails.lineStyle(width, tint, alpha*(p.alive?1:.3));
        this.trails.beginPath();
        for(const t of p.trail) { this.trails.moveTo(t.x1,t.y1); this.trails.lineTo(t.x2,t.y2); }
        this.trails.strokePath();
      }
      if(theme.rendering.pixelated) for(const p of s.players) {
        for(let i=0;i<p.trail.length;i+=7) { const t=p.trail[i]!; this.trails.fillStyle(color(p.color),p.alive?.8:.2).fillRect(t.x2-3,t.y2-3,6,6);this.trails.fillStyle(0xffffff,p.alive?.7:.1).fillRect(t.x2-1,t.y2-2,2,2); }
      }
    }
    const events = this.transitions.accept(s,matchId);
    for(const blast of events.explosions) { this.sparks.setParticleTint([0xffffff,0xffed8d,0xff9a22,0xff397e]); for(let ray=0;ray<8;ray++){const a=ray*Math.PI/4;this.sparks.explode(Math.min(10,Math.ceil(blast.circle.radius/16)),blast.circle.x+Math.cos(a)*blast.circle.radius*.72,blast.circle.y+Math.sin(a)*blast.circle.radius*.72);} }
    for(const p of events.deaths) { this.sparks.setParticleTint(color(p.color)); this.sparks.explode(45,p.x,p.y); }
    for(const p of s.pickups) {
      const pulse=1+Math.sin(now/210+p.id)*.06;
      g.lineStyle(2,0x65fff2,.5).strokeCircle(p.x,p.y,24*pulse).lineStyle(7,0x65fff2,.05).strokeCircle(p.x,p.y,26*pulse);
      this.sprite(`${theme.id}:${p.type}`,p.x,p.y,34*pulse).setAlpha(clamp((p.expiresAtTick-s.tick)/40,.15,1));
      this.label(p.type==='orbitShield'?'SHIELD':p.type.toUpperCase(),p.x,p.y+30,'#d3fff2',9);
    }
    if(s.portalPair && s.portalPair.expiresAtTick>s.tick) for(const [index,gate] of s.portalPair.gates.entries()) {
      const tint=index?0xff9b32:0xb968ff;
      g.lineStyle(22,tint,.12).lineBetween(gate.x,gate.y-gate.halfLength,gate.x,gate.y+gate.halfLength).lineStyle(8,tint,.9).lineBetween(gate.x,gate.y-gate.halfLength,gate.x,gate.y+gate.halfLength);
      for(let y=-gate.halfLength;y<gate.halfLength;y+=20) { const offset=(now/35)%20; g.fillStyle(0xffffff,.75).fillRect(gate.x-1,gate.y+y+offset,2,8); }
      for(let y=-gate.halfLength+20;y<gate.halfLength;y+=40) { g.lineStyle(2,tint).lineBetween(gate.x-8,gate.y+y-5,gate.x-14,gate.y+y).lineBetween(gate.x-14,gate.y+y,gate.x-8,gate.y+y+5).lineBetween(gate.x+8,gate.y+y-5,gate.x+14,gate.y+y).lineBetween(gate.x+14,gate.y+y,gate.x+8,gate.y+y+5); }
    }
    for(const bomb of s.bombs) {
      if(bomb.shell) { const gun=!!bomb.shell.gun; this.sprite(gun?'gun':'shell',bomb.x,bomb.y,gun?48:34,gun?Math.atan2(bomb.shell.vy,bomb.shell.vx):now/130);
        const a=Math.atan2(bomb.shell.vy,bomb.shell.vx); for(let i=1;i<5;i++) g.fillStyle(gun?0xd8edff:0x66ff72,.18/i).fillCircle(bomb.x-Math.cos(a)*i*12,bomb.y-Math.sin(a)*i*12,gun?10:7); continue; }
      g.lineStyle(1.5,0xc9d8ed,.27).strokeCircle(bomb.x,bomb.y,bomb.blastRange);
      g.fillStyle(0xff557f,.025).fillCircle(bomb.x,bomb.y,bomb.blastRange);
      const pose=bombPose(bomb,s.tick); const airborne=s.tick<bomb.landsAtTick;
      this.sprite(`${theme.id}:bomb`,pose.x,pose.y,44*(1+Math.sin(now/90)*.04));
      const remaining=clamp((bomb.explodeAtTick-s.tick)/Math.max(1,bomb.explodeAtTick-bomb.landsAtTick),0,1);
      g.lineStyle(4,airborne?0xd67cff:remaining<.3?0xfff06a:0xff2d7d).beginPath().arc(pose.x,pose.y,24,-Math.PI/2,-Math.PI/2+Math.PI*2*(airborne?pose.flight:remaining),false).strokePath();
      g.fillStyle(0xffefb0).fillRect(pose.x+10,pose.y-28,4,4);
      if(airborne) g.lineStyle(2,0xff73c5,.6).strokeEllipse(bomb.x,bomb.y,34,15);
    }
    for(const blast of s.blasts) {
      const age=clamp(1-(blast.expiresAtTick-s.tick)/8,0,1), {x,y,radius:r}=blast.circle;
      this.sprite('glow',x,y,r*2).setTint(color(theme.palette.blast)).setAlpha(.9*(1-age)).setBlendMode(Phaser.BlendModes.ADD).setDepth(2.5);
      g.fillStyle(color(theme.palette.blast),.22*(1-age)).fillCircle(x,y,r);
      for(const [scale,tint,opacity] of [[1,0xff5a14,.78],[.78,0xffbd35,.9],[.42,0xfff5c1,1]] as const) {
        this.sprite(theme.rendering.pixelated?'burst':'disc',x,y,r*2*scale*(.9+age*.1)).setTint(tint).setAlpha(opacity*(1-age)).setDepth(2.6);
      }
      g.lineStyle(8*(1-age)+1,0xffd685,1-age*.8).strokeCircle(x,y,r).lineStyle(3,0xffffff,.9*(1-age)).strokeCircle(x,y,r*(.55+age*.45));
      g.fillStyle(0xfff8cf,.9*(1-age)).fillCircle(x,y,r*.27*(1-age));
    }
    for(const p of s.players) {
      const tint=color(p.color);
      this.sprite('glow',p.x,p.y,90).setTint(tint).setAlpha(p.alive?.75:.15).setBlendMode(Phaser.BlendModes.ADD).setDepth(2.5);
      f.lineStyle(12,tint,.12*(p.alive?1:.2)).strokeCircle(p.x,p.y,23).lineStyle(3,tint,p.alive?1:.25).strokeCircle(p.x,p.y,21);
      this.sprite(this.textures.exists('avatars')?'avatars':`${theme.id}:rider`,p.x,p.y,44,p.angle,this.textures.exists('avatars')?p.avatarId:undefined).setAlpha(p.alive?1:.22);
      const a=p.angle; f.fillStyle(tint,p.alive?1:.2).fillTriangle(p.x+Math.cos(a)*31,p.y+Math.sin(a)*31,p.x+Math.cos(a+.27)*22,p.y+Math.sin(a+.27)*22,p.x+Math.cos(a-.27)*22,p.y+Math.sin(a-.27)*22);
      if(!p.alive) continue;
      this.label(`P${p.slot+1}`,p.x,p.y-33,p.color);
      if(p.shielded || p.shieldGraceUntilTick>s.tick) { f.lineStyle(2,0x8affff,.8).strokeCircle(p.x,p.y,29); const a=now/350; f.fillStyle(0xcaffff).fillRect(p.x+Math.cos(a)*29-4,p.y+Math.sin(a)*29-4,8,8); }
      if(p.portalGraceUntilTick>s.tick || p.invulnerableUntilTick>s.tick) f.lineStyle(3,0xffdbff,.6).strokeCircle(p.x,p.y,35+Math.sin(now/80)*2);
      if(p.drunkUntilTick>s.tick) { f.lineStyle(2,0xd799ff,.9).strokeEllipse(p.x,p.y-12,70,35); for(let i=0;i<4;i++){ const a=now/240+i*Math.PI/2; const sx=p.x+Math.cos(a)*36,sy=p.y-12+Math.sin(a)*20; f.fillStyle(i%2?0xffe790:0xffaa32).fillRect(sx-2,sy-8,4,16).fillRect(sx-8,sy-2,16,4); } this.label('DIZZY',p.x,p.y+37,'#fff078',9); }
      if(p.bombChargeStartedTick!==undefined && !p.targetBombArmed && !p.shellArmed && !p.gunArmed) {
        const distance=bombLaunchDistance(s.tick-p.bombChargeStartedTick);
        for(const a of p.tripleShotArmed||p.fiveShotArmed?volleyAngles(p.angle,p.fiveShotArmed?5:3):[p.angle]) { const x=clamp(p.x+Math.cos(a)*distance,b+20,w-b-20),y=clamp(p.y+Math.sin(a)*distance,b+20,h-b-20); f.lineStyle(2,tint,.5).lineBetween(p.x,p.y,x,y).lineStyle(2,tint,.9).strokeRect(x-9,y-9,18,18); }
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
  private brick(x:number,y:number,w:number,h:number,tint:number): void {
    this.floor.fillStyle(tint).fillRect(x-w/2,y-h/2,w,h).lineStyle(1,0xb6a7ff,.65).strokeRect(x-w/2,y-h/2,w,h).fillStyle(0xffffff,.15).fillRect(x-w/2+2,y-h/2+2,w-4,2);
  }
}
