import { OS_NAME } from "../desktop/windowMeta";
import { Win98Icon } from "../ui/icons";
import { useWindowCommands } from "../windows/useWindowCommands";

export const MADE_BY = "Anders Hafreager";

/** The Windows 98 "About" sheet, text only for now: the version, credits and licence lines are Phase B's (B1). */
export function AboutDialog({ windowId }: { windowId: string }) {
  const commands = useWindowCommands();
  const year = new Date().getFullYear();

  return (
    <div className="window-body flex flex-col gap-2" style={{ width: 420 }}>
      <div className="flex gap-3">
        <Win98Icon name="computer" size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-base font-bold">{OS_NAME}</p>
          <p>Copyright &copy; {year} {MADE_BY}</p>
          <p>
            A Windows 95 desktop for the Fuse games: every game on the desktop
            opens in a window of its own, and the retro games under Start,
            Programs, Games come along for the ride.
          </p>
          <hr
            className="my-1 w-full border-0 border-t border-[grey]"
            style={{ borderBottom: "1px solid #fff" }}
          />
          <p>
            Built on 98.css, react95 icons, Webamp, js-dos and clippyjs. The
            shareware games belong to their publishers.
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="default"
          onClick={() => commands.close(windowId)}
          autoFocus
        >
          OK
        </button>
      </div>
    </div>
  );
}
