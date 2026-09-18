# fuse-network-protocol

The wire contract `fuse-network-fe` and `fuse-network-be` share: room code format, game ids, authority lease rules and
clock, default STUN servers, the room protocol version and socket close codes. Both packages re-export what an
application needs; depend on them, not on this.
