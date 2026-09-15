// Native browser zoom must not capture steering/bomb touches: a double tap or pinch on any game page
// (phone controller, online room) is input, never zoom. Scrolling is still allowed outside the controller.
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
if (location.pathname.startsWith('/controller')) {
  document.documentElement.style.touchAction = 'none';
  document.documentElement.style.overscrollBehavior = 'none';
  const style = document.createElement('style');
  style.textContent = 'input, select, textarea { font-size: max(16px, 1em) !important; }';
  document.head.append(style);
}
