import { CdMusic } from "@react95/icons/CdMusic";
import { Computer } from "@react95/icons/Computer";
import { ComputerFind } from "@react95/icons/ComputerFind";
import { CurvesAndColors100 } from "@react95/icons/CurvesAndColors100";
import { Desk100 } from "@react95/icons/Desk100";
import { FileText } from "@react95/icons/FileText";
import { Folder } from "@react95/icons/Folder";
import { FolderExe } from "@react95/icons/FolderExe";
import { FolderFile } from "@react95/icons/FolderFile";
import { FolderOpen } from "@react95/icons/FolderOpen";
import { HelpBook } from "@react95/icons/HelpBook";
import { InfoBubble } from "@react95/icons/InfoBubble";
import { Jgdwmie101 } from "@react95/icons/Jgdwmie101";
import { Joy102 } from "@react95/icons/Joy102";
import { KeyboardMouse } from "@react95/icons/KeyboardMouse";
import { Lights100 } from "@react95/icons/Lights100";
import { Mplayer10 } from "@react95/icons/Mplayer10";
import { Mplayer11 } from "@react95/icons/Mplayer11";
import { Mspaint } from "@react95/icons/Mspaint";
import { Network } from "@react95/icons/Network";
import { Notepad2 } from "@react95/icons/Notepad2";
import { Packager } from "@react95/icons/Packager";
import { Progman22 } from "@react95/icons/Progman22";
import { Progman33 } from "@react95/icons/Progman33";
import { RecycleEmpty } from "@react95/icons/RecycleEmpty";
import { RecycleFull } from "@react95/icons/RecycleFull";
import { Settings } from "@react95/icons/Settings";
import { Shell321 } from "@react95/icons/Shell321";
import { Shell322 } from "@react95/icons/Shell322";
import { Shell323 } from "@react95/icons/Shell323";
import { Shell326 } from "@react95/icons/Shell326";
import { Shell328 } from "@react95/icons/Shell328";
import { Shell3225 } from "@react95/icons/Shell3225";
import { Shell3242 } from "@react95/icons/Shell3242";
import { Sol1 } from "@react95/icons/Sol1";
import { User } from "@react95/icons/User";
import { Wab321016 } from "@react95/icons/Wab321016";
import { Warning } from "@react95/icons/Warning";
import { WindowsExplorer } from "@react95/icons/WindowsExplorer";
import { Winmine1 } from "@react95/icons/Winmine1";
import type { ComponentType, SVGProps } from "react";

import { WinampLogo } from "../assets/WinampLogo";
import { FusteamLogo } from "../launcher/FusteamLogo";

/** Every icon the desktop can show; a name rather than a component so window state stays serializable. */
export type IconName =
  | "computer"
  | "network"
  | "recycle"
  | "folder"
  | "folderOpen"
  | "file"
  | "image"
  | "audio"
  | "explorer"
  | "settings"
  | "find"
  | "help"
  | "run"
  | "shutdown"
  | "programs"
  | "documents"
  | "display"
  | "wallpaper"
  | "system"
  | "keyboard"
  | "assistant"
  | "warning"
  | "info"
  | "games"
  | "gamesFolder"
  | "fusegame"
  | "doom"
  | "wolf3d"
  | "keen"
  | "duke"
  | "minesweeper"
  | "skifree"
  | "micropolis"
  | "solitaire"
  | "paint"
  | "winamp"
  | "floppy"
  | "drive"
  | "zip"
  | "notepadpp"
  | "textFile"
  | "codeFile"
  | "unknownFile"
  | "fusteam"
  | "recycleFull"
  | "mediaplayer"
  | "video";

type IconVariant = "32x32_4" | "16x16_4";
type IconProps = Omit<SVGProps<SVGSVGElement>, "ref">;
type IconComponent = ComponentType<IconProps & { variant?: IconVariant }>;

/** Adapts icons that ship in a single size so they can be requested at any size. */
function fixed<V extends IconVariant>(
  Icon: ComponentType<IconProps & { variant?: V }>,
  variant: V,
): IconComponent {
  return function FixedIcon({
    variant: _requested,
    ...rest
  }: IconProps & { variant?: IconVariant }) {
    return <Icon variant={variant} {...rest} />;
  };
}

const ICONS: Record<IconName, IconComponent> = {
  computer: Computer,
  network: Network,
  recycle: RecycleEmpty,
  folder: Folder,
  folderOpen: FolderOpen,
  file: FileText,
  image: Mspaint,
  audio: CdMusic,
  explorer: WindowsExplorer,
  settings: Settings,
  find: ComputerFind,
  help: HelpBook,
  // Start > Run...: the window with the hourglass, as the Windows 95 Start menu draws it.
  run: Shell3225,
  shutdown: Computer,
  programs: FolderExe,
  documents: FolderFile,
  display: Desk100,
  wallpaper: CurvesAndColors100,
  system: Computer,
  keyboard: fixed(KeyboardMouse, "32x32_4"),
  assistant: User,
  warning: fixed(Warning, "32x32_4"),
  info: fixed(InfoBubble, "32x32_4"),
  games: Joy102,
  gamesFolder: Joy102,
  fusegame: Joy102,
  doom: Lights100,
  wolf3d: fixed(Progman33, "32x32_4"),
  keen: Jgdwmie101,
  duke: fixed(Progman22, "32x32_4"),
  minesweeper: Winmine1,
  skifree: Shell3242,
  micropolis: fixed(Wab321016, "32x32_4"),
  solitaire: Sol1,
  paint: Mspaint,
  winamp: WinampLogo,
  floppy: Shell326,
  drive: Shell328,
  zip: fixed(Packager, "32x32_4"),
  notepadpp: Notepad2,
  textFile: Shell323,
  codeFile: Shell322,
  unknownFile: Shell321,
  fusteam: FusteamLogo,
  recycleFull: RecycleFull,
  mediaplayer: Mplayer10,
  video: Mplayer11,
};

export type Win98IconProps = {
  name: IconName;
  size?: 16 | 32;
  className?: string;
};

/** A bitmap icon served by the site: a 64x64 image shown at 32px, and a 32x32 one (`smallSrc`) shown at 16px. */
export type ImageIcon = { kind: "image"; src: string; smallSrc: string };

/** Anything the desktop, Start menu, a title bar or the taskbar can show as an icon. */
export type IconRef = IconName | ImageIcon;

export type AppIconProps = {
  icon: IconRef;
  size?: 16 | 32;
  className?: string;
};

/** Draws an `IconRef`: a named icon from the set, or a bitmap at its native size for the slot. */
export function AppIcon({ icon, size = 16, className }: AppIconProps) {
  if (typeof icon === "string")
    return <Win98Icon name={icon} size={size} className={className} />;
  return (
    <img
      src={size === 32 ? icon.src : icon.smallSrc}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      data-icon="image"
      className={className}
      style={{ flexShrink: 0 }}
    />
  );
}

export function Win98Icon({ name, size = 16, className }: Win98IconProps) {
  const Icon = ICONS[name];
  return (
    <Icon
      variant={size === 32 ? "32x32_4" : "16x16_4"}
      width={size}
      height={size}
      className={className}
      aria-hidden
      data-icon={name}
    />
  );
}
