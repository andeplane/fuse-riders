# Consistent team artwork and shadows

WebKit ignored CSS `hue-rotate()` and `brightness()` functions applied to SVG
groups: enemy buildings remained blue and projected shadows retained colored
sprite detail. Native SVG `feColorMatrix` filters now apply the same team hue
angles in sRGB and remove shadow RGB while preserving alpha. HTML portraits
retain their existing CSS filters. Placement and construction reuse board art.

Chromium and WebKit render the real rules-9 command recording (verified hash
`67aef741`) with red enemy artwork and black shadows, without visible clipping.
The two combat images are diagnostic replay views. `webkit-normal-flow.png`
comes from the real New game → Player vs AI → Start flow; both browsers load the
artwork there without page errors.

The 1,748-test repository suite passes after the rendering change. The subsequently
separated native-filter regression and nine other presentation tests pass, as do
typecheck, focused lint and production build. Independent review found no
blocking findings. These checks do not establish physical-device or human visual
acceptance.
