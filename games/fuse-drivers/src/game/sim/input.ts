/** The one flat input record every controller produces (ADR 002). */
export interface TruckInput {
  left: boolean;
  right: boolean;
  brake: boolean;
  nitro: boolean;
  item: boolean;
  itemAlt: boolean;
}

export const NEUTRAL_INPUT: TruckInput = {
  left: false,
  right: false,
  brake: false,
  nitro: false,
  item: false,
  itemAlt: false,
};
