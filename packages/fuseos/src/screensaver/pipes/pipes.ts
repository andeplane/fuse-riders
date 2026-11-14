/**
 * 3D Pipes in three.js: the Windows 98 screen saver as remade by Isaiah Odhner (https://github.com/1j01/pipes, MIT).
 * This module and `three` are a lazy chunk: nothing imports it statically, the screen saver overlay
 * `await import()`s it the moment the saver starts (tests/fuseos-screensaver-lazy.test.ts pins that).
 *
 * The rules live in `pipesModel.ts`; this file only builds meshes, points the camera and paints the dissolve.
 * The WebGL renderer is injected so the scene graph can be exercised without a GPU.
 */
import {
  AmbientLight,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Material,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { TeapotGeometry } from "three/examples/jsm/geometries/TeapotGeometry.js";

import type {
  JointChances,
  JointStyle,
  PipeState,
  Random,
  Vec3,
} from "./pipesModel";
import {
  cameraPosition,
  chance,
  createPipeState,
  dissolveBlocksPerFrame,
  dissolveGrid,
  dissolveOrder,
  jointChances,
  PipeGrid,
  pipeCount,
  random,
  randomCell,
  randomInteger,
  resolveJointStyle,
  sceneLifetimeMs,
  stepPipe,
} from "./pipesModel";

export type PipesOptions = {
  joints: JointStyle;
  /** The Utah teapot turns up at a joint now and then (one in two hundred turns; one in twenty on a candy cane scene). */
  teapots: boolean;
  /** Two or three pipes per scene instead of one. */
  multiple: boolean;
};

/** The part of three's WebGLRenderer the saver uses; a fake stands in for it in tests. */
export type PipesRenderer = {
  setSize(width: number, height: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  clear(): void;
  dispose(): void;
};

export type PipesDeps = {
  createRenderer: (canvas: HTMLCanvasElement) => PipesRenderer;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  setTimeout: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  /** Calls back when the host resizes; returns an unsubscribe. */
  subscribeResize: (onResize: () => void) => () => void;
  random: Random;
};

export const defaultPipesDeps: PipesDeps = {
  createRenderer: (canvas) =>
    new WebGLRenderer({ alpha: true, antialias: true, canvas }),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  subscribeResize: (onResize) => {
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  },
  random: () => Math.random(),
};

/** What a test or the overlay can read back; counts only, never three objects. */
export type PipesStats = {
  /** Scenes started so far (the first counts). */
  scenes: number;
  /** Pipes in the current scene. */
  pipes: number;
  /** Meshes in the current scene: segments plus joints. */
  meshes: number;
  /** Teapots in the current scene. */
  teapots: number;
  /** The dissolve is painting over the scene. */
  dissolving: boolean;
  /** The joint style of the current scene ("cycle" resolved); undefined before the first scene. */
  style: Exclude<JointStyle, "cycle"> | undefined;
};

export type PipesHandle = {
  stop(): void;
  stats(): PipesStats;
};

const PIPE_RADIUS = 0.2;
const BALL_RADIUS = PIPE_RADIUS * 1.5;
const TEAPOT_SIZE = BALL_RADIUS;
const DISSOLVE_SECONDS = 2;
const CANDY_CANE_CHANCE = 1 / 20;
const CANDY_CANE_TEAPOT_CHANCE = 1 / 20;
const UP = new Vector3(0, 1, 0);

/**
 * Starts the saver inside `container`, which gets two canvases: WebGL for the pipes and a 2D one on top for the
 * dissolve. Draws until `stop()`; the container is emptied again then.
 */
export function startPipes(
  container: HTMLElement,
  options: PipesOptions,
  deps: PipesDeps = defaultPipesDeps,
): PipesHandle {
  const rng = deps.random;
  const webgl = document.createElement("canvas");
  const overlay = document.createElement("canvas");
  for (const canvas of [webgl, overlay]) {
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
  }
  overlay.setAttribute("data-testid", "pipes-dissolve");
  webgl.setAttribute("data-testid", "pipes-webgl");
  const ctx2d = overlay.getContext("2d");

  const renderer = deps.createRenderer(webgl);
  const camera = new PerspectiveCamera(45, 1, 1, 100000);
  const scene = new Scene();
  scene.add(new AmbientLight(0x111111));
  const light = new DirectionalLight(0xffffff, 0.9);
  light.position.set(-1.2, 1.5, 0.5);
  scene.add(light);

  const grid = new PipeGrid();
  let pipes: Pipe[] = [];
  let scenes = 0;
  let cycleIndex = 0;
  let currentStyle: Exclude<JointStyle, "cycle"> | undefined;
  let candyCane: Texture | undefined;
  let candyCaneTried = false;

  let width = 0;
  let height = 0;
  const resize = () => {
    width = Math.max(1, container.clientWidth || window.innerWidth);
    height = Math.max(1, container.clientHeight || window.innerHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    overlay.width = width;
    overlay.height = height;
    dissolve?.repaint();
  };

  let dissolve: Dissolve | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleClear = () => {
    clearTimer = deps.setTimeout(clear, sceneLifetimeMs(rng));
  };
  const clear = () => {
    scheduleClear();
    if (dissolve) return;
    const { columns, rows } = dissolveGrid(width, height);
    dissolve = new Dissolve(
      ctx2d,
      dissolveOrder(rng, columns, rows),
      columns,
      rows,
      dissolveBlocksPerFrame(columns * rows, DISSOLVE_SECONDS),
      () => {
        reset();
        dissolve = undefined;
      },
    );
  };
  const reset = () => {
    renderer.clear();
    for (const pipe of pipes) {
      scene.remove(pipe.object3d);
      pipe.dispose();
    }
    pipes = [];
    grid.clear();
    look();
  };
  const look = () => {
    const [x, y, z] = cameraPosition(rng);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  };

  const spawn = () => {
    scenes += 1;
    const style = resolveJointStyle(options.joints, cycleIndex);
    currentStyle = style;
    if (options.joints === "cycle") cycleIndex += 1;
    let chances = jointChances(style, options.teapots);
    let texture: Texture | undefined;
    if (chance(rng, CANDY_CANE_CHANCE)) {
      if (!candyCaneTried) {
        candyCaneTried = true;
        candyCane = createCandyCaneTexture();
      }
      texture = candyCane;
      if (options.teapots)
        chances = { ...chances, teapot: CANDY_CANE_TEAPOT_CHANCE };
    }
    const count = pipeCount(rng, options.multiple);
    for (let index = 0; index < count; index += 1)
      pipes.push(new Pipe(scene, grid, rng, chances, texture));
  };

  let frame: number | undefined;
  const animate = () => {
    if (
      width !== Math.max(1, container.clientWidth || window.innerWidth) ||
      height !== Math.max(1, container.clientHeight || window.innerHeight)
    )
      resize();
    for (const pipe of pipes) pipe.update();
    if (pipes.length === 0) spawn();
    if (!dissolve) renderer.render(scene, camera);
    dissolve?.advance();
    frame = deps.requestFrame(animate);
  };

  resize();
  look();
  const unsubscribeResize = deps.subscribeResize(resize);
  scheduleClear();
  frame = deps.requestFrame(animate);

  return {
    stop: () => {
      if (frame !== undefined) deps.cancelFrame(frame);
      frame = undefined;
      if (clearTimer !== undefined) deps.clearTimeout(clearTimer);
      clearTimer = undefined;
      unsubscribeResize();
      for (const pipe of pipes) pipe.dispose();
      pipes = [];
      candyCane?.dispose();
      renderer.dispose();
      webgl.remove();
      overlay.remove();
    },
    stats: () => ({
      scenes,
      pipes: pipes.length,
      meshes: pipes.reduce((sum, pipe) => sum + pipe.meshes, 0),
      teapots: pipes.reduce((sum, pipe) => sum + pipe.teapots, 0),
      dissolving: dissolve !== undefined,
      style: currentStyle,
    }),
  };
}

/** One pipe: its material, its meshes under one Object3D and the cell it is growing from. */
class Pipe {
  readonly object3d = new Object3D();
  meshes = 0;
  teapots = 0;
  private readonly material: Material;
  private readonly state: PipeState;
  private readonly geometries: { dispose(): void }[] = [];

  constructor(
    scene: Scene,
    private readonly grid: PipeGrid,
    private readonly rng: Random,
    private readonly chances: JointChances,
    texture: Texture | undefined,
  ) {
    const color = randomInteger(rng, 0, 0xffffff);
    this.material = texture
      ? new MeshPhongMaterial({
          map: texture,
          specular: 0xa9fcff,
          shininess: 100,
        })
      : new MeshPhongMaterial({
          specular: 0xa9fcff,
          color,
          emissive: new Color(color).multiplyScalar(0.3),
          shininess: 100,
        });
    scene.add(this.object3d);
    const start = randomCell(rng);
    this.state = createPipeState(start);
    grid.take(start);
    this.ball(start);
  }

  update(): void {
    const step = stepPipe(this.rng, this.state, this.grid, this.chances);
    if (!step) return;
    if (step.joint === "teapot") this.teapot(step.from);
    else if (step.joint === "ball") this.ball(step.from);
    else if (step.joint === "elbow") this.elbow(step.from);
    this.segment(step.from, step.to);
  }

  private add(mesh: Mesh): void {
    this.geometries.push(mesh.geometry);
    this.object3d.add(mesh);
    this.meshes += 1;
  }

  private segment(from: Vec3, to: Vec3): void {
    const start = new Vector3(...from);
    const delta = new Vector3(...to).sub(start);
    const geometry = new CylinderGeometry(
      PIPE_RADIUS,
      PIPE_RADIUS,
      delta.length(),
      10,
      4,
      true,
    );
    const mesh = new Mesh(geometry, this.material);
    mesh.quaternion.copy(
      new Quaternion().setFromUnitVectors(UP, delta.clone().normalize()),
    );
    mesh.position.copy(start).add(delta.multiplyScalar(0.5));
    this.add(mesh);
  }

  private ball(at: Vec3): void {
    const mesh = new Mesh(new SphereGeometry(BALL_RADIUS, 8, 8), this.material);
    mesh.position.set(...at);
    this.add(mesh);
  }

  /** Not a true elbow: a sphere the pipe's own radius, so it rounds the corner without sticking out (as upstream). */
  private elbow(at: Vec3): void {
    const mesh = new Mesh(new SphereGeometry(PIPE_RADIUS, 8, 8), this.material);
    mesh.position.set(...at);
    this.add(mesh);
  }

  private teapot(at: Vec3): void {
    const mesh = new Mesh(
      new TeapotGeometry(TEAPOT_SIZE, 6, true, true, true, true, true),
      this.material,
    );
    mesh.position.set(...at);
    mesh.rotation.set(
      (Math.floor(random(this.rng, 0, 50)) * Math.PI) / 2,
      (Math.floor(random(this.rng, 0, 50)) * Math.PI) / 2,
      (Math.floor(random(this.rng, 0, 50)) * Math.PI) / 2,
    );
    this.teapots += 1;
    this.add(mesh);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
  }
}

/** Paints random blocks black over the frozen last frame until nothing is left, then calls back. */
class Dissolve {
  private index = 0;

  constructor(
    private readonly ctx: CanvasRenderingContext2D | null,
    private readonly order: readonly { column: number; row: number }[],
    private readonly columns: number,
    private readonly rows: number,
    private readonly perFrame: number,
    private readonly onDone: () => void,
  ) {}

  advance(): void {
    const until = Math.min(this.order.length, this.index + this.perFrame);
    for (; this.index < until; this.index += 1) this.paint(this.index);
    if (this.index >= this.order.length) this.finish();
  }

  /** After a resize the overlay canvas is blank again; paint what was already dissolved. */
  repaint(): void {
    for (let index = 0; index < this.index; index += 1) this.paint(index);
  }

  private paint(index: number): void {
    const cell = this.order[index];
    if (!cell || !this.ctx) return;
    const width = this.ctx.canvas.width / this.columns;
    const height = this.ctx.canvas.height / this.rows;
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(
      Math.floor(cell.column * width),
      Math.floor(cell.row * height),
      Math.ceil(width),
      Math.ceil(height),
    );
  }

  private finish(): void {
    this.ctx?.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.onDone();
  }
}

/** Upstream ships a candy cane PNG; this draws the same diagonal red and white stripes. Undefined without a 2D canvas. */
export function createCandyCaneTexture(size = 64): Texture | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#d4001a";
  const stripe = size / 4;
  for (let offset = -size; offset < size * 2; offset += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + stripe, 0);
    ctx.lineTo(offset + stripe - size, size);
    ctx.lineTo(offset - size, size);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}
