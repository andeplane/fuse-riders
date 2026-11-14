/** One line of the About sheet's credits: who made what FuseOS is built on, and under which terms. */
export type Credit = {
  /** The project or the people. */
  name: string;
  /** Who made it, when the name alone does not say. */
  by?: string;
  /** What it does on this desktop. */
  role: string;
  /** The licence, in a word or two. */
  licence: string;
  /** Where to find it. */
  url?: string;
};

/**
 * Everything FuseOS stands on, for the About sheet. The order is roughly what a user meets first:
 * the look, the windows, the programs, then the games and the music. docs/fuseos/README.md
 * points at the full licence texts under docs/fuseos.
 */
export const CREDITS: readonly Credit[] = [
  {
    name: "98.css",
    by: "Jordan Scales",
    role: "the Windows 98 look of every window, button and menu",
    licence: "MIT",
    url: "https://jdan.github.io/98.css/",
  },
  {
    name: "React95 icons",
    by: "the React95 contributors",
    role: "the desktop and Start menu icons",
    licence: "MIT",
    url: "https://github.com/React95/React95",
  },
  {
    name: "react-rnd",
    by: "bokuweb",
    role: "dragging and resizing the windows",
    licence: "MIT",
    url: "https://github.com/bokuweb/react-rnd",
  },
  {
    name: "Webamp",
    by: "Jordan Eldredge",
    role: "Winamp, skins and all",
    licence: "MIT",
    url: "https://webamp.org",
  },
  {
    name: "js-dos",
    by: "Alexander Guryanov",
    role: "the DOSBox that runs the DOS games",
    licence: "GPL-2.0",
    url: "https://js-dos.com",
  },
  {
    name: "clippyjs",
    by: "Pooya Parsa and Fireplace, Inc.",
    role: "Clippy's sprite sheet and sounds",
    licence: "MIT",
    url: "https://github.com/pi0/clippyjs",
  },
  {
    name: "WebLLM",
    by: "the MLC AI team",
    role: "the language model behind Clippy, running in your browser",
    licence: "Apache-2.0",
    url: "https://webllm.mlc.ai",
  },
  {
    name: "CodeMirror",
    by: "Marijn Haverbeke",
    role: "the editor inside Notepad++",
    licence: "MIT",
    url: "https://codemirror.net",
  },
  {
    name: "3D Pipes",
    by: "Isaiah Odhner (1j01/pipes)",
    role: "the screensaver, a three.js remake of the Windows 95 original",
    licence: "MIT",
    url: "https://github.com/1j01/pipes",
  },
  {
    name: "id Software, Apogee Software and 3D Realms",
    role: "the shareware episodes of DOOM, Wolfenstein 3D, Commander Keen and Duke Nukem 3D",
    licence: "shareware, redistributed unmodified under their vendor terms",
  },
  {
    name: "skifree.js",
    by: "Dan Hough",
    role: "SkiFree",
    licence: "MIT",
    url: "https://github.com/basicallydan/skifree.js",
  },
  {
    name: "micropolisJS",
    by: "Graeme McCutcheon",
    role: "Micropolis, the open-source SimCity",
    licence: "GPL-3.0 and the Micropolis Public Name License",
    url: "https://github.com/graememcc/micropolisJS",
  },
  {
    name: "Vector Playing Cards",
    by: "Byron Knoll",
    role: "the card faces in Solitaire",
    licence: "public domain",
    url: "https://github.com/notpeter/Vector-Playing-Cards",
  },
  {
    name: "The Fuse games' soundtracks",
    role: "the music in Winamp, from Fuse Riders Radio and the other games",
    licence: "part of the Fuse games",
  },
];
