import type { MomentCard } from '../shared/match-recap.js';
import { zoomOrigin, type ReplayUpdate } from './replay.js';

/**
 * The broadcast dressing over the arena while a replay plays: letterbox bars, a chyron with the moment, a slow-motion
 * badge, an impact flash, scanlines, and a LIVE flag when play returns. It only moves DOM and the canvas transform;
 * the world itself comes from the renderer as usual.
 */
export interface ReplayOverlay {
  readonly element: HTMLElement;
  start(card: MomentCard, color: string): void;
  /** Called every animation frame with the director's frame; on `done` it takes itself down. */
  update(update: ReplayUpdate, canvas: HTMLCanvasElement, world: { width: number; height: number }): void;
  stop(canvas?: HTMLCanvasElement): void;
  readonly visible: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export function createReplayOverlay(): ReplayOverlay {
  const root = element('div', 'replay-overlay'); root.hidden = true; root.setAttribute('aria-live', 'polite');
  const top = element('div', 'replay-bar replay-bar-top'), bottom = element('div', 'replay-bar replay-bar-bottom');
  const scan = element('div', 'replay-scan'), flash = element('div', 'replay-flash');
  const chyron = element('div', 'replay-chyron');
  const kicker = element('span', 'replay-kicker', '▶  INSTANT REPLAY'), title = element('strong', 'replay-title'), copy = element('em', 'replay-copy'), when = element('small', 'replay-when');
  chyron.append(kicker, title, copy, when);
  const slow = element('div', 'replay-slow', '◀◀  SLOW MOTION  ×¼'), live = element('div', 'replay-live', '●  LIVE');
  root.append(top, bottom, scan, flash, chyron, slow, live);
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let zoomed: HTMLCanvasElement | undefined;
  const release = (canvas?: HTMLCanvasElement) => { const target = canvas ?? zoomed; if (target) { target.style.transform = ''; target.style.transformOrigin = ''; target.classList.remove('replay-zoomed'); } zoomed = undefined; };
  return {
    element: root,
    get visible() { return !root.hidden; },
    start(card, color) {
      clearTimeout(liveTimer);
      title.textContent = `${card.icon}  ${card.title}`; copy.textContent = card.copy; when.textContent = card.when;
      root.style.setProperty('--player-color', color);
      root.dataset.stage = 'hold'; root.hidden = false; live.classList.remove('on');
    },
    update(update, canvas, world) {
      if (root.hidden && update.stage !== 'done') root.hidden = false;
      root.dataset.stage = update.stage;
      slow.classList.toggle('on', update.slow);
      flash.style.opacity = String(update.flash * .85);
      if (update.stage === 'play' || update.stage === 'out') {
        if (update.focus && update.zoom > 1.001) {
          const rect = canvas.getBoundingClientRect();
          const origin = zoomOrigin({ width: rect.width, height: rect.height }, world, update.focus);
          canvas.style.transformOrigin = `${origin.x}px ${origin.y}px`;
          canvas.style.transform = `scale(${update.zoom.toFixed(3)})`;
          canvas.classList.add('replay-zoomed'); zoomed = canvas;
        } else release(canvas);
      }
      if (update.stage === 'done') {
        release(canvas);
        root.dataset.stage = 'done'; live.classList.add('on');
        liveTimer = setTimeout(() => { live.classList.remove('on'); root.hidden = true; }, 900);
      }
    },
    stop(canvas) { clearTimeout(liveTimer); release(canvas); live.classList.remove('on'); root.hidden = true; },
  };
}
