import { CdMusic } from "@react95/icons/CdMusic";
import { Computer } from "@react95/icons/Computer";
import { ComputerFind } from "@react95/icons/ComputerFind";
import { CurvesAndColors100 } from "@react95/icons/CurvesAndColors100";
import { Desk100 } from "@react95/icons/Desk100";
import { Dialmon200 } from "@react95/icons/Dialmon200";
import { Explorer100 } from "@react95/icons/Explorer100";
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
import { Mmsys110 } from "@react95/icons/Mmsys110";
import { Mspaint } from "@react95/icons/Mspaint";
import { Network } from "@react95/icons/Network";
import { Progman22 } from "@react95/icons/Progman22";
import { Progman33 } from "@react95/icons/Progman33";
import { RecycleEmpty } from "@react95/icons/RecycleEmpty";
import { Settings } from "@react95/icons/Settings";
import { Shell3242 } from "@react95/icons/Shell3242";
import { Sol1 } from "@react95/icons/Sol1";
import { User } from "@react95/icons/User";
import { Wab321016 } from "@react95/icons/Wab321016";
import { Warning } from "@react95/icons/Warning";
import { WindowsExplorer } from "@react95/icons/WindowsExplorer";
import { Winmine1 } from "@react95/icons/Winmine1";
import type { ComponentType, SVGProps } from "react";

import { WinampLogo } from "../assets/WinampLogo";

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
  | "sounds"
  | "dialup";

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
  run: Explorer100,
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
  sounds: Mmsys110,
  dialup: fixed(Dialmon200, "32x32_4"),
};

export type Win98IconProps = {
  name: IconName;
  size?: 16 | 32;
  className?: string;
};

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
