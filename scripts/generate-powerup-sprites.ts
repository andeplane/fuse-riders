import { writeFile } from 'node:fs/promises';

/** Source artwork for both themes. Run with: node --import tsx scripts/generate-powerup-sprites.ts
 * Keep the existing 32-unit anchors; draw at 2× for legible, rounded details.
 * No fonts, filters or external resources: the SVGs also rasterize in Phaser.
 */
const artwork: Record<string, string> = {
  'pickup-gravity': `
    <circle cx="32" cy="32" r="21" fill="url(#body)" stroke="#b98cff" stroke-width="2.5"/>
    <ellipse cx="32" cy="32" rx="19" ry="7" fill="none" stroke="url(#violet)" stroke-width="3.5" transform="rotate(-20 32 32)"/>
    <circle cx="32" cy="32" r="8" fill="#0a0618" stroke="#e6d4ff" stroke-width="2"/>
    <path d="M13 20c5 3 8 6 10 10M51 44c-5-3-8-6-10-10" fill="none" stroke="#d7b6ff" stroke-width="2.5" stroke-linecap="round" opacity=".85"/>
  `,
  'pickup-boost': `
    <circle cx="32" cy="32" r="21" fill="url(#body)" stroke="#5cf0ff" stroke-width="2.5"/>
    <path d="M35 11 19 35h11l-3 18 18-26H34z" fill="url(#cyan)" stroke="#e4fdff" stroke-width="2" stroke-linejoin="round"/>
    <path d="M8 25h9M6 33h11M9 41h8" fill="none" stroke="#8ff8ff" stroke-width="3" stroke-linecap="round" opacity=".75"/>
  `,
  bomb: `
    <path d="M36 20c0-9 6-13 12-10" fill="none" stroke="#ffb64e" stroke-width="4"/>
    <path d="m47 5 1 5 5 1M52 5l-2 2" fill="none" stroke="#fff4bf" stroke-width="2"/>
    <rect x="27" y="17" width="13" height="9" rx="3" fill="url(#metal)" transform="rotate(18 33 22)"/>
    <circle cx="31" cy="37" r="20" fill="url(#body)" stroke="#ff5ca6" stroke-width="2.5"/>
    <path d="M16 34a15 15 0 0 1 11-12" fill="none" stroke="#e7eeff" stroke-width="3.5" opacity=".9"/>
    <path d="M24 52a16 16 0 0 0 20-10" fill="none" stroke="#c24084" stroke-width="2" opacity=".65"/>
    <ellipse cx="23" cy="28" rx="4" ry="2" fill="#fff" opacity=".5" transform="rotate(-35 23 28)"/>`,
  'pickup-stopwatch': `
    <rect x="26" y="4" width="12" height="6" rx="2.5" fill="url(#gold)"/>
    <path d="M32 10v5m14 2 4-4" stroke="#ffe9aa" stroke-width="4"/>
    <circle cx="32" cy="36" r="21" fill="url(#gold)" stroke="#fff0b4" stroke-width="1.5"/>
    <circle cx="32" cy="36" r="16.5" fill="url(#body)" stroke="#b6782a" stroke-width="1.5"/>
    <path d="M32 23v3m13 10h-3M32 49v-3M19 36h3" stroke="#ffe49e" stroke-width="2"/>
    <path d="M32 28v9l8 4" fill="none" stroke="#fff4cf" stroke-width="3"/>
    <circle cx="32" cy="36" r="2.5" fill="#fff"/>`,
  'pickup-blast': `
    <circle cx="32" cy="32" r="24" fill="none" stroke="#ff9755" stroke-width="1.5" opacity=".45"/>
    <path d="M28 10h8a3 3 0 0 1 3 3v12h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H39v12a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V39H13a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h12V13a3 3 0 0 1 3-3Z" fill="url(#orange)" stroke="#ffd590" stroke-width="1.5"/>
    <path d="M32 17v30M17 32h30" stroke="#fff5c7" stroke-width="4"/>
    <circle cx="32" cy="32" r="4" fill="#fff"/>`,
  'pickup-star': `
    <path d="m34.7 8.5 6.2 12.8 14.2 2.1c2.4.3 3.3 3.3 1.5 5l-10.3 10 2.5 14.2c.4 2.4-2.1 4.2-4.2 3.1L32 49l-12.6 6.7c-2.1 1.1-4.6-.7-4.2-3.1l2.5-14.2-10.3-10c-1.8-1.7-.9-4.7 1.5-5l14.2-2.1 6.2-12.8c1.1-2.2 4.3-2.2 5.4 0Z" fill="url(#gold)" stroke="#fff1a8" stroke-width="2"/>
    <path d="m31 17-5 10-11 2" fill="none" stroke="#fffbd9" stroke-width="3"/>
    <path d="m32 26 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#fff4b6" opacity=".65"/>`,
  'pickup-beer': `
    <path d="M43 23h6c11 0 11 22 0 22h-6" fill="none" stroke="#bce5f8" stroke-width="5"/>
    <path d="M13 18h30v33a5 5 0 0 1-5 5H18a5 5 0 0 1-5-5Z" fill="url(#gold)" stroke="#fff0c6" stroke-width="2"/>
    <path d="M21 28v19m9-19v19" stroke="#fff5bf" stroke-width="3" opacity=".7"/>
    <path d="M13 23c-9-1-7-12 1-12 1-8 13-9 17-3 8-5 17 2 14 9 5 7-4 12-9 7-4 3-8 1-10-2-4 4-10 4-13 1Z" fill="#fff7e7" stroke="#dceafa" stroke-width="1.5"/>
    <path d="M18 19v9" stroke="#fff7e7" stroke-width="5"/>`,
  'pickup-gun': `
    <path d="m19 35-4 16c-.6 3 1 5 4 5h8l6-20" fill="url(#body)" stroke="#a9d8e5" stroke-width="2"/>
    <path d="M13 16h34l8 6v12H14a6 6 0 0 1-6-6v-6a6 6 0 0 1 5-6Z" fill="url(#metal)" stroke="#deffff" stroke-width="2"/>
    <rect x="43" y="18" width="13" height="17" rx="4" fill="#122b43" stroke="#79e6f2" stroke-width="2"/>
    <path d="M16 23h19" stroke="#fff" stroke-width="3"/>
    <path d="M30 37v7h7l4-8" fill="none" stroke="#9fcbd9" stroke-width="2.5"/>
    <path d="M21 41h5m-6 6h5" stroke="#65d3ee" stroke-width="2"/>`,
  'pickup-shell': `
    <path d="M9 39C9 3 55 3 55 39l-5 10H14Z" fill="url(#green)" stroke="#d8ffbf" stroke-width="2"/>
    <path d="m32 14-10 8 3 14h14l3-14-10-8Zm-10 8-11 2m14 12-9 10m23-10 9 10m-6-24 11 2" fill="none" stroke="#13775a" stroke-width="2.5"/>
    <path d="M12 39c9 7 31 7 40 0l4 6c-7 15-41 15-48 0Z" fill="url(#metal)" stroke="#edffdf" stroke-width="2"/>
    <path d="M18 45c8 4 20 4 28 0" fill="none" stroke="#fff" stroke-width="2"/>`,
  'pickup-target': `
    <circle cx="32" cy="32" r="22" fill="url(#body)" stroke="#6af9d7" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="13" fill="none" stroke="#4ccfb7" stroke-width="1.5"/>
    <path d="M32 5v15m0 24v15M5 32h15m24 0h15" stroke="#d3fff4" stroke-width="3.5"/>
    <circle cx="32" cy="32" r="4" fill="#adffe6"/>`,
  'pickup-ink': `
    <path d="M23 14h18v8l9 9a9 9 0 0 1 3 7v12a7 7 0 0 1-7 7H18a7 7 0 0 1-7-7V38a9 9 0 0 1 3-7l9-9Z" fill="url(#body)" stroke="#d29aff" stroke-width="2.5"/>
    <rect x="21" y="7" width="22" height="10" rx="3" fill="url(#violet)" stroke="#efd2ff" stroke-width="1.5"/>
    <path d="M17 38v11" stroke="#edceff" stroke-width="3" opacity=".75"/>
    <path d="M33 29c-2 5-8 10-8 14a8 8 0 0 0 16 0c0-4-6-9-8-14Z" fill="url(#violet)"/>
    <path d="M29 44c0 2 1 3 3 3" fill="none" stroke="#fff" stroke-width="2"/>`,
  'pickup-orbitShield': `
    <ellipse cx="32" cy="33" rx="28" ry="12" transform="rotate(-35 32 33)" fill="none" stroke="#53cbdc" stroke-width="2" opacity=".7"/>
    <path d="m32 7 18 7v18c0 13-12 21-18 25-6-4-18-12-18-25V14Z" fill="url(#body)" stroke="#92faff" stroke-width="2.5"/>
    <path d="m32 14 11 4v14c0 8-6 14-11 18-5-4-11-10-11-18V18Z" fill="url(#cyan)" opacity=".8"/>
    <path d="m25 31 5 5 10-12" fill="none" stroke="#e5ffff" stroke-width="3"/>
    <circle cx="54" cy="18" r="4" fill="#e8ffff" stroke="#65f0ff" stroke-width="2"/>`,
  'pickup-portal': `
    <ellipse cx="20" cy="30" rx="12" ry="23" transform="rotate(15 20 30)" fill="url(#body)" stroke="#bf80ff" stroke-width="4"/>
    <path d="M18 12c-4 3-7 9-8 16" fill="none" stroke="#f4d6ff" stroke-width="2"/>
    <ellipse cx="44" cy="34" rx="12" ry="23" transform="rotate(15 44 34)" fill="url(#body)" stroke="#ffaf53" stroke-width="4"/>
    <path d="M46 52c4-3 7-9 8-16" fill="none" stroke="#fff0c4" stroke-width="2"/>
    <path d="M20 34c7 7 18 7 24-3m-7 0h7v7" fill="none" stroke="#f0e2ff" stroke-width="2.5"/>`,
  flame: `
    <path d="M33 5c5 13 2 18 8 23 3-4 4-8 4-12 12 13 17 26 9 36-9 12-34 13-44-1-6-9-1-23 9-31-1 10 1 12 4 14 5-7 2-19 10-29Z" fill="url(#orange)" stroke="#ffd78b" stroke-width="1.5"/>
    <path d="M32 28c2 8 9 12 10 18 2 12-20 14-21 2-1-7 7-12 11-20Z" fill="url(#gold)"/>
    <path d="M32 41c-6 7-6 14 0 14s6-7 0-14Z" fill="#fff9da"/>`,
};

