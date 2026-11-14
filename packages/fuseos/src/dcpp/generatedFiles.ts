import { GiB, KiB, MiB } from "./format";
import type { Random } from "./rng";
import { pick, randomInt } from "./rng";
import type { CatalogueFile } from "./search";

/*
 * Thousands of shared files that look like a 2003 hub: MP3 albums, DivX/XviD/SVCD releases split over CDs,
 * TV episodes, fansubbed anime, Linux ISOs, software, game demos, e-books and holiday photos. Every artist,
 * title, show and release group is invented (or a free software name); nothing here is ever fetched.
 */

type List = readonly [string, ...string[]];

const ARTISTS: List = [
  "DJ Kilobyte",
  "Eiffel 56k",
  "The Napster Boys",
  "Modem Kings",
  "Analog Sunrise",
  "Bit Rate",
  "Cable Guys United",
  "Dial Tone",
  "Northern Static",
  "Pixel Orchestra",
  "Laser Lemonade",
  "The Floppy Disks",
  "Trance Atlantic",
  "Velvet Bandwidth",
  "Kilohertz",
  "Mp3 Messiahs",
  "Silicon Sisters",
  "Buffer Underrun",
  "The Packet Loss",
  "Ping & The Pongs",
  "Hyperlink Hearts",
  "Captain Carrier",
  "Nordic Echo",
  "Soundblaster 16",
  "Lo-Fi Lounge",
  "DJ Defrag",
  "Aurora Bit",
  "The Winsock Five",
  "Gigahertz Gospel Choir",
  "Midnight Telnet",
];

const GENRES: List = ["Trance", "Rock", "Pop", "Hip-Hop", "Dance", "Metal", "Ambient", "Techno", "Drum & Bass", "Punk"];

const WORDS: List = [
  "Love",
  "Night",
  "Digital",
  "Dream",
  "Fire",
  "Heart",
  "Summer",
  "Electric",
  "Lost",
  "Forever",
  "Rain",
  "Starlight",
  "Highway",
  "Broken",
  "Neon",
  "Freedom",
  "Ocean",
  "Shadow",
  "Paradise",
  "Thunder",
  "Angel",
  "Sunset",
  "Remote",
  "Download",
  "Connection",
  "Signal",
  "Echo",
  "Gravity",
  "Velvet",
  "Crystal",
];

const MIXES: List = ["", "", "", " (Radio Edit)", " (Extended Mix)", " (Club Mix)", " (Live)", " (Acoustic)", " (Remix)"];

const MOVIE_WORDS: List = [
  "Teh Matricks",
  "Lord of the Bling",
  "Star Battles",
  "Shrek Clone",
  "Fast and Furniture",
  "Spider Mann",
  "Harry Potluck",
  "Pirates of the Caribbean Cruise",
  "Finding Nemo Again",
  "The Bourne Imitation",
  "Gladiator Jr",
  "Minority Retort",
  "Ocean's Twelve Thousand",
  "The Rings of Saturn",
  "Terminator 3 and a Half",
  "Kill Billing",
  "Lost in Transmission",
  "28 Downloads Later",
  "Bad Boys Too",
  "Cast Away Again",
];

const SOURCES: List = ["DVDRip", "DVDRip", "TS", "CAM", "TC", "SCREENER", "VCD", "SVCD"];
const CODECS: List = ["DivX", "XviD", "XviD", "DivX5"];
const GROUPS: List = ["LAMERZ", "DiVXFREAK", "SVCDTEAM", "BLiNG", "MOViEKiDS", "NoGRP", "iNVENTED", "FAKE", "56KTEAM", "DSLRiPS"];

const SHOWS: List = [
  "Friendz",
  "The Simpsonz",
  "24 Minutes",
  "Smallvilletown",
  "Buffy the Pixel Slayer",
  "Stargate KB-1",
  "The X-Filez",
  "Futuramble",
  "Scrubz",
  "Alias Name",
];

const ANIME: List = [
  "Cowboy Pebop",
  "Neon Genesis Evangelionz",
  "Ghost in the Modem",
  "Full Metal Alchemyst",
  "Naruko",
  "One Piece of Cake",
  "Inu-Yashiki",
  "Trigun Show",
  "Serial Experiments Lane",
  "Fullmetal Panic Button",
];

const FANSUBS: List = ["AnimeKai", "Ani-Kraze", "SubZero-Fansubs", "Lunar", "Hikari-Subs", "DattebaYo"];

const DISTROS: readonly [string, number][] = [
  ["debian-30r1-i386-binary-1.iso", 646],
  ["debian-30r1-i386-binary-2.iso", 640],
  ["slackware-9.1-install-d1.iso", 650],
  ["slackware-9.1-install-d2.iso", 610],
  ["RedHat-9-i386-disc1.iso", 648],
  ["RedHat-9-i386-disc2.iso", 649],
  ["RedHat-9-i386-disc3.iso", 640],
  ["Mandrake-9.2-i586-CD1.iso", 690],
  ["Mandrake-9.2-i586-CD2.iso", 680],
  ["knoppix_v3.3-2003-11-19-EN.iso", 700],
  ["gentoo-x86-1.4-livecd.iso", 520],
  ["FreeBSD-5.1-RELEASE-i386-disc1.iso", 600],
  ["SuSE-9.0-i386-CD1.iso", 650],
  ["fedora-core-1-i386-disc1.iso", 646],
];

