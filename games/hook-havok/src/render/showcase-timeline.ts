/** Authored presentation keyframes, never gameplay rules or collision physics. */
export const DURATION = 12000;
export const ANCHOR = { x: 880, y: 358 } as const;
export const PLATFORMS = [
  [120, 810, 400, 40],
  [220, 670, 220, 28],
  [570, 610, 240, 28],
  [250, 470, 230, 28],
  [950, 480, 250, 28],
  [620, 330, 260, 28],
  [1170, 270, 250, 28],
  [670, 120, 300, 28],
] as const;
export interface ShowcasePose {
  x: number;
  feet: number;
  frame: number;
  scaleY: number;
  alpha: number;
  hook: { x: number; y: number; attached: boolean } | null;
  landing: number;
  spark: number;
  label: string;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
export function idleBreath(ms: number): number {
  return 1 + Math.sin((ms * Math.PI * 2) / 3000) * 0.009;
}
export function showcasePose(time: number, idleOnly = false): ShowcasePose {
  const t = ((time % DURATION) + DURATION) % DURATION;
  const pose: ShowcasePose = {
    x: 310,
    feet: 810,
    frame: 0,
    scaleY: idleBreath(t),
    alpha: 1,
    hook: null,
    landing: 0,
    spark: 0,
    label: "Breathe · feet planted",
  };
  if (idleOnly) return pose;
  pose.alpha = Math.min(1, t / 350, (DURATION - t) / 500);
  if (t < 1800) return pose;
  pose.scaleY = 1;
  if (t < 3000) {
    pose.x = mix(310, 460, (t - 1800) / 1200);
    pose.frame = 1 + (Math.floor((t - 1800) / 125) % 4);
    pose.label = "Run · silhouette and cadence";
  } else if (t < 4100) {
    const p = (t - 3000) / 1100;
    pose.x = mix(460, 670, p);
    pose.feet = mix(810, 610, p) - Math.sin(p * Math.PI) * 105;
    pose.frame = p < 0.6 ? 5 : 6;
    pose.label = "Jump · authored presentation arc";
  } else if (t < 5300) {
    pose.x = 670;
    pose.feet = 610;
    pose.landing = Math.max(0, 1 - (t - 4100) / 350);
    pose.scaleY = 1 - pose.landing * 0.08;
    pose.label = "Land · settle and aim";
  } else if (t < 5900) {
    const p = Math.min(1, (t - 5300) / 350);
    pose.x = 670;
    pose.feet = 610;
    pose.hook = {
      x: mix(690, ANCHOR.x, p),
      y: mix(568, ANCHOR.y, p),
      attached: p === 1,
    };
    pose.frame = 7;
    pose.spark = t >= 5650 ? Math.max(0, 1 - (t - 5650) / 250) : 0;
    pose.label = p < 1 ? "Fire · follow the hook" : "Attach · brass on stone";
  } else if (t < 7500) {
    const p = ease((t - 5900) / 1600);
    // An authored path around the ledge's outer edge, not through the platform.
    if (p < 0.65) {
      const arc = ease(p / 0.65);
      pose.x = mix(670, 940, arc);
      pose.feet = mix(610, 460, arc);
    } else {
      pose.x = 940;
      pose.feet = mix(460, 280, ease((p - 0.65) / 0.35));
    }
    pose.frame = 8;
    pose.hook = { ...ANCHOR, attached: true };
    pose.label = "Pull · tension and momentum";
  } else if (t < 8600) {
    const p = (t - 7500) / 1100;
    pose.x = mix(940, 790, p);
    pose.feet = mix(280, 330, p) - Math.sin(p * Math.PI) * 65;
    pose.frame = p < 0.4 ? 5 : 6;
    pose.label = "Release · drift into the landing";
  } else {
    pose.x = 790;
    pose.feet = 330;
    pose.landing = Math.max(0, 1 - (t - 8600) / 350);
    pose.scaleY = pose.landing > 0 ? 1 - pose.landing * 0.08 : idleBreath(t);
    pose.label = "Rest · the next ledge can wait";
  }
  return pose;
}
