# mIRC

Start › Programs › mIRC, the desktop icon, or `?open=mirc` opens an IRC client in the shape of mIRC 6.0x (2002–2003). It has the menu bar (File, Tools, DCC, Commands, Window, Help), the flat 20-button toolbar, the switchbar, MDI child windows (Status, channels with a nicklist, queries, the Channels List), the "mIRC Options" dialog with the server list, the Channels Folder, and the shareware nag with its day counter. Text uses the mIRC colour and formatting codes (Ctrl+K, Ctrl+B, Ctrl+U, Ctrl+R, Ctrl+O).

The networks are simulated. "Connecting" to EFnet, IRCnet, Undernet, DALnet, QuakeNet, Libera.Chat or OFTC opens a pretend server inside the page. The Status window's MOTD says so. The client is still a real IRC client: the simulated server speaks the protocol, and a configured bridge (below) would put the same client on the real networks.

## Code

`packages/fuseos/src/mirc/`:

| Path | What it is |
| --- | --- |
| `irc/message.ts` | RFC 1459 framing with IRCv3 message tags: a parser and a serializer as pure functions, plus CTCP and byte-safe line splitting. Parameters cannot inject CR/LF. |
| `irc/format.ts` | mIRC control codes, the 16-colour palette, and the editbox shortcuts. |
| `irc/session.ts` | The session reducer: windows, nicklists (PREFIX/multi-prefix, mode changes), topics, numerics, WHOIS, LIST, CTCP replies, CAP negotiation, and nick collisions during registration (alternative nick, then underscores, then Guest####). |
| `irc/input.ts` | What the editbox understands: `/join /part /msg /query /me /nick /whois /quit /topic /away /list /op /kick /ctcp /raw ...`. Unknown commands go to the server as typed, as in mIRC. |
| `irc/client.ts` | One connection: transport, registration timeout, keepalive PING, and reconnect with exponential backoff (2 s doubling to 60 s plus jitter, at most 5 attempts). The clock, timers, randomness and transport are injected. |
| `irc/transport.ts` | The `IrcTransport` interface and its WebSocket adapter (IRCv3 `text.ircv3.net`, one line per frame). |
| `sim/simServer.ts` | The simulated server and its transport. |
| `sim/regulars.ts`, `sim/brain.ts`, `sim/useRegularsBrain.ts` | The channel regulars and what they say. |
| `sim/ccbs.ts`, `ddr/ccbsData.ts` | The CCBS tournament results and CCBSbot's queries. |
| `MircWindow.tsx`, `MircChild.tsx`, `MircDialogs.tsx`, `mirc.css` | The UI. |

Tests use `src/__mocks__/ircTransport.ts`: a typed fake transport and a manual scheduler.

## Why the networks are simulated

A web page can open WebSockets but not IRC's TCP connections. Browsers also block ports 6667 and 6697. A page can therefore only reach networks that run a WebSocket listener and accept other sites' pages. We tested each network on 14 November 2026 with a full login and JOIN, sending a foreign `Origin` header:

| Network | WebSocket endpoint | Accepts other sites' clients? |
| --- | --- | --- |
| EFnet | `wss://chat.efnet.org:8443/webirc/websocket/` (its Kiwi gateway) | No. Any Origin other than `https://chat.efnet.org` gets a 403. |
| Libera.Chat | `web.libera.chat` behind Cloudflare | No public endpoint. Libera documents only its own web chats. |
| Undernet | `chat.undernet.org/webirc/websocket/` | No in practice: the server answers `CAPTCHA NEEDED`. |
| OFTC | socket.io gateway | No, because it does not speak IRC over WebSocket. |
| IRCnet, DALnet, QuakeNet, Rizon | qwebirc, which runs on their own servers | No. |
| Snoonet, Ergo main | own web chats | No. Both check Origin. |
| Ergo testnet, UnrealIRCd support | `wss://testnet.ergo.chat/webirc`, `wss://irc.unrealircd.org` | Yes, technically. But the testnet logs all traffic and the other is a support network, so neither suits FuseOS users. |

KiwiIRC's hosted gateway (kiwiirc.com) publishes no permission for third-party clients, so we do not use it either. The owner's rule is to use real IRC only if KiwiIRC explicitly allows third-party clients.

**EFnet:** EFnet stays first in the server list and is the default, as in 2001. There is no public EFnet gateway that a page on fusegames.ai may use.

## #ddrnorway and the regulars

`/join #ddrnorway` is the Norwegian DDR channel of the mid-2000s. The people in it are:

- **RiChY, Andeplane and Zredna**: real members of the scene, voiced by the language model with their consent. Each persona prompt carries their own CCBS record, tells the model to write one short line, and forbids speaking for anyone else or inventing results.
- **Fictional regulars**: stepzilla, FootieFox, and the idlers in the other channels (modem_man, Sunny_D, lurker99, Op_Bot). None of their nicks appears in the CCBS player list.
- **CCBSbot**: answers `!siste`, `!t <tournament>`, `!spiller <nick>`, `!sesonger`, `!vinnere <season>` and `!ccbs` from the bundled results.

Every other real nick, the other players in the results, is citation-only. Those nicks appear only in CCBSbot's quoted results, never as channel members or speakers.

The regulars think with the shared FuseOS model: Clippy's choice in Control Panel › Office Assistant, loaded through `LlmDepsContext` and `createWebLlmChatEngine`. The model is used only when the browser has WebGPU and either it is already downloaded or the user ticks Tools › Smart regulars, which names the download size. Otherwise, and whenever the model fails or answers nothing usable, the regulars use canned lines. Only one reply is generated at a time. Idle chatter always uses canned lines, so the GPU stays quiet.

**Data:** `ddr/ccbsData.ts` was generated on 14 November 2026 from ccbs.sesse.net: `tournaments.pl` and each `show-tournament.pl?id=N`. It holds each tournament's name, season, venue, date, machine and top eight. The 55 tournaments run from 2002 to 2012, and 42 of them have rankings. Test events are left out. The site states no licence. The results are factual records, credited to their source in the code, in this document and in CCBSbot's `!ccbs` reply. Ask the site's maintainer before republishing more than this.

## Privacy

Nothing typed in mIRC leaves the page. The simulated server, the regulars and the model all run in the browser, and no nick or message goes to analytics. The settings (nick, alternative nick, real name, e-mail, favourite channels, timestamps, smart regulars, first-run date for the nag) live in `localStorage` under `fuseos.mirc`.

## Proposal: a WebSocket↔IRC bridge (not built)

Reaching the real networks needs a relay. AGENTS.md forbids adding a relay or a paid service without the owner's decision, so this section is a design only.

- **What:** a small stateless service that accepts a WebSocket from fusegames.ai and dials one IRC server over TLS, relaying lines both ways. It needs no storage. kiwiirc/webircgateway (Go, Apache-2.0) already does this; its config has an allow-list of upstream networks and allowed Origins.
- **Where:** a Cloud Run service next to the room service. Concurrency would be about 80 sockets per instance with min-instances 0. Cloud Run bills each WebSocket as an open request, so an idle connection costs money. A connection cap and a 30-minute idle timeout bound the bill.
- **Upstreams:** an allow-list of the networks in the server list. EFnet would see the bridge's IP for every user unless the bridge gets a WEBIRC password from EFnet staff. Without one, per-IP connection limits would throttle everyone together. Ask EFnet, and Libera if wanted, before launch.
- **Abuse:** check Origin to accept only fusegames.ai. Rate-limit per client IP. Allow no DCC and keep no logs of message content.
- **Client:** already done. Set `VITE_IRC_BRIDGE_URL=wss://…` at build time, and `connectUrl` sends `?network=<id>` to the bridge instead of the simulation. The bridge maps the id to a server on its allow-list.

Effort: about half a day of agent work to deploy webircgateway with that config and wire the variable into CD. What gates it is the owner's decision on cost, abuse handling and asking networks for WEBIRC.