const APPS: List = [
  "Winamp 2.91 full.exe",
  "DCPlusPlus-0.401.exe",
  "mIRC 6.12 setup.exe",
  "ICQ 2003a.exe",
  "Mozilla Firebird 0.7.zip",
  "OpenOffice.org 1.1 Win32.zip",
  "7-Zip 3.13.exe",
  "VLC 0.7.0 win32.exe",
  "GIMP 1.2.5 setup.exe",
  "XviD codec 1.0.exe",
  "DivX 5.1.1 Pro Bundle.exe",
  "K-Lite Codec Pack 2.07 Full.exe",
  "Ad-aware 6.0.exe",
  "Spybot S&D 1.2.exe",
  "Trillian 2.0.exe",
  "Daemon Tools 3.41.zip",
  "WinRAR 3.20 trial.exe",
  "Nero Burning ROM 6 demo.exe",
  "Putty 0.53b.exe",
  "Notepad++ 1.0 beta.zip",
];

const GAMES: List = [
  "Fuse Riders 2003 Demo.exe",
  "Unreal Tournamint 2004 Demo.exe",
  "Half-Lifestyle Map Pack.rar",
  "Quake Arena Bot Pack.zip",
  "Need for Speeding Demo.exe",
  "Warcraft Fanmade Maps 2003.zip",
  "Counter-Strike Skins Mega Pack.rar",
  "Tetris Deluxe Shareware.exe",
  "Doom WAD Collection 1994-2003.zip",
  "Liero 1.36.zip",
];

const BOOK_TOPICS: List = ["C++", "Java", "Linux", "PHP", "Perl", "HTML 4", "Networking", "Photoshop 7", "SQL", "Windows XP", "Python", "Flash MX"];

const BOOK_FORMS: List = ["Learn {} Fast.pdf", "{} Bible 2nd Edition.chm", "Teach Yourself {} in a Weekend.pdf", "{} Cookbook.chm", "{} Pocket Reference.pdf"];

const PHOTO_FOLDERS: List = ["Party 2003", "Vacation Spain", "Christmas 2002", "LAN party", "Graduation", "New car", "Cat"];

const FUNNY: List = [
  "dancing_baby.avi",
  "funny_frog_in_blender.mpg",
  "All Your Base Are Belong To Us.swf",
  "hamster_dance.wav",
  "skateboard_fail_compilation.wmv",
  "office_rage_2.mpg",
  "badger badger badger.swf",
  "office_rage_keyboard.mpg",
  "cat_plays_piano.mpg",
  "free_screensaver_NOT_A_VIRUS.scr.exe",
  "readme_IMPORTANT.txt.vbs",
];

const joke = (path: string, name: string, size: number): CatalogueFile => ({
  name,
  path,
  size: Math.round(size),
  delivery: { kind: "joke" },
});

const pad2 = (value: number) => String(value).padStart(2, "0");

function songTitle(random: Random): string {
  return `${pick(random, WORDS)}${random() < 0.5 ? ` ${pick(random, WORDS)}` : ""}${pick(random, MIXES)}`;
}

function albums(random: Random, count: number): CatalogueFile[] {
  const files: CatalogueFile[] = [];
  for (let album = 0; album < count; album += 1) {
    const artist = pick(random, ARTISTS);
    const year = randomInt(random, 1994, 2003);
    const genre = pick(random, GENRES);
    const name = `${pick(random, WORDS)} ${pick(random, WORDS)}`;
    const folder = `MP3\\${genre}\\${artist} - ${name} (${year})\\`;
    const tracks = randomInt(random, 8, 15);
    for (let track = 1; track <= tracks; track += 1)
      files.push(
        joke(folder, `${pad2(track)} - ${artist} - ${songTitle(random)}.mp3`, randomInt(random, 2800, 9500) * KiB),
      );
  }
  return files;
}

function singles(random: Random, count: number): CatalogueFile[] {
  return Array.from({ length: count }, () => {
    const artist = pick(random, ARTISTS);
    return joke(`MP3\\Singles\\`, `${artist} - ${songTitle(random)}.mp3`, randomInt(random, 2500, 12_000) * KiB);
  });
}

