import type { ReactNode } from "react";

import { useSystem32Title } from "../system32/System32Provider";
import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";

export type WindowChromeProps = {
  title: string;
  icon: IconName;
  active: boolean;
  maximized: boolean;
  resizable?: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  onActivate: () => void;
  children: ReactNode;
};

/** Win98 window frame: title bar with controls and a body that fills the frame. */
export function WindowChrome({
  title,
  icon,
  active,
  maximized,
  resizable = true,
  onMinimize,
  onToggleMaximize,
  onClose,
  onActivate,
  children,
}: WindowChromeProps) {
  // Misspelt while the OS folds (system32/); the plain title otherwise.
  const shownTitle = useSystem32Title(title);
  return (
    <section
      role="dialog"
      aria-label={title}
      className="window flex h-full w-full flex-col"
      data-active={active ? "true" : "false"}
      onMouseDown={onActivate}
    >
      <header
        className={`title-bar shrink-0 ${active ? "" : "inactive"}`}
        onDoubleClick={resizable ? onToggleMaximize : undefined}
      >
        <div className="title-bar-text flex items-center gap-1 overflow-hidden whitespace-nowrap">
          <Win98Icon name={icon} />
          <span className="truncate">{shownTitle}</span>
        </div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Minimize" onClick={onMinimize} />
          {resizable ? (
            <button
              type="button"
              aria-label={maximized ? "Restore" : "Maximize"}
              onClick={onToggleMaximize}
            />
          ) : null}
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
