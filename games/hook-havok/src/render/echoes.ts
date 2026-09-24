import type Phaser from "phaser";
import type { WorldView } from "../engine/view.js";

/** Two bounded silhouette echoes per keeper; no history or simulation ownership. */
export function createEchoes(scene: Phaser.Scene): Phaser.GameObjects.Image[] {
  return [0, 1].map(() =>
    scene.add.image(0, 0, "actor", "0").setDepth(11).setVisible(false),
  );
}

export function paintEchoes(
  echoes: readonly Phaser.GameObjects.Image[],
  actor: Phaser.GameObjects.Image,
  view: WorldView | undefined,
  reduced: boolean,
): void {
  const speed = view ? Math.hypot(view.vx, view.vy) : 0;
  const visible =
    !!view &&
    actor.visible &&
    actor.alpha > 0.5 &&
    !view.respawn &&
    !view.grounded &&
    !reduced &&
    speed > 420;
  for (const [i, echo] of echoes.entries()) {
    echo.setVisible(visible);
    if (!visible || !view) continue;
    const distance = (Math.min(18, speed * 0.018) * (i + 1)) / 2;
    echo
      .setTexture(actor.texture.key, actor.frame.name)
      .setOrigin(actor.originX, actor.originY)
      .setPosition(
        actor.x - (view.vx / speed) * distance,
        actor.y - (view.vy / speed) * distance,
      )
      .setScale(actor.scaleX, actor.scaleY)
      .setRotation(actor.rotation)
      .setFlipX(actor.flipX)
      .setTint(actor.tintTopLeft)
      .setAlpha(i === 0 ? 0.12 : 0.055);
  }
}
