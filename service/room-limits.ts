/**
 * Five riders, five spectators and a shared screen beside the creator's own seat, which the room service always keeps:
 * eleven sockets in all. The riders and the watching list are the game's own caps (`MAX_PLAYERS`, `MAX_SPECTATORS`);
 * this is only how many connections the room admits, so a TV display takes the eleventh whether or not anyone watches.
 */
export const ROOM_LIMITS = {
  maxGuests: 10,
  fullMessage: "Room full (five players, five spectators and TV)",
} as const;
