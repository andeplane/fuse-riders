import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";

export type StatusBarProps = {
  /** The left panel: "12 object(s)", "1 object(s) selected", "Reading drive A:...". */
  text: string;
  /** The middle panel: the size of the selection, or of the files in the folder. */
  size: string;
  /** The right panel: where the listing comes from, as Windows names the zone ("My Computer"). */
  zone: string;
  zoneIcon: IconName;
};

export function StatusBar({ text, size, zone, zoneIcon }: StatusBarProps) {
  return (
    <footer className="explorer-status" aria-label="Status bar">
      <p className="explorer-status-text">{text}</p>
      <p className="explorer-status-size">{size}</p>
      <p className="explorer-status-zone">
        <Win98Icon name={zoneIcon} />
        <span>{zone}</span>
      </p>
    </footer>
  );
}
