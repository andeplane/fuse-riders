import type { Cell, World } from '../engine/types.js';

const radius = 35;
const dx = Math.sqrt(3) * radius;
const dy = 1.5 * radius;
const sides = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
});

export function hexCenter(width: number, cell: number): { x: number; y: number } {
  const row = Math.floor(cell / width);
  const column = cell % width;
  return { x: radius + dx * (column + (row & 1) / 2), y: radius + dy * row };
}

export function hexPoints(width: number, cell: number): string {
  const { x, y } = hexCenter(width, cell);
  return sides.map(([sx, sy]) => `${(x + sx).toFixed(2)},${(y + sy).toFixed(2)}`).join(' ');
}

function terrainClass(cell: Cell, index: number): string {
  if (cell.terrain === 'deposit') return `terrain-deposit terrain-${cell.resourceKind}`;
  if (cell.terrain === 'blocked') return `terrain-blocked terrain-blocked-${index % 4}`;
  return `terrain-open terrain-open-${index % 4}`;
}

function icon(cell: Cell, x: number, y: number): string {
  if (cell.terrain === 'deposit') {
    return cell.resourceKind === 'biomass'
      ? `<path class="deposit-symbol biomass-symbol" d="M${x} ${y-18} C${x+22} ${y-9} ${x+18} ${y+15} ${x} ${y+20} C${x-18} ${y+15} ${x-22} ${y-9} ${x} ${y-18}Z"/><path class="deposit-rune" d="M${x-11} ${y+4}L${x} ${y-7}L${x+11} ${y+4}M${x} ${y-7}V${y+13}"/>`
      : `<path class="deposit-symbol insight-symbol" d="M${x} ${y-21}L${x+17} ${y}L${x} ${y+20}L${x-17} ${y}Z"/><path class="deposit-rune" d="M${x-10} ${y}H${x+10}M${x} ${y-15}V${y+15}"/>`;
  }
  if (cell.terrain === 'blocked') return `<path class="rock-symbol" d="M${x-22} ${y+13}L${x-14} ${y-9}L${x-3} ${y-15}L${x+5} ${y-7}L${x+16} ${y-13}L${x+23} ${y+11}L${x+7} ${y+18}Z"/><path class="rock-facet" d="M${x-14} ${y-9}L${x-5} ${y+7}L${x+5} ${y-7}M${x-5} ${y+7}L${x+7} ${y+18}"/>`;
  if (cell.towerSite) return `<circle class="tower-site" cx="${x}" cy="${y}" r="18"/><path class="tower-site-mark" d="M${x-12} ${y}H${x+12}M${x} ${y-12}V${y+12}"/>`;
  return '';
}

function structureMarkup(world: Readonly<World>): string {
  return world.structures.map(structure => {
    const { x, y } = hexCenter(world.map.width, structure.cell);
    const owner = world.players.find(player => player.id === structure.ownerId);
    const slot = owner?.slot ?? 0;
    const kind = structure.kind;
    const hpCap = kind === 'brain' ? 240 : kind === 'tower' ? 120 : 60;
    const hp = Math.max(0, Math.min(1, structure.hp / hpCap));
    const glyph = kind === 'brain'
      ? `<path d="M${x-16} ${y+10}Q${x-26} ${y-3} ${x-14} ${y-12}Q${x-7} ${y-22} ${x} ${y-15}Q${x+8} ${y-22} ${x+17} ${y-11}Q${x+26} ${y+1} ${x+15} ${y+12}Q${x+5} ${y+23} ${x-8} ${y+17}Z"/><path class="structure-detail" d="M${x-12} ${y-4}Q${x} ${y+4} ${x-5} ${y+14}M${x+4} ${y-12}Q${x-3} ${y-1} ${x+14} ${y+5}"/>`
      : kind === 'tower'
      ? `<path d="M${x} ${y-22}L${x+18} ${y+11}L${x} ${y+19}L${x-18} ${y+11}Z"/><circle class="structure-core" cx="${x}" cy="${y+1}" r="7"/>`
      : `<path d="M${x} ${y-19}L${x+16} ${y-9}L${x+16} ${y+9}L${x} ${y+19}L${x-16} ${y+9}L${x-16} ${y-9}Z"/><circle class="structure-core" cx="${x}" cy="${y}" r="7"/>`;
    return `<g class="structure owner-${slot} ${structure.connected ? '' : 'disconnected'}" data-cell="${structure.cell}"><circle class="structure-aura" cx="${x}" cy="${y}" r="26"/><g class="structure-glyph">${glyph}</g><path class="hp-track" d="M${x-17} ${y+25}H${x+17}"/><path class="hp-fill" d="M${x-17} ${y+25}H${x-17+34*hp}"/></g>`;
  }).join('');
}

