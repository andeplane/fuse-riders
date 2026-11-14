import type { ControlPanelApplet } from "../state/appState";
import { Win98Icon } from "../ui/icons";

import { APPLETS } from "./applets";
import { useControlPanelViewModel } from "./useControlPanelViewModel";

function Home({
  openApplet,
}: {
  openApplet: (applet: ControlPanelApplet) => void;
}) {
  return (
    <ul
      className="flex flex-wrap gap-2 bg-white p-3 sunken-panel"
      role="listbox"
      aria-label="Control Panel applets"
    >
      {APPLETS.map((applet) => (
        <li
          key={applet.applet}
          role="option"
          aria-selected={false}
          className="flex w-24 flex-col items-center gap-1 text-center"
          title={applet.description}
        >
          <button
            type="button"
            className="flat flex flex-col items-center gap-1"
            style={{ minWidth: 0 }}
            onClick={() => openApplet(applet.applet)}
          >
            <Win98Icon name={applet.icon} size={32} />
            <span>{applet.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ControlPanelWindow({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  const active = APPLETS.find((applet) => applet.applet === vm.applet);
  return (
    <div className="window-body flex min-h-0 flex-1 flex-col gap-3">
      <menu role="tablist" aria-label="Control Panel sections">
        <li role="presentation" aria-selected={vm.applet === "home"}>
          <a
            href="#"
            role="tab"
            aria-selected={vm.applet === "home"}
            onClick={(event) => {
              event.preventDefault();
              vm.openApplet("home");
            }}
          >
            Control Panel
          </a>
        </li>
        {APPLETS.map((applet) => (
          <li
            key={applet.applet}
            role="presentation"
            aria-selected={vm.applet === applet.applet}
          >
            <a
              href="#"
              role="tab"
              aria-selected={vm.applet === applet.applet}
              onClick={(event) => {
                event.preventDefault();
                vm.openApplet(applet.applet);
              }}
            >
              {applet.label}
            </a>
          </li>
        ))}
      </menu>
      <div className="window min-h-0 flex-1 overflow-auto p-3" role="tabpanel">
        {active ? (
          <active.Component windowId={windowId} />
        ) : (
          <Home openApplet={vm.openApplet} />
        )}
      </div>
      <div className="flex shrink-0 justify-end">
        <button type="button" onClick={vm.close}>
          Close
        </button>
      </div>
    </div>
  );
}
