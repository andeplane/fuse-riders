import { useContext, useEffect, useRef } from "react";

import { GamesDepsContext } from "../gamesDepsContext";

import { CARD_SHEET_PATH, spriteOffset } from "./cardSprite";
import type { Cascade } from "./cascade";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cascadeOrder,
  createCascade,
  stepCascade,
} from "./cascade";
import { foundationPosition } from "./solitaireLayout";
import type { Card } from "./solitaireRules";

export type WinCascadeProps = { foundations: Card[][]; onDone: () => void };

const FALLBACK_WIDTH = 600;
const FALLBACK_HEIGHT = 400;

/**
 * The bouncing cards after a win, painted on a canvas over the table that is
 * never cleared so every card leaves its trail. A click skips it; the frame
 * clock comes from GamesDeps so tests can run it to the end.
 */
export function WinCascade({ foundations, onDone }: WinCascadeProps) {
  const deps = useContext(GamesDepsContext);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const width = canvas.clientWidth || FALLBACK_WIDTH;
    const height = canvas.clientHeight || FALLBACK_HEIGHT;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const sheet = new Image();
    sheet.src = deps.resolveUrl(CARD_SHEET_PATH);
    let cascade: Cascade = createCascade(
      cascadeOrder(
        foundations,
        foundations.map((_, i) => foundationPosition(i)),
      ),
      width,
      height,
    );
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDoneRef.current();
    };
    const unsubscribe = deps.subscribeFrames(() => {
      if (finished) return;
      cascade = stepCascade(cascade, deps.random);
      if (context && sheet.complete && sheet.naturalWidth > 0) {
        cascade.trail.forEach((flying) => {
          const offset = spriteOffset(flying.card);
          context.drawImage(
            sheet,
            offset.x * 2,
            offset.y * 2,
            CARD_WIDTH * 2,
            CARD_HEIGHT * 2,
            Math.round(flying.x),
            Math.round(flying.y),
            CARD_WIDTH,
            CARD_HEIGHT,
          );
        });
      }
      if (cascade.done) finish();
    });
    return () => {
      finished = true;
      unsubscribe();
    };
  }, [deps, foundations]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Winning cascade"
      className="absolute inset-0 block h-full w-full"
      onClick={onDone}
    />
  );
}
