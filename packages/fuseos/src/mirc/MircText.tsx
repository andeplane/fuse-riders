import type { CSSProperties } from "react";

import { MIRC_PALETTE, parseFormatting } from "./irc/format";
import type { ChatLine, LineKind } from "./irc/session";

/** mIRC's default event colours (Tools > Colours), as palette indices. */
export const KIND_COLORS: Record<LineKind, number> = {
  text: 1,
  own: 1,
  whois: 1,
  motd: 1,
  action: 6,
  notice: 5,
  join: 3,
  part: 3,
  kick: 3,
  mode: 3,
  topic: 3,
  nick: 3,
  invite: 3,
  quit: 2,
  info: 2,
  error: 2,
  ctcp: 4,
};

function color(index: number | undefined, fallback: string): string {
  return index === undefined ? fallback : (MIRC_PALETTE[index] ?? fallback);
}

/** Draws text with its mIRC control codes: bold, underline, italic, reverse and the 16 colours. */
export function MircText({
  text,
  defaultColor,
}: {
  text: string;
  defaultColor: number;
}) {
  const base = MIRC_PALETTE[defaultColor] ?? "#000";
  return (
    <>
      {parseFormatting(text).map((run, index) => {
        let fg = color(run.fg, base);
        let bg =
          run.bg === undefined ? undefined : color(run.bg, "transparent");
        if (run.reverse) [fg, bg] = [bg ?? "#ffffff", fg];
        const style: CSSProperties = { color: fg };
        if (bg) style.backgroundColor = bg;
        if (run.bold) style.fontWeight = 900;
        if (run.italic) style.fontStyle = "italic";
        if (run.underline) style.textDecoration = "underline";
        return (
          <span key={index} style={style}>
            {run.text}
          </span>
        );
      })}
    </>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `[HH:nn]`, mIRC's default timestamp format, in local time. */
export function timestamp(time: number): string {
  const date = new Date(time);
  return `[${pad(date.getHours())}:${pad(date.getMinutes())}]`;
}

export function ChatLineView({
  line,
  timestamps,
}: {
  line: ChatLine;
  timestamps: boolean;
}) {
  const colorIndex =
    line.highlight && line.kind === "text" ? 5 : KIND_COLORS[line.kind];
  const text = timestamps ? `${timestamp(line.time)} ${line.text}` : line.text;
  return (
    <div
      className="mirc-line"
      data-kind={line.kind}
      data-highlight={line.highlight ? "true" : undefined}
    >
      {text.length === 0 ? (
        " "
      ) : (
        <MircText text={text} defaultColor={colorIndex} />
      )}
    </div>
  );
}
