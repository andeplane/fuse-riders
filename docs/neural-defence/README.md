# Neural Defence

Neural Defence is a real-time territory RTS: grow a connected network from a brain, mine **Biomass** and **Insight**, research, and direct a fixed pool of attack particles. The first skirmish version is under review in [PR #409](https://github.com/andeplane/fuse-riders/pull/409). It is available in the local preview; it has not been merged or deployed.

Choose **New game → Player vs AI → Start** for the 24 × 20 Synaptic Reach arena. The AI builds, researches and routes particles through ordinary commands, with the same resources and travel rules as you. Destroy its brain to win; losing your brain ends the match. The result offers Play again and Menu. The open sandbox and scripted combat lab remain available. Online multiplayer UI and audio are not part of this version.

Each player has one builder and 128 reusable attack particles. Build neurons to expand the network and claim adjacent deposits. Disconnected structures stop mining and firing. Three towers offer different roles:

- **Pulse:** sturdy, strong firepower at medium range.
- **Siege:** longer reach, but costly, fragile and slower between volleys.
- **Relay:** cheaper, quicker construction and frequent smaller volleys.

Select your brain and press **D / Particles** to choose Pulse, Heavy or Swift profiles. Heavy hits harder but travels and recovers slowly; Swift reinforces and recovers quickly but deals less damage per shot. The choice applies when a particle returns to or departs from the brain; existing frontline and in-flight profiles do not change instantly. Research Growth, Excitation and Conduction, then Ballistics or Resonance to unlock specialist towers and profiles. Exact costs, requirements and timing live in the [engine catalog](../../games/neural-defence/src/engine/catalog.ts).

The full-width battlefield sits between a thin resource bar and a compact bottom command dock. The six command slots mirror **Q W E / A S D**. Build, Research and Particles replace those slots in place; A goes back and D pages larger catalogs. Choose Build → a structure, then click or tap its location. A translucent ghost follows desktop hover; red marks illegal placement. Esc or S cancels placement. Arrow keys move the target and Enter confirms an armed placement.

Select a friendly frontline structure and press **D / Charge** to give it maximum attack-particle priority; press again to clear the order. The slider permits finer allocation. Particles must travel through connected links before that structure can fire automatically at an enemy in range. Strong positions need supply and redundant connections, not just more towers.

Select your brain for **S / Auto expand**. It stays enabled while waiting for biomass, the builder and valid ground. Manual queues take priority. Turning it off finishes the current construction but starts no further automatic jobs.

Clock overlays show construction and research progress. Hover or focus commands for requirements; tap grey commands on phones for the same explanation. Eligibility and missing-research explanations come from the shared rules catalog. Legal queued plans wait for resources or support.

Drag to pan, scroll to zoom, or use one-finger pan and two-finger pinch on phones. There are no Fit map or +/− buttons. Supply orbits, builder/particle journeys, arrival pulses and attack flashes animate presentation only. Reduced motion is available in Settings.

Use `pnpm install --frozen-lockfile` and `pnpm dev` from the repository root, then open the server's printed `/neural-defence/?mute` URL. Vite development uses `/games/neural-defence/?mute`. Add `&debug` for optional instant construction/research; both default off and retain costs and travel. Dev servers choose a free port.

[First-version design and evidence](FIRST_VERSION.md), [command architecture](COMMANDS.md) and [core contracts](CORE_TYPES.md) describe the current implementation. [Phase 0](PHASE_0.md), [gameplay proposal](GAMEPLAY.md), and earlier reviews record the foundation and historical proposals; their one-tower/no-AI limits are superseded. Automated balance assays test specific policies and matchups, not universal competitive balance or physical-phone acceptance.