function linkMarkup(world: Readonly<World>): string {
  const structures = world.structures.filter(item => item.connected);
  const owned = new Map(structures.map(item => [item.cell, item]));
  const lines: string[] = [];
  for (const structure of structures) {
    const row = Math.floor(structure.cell / world.map.width);
    const col = structure.cell % world.map.width;
    const candidates: Array<readonly [number, number]> = [[col+1,row],[col+(row&1),row+1],[col-1+(row&1),row+1]];
    for (const [c,r] of candidates) {
      if (c < 0 || r < 0 || c >= world.map.width || r >= world.map.height) continue;
      const peer = owned.get(r*world.map.width+c);
      if (!peer || peer.ownerId !== structure.ownerId) continue;
      const a=hexCenter(world.map.width,structure.cell), b=hexCenter(world.map.width,peer.cell);
      const slot=world.players.find(player=>player.id===structure.ownerId)?.slot ?? 0;
      lines.push(`<path class="axon owner-${slot}" d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`);
    }
  }
  return lines.join('');
}

export interface BoardAnimation { animate(now: number): void }

export function renderBoard(svg: SVGSVGElement, world: Readonly<World>, selected: number | null, debug: boolean, reducedMotion: boolean, now: number): BoardAnimation {
  const width = world.map.width, height = world.map.height;
  svg.setAttribute('viewBox', `0 0 ${Math.ceil(dx*(width+0.5)+radius*2)} ${Math.ceil(dy*(height-1)+radius*2)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${width} by ${height} hex map at simulation tick ${world.tick}`);
  const terrain = world.map.cells.map((cell,index) => `<g class="hex ${terrainClass(cell,index)}" data-cell="${index}"><polygon points="${hexPoints(width,index)}"/>${icon(cell,hexCenter(width,index).x,hexCenter(width,index).y)}</g>`).join('');
  const queues=world.players.flatMap(player=>player.queue.map((entry,index)=>({entry,index,slot:player.slot}))).map(({entry,index,slot})=>{
    const {x,y}=hexCenter(width,entry.cell);
    return `<g class="queue-mark owner-${slot}" data-cell="${entry.cell}"><circle cx="${x}" cy="${y}" r="22"/><text x="${x}" y="${y+5}" text-anchor="middle">${index+1}</text></g>`;
  }).join('');
  const selectedMarkup=selected === null ? '' : `<polygon class="selected-hex" points="${hexPoints(width,selected)}"/>`;
  const grid = debug ? `<g class="debug-grid">${world.map.cells.map((_,index)=>`<polygon points="${hexPoints(width,index)}"/>`).join('')}</g>` : '';
  const particleEls=world.particles.filter(p=>p.mode!=='recovering').map(p=>{
    const point=hexCenter(width,p.cell);
    return `<g class="attack-particle owner-${world.players.find(player=>player.id===p.ownerId)?.slot ?? 0}" data-particle="${p.id}" transform="translate(${point.x} ${point.y})"><path d="M-5 5L0 -8L5 5L0 2Z"/></g>`;
  }).join('');
  const workerEls=world.players.map(p=>{
    const point=hexCenter(width,p.worker.cell);
    return `<g class="builder-particle owner-${p.slot}" data-worker="${p.id}" transform="translate(${point.x} ${point.y})"><path d="M0 -9L7 3L0 9L-7 3Z"/><circle r="2"/></g>`;
  }).join('');
  svg.innerHTML = `<g class="terrain-layer">${terrain}</g><g class="link-layer">${linkMarkup(world)}</g><g class="queue-layer">${queues}</g><g class="structure-layer">${structureMarkup(world)}</g><g class="particle-layer">${particleEls}${workerEls}</g>${grid}${selectedMarkup}`;
  const start=now;
  return { animate(frameNow) {
    const visualTick=world.tick+(reducedMotion?0:Math.max(0,Math.min(1,(frameNow-start)/50)));
    for (const p of world.particles) {
      if (p.mode!=='transit') continue;
      const element=svg.querySelector<SVGGElement>(`[data-particle="${p.id}"]`);
      if (!element) continue;
      const from=hexCenter(width,p.from),to=hexCenter(width,p.to);
      const fraction=Math.max(0,Math.min(1,(visualTick-p.departedAt)/(p.arrivesAt-p.departedAt||1)));
      element.setAttribute('transform',`translate(${from.x+(to.x-from.x)*fraction} ${from.y+(to.y-from.y)*fraction})`);
    }
    for (const p of world.players) {
      const worker=p.worker;
      if (worker.mode!=='outbound'&&worker.mode!=='returning') continue;
      const element=svg.querySelector<SVGGElement>(`[data-worker="${p.id}"]`);
      if (!element) continue;
      const from=hexCenter(width,worker.from),to=hexCenter(width,worker.to);
      const fraction=Math.max(0,Math.min(1,(visualTick-worker.departedAt)/(worker.arrivesAt-worker.departedAt||1)));
      element.setAttribute('transform',`translate(${from.x+(to.x-from.x)*fraction} ${from.y+(to.y-from.y)*fraction})`);
    }
  }};
}
