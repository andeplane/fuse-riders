import { FuseOsSplash } from "../assets/FuseOsSplash";
import { OS_NAME } from "../desktop/windowMeta";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { Credit } from "./credits";
import { CREDITS } from "./credits";
import { FUSEOS_VERSION } from "./version";

export const MADE_BY = "Anders Hafreager";
export const SOURCE_URL = "https://github.com/andeplane/fuse-games";

function CreditLine({ credit }: { credit: Credit }) {
  const name = credit.url ? (
    <a href={credit.url} target="_blank" rel="noreferrer">
      {credit.name}
    </a>
  ) : (
    <span>{credit.name}</span>
  );
  return (
    <li className="flex flex-col gap-0.5">
      <span>
        <span className="font-bold">{name}</span>
        {credit.by ? <span> by {credit.by}</span> : null}
      </span>
      <span>
        {credit.role} ({credit.licence})
      </span>
    </li>
  );
}

export type AboutDialogProps = {
  windowId: string;
  /** The credits to list; the real list by default, a short one in tests. */
  credits?: readonly Credit[];
};

/** The Windows 98 "About" sheet: the splash, version, copyright and who made what FuseOS runs on. */
export function AboutDialog({ windowId, credits = CREDITS }: AboutDialogProps) {
  const commands = useWindowCommands();
  const year = new Date().getFullYear();

  return (
    <div className="window-body flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex gap-3">
        <div
          className="sunken shrink-0 overflow-hidden bg-black"
          style={{ width: 128, height: 72 }}
        >
          <FuseOsSplash />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-base font-bold">{OS_NAME}</p>
          <p>Version {FUSEOS_VERSION}</p>
          <p>
            Copyright &copy; {year} {MADE_BY}
          </p>
          <p>
            A Windows 98 desktop for the Fuse games: every game opens in a
            window of its own, with Paint, Winamp, Clippy and the retro games
            under Start, Programs along for the ride. Source at{" "}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              github.com/andeplane/fuse-games
            </a>
            .
          </p>
        </div>
      </div>
      <hr
        className="my-1 w-full border-0 border-t border-[grey]"
        style={{ borderBottom: "1px solid #fff" }}
      />
      <p>This product is licensed to:</p>
      <p className="pl-4">Everyone who plays</p>
      <hr
        className="my-1 w-full border-0 border-t border-[grey]"
        style={{ borderBottom: "1px solid #fff" }}
      />
      <p className="font-bold">{OS_NAME} is built on:</p>
      <ul
        className="sunken m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto bg-white p-2"
        style={{ minHeight: 96, maxHeight: 180 }}
        aria-label="Credits"
      >
        {credits.map((credit) => (
          <CreditLine key={credit.name} credit={credit} />
        ))}
      </ul>
      <p>
        The shareware games belong to their publishers; the licence texts are
        under docs/fuseos in the source.
      </p>
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
