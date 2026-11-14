import type { CSSProperties } from "react";

import { CARD_BACKS } from "./cardBacks";
import { faceStyle } from "./cardSprite";
import { CARD_HEIGHT, CARD_WIDTH } from "./cascade";
import type { Card } from "./solitaireRules";
import { cardName } from "./solitaireRules";

export type CardFaceProps = {
  card: Card;
  sheetUrl: string;
  className?: string;
  style?: CSSProperties;
};

/** A face up card; a plain box so it can sit in a button or a drag ghost. */
export function CardFace({ card, sheetUrl, className, style }: CardFaceProps) {
  return (
    <span
      role="img"
      aria-label={cardName(card)}
      className={`block ${className ?? ""}`}
      style={{ ...faceStyle(card, sheetUrl), ...style }}
    />
  );
}

export type CardBackProps = {
  design: number;
  className?: string;
  style?: CSSProperties;
};

/** A face down card in the chosen design. */
export function CardBack({ design, className, style }: CardBackProps) {
  const back = CARD_BACKS[design] ?? CARD_BACKS[0];
  if (!back) return null;
  return (
    <span
      role="img"
      aria-label="Face down card"
      data-back={back.name}
      className={`block ${className ?? ""}`}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT, ...style }}
    >
      {back.art}
    </span>
  );
}
