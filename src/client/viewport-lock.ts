// Native browser zoom must not capture simultaneous steering/bomb touches, and iOS ignores user-scalable=no.
// A zoomed-in online page is a trap: the mobile-play controls (touch-action: none) cover the screen, so the
// pinch back out never reaches Safari. Block pinch/double-tap zoom on every page; pan-x pan-y keeps touch
// scrolling for the roster and dialogs, while the controller (no scrolling) locks everything.
const controller = location.pathname.startsWith('/controller');
document.documentElement.style.touchAction = controller ? 'none' : 'pan-x pan-y';
const prevent = (event: Event) => { if (event.cancelable) event.preventDefault(); };
for (const name of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
  document.addEventListener(name, prevent, { passive: false });
}
document.addEventListener('touchmove', (event) => {
  if (event.touches.length > 1) prevent(event);
}, { passive: false });
document.addEventListener('wheel', (event) => {
  if (event.ctrlKey) prevent(event);
}, { passive: false });
if (controller) {
  document.documentElement.style.overscrollBehavior = 'none';
  const style = document.createElement('style');
  style.textContent = 'input, select, textarea { font-size: max(16px, 1em) !important; }';
  document.head.append(style);
}
