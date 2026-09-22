// Presentation-only asset study. It has no authoritative game state or physics.
const $ = (id) => document.getElementById(id);
const arena = $("arena").getContext("2d");
const detail = $("detail").getContext("2d");
const platforms = [
  [120, 810, 400, 40],
  [220, 670, 220, 28],
  [570, 610, 240, 28],
  [250, 470, 230, 28],
  [950, 480, 250, 28],
  [620, 330, 260, 28],
  [1170, 270, 250, 28],
  [670, 120, 300, 28],
];
let assets,
  frames,
  ledgeBounds,
  maxHeight,
  animationId = 0,
  elapsed = 0,
  last = 0;
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let loading = false;
$("pause").textContent = paused ? "Play" : "Pause";

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => {
      image.onload = image.onerror = null;
      reject(new Error(`Timed out loading ${path}`));
    }, 15000);
    image.onload = () => {
      clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`Could not load ${path}`));
    };
    image.src = new URL(path, import.meta.url).href;
  });
}

// Inspect alpha without modifying source pixels. A fixed grid separates poses.
function bounds(image, columns = 1, rows = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const result = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const left = Math.floor((col * image.width) / columns),
        right = Math.floor(((col + 1) * image.width) / columns);
      const top = Math.floor((row * image.height) / rows),
        bottom = Math.floor(((row + 1) * image.height) / rows);
      let x0 = right,
        y0 = bottom,
        x1 = left,
        y1 = top;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          if (pixels[(y * image.width + x) * 4 + 3] > 32) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      if (x0 > x1 || y0 > y1) throw new Error("An artwork frame is empty.");
      if (
        columns > 1 &&
        (x0 <= left || x1 >= right - 1 || y0 <= top || y1 >= bottom - 1)
      )
        throw new Error(
          "A pose crosses its frame boundary; asset cleanup is required.",
        );
      result.push({
        x: x0,
        y: y0,
        width: x1 - x0 + 1,
        height: y1 - y0 + 1,
        pivotX: (left + right) / 2,
        baseline: y1 + 1,
      });
    }
  return result;
}

function actor(context, frame, x, baseline, height) {
  const scale = height / maxHeight;
  context.drawImage(
    assets.sheet,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    x + (frame.x - frame.pivotX) * scale,
    baseline - frame.height * scale,
    frame.width * scale,
    frame.height * scale,
  );
  if ($("guides").checked) {
    context.strokeStyle = "#efc578";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x - height, baseline);
    context.lineTo(x + height, baseline);
    context.moveTo(x, baseline - height - 10);
    context.lineTo(x, baseline + 5);
    context.stroke();
  }
}

function paint() {
  if (!assets) return;
  const isRun = $("motion").value === "run";
  const sequence = isRun ? [2, 3, 4, 5] : [0, 1];
  const fps = Number($("fps").value);
  const frameIndex =
    sequence[Math.floor((elapsed * fps) / 1000) % sequence.length];
  const frame = frames[frameIndex];
  arena.clearRect(0, 0, 1600, 900);
  arena.drawImage(assets.background, 0, 0, 1600, 900);
  arena.fillStyle = "#12162626";
  arena.fillRect(0, 0, 1600, 900);
  for (const [x, y, width, height] of platforms) {
    const b = ledgeBounds;
    arena.drawImage(
      assets.ledge,
      b.x,
      b.y,
      b.width,
      b.height,
      x,
      y,
      width,
      height * 2.3,
    );
    if ($("guides").checked) {
      arena.strokeStyle = "#efc578";
      arena.strokeRect(x, y, width, height);
    }
  }
  actor(arena, frame, 310, 810, Number($("size").value));
  detail.clearRect(0, 0, 384, 256);
  actor(detail, frame, 192, 226, 180);
  $("arena").dataset.frame = String(frameIndex);
}

function tick(now) {
  if (!paused && !document.hidden && last) elapsed += Math.min(now - last, 100);
  last = now;
  paint();
  animationId = requestAnimationFrame(tick);
}

async function start() {
  if (loading) return;
  loading = true;
  $("retry").hidden = true;
  $("status").textContent = "Loading artwork…";
  try {
    const [background, sheet, ledge] = await Promise.all([
      loadImage("../art-source/backgrounds/belfry-background-source.png"),
      loadImage("../art-source/character/lantern-keeper-six-pose-source.png"),
      loadImage("../art-source/platforms/belfry-ledge-source.png"),
    ]);
    frames = bounds(sheet, 3, 2);
    ledgeBounds = bounds(ledge)[0];
    maxHeight = Math.max(...frames.map((frame) => frame.height));
    assets = { background, sheet, ledge };
    const labels = [
      "Idle A",
      "Idle B",
      "Run contact A",
      "Run passing A",
      "Run contact B",
      "Run passing B",
    ];
    $("frames").replaceChildren();
    frames.forEach((frame, index) => {
      const figure = document.createElement("figure"),
        canvas = document.createElement("canvas"),
        label = document.createElement("figcaption");
      canvas.width = 160;
      canvas.height = 150;
      label.textContent = labels[index];
      actor(canvas.getContext("2d"), frame, 80, 132, 112);
      figure.append(canvas, label);
      $("frames").append(figure);
    });
    $("status").textContent =
      "Six frames loaded · shared scale and foot baseline · 8 platforms";
    $("status").dataset.state = "ready";
    cancelAnimationFrame(animationId);
    last = 0;
    animationId = requestAnimationFrame(tick);
  } catch (error) {
    $("status").textContent =
      `${error.message} Retry when the artwork is available.`;
    $("status").dataset.state = "error";
    $("retry").hidden = false;
  } finally {
    loading = false;
  }
}
$("pause").onclick = () => {
  paused = !paused;
  $("pause").textContent = paused ? "Play" : "Pause";
};
$("step").onclick = () => {
  paused = true;
  $("pause").textContent = "Play";
  const fps = Number($("fps").value);
  elapsed = ((Math.floor((elapsed * fps) / 1000) + 1) * 1000) / fps + 0.01;
  paint();
};
$("fps").oninput = () => {
  $("fps-value").value = $("fps").value;
};
$("motion").onchange = () => {
  elapsed = 0;
  $("fps").value = $("motion").value === "run" ? "8" : "2";
  $("fps-value").value = $("fps").value;
};
$("retry").onclick = start;
document.addEventListener("visibilitychange", () => {
  last = 0;
});
window.addEventListener("pagehide", () => cancelAnimationFrame(animationId));
window.addEventListener("pageshow", (event) => {
  if (event.persisted && assets) {
    last = 0;
    animationId = requestAnimationFrame(tick);
  }
});
start();
