import { AVATAR_ATLAS } from "fuse-ui/assets";

export const pilotFrame = (id: string, slot: number): number => {
  const index = AVATAR_ATLAS.frames.findIndex((frame) => frame === id);
  return index < 0 ? slot % AVATAR_ATLAS.frames.length : index;
};

export const pilotPosition = (id: string, slot: number): string => {
  const frame = pilotFrame(id, slot);
  return `${((frame % AVATAR_ATLAS.columns) * 100) / (AVATAR_ATLAS.columns - 1)}% ${(Math.floor(frame / AVATAR_ATLAS.columns) * 100) / (AVATAR_ATLAS.rows - 1)}%`;
};