function movies(random: Random, count: number): CatalogueFile[] {
  const files: CatalogueFile[] = [];
  for (let movie = 0; movie < count; movie += 1) {
    const title = pick(random, MOVIE_WORDS).replaceAll(" ", ".");
    const year = randomInt(random, 1999, 2003);
    const source = pick(random, SOURCES);
    const svcd = source === "SVCD" || source === "VCD";
    const codec = svcd ? source : pick(random, CODECS);
    const group = pick(random, GROUPS);
    const release = `${title}.${year}.${source}.${codec}-${group}`;
    const discs = random() < 0.55 ? 2 : random() < 0.2 ? 3 : 1;
    const ext = svcd ? "mpg" : "avi";
    const folder = `Movies\\${release}\\`;
    for (let disc = 1; disc <= discs; disc += 1)
      files.push(joke(folder, `${release}.CD${disc}.${ext}`, randomInt(random, 680, 800) * MiB));
    files.push(joke(folder, `${group.toLowerCase()}.nfo`, randomInt(random, 2, 9) * KiB));
    if (random() < 0.6) files.push(joke(folder, `${release}.sub`, randomInt(random, 40, 90) * KiB));
  }
  return files;
}

function episodes(random: Random, count: number): CatalogueFile[] {
  const files: CatalogueFile[] = [];
  for (let run = 0; run < count; run += 1) {
    const show = pick(random, SHOWS);
    const season = randomInt(random, 1, 9);
    const group = pick(random, GROUPS);
    const first = randomInt(random, 1, 14);
    const length = randomInt(random, 2, 8);
    for (let episode = first; episode < first + length; episode += 1)
      files.push(
        joke(
          `TV\\${show}\\Season ${season}\\`,
          `${show.replaceAll(" ", ".")}.S${pad2(season)}E${pad2(episode)}.HDTV.XviD-${group}.avi`,
          randomInt(random, 170, 360) * MiB,
        ),
      );
  }
  return files;
}

function anime(random: Random, count: number): CatalogueFile[] {
  const files: CatalogueFile[] = [];
  for (let run = 0; run < count; run += 1) {
    const show = pick(random, ANIME);
    const fansub = pick(random, FANSUBS);
    const first = randomInt(random, 1, 20);
    const length = randomInt(random, 3, 13);
    const ext = random() < 0.7 ? "avi" : "ogm";
    for (let episode = first; episode < first + length; episode += 1) {
      const crc = Math.floor(random() * 0xffffffff)
        .toString(16)
        .toUpperCase()
        .padStart(8, "0");
      files.push(
        joke(`Anime\\${show}\\`, `[${fansub}] ${show} - ${pad2(episode)} [${crc}].${ext}`, randomInt(random, 160, 240) * MiB),
      );
    }
    if (random() < 0.4)
      files.push(joke(`Anime\\OST\\${show}\\`, `${show} OST - ${pad2(randomInt(random, 1, 20))} - ${songTitle(random)}.mp3`, randomInt(random, 3000, 8000) * KiB));
  }
  return files;
}

function photos(random: Random, folders: number): CatalogueFile[] {
  const files: CatalogueFile[] = [];
  for (let folder = 0; folder < folders; folder += 1) {
    const name = pick(random, PHOTO_FOLDERS);
    const first = randomInt(random, 1, 4000);
    const count = randomInt(random, 10, 40);
    for (let photo = first; photo < first + count; photo += 1)
      files.push(joke(`My Pictures\\${name}\\`, `DSC${String(photo).padStart(5, "0")}.JPG`, randomInt(random, 450, 1400) * KiB));
  }
  return files;
}

/** The whole pretend network's share, from a fixed seed so every visit sees the same files. */
export function generateCatalogue(random: Random): CatalogueFile[] {
  return [
    ...albums(random, 140),
    ...singles(random, 400),
    ...movies(random, 160),
    ...episodes(random, 70),
    ...anime(random, 50),
    ...photos(random, 20),
    ...DISTROS.map(([name, size]) => joke("ISO\\Linux\\", name, size * MiB)),
    joke("Source\\Kernel\\", "linux-2.4.22.tar.gz", 31 * MiB),
    joke("Source\\Kernel\\", "linux-2.6.0-test9.tar.bz2", 32 * MiB),
    ...APPS.map((name) => joke("Software\\", name, randomInt(random, 900, 90_000) * KiB)),
    ...GAMES.map((name) => joke("Games\\", name, randomInt(random, 20, 400) * MiB)),
    joke("Games\\Emulators\\", "ZSNES 1.36 + Every Rom Ever.zip", 2.3 * GiB),
    ...BOOK_TOPICS.flatMap((topic) =>
      BOOK_FORMS.filter(() => random() < 0.6).map((form) =>
        joke(`eBooks\\Computers\\`, form.replace("{}", topic), randomInt(random, 900, 14_000) * KiB),
      ),
    ),
    ...FUNNY.map((name) => joke("Funny\\", name, randomInt(random, 300, 6000) * KiB)),
    joke("Software\\Skins\\", "Winamp Skins Mega Collection 2003.zip", 48 * MiB),
    joke("Pictures\\Wallpapers\\", "Cute Kitten Wallpapers 1024x768.zip", 23 * MiB),
  ];
}
