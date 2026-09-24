import "./entrance.css";

interface EntranceOptions {
  main: HTMLElement;
  start: HTMLButtonElement;
  status: HTMLElement;
  retry: HTMLElement;
  name: HTMLInputElement;
  code: HTMLInputElement;
  join: HTMLButtonElement;
  radio: HTMLElement;
  atmosphere: HTMLInputElement;
  touch: HTMLInputElement;
  fresh(): void;
}

/** Reuses the room controls and their handlers; no second room or settings state. */
export function createEntrance(o: EntranceOptions) {
  const root = document.createElement("section");
  root.id = "entrance";
  root.setAttribute("aria-label", "Hook Havok main menu");
  root.innerHTML = `<img class="entrance-art" alt="" aria-hidden="true"><div class="entrance-shade"></div><div class="entrance-motes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <a class="entrance-home">← Back to the party</a>
    <div class="entrance-content"><p class="entrance-kicker">THE LANTERN BELFRY</p><h1><span>Hook</span><span>Havok</span></h1><p class="entrance-tagline">Find your foothold.<br>Take theirs.</p><p class="entrance-description">A moonlit arena. A hook in your hand.<br>Bring up to four friends—or explore on your own.</p>
    <div data-slot="name"></div><nav class="entrance-actions" aria-label="Play"><div data-slot="start"></div><button id="menu-join" type="button">Join room <span aria-hidden="true">↗</span></button><div class="entrance-secondary"><button id="menu-help" type="button">How to play</button><button id="menu-settings" type="button">Settings</button></div></nav>
    <div class="entrance-status" data-slot="status"></div><div data-slot="retry"></div><button id="menu-fresh" type="button" hidden>Create a different room</button>
    <p class="entrance-art-status" role="status"></p><button id="retry-entrance-art" type="button" hidden>Retry illustration</button></div>
    <p class="entrance-footer">JUMP <b>✦</b> HOOK <b>✦</b> OUTPLAY <span>1–5 KEEPERS</span></p>
    <dialog id="entrance-join" aria-labelledby="join-title"><button class="dialog-close" type="button" aria-label="Close join room">×</button><p class="entrance-kicker">ANOTHER LIGHT IN THE BELFRY</p><h2 id="join-title">Join your friends</h2><p>Enter the code your friend shared.</p><form id="menu-join-form"><div data-slot="code"></div><div data-slot="join"></div></form><p class="join-error" role="alert"></p></dialog>
    <dialog id="entrance-help" aria-labelledby="help-title"><button class="dialog-close" type="button" aria-label="Close how to play">×</button><p class="entrance-kicker">A KEEPER'S FIELD GUIDE</p><h2 id="help-title">Keep your footing.</h2><dl><dt>Move & jump</dt><dd>A / D or arrows to run. Space to jump through ledges; hold for height. S / ↓ drops through one ledge.</dd><dt>Hook & swing</dt><dd>Aim with the mouse. Hold left click to fire and pull toward stone. Release to let go; release before firing again.</dd><dt>Bring a little havoc</dt><dd>Hook rivals to knock them back. Try free play, last keeper standing, or timed hook scoring once inside.</dd><dt>On a phone</dt><dd>Enable Touch controls in Settings. Left pad: move, up to jump, down to drop. Right pad: drag to aim and hook, release to let go.</dd><dt>Try the glowing orbs</dt><dd>Choose a ball experiment inside the room. Hooks split orbs into smaller ones. In this trial balls do not hurt keepers.</dd></dl><p class="entrance-note">Create a room to explore solo, then share its invite whenever you're ready for company.</p></dialog>
    <dialog id="entrance-settings" aria-labelledby="settings-title"><button class="dialog-close" type="button" aria-label="Close settings">×</button><p class="entrance-kicker">SET THE MOOD</p><h2 id="settings-title">Settings</h2><div data-slot="atmosphere"></div><div data-slot="touch"></div><div data-slot="radio"></div><p class="entrance-note">Reduced motion follows your device preference. Music starts only when you press Play radio. These controls also remain available inside the room.</p></dialog>`;
  document.body.prepend(root);
  root.querySelector<HTMLAnchorElement>(".entrance-home")!.href =
    import.meta.env.BASE_URL +
    (new URLSearchParams(location.search).has("mute") ? "?mute" : "");
  const placements = Object.entries({
    start: o.start,
    status: o.status,
    retry: o.retry,
    name: o.name.closest("label")!,
    code: o.code.closest("label")!,
    join: o.join,
    atmosphere: o.atmosphere.closest("label")!,
    touch: o.touch.closest("label")!,
    radio: o.radio,
  }).map(([slot, node]) => {
    const marker = document.createComment(`entrance-${slot}`);
    node.before(marker);
    return { node, marker, slot: root.querySelector(`[data-slot="${slot}"]`)! };
  });
  const dialogs = [...root.querySelectorAll<HTMLDialogElement>("dialog")];
  const close = () => dialogs.forEach((d) => d.close());
  for (const kind of ["join", "help", "settings"]) {
    const dialog = root.querySelector<HTMLDialogElement>(`#entrance-${kind}`)!;
    root.querySelector<HTMLButtonElement>(`#menu-${kind}`)!.onclick = () => {
      dialog.showModal();
      if (kind === "join") o.code.focus();
    };
    dialog.querySelector<HTMLButtonElement>(".dialog-close")!.onclick = () =>
      dialog.close();
  }
  o.join.type = "button";
  root.querySelector<HTMLFormElement>("#menu-join-form")!.onsubmit = (e) => {
    e.preventDefault();
    o.join.click();
  };
  root.querySelector<HTMLButtonElement>("#menu-fresh")!.onclick = o.fresh;
  const illustration = root.querySelector<HTMLImageElement>(".entrance-art")!;
  const artStatus = root.querySelector<HTMLElement>(".entrance-art-status")!;
  const artRetry = root.querySelector<HTMLButtonElement>(
    "#retry-entrance-art",
  )!;
  const artUrl = new URL(
    "../../art-source/backgrounds/entrance-source.png",
    import.meta.url,
  ).href;
  const loadArt = () => {
    artRetry.hidden = true;
    artStatus.textContent = "Lighting the entrance…";
    illustration.src = artUrl;
  };
  illustration.onload = () => {
    artStatus.textContent = "";
    root.dataset.art = "ready";
  };
  illustration.onerror = () => {
    artStatus.textContent =
      "The entrance painting could not load. You can still enter a room.";
    artRetry.hidden = false;
    root.dataset.art = "error";
  };
  artRetry.onclick = loadArt;
  const atmosphere = () =>
    root.classList.toggle("quiet-entrance", !o.atmosphere.checked);
  o.atmosphere.addEventListener("change", atmosphere);
  atmosphere();
  loadArt();
  function show() {
    root.hidden = false;
    root.setAttribute("role", "main");
    o.main.inert = true;
    o.main.setAttribute("aria-hidden", "true");
    document.body.classList.add("at-entrance");
    placements.forEach((p) => p.slot.append(p.node));
  }
  show();
  return {
    show,
    busy(busy: boolean, graphicsReady: boolean) {
      close();
      for (const button of [
        o.start,
        o.join,
        root.querySelector<HTMLButtonElement>("#menu-join")!,
        root.querySelector<HTMLButtonElement>("#menu-fresh")!,
      ])
        button.disabled = busy || !graphicsReady;
      o.name.disabled = o.code.disabled = busy;
      root.setAttribute("aria-busy", String(busy));
      root.querySelector<HTMLElement>("#menu-fresh")!.hidden =
        o.status.dataset.state !== "error";
    },
    joinError(message: string) {
      root.querySelector<HTMLElement>(".join-error")!.textContent = message;
    },
    play() {
      if (root.hidden) return;
      close();
      placements.forEach((p) => p.marker.after(p.node));
      root.hidden = true;
      root.removeAttribute("role");
      o.main.inert = false;
      o.main.removeAttribute("aria-hidden");
      document.body.classList.remove("at-entrance");
      o.name.disabled = o.code.disabled = false;
      window.dispatchEvent(new Event("resize"));
      document.getElementById("scene")?.focus({ preventScroll: true });
    },
    destroy() {
      close();
      o.atmosphere.removeEventListener("change", atmosphere);
      root.remove();
    },
  };
}
