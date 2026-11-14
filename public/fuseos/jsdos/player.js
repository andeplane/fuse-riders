// Starts the js-dos player for the bundle named in the query string, e.g.
// player.html?bundle=doom. The page runs in a same-origin iframe inside a
// desktop window: js-dos ships a global stylesheet and keyboard handling that
// must not leak into the desktop, so it gets a document of its own.
(function () {
  var root = document.getElementById('root');
  var bundle = new URLSearchParams(window.location.search).get('bundle') || '';

  function show(text) {
    var message = document.createElement('p');
    message.id = 'message';
    message.textContent = text;
    root.appendChild(message);
  }

  if (!/^[a-z0-9-]+$/.test(bundle)) {
    show('No game selected.');
    return;
  }
  if (typeof window.Dos !== 'function') {
    show('The DOS emulator did not load.');
    return;
  }

  var here = window.location.href;
  window.Dos(root, {
    url: new URL('../retro/' + bundle + '.jsdos.wasm', here).href,
    pathPrefix: new URL('emulators/', here).href,
    autoStart: true,
    kiosk: true,
    noCloud: true,
    workerThread: true,
    onEvent: function (event, arg) {
      if (event === 'emu-ready' || event === 'ci-ready') return;
      if (event === 'exit') show('The game has exited. Close this window to return to the desktop.');
      if (event === 'error' && arg) show('DOS error: ' + String(arg));
    },
  });
})();
