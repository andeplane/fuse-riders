# Phaser early disposal regression

CI run 34816971587 failed LAN Chrome with `Cannot read properties of undefined (reading 'sys')`. A diagnostic run with full page-error stacks reproduced:

```
SceneManager.destroy -> Game.runDestroy -> Game.step -> PhaserArena.destroy
```

The permanent browser regression then reproduced the same error deterministically by creating a real arena and immediately disposing it before its asynchronous default textures finished. No browser API patching is used.

Phaser sets `Game.isBooted` before textures become ready. `SceneManager.bootQueue`, triggered by READY, creates `systemScene` later. Our explicit destruction flush used the earlier flag and called SceneManager.destroy before its system scene existed. The fix flushes only when `game.scene.isBooted` is true; otherwise Phaser's normal first frame processes pending destruction after READY. An already disposed arena cannot publish readiness from its scene callback. Root independently reviewed these installed Phaser lifecycle methods and approved the fix before implementation.

Chrome and WebKit both passed the immediate-dispose regression, normal Canvas/WebGL lifecycle, bounded effects/reset, context restoration and operational Canvas fallback. Typecheck passed. The LAN smoke now records complete page-error stacks rather than only messages.

A production artifact built into `/tmp/fuse-phaser-dispose-build` also passed full LAN five-phone Chrome and WebKit smoke using `BUILD_DIRECTORY=/tmp/fuse-phaser-dispose-build npm run test:browser` (plus `BROWSER=webkit` for WebKit). Both isolated servers and browser contexts closed normally.
