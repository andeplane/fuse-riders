// Native browser zoom must not capture steering/bomb touches on an online game page.
// The root's touch-action blocks Safari's double-tap zoom too, which a prevented dblclick alone does not; a page
// zoomed in under the mobile-play controls (touch-action: none) has no pinch back out.
document.documentElement.style.touchAction = "pan-x pan-y";
const prevent = (event: Event) => {
  if (event.cancelable) event.preventDefault();
};
for (const name of [
  "gesturestart",
  "gesturechange",
  "gestureend",
  "dblclick",
]) {
  document.addEventListener(name, prevent, { passive: false });
}
document.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length > 1) prevent(event);
  },
  { passive: false },
);
document.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) prevent(event);
  },
  { passive: false },
);
