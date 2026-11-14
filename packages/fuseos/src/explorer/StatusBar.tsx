export type StatusBarProps = {
  /** The left field: "12 object(s)", "Reading drive A:...". */
  text: string;
  /** The selected entry's name or size, or a notice (the build's commit is not on GitHub). */
  detail: string;
};

export function StatusBar({ text, detail }: StatusBarProps) {
  return (
    <footer className="status-bar shrink-0">
      <p className="status-bar-field">{text}</p>
      <p className="status-bar-field w-1/2 truncate">{detail}</p>
    </footer>
  );
}
