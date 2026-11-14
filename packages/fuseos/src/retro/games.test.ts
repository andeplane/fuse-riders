import { GAME_IDS, isGameId } from './gameIds';
import { GAMES, GAME_LIST, findGame, gamePage } from './games';
import { publicUrl } from './publicUrl';

describe(isGameId.name, () => {
  it('accepts every catalogued id and nothing else', () => {
    GAME_IDS.forEach((id) => expect(isGameId(id)).toBe(true));
    expect(isGameId('simcity')).toBe(false);
    expect(isGameId(1)).toBe(false);
  });
});

describe('GAMES', () => {
  it('lists the eight games in Start menu order with a licence and controls each', () => {
    expect(GAME_LIST.map((game) => game.name)).toEqual([
      'DOOM',
      'Wolfenstein 3D',
      'Commander Keen 1: Marooned on Mars',
      'Duke Nukem 3D',
      'Minesweeper',
      'SkiFree',
      'Micropolis',
      'Solitaire',
    ]);
    GAME_LIST.forEach((game) => {
      expect(game.licence.length).toBeGreaterThan(0);
      expect(game.controls.length).toBeGreaterThan(0);
    });
  });

  it('never calls Micropolis SimCity', () => {
    expect(GAMES.micropolis.name).not.toMatch(/simcity/i);
  });
});

describe(gamePage.name, () => {
  it('boots DOS bundles through the self-hosted js-dos player page', () => {
    expect(gamePage(GAMES.doom)).toBe('fuseos/jsdos/player.html?bundle=doom');
    expect(gamePage(GAMES.duke3d)).toBe('fuseos/jsdos/player.html?bundle=duke3d');
  });

  it('serves vendored web games from public/fuseos/retro and has no page for native games', () => {
    expect(gamePage(GAMES.skifree)).toBe('fuseos/retro/skifree/index.html');
    expect(gamePage(GAMES.micropolis)).toBe('fuseos/retro/micropolis/index.html');
    expect(gamePage(GAMES.minesweeper)).toBeUndefined();
    expect(gamePage(GAMES.solitaire)).toBeUndefined();
  });
});

describe(findGame.name, () => {
  it('matches by id, exact name or a unique partial name, case insensitive', () => {
    expect(findGame('doom')?.id).toBe('doom');
    expect(findGame('Wolfenstein 3D')?.id).toBe('wolf3d');
    expect(findGame('keen')?.id).toBe('keen1');
    expect(findGame('MINE')?.id).toBe('minesweeper');
    expect(findGame('solitaire')?.id).toBe('solitaire');
    expect(findGame('3d')).toBeUndefined();
    expect(findGame('tetris')).toBeUndefined();
  });
});

describe(publicUrl.name, () => {
  it('resolves against the document like the built index.html does with base "./"', () => {
    expect(publicUrl('games/doom.jsdos.wasm', './', 'https://fuseos.test/app/index.html')).toBe('https://fuseos.test/app/games/doom.jsdos.wasm');
    expect(publicUrl('jsdos/player.html?bundle=doom', './', 'https://fuseos.test/app/')).toBe('https://fuseos.test/app/jsdos/player.html?bundle=doom');
  });

  it('honours an absolute base', () => {
    expect(publicUrl('games/x.html', '/static/', 'https://localhost:3001/index.html')).toBe('https://localhost:3001/static/games/x.html');
  });
});

it('opens beginner Minesweeper at a compact board size', () => {
  expect(GAMES.minesweeper.windowSize).toEqual({ width: 240, height: 280 });
});
