// Native browser zoom must not capture simultaneous steering/bomb touches.
if (location.pathname.startsWith('/controller')) {
  document.documentElement.style.touchAction = 'none';
  document.documentElement.style.overscrollBehavior = 'none';
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
  const style = document.createElement('style');
  style.textContent = 'input, select, textarea { font-size: max(16px, 1em) !important; }';
  document.head.append(style);
}
