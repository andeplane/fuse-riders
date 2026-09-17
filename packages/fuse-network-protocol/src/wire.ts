/** `welcome.protocol`: a client that reads another value must reload rather than guess at the frames. */
export const ROOM_PROTOCOL_VERSION=2;
/** Room socket close codes the client acts on. Anything else is a transient drop and is retried. */
export const CLOSE_AUTHORITY_REPLACED=4001;
export const CLOSE_ROOM_ENDED=4004;
