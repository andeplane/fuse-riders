import './account-panel.css';
import { accountReady, identityToken, signIn, signInFailure, signOut, warmAccount, watchAccount, type Account } from './account.js';
import type { MatchPlayerStats } from '../shared/match-stats.js';

/**
 * The landing page's account button and its dialog: sign in, career totals and past matches. Everything a server or
 * another player supplied (names, colours, numbers) is written with textContent or a validated style property, never
 * as markup.
 */
interface HistoryEntry { id: string; endedAt: number; roomCode: string; you?: string; result: { length: number; winnerId?: string; players: MatchPlayerStats[] } }
interface HistoryPage { profile?: { totals: Record<string, number> }; matches: HistoryEntry[] }
export interface AccountPanelDependencies {
  /** GET the signed-in player's history; `before` pages backwards from an `endedAt`. */
  historyUrl: (before?: number) => string;
  fetch: typeof fetch;
  track: (event: string, props?: Record<string, unknown>) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; };
const ordinal = (place: number): string => `${place}${place % 100 >= 11 && place % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][place % 10] ?? 'TH')}`;
const count = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString() : '0';

function matchRow(entry: HistoryEntry): HTMLLIElement {
  const row = el('li', '', 'account-match'), head = el('header'), riders = el('ul', '', 'account-riders');
  const mine = entry.result.players.find(player => player.playerId === entry.you);
  row.dataset.won = String(mine?.matchPlacement === 1);
  head.append(el('strong', mine ? `${ordinal(mine.matchPlacement)} OF ${entry.result.players.length}` : 'PLAYED'), el('span', `${new Date(entry.endedAt).toLocaleDateString()} · ROOM ${entry.roomCode}`));
  for (const player of [...entry.result.players].sort((a, b) => a.matchPlacement - b.matchPlacement)) {
    const item = el('li'), dot = el('i');
    // The service only stores #rrggbb, and a colour that is not one is simply not applied.
    if (/^#[0-9a-fA-F]{6}$/.test(player.color)) dot.style.background = player.color;
    item.dataset.you = String(player.playerId === entry.you);
    item.append(dot, document.createTextNode(`${player.name} · ${player.roundWins}W · ${player.eliminations}K`));
    riders.append(item);
  }
  row.append(head, riders);
  return row;
}

export function createAccountPanel(dependencies: AccountPanelDependencies): { button: HTMLButtonElement; dialog: HTMLDialogElement; dispose: () => void } {
  const button = el('button', 'SIGN IN', 'landing-account'); button.type = 'button';
  const dialog = el('dialog', '', 'game-dialog'); dialog.setAttribute('aria-label', 'Account');
  const bar = el('header', '', 'dialog-bar'), close = el('button', '✕  CLOSE'), actions = el('span', '', 'dialog-actions'), body = el('div', '', 'dialog-body account-panel');
  close.type = 'button'; close.setAttribute('aria-label', 'CLOSE'); close.onclick = () => dialog.close();
  actions.append(close); bar.append(el('strong', 'ACCOUNT'), actions); dialog.append(bar, body);
  let account: Account | undefined, generation = 0;

  async function load(list: HTMLUListElement, totals: HTMLElement, more: HTMLButtonElement, note: HTMLElement, before?: number): Promise<void> {
    const mine = generation;
    more.hidden = true; note.textContent = 'Loading your games…';
    try {
      const token = await identityToken();
      if (!token) throw new Error('signed out');
      const response = await dependencies.fetch(dependencies.historyUrl(before), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json() as HistoryPage;
      if (mine !== generation) return; // signed out, or reopened, while this was in flight
      if (before === undefined) {
        totals.replaceChildren(...([['GAMES', 'matches'], ['WINS', 'wins'], ['ROUNDS WON', 'roundWins'], ['KILLS', 'eliminations']] as const).map(([label, key]) => { const cell = el('div'); cell.append(el('dt', label), el('dd', count(page.profile?.totals[key]))); return cell; }));
      }
      list.append(...page.matches.map(matchRow));
      note.textContent = list.childElementCount ? '' : 'No games yet. Finish a match in a room while signed in and it lands here.';
      const last = page.matches.at(-1);
      // A full page means there may be more; the oldest entry is the cursor for the next one.
      more.hidden = page.matches.length < 20 || !last;
      if (last) more.onclick = () => { void load(list, totals, more, note, last.endedAt); };
    } catch { if (mine === generation) note.textContent = 'Could not load your games. Try again in a moment.'; }
  }

  function render(): void {
    generation++;
    const error = el('p', '', 'account-error'); error.setAttribute('role', 'alert');
    if (!account) {
      const enter = el('button', 'SIGN IN WITH GOOGLE'); enter.type = 'button';
      enter.onclick = async () => { enter.disabled = true; error.textContent = ''; try { await signIn(); dependencies.track('Signed In'); } catch (failure) { error.textContent = signInFailure(failure); } finally { enter.disabled = false; } };
      // Held until the SDK is in: a tap that had to wait for the download would find its popup blocked, notably in Safari.
      const mine = generation; enter.disabled = true;
      accountReady().then(() => { if (mine === generation) enter.disabled = false; }, () => { if (mine === generation) error.textContent = 'Could not reach the sign-in service. Close this and try again.'; });
      body.replaceChildren(el('p', 'Sign in to keep a history of every match you finish and your career totals, on any device. Playing never needs an account, and the game stores only your rider name, avatar and results — not your email.', 'account-note'), enter, error);
      return;
    }
    const totals = el('dl', '', 'account-totals'), list = el('ul', '', 'account-matches'), note = el('p', '', 'account-note'), more = el('button', 'OLDER GAMES'), leave = el('button', 'SIGN OUT'), row = el('div', '', 'account-actions');
    more.type = 'button'; leave.type = 'button'; more.hidden = true;
    leave.onclick = async () => { leave.disabled = true; try { await signOut(); } catch { error.textContent = 'Could not sign out. Try again.'; leave.disabled = false; } };
    row.append(more, leave);
    body.replaceChildren(el('p', `Signed in as ${account.name}.`, 'account-note'), totals, list, note, row, error);
    void load(list, totals, more, note);
  }

  const stop = watchAccount(next => {
    account = next;
    button.textContent = next ? 'MY GAMES' : 'SIGN IN'; button.dataset.signedIn = String(Boolean(next)); button.title = next ? `Signed in as ${next.name}` : 'Sign in to keep your match history';
    if (dialog.open) render();
  });
  // The SDK is fetched when the pointer arrives, so the Google popup can open inside the click that asks for it.
  button.addEventListener('pointerenter', warmAccount, { once: true }); button.addEventListener('focus', warmAccount, { once: true });
  button.onclick = () => { warmAccount(); render(); dialog.showModal(); };
  dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
  return { button, dialog, dispose: stop };
}
