import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';

import { createGameServer } from '../src/server/index.js';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol.js';

class ReviewPeer {
  private readonly messages: ServerMessage[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => this.messages.push(JSON.parse(raw.toString()) as ServerMessage));
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  async take<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex((message) =>
        message.type === type && predicate(message as Extract<ServerMessage, { type: T }>),
      );
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${type}`);
  }

  async barrier(): Promise<void> {
    this.send({ type: 'hostAction', action: 'start' });
    const response = await this.take('error');
    assert.equal(response.code, 'unauthorized');
  }
}

test('a reconnect requires a bomb release before accepting another rising edge', async () => {
  let nonce = 0;
  const app = await createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    lanAddress: '127.0.0.1',
    manualTicks: true,
    dependencies: {
      now: () => 0,
      token: () => (++nonce).toString(16).padStart(48, '0'),
    },
  });
  const peers: ReviewPeer[] = [];
  const connect = async (): Promise<ReviewPeer> => {
    const peer = new ReviewPeer(new WebSocket(`ws://127.0.0.1:${app.port}/ws`));
    peers.push(peer);
    await once(peer.socket, 'open');
    await peer.take('snapshot');
    return peer;
  };

  try {
    const host = await connect();
    host.send({ type: 'hostAuth', token: app.hostToken });
    await host.take('hostAuthenticated');
    const first = await connect();
    first.send({ type: 'join', name: 'A' });
    const joined = await first.take('joined');
    const second = await connect();
    second.send({ type: 'join', name: 'B' });
    await second.take('joined');
    host.send({ type: 'hostAction', action: 'start' });
    await host.take('snapshot', (message) => message.state.phase === 'countdown');
    app.advance(60);

    const replacement = await connect();
    replacement.send({ type: 'join', name: 'A', playerToken: joined.playerToken });
    const rejoined = await replacement.take('joined');
    replacement.send({ type: 'input', seq: rejoined.nextInputSeq, left: false, right: false, bomb: true });
    await replacement.barrier();
    app.advance();
    assert.equal(app.game.bombs.size, 0, 'a held input from before reconnect must not place a bomb');

    replacement.send({ type: 'input', seq: rejoined.nextInputSeq + 1, left: false, right: false, bomb: false });
    replacement.send({ type: 'input', seq: rejoined.nextInputSeq + 2, left: false, right: false, bomb: true });
    await replacement.barrier();
    app.advance();
    assert.equal(app.game.bombs.size, 1, 'release then press rearms bomb placement');
  } finally {
    peers.forEach((peer) => peer.socket.terminate());
    await app.close();
  }
});

test('match rematch resets scope and wins, then round-over automatically starts the next round', async () => {
  let nonce = 100;
  const app = await createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    lanAddress: '127.0.0.1',
    manualTicks: true,
    dependencies: {
      now: () => 0,
      token: () => (++nonce).toString(16).padStart(48, '0'),
    },
  });
  const peers: ReviewPeer[] = [];
  const connect = async (): Promise<ReviewPeer> => {
    const peer = new ReviewPeer(new WebSocket(`ws://127.0.0.1:${app.port}/ws`));
    peers.push(peer);
    await once(peer.socket, 'open');
    await peer.take('snapshot');
    return peer;
  };

  try {
    const host = await connect();
    host.send({ type: 'hostAuth', token: app.hostToken });
    await host.take('hostAuthenticated');
    for (const name of ['A', 'B']) {
      const player = await connect();
      player.send({ type: 'join', name });
      await player.take('joined');
    }
    host.send({ type: 'hostAction', action: 'start' });
    await host.take('snapshot', (message) => message.state.phase === 'countdown');
    app.advance(60);

    const [winner, loser] = [...app.game.players.values()].sort((a, b) => a.slot - b.slot);
    winner!.roundWins = 4;
    winner!.x = 900; winner!.y = 600;
    loser!.x = app.game.boundaryInset + 7.1; loser!.y = 300; loser!.angle = Math.PI;
    app.advance();
    assert.equal(app.game.phase, 'matchOver');
    assert.equal(winner!.roundWins, 5);
    const oldMatchId = app.game.matchId;

    host.send({ type: 'hostAction', action: 'rematch' });
    await host.take('snapshot', (message) => message.matchId !== oldMatchId && message.state.phase === 'countdown');
    assert.notEqual(app.game.matchId, oldMatchId);
    assert.equal(app.game.round, 1);
    assert.ok([...app.game.players.values()].every((player) => player.roundWins === 0));

    app.advance(60);
    const [, nextLoser] = [...app.game.players.values()].sort((a, b) => a.slot - b.slot);
    nextLoser!.x = app.game.boundaryInset + 7.1; nextLoser!.y = 300; nextLoser!.angle = Math.PI;
    app.advance();
    assert.equal(app.game.phase, 'roundOver');
    app.advance(60);
    assert.equal(app.game.phase, 'countdown');
    assert.equal(app.game.round, 2);
  } finally {
    peers.forEach((peer) => peer.socket.terminate());
    await app.close();
  }
});