function volley(count: 3 | 5): string {
  const points = count === 3 ? [[14, 36], [32, 23], [50, 36]] : [[10, 40], [20, 26], [32, 19], [44, 26], [54, 40]];
  const radius = count === 3 ? 8 : 6;
  return `<rect x="3" y="5" width="58" height="54" rx="12" fill="url(#body)" stroke="${count === 5 ? '#ffd576' : '#be8bff'}" stroke-width="2"/>
    ${points.map(([x, y]) => `<path d="M${x} ${y-radius}q0-5 4-5" fill="none" stroke="#ffe0a1" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${radius}" fill="url(#pink)" stroke="#ffd3ee" stroke-width="1.5"/><circle cx="${x-2}" cy="${y-2}" r="1.5" fill="#fff"/>`).join('\n    ')}
    <path d="${count === 3 ? 'M23 51h18' : 'M20 51h24'}" stroke="${count === 5 ? '#ffe29c' : '#edbcff'}" stroke-width="3"/>`;
}
artwork['pickup-triple'] = volley(3);
artwork['pickup-five'] = volley(5);

for (const theme of ['neon-pixel', 'clean-neon']) {
  for (const [name, body] of Object.entries(artwork)) {
    const gradients = Object.entries({
      metal: ['#f4fcff', '#8eaec7', '#36546c'], gold: ['#fff7bf', '#ffd051', '#ed861b'],
      orange: ['#ffdc79', '#ff8b36', '#e93665'], green: ['#c3ff88', '#58dc71', '#159377'],
      violet: ['#f0c8ff', '#b375ed', '#6540a6'], cyan: ['#c3ffff', '#4edce9', '#217dba'],
      pink: ['#ffdbf5', '#f86cbd', '#993c85'],
    }).map(([id, colors]) => `<linearGradient id="${id}" x1="0" y1="0" x2=".7" y2="1">${colors.map((color, index) => `<stop offset="${index/2}" stop-color="${color}"/>`).join('')}</linearGradient>`).join('\n    ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <defs>
    <radialGradient id="body" cx=".3" cy=".2" r=".85"><stop stop-color="${theme === 'neon-pixel' ? '#62628e' : '#52768b'}"/><stop offset=".48" stop-color="#26334d"/><stop offset="1" stop-color="#0a1127"/></radialGradient>
    ${gradients}
  </defs>
  <g transform="scale(.5)">${body}
  </g>
</svg>\n`;
    // Include only the gradients used by this icon.
    const used = new Set([...body.matchAll(/url\(#([a-z]+)\)/g)].map(match => match[1]));
    await writeFile(new URL(`../public/themes/${theme}/${name}.svg`, import.meta.url), svg.replace(/<(linearGradient|radialGradient) id="([a-z]+)"[\s\S]*?<\/\1>/g, (definition, _tag, id) => used.has(id) ? definition : '').replace(/^ +\n/gm, ''));
  }
}
